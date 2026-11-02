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

  const businessName = meta.lead?.name || meta.businessName;
  const base = {
    title, generator, tech, textLength: text.length,
    nameMatch: businessName ? nameMatch(businessName, title + ' ' + text) : null,
    identity: meta.lead ? identityMatch(meta.lead, html, text, title, finalUrl) : null,
  };

  if (isBotWall(html, title, text, meta.status)) {
    return { ...base, kind: 'blocked', score: null, verdict: null, checks: [], summary: 'Site is online but blocks automated checks (security challenge)' };
  }

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

const BOT_WALL = [
  /just a moment\.\.\./i, /attention required! \| cloudflare/i, /cf-browser-verification|cf_chl_opt|challenge-platform/i,
  /checking (if the site connection is secure|your browser)/i, /enable javascript and cookies to continue/i,
  /verify you are (a )?human/i, /access denied/i, /request unsuccessful\. incapsula/i, /_incapsula_resource/i,
  /sucuri website firewall/i, /captcha/i, /are you a robot/i, /ddos protection by/i, /pardon our interruption/i,
];

/** Security / bot-challenge pages mean the site exists but couldn't be read. */
export function isBotWall(html, title = '', text = '', status = 200) {
  if (text.length > 3000) return false;
  if ([401, 403, 429, 503].includes(status) && (BOT_WALL.some(re => re.test(html)) || text.length < 600)) return true;
  return BOT_WALL.some(re => re.test(title)) || (text.length < 1200 && BOT_WALL.slice(0, 6).some(re => re.test(html)));
}

const digits = s => (s || '').replace(/\D/g, '');

/**
 * How sure are we that this page belongs to this business?
 * Combines name, phone, street address, city and domain signals → {confidence 0–1, signals[]}.
 */
export function identityMatch(lead, html, text, title = '', url = '') {
  const signals = [];
  const name = nameMatch(lead.name, title + ' ' + text);
  const titleName = nameMatch(lead.name, title);
  if (name >= 0.6) signals.push(`name on page (${Math.round(name * 100)}%)`);

  const phone = digits(lead.phone).slice(-10);
  let phoneHit = false;
  if (phone.length >= 7) {
    const pageDigits = digits(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/[a-z]+/gi, ' x '));
    const loose = digits(html);
    phoneHit = pageDigits.includes(phone) || loose.includes(phone) || (phone.length === 10 && loose.includes(phone.slice(3)) && loose.includes(phone.slice(0, 3)));
    if (phoneHit) signals.push('phone number matches');
  }

  let addressHit = false;
  const m = (lead.address || '').match(/^(\d+[a-z]?)\s+(.+)$/i);
  if (m) {
    const streetWord = nameTokens(m[2]).find(t => t.length > 2 && !/^(st|street|ave|avenue|rd|road|blvd|dr|drive|ln|way|ct|nw|ne|sw|se|north|south|east|west|hwy|highway)$/.test(t));
    const low = text.toLowerCase();
    addressHit = !!streetWord && new RegExp(`\\b${m[1]}\\b[^.]{0,40}${streetWord}`, 'i').test(low);
    if (addressHit) signals.push('street address matches');
  }

  const city = nameTokens((lead.city || lead.place || '').split(',')[0]);
  const cityHit = city.length > 0 && city.every(t => (' ' + text.toLowerCase() + ' ').includes(t));
  if (cityHit) signals.push('city mentioned');

  const dom = url ? domainMatch(hostOf(url), lead.name) : 0;
  if (dom >= 0.6) signals.push('domain matches name');

  // Evidence against: the page lists phone numbers and none of them is this business's.
  const pagePhones = (text.match(/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/g) || []).map(p => digits(p).slice(-10));
  const phoneConflict = phone.length === 10 && !phoneHit && pagePhones.length > 0;
  if (phoneConflict) signals.push('different phone number on page');

  let confidence;
  if (phoneHit && name >= 0.4) confidence = 0.97;
  else if (phoneHit) confidence = 0.85;
  else if (addressHit && name >= 0.5) confidence = 0.93;
  else if (name >= 0.6 && dom >= 0.6 && cityHit) confidence = 0.88;
  else if (name >= 0.8 && cityHit && !phoneConflict) confidence = 0.78;
  else if (name >= 0.6 && dom >= 0.6 && !phoneConflict) confidence = 0.7;
  else if (titleName >= 0.8 && dom >= 0.4 && !phoneConflict) confidence = 0.66;
  else confidence = Math.min(0.5, name * 0.5 + (cityHit ? 0.1 : 0));
  return { confidence, signals };
}

