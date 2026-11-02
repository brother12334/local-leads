import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHtml, candidateDomains, nameMatch, classifyListedUrl, hostOf } from '../dist/js/analyze.js';

const now = new Date('2026-11-02T12:00:00Z');
const filler = 'We serve fresh food daily with seasonal ingredients from local farms. '.repeat(10);

const modern = `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Luna Bistro | Boca Raton</title>
<meta name="description" content="Modern Italian bistro in downtown Boca Raton serving handmade pasta.">
<meta property="og:title" content="Luna Bistro"><script src="/js/jquery-3.7.1.min.js"></script></head>
<body><header><nav>Menu</nav></header><main><h1>Luna Bistro</h1><p>${filler}</p>
<img src="hero.webp" loading="lazy"></main><footer>© 2026 Luna Bistro</footer></body></html>`;

const outdated = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html><head><title>Joe's Plumbing</title><meta name="generator" content="Microsoft FrontPage 4.0">
<script src="jquery-1.4.2.min.js"></script></head>
<body bgcolor="#ffffff"><center><table cellpadding="0" cellspacing="0" width="760"><tr><td>
<font face="Arial" size="2">Joe's Plumbing serves the whole county. ${filler}</font>
<embed src="intro.swf" type="application/x-shockwave-flash"></td></tr></table></center>
<font size="1">Copyright 2011 Joe's Plumbing</font><img src="logo.gif"></body></html>`;

test('modern site scores low', () => {
  const r = analyzeHtml(modern, { finalUrl: 'https://lunabistro.com/', status: 200, businessName: 'Luna Bistro', now });
  assert.equal(r.kind, 'live');
  assert.equal(r.verdict, 'modern');
  assert.ok(r.score < 15, `score ${r.score}`);
  assert.equal(r.copyrightYear, 2026);
  assert.equal(r.nameMatch, 1);
});

test('legacy site is flagged outdated with specific reasons', () => {
  const r = analyzeHtml(outdated, { finalUrl: 'http://joesplumbing.com/', status: 200, businessName: "Joe's Plumbing", now });
  assert.equal(r.verdict, 'outdated');
  assert.ok(r.score > 80, `score ${r.score}`);
  const failed = r.checks.filter(c => c.pass === false).map(c => c.id);
  for (const id of ['https', 'viewport', 'doctype', 'copyright', 'markup', 'plugins', 'jquery', 'cms']) assert.ok(failed.includes(id), `expected ${id} to fail`);
  assert.equal(r.copyrightYear, 2011);
});

test('parked and placeholder pages are not treated as real sites', () => {
  assert.equal(analyzeHtml('<html><title>joesplumbing.com</title><body>This domain is for sale! Buy this domain today.</body></html>').kind, 'parked');
  assert.equal(analyzeHtml('<html><body><h1>Coming soon</h1><p>Our new website is under construction.</p></body></html>').kind, 'placeholder');
  assert.equal(analyzeHtml('<html><body>Hi</body></html>').kind, 'placeholder');
});

test('HTTP errors are broken', () => {
  assert.equal(analyzeHtml(`<html><body>${filler}</body></html>`, { status: 503 }).kind, 'error');
});

test('JS-rendered app shells are not mistaken for empty pages', () => {
  const r = analyzeHtml('<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Shop</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>', { finalUrl: 'https://x.com' });
  assert.equal(r.kind, 'live');
});

test('candidate domains', () => {
  const c = candidateDomains("Joe's Plumbing & Heating LLC", 'Boca Raton, Florida');
  assert.equal(c[0], 'joesplumbingheating.com');
  assert.ok(c.includes('joesplumbingandheating.com'));
  assert.ok(c.includes('joesplumbingheating.co'));
  assert.ok(c.length <= 7);
  assert.deepEqual(candidateDomains('A', ''), []);
});

test('name matching', () => {
  assert.equal(nameMatch('Café Olé', 'Welcome to cafe ole!'), 1);
  assert.ok(nameMatch('Sunrise Dental Group', 'Moonlight Pizza') < 0.5);
  assert.ok(nameMatch('Bella Nails', 'BellaNails Studio') >= 0.5);
});

test('listed URL classification', () => {
  assert.equal(classifyListedUrl('https://www.facebook.com/joesplumbing'), 'social');
  assert.equal(classifyListedUrl('https://www.yelp.com/biz/joes'), 'directory');
  assert.equal(classifyListedUrl('joesplumbing.com'), 'site');
  assert.equal(hostOf('http://www.Example.com/path'), 'example.com');
});
