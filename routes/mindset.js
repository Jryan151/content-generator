// routes/mindset.js — Mindset: the agent working on themselves, and the parts that shape their videos.
// Split out of server.js by area (v15). server.js mounts it, passing in the helpers these routes share
// with the rest of the server; the capability each route needs is still listed in one place
// (server.js ROUTE_CAPS). The code below is as it was in server.js (not re-indented, so its text and
// templates are unchanged).
import * as store from '../lib/store.js';
import * as usage from '../lib/usage.js';
import * as mc from '../mindset-core.js';
import * as audit from '../lib/audit.js';
import * as today from '../lib/today.js';
import { migrate } from '../mixer-core.js';

export default function mount(ctx) {
const { api, bad, clientsLib, clip, coach, coachGate, mindset, route, todayFor } = ctx;
// Everything the tab shows, computed here so the score and streaks match on every device.
async function mindsetView(wsId) {
  const cfg = store.loadConfig(wsId), M = await mindset(), C = await clientsLib(), m = M.read(wsId), videos = store.readVideos(wsId);
  const today = todayFor(cfg), tz = cfg.profile?.timezone, off = cfg.profile?.daysOff || [];
  const offset = m.principles.offsets[today] || 0, pr = mc.principleFor(today, offset);
  const posted = videos.filter(v => v.status === 'posted');
  const byPrinciple = Object.keys(mc.PERSUASION).map(id => ({ id, label: mc.PERSUASION[id].label, videos: posted.filter(v => (v.meta?.principles || []).includes(id)).length, messages: posted.filter(v => (v.meta?.principles || []).includes(id)).reduce((a, v) => a + (v.results?.messages || 0), 0) })).filter(x => x.videos);
  return {
    today, week: mc.weekOf(today), mindset: m, profile: cfg.mindset,
    principle: { ...pr, book: mc.BOOKS[pr.book], n: mc.PRINCIPLES.indexOf(pr) + 1, of: mc.PRINCIPLES.length, done: m.principles.done.some(d => d.date === today && d.id === pr.id) },
    score: mc.growthScore(m, videos, { today, tz, off }), scoreWeekAgo: mc.growthScore(m, videos, { today, tz, asOf: 7, off }),
    dayOff: off.includes(new Date(`${today}T12:00:00Z`).getUTCDay()),
    streaks: Object.fromEntries(m.habits.filter(h => !h.auto).map(h => [h.id, { streak: mc.streak(m.checks[h.id], today, off), today: (m.checks[h.id] || []).includes(today), missedOnce: mc.missedOnce(m.checks[h.id], today, off) }])),
    autos: Object.fromEntries(m.habits.filter(h => h.auto).map(h => [h.id, mc.autoProgress(h, videos, today, tz)])),
    levels: Object.fromEntries(Object.keys(mc.SKILLS).map(k => [k, mc.skillLevel(m.practice.filter(p => p.skill === k).length, m.skills[k])])),
    // Relationship notes are clients; leads live on the Desk.
    clients: C.list(wsId).filter(c => !c.stage || c.stage === 'client'), due: C.dueToday(wsId, today).filter(d => { const c = C.get(wsId, d.id); return !c?.stage || c.stage === 'client'; }), contentPrinciples: byPrinciple,
  };
}
route('GET', '/api/mindset', 'ws', ({ wsId }) => mindsetView(wsId));
// Saves one part of the tab: a records section, or the profile parts that shape videos (in the config).
const MINDSET_SECTIONS = ['identity', 'habits', 'skills', 'mentor', 'strategy', 'closer', 'rival'];
route('PUT', '/api/mindset', 'ws', async ({ wsId, body }) => {
  const M = await mindset();
  let warnings = [];
  if (body.profile && typeof body.profile === 'object') {
    const cfg = store.loadConfig(wsId);
    cfg.mindset = { ...cfg.mindset, ...body.profile };
    const saved = store.saveConfig(wsId, migrate(cfg), { history: false });
    // The why and objections reach prompts, so anything the rules would block is pointed out now
    // (every script is still checked; this just says it early).
    const { replyProblems } = await coach();
    const w = saved.mindset.why;
    warnings = [...[w.why, w.how, w.what].filter(Boolean).map(t => [t, replyProblems(t, saved)]), ...saved.mindset.objections.filter(o => o.topic).map(o => [o.text, replyProblems(o.text, saved)])]
      .filter(([, p]) => p.length).map(([t, p]) => `“${t.slice(0, 60)}” has ${p.join(', ')}. Videos won’t use that wording.`);
  }
  const parts = Object.entries(body).filter(([k]) => MINDSET_SECTIONS.includes(k));
  if (parts.length) M.update(wsId, m => ({ ...m, ...Object.fromEntries(parts) }));
  return { ...(await mindsetView(wsId)), warnings };
});
route('POST', '/api/mindset/check', 'ws', async ({ wsId, body }) => {
  const M = await mindset(), today = todayFor(store.loadConfig(wsId)), id = clip(body.habitId, 40);
  // `done` says what the box shows, so a double tap or a second device can't flip it the wrong way.
  M.update(wsId, m => { if (!m.habits.some(h => h.id === id && !h.auto)) bad(404, 'Habit not found.'); const d = (m.checks[id] || []).filter(x => x !== today); const on = typeof body.done === 'boolean' ? body.done : !(m.checks[id] || []).includes(today); m.checks[id] = on ? [...d, today] : d; return m; });
  return mindsetView(wsId);
});
route('POST', '/api/mindset/principle', 'ws', async ({ wsId, body }) => {
  const M = await mindset(), today = todayFor(store.loadConfig(wsId));
  M.update(wsId, m => {
    const off = m.principles.offsets[today] || 0, pr = mc.principleFor(today, off);
    if (body.act === 'next') m.principles.offsets = { ...m.principles.offsets, [today]: off + 1 };
    else if (!m.principles.done.some(d => d.date === today && d.id === pr.id)) m.principles.done.push({ date: today, id: pr.id });
    return m;
  });
  return mindsetView(wsId);
});
route('POST', '/api/mindset/practice', 'ws', async ({ wsId, body }) => {
  const M = await mindset();
  if (!Object.hasOwn(mc.SKILLS, String(body.skill)) || !clip(body.what, 200)) bad(400, 'Pick the skill and say what you practiced.');
  M.update(wsId, m => ({ ...m, practice: [...m.practice, { skill: body.skill, what: body.what, note: body.note, at: new Date().toISOString() }] }));
  return mindsetView(wsId);
});
route('DELETE', '/api/mindset/practice/:id', 'ws', async ({ wsId, params }) => {
  const M = await mindset();
  M.update(wsId, m => ({ ...m, practice: m.practice.filter(p => p.id !== params.id) }));
  return mindsetView(wsId);
});
route('POST', '/api/mindset/audit', 'ws', async ({ wsId, body }) => {
  const M = await mindset(), week = mc.weekOf(todayFor(store.loadConfig(wsId)));
  M.update(wsId, m => ({ ...m, audit: [...m.audit.filter(w => w.week !== week), { week, rows: body.rows }] }));
  return mindsetView(wsId);
});
route('POST', '/api/mindset/audit/advice', 'ws', async ({ wsId, ws }) => {
  const M = await mindset(), week = mc.weekOf(todayFor(store.loadConfig(wsId)));
  const rows = M.read(wsId).audit.find(w => w.week === week)?.rows || [];
  if (!rows.length) bad(400, 'Log this week’s activities first.');
  coachGate(wsId, ws);
  const { auditAdvice } = await import('../lib/lens.js');
  return { advice: await auditAdvice({ rows, meter: usage.meter(wsId) }) };
});
route('POST', '/api/mindset/reflection', 'ws', async ({ wsId, body }) => {
  const M = await mindset(), week = mc.weekOf(todayFor(store.loadConfig(wsId)));
  if (!['win', 'number', 'matched', 'change'].some(k => clip(body[k], 400))) bad(400, 'Answer at least one question.');
  M.update(wsId, m => ({ ...m, reflections: [...m.reflections.filter(r => r.week !== week), { week, win: body.win, number: body.number, matched: body.matched, change: body.change, at: new Date().toISOString() }] }));
  return mindsetView(wsId);
});
// The persuasion lens on any draft: which honest principles it uses, and any pressure.
route('POST', '/api/mindset/lens', 'ws', async ({ wsId, ws, body }) => {
  if (!clip(body.text, 3000)) bad(400, 'Paste a draft first.');
  coachGate(wsId, ws);
  const { lens } = await import('../lib/lens.js');
  return lens({ text: body.text, meter: usage.meter(wsId), cfg: store.loadConfig(wsId) });
});
// Relationship notes: the client list.
route('GET', '/api/clients', 'ws', async ({ wsId }) => { const C = await clientsLib(); return { clients: C.list(wsId), due: C.dueToday(wsId, todayFor(store.loadConfig(wsId))) }; });
// (bookedAt is the server's own: a booking is counted once, by lib/bookings.js.)
const editable = body => { const { bookedAt, ...rest } = body || {}; return rest; };
route('POST', '/api/clients', 'ws', async ({ wsId, body }) => { const C = await clientsLib(); try { return { client: C.add(wsId, editable(body)) }; } catch (e) { bad(e.status || 400, e.message); } });
route('PUT', '/api/clients/:id', 'ws', async ({ wsId, params, body }) => {
  const C = await clientsLib();
  let c;
  try { c = C.save(wsId, params.id, editable(body)) || bad(404, 'Client not found.'); } catch (e) { bad(e.status || 400, e.message); }
  // A lead from a video moved to "Appointment booked" by hand: the video counts the booking (v15).
  if (c.stage === 'booked' && c.videoId && !c.bookedAt) { const B = await import('../lib/bookings.js'); B.count(wsId, c.videoId, c.id); c = C.get(wsId, c.id); }
  return { client: c };
});
// "Reached out": marks today as the last contact and clears the reminder.
route('POST', '/api/clients/:id/reached', 'ws', async ({ wsId, params }) => { const C = await clientsLib(); return { client: C.save(wsId, params.id, { last: todayFor(store.loadConfig(wsId)), next: '' }) || bad(404, 'Client not found.') }; });
route('DELETE', '/api/clients/:id', 'ws', async ({ wsId, params }) => {
  const C = await clientsLib();
  if (!C.remove(wsId, params.id)) bad(404, 'Client not found.');
  // Their keepsakes (their name and the video made for them) go with them; one being made stops.
  const K = await import('../lib/keepsakes.js'), queue = await import('../lib/queue.js');
  K.removeFor(wsId, params.id).forEach(j => queue.cancel(wsId, j));
  return { ok: true };
});
}
