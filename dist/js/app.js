import { CATEGORIES, searchBusinesses } from './search.js';
import { auditLead, AUDIT_VERSION } from './audit.js';
import { firstArchived, pageSpeed, proxyMode, serviceStatus } from './net.js';
import { audits, crm, settings, ui } from './store.js';
import { draftEmail } from './email.js';
import { hostOf } from './analyze.js';

const $ = sel => document.querySelector(sel);

// ---------- status model ----------
export const STATUS = {
  unchecked: { label: 'Not checked', tone: 'muted' },
  checking: { label: 'Checking…', tone: 'muted' },
  none: { label: 'No website', tone: 'hot' },
  social: { label: 'Social page only', tone: 'hot' },
  dead: { label: 'Dead domain', tone: 'bad' },
  parked: { label: 'Parked domain', tone: 'bad' },
  placeholder: { label: 'Placeholder', tone: 'bad' },
  broken: { label: 'Broken site', tone: 'bad' },
  unreachable: { label: 'Site down', tone: 'bad' },
  outdated: { label: 'Outdated', tone: 'warn' },
  aging: { label: 'Aging', tone: 'mild' },
  modern: { label: 'Modern', tone: 'good' },
  'likely-none': { label: 'No site found (unconfirmed)', tone: 'hot' },
  protected: { label: 'Has website · not scanned', tone: 'good' },
  possible: { label: 'Likely has website', tone: 'good' },
  unknown: { label: 'Couldn’t check', tone: 'muted' },
};
const GROUPS = {
  all: ['All', () => true],
  hot: ['Best leads', l => opportunity(l) >= 70],
  nosite: ['No website', l => ['none', 'social', 'likely-none'].includes(statusOf(l))],
  broken: ['Broken', l => STATUS[statusOf(l)].tone === 'bad'],
  outdated: ['Outdated', l => ['outdated', 'aging'].includes(statusOf(l))],
  modern: ['Modern', l => statusOf(l) === 'modern'],
  unchecked: ['Not checked', l => ['unchecked', 'unknown'].includes(statusOf(l))],
};
const STAGES = { new: 'New', contacted: 'Contacted', interested: 'Interested', won: 'Won', skip: 'Not a fit' };

let leads = [];
let selected = null;
let group = 'all';
const checking = new Set();
const stages = new Map(); // leadId → what the check is doing right now
const WORKERS = 5;
let scan = null; // {cancel:boolean, done, total}
let map, markers, markerById = new Map();

function statusOf(l) {
  if (checking.has(l.id)) return 'checking';
  const o = crm.get(l.id)?.override;
  if (o === 'none') return 'none';
  if (o === 'good') return 'modern';
  return audit(l)?.status || 'unchecked';
}

/** Saved result, ignoring ones made by an older, less accurate checker. */
function audit(l) {
  const a = audits.get(l.id);
  return a && a.v >= AUDIT_VERSION ? a : null;
}

