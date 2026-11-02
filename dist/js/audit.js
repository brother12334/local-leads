import { analyzeHtml, candidateDomains, classifyListedUrl, hostOf } from './analyze.js';
import { fetchPage, resolveHost, firstArchived } from './net.js';

const FREE_MAIL = /^(gmail|yahoo|hotmail|outlook|aol|icloud|me|live|msn|comcast|att|bellsouth|verizon|protonmail|ymail|mail)\./i;

async function load(url) {
  // Always try HTTPS first so a site that supports it isn't flagged as insecure.
  const bare = url.trim().replace(/^https?:\/\//i, '');
  const attempts = ['https://' + bare, 'http://' + bare];
  let err;
  for (const u of attempts) {
    try {
      const page = await fetchPage(u);
      if (!page.body && (!page.status || page.status >= 400)) throw Error('Empty response');
      return page;
    } catch (e) { err = e; }
  }
  throw err;
}

async function resolves(host) {
  const r = await resolveHost(host);
  if (r.exists === false && !host.startsWith('www.')) {
    const w = await resolveHost('www.' + host);
    if (w.exists) return w;
  }
  return r;
}

/** Audit one URL. Returns a partial result {status, url, host, analysis?, note}. */
export async function auditUrl(url, businessName) {
  const host = hostOf(url);
  if (!host) return { status: 'dead', url, host, note: 'Listed website is not a valid address' };
  const dns = await resolves(host);
  if (dns.exists === false) return { status: 'dead', url, host, note: `${host} does not exist (domain not registered or expired)` };
  let page;
  try { page = await load(url); }
  catch (e) {
    return dns.exists
      ? { status: 'unreachable', url, host, note: `${host} exists but the site didn’t load (${e.message})` }
      : { status: 'unknown', url, host, note: `Couldn’t check ${host}: ${e.message}` };
  }
  const analysis = analyzeHtml(page.body || '', { finalUrl: page.finalUrl, status: page.status, headers: page.headers, businessName });
  const status = analysis.kind === 'live' ? analysis.verdict : analysis.kind === 'error' ? 'broken' : analysis.kind;
  return { status, url: page.finalUrl || url, host, analysis, via: page.via, note: analysis.summary };
}

/** Look for a real website the map listing doesn't mention. */
export async function discover(lead, place) {
  const tried = [];
  const emailDomain = (lead.email || '').split('@')[1]?.toLowerCase();
  const guesses = candidateDomains(lead.name, place);
  if (emailDomain && !FREE_MAIL.test(emailDomain)) guesses.unshift(emailDomain);
  const unique = [...new Set(guesses)];

  const dns = await Promise.all(unique.map(async h => ({ host: h, ...(await resolves(h)) })));
  const live = dns.filter(d => d.exists !== false);
  for (const d of dns) if (d.exists === false) tried.push({ host: d.host, result: 'not registered' });

  for (const d of live.slice(0, 4)) {
    let res;
    try { res = await auditUrl('https://' + d.host, lead.name); }
    catch (e) { tried.push({ host: d.host, result: e.message }); continue; }
    const match = res.analysis?.nameMatch ?? 0;
    const viaEmail = d.host === emailDomain;
    if (res.analysis?.kind === 'live' && (match >= 0.6 || (viaEmail && match >= 0.3))) {
      return { found: { ...res, confidence: viaEmail ? Math.max(match, 0.8) : match }, tried };
    }
    if (!res.analysis && d.exists) tried.unverified = [...(tried.unverified || []), d.host];
    tried.push({ host: d.host, result: res.analysis ? (res.analysis.kind === 'live' ? `different business (“${res.analysis.title || 'untitled'}”)` : res.analysis.summary) : res.note });
  }
  return { found: null, tried, uncertain: dns.every(d => d.exists === null) };
}

/** Full audit for a lead. */
export async function auditLead(lead, place) {
  const started = Date.now();
  let result;
  const listed = lead.website;
  const listedKind = listed ? classifyListedUrl(listed) : null;

  if (listed && listedKind === 'site') {
    result = { ...(await auditUrl(listed, lead.name)), source: 'listed' };
  } else {
    const d = await discover(lead, place);
    if (d.found) result = { ...d.found, source: 'discovered', tried: d.tried };
    else if (listedKind) result = { status: 'social', url: listed, host: hostOf(listed), source: 'listed', tried: d.tried, note: `Only a ${listedKind === 'social' ? 'social media' : 'directory'} page (${hostOf(listed)}) — no real website found` };
    else if (d.uncertain) result = { status: 'unknown', source: 'none', tried: d.tried, note: 'Couldn’t reach the DNS checker — try again' };
    else {
      const maybe = d.tried.unverified;
      result = {
        status: 'none', source: 'none', tried: d.tried,
        note: (d.tried.length ? `No website found (checked ${d.tried.length} likely domains)` : 'No website found')
          + (maybe ? `. ${maybe.join(', ')} is registered but didn’t load — worth a manual look.` : ''),
      };
    }
  }

  if (result.host && ['modern', 'aging', 'outdated', 'broken', 'placeholder'].includes(result.status)) {
    result.archivedSince = await firstArchived(result.host);
  }
  return { ...result, checkedAt: new Date().toISOString(), ms: Date.now() - started };
}
