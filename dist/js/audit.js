import { analyzeHtml, candidateDomains, classifyListedUrl, domainMatch, hostKind, hostOf, nameMatch } from './analyze.js';
import { brandWebsite, fetchPage, firstArchived, resolveHost, webSearch } from './net.js';

// Bump when detection logic changes so older (less accurate) results are re-checked.
export const AUDIT_VERSION = 4;

const FREE_MAIL = /^(gmail|googlemail|yahoo|hotmail|outlook|aol|icloud|me|live|msn|comcast|att|bellsouth|verizon|protonmail|proton|ymail|mail|gmx|zoho|cox|charter|earthlink|sbcglobal)\./i;
const BROKEN = new Set(['dead', 'parked', 'placeholder', 'broken', 'unreachable']);
const LABEL = { dead: 'dead domain', parked: 'parked domain', placeholder: 'placeholder page', broken: 'error page', unreachable: 'not loading' };

async function load(url) {
  // Always try HTTPS first so a site that supports it isn't flagged as insecure.
  const bare = url.trim().replace(/^https?:\/\//i, '');
  let err;
  for (const u of ['https://' + bare, 'http://' + bare]) {
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

/** Audit one URL → {status, url, host, analysis?, note}. */
export async function auditUrl(url, lead) {
  const host = hostOf(url);
  if (!host) return { status: 'dead', url, host, note: 'Listed website is not a valid address' };
  const dns = await resolves(host);
  if (dns.exists === false) return { status: 'dead', url, host, note: `${host} does not exist (domain not registered or expired)` };
  let page;
  try { page = await load(url); }
  catch (e) {
    // Only the self-hosted checker reports real connection errors (refused, timeout, TLS).
    // A public-proxy failure says nothing about the site, so don't call it down.
    if (e.code && !['BLOCKED', 'BAD_URL'].includes(e.code)) {
      return { status: 'unreachable', url, host, note: `${host} is registered but the site isn’t responding (${e.message})` };
    }
    return dns.exists
      ? { status: 'protected', url, host, note: `${host} is online but couldn’t be scanned (${e.message}). Open it to judge it yourself.`, uncertain: true }
      : { status: 'unknown', url, host, note: `Couldn’t check ${host}: ${e.message}`, uncertain: true };
  }
  const analysis = analyzeHtml(page.body || '', { finalUrl: page.finalUrl, status: page.status, headers: page.headers, lead });
  const status = { live: analysis.verdict, error: 'broken', blocked: 'protected' }[analysis.kind] || analysis.kind;
  return { status, url: page.finalUrl || url, host: hostOf(page.finalUrl || url) || host, analysis, via: page.via, note: analysis.summary };
}

/**
 * Find a business's real website when the map listing doesn't have one (or has a dead one).
 * Sources, strongest first: brand record on Wikidata, business email domain, web search
 * (by name + city, then by phone number), and likely domain names. Every candidate is
 * loaded and must prove it belongs to this business (phone, address, name + city/domain).
 */
export async function findWebsite(lead, place, { excludeHost } = {}) {
  const log = [];
  const city = (lead.city || place.split(',')[0] || '').trim();
  const L = { ...lead, place };
  const possible = [];
  let social = null;
  let searchOk = false;
  let engine = '';

  const accept = (res, confidence, how) => ({ found: { ...res, confidence, how, signals: res.analysis?.identity?.signals || [] }, log, searchOk, engine });

  // 1. Chains: Wikidata holds the brand's official website.
  if (lead.brandWikidata) {
    const site = await brandWebsite(lead.brandWikidata);
    if (site) {
      const res = await auditUrl(site, L);
      if (res.status !== 'dead') return accept(res, 0.95, 'Official brand website (Wikidata)');
      log.push({ host: hostOf(site), result: 'brand site is dead' });
    }
  }

  // 2. Candidates from email, search and guessed domains.
  const cands = new Map(); // host → candidate
  const add = (host, url, from, extra = {}) => {
    host = host.replace(/^www\./, '').toLowerCase();
    if (!host || host === excludeHost || cands.has(host)) return;
    cands.set(host, { host, url, from, dom: domainMatch(host, lead.name), ...extra });
  };

  const emailDomain = (lead.email || '').split('@')[1]?.toLowerCase();
  if (emailDomain && !FREE_MAIL.test(emailDomain)) add(emailDomain, 'https://' + emailDomain, 'email');

  const queries = [`${lead.name} ${city}`.trim()];
  const phone = (lead.phone || '').replace(/\D/g, '').slice(-10);
  if (phone.length === 10) queries.push(`"${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}"`);

  for (const [i, q] of queries.entries()) {
    let res;
    try { res = await webSearch(q); }
    catch (e) { log.push({ host: 'web search', result: e.message }); break; }
    searchOk = true;
    engine = res.engine;
    res.results.forEach((r, rank) => {
      const kind = hostKind(r.host);
      const titleMatch = nameMatch(lead.name, r.title);
      if (kind === 'social') {
        if (!social && titleMatch >= 0.6) social = r;
        return;
      }
      if (kind === 'directory') return;
      const dom = domainMatch(r.host, lead.name);
      // Phone-number searches are precise; name searches need the result to look related.
      if (i === 0 && dom < 0.3 && titleMatch < 0.5) return;
      add(r.host, r.url, i === 0 ? 'search' : 'phone search', { rank, title: r.title, titleMatch });
    });
    // Stop after the name search if it already produced a strong-looking candidate.
    if ([...cands.values()].some(c => c.from === 'search' && c.dom >= 0.6 && c.titleMatch >= 0.6)) break;
  }

  const words = [...(lead.cuisine || '').split(/[;,]/), lead.category].filter(Boolean);
  const guesses = candidateDomains(lead.name, place, { words }).filter(h => !cands.has(h));
  const dns = await Promise.all(guesses.map(async h => ({ host: h, ...(await resolves(h)) })));
  for (const d of dns) {
    if (d.exists === false) log.push({ host: d.host, result: 'not registered' });
    else add(d.host, 'https://' + d.host, 'guess');
  }

  const rankScore = c => ({ email: 3, 'phone search': 2.5, search: 1.6 - (c.rank || 0) * 0.08, guess: 0.9 }[c.from] + c.dom * 1.5 + (c.titleMatch || 0));
  const ordered = [...cands.values()].sort((a, b) => rankScore(b) - rankScore(a)).slice(0, 8);

  for (const c of ordered) {
    const res = await auditUrl(c.url, L);
    const id = res.analysis?.identity;
    let conf = id?.confidence ?? 0;
    if (c.from === 'email' && conf >= 0.3) conf = Math.max(conf, 0.85);
    if (c.from === 'phone search' && conf >= 0.4) conf = Math.max(conf, 0.8);

    if (res.status === 'dead') { log.push({ host: c.host, result: 'not registered' }); continue; }
    if (res.analysis && conf >= 0.65 && !['parked'].includes(res.status)) {
      return accept(res, conf, { email: 'Business email domain', search: `Web search (${engine})`, 'phone search': `Phone-number search (${engine})`, guess: 'Domain name check' }[c.from]);
    }
    const couldntRead = !res.analysis || res.status === 'protected';
    const searchVouches = c.from !== 'guess' && (c.from !== 'search' || (c.dom >= 0.6 && c.titleMatch >= 0.6));
    if (couldntRead && searchVouches) {
      return accept({ ...res, status: res.status === 'protected' ? 'protected' : res.status },
        0.7, `Web search (${engine}) — “${c.title || c.host}”`);
    }
    if (couldntRead) { possible.push(c); log.push({ host: c.host, result: 'registered, couldn’t be read' }); continue; }
    log.push({ host: c.host, result: res.status === 'parked' ? 'parked domain'
      : `doesn’t match this business (“${res.analysis.title || 'untitled'}”${id?.signals?.length ? ', ' + id.signals.join(', ') : ''})` });
  }
  return { found: null, log, social, searchOk, engine, possible };
}

/** Full audit for a lead. */
export async function auditLead(lead, place) {
  const started = Date.now();
  let result;
  const listed = lead.website;
  const listedKind = listed ? classifyListedUrl(listed) : null;

  if (listed && listedKind === 'site') {
    result = { ...(await auditUrl(listed, { ...lead, place })), source: 'listed' };
    // The listing may simply be stale — look for a current site before calling it broken.
    if (BROKEN.has(result.status)) {
      const f = await findWebsite(lead, place, { excludeHost: result.host });
      if (f.found) {
        result = { ...f.found, source: 'discovered', tried: f.log,
          note: `Map listing points to ${result.host} (${LABEL[result.status]}), but their current site is ${f.found.host}. ${f.found.note}` };
      }
    }
  } else {
    const f = await findWebsite(lead, place);
    const searched = f.searchOk ? `searched ${f.engine}` : 'web search was unavailable';
    const domains = f.log.filter(t => t.host !== 'web search').length;
    if (f.found) {
      result = { ...f.found, source: 'discovered', tried: f.log };
    } else if (listedKind) {
      result = { status: 'social', url: listed, host: hostOf(listed), source: 'listed', tried: f.log,
        note: `Only a ${listedKind === 'social' ? 'social media' : 'directory'} page (${hostOf(listed)}) — ${searched}, no real website found` };
    } else if (f.social) {
      result = { status: 'social', url: f.social.url, host: f.social.host, source: 'discovered', tried: f.log,
        note: `Only a social page found (${f.social.host}) — no website of their own` };
    } else if (f.possible.length) {
      // A registered domain that matches the name is very likely theirs, even if it couldn't be read.
      const best = f.possible.sort((a, b) => b.dom - a.dom)[0];
      const strong = best.dom >= 0.6;
      result = { status: strong ? 'possible' : 'unknown', url: 'https://' + best.host, host: best.host, source: 'discovered', tried: f.log,
        note: strong
          ? `${best.host} is registered and matches the name, but couldn’t be scanned — very likely their website. Open it to confirm.`
          : `Possible website ${f.possible.map(p => p.host).join(', ')} exists but couldn’t be read — open it to confirm` };
    } else if (!f.searchOk) {
      result = { status: 'likely-none', source: 'none', tried: f.log,
        note: `No site at ${domains} likely domains, but web search was unavailable, so this isn’t confirmed. Re-check later or Google it.` };
    } else {
      result = { status: 'none', source: 'none', tried: f.log,
        note: `No website found — ${searched} and checked ${domains} likely domains` };
    }
  }

  if (result.host && ['modern', 'aging', 'outdated', 'broken', 'placeholder', 'protected'].includes(result.status)) {
    result.archivedSince = await firstArchived(result.host);
  }
  return { ...result, v: AUDIT_VERSION, checkedAt: new Date().toISOString(), ms: Date.now() - started };
}