function opportunity(l) {
  const s = statusOf(l);
  const a = audit(l);
  const score = a?.analysis?.score ?? 0;
  let v = {
    none: 95, social: 90, dead: 90, parked: 90, placeholder: 88, broken: 86, unreachable: 80,
    outdated: Math.min(84, 62 + score * 0.3), aging: 42 + score * 0.4, modern: 8 + score * 0.5,
    'likely-none': 74, protected: 20, possible: 28, unknown: 50, checking: l.website ? 45 : 72, unchecked: l.website ? 45 : 72,
  }[s];
  if (l.brand) v *= 0.35; // chains and franchises have corporate sites
  if (l.phone || l.email) v += 3;
  if (crm.get(l.id)?.stage === 'skip') v = 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

// ---------- tiny DOM helper ----------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}

const ICONS = {
  scan: '<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.6M20 4v4.6h-4.6M20 12a8 8 0 0 1-13.7 5.7L4 15.4M4 20v-4.6h4.6"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  pass: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  fail: '<path d="M6 6l12 12M18 6L6 18"/>',
  na: '<path d="M6 12h12"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
  pin: '<path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
};
const icon = (name, cls = '') => h('span', { class: 'ic ' + cls, 'aria-hidden': 'true', html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>` });

const chip = (s, id) => h('span', { class: `chip tone-${STATUS[s].tone}` + (s === 'checking' ? ' live' : '') }, h('i'), s === 'checking' && stages.get(id) ? `Checking: ${stages.get(id)}…` : STATUS[s].label);

// ---------- rendering ----------
let frame = 0;
function render() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => { renderStats(); renderList(); renderMap(); renderDetail(); });
}

function renderStats() {
  const box = $('#stats');
  box.replaceChildren(...Object.entries(GROUPS).map(([k, [label, fn]]) => {
    const n = leads.filter(fn).length;
    return h('button', { class: 'stat' + (group === k ? ' on' : ''), 'data-group': k, 'aria-pressed': String(group === k), onclick: () => { group = k; render(); } },
      h('span', { class: 'stat-n' }, n), h('span', { class: 'stat-l' }, label));
  }));
  const checked = leads.filter(l => audit(l)).length;
  $('#coverage').textContent = leads.length ? `${checked}/${leads.length} websites checked` : '';
}

function visible() {
  const q = $('#q').value.trim().toLowerCase();
  const stage = $('#stage').value;
  const out = leads.filter(l => GROUPS[group][1](l)
    && (!q || `${l.name} ${l.category} ${l.address}`.toLowerCase().includes(q))
    && (!stage || (crm.get(l.id)?.stage || 'new') === stage));
  const sort = $('#sort').value;
  const by = {
    opportunity: (a, b) => opportunity(b) - opportunity(a),
    outdated: (a, b) => (audit(b)?.analysis?.score ?? -1) - (audit(a)?.analysis?.score ?? -1),
    name: (a, b) => a.name.localeCompare(b.name),
    distance: () => 0,
  }[sort];
  return sort === 'distance' ? out : out.sort(by);
}

function renderList() {
  const list = $('#leads');
  const rows = visible();
  $('#count').textContent = leads.length ? `${rows.length} of ${leads.length}` : '';
  if (!leads.length) {
    list.replaceChildren(h('li', { class: 'empty' }, h('strong', {}, 'Search an area to find leads'), h('span', {}, 'Every listing gets a live website check: does a site exist, does it load, and how dated is it.')));
    return;
  }
  if (!rows.length) { list.replaceChildren(h('li', { class: 'empty' }, h('strong', {}, 'Nothing matches these filters'))); return; }
  list.replaceChildren(...rows.map(row));
}

function row(l) {
  const s = statusOf(l);
  const a = audit(l);
  const opp = opportunity(l);
  const stage = crm.get(l.id)?.stage;
  const host = a?.host || (l.website ? hostOf(l.website) : '');
  return h('li', { class: 'lead' + (selected === l.id ? ' sel' : ''), 'data-id': l.id },
    h('button', { class: 'lead-main', onclick: () => select(l.id) },
      h('span', { class: 'opp', style: `--v:${opp}`, title: 'Opportunity score' }, opp),
      h('span', { class: 'lead-text' },
        h('span', { class: 'lead-name' }, l.name, l.brand ? h('span', { class: 'tag' }, 'chain') : null, stage && stage !== 'new' ? h('span', { class: 'tag tag-stage' }, STAGES[stage]) : null),
        h('span', { class: 'lead-sub' }, [l.category, l.address].filter(Boolean).join(' · '))),
      h('span', { class: 'lead-site' },
        chip(s, l.id),
        h('span', { class: 'host' }, host ? host + (a?.source === 'discovered' ? ' (found)' : '') : '—'))),
    h('button', { class: 'icon-btn', title: a ? 'Re-check website' : 'Check website', 'aria-label': `Check website for ${l.name}`, disabled: checking.has(l.id), onclick: () => runAudit(l) }, icon('scan', checking.has(l.id) ? 'spin' : '')));
}

function select(id, fromMap = false) {
  selected = id;
  render();
  const l = leads.find(x => x.id === id);
  if (map && l && !fromMap) map.panTo([l.lat, l.lon], { animate: true });
  document.body.classList.add('detail-open');
}

let detailSig = '';
function renderDetail(force = false) {
  const box = $('#detail');
  const l = leads.find(x => x.id === selected);
  // Re-render only when this lead's data changed, so typing in the notes or the
  // email draft isn't wiped by a background scan.
  const sig = l ? JSON.stringify([l.id, statusOf(l), audit(l)?.checkedAt, !!audit(l)?.psi, crm.get(l.id)?.stage, crm.get(l.id)?.override, settings.get().sender, settings.get().yourName, settings.get().buildPrice, settings.get().yearlyPrice]) : '';
  if (!force && sig === detailSig && box.childElementCount) return;
  detailSig = sig;
  if (l) lookupArchive(l);
  if (!l) {
    box.replaceChildren(h('div', { class: 'detail-empty' }, 'Select a lead to see its website audit and a tailored email.'));
    return;
  }
  const a = audit(l);
  const s = statusOf(l);
  const c = crm.get(l.id) || {};
  const place = $('#place').value;
  const site = a?.url || (l.website && !/^(social|directory)$/.test(a?.status) ? l.website : '');
  const siteHref = site && (/^https?:/i.test(site) ? site : 'https://' + site);

  const facts = h('div', { class: 'facts' },
    l.address && h('span', {}, icon('pin'), l.address + (l.city ? ', ' + l.city : '')),
    l.phone && h('a', { href: 'tel:' + l.phone.replace(/[^+\d]/g, '') }, icon('phone'), l.phone),
    l.email && h('a', { href: 'mailto:' + l.email }, icon('mail'), l.email));

  const links = h('div', { class: 'links' },
    siteHref && h('a', { href: siteHref, target: '_blank', rel: 'noopener' }, 'Open website', icon('ext')),
    h('a', { href: 'https://www.google.com/search?q=' + encodeURIComponent(`${l.name} ${l.city || place}`), target: '_blank', rel: 'noopener' }, 'Google', icon('ext')),
    h('a', { href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([l.name, l.address, l.city || place].filter(Boolean).join(' '))}`, target: '_blank', rel: 'noopener' }, 'Maps', icon('ext')),
    l.facebook && h('a', { href: /^https?:/.test(l.facebook) ? l.facebook : 'https://facebook.com/' + l.facebook, target: '_blank', rel: 'noopener' }, 'Facebook', icon('ext')),
    h('a', { href: l.osm, target: '_blank', rel: 'noopener' }, 'OSM listing', icon('ext')));

  const verdict = h('section', { class: 'verdict tone-' + STATUS[s].tone },
    h('div', { class: 'verdict-head' },
      chip(s),
      a?.analysis?.kind === 'live' ? meter(a.analysis.score) : null),
    h('p', { class: 'verdict-note' }, c.override ? (c.override === 'none' ? 'You confirmed this business has no website.' : 'You marked this business as having a good website.') : a?.note || (l.website ? `Listed website: ${hostOf(l.website)}. Not checked yet.` : 'No website on the map listing. Run a check to search for one.')),
    a && h('p', { class: 'meta' }, [
      a.source === 'discovered' && a.how && `Found via ${a.how[0].toLowerCase() + a.how.slice(1)} · ${Math.round((a.confidence || 0) * 100)}% match${a.signals?.length ? ' (' + a.signals.join(', ') + ')' : ''}`,
      a.analysis?.title && `“${a.analysis.title}”`,
      a.archivedSince && `Online since ${a.archivedSince}`,
      `Checked ${timeAgo(a.checkedAt)}`,
    ].filter(Boolean).join(' · ')),
    a?.analysis?.tech?.length ? h('div', { class: 'tech' }, a.analysis.tech.map(t => h('span', { class: 'tag' }, t))) : null,
    h('div', { class: 'row' },
      h('button', { class: 'btn', disabled: checking.has(l.id), onclick: () => runAudit(l) }, icon('scan', checking.has(l.id) ? 'spin' : ''), a ? 'Re-check' : 'Check website'),
      siteHref && a?.analysis && h('button', { class: 'btn ghost', id: 'psi', onclick: () => runPsi(l, siteHref) }, icon('bolt'), 'Lighthouse audit')));

  const checks = a?.analysis?.checks?.length ? h('section', { class: 'checks' },
    h('h3', {}, 'Website audit'),
    h('ul', {}, a.analysis.checks.map(ch => h('li', { class: ch.pass === null ? 'na' : ch.pass ? 'ok' : 'bad' },
      icon(ch.pass === null ? 'na' : ch.pass ? 'pass' : 'fail'),
      h('span', {}, h('b', {}, ch.label), h('small', {}, ch.detail)))))) : null;

  const psi = a?.psi ? h('section', { class: 'psi' }, h('h3', {}, 'Lighthouse (mobile)'),
    h('div', { class: 'psi-grid' }, Object.entries(a.psi).map(([k, v]) => h('div', { class: 'psi-cell ' + (v >= 90 ? 'good' : v >= 50 ? 'warn' : 'bad') }, h('b', {}, v), h('small', {}, k.replace('-', ' ')))))) : null;

  const tried = a?.tried?.length ? h('details', { class: 'tried' }, h('summary', {}, `Domains searched (${a.tried.length})`),
    h('ul', {}, a.tried.map(t => h('li', {}, h('code', {}, t.host), ' — ', t.result)))) : null;

  const pipeline = h('section', { class: 'pipeline' },
    h('h3', {}, 'Pipeline'),
    h('div', { class: 'row' },
      h('select', { 'aria-label': 'Stage', onchange: e => { crm.set(l.id, { ...c, stage: e.target.value }); render(); } },
        Object.entries(STAGES).map(([k, v]) => h('option', { value: k, selected: (c.stage || 'new') === k }, v))),
      h('select', { 'aria-label': 'Manual website status', onchange: e => { crm.set(l.id, { ...c, override: e.target.value }); render(); } },
        h('option', { value: '', selected: !c.override }, 'Use automatic check'),
        h('option', { value: 'none', selected: c.override === 'none' }, 'I confirmed: no website'),
        h('option', { value: 'good', selected: c.override === 'good' }, 'I confirmed: good website'))),
    h('textarea', { class: 'notes', placeholder: 'Notes — what you noticed, who you spoke to…', rows: 2, onchange: e => crm.set(l.id, { ...(crm.get(l.id) || {}), notes: e.target.value }) }, c.notes || ''));

  const set = settings.get();
  const draft = draftEmail(l, a, s, set);
  const ta = h('textarea', { class: 'email', rows: 14, 'aria-label': 'Email draft' }, draft.text);
  const email = h('section', { class: 'compose' },
    h('h3', {}, 'Email draft'),
    h('p', { class: 'meta' }, 'Attach your ideas for the site before sending.'),
    ta,
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: async e => { await copy(ta.value); flash(e.currentTarget, 'Copied'); } }, icon('copy'), 'Copy'),
      h('button', { class: 'btn ghost', onclick: () => { const [subj, ...rest] = ta.value.split('\n'); location.href = `mailto:${l.email || ''}?subject=${encodeURIComponent(subj.replace(/^Subject:\s*/, ''))}&body=${encodeURIComponent(rest.join('\n').trim())}`; } }, icon('mail'), 'Open in mail'),
      h('button', { class: 'linkish', onclick: openSettings }, 'Edit name & prices')));

  box.replaceChildren(
    h('div', { class: 'detail-head' },
      h('button', { class: 'back', onclick: () => document.body.classList.remove('detail-open') }, '← Back'),
      h('h2', {}, l.name),
      h('p', { class: 'sub' }, [l.category, l.brand && 'Chain / franchise', l.hours].filter(Boolean).join(' · ')),
      facts, links),
    ...[verdict, psi, checks, tried, pipeline, email].filter(Boolean));
}

