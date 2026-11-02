// Pure HTML analysis — no DOM access, so it runs in the browser and in Node tests.

const PARKED = [
  /this domain (name )?(is|may be) for sale/i,
  /buy this domain/i,
  /domain (is )?parked/i,
  /parked (free|domain|by)/i,
  /sedoparking|parkingcrew|bodis\.com|above\.com\/marketplace/i,
  /hugedomains\.com/i,
  /dan\.com\/buy-domain|afternic\.com/i,
  /the domain .{0,40} has expired/i,
  /this domain has expired/i,
  /renew (this|your) domain/i,
];

const PLACEHOLDER = [
  /coming soon/i,
  /under construction/i,
  /launching soon/i,
  /site is being built/i,
  /welcome to nginx/i,
  /apache2? .{0,20}default page/i,
  /default web site page/i,
  /<h1>it works!<\/h1>/i,
  /account (has been )?suspended/i,
  /<title>index of \//i,
  /future home of/i,
];

const BUILDERS = [
  [/static\.wixstatic\.com|wix\.com\/|_wixCIDX|wix-warmup-data/i, 'Wix'],
  [/squarespace\.com|static1\.squarespace/i, 'Squarespace'],
  [/cdn\.shopify\.com|Shopify\.theme/i, 'Shopify'],
  [/weebly\.com|editmysite\.com/i, 'Weebly / Square Online'],
  [/img1\.wsimg\.com|godaddy website builder/i, 'GoDaddy Builder'],
  [/wp-content\/|wp-includes\//i, 'WordPress'],
  [/webflow\.(com|io)|data-wf-page/i, 'Webflow'],
  [/irp\.cdn-website\.com|dudaone|multiscreensite/i, 'Duda'],
  [/\/media\/jui\/|joomla/i, 'Joomla'],
  [/drupal-settings-json|\/sites\/default\/files/i, 'Drupal'],
  [/framer\.com|framerusercontent/i, 'Framer'],
  [/_next\/static/i, 'Next.js'],
  [/data-reactroot|__NUXT__|ng-version=/i, 'JS framework'],
  [/homestead\.com/i, 'Homestead'],
  [/yola(cdn)?\.com/i, 'Yola'],
  [/jimdo/i, 'Jimdo'],
  [/strikingly/i, 'Strikingly'],
];

const LEGACY_GENERATORS = /frontpage|dreamweaver|iweb|publisher|word\b|netobjects|homestead|adobe golive|serif webplus|intuit|website tonight/i;

const SHORT = {
  https: 'no HTTPS', viewport: 'not mobile-friendly', doctype: 'legacy HTML', copyright: 'stale content',
  markup: 'table/font-tag layout', plugins: 'uses Flash', jquery: 'old jQuery', cms: 'outdated site software',
  seo: 'no search description', social: 'no share preview', semantic: 'poor page structure',
  images: 'unoptimized images', modified: 'not updated in years',
};

const STOP = new Set(['the', 'and', 'of', 'a', 'an', 'at', 'in', 'on', 'llc', 'inc', 'co', 'corp', 'ltd', 'pllc', 'pa', 'pc', 'company', 'group', '&']);

export function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&copy;|&#169;|&#xa9;/gi, '©')
    .replace(/&#39;|&rsquo;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameTokens(name, keep = []) {
  return name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(t => t && (keep.includes(t) || !STOP.has(t)));
}

/** Share of the business name's meaningful words that appear on the page (0–1). */
export function nameMatch(name, text) {
  const tokens = nameTokens(name);
  if (!tokens.length) return 0;
  const hay = ' ' + text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ') + ' ';
  const squashed = hay.replace(/ /g, '');
  let hits = 0;
  for (const t of tokens) if (hay.includes(' ' + t + ' ') || (t.length > 4 && squashed.includes(t))) hits++;
  return hits / tokens.length;
}

function attr(html, re) {
  const m = html.match(re);
  return m ? m[1].trim() : '';
}

function copyrightYear(text, html) {
  const years = [];
  const re = /(?:©|\(c\)|copyright)\s*(?:[a-z.,]+\s*){0,3}((?:19|20)\d{2})(?:\s*[-–—]\s*((?:19|20)\d{2}))?/gi;
  for (const src of [text, html]) {
    let m;
    while ((m = re.exec(src))) years.push(Number(m[2] || m[1]));
  }
  // A script that prints the current year is a "live" copyright.
  if (/getFullYear\(\)/.test(html) && /©|copyright|&copy;/i.test(html)) years.push(new Date().getFullYear());
  return years.length ? Math.max(...years) : null;
}

function check(id, label, weight, pass, detail, fix) {
  return { id, label, weight, pass, detail, fix };
}

/**
 * Analyse a fetched page.
 * @param {string} html
 * @param {{finalUrl?:string, status?:number, headers?:Record<string,string>, businessName?:string, now?:Date}} meta
 */
export function analyzeHtml(html, meta = {}) {
  const now = meta.now || new Date();
  const year = now.getFullYear();
  const finalUrl = meta.finalUrl || '';
  const headers = meta.headers || {};
  const head = (html.match(/<head[\s\S]*?<\/head>/i) || [html.slice(0, 20000)])[0];
  const text = stripTags(html);
  const title = stripTags(attr(html, /<title[^>]*>([\s\S]*?)<\/title>/i)).slice(0, 140);
  const generator = attr(head, /<meta[^>]+name=["']?generator["']?[^>]+content=["']([^"']+)/i)
    || attr(head, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']?generator/i);

  const tech = [];
  for (const [re, label] of BUILDERS) if (re.test(html) && !tech.includes(label)) tech.push(label);
  if (generator && !tech.some(t => generator.toLowerCase().includes(t.toLowerCase().split(' ')[0]))) tech.push(generator);

  const base = { title, generator, tech, textLength: text.length, nameMatch: meta.businessName ? nameMatch(meta.businessName, title + ' ' + text) : null };

  if (PARKED.some(re => re.test(text) || re.test(title))) {
    return { ...base, kind: 'parked', score: 100, verdict: 'broken', checks: [], summary: 'Domain is parked or for sale' };
  }
  if (text.length < 1500 && PLACEHOLDER.some(re => re.test(html))) {
    return { ...base, kind: 'placeholder', score: 100, verdict: 'broken', checks: [], summary: 'Placeholder or “coming soon” page' };
  }
  if (meta.status && meta.status >= 400) {
    return { ...base, kind: 'error', score: 100, verdict: 'broken', checks: [], summary: `Site returns HTTP ${meta.status}` };
  }
  const isJsShell = text.length < 200 && /<script/i.test(html) && /id=["'](root|app|__next|__nuxt)["']/i.test(html);
  if (text.length < 120 && !isJsShell) {
    return { ...base, kind: 'placeholder', score: 90, verdict: 'broken', checks: [], summary: 'Page is nearly empty' };
  }

  const checks = [];

  checks.push(check('https', 'Secure connection (HTTPS)', 15,
    finalUrl ? /^https:/i.test(finalUrl) : null,
    finalUrl ? (/^https:/i.test(finalUrl) ? 'Loads over HTTPS' : 'Only loads over plain HTTP') : 'Unknown',
    'Browsers label this site “Not secure”.'));

  const hasViewport = /<meta[^>]+name=["']?viewport/i.test(head);
  checks.push(check('viewport', 'Mobile-friendly viewport', 20, hasViewport,
    hasViewport ? 'Viewport meta tag present' : 'No viewport tag — page renders zoomed-out on phones',
    'It isn’t built for phones, where most local searches happen.'));

  const doctype = (html.match(/<!doctype[^>]*>/i) || [''])[0];
  const html5 = /^<!doctype html\s*>$/i.test(doctype.trim());
  checks.push(check('doctype', 'Modern HTML5 markup', 8, doctype ? html5 : false,
    doctype ? (html5 ? 'HTML5 doctype' : `Legacy doctype: ${doctype.replace(/\s+/g, ' ').slice(0, 70)}`) : 'No doctype (quirks mode)',
    'The code is built on standards from the early 2000s.'));

  const cy = copyrightYear(text, html);
  const age = cy ? year - cy : null;
  checks.push(check('copyright', 'Recently updated content', 15,
    cy == null ? null : age <= 1,
    cy == null ? 'No copyright year found' : age <= 1 ? `Copyright ${cy}` : `Copyright says ${cy} — ${age} years stale`,
    `The footer still says © ${cy}, so it looks unmaintained.`));

  const legacyTags = (html.match(/<(font|center|marquee|blink|frameset|frame)\b/gi) || []).length
    + (html.match(/\sbgcolor=|\salign=["']?(center|left|right)|<table[^>]+(cellpadding|cellspacing)=/gi) || []).length;
  checks.push(check('markup', 'No legacy layout markup', 12, legacyTags < 4,
    legacyTags < 4 ? 'No table/font-tag layout' : `${legacyTags} legacy tags (font, center, table layout, bgcolor…)`,
    'The layout uses decades-old techniques that break on modern screens.'));

  const plugins = /\.swf\b|application\/x-shockwave-flash|<applet\b|silverlight/i.test(html);
  checks.push(check('plugins', 'No Flash / Java / Silverlight', 15, !plugins,
    plugins ? 'Uses browser plugins that no longer run anywhere' : 'No dead plugins',
    'Parts of the site depend on Flash, which no browser runs anymore.'));

  const jq = html.match(/jquery[.-]?(?:min[.-])?v?(\d+)\.(\d+)(?:\.(\d+))?(?:\.min)?\.js/i) || html.match(/jquery\/(\d+)\.(\d+)(?:\.(\d+))?\//i);
  checks.push(check('jquery', 'Current JavaScript libraries', 6, jq ? Number(jq[1]) >= 3 : null,
    jq ? `jQuery ${jq[1]}.${jq[2]}${jq[3] ? '.' + jq[3] : ''}${Number(jq[1]) < 3 ? ' (end-of-life)' : ''}` : 'No jQuery detected',
    'It runs JavaScript libraries that stopped receiving security fixes years ago.'));

  let cmsPass = null, cmsDetail = generator || 'No generator tag';
  const wp = generator.match(/wordpress\s*(\d+)\.(\d+)/i);
  const joomla = generator.match(/joomla!?\s*(\d+)/i);
  if (wp) { cmsPass = Number(wp[1]) >= 6; cmsDetail = `WordPress ${wp[1]}.${wp[2]}${cmsPass ? '' : ' (outdated)'}`; }
  else if (joomla) { cmsPass = Number(joomla[1]) >= 4; cmsDetail = generator; }
  else if (LEGACY_GENERATORS.test(generator)) { cmsPass = false; cmsDetail = `Built with ${generator}`; }
  checks.push(check('cms', 'Up-to-date site software', 10, cmsPass, cmsDetail,
    `It runs on ${generator || 'old site software'}, which is past its supported life.`));

  const desc = /<meta[^>]+name=["']?description["']?[^>]+content=["'][^"']{20,}/i.test(head) || /<meta[^>]+content=["'][^"']{20,}["'][^>]+name=["']?description/i.test(head);
  checks.push(check('seo', 'Search description', 5, desc,
    desc ? 'Meta description set' : 'No meta description for Google results',
    'Google has no summary to show for it in search results.'));

  const og = /<meta[^>]+property=["']og:(title|image)/i.test(head);
  checks.push(check('social', 'Social sharing preview', 3, og,
    og ? 'Open Graph tags present' : 'No link preview when shared on social or text',
    'Links to it show no preview when shared in texts or social posts.'));

  const semantic = /<(header|nav|main|footer|section|article)\b/i.test(html);
  checks.push(check('semantic', 'Accessible page structure', 4, semantic,
    semantic ? 'Uses semantic HTML5 elements' : 'No header/nav/main/footer structure',
    'Screen readers and search engines struggle to understand the page structure.'));

  const modernImages = /\.(webp|avif)\b|srcset=|loading=["']lazy/i.test(html);
  const hasImages = /<img\b/i.test(html);
  checks.push(check('images', 'Optimized images', 4, hasImages ? modernImages : null,
    !hasImages ? 'No images' : modernImages ? 'Responsive / modern image formats' : 'Only full-size legacy image formats',
    'Images aren’t optimized, so it loads slowly on mobile data.'));

  const lastMod = headers['last-modified'] ? new Date(headers['last-modified']) : null;
  if (lastMod && !isNaN(lastMod) && /\.html?$|\/$/.test(finalUrl)) {
    const yrs = (now - lastMod) / 3.156e10;
    checks.push(check('modified', 'Server says recently changed', 6, yrs < 2,
      `Last-Modified: ${lastMod.toISOString().slice(0, 10)}`,
      `The server reports the page was last changed in ${lastMod.getFullYear()}.`));
  }

  const applicable = checks.filter(c => c.pass !== null);
  const total = applicable.reduce((s, c) => s + c.weight, 0) || 1;
  const failed = applicable.filter(c => !c.pass).reduce((s, c) => s + c.weight, 0);
  const score = Math.round((failed / total) * 100);
  const verdict = score >= 50 ? 'outdated' : score >= 25 ? 'aging' : 'modern';
  const worst = applicable.filter(c => !c.pass).sort((a, b) => b.weight - a.weight).slice(0, 3).map(c => SHORT[c.id]);
  const summary = verdict === 'modern' ? 'Modern, well-maintained site' : `Needs work: ${worst.join(', ')}`;

  return { ...base, kind: 'live', score, verdict, checks, copyrightYear: cy, summary };
}

/** Domain guesses for a business with no listed website. */
export function candidateDomains(name, city = '') {
  const tokens = nameTokens(name);
  if (!tokens.length) return [];
  const cityTokens = nameTokens(city.split(',')[0] || '');
  const generic = new Set(['restaurant', 'cafe', 'salon', 'bar', 'grill', 'shop', 'store', 'services', 'service']);
  const core = tokens.join('');
  const noGeneric = tokens.filter(t => !generic.has(t)).join('');
  const bases = [core];
  if (noGeneric && noGeneric !== core) bases.push(noGeneric);
  const withAnd = nameTokens(name, ['and']).join('');
  if (withAnd !== core) bases.push(withAnd);
  if (cityTokens.length) bases.push(core + cityTokens.join(''));
  if (tokens.length > 1) bases.push(tokens.join('-'));
  const out = [];
  for (const b of bases) {
    if (b.replace(/-/g, '').length < 4) continue;
    for (const tld of ['.com', '.net']) out.push(b + tld);
  }
  if (out.length) out.splice(2, 0, core + '.co');
  return [...new Set(out)].slice(0, 7);
}

export function hostOf(url) {
  try { return new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

/** OSM sometimes lists a Facebook page or a directory link as the "website". */
export function classifyListedUrl(url) {
  const h = hostOf(url);
  if (/(^|\.)(facebook|fb|instagram|twitter|x|tiktok|linktr|linkedin)\.(com|ee|me)$/.test(h)) return 'social';
  if (/(^|\.)(yelp|tripadvisor|google|goo|business\.site|doordash|ubereats|grubhub|opentable|toasttab|square\.site|booksy|vagaro|styleseat|mindbodyonline)\./.test(h + '.')) return 'directory';
  return 'site';
}
