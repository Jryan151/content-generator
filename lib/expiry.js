// lib/expiry.js — the expiry calendar: everything the app depends on that runs out on a date, in one list,
// with a warning 90, 30 and 7 days ahead (one alert at each, never a daily drip).
//
//   Node.js          security fixes stop on a known date for each major version
//   Meta's API       the Graph API version Instagram and Facebook are called with (after it expires, Meta
//                    quietly answers with the next version: things change without an error)
//   AI models        shutdown dates the AI companies publish (read daily by lib/ai.js)
//   Instagram        each agent's connection, if it isn't renewing itself
//   Cards on file    each paying agent's card (its expiry month, from Stripe)
//   The certificate  your site's HTTPS certificate (PUBLIC_URL)
//
// Shown in Admin → Engine bay and `node admin.js calendar`. Dates for Node and Meta are from their
// published schedules (checked October 2026); a version not in the table shows "check the schedule".
import path from 'path';
import tls from 'tls';
import { DIRS, readJSON, writeJSON, PUBLIC_URL } from './paths.js';
import * as store from './store.js';
import { notify } from './alerts.js';
import { overview as aiOverview } from './ai.js';

const DAY = 86400000;
export const NODE_EOL = { 18: '2025-04-30', 20: '2026-04-30', 22: '2027-04-30', 24: '2028-04-30', 26: '2029-04-30' };
export const META_EOL = { 'v25.0': '2028-07-29' };
const STATE = () => path.join(DIRS.data, 'expiry.json');
const THRESHOLDS = [90, 30, 7];
const daysTo = (date, now) => Math.ceil((Date.parse(`${date}T00:00:00Z`) - now) / DAY);

// The HTTPS certificate's end date (checked once a day; kept in data/expiry.json).
export function certEnd({ url = PUBLIC_URL, timeoutMs = 10000 } = {}) {
  return new Promise(resolve => {
    let u;
    try { u = new URL(url); } catch { return resolve(null); }
    if (u.protocol !== 'https:') return resolve(null);
    const s = tls.connect({ host: u.hostname, port: Number(u.port) || 443, servername: u.hostname, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const c = s.getPeerCertificate();
      s.end();
      resolve(c?.valid_to ? { date: new Date(c.valid_to).toISOString().slice(0, 10), issuer: c.issuer?.O || c.issuer?.CN || '' } : null);
    });
    s.on('error', () => resolve(null));
    s.on('timeout', () => { s.destroy(); resolve(null); });
  });
}

// The calendar, soonest first: [{ id, what, date, days, action, ws?, level }].
export function calendar(now = Date.now()) {
  const items = [];
  const add = (id, what, date, action, extra = {}) => { if (!date) return; const days = daysTo(date, now); items.push({ id, what, date, days, action, level: days <= 7 ? 'error' : days <= 30 ? 'warning' : days <= 90 ? 'soon' : '', ...extra }); };
  const major = Number(process.versions.node.split('.')[0]);
  if (NODE_EOL[major]) add('node', `Node.js ${major} (security fixes end)`, NODE_EOL[major], `Move to Node ${major + 2} after testing: SETUP.md section AO.`);
  else items.push({ id: 'node', what: `Node.js ${major}`, date: '', days: null, action: 'Not in the table: check nodejs.org/en/about/previous-releases.', level: '' });
  for (const [who, envName] of [['Instagram', 'INSTAGRAM_API_VERSION'], ['Facebook', 'FACEBOOK_API_VERSION']]) {
    const v = process.env[envName] || 'v25.0';
    if (META_EOL[v]) add(`meta-${who.toLowerCase()}`, `${who}’s API version ${v}`, META_EOL[v], `Test the next version (${envName} in .env on a spare server), then switch: SETUP.md section AO.`);
    else items.push({ id: `meta-${who.toLowerCase()}`, what: `${who}’s API version ${v}`, date: '', days: null, action: 'Not in the table: check developers.facebook.com/docs/graph-api/changelog.', level: '' });
  }
  try {
    // Each job's first choice (a backup's shutdown matters once it's in use, and lib/ai.js warns then).
    const seen = new Set();
    for (const j of aiOverview()) { const r = j.rungs.find(x => x.on); if (r?.shutdownDate && !seen.has(r.key)) { seen.add(r.key); add(`model-${r.key}`, `${r.model} (${j.label})`, r.shutdownDate, 'The app moves on by itself; to choose the replacement: SETUP.md section AK.'); } }
  } catch { /* the AI list is optional here */ }
  for (const w of store.listWorkspaces()) {
    if (w.suspended) continue;
    const igAcc = readJSON(path.join(store.wsDir(w.id), 'instagram.json'), null);
    // A connection renews itself 20 days ahead; one still close to its end isn't renewing.
    if (igAcc?.expiresAt && !igAcc.problem && Date.parse(igAcc.expiresAt) - now < 15 * DAY) add(`ig-${w.id}`, `${w.name}: Instagram connection`, igAcc.expiresAt.slice(0, 10), 'It should renew itself; if not, the agent connects again in Setup → Autopilot.', { ws: w.id });
    const card = w.billing?.card;
    if (card?.exp && ['active', 'trialing', 'past_due'].includes(w.billing?.status)) {
      const [y, m] = card.exp.split('-').map(Number);
      add(`card-${w.id}`, `${w.name}: card ${card.brand ? card.brand + ' ' : ''}…${card.last4}`, new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10), 'The agent updates their card in Billing.', { ws: w.id });
    }
  }
  const st = readJSON(STATE(), {}) || {};
  if (st.cert?.date) add('cert', `HTTPS certificate (${st.cert.issuer || 'your site'})`, st.cert.date, 'It should renew itself (certbot renew --dry-run checks it).');
  return items.sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9));
}

// Daily: refresh the certificate date, then one alert for each item crossing 90, 30 or 7 days.
export async function checkExpiry(now = Date.now(), { cert = certEnd } = {}) {
  const st = readJSON(STATE(), {}) || {};
  const c = await cert().catch(() => null);
  if (c) st.cert = { ...c, checkedAt: new Date(now).toISOString() };
  writeJSON(STATE(), st);
  // sent[id] = { t, date }: the last threshold alerted for that date (a new date, say a renewed
  // certificate or a new card, starts again).
  const sent = { ...(st.sent || {}) }, items = calendar(now);
  for (const it of items) {
    if (it.days == null) continue;
    const t = THRESHOLDS.filter(x => it.days <= x).sort((a, b) => a - b)[0];
    if (!t) continue;
    const was = sent[it.id];
    if (was && was.date === it.date && was.t <= t) continue;
    sent[it.id] = { t, date: it.date };
    notify({ level: it.days <= 7 ? 'error' : 'warning', kind: 'server', title: it.days < 0 ? `Expired: ${it.what}` : `${it.what} runs out in ${it.days} day${it.days === 1 ? '' : 's'}`, text: `On ${it.date}.`, did: 'Nothing yet: this is the warning ahead of time.', run: it.action, ws: it.ws || '' }, now);
  }
  writeJSON(STATE(), { ...st, sent });
  return items;
}