const archiveAsked = new Set();
function lookupArchive(l) {
  const a = audit(l);
  if (!a?.host || a.archivedSince !== undefined || archiveAsked.has(l.id) || !['modern', 'aging', 'outdated', 'protected', 'possible', 'broken', 'placeholder'].includes(a.status)) return;
  archiveAsked.add(l.id);
  firstArchived(a.host).then(since => { audits.set(l.id, { ...audit(l), archivedSince: since }); renderDetail(true); });
}

function meter(score) {
  return h('div', { class: 'meter', title: `Outdated score ${score}/100` },
    h('span', { class: 'meter-bar' }, h('span', { style: `width:${score}%` })),
    h('span', { class: 'meter-n' }, score, h('small', {}, '/100 outdated')));
}

function timeAgo(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const t = h('textarea', {}, text); document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
}
function flash(btn, text) {
  const old = btn.lastChild.textContent;
  btn.lastChild.textContent = text;
  setTimeout(() => { btn.lastChild.textContent = old; }, 1400);
}

// ---------- map ----------
const TONE_COLOR = () => {
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(['hot', 'bad', 'warn', 'mild', 'good', 'muted'].map(t => [t, cs.getPropertyValue('--' + t).trim()]));
};

function initMap() {
  if (!window.L) { $('#map').classList.add('off'); return; }
  map = L.map('map', { zoomControl: false, attributionControl: true }).setView([26.36, -80.1], 12);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  setTiles();
  markers = L.layerGroup().addTo(map);
}
let tiles;
function setTiles() {
  if (!map) return;
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  if (tiles) tiles.remove();
  tiles = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`, {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);
}

function renderMap() {
  if (!map) return;
  const colors = TONE_COLOR();
  const shown = new Set(visible().map(l => l.id));
  markers.clearLayers();
  markerById.clear();
  for (const l of leads) {
    if (!shown.has(l.id)) continue;
    const tone = STATUS[statusOf(l)].tone;
    const m = L.circleMarker([l.lat, l.lon], {
      radius: l.id === selected ? 9 : 6, weight: l.id === selected ? 3 : 1.5,
      color: l.id === selected ? colors.hot : 'rgba(0,0,0,.35)', fillColor: colors[tone], fillOpacity: 0.9,
    }).bindTooltip(`${l.name} — ${STATUS[statusOf(l)].label}`, { direction: 'top', offset: [0, -6] });
    m.on('click', () => { select(l.id, true); document.querySelector(`.lead[data-id="${CSS.escape(l.id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
    m.addTo(markers);
    markerById.set(l.id, m);
  }
}

