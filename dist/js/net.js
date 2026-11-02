// Network helpers. Browsers can't read other sites directly (CORS), so page fetches go
// through a proxy: your own (server.js or worker/cors-proxy.js) when available,
// otherwise free public CORS proxies.
import { settings } from './store.js';
import { parseSearchResults, isBotWall, stripTags } from './analyze.js';

const TIMEOUT = 15000;
let localApi; // undefined = not probed yet

async function timed(url, opts = {}, ms = TIMEOUT) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function ownProxy() {
  const custom = settings.get().proxy?.trim().replace(/\/+$/, '');
  if (custom) return custom;
  if (localApi === undefined) {
    try {
      const r = await timed('/api/health', {}, 2500);
      localApi = r.ok && (await r.json()).localLeads ? '/api' : null;
    } catch { localApi = null; }
  }
  return localApi;
}

export async function proxyMode() {
  const p = await ownProxy();
  return p ? (p === '/api' ? 'Local server' : 'Custom proxy') : 'Public proxies';
}

const PUBLIC = [
  {
    name: 'allorigins',
    async get(url) {
      const r = await timed('https://api.allorigins.win/get?url=' + encodeURIComponent(url));
      if (!r.ok) throw Error('allorigins ' + r.status);
      const j = await r.json();
      if (j.status?.http_code === undefined && !j.contents) throw Error('allorigins empty');
      return { status: j.status?.http_code || 200, finalUrl: j.status?.url || url, headers: { 'content-type': j.status?.content_type || '' }, body: j.contents || '' };
    },
  },
  {
    name: 'codetabs',
    async get(url) {
      const r = await timed('https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(url));
      if (!r.ok) throw Error('codetabs ' + r.status);
      const body = await r.text();
      if (/^\s*\{\s*"Error"/i.test(body)) throw Error('codetabs: ' + body.slice(0, 80));
      return { status: r.status, finalUrl: url, headers: {}, body };
    },
  },
  {
    name: 'corsproxy',
    async get(url) {
      const r = await timed('https://corsproxy.io/?url=' + encodeURIComponent(url));
      if (r.status === 403 || r.status === 401) throw Error('corsproxy refused');
      return { status: r.status, finalUrl: url, headers: { 'content-type': r.headers.get('content-type') || '' }, body: await r.text() };
    },
  },
];

/** Fetch a page's HTML. Resolves to {status, finalUrl, headers, body, via} or throws. */
export async function fetchPage(url) {
  const own = await ownProxy();
  if (own) {
    const r = await timed(`${own}/fetch?url=${encodeURIComponent(url)}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw Object.assign(Error(j.error || 'Proxy error ' + r.status), { code: j.code });
    return { ...j, via: own === '/api' ? 'local' : 'custom' };
  }
  let last;
  for (const p of PUBLIC) {
    try {
      const res = await p.get(url);
      // allorigins reports a failed upstream fetch as status 0 / null contents
      if (!res.status && !res.body) throw Error(p.name + ': upstream failed');
      return { ...res, via: p.name };
    } catch (e) { last = e; }
  }
  throw last || Error('No proxy available');
}

/** Does a hostname resolve? → {exists: true|false|null} (null = couldn't tell). */
const dnsCache = new Map();
export function resolveHost(host) {
  host = host.toLowerCase();
  if (!dnsCache.has(host)) {
    const p = lookup(host);
    dnsCache.set(host, p);
    p.then(r => { if (r.exists === null) dnsCache.delete(host); });
  }
  return dnsCache.get(host);
}

async function lookup(host) {
  const own = await ownProxy();
  if (own) {
    try {
      const r = await timed(`${own}/dns?name=${encodeURIComponent(host)}`, {}, 8000);
      if (r.ok) return await r.json();
    } catch { /* fall through to DoH */ }
  }
  const resolvers = [
    `https://dns.google/resolve?type=A&name=${encodeURIComponent(host)}`,
    `https://cloudflare-dns.com/dns-query?type=A&name=${encodeURIComponent(host)}`,
  ];
  for (const url of resolvers) {
    try {
      const r = await timed(url, { headers: { accept: 'application/dns-json' } }, 8000);
      if (!r.ok) continue;
      const j = await r.json();
      if (j.Status === 3) return { exists: false };
      if (j.Status === 0) return { exists: !!(j.Answer || []).length, addresses: (j.Answer || []).map(a => a.data) };
    } catch { /* try next */ }
  }
  return { exists: null };
}

/** Earliest Wayback Machine snapshot — a rough "site has existed since" date. */
export async function firstArchived(host) {
  try {
    const r = await timed(`https://archive.org/wayback/available?url=${encodeURIComponent(host)}&timestamp=19960101`, {}, 10000);
    const ts = (await r.json())?.archived_snapshots?.closest?.timestamp;
    return ts ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}` : null;
  } catch { return null; }
}

/** Google Lighthouse via PageSpeed Insights (needs a free API key for reliable quota). */
export async function pageSpeed(url, key) {
  const cats = ['performance', 'accessibility', 'best-practices', 'seo'].map(c => '&category=' + c).join('');
  const r = await timed(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?strategy=mobile&url=${encodeURIComponent(url)}${cats}${key ? '&key=' + encodeURIComponent(key) : ''}`, {}, 70000);
  const j = await r.json();
  if (!r.ok) throw Error(j.error?.message?.split('.')[0] || 'PageSpeed ' + r.status);
  const c = j.lighthouseResult.categories;
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.round(v.score * 100)]));
}

