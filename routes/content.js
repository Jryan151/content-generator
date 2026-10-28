// routes/content.js — Smart Content: automatic links, a fit check on every link, ✦ Generate.
// Split out of server.js by area (v15). server.js mounts it, passing in the helpers these routes share
// with the rest of the server; the capability each route needs is still listed in one place
// (server.js ROUTE_CAPS). The code below is as it was in server.js (not re-indented, so its text and
// templates are unchanged).
import { PRODUCT_NAME } from '../lib/paths.js';
import * as store from '../lib/store.js';
import * as usage from '../lib/usage.js';
import * as insights from '../lib/insights.js';
import { migrate, usableRoutes, styleCalibration, linkChecks, linkKey, textKey } from '../mixer-core.js';

export default function mount(ctx) {
const { api, autoPlanState, bad, clip, coach, coachGate, content, enqueueVideos, fitSig, jobView, nextPlanMonday, nowIso, route, workingConfig } = ctx;
// Saves link verdicts onto the saved config (only for links that still exist with the same texts),
// so a later save from a portal that hasn't seen them yet doesn't drop them.
function saveFit(wsId, fit) {
  if (!Object.keys(fit).length) return store.loadConfig(wsId).story.fit;
  const cfg = store.loadConfig(wsId);
  cfg.story.fit = { ...cfg.story.fit, ...fit };
  return store.saveConfig(wsId, migrate(cfg), { history: false }).story.fit;
}
const signFit = fit => Object.fromEntries(Object.entries(fit || {}).map(([k, v]) => [k, { ...v, g: fitSig(k, v) }]));
// Links whose check failed are tried again after a while, not on every save.
const fitTried = new Map();
// Links for one new item, in every direction (only pairs that clearly fit), already checked.
route('POST', '/api/content/autolink', 'ws', async ({ wsId, ws, body, me }) => {
  const kind = clip(body.kind, 20);
  if (!['audiences', 'painPoints', 'insights', 'solutions'].includes(kind)) bad(400, 'Pick what to link.');
  const cfg = workingConfig(wsId, body, me);
  const item = cfg.story[kind].find(x => x.id === clip(body.id, 40));
  if (!item || !item.text.trim()) bad(400, 'Write it first, then it can be linked.');
  coachGate(wsId, ws);
  const { autoLink } = await content();
  const r = await autoLink(cfg, kind, item, usage.meter(wsId));
  return { ...r, fit: signFit(r.fit) };
});
// The fit check: judges links that have no current verdict (new, or a text changed), up to 75 a call.
// Returns only the new verdicts (signed); the portal merges them into what it has.
route('POST', '/api/content/relevance', 'ws', async ({ wsId, ws, body, me }) => {
  const cfg = workingConfig(wsId, body, me);
  const { linksToJudge, judgeLinks } = await content();
  const now = Date.now(), retry = body.manual ? 0 : 6 * 3600000;
  const todo = linksToJudge(cfg).filter(l => !(now - (fitTried.get(`${wsId}:${l.key}`) || 0) < retry));
  if (!todo.length) return { fit: {}, judged: 0, left: 0 };
  coachGate(wsId, ws);
  todo.forEach(l => fitTried.set(`${wsId}:${l.key}`, now));
  if (fitTried.size > 50000) fitTried.clear();
  const fit = signFit(await judgeLinks(cfg, todo, usage.meter(wsId)));
  // Verdicts go onto the saved config only for links it also has; unsaved ones come back to the portal.
  const saved = store.loadConfig(wsId);
  const savedKeys = new Map(linkChecks(saved).map(l => [l.key, textKey(l.child.text, l.parent.text)]));
  saveFit(wsId, Object.fromEntries(Object.entries(fit).filter(([k, v]) => savedKeys.get(k) === v.k)));
  return { fit, judged: Object.keys(fit).length, left: Math.max(0, linksToJudge({ ...cfg, story: { ...cfg.story, fit: { ...cfg.story.fit, ...fit } } }).length) };
});
// Link everything: proposed missing links for the agent to tick and apply.
route('POST', '/api/content/link-all', 'ws', async ({ wsId, ws, body, me }) => {
  const cfg = workingConfig(wsId, body, me);
  coachGate(wsId, ws);
  const { linkEverything } = await content();
  const r = await linkEverything(cfg, usage.meter(wsId));
  return { add: r.add.map(a => ({ ...a, fit: signFit({ [linkKey(a.id, a.pid)]: a.fit })[linkKey(a.id, a.pid)] })) };
});
// ✦ Generate: three checked options for a fact, worry, audience, solution or call to action.
route('POST', '/api/content/generate', 'ws', async ({ wsId, ws, body, me }) => {
  const kind = clip(body.kind, 20);
  const cfg = workingConfig(wsId, body, me);
  // Checked before anything is spent: what to write, and what it's for, must exist.
  if (!['insights', 'painPoints', 'audiences', 'solutions', 'cta'].includes(kind)) bad(400, 'Pick what to generate.');
  if (kind === 'insights' && !cfg.story.painPoints.some(p => p.id === body.painId)) bad(400, 'Pick the worry the facts should answer.');
  if (kind === 'solutions' && !cfg.story.insights.some(i => i.id === body.factId)) bad(400, 'Pick the fact the solution follows from.');
  coachGate(wsId, ws);
  const { generateItems } = await content();
  try { return { options: await generateItems(cfg, kind, { painId: clip(body.painId, 40), audienceId: clip(body.audienceId, 40), factId: clip(body.factId, 40) }, usage.meter(wsId)) }; }
  catch (e) { if (e.user) bad(400, e.message); throw e; }
});

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