// ---------- actions ----------
async function runAudit(l) {
  if (checking.has(l.id)) return;
  checking.add(l.id);
  render();
  try {
    const prev = audits.get(l.id);
    const result = await auditLead(l, $('#place').value, s => { stages.set(l.id, s); render(); });
    if (prev?.psi && prev.host === result.host) result.psi = prev.psi;
    audits.set(l.id, result);
  } catch (e) {
    audits.set(l.id, { status: 'unknown', v: AUDIT_VERSION, note: 'Check failed: ' + e.message, checkedAt: new Date().toISOString() });
  } finally {
    checking.delete(l.id);
    stages.delete(l.id);
    render();
  }
}

async function runPsi(l, url) {
  const btn = $('#psi');
  btn.disabled = true;
  btn.lastChild.textContent = 'Running Lighthouse (≈30 s)…';
  try {
    const psi = await pageSpeed(url, settings.get().psiKey);
    audits.set(l.id, { ...audits.get(l.id), psi });
  } catch (e) {
    toast(`Lighthouse failed: ${e.message}${settings.get().psiKey ? '' : '. Add a free PageSpeed API key in Settings.'}`);
  }
  render();
}

async function scanAll() {
  if (scan) { scan.cancel = true; return; }
  // Leads with a listed website need one page load, so do those first for quick answers.
  const queue = visible().filter(l => !audit(l) || ['unknown', 'likely-none'].includes(statusOf(l)))
    .sort((a, b) => Number(!a.website) - Number(!b.website));
  if (!queue.length) { toast('Every visible lead has already been checked. Use the row buttons to re-check.'); return; }
  scan = { cancel: false, done: 0, total: queue.length, started: Date.now() };
  updateScanUi();
  const worker = async () => {
    while (queue.length && !scan.cancel) {
      await runAudit(queue.shift());
      scan.done++;
      updateScanUi();
    }
  };
  const ticker = setInterval(updateScanUi, 1000);
  await Promise.all(Array.from({ length: WORKERS }, worker));
  clearInterval(ticker);
  const cancelled = scan.cancel;
  scan = null;
  updateScanUi();
  toast(cancelled ? 'Scan stopped.' : 'Scan complete.');
}

