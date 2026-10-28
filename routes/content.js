// routes/content.js — the coach's notes, weekly check-in and plan, replies, and style calibration.
// Split out of server.js by area (v15). server.js mounts it, passing in the helpers these routes share
// with the rest of the server; the capability each route needs is still listed in one place
// (server.js ROUTE_CAPS). The code below is as it was in server.js (not re-indented, so its text and
// templates are unchanged).
import { PRODUCT_NAME } from '../lib/paths.js';
import * as store from '../lib/store.js';
import * as usage from '../lib/usage.js';
import * as insights from '../lib/insights.js';
import { migrate, usableRoutes, styleCalibration } from '../mixer-core.js';

export default function mount(ctx) {
const { api, autoPlanState, bad, clip, coach, coachGate, enqueueVideos, jobView, nextPlanMonday, nowIso, route, workingConfig } = ctx;
// What the coach remembers about how this agent works.
route('GET', '/api/coach/notes', 'ws', ({ wsId }) => ({ notes: store.readNotes(wsId) }));
route('POST', '/api/coach/notes', 'ws', ({ wsId, body }) => {
  const note = store.addNote(wsId, body.text, body.kind);
  if (!note) bad(400, 'Write the note first.');
  return { note, notes: store.readNotes(wsId) };
});
route('DELETE', '/api/coach/notes/:id', 'ws', ({ wsId, params }) => { store.removeNote(wsId, params.id); return { notes: store.readNotes(wsId) }; });

// The weekly check-in: how it's going, one focus, and a plan of videos to approve.
route('GET', '/api/coach/weekly', 'ws', async ({ wsId }) => {
  const { weekKey } = await coach();
  const w = store.readWeekly(wsId);
  return { weekly: w, current: !!w && w.week === weekKey() };
});
route('POST', '/api/coach/weekly', 'ws', async ({ wsId, ws }) => {
  if (!ws.onboarded) bad(409, 'Finish setup first.');
  coachGate(wsId, ws);
  const { weeklyCheckin } = await coach();
  const w = await weeklyCheckin({ product: PRODUCT_NAME, cfg: store.loadConfig(wsId), videos: store.readVideos(wsId), recent: store.readRecent(wsId), notes: store.readNotes(wsId), meter: usage.meter(wsId) });
  return { weekly: store.saveWeekly(wsId, w), current: true };
});
// Skip (or un-skip) the next automatic Monday plan.
route('POST', '/api/coach/plan/skip', 'ws', ({ wsId, body }) => {
  const cfg = store.loadConfig(wsId);
  store.updateWorkspace(wsId, { autoPlanSkip: body.skip === false ? '' : nextPlanMonday(wsId, cfg) });
  return { plan: autoPlanState(wsId, cfg) };
});
route('POST', '/api/coach/plan', 'ws', ({ wsId, body, me }) => {
  const cfg = store.loadConfig(wsId), U = usableRoutes(cfg);
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 5)
    .filter(x => x && U.pains.some(p => p.id === x.painId) && cfg.output.formats.includes(x.format));
  if (!items.length) bad(400, 'Pick at least one video from the plan.');
  const jobs = [];
  for (const x of items) {
    try { jobs.push(...enqueueVideos(wsId, 1, 'plan', me.account.id, { painId: x.painId, format: x.format })); }
    catch (e) { if (!jobs.length) throw e; break; }
  }
  const w = store.readWeekly(wsId);
  if (w) store.saveWeekly(wsId, { ...w, queuedAt: nowIso() });
  return { jobs: jobs.map(jobView) };
});

// Replies to comments and DMs, inside the compliance rules.
// audienceId (optional): which audience the sender belongs to. The style read is kept, so after
// enough messages Communicate can say how each audience's real messages read (style calibration).
route('POST', '/api/coach/reply', 'ws', async ({ wsId, ws, body }) => {
  coachGate(wsId, ws);
  const { draftReplies } = await coach();
  const cfg = store.loadConfig(wsId);
  let out;
  try { out = await draftReplies({ cfg, message: body.message, note: body.note, meter: usage.meter(wsId) }); }
  catch (e) { if (/Paste/.test(e.message)) bad(400, e.message); throw e; }
  const aud = cfg.story.audiences.find(a => a.id === clip(body.audienceId, 40));
  if (aud && out.style) store.addStyleRead(wsId, { audienceId: aud.id, style: out.style });
  return { ...out, logged: !!(aud && out.style) };
});
route('GET', '/api/comms/calibration', 'ws', ({ wsId }) => ({ calibration: styleCalibration(store.loadConfig(wsId).story.audiences, store.readStyleReads(wsId)) }));
}
