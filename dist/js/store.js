// localStorage-backed persistence. Every access is guarded: private windows and
// blocked storage must not break the app.

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

function bucket(key, fallback = {}) {
  let data = load(key, fallback);
  return {
    get: id => (id === undefined ? data : data[id]),
    set(id, value) {
      if (value === undefined) delete data[id]; else data[id] = value;
      save(key, data);
    },
    patch(value) { data = { ...data, ...value }; save(key, data); },
    clear() { data = { ...fallback }; save(key, data); },
  };
}

export const audits = bucket('ll.audits');   // leadId → audit result
export const crm = bucket('ll.crm');         // leadId → {stage, notes, override}
export const settings = bucket('ll.settings', { sender: '', yourName: '', proxy: '', psiKey: '', theme: '' });
export const ui = bucket('ll.ui', { place: 'Boca Raton, Florida', kind: 'all', radius: '5000' });

// Migrate manual reviews from the previous version of the app.
const legacy = load('leadReviews', null);
if (legacy) {
  for (const [id, v] of Object.entries(legacy)) {
    if (!crm.get(id)) crm.set(id, { stage: 'new', notes: '', override: v === 'verified' ? 'none' : v === 'website' ? 'good' : '' });
  }
  try { localStorage.removeItem('leadReviews'); } catch { /* ignore */ }
}