function updateScanUi() {
  const btn = $('#scan');
  const bar = $('#progress');
  if (scan) {
    btn.lastChild.textContent = `Stop (${scan.done}/${scan.total})`;
    btn.classList.add('running');
    bar.hidden = false;
    bar.firstElementChild.style.width = `${Math.max(2, (scan.done / scan.total) * 100)}%`;
    const info = $('#scan-info');
    info.hidden = false;
    const secs = (Date.now() - scan.started) / 1000;
    const left = scan.done ? Math.round((secs / scan.done) * (scan.total - scan.done) / 60) : null;
    const svc = serviceStatus();
    proxyMode().then(mode => {
      info.textContent = [
        `${scan.done} of ${scan.total} checked · ${Math.min(WORKERS, scan.total - scan.done)} in progress`,
        left != null ? `about ${left < 1 ? '<1' : left} min left` : 'estimating time…',
        mode === 'Public proxies'
          ? `using free public proxies${svc.engines.length ? '' : ' · web search blocked, results marked “unconfirmed”'} — run locally (npm start) for faster, more accurate checks`
          : mode.toLowerCase(),
      ].join(' · ');
    });
  } else {
    btn.lastChild.textContent = 'Check all websites';
    btn.classList.remove('running');
    bar.hidden = true;
    $('#scan-info').hidden = true;
  }
}