/** Share of the name's words that appear in the domain (0–1). */
export function domainMatch(host, name) {
  const label = (host || '').replace(/^www\./, '').split('.').slice(0, -1).join('').replace(/-/g, '');
  const tokens = nameTokens(name).filter(t => t.length >= 3 || nameTokens(name).length === 1);
  if (!label || !tokens.length) return 0;
  const hits = tokens.filter(t => label.includes(t)).length;
  let score = hits / tokens.length;
  const initials = nameTokens(name).map(t => t[0]).join('');
  if (initials.length >= 3 && label.startsWith(initials)) score = Math.max(score, 0.6);
  return score;
}

// Hosts that list businesses but are not the business's own website.
const DIRECTORY = /(^|\.)(yelp|yellowpages|yp|bbb|mapquest|tripadvisor|manta|chamberofcommerce|nextdoor|angi|angieslist|homeadvisor|thumbtack|houzz|porch|buildzoom|opentable|resy|doordash|grubhub|ubereats|seamless|postmates|slicelife|menupages|allmenus|menuism|sirved|zmenu|restaurantji|restaurantguru|zomato|foursquare|waze|google|goo|g|bing|yahoo|duckduckgo|mojeek|apple|wikipedia|wikidata|wikimapia|groupon|birdeye|buzzfile|dnb|bizapedia|opencorporates|sunbiz|corporationwiki|indeed|glassdoor|ziprecruiter|beenverified|superpages|citysearch|merchantcircle|hotfrog|cylex|brownbook|n49|showmelocal|ezlocal|local|insiderpages|judysbook|zocdoc|healthgrades|vitals|webmd|ratemds|sharecare|npiprofile|npidb|avvo|justia|findlaw|lawyers|martindale|superlawyers|realtor|zillow|trulia|redfin|homes|booksy|vagaro|styleseat|fresha|schedulicity|mindbodyonline|mindbody|classpass|toasttab|clover|square|business\.site|carfax|cars|cargurus|edmunds|autotrader|dealerrater|repairpal|mechanicadvisor|expedia|booking|hotels|kayak|trivago|priceline|agoda|orbitz|travelocity|hotwire|reddit|quora|pinterest|youtube|bizjournals|patch|nexthome|loopnet|crexi|alignable|thebluebook|procore|expertise|threebestrated|bestprosintown|topratedlocal|cityseeker|happycow|eatstreet|beyondmenu|menufy|chownow|order\.online|ordering\.app|wheree|storeboard|tuugo|find-us-here|us-business|bizhwy|opendi|yasabe|fyple|cybo|infobel|spoke|zoominfo|rocketreach|signalhire|crunchbase|instagram|facebook|fb|twitter|x|tiktok|linkedin|linktr|threads|snapchat)\.[a-z.]+$/i;
const SOCIAL = /(^|\.)(facebook|fb|instagram|twitter|x|tiktok|linkedin|linktr|threads)\.(com|ee|me|net)$/i;

