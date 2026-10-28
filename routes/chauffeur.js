// routes/chauffeur.js — Away mode and the busy week (v15 Phase 8, lib/chauffeur.js). The agent's own:
// going away and a busy week are hers to set (ROUTE_CAPS in server.js).
import * as store from '../lib/store.js';
import * as push from '../lib/push.js';
import * as chauffeur from '../lib/chauffeur.js';
import * as signoff from '../lib/signoff.js';

const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export default function mount(ctx) {
const { bad, enqueueVideos, route } = ctx;
const tzOf = wsId => store.loadConfig(wsId).profile?.timezone || 'America/Denver';
const todayOf = wsId => chauffeur.clockOf(tzOf(wsId), Date.now()).date;
// "Back on" (the day she's back) → the last day away.
const lastDay = back => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(back || ''))) bad(400, 'Pick the day you’re back.'); return addDays(back, -1); };

// What going away until then would look like: which posting days are covered, and how.
route('GET', '/api/away', 'ws', async ({ wsId, url }) => {
  const ws = store.getWorkspace(wsId), back = url.searchParams.get('back');
  let preview = null;
  if (back) {
    const until = lastDay(back), today = todayOf(wsId);
    try { chauffeur.checkUntil(until, today); } catch (e) { bad(e.status || 400, e.message); }
    preview = await chauffeur.coverPlan(wsId, { from: today, until });
  }
  return { away: ws.away || null, preview };
});
route('POST', '/api/away', 'ws', async ({ wsId, body, me }) => {
  const ws = store.getWorkspace(wsId);
  if (chauffeur.awayOn(ws, todayOf(wsId))) bad(409, 'You’re already away. Tap “I’m back” first to change it.');
  const until = lastDay(body.back);
  let r;
  try {
    r = await chauffeur.startAway(wsId, {
      until, by: me.account.id, byName: me.account.name || '',
      notify: (ids, message) => push.send(wsId, message, { tz: tzOf(wsId), accountIds: ids }).catch(() => {}),
    });
  } catch (e) { bad(e.status || 400, e.message); }
  return r;
});
// Back early: nudges start again, and the welcome back is waiting.
route('DELETE', '/api/away', 'ws', ({ wsId }) => {
  const a = chauffeur.endAway(wsId);
  if (!a) bad(404, 'You weren’t away.');
  return { away: a, welcome: chauffeur.welcomeBack(wsId) };
});
route('POST', '/api/away/welcome', 'ws', ({ wsId }) => ({ ok: chauffeur.dismissWelcome(wsId) }));

// A busy week: make what the week ahead needs, and hold the "ready" notifications for one at the end.
route('POST', '/api/busy-week', 'ws', ({ wsId, me }) => {
  const ws = store.getWorkspace(wsId), cfg = store.loadConfig(wsId), videos = store.readVideos(wsId);
  if (ws.busy && !ws.busy.notified) bad(409, 'Your busy week is already being made.');
  const { need, week } = chauffeur.busyNeed(cfg, signoff.asPlanned(ws, videos), Date.now(), { postedToday: ws.autopostDay === todayOf(wsId), max: 5 });
  const pending = videos.filter(v => v.status === 'pending').length;
  const jobs = need ? enqueueVideos(wsId, need, 'busy', me.account.id) : [];
  const busy = { since: new Date().toISOString(), by: me.account.id, jobs: jobs.map(j => j.id), pending, ...(jobs.length ? {} : { notified: new Date().toISOString(), made: 0, failed: 0 }) };
  store.updateWorkspace(wsId, { busy });
  return { busy, queued: jobs.length, need, pending, week: { short: week.short, plan: week.plan } };
});
route('DELETE', '/api/busy-week', 'ws', ({ wsId }) => { store.updateWorkspace(wsId, { busy: null }); return { ok: true }; });
}
