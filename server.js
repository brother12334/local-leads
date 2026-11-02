// Local server: serves dist/ and gives the app a reliable website-checking proxy.
//   npm start            → http://localhost:8080
// No dependencies; requires Node 18+.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'dist');
const PORT = Number(process.env.PORT) || 8080;
const MAX_BYTES = 2_000_000;
const TIMEOUT = 12_000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const KEEP_HEADERS = ['content-type', 'last-modified', 'server', 'x-powered-by', 'strict-transport-security'];

/** True for loopback, private, link-local and other non-public addresses. */
export function isPrivateIp(ip) {
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('ff');
}

async function assertPublic(url) {
  if (!/^https?:$/.test(url.protocol)) throw Object.assign(Error('Only http(s) URLs are allowed'), { code: 'BAD_URL' });
  if (url.port && !['80', '443'].includes(url.port)) throw Object.assign(Error('Only standard ports are allowed'), { code: 'BAD_URL' });
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (addrs.some(a => isPrivateIp(a.address))) throw Object.assign(Error('Private addresses are blocked'), { code: 'BLOCKED' });
}

async function readCapped(res) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    chunks.push(value);
    if (size >= MAX_BYTES) { reader.cancel(); break; }
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function proxyFetch(target) {
  let url = new URL(target);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    for (let hop = 0; hop < 6; hop++) {
      await assertPublic(url);
      const res = await fetch(url, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; LocalLeadsChecker/2.0)', accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'accept-language': 'en-US,en;q=0.8' },
      });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url); continue; }
      const headers = Object.fromEntries(KEEP_HEADERS.filter(h => res.headers.has(h)).map(h => [h, res.headers.get(h)]));
      const type = res.headers.get('content-type') || '';
      const body = /html|xml|text/i.test(type) || !type ? await readCapped(res) : '';
      return { status: res.status, finalUrl: url.href, headers, body };
    }
    throw Object.assign(Error('Too many redirects'), { code: 'REDIRECTS' });
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(Error('Timed out'), { code: 'TIMEOUT' });
    throw Object.assign(Error(e.cause?.code || e.message), { code: e.code || e.cause?.code || 'FETCH' });
  } finally { clearTimeout(timer); }
}

async function resolve(name) {
  try {
    const a = await dns.resolve4(name).catch(async e => (e.code === 'ENODATA' ? dns.resolve6(name) : Promise.reject(e)));
    return { exists: a.length > 0, addresses: a };
  } catch (e) {
    if (['ENOTFOUND', 'ENODATA', 'NXDOMAIN'].includes(e.code)) return { exists: false };
    return { exists: null, error: e.code };
  }
}

function send(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
  res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/health') return send(res, 200, { localLeads: true, version: 2 });
    if (url.pathname === '/api/dns') {
      const name = (url.searchParams.get('name') || '').toLowerCase();
      if (!/^[a-z0-9.-]{1,253}$/.test(name)) return send(res, 400, { error: 'Bad name' });
      return send(res, 200, await resolve(name));
    }
    if (url.pathname === '/api/fetch') {
      try { return send(res, 200, await proxyFetch(url.searchParams.get('url') || '')); }
      catch (e) { return send(res, 502, { error: e.message, code: e.code }); }
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path.endsWith('/')) path += 'index.html';
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden', 'text/plain');
    const s = await stat(file).catch(() => null);
    if (!s?.isFile()) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

export { server };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => console.log(`Local Leads running at http://localhost:${PORT}`));
}
