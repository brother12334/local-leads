// Network helpers. Browsers can't read other sites directly (CORS), so page fetches go
// through a proxy: your own (server.js or worker/cors-proxy.js) when available,
// otherwise free public CORS proxies.
import { settings } from './store.js';
import { parseSearchResults, isBotWall, stripTags } from './analyze.js';

const TIMEOUT = 9000;
let localApi; // undefined = not probed yet

async function timed(url, opts = {}, ms = TIMEOUT) {
  const ctrl = new AbortController();
  // Abort with a readable reason; a bare abort() surfaces as "signal is aborted without reason".
  const t = setTimeout(() => ctrl.abort(new Error(`timed out after ${Math.round(ms / 1000)}s`)), ms);
  const stop = () => ctrl.abort(new Error('cancelled'));
  opts.signal?.addEventListener('abort', stop);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  catch (e) { throw ctrl.signal.aborted && ctrl.signal.reason instanceof Error ? ctrl.signal.reason : e; }
  finally { clearTimeout(t); opts.signal?.removeEventListener('abort', stop); }
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
  // Try the proxies that have been working first, and skip ones that keep failing,
  // so one dead service doesn't add its timeout to every single request.
  const now = Date.now();
  const order = PUBLIC.filter(p => health(p.name).downUntil < now)
    .sort((a, b) => health(b.name).score - health(a.name).score);
  if (!order.length) throw Error('All public proxies are temporarily failing');
  let last;
  for (const p of order) {
    try {
      const res = await p.get(url);
      // allorigins reports a failed upstream fetch as status 0 / null contents
      if (!res.status && !res.body) throw Error(p.name + ': upstream failed');
      mark(p.name, true);
      return { ...res, via: p.name };
    } catch (e) { mark(p.name, false); last = e; }
  }
  throw last || Error('No proxy available');
}

const healthMap = new Map();
function health(name) {
  if (!healthMap.has(name)) healthMap.set(name, { score: 0, fails: 0, downUntil: 0 });
  return healthMap.get(name);
}
function mark(name, ok, downMs = 120000) {
  const h = health(name);
  if (ok) { h.fails = 0; h.score = Math.min(h.score + 1, 20); return; }
  h.fails++;
  h.score = Math.max(h.score - 2, -20);
  if (h.fails >= 3) { h.downUntil = Date.now() + downMs; h.fails = 0; }
}

/** Which services are currently usable — shown in the scan status line. */
export function serviceStatus() {
  const now = Date.now();
  return {
    proxies: PUBLIC.filter(p => health(p.name).downUntil < now).length,
    engines: ENGINES.filter(e => health('search:' + e.name).downUntil < now).map(e => e.name),
  };
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
  const now = Date.now();
  const engines = ENGINES.filter(e => !skip.includes(e.name) && health('search:' + e.name).downUntil < now);
  // Every engine recently blocked us: fail instantly instead of waiting on each one again.
  if (!engines.length) throw Error('Web search unavailable (search engines are blocking the free proxies right now)');
  for (const engine of engines) {
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
      mark('search:' + engine.name, true);
      return out;
    } catch (e) {
      // A blocked engine stays blocked for a while; skip it for the next 10 minutes.
      mark('search:' + engine.name, false, 600000);
      if (e.message === 'blocked') health('search:' + engine.name).downUntil = Date.now() + 600000;
      errors.push(`${engine.name}: ${e.message}`);
    }
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
  const key = 'll.geo.' + place.trim().toLowerCase();
  try { const hit = JSON.parse(sessionStorage.getItem(key)); if (hit) return hit; } catch { /* no cache */ }
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await timed('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(place), {}, 20000);
      if (!r.ok) throw Error(`location service returned ${r.status}`);
      const j = await r.json();
      if (!j.length) throw Error(`Couldn’t find “${place}”. Try adding the state, e.g. “Boca Raton, FL”.`);
      const geo = { lat: Number(j[0].lat), lon: Number(j[0].lon), label: j[0].display_name };
      try { sessionStorage.setItem(key, JSON.stringify(geo)); } catch { /* quota */ }
      return geo;
    } catch (e) {
      if (/Couldn’t find/.test(e.message)) throw e;
      lastErr = e;
    }
  }
  throw Error(`The location service didn’t respond (${lastErr.message}). Try again in a moment.`);
}

async function overpassOne(host, query, ms) {
  const r = await timed(host, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'content-type': 'application/x-www-form-urlencoded' } }, ms);
  if (r.status === 429 || r.status === 504) throw Error('busy');
  if (!r.ok) throw Error(`returned ${r.status}`);
  const j = await r.json();
  if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) throw Error('busy');
  return j;
}

/**
 * Run several Overpass queries, at most 3 at a time, spreading them across the servers.
 * If a server hasn't answered after 10s, the same query is also sent to the next server
 * and whichever answers first wins, so one stalled server costs seconds, not a minute.
 * onDone(index, data, error) fires as each query finishes.
 */
export async function overpassMany(queries, onDone) {
  let next = 0;
  const runOne = i => new Promise(resolve => {
    const order = [0, 1, 2].map(k => OVERPASS[(i + k) % OVERPASS.length])
      .sort((a, b) => Number(health('map:' + a).downUntil > Date.now()) - Number(health('map:' + b).downUntil > Date.now()));
    let started = 0, failed = 0, settled = false, lastErr, timer;
    const launch = () => {
      if (settled || started >= order.length) return;
      const host = order[started++];
      clearTimeout(timer);
      timer = setTimeout(launch, 10000); // hedge: try another server if this one is slow
      overpassOne(host, queries[i], 35000).then(data => {
        mark('map:' + host, true);
        if (!settled) { settled = true; clearTimeout(timer); resolve([data, null]); }
      }, err => {
        mark('map:' + host, false, 60000);
        lastErr = err;
        if (++failed === order.length && !settled) { settled = true; clearTimeout(timer); resolve([null, lastErr]); }
        else if (!settled) launch(); // failed fast: move on right away
      });
    };
    launch();
  });
  const worker = async () => {
    while (next < queries.length) {
      const i = next++;
      const [data, err] = await runOne(i);
      onDone(i, data, err);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, queries.length) }, worker));
}
