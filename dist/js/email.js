import { hostOf, classifyListedUrl } from './analyze.js';

// Outreach email, in your own format. The wording adapts to what the check found:
// an existing site gets "rebuild", no site gets "build", and the domain line names
// their current domain when they have one.

const FOOD = /\b(restaurant|fast food|cafe|coffee|bar|pub|biergarten|bakery|pastry|ice cream|confectionery|deli|pizza|food court|food)\b/i;
const BROKEN = new Set(['dead', 'parked', 'placeholder', 'broken', 'unreachable']);
const NO_SITE = new Set(['none', 'social', 'likely-none']);

const money = n => '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

export const EMAIL_DEFAULTS = { yourName: 'Phineas Yablon', sender: 'Orange You Online?', buildPrice: 950, yearlyPrice: 300 };

export function draftEmail(lead, audit, status, opts = {}) {
  const me = opts.yourName || EMAIL_DEFAULTS.yourName;
  const company = opts.sender || EMAIL_DEFAULTS.sender;
  const build = Number(opts.buildPrice) || EMAIL_DEFAULTS.buildPrice;
  const yearly = Number(opts.yearlyPrice) || EMAIL_DEFAULTS.yearlyPrice;
  const listed = lead.website && classifyListedUrl(lead.website) === 'site' ? hostOf(lead.website) : '';
  const domain = NO_SITE.has(status) ? '' : (audit?.host || listed);
  const hasSite = !!domain;
  const things = FOOD.test(`${lead.category} ${lead.cuisine || ''}`)
    ? 'menus, offers and events'
    : 'your services, hours and contact details';

  const pitch = !hasSite
    ? `I create websites for local businesses and I would love to help you get a website that makes things like ${things} easy to find and visually appealing, especially for mobile users.`
    : BROKEN.has(status)
      ? `I create websites for local businesses and I noticed ${domain} isn’t working right now. I would love to help get it back up and make things like ${things} easier to find and more visually appealing, especially for mobile users.`
      : `I create websites for local businesses and I would love to help improve your website by making things like ${things}, easier to find and more visually appealing, especially for mobile users.`;

  const domainLine = hasSite
    ? `I’d host the site on Cloudflare Pages. You’d keep ownership of ${domain} and pay its renewal directly to your domain provider, as you do now.`
    : `I’d host the site on Cloudflare Pages. You’d own the domain name yourself and pay its renewal directly to your domain provider.`;

  const setupLine = hasSite
    ? 'I would also need to look into how your current website and email are set up so we can plan the switch properly.'
    : 'I would also need to look into how your email is set up so we can plan everything properly.';

  const subject = hasSite ? `Website ideas for ${lead.name}` : `A website for ${lead.name}`;
  const text = `Subject: ${subject}

Hi ${lead.name} team,

${pitch}

The cost would be ${money(build)} to ${hasSite ? 'rebuild' : 'build'} it, plus ${money(yearly)} per year (to manage and monitor it). That’s ${money(build + yearly)} for the first year, then ${money(yearly)} a year after that.

${domainLine}

${setupLine} Online ordering or other larger features would cost extra, and I’d quote those before doing any work.

Here are some of my ideas for the site, or if you’re looking for something different I can do it!

Best,
${me}
${company}`;
  return { subject, text };
}
