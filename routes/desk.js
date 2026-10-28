// routes/desk.js — The Desk: today's list, handoffs, leads, client care, activity.
// Split out of server.js by area (v15). server.js mounts it, passing in the helpers these routes share
// with the rest of the server; the capability each route needs is still listed in one place
// (server.js ROUTE_CAPS). The code below is as it was in server.js (not re-indented, so its text and
// templates are unchanged).
import * as store from '../lib/store.js';
import * as audit from '../lib/audit.js';
import * as roles from '../lib/roles.js';
import * as desk from '../lib/desk.js';
import * as today from '../lib/today.js';
import * as push from '../lib/push.js';
import * as usage from '../lib/usage.js';
import * as queue from '../lib/queue.js';
import * as switches from '../lib/switches.js';
import * as billing from '../lib/billing.js';
import { newId } from '../lib/paths.js';

export default function mount(ctx) {
const { api, bad, clientsLib, clip, coach, coachGate, hasSeat, ownersOf, quiet, route, todayFor, who } = ctx;
/* ----- The Desk: today's list, handoffs, leads, client care, activity ----- */
// Keepsakes on the Desk (v15): the recent ones, and whether a welcome video can be made (own clips).
async function keepsakeState(wsId) {
  const K = await import('../lib/keepsakes.js'), library = await import('../lib/library.js');
  return { keepsakes: K.list(wsId).slice(0, 12), ownClips: library.list(wsId).filter(c => library.fileOf(wsId, c.id)).length };
}
route('GET', '/api/desk', 'ws', async ({ wsId, me, caps }) => {
  const cfg = store.loadConfig(wsId), today = todayFor(cfg), C = await clientsLib();
  const handoffs = desk.list(wsId).filter(h => h.status === 'open' || Date.now() - Date.parse(h.doneAt || 0) < 7 * 86400000).slice(0, 60);
  return {
    today, list: desk.todayList(wsId, { today, caps, accountId: me.account.id }),
    handoffs, kinds: desk.KINDS,
    ...(caps.includes('clients') ? { due: C.dueToday(wsId, today), care: C.careDue(wsId, today, 14), pipeline: C.pipeline(wsId), stages: C.STAGES, leads: C.list(wsId).filter(c => c.stage && c.stage !== 'client').slice(0, 200), ...(await keepsakeState(wsId)) } : {}),
    people: store.listAccounts().filter(a => roles.isMember(a, wsId) && !a.disabled && roles.membership(a, wsId).role !== 'reviewer').map(a => ({ id: a.id, name: a.name || (roles.membership(a, wsId).role === 'owner' ? 'The agent' : 'Assistant'), role: roles.membership(a, wsId).role })),
  };
});
route('POST', '/api/desk/handoffs', 'ws', ({ wsId, body, me }) => {
  // For a named person in the workspace; from an assistant with no one named, for the agent.
  const named = typeof body.to === 'string' && body.to && body.to !== me.account.id && roles.isMember(store.getAccount(body.to), wsId) ? body.to : '';
  const mine = roles.membership(me.account, wsId)?.role;
  const to = named || (mine === 'assistant' ? ownersOf(wsId)[0] || '' : '');
  try { desk.add(wsId, { ...body, to, by: me.account.id, byName: me.account.name || me.account.email }); } catch (e) { bad(e.status || 400, e.message); }
  // They hear about it (if they turned notifications on). The agent's days off keep it quiet for the
  // agent; an assistant has their own days.
  const cfg = store.loadConfig(wsId), ids = to ? [to] : store.listAccounts().filter(a => !a.disabled && roles.membership(a, wsId)?.role === 'assistant' && hasSeat(a, wsId)).map(a => a.id);
  const forOwner = ids.some(id => ownersOf(wsId).includes(id));
  push.send(wsId, { title: `${me.account.name || 'Someone'} handed something to you`, body: clip(body.title || body.message || body.draft, 140), url: '/#/leads', tag: 'handoff' }, { tz: cfg.profile?.timezone || 'America/Denver', daysOff: forOwner ? cfg.profile?.daysOff || [] : [], accountIds: ids.filter(id => id !== me.account.id) }).catch(() => {});
  return { handoffs: desk.list(wsId).slice(0, 60) };
});
// A changes request closed or removed from the Desk: its video no longer says changes were asked for.
const withdrawChanges = (wsId, h) => { if (h.kind === 'changes' && h.videoId && store.getVideo(wsId, h.videoId)?.needsChanges?.handoffId === h.id) store.updateVideo(wsId, h.videoId, { needsChanges: null }); };
route('POST', '/api/desk/handoffs/:id/done', 'ws', ({ wsId, params, me }) => {
  // Only the person it's for marks it done (the agent, for one that names no one).
  const h = desk.list(wsId).find(x => x.id === params.id);
  if (!h) bad(404, 'Handoff not found.');
  const role = me.account.role === 'admin' ? 'owner' : roles.membership(me.account, wsId)?.role;
  // One that names no one is for whoever picks it up (but not the person who made it).
  // Changes asked for on a video close by themselves when its new version is submitted; only the agent
  // can withdraw the request here (and then the review card stops saying changes were asked for).
  if (h.kind === 'changes') {
    if (role !== 'owner' && me.account.role !== 'admin') bad(409, 'This one closes by itself when you submit the new version from Studio.');
  } else if (!(h.to === me.account.id || (!h.to && (role === 'owner' || h.by !== me.account.id)) || me.account.role === 'admin')) bad(403, 'This one is for someone else to finish.');
  if (!desk.finish(wsId, params.id, me.account.id)) bad(404, 'That handoff is already done.');
  withdrawChanges(wsId, h);
  return { handoffs: desk.list(wsId).slice(0, 60) };
});
// One item of a "changes" checklist ticked off (or not), by whoever is making the changes.
route('POST', '/api/desk/handoffs/:id/check', 'ws', ({ wsId, params, body, me }) => {
  const h = desk.list(wsId).find(x => x.id === params.id);
  if (!h || h.kind !== 'changes') bad(404, 'Handoff not found.');
  if (h.to && h.to !== me.account.id && me.account.role !== 'admin' && roles.membership(me.account, wsId)?.role !== 'owner') bad(403, 'This one is for someone else to finish.');
  const out = desk.tick(wsId, params.id, clip(body.k, 40), !!body.done);
  if (!out) bad(409, 'That handoff is already done.');
  return { handoff: out };
});
route('DELETE', '/api/desk/handoffs/:id', 'ws', ({ wsId, params, me }) => {
  const h = desk.list(wsId).find(x => x.id === params.id);
  if (!h) bad(404, 'Handoff not found.');
  const isOwner = me.account.role === 'admin' || roles.membership(me.account, wsId)?.role === 'owner';
  if (h.by !== me.account.id && !isOwner) bad(403, 'Only the person who made it, or the agent, can remove it.');
  desk.remove(wsId, params.id);
  withdrawChanges(wsId, h);
  return { handoffs: desk.list(wsId).slice(0, 60) };
});
// Who did what in the workspace (the agent's view of their assistants' work, and their own).
const ACTIVITY = { 'video.approved': 'approved a video', 'video.changes': 'asked for changes to a video', 'video.rejected': 'rejected a video', 'video.signedoff': 'signed off a video', 'video.sentback': 'sent a video back for changes', 'signoff.on': 'turned on sign-off before posting', 'replies.saved': 'wrote a keyword reply', 'replies.approved': 'approved a keyword reply', 'replies.on': 'turned on keyword replies', 'replies.off': 'turned off keyword replies', 'signoff.off': 'turned off sign-off before posting', 'video.fixed': 'fixed a scene', 'video.posted': 'marked a video posted', 'video.deleted': 'deleted a video', 'settings.saved': 'saved settings', 'request.made': 'asked the team for a change', 'handoff.made': 'handed something off', 'handoff.done': 'finished a handoff', 'client.added': 'added a person', 'client.saved': 'updated a person', 'client.reached': 'reached out to someone', 'people.invited': 'invited an assistant', 'people.removed': 'removed an assistant', 'people.changed': 'changed what an assistant can do', 'seats.changed': 'changed assistant seats', 'client.deleted': 'deleted a person', 'people.uninvited': 'took back an invite', 'invite.accepted': 'joined the workspace', 'login.ok': 'logged in' };
route('GET', '/api/desk/activity', 'ws', ({ wsId }) => ({
  activity: audit.list({ ws: wsId, limit: 400 }).filter(e => ACTIVITY[e.action] && e.role !== 'admin').slice(0, 60).map(e => ({ at: e.at, who: e.by ? desk.nameOf(e.by) : e.email || 'Someone', what: ACTIVITY[e.action], detail: e.action.startsWith('client') || e.action.startsWith('handoff') ? '' : String(e.detail || '').slice(0, 80) })),
}));

// A short note for one client, in the agent's voice (v15): a thank-you after booking, a birthday, a
// welcome, an anniversary or a check-in. Three versions to copy; nothing is sent from here.
route('POST', '/api/clients/:id/note', 'ws', async ({ wsId, ws, params, body }) => {
  coachGate(wsId, ws);
  const C = await clientsLib(), client = C.get(wsId, params.id);
  if (!client) bad(404, 'Client not found.');
  const { draftNote } = await coach();
  try { return await draftNote({ cfg: store.loadConfig(wsId), client, kind: clip(body.kind, 20), meter: usage.meter(wsId) }); }
  catch (e) { if (e.status) bad(e.status, e.message); throw e; }
});
// Keepsakes (v15): a private birthday or welcome video for one client, to text them. Never posted.
route('GET', '/api/keepsakes', 'ws', async ({ wsId }) => {
  const K = await import('../lib/keepsakes.js');
  return { keepsakes: K.list(wsId).slice(0, 30), perMonth: K.PER_MONTH, kinds: K.KINDS };
});
route('POST', '/api/keepsakes', 'ws', async ({ wsId, ws, body, me }) => {
  const K = await import('../lib/keepsakes.js');
  if (!switches.isOn('videos', ws)) bad(503, switches.offText('videos', ws));
  if (!billing.access(ws).allowed) bad(402, billing.access(ws).reason);
  let k;
  try { k = K.create(wsId, { kind: clip(body.kind, 20), clientId: clip(body.clientId, 40), lines: Array.isArray(body.lines) ? body.lines.slice(0, 6).map(l => clip(l, 120)) : null, by: me.account.id, id: newId() }); }
  catch (e) { bad(e.status || 400, e.message); }
  let job;
  try { job = queue.enqueue({ ws: wsId, kind: 'keepsake', opts: { id: k.id }, by: me.account.id, source: 'keepsake' }); }
  catch (e) { K.remove(wsId, k.id); K.refund(wsId); bad(429, e.message); }
  return { keepsake: K.save(wsId, k.id, { jobId: job.id }) };
});
route('DELETE', '/api/keepsakes/:id', 'ws', async ({ wsId, params }) => {
  const K = await import('../lib/keepsakes.js');
  const k = K.get(wsId, params.id);
  if (!k) bad(404, 'Not found.');
  if (k.status === 'making' && k.jobId) queue.cancel(wsId, k.jobId);
  K.remove(wsId, k.id);
  return { ok: true };
});
// A client-care item handled (a birthday note sent): it leaves the list; their follow-up date stays.
route('POST', '/api/clients/:id/care', 'ws', async ({ wsId, params, body }) => {
  const C = await clientsLib(), key = clip(body.key, 40);
  if (!/^(birthday|anniversary|quiet|welcome|thanks):\d{4}-\d{2}-\d{2}$/.test(key)) bad(400, 'Which care item?');
  const today = todayFor(store.loadConfig(wsId));
  if (!C.markCare(wsId, params.id, key, today)) bad(404, 'Client not found.');
  return { care: C.careDue(wsId, today, 14) };
});
}