/** Pull result links out of a search engine results page or RSS feed. */
export function parseSearchResults(body) {
  const out = [];
  const seen = new Set();
  const push = (url, title = '') => {
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return;
      const key = u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, '');
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ url: u.href, host: u.hostname.replace(/^www\./, '').toLowerCase(), title: stripTags(title).slice(0, 160) });
    } catch { /* not a URL */ }
  };
  const decode = s => s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/');
  // RSS (Bing format=rss)
  for (const m of body.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>/gi)) push(decode(m[2].trim()), m[1]);
  // Anchors: DuckDuckGo redirect (uddg=), Bing click-tracking (u=a1<base64>), or plain absolute hrefs
  for (const m of body.matchAll(/<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href = decode(m[1]);
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    const bing = href.match(/bing\.com\/ck\/a\?.*?[?&]u=a1([^&]+)/);
    if (bing) { try { href = atob(bing[1].replace(/-/g, '+').replace(/_/g, '/')); } catch { continue; } }
    if (!/^https?:\/\//i.test(href)) continue;
    push(href, m[2]);
  }
  return out.filter(r => !/(^|\.)(bing|duckduckgo|mojeek|microsoft|msn|live|w3\.org|schema\.org|gstatic|googleapis|cloudflare|jquery|bootstrapcdn|cdnjs)\.[a-z.]+$/i.test(r.host));
}

export function hostKind(host) {
  if (SOCIAL.test(host)) return 'social';
  if (DIRECTORY.test(host)) return 'directory';
  return 'site';
}

/**
 * Domain guesses for a business with no listed website. Real domains are often a
 * shortened name plus what they sell ("Tomasso's Pizza and Subs" → tomassos-pizza.com),
 * so this mixes full and shortened names, hyphenated forms, category words and the city.
 * Ordered most-likely first; DNS lookups are cheap, so it returns up to `limit` hosts.
 */
export function candidateDomains(name, city = '', { words = [], limit = 24 } = {}) {
  const tokens = nameTokens(name);
  if (!tokens.length) return [];
  const cityTokens = nameTokens(city.split(',')[0] || '');
  const generic = new Set(['restaurant', 'cafe', 'salon', 'bar', 'grill', 'shop', 'store', 'services', 'service', 'subs', 'pizzeria', 'kitchen', 'llc']);
  const extra = [...new Set(words.flatMap(w => nameTokens(String(w).replace(/_/g, ' '))))].filter(w => w.length > 2 && !tokens.includes(w)).slice(0, 2);
  const nameSets = [];
  const addSet = t => { if (t.length && t.join('').length >= 4 && !nameSets.some(x => x.join() === t.join())) nameSets.push(t); };
  addSet(tokens);                                            // tomassos pizza subs
  addSet(tokens.slice(0, 2));                                // tomassos pizza
  addSet(tokens.filter(t => !generic.has(t)));               // tomassos pizza
  addSet(nameTokens(name, ['and']));                         // tomassos pizza and subs
  addSet(tokens.slice(0, 1));                                // tomassos
  for (const w of extra) addSet([tokens[0], w]);             // tomassos pizza (from cuisine/category)
  const out = [];
  for (const t of nameSets) {
    out.push(t.join('') + '.com');
    if (t.length > 1) out.push(t.join('-') + '.com');
  }
  for (const t of nameSets.slice(0, 2)) {
    if (cityTokens.length) out.push(t.join('') + cityTokens.join('') + '.com');
    out.push(t.join('') + '.net');
  }
  if (cityTokens.length) out.push(tokens[0] + cityTokens.join('') + '.com', tokens.join('') + cityTokens.map(c => c[0]).join('') + '.com');
  out.push(tokens.join('') + '.co');
  return [...new Set(out)].filter(h => h.split('.')[0].replace(/-/g, '').length >= 4).slice(0, limit);
}

export function hostOf(url) {
  try { return new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

/** OSM sometimes lists a Facebook page or a directory link as the "website". */
export function classifyListedUrl(url) {
  const h = hostOf(url);
  // A shop's own Square/Toast/Wix site (name.square.site) is still their website.
  if (/\.(square\.site|wixsite\.com|weebly\.com|godaddysites\.com|squarespace\.com|webflow\.io|business\.site)$/.test(h)) return 'site';
  return hostKind(h);
}
