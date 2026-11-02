import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftEmail } from '../dist/js/email.js';

const expected = `Hi Duck Tavern team,

I create websites for local businesses and I would love to help improve your website by making things like menus, offers and events, easier to find and more visually appealing, especially for mobile users.

The cost would be $950 to rebuild it, plus $300 per year (to manage and monitor it). That’s $1,250 for the first year, then $300 a year after that.

I’d host the site on Cloudflare Pages. You’d keep ownership of theducktavern.com and pay its renewal directly to your domain provider, as you do now.

I would also need to look into how your current website and email are set up so we can plan the switch properly. Online ordering or other larger features would cost extra, and I’d quote those before doing any work.

Here are some of my ideas for the site, or if you’re looking for something different I can do it!

Best,
Phineas Yablon
Orange You Online?`;

test('email matches the house format for a business with a website', () => {
  const lead = { name: 'Duck Tavern', category: 'restaurant', website: 'https://www.theducktavern.com' };
  const { text } = draftEmail(lead, { host: 'theducktavern.com' }, 'outdated', {});
  assert.equal(text.split('\n\n').slice(1).join('\n\n'), expected);
});

test('business with no website gets build wording and no domain name', () => {
  const { text } = draftEmail({ name: 'Rosa Nails', category: 'beauty' }, { status: 'none' }, 'none', { buildPrice: '1000', yearlyPrice: '250' });
  assert.match(text, /help you get a website/);
  assert.match(text, /\$1,000 to build it, plus \$250 per year/);
  assert.match(text, /\$1,250 for the first year/);
  assert.match(text, /your services, hours and contact details/);
  assert.doesNotMatch(text, /keep ownership of/);
});

test('barber is not treated as a bar', () => {
  const { text } = draftEmail({ name: 'Clip Joint', category: 'barber', website: 'clipjoint.com' }, null, 'unchecked', {});
  assert.match(text, /services, hours and contact details/);
  assert.match(text, /keep ownership of clipjoint\.com/);
});
