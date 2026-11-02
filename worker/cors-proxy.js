// Cloudflare Worker version of the website-checking proxy, for when the app is
// hosted on GitHub Pages. Deploy with `npx wrangler deploy worker/cors-proxy.js --name leads-proxy`
// (or paste into the Workers dashboard), then put the worker URL in the app's Settings.
//
// Endpoints (same contract as server.js /api/*):
//   GET /fetch?url=https://example.com → {status, finalUrl, headers, body}
//   GET /dns?name=example.com          → {exists, addresses}

const KEEP = ['content-type', 'last-modified', 'server', 'x-powered-by', 'strict-transport-security'];
const MAX = 2_000_000;
// Restrict who can use your worker: set to your Pages origin, e.g. 'https://you.github.io'.
const ALLOWED_ORIGIN = '*';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': ALLOWED_ORIGIN, 'cache-control': 'no-store' },
});

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/health')) return json({ localLeads: true });

    if (url.pathname.endsWith('/dns')) {
      const name = (url.searchParams.get('name') || '').toLowerCase();
      if (!/^[a-z0-9.-]{1,253}$/.test(name)) return json({ error: 'Bad name' }, 400);
      const r = await fetch(`https://cloudflare-dns.com/dns-query?type=A&name=${name}`, { headers: { accept: 'application/dns-json' } });
      const j = await r.json();
      if (j.Status === 3) return json({ exists: false });
      return json({ exists: j.Status === 0 ? !!(j.Answer || []).length : null, addresses: (j.Answer || []).map(a => a.data) });
    }

    if (url.pathname.endsWith('/fetch')) {
      let target;
      try { target = new URL(url.searchParams.get('url')); } catch { return json({ error: 'Bad URL' }, 400); }
      if (!/^https?:$/.test(target.protocol)) return json({ error: 'Only http(s) URLs' }, 400);
      try {
        const res = await fetch(target, {
          redirect: 'follow',
          headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', accept: 'text/html,*/*;q=0.5' },
          signal: AbortSignal.timeout(12000),
        });
        const type = res.headers.get('content-type') || '';
        let body = /html|xml|text/i.test(type) || !type ? await res.text() : '';
        if (body.length > MAX) body = body.slice(0, MAX);
        const headers = Object.fromEntries(KEEP.filter(h => res.headers.has(h)).map(h => [h, res.headers.get(h)]));
        return json({ status: res.status, finalUrl: res.url, headers, body });
      } catch (e) {
        return json({ error: e.message }, 502);
      }
    }
    return json({ error: 'Not found' }, 404);
  },
};