// ---- Web search ----

const ENGINES = [
  { name: 'Bing', url: q => `https://www.bing.com/search?format=rss&setlang=en-US&cc=US&q=${encodeURIComponent(q)}` },
  { name: 'DuckDuckGo', url: q => `https://html.duckduckgo.com/html/?kl=us-en&q=${encodeURIComponent(q)}` },
  { name: 'Mojeek', url: q => `https://www.mojeek.com/search?q=${encodeURIComponent(q)}` },
];
const searchCache = new Map();

/**
 * Search the web for a query. Tries engines in order (skipping ones that fail or
 * return a captcha) → {engine, results:[{url,host,title}]} ; throws if every engine fails.
 */
export async function webSearch(query, { skip = [] } = {}) {
  const key = query + '|' + skip.join(',');
  if (searchCache.has(key)) return searchCache.get(key);
  const errors = [];
  for (const engine of ENGINES) {
    if (skip.includes(engine.name)) continue;
    try {
      const page = await fetchPage(engine.url(query));
      const body = page.body || '';
      const results = parseSearchResults(body);
      const text = stripTags(body);
      if (!results.length && (isBotWall(body, '', text, page.status) || /anomaly|unusual traffic|bots use duckduckgo|solve the challenge/i.test(body) || body.length < 400)) {
        throw Error('blocked');
      }
      const out = { engine: engine.name, results };
      searchCache.set(key, out);
      return out;
    } catch (e) { errors.push(`${engine.name}: ${e.message}`); }
  }
  throw Error('Web search unavailable (' + errors.join('; ') + ')');
}

/** Official website of a chain/brand from Wikidata (property P856). */
export async function brandWebsite(qid) {
  if (!/^Q\d+$/.test(qid || '')) return null;
  try {
    const r = await timed(`https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${qid}&property=P856&format=json&origin=*`, {}, 10000);
    const j = await r.json();
    return j.claims?.P856?.[0]?.mainsnak?.datavalue?.value || null;
  } catch { return null; }
}

// ---- OpenStreetMap ----

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

export async function geocode(place) {
  const r = await timed('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(place));
  const j = await r.json();
  if (!j.length) throw Error('Location not found');
  return { lat: Number(j[0].lat), lon: Number(j[0].lon), label: j[0].display_name };
}

export async function overpass(query) {
  let error;
  for (const host of OVERPASS) {
    try {
      const r = await timed(host, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'content-type': 'application/x-www-form-urlencoded' } }, 45000);
      if (!r.ok) throw Error(`Map service returned ${r.status}`);
      return await r.json();
    } catch (e) { error = e; }
  }
  throw error;
}