function exportCsv() {
  const cols = ['Name', 'Category', 'Address', 'Phone', 'Email', 'Website', 'Website status', 'Outdated score', 'Opportunity', 'Top issues', 'Stage', 'Notes', 'OSM'];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [cols.join(',')];
  for (const l of visible()) {
    const a = audit(l);
    const c = crm.get(l.id) || {};
    lines.push([l.name, l.category, [l.address, l.city].filter(Boolean).join(', '), l.phone, l.email, a?.url || l.website, STATUS[statusOf(l)].label,
      a?.analysis?.score ?? '', opportunity(l), (a?.analysis?.checks || []).filter(x => x.pass === false).map(x => x.label).join('; '),
      STAGES[c.stage || 'new'], c.notes, l.osm].map(esc).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `local-leads-${$('#place').value.split(',')[0].trim().toLowerCase().replace(/\W+/g, '-')}.csv` });
  document.body.append(a); a.click(); a.remove();
}

async function search(e) {
  e?.preventDefault();
  const place = $('#place').value.trim();
  if (!place) return toast('Enter a location.');
  ui.patch({ place, kind: $('#kind').value, radius: $('#radius').value });
  const btn = $('#go');
  btn.disabled = true;
  btn.textContent = 'Searching…';
  $('#leads').replaceChildren(...Array.from({ length: 6 }, () => h('li', { class: 'skeleton' })));
  try {
    const { geo, leads: found } = await searchBusinesses(place, $('#kind').value, $('#radius').value);
    leads = found;
    selected = null;
    if (map) {
      map.setView([geo.lat, geo.lon], 13);
      if (leads.length) map.fitBounds(leads.map(l => [l.lat, l.lon]), { padding: [24, 24], maxZoom: 15 });
    }
    // distance order is the natural "distance" sort
    leads.sort((a, b) => ((a.lat - geo.lat) ** 2 + (a.lon - geo.lon) ** 2) - ((b.lat - geo.lat) ** 2 + (b.lon - geo.lon) ** 2));
    try { sessionStorage.setItem('ll.lastResults', JSON.stringify({ place, leads })); } catch { /* quota */ }
    toast(`${leads.length} businesses found. ${leads.filter(l => !l.website).length} have no website listed.`);
  } catch (err) {
    leads = [];
    toast('Search unavailable: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Find leads';
    render();
  }
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
}

// ---------- settings & theme ----------
function openSettings() {
  const s = settings.get();
  const d = $('#settings');
  for (const k of ['sender', 'yourName', 'buildPrice', 'yearlyPrice', 'proxy', 'psiKey']) d.querySelector(`[name=${k}]`).value = s[k] || '';
  proxyMode().then(m => { $('#proxy-mode').textContent = m; });
  d.showModal();
}

function applyTheme() {
  const t = settings.get().theme;
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  setTiles();
  render();
}

// ---------- boot ----------
function boot() {
  const kind = $('#kind');
  kind.replaceChildren(...Object.entries(CATEGORIES).map(([k, [label]]) => h('option', { value: k }, label)));
  const u = ui.get();
  $('#place').value = u.place;
  kind.value = CATEGORIES[u.kind] ? u.kind : 'all';
  $('#radius').value = u.radius;

  $('#search-form').addEventListener('submit', search);
  $('#scan').addEventListener('click', scanAll);
  $('#export').addEventListener('click', exportCsv);
  for (const id of ['#q', '#sort', '#stage']) $(id).addEventListener('input', render);
  $('#open-settings').addEventListener('click', openSettings);
  $('#theme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    settings.patch({ theme: cur === 'dark' ? 'light' : 'dark' });
    applyTheme();
  });
  $('#settings').addEventListener('close', () => {
    const d = $('#settings');
    if (d.returnValue !== 'save') return;
    settings.patch(Object.fromEntries(['sender', 'yourName', 'buildPrice', 'yearlyPrice', 'proxy', 'psiKey'].map(k => [k, d.querySelector(`[name=${k}]`).value.trim()])));
    render();
  });
  $('#clear-audits').addEventListener('click', () => { audits.clear(); toast('Website checks cleared.'); render(); });

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === '/') { e.preventDefault(); $('#q').focus(); }
    if (e.key === 'j' || e.key === 'k') {
      const rows = visible();
      const i = rows.findIndex(l => l.id === selected);
      const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'j' ? 1 : -1)))];
      if (next) { select(next.id); document.querySelector(`.lead[data-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: 'nearest' }); }
    }
    if (e.key === 'c' && selected) runAudit(leads.find(l => l.id === selected));
  });

  initMap();
  applyTheme();
  try {
    const last = JSON.parse(sessionStorage.getItem('ll.lastResults'));
    if (last?.leads?.length && last.place === u.place) {
      leads = last.leads;
      if (map) map.fitBounds(leads.map(l => [l.lat, l.lon]), { padding: [24, 24], maxZoom: 15 });
    }
  } catch { /* nothing cached */ }
  render();
}

boot();
