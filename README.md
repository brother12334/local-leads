# Local Leads

Find local businesses on OpenStreetMap, check each one's web presence automatically, and draft outreach based on what the check found.

## What it checks

For every business in the search area, **Check all websites** runs the following:

| Situation | How it's detected | Shown as |
|---|---|---|
| No website listed | Finds the site through, in order: the chain's official site on Wikidata, the domain of a business email address, a **web search** (Bing, then DuckDuckGo, then Mojeek) by name + city, a search by phone number, and likely domain names. Each candidate is loaded and has to **prove it's the same business**: matching phone number, street address, or name plus city/domain. A different phone number on the page counts against it | A discovered site marked *(found)*, with the evidence shown |
| Nothing found | Shows **No website** only if a web search actually ran. If every search engine was blocked, it says **No site found (unconfirmed)** instead | **No website** / **unconfirmed** |
| Listed site is dead | Also searches for a newer site in case the map listing is just out of date | The current site, with a note about the stale listing |
| Site blocks bots (Cloudflare etc.) | Security-challenge pages are recognized, so they aren't mistaken for empty or wrong sites | **Has website · not scanned** |
| Only a Facebook / Instagram / Yelp page | The listed URL is on a social or directory host | **Social page only** |
| Domain gone | DNS lookup returns NXDOMAIN | **Dead domain** |
| Parked / for sale / expired | Page text matches parking-service and "buy this domain" patterns | **Parked domain** |
| "Coming soon", default server page, suspended | Placeholder patterns on a near-empty page | **Placeholder** |
| Error or not loading | HTTP 4xx/5xx, or the domain exists but nothing loads | **Broken site** / **Site down** |
| Live site | Scored 0–100 on how outdated it is (below) | **Modern** / **Aging** / **Outdated** |

The outdated score is weighted from these checks: HTTPS, mobile viewport, HTML5 doctype, copyright year in the footer, table/`<font>` layout markup, Flash/Java plugins, jQuery version, CMS/generator version (old WordPress, FrontPage, Dreamweaver…), meta description, social preview tags, semantic structure, image optimization, and the `Last-Modified` header. The app also detects the platform (Wix, Squarespace, WordPress, GoDaddy…) and shows the earliest Wayback Machine snapshot as an "online since" date. With a free PageSpeed API key it can also run a full Google Lighthouse audit.

Each lead gets an **opportunity score**: no site or a broken site ranks highest, outdated sites next, modern sites and chains/franchises lowest.

## Features

- Map of results colored by website status
- Filters by group, pipeline stage and name, plus sorting
- Pipeline stages (New → Contacted → Interested → Won / Not a fit), notes, and manual overrides
- Email drafts in your own format, with the business name, their domain and your prices filled in. The wording switches between "rebuild" and "build" depending on whether they have a site. Name, business name and prices are set in **Settings**
- CSV export
- Light and dark themes, a responsive layout, and keyboard shortcuts (`/` filter, `j`/`k` move, `c` check)

Your data (checks, notes, stages, settings) stays in your browser's localStorage.

## Running it

**Static hosting (GitHub Pages):** works as-is. The root `index.html` redirects to `dist/`. Browsers can't read other websites directly, so pages are fetched through free public CORS proxies and DNS goes through Google/Cloudflare DNS-over-HTTPS. These public proxies are rate-limited, so checks can sometimes come back "Couldn't check". Re-run them, or use one of the options below.

**Local server (most reliable):**

```sh
npm start        # http://localhost:8080
```

`server.js` has no dependencies. It serves the app and provides `/api/fetch` and `/api/dns`. The app finds these on its own. Requests to private and internal IP addresses are blocked.

**Your own proxy for GitHub Pages:** deploy `worker/cors-proxy.js` as a Cloudflare Worker (free tier) and paste its URL into **Settings → Custom proxy URL**. Set `ALLOWED_ORIGIN` in the worker to your Pages origin.

## Development

```sh
npm test         # analyzer + server tests (node --test)
```

The code lives in `dist/js/`:

- `analyze.js`: HTML analysis and domain guessing (no DOM access, so it can be tested in Node)
- `audit.js`: the check pipeline (DNS → fetch → analyze → discovery)
- `net.js`: proxies, DNS, Wayback, PageSpeed, and OpenStreetMap
- `search.js`: categories and Overpass queries
- `email.js`: outreach templates
- `store.js`: localStorage
- `app.js`: the UI

Results from older versions of the checker are re-checked automatically. Automated checks are a strong starting point, not proof. Look at the site yourself before you reach out.
