import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHtml, identityMatch, isBotWall, parseSearchResults, domainMatch, hostKind, classifyListedUrl, stripTags } from '../dist/js/analyze.js';

const lead = { name: "Joe's Plumbing", phone: '+1 561-555-0142', address: '120 NE Palmetto Park Rd', city: 'Boca Raton' };
const page = (body, title = '') => { const html = `<html><head><title>${title}</title></head><body>${body}</body></html>`; return [html, stripTags(html), title]; };

test('phone number on the page proves identity even with a different domain', () => {
  const [h, t, ti] = page('Call us today: (561) 555-0142. Family owned since 1988, serving South Florida.', 'Licensed Plumbers | Emergency Service');
  const r = identityMatch(lead, h, t, ti, 'https://bocaplumbingpros.com');
  assert.ok(r.confidence >= 0.85, JSON.stringify(r));
  assert.ok(r.signals.includes('phone number matches'));
});

test('street address + name match is accepted', () => {
  const [h, t, ti] = page("Joe's Plumbing — visit us at 120 NE Palmetto Park Road, Boca Raton FL", "Joe's Plumbing");
  assert.ok(identityMatch({ ...lead, phone: '' }, h, t, ti, 'https://joes-fl.com').confidence >= 0.9);
});

test('a same-named business in another city is rejected', () => {
  const [h, t, ti] = page("Joe's Plumbing serves Columbus, Ohio. Call 614-555-9999.", "Joe's Plumbing Columbus");
  const r = identityMatch(lead, h, t, ti, 'https://joesplumbingcolumbus.com');
  assert.ok(r.confidence < 0.65, JSON.stringify(r));
});

test('unrelated site on a guessed domain is rejected', () => {
  const [h, t, ti] = page('Premium domains and web hosting deals for everyone.', 'Hosting');
  assert.ok(identityMatch(lead, h, t, ti, 'https://joesplumbing.com').confidence < 0.65);
});

test('name in title + matching domain + city is accepted', () => {
  const [h, t, ti] = page("Welcome to Joe's Plumbing. Proudly serving Boca Raton and Delray Beach.", "Joe's Plumbing");
  assert.ok(identityMatch({ ...lead, phone: '' }, h, t, ti, 'https://joesplumbingfl.com').confidence >= 0.85);
});

test('security challenge pages are recognised, contact-form captchas are not', () => {
  assert.ok(isBotWall('<html><title>Just a moment...</title><body>Checking your browser</body></html>', 'Just a moment...', 'Checking your browser', 403));
  const legit = `<html><title>Joe's Plumbing</title><body>${'We fix leaks fast. '.repeat(40)}<div class="g-recaptcha"></div></body></html>`;
  assert.ok(!isBotWall(legit, "Joe's Plumbing", stripTags(legit), 200));
  assert.equal(analyzeHtml('<html><head><title>Attention Required! | Cloudflare</title></head><body>blocked</body></html>', { status: 403 }).kind, 'blocked');
});

test('parses DuckDuckGo HTML results', () => {
  const html = `<div class="result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.joesplumbingfl.com%2F&amp;rut=abc">Joe&#x27;s Plumbing - Boca Raton Plumbers</a></div>
  <div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.yelp.com%2Fbiz%2Fjoes&amp;rut=x">Joe's Plumbing - Yelp</a></div>`;
  const r = parseSearchResults(html);
  assert.equal(r[0].host, 'joesplumbingfl.com');
  assert.match(r[0].title, /Joe/);
  assert.equal(hostKind(r[1].host), 'directory');
});

test('parses Bing RSS and click-tracking links', () => {
  const rss = '<rss><channel><item><title>Joe&apos;s Plumbing | Boca Raton</title><link>https://joesplumbingfl.com/</link></item></channel></rss>';
  assert.equal(parseSearchResults(rss)[0].host, 'joesplumbingfl.com');
  const b64 = Buffer.from('https://joesplumbingfl.com/about').toString('base64').replace(/=+$/, '');
  const html = `<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=1&amp;u=a1${b64}&amp;ntb=1">Joe's Plumbing</a></h2></li>`;
  assert.equal(parseSearchResults(html)[0].url, 'https://joesplumbingfl.com/about');
});

test('domain matching and host classification', () => {
  assert.equal(domainMatch('joesplumbingfl.com', "Joe's Plumbing"), 1);
  assert.equal(domainMatch('bocaplumbingpros.com', "Joe's Plumbing"), 0.5);
  assert.equal(domainMatch('mrfixit.com', "Joe's Plumbing"), 0);
  assert.equal(hostKind('m.facebook.com'), 'social');
  assert.equal(hostKind('yellowpages.com'), 'directory');
  assert.equal(hostKind('joesplumbingfl.com'), 'site');
  assert.equal(classifyListedUrl('https://joes-plumbing.square.site'), 'site');
});
