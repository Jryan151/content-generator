// routes/videos.js — Videos; memory; notifications; Approval records.
// Split out of server.js by area (v15). server.js mounts it, passing in the helpers these routes share
// with the rest of the server; the capability each route needs is still listed in one place
// (server.js ROUTE_CAPS). The code below is as it was in server.js (not re-indented, so its text and
// templates are unchanged).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DIRS, localTime } from '../lib/paths.js';
import * as store from '../lib/store.js';
import * as auth from '../lib/auth.js';
import * as allowance from '../lib/allowance.js';
import * as queue from '../lib/queue.js';
import { KEEP } from '../lib/scheduler.js';
import * as ig from '../lib/instagram.js';
import * as fb from '../lib/facebook.js';
import * as mc from '../mindset-core.js';
import * as trackLinks from '../lib/links.js';
import * as switches from '../lib/switches.js';
import * as memory from '../lib/memory.js';
import * as roles from '../lib/roles.js';
import * as push from '../lib/push.js';
import * as studio from '../lib/studio.js';
import * as usage from '../lib/usage.js';
import * as signoff from '../lib/signoff.js';
import * as mail from '../lib/email.js';
import { migrate, AI_VOICE_NOTE, RULES } from '../mixer-core.js';

export default function mount(ctx) {
const { APPROVAL_NOTE, BASE_HEADERS, CHECKLIST, REJECT_REASONS, api, autoPlanState, bad, clip, fixing, getV, jobView, lowFor, media, mindset, nowIso, plainError, quiet, route, sha256File, slug, spendGate, start, stats, streamFile, videoView, who, wsSummary } = ctx;
route('GET', '/api/videos', 'ws', ({ wsId }) => {
  const vids = store.readVideos(wsId);
  const cfg = store.loadConfig(wsId);
  const w = queue.waiting(wsId);
  return { videos: vids.map(videoView), stats: stats(vids), fixing: w.filter(j => j.kind === 'fix' || (j.kind === 'studio' && j.opts.replace)).map(j => j.opts.videoId || j.opts.replace), versioning: w.filter(j => j.kind === 'studio' && j.opts.replace).map(j => j.opts.replace), making: w.filter(j => j.kind !== 'fix' && j.kind !== 'keepsake' && !(j.kind === 'studio' && j.opts.replace)).length, low: lowFor(wsId, cfg, vids), plan: autoPlanState(wsId, cfg) };
});
route('POST', '/api/videos/:id/approve', 'ws', async ({ wsId, ws, params, body, me }) => {
  const v = getV(wsId, params.id);
  if (v.status !== 'pending') bad(409, 'Only videos waiting for review can be approved.');
  if (v.fileDeleted || !v.file) bad(409, 'This video’s file was removed.');
  if (fixing(wsId, v.id)) bad(409, 'This video is being fixed. Approve it when the new version is ready.');
  // The decision names the version that was watched (the card sends it; so does one made offline): a
  // newer one, saved since, needs watching first.
  if ((body.version != null && Number(body.version) !== (v.version || 1)) || (body.file && body.file !== v.file)) bad(409, body.offline ? 'This video changed since you watched it offline. Watch the new version, then approve it.' : 'A new version of this video arrived since you opened it. Watch it, then approve it.');
  const done = new Set(Array.isArray(body.checklist) ? body.checklist : []);
  const missing = CHECKLIST.filter(([k]) => !done.has(k));
  if (missing.length) bad(400, 'Tick every item before approving: ' + missing.map(m => m[1]).join('; ') + '.');
  let sha256;
  try { sha256 = await sha256File(store.videoPath(wsId, v.file)); } catch { bad(409, 'This video’s file can’t be read (it may have been removed). Fix a scene or make it again.'); }
  const decidedAt = body.offline && /^\d{4}-\d{2}-\d{2}T/.test(String(body.decidedAt)) && Date.parse(body.decidedAt) <= Date.now() && Date.now() - Date.parse(body.decidedAt) < 30 * 86400000 ? String(body.decidedAt).slice(0, 30) : '';
  store.updateVideo(wsId, v.id, { status: 'approved', rejection: null, updated: false, approval: { at: nowIso(), by: me.account.id, byName: me.account.name || me.account.email, checklist: CHECKLIST.map(c => c[1]), notice: APPROVAL_NOTE, sha256, file: v.file, ...(decidedAt ? { decidedOfflineAt: decidedAt } : {}) } });
  try { trackLinks.codeFor(wsId, v.id); } catch { /* made at the next start instead */ }
  const rec = store.getVideo(wsId, v.id);
  store.addExample(wsId, rec);   // approved scripts become style examples for new ones
  if (signoff.waiting(ws, rec)) signoff.tellReviewers(wsId, rec);   // (v15) it waits for the compliance reviewer
  return { video: videoView(rec) };
});
route('POST', '/api/videos/:id/reject', 'ws', ({ wsId, params, body, me }) => {
  const v = getV(wsId, params.id);
  if (!['pending', 'approved'].includes(v.status)) bad(409, 'This video can’t be rejected now.');
  if (v.autopost?.status === 'processing' || v.fbpost?.status === 'processing') bad(409, 'This video is posting right now. Wait for it to finish.');
  // Offline decisions only apply to what was waiting, as it was (a later decision online wins).
  if (body.offline && (v.status !== 'pending' || (body.version != null && Number(body.version) !== (v.version || 1)))) bad(409, 'This video was decided or changed since you rejected it offline, so that rejection wasn’t applied.');
  const reason = REJECT_REASONS.includes(body.reason) ? body.reason : 'Other';
  const note = clip(body.note, 300);
  const rec = store.updateVideo(wsId, v.id, { status: 'rejected', approval: null, rejection: { at: nowIso(), by: me.account.id, reason, note }, ...(v.autopost?.status === 'scheduled' ? { autopost: null } : {}) });
  // The next scripts see this, so the same kind of miss isn't repeated.
  store.markRecent(wsId, v.id, { rejected: reason + (note ? `: ${note}` : '') });
  store.removeExample(wsId, v.id);
  // Memory: the track or the opening they turned down isn't used again.
  const learned = memory.learnFromRejection(wsId, v, reason);
  // "Not my voice" can name a word they'd never say: it joins Never use (checked in code everywhere).
  const never = reason === 'Not my voice' ? clip(body.never, 80) : '';
  if (never) {
    const cfg = store.loadConfig(wsId);
    if (!cfg.guardrails.neverUse.some(x => x.toLowerCase() === never.toLowerCase())) { cfg.guardrails.neverUse.push(never); store.saveConfig(wsId, migrate(cfg)); }
  }
  return { video: videoView(rec), learned, never };
});
route('GET', '/api/memory', 'ws', ({ wsId }) => memory.summary(wsId));
route('POST', '/api/memory/forget', 'ws', ({ wsId, body }) => {
  if (!['music', 'openings', 'all'].includes(body.what)) bad(400, 'Forget what?');
  memory.forget(wsId, body.what);
  return memory.summary(wsId);
});
// Videos that finished since `since` (for the "ready" card while the app is open).
route('GET', '/api/jobs/finished', 'ws', ({ wsId, url }) => {
  const since = Date.parse(url.searchParams.get('since') || '') || Date.now() - 60000;
  const vids = store.readVideos(wsId);
  const jobs = queue.listJobs(wsId).filter(j => ['done', 'failed'].includes(j.status) && Date.parse(j.endedAt || 0) > since).slice(-5);
  const active = queue.listJobs(wsId).some(j => ['queued', 'running'].includes(j.status));
  return { active, now: nowIso(), done: jobs.map(j => { const v = vids.find(x => x.id === j.result?.videoId); return { id: j.id, kind: j.kind, status: j.status, error: j.status === 'failed' ? plainError(j.error) : '', topic: j.opts?.force?.painId || '', draftId: j.opts?.draftId || '', videoId: v?.id || null, hook: v?.scenes?.[0]?.text || '', coverUrl: v?.cover && !v.fileDeleted ? `/media/${v.cover}` : null }; }) };
});
// `endpoint`: this browser's subscription, if it has one, so the page can tell whose it is.
route('GET', '/api/push', 'ws', ({ wsId, me, url }) => {
  const mine = push.forAccount(wsId, me.account.id), here = url.searchParams.get('endpoint');
  // `here`: this browser is subscribed for this person in any of their workspaces.
  return { publicKey: push.vapid().publicKey, own: roles.isMember(me.account, wsId), devices: mine.map(s => ({ id: s.id, device: auth.deviceName(s.ua), at: s.at, problem: s.problem || '' })), here: here ? myWorkspaces(me).some(id => push.forAccount(id, me.account.id).some(s => s.endpoint === here)) : null };
});
// One browser, one subscription: it's kept in every workspace the person belongs to, so switching
// between workspaces never turns notifications off.
const myWorkspaces = me => roles.membershipsOf(me.account).map(m => m.ws).filter(id => store.getWorkspace(id));
route('POST', '/api/push/subscribe', 'ws', ({ wsId, me, body, req }) => { if (!roles.isMember(me.account, wsId)) bad(403, 'Notifications are for the people in this workspace.'); try { for (const id of myWorkspaces(me)) push.subscribe(id, me.account.id, body.subscription, req.headers['user-agent']); } catch (e) { bad(e.status || 400, e.message); } return { ok: true, devices: push.forAccount(wsId, me.account.id).length }; });
route('POST', '/api/push/unsubscribe', 'ws', ({ wsId, me, body }) => ({ ok: [wsId, ...myWorkspaces(me)].map(id => push.unsubscribe(id, me.account.id, body.endpoint ? String(body.endpoint) : '')).some(Boolean) }));
route('POST', '/api/push/test', 'ws', async ({ wsId, me }) => {
  const r = await push.send(wsId, { title: 'Notifications are on', body: 'You’ll hear from us when a video is ready to review.', url: '/#/review' }, { accountIds: [me.account.id], quiet: false });   // a test the agent asked for ignores quiet hours
  if (!r.sent) bad(502, r.rejected ? 'The browser’s push service turned the message down. Turn notifications off and on again; if it keeps happening, tell your admin.' : 'The test didn’t reach this browser. Turn notifications off and on again.');
  return { ok: true };
});

route('POST', '/api/videos/:id/reopen', 'ws', ({ wsId, params }) => {
  const v = getV(wsId, params.id);
  if (!['approved', 'rejected'].includes(v.status)) bad(409, 'Only approved or rejected videos can go back to review.');
  if (v.autopost?.status === 'processing' || v.fbpost?.status === 'processing') bad(409, 'This video is posting right now. Wait for it to finish.');
  if (v.status === 'rejected') memory.unlearn(wsId, v, store.readVideos(wsId).filter(x => x.id !== v.id && x.status === 'rejected'));
  return { video: videoView(store.updateVideo(wsId, v.id, { status: 'pending', approval: null, rejection: null, ...(v.autopost?.status === 'scheduled' ? { autopost: null } : {}), ...(v.fbpost?.status === 'scheduled' ? { fbpost: null } : {}) })) };
});
route('POST', '/api/videos/:id/posted', 'ws', ({ wsId, params, body, me }) => {
  const v = getV(wsId, params.id);
  if (v.status !== 'approved') bad(409, 'Approve the video before marking it posted.');
  if (signoff.waiting(store.getWorkspace(wsId), v)) bad(409, signoff.waitText(wsId));
  const link = clip(body.url, 300);
  if (link && !/^https:\/\/(www\.)?instagram\.com\//i.test(link)) bad(400, 'That doesn’t look like an Instagram link. Leave it blank if you don’t have one.');
  return { video: videoView(store.updateVideo(wsId, v.id, { status: 'posted', posted: { at: nowIso(), by: me.account.id, url: link }, ...(v.autopost?.status === 'scheduled' ? { autopost: null } : {}) })) };
});
// Post to Instagram automatically: now, or at a time the agent picks. Approved videos only.
route('POST', '/api/videos/:id/autopost', 'ws', ({ wsId, params, body, me }) => {
  if (!ig.igOn()) bad(400, 'Instagram posting isn’t set up on this server.');
  try { return { video: videoView(ig.schedulePost(wsId, params.id, body.at === 'now' ? 'now' : clip(body.at, 40), me.account.id)) }; }
  catch (e) { bad(e.status || 400, e.message); }
});
route('DELETE', '/api/videos/:id/autopost', 'ws', ({ wsId, params }) => {
  if (!ig.cancelPost(wsId, params.id)) bad(409, 'Only a scheduled post can be canceled. A post that has started can’t be stopped.');
  return { video: videoView(store.getVideo(wsId, params.id)) };
});
// Cross-post to the agent's Facebook Page as a Reel: now, or at a set time.
route('POST', '/api/videos/:id/facebook', 'ws', ({ wsId, params, body, me }) => {
  if (!fb.fbOn()) bad(400, 'Facebook posting isn’t set up on this server.');
  try { return { video: videoView(fb.schedulePost(wsId, params.id, body.at === 'now' ? 'now' : clip(body.at, 40), me.account.id)) }; }
  catch (e) { bad(e.status || 400, e.message); }
});
route('DELETE', '/api/videos/:id/facebook', 'ws', ({ wsId, params }) => {
  if (!fb.cancelPost(wsId, params.id)) bad(409, 'Only a scheduled post can be canceled. A post that has started can’t be stopped.');
  return { video: videoView(store.getVideo(wsId, params.id)) };
});
// The Facebook post text for a video (with its tracking link), to preview before posting.
route('GET', '/api/videos/:id/facebook-text', 'ws', ({ wsId, params }) => ({ text: fb.postText(wsId, getV(wsId, params.id)) }));
route('POST', '/api/videos/:id/results', 'ws', ({ wsId, params, body }) => {
  const v = getV(wsId, params.id);
  if (v.status !== 'posted') bad(409, 'Add results after the video is posted.');
  const n = x => Math.max(0, Math.min(1e9, Math.round(Number(x) || 0)));
  const blank = x => x === '' || x === null || x === undefined;   // (v15) a field left empty isn't a 0
  return { video: videoView(store.updateVideo(wsId, v.id, x => ({ results: { ...(x.results || {}), views: blank(body.views) ? (x.results?.views ?? null) : n(body.views), messages: blank(body.messages) ? (x.results?.messages || 0) : n(body.messages), updatedAt: nowIso() } }))) };
});
// One tap when a posted video brings a message (Instagram can't report messages). delta: 1, or -1 to undo.
route('POST', '/api/videos/:id/message', 'ws', ({ wsId, params, body }) => {
  const v = getV(wsId, params.id);
  if (v.status !== 'posted') bad(409, 'Mark the video posted first.');
  const d = body.delta === -1 ? -1 : 1;
  return { video: videoView(store.updateVideo(wsId, v.id, x => ({ results: { ...(x.results || {}), messages: Math.max(0, (x.results?.messages || 0) + d), updatedAt: nowIso() } }))) };
});
// Fix a scene's clip picker (v15): about ten clips for a scene's footage search, scored by the clip check
// (it counts toward the AI spend cap; with the workspace's clip check off they come unscored), unusable
// ones left out. `seen`: clips already shown (Refresh brings ten more, up to PICKER_REFRESHES times for a
// search, and PICKER_CALLS lists in all per scene, whatever the words, until the fix is sent). The clips
// offered are kept here with their scores: a fix can only pick one of them, and its score is ours.
const PICKER_REFRESHES = 5, PICKER_CALLS = 15, PICKER_HOURS = 6, PICKER_KEYS = 2000;
const pickerUse = new Map();   // "ws:video:scene" → { at, kw, n, total, offered: Map(id → { score, reason, query }) }
function pickerEntry(key, now) {
  for (const [k, e] of pickerUse) if (now - e.at > PICKER_HOURS * 3600000 || pickerUse.size > PICKER_KEYS) pickerUse.delete(k); else break;   // (oldest first)
  const e = pickerUse.get(key);
  return e && now - e.at < PICKER_HOURS * 3600000 ? e : null;
}
route('POST', '/api/videos/:id/clips', 'ws', async ({ wsId, ws, params, body }) => {
  const v = getV(wsId, params.id);
  if (!['pending', 'rejected'].includes(v.status)) bad(409, 'Send the video back to review before changing it.');
  const i = Number(body.i);
  if (!Number.isInteger(i) || i < 0 || i >= (v.scenes || []).length) bad(400, 'Pick a scene.');
  const keyword = clip(body.keyword || v.scenes[i].keyword, 60);
  if (!keyword) bad(400, 'Write a footage search for this scene first.');
  spendGate(ws);
  const key = `${wsId}:${v.id}:${i}`, now = Date.now(), old = pickerEntry(key, now);
  const e = old || { at: now, kw: '', n: -1, total: 0, offered: new Map() };
  const n = e.kw === keyword.toLowerCase() ? e.n + 1 : 0;   // 0: the first list for these words; then refreshes
  if (n > PICKER_REFRESHES) bad(429, `That’s ${PICKER_REFRESHES} refreshes for this scene. Try different words in its footage search, or pick from these.`);
  if (e.total >= PICKER_CALLS) bad(429, 'That’s as many clips as this scene can show for now. Pick from these, or send the fix and look again.');
  Object.assign(e, { kw: keyword.toLowerCase(), n, total: e.total + 1 });
  pickerUse.delete(key); pickerUse.set(key, { ...e, at: now });   // (kept newest last, for the pruning above)
  const seen = (Array.isArray(body.seen) ? body.seen : []).map(x => clip(x, 30)).slice(0, 200);
  const { pickerClips } = await import('../stages/broll.js');
  const { clipChecker } = await import('../pipeline.js');
  const cfg = store.loadConfig(wsId);
  const rank = cfg.output?.clipCheck === 'off' ? null : clipChecker(cfg, v.meta?.visual || '', usage.meter(wsId));
  // Never the clip already in this scene, or one another scene of this video uses (it would repeat).
  const inVideo = (v.clips || []).map(c => c?.id).filter(x => x != null);
  const clips = await pickerClips({ keyword, caption: v.scenes[i].text, visual: v.meta?.visual || '', rank, seen: [...seen, ...inVideo] });
  const offered = pickerUse.get(key)?.offered;
  if (offered) for (const c of clips) { if (offered.size >= 300) break; offered.set(String(c.id), { score: c.score ?? null, reason: c.reason || '', query: keyword }); }
  return { clips, keyword, refreshesLeft: Math.max(0, PICKER_REFRESHES - n), current: v.clips?.[i]?.id ?? null };
});
const okPickId = id => (typeof id === 'number' && Number.isInteger(id) && id > 0) || (typeof id === 'string' && /^(px\d{1,12}|\d{1,12})$/.test(id));
route('POST', '/api/videos/:id/fix', 'ws', async ({ wsId, ws, params, body, me }) => {
  const { checkFix } = await import('../pipeline.js');
  const v = getV(wsId, params.id);
  if (!['pending', 'rejected'].includes(v.status)) bad(409, 'Send the video back to review before fixing it.');
  if (fixing(wsId, v.id)) bad(409, 'This video is already being fixed.');
  const a = allowance.access(ws);
  if (!a.allowed) bad(402, a.reason);
  spendGate(ws);
  const n = (v.scenes || []).length;
  const edits = (Array.isArray(body.edits) ? body.edits : []).filter(e => Number.isInteger(e?.i) && e.i >= 0 && e.i < n)
    .map(e => ({ i: e.i, ...Object.fromEntries(['text', 'accent', 'say', 'keyword'].filter(k => typeof e[k] === 'string').map(k => [k, clip(e[k], 300)])) }));
  const swaps = [...new Set((Array.isArray(body.swaps) ? body.swaps : []).filter(i => Number.isInteger(i) && i >= 0 && i < n))];
  // Clips picked in the clip picker: used exactly, no search at render time (v15). Only a clip this scene
  // was offered, with the score it was given here (not one the browser says).
  const now = Date.now();
  const picks = Object.fromEntries(Object.entries(body.picks && typeof body.picks === 'object' ? body.picks : {})
    .map(([k, x]) => [Number(k), x]).filter(([k, x]) => Number.isInteger(k) && k >= 0 && k < n && x && okPickId(x.id))
    .map(([k, x]) => {
      const o = pickerEntry(`${wsId}:${v.id}:${k}`, now)?.offered.get(String(x.id));
      if (!o) bad(409, `The clips shown for scene ${k + 1} have expired. Tap “Show clips” and pick again.`);
      return [k, { id: x.id, query: o.query, score: o.score, reason: o.reason }];
    }));
  if (!edits.length && !swaps.length && !Object.keys(picks).length) bad(400, 'Change a caption or pick a clip to swap first.');
  const problem = checkFix(wsId, v.id, edits);
  // (v15) What stops it comes with its one-tap fixes, the same as in Studio.
  if (problem) { const f = checkFix(wsId, v.id, edits, { findings: true }); bad(400, problem, { findings: Array.isArray(f) ? f.filter(x => x.kind === 'stop') : [] }); }
  if (!switches.isOn('videos', store.getWorkspace(wsId))) bad(503, switches.offText('videos', store.getWorkspace(wsId)));
  const job = queue.enqueue({ ws: wsId, kind: 'fix', opts: { videoId: v.id, edits, swaps, ...(Object.keys(picks).length ? { picks } : {}) }, by: me.account.id });
  for (let i = 0; i < n; i++) pickerUse.delete(`${wsId}:${v.id}:${i}`);   // a new fix starts its refreshes afresh
  return { job: jobView(job) };
});
route('DELETE', '/api/videos/:id', 'ws', ({ wsId, params }) => {
  const v = getV(wsId, params.id);
  if (['approved', 'posted'].includes(v.status)) bad(409, 'Approved and posted videos are kept as records.');
  if (fixing(wsId, v.id)) bad(409, 'This video is being fixed.');
  store.removeVideo(wsId, v.id);
  trackLinks.forgetVideo(wsId, v.id);
  return { ok: true };
});
route('GET', '/api/videos/:id/download', 'ws', ({ req, res, wsId, ws, params }) => {
  const v = getV(wsId, params.id);
  if (!['approved', 'posted'].includes(v.status)) bad(403, 'Approve the video before downloading it.');
  if (signoff.waiting(ws, v)) bad(409, signoff.waitText(wsId));
  if (v.fileDeleted) bad(410, `Video files are kept ${KEEP.files} days after approval. This one was removed; its record is still here.`);
  streamFile(req, res, store.videoPath(wsId, v.file), 'video/mp4', `attachment; filename="${slug(ws.name)}-${v.createdAt.slice(0, 10)}-${v.id.slice(-6)}.mp4"`);
});
route('GET', '/api/videos/:id/cover', 'ws', ({ req, res, wsId, ws, params, url }) => {
  const v = getV(wsId, params.id);
  if (!v.cover || v.fileDeleted) bad(404, 'No cover image.');
  streamFile(req, res, store.videoPath(wsId, v.cover), 'image/jpeg', url.searchParams.get('download') ? `attachment; filename="${slug(ws.name)}-cover-${v.id.slice(-6)}.jpg"` : '');
});

// Cover frame picker: small frames to choose from, then the chosen moment becomes the cover.
const frameJobs = new Map();
let framesRunning = 0;
const frameWaiters = [];
async function frameSlot(fn) {
  if (framesRunning >= 2) await new Promise(r => frameWaiters.push(r));
  framesRunning++;
  try { return await fn(); } finally { framesRunning--; frameWaiters.shift()?.(); }
}
route('GET', '/api/videos/:id/frame', 'ws', async ({ req, res, wsId, params, url }) => {
  const v = getV(wsId, params.id);
  if (!v.file || v.fileDeleted) bad(404, 'The video file was removed.');
  const t = Math.round(Math.min(Math.max(0, Number(url.searchParams.get('t')) || 0), Math.max(0, (v.duration || 1) - 0.1)) * 10) / 10;
  const dir = path.join(DIRS.work, 'frames');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${wsId}-${v.id}-v${v.version || 1}-${t}.jpg`);
  if (!fs.existsSync(out)) {
    // One FFmpeg per frame at most, two at a time (the server has two CPUs); written aside, then moved
    // into place, so a request never streams a half-written image.
    if (!frameJobs.has(out)) frameJobs.set(out, frameSlot(async () => {
      const { makeCover } = await import('../stages/render.js'), tmp = `${out}.${crypto.randomBytes(3).toString('hex')}.jpg`;
      try { await makeCover(store.videoPath(wsId, v.file), tmp, { at: t, width: 270 }); fs.renameSync(tmp, out); }
      finally { fs.rmSync(tmp, { force: true }); }
    }).finally(() => frameJobs.delete(out)));
    try { await frameJobs.get(out); } catch { bad(500, 'That frame couldn’t be read.'); }
    if (!fs.existsSync(out)) bad(500, 'That frame couldn’t be read.');
  }
  streamFile(req, res, out, 'image/jpeg');
});
route('POST', '/api/videos/:id/cover', 'ws', async ({ wsId, params, body }) => {
  const v = getV(wsId, params.id);
  if (!v.file || v.fileDeleted) bad(404, 'The video file was removed.');
  if (!['pending', 'approved'].includes(v.status)) bad(409, 'The cover can only change before the video is posted.');
  if (v.autopost?.status === 'processing' || v.fbpost?.status === 'processing') bad(409, 'This video is posting right now.');
  if (fixing(wsId, v.id)) bad(409, 'This video is being fixed. Choose the cover on the new version.');
  const t = Math.min(Math.max(0, Number(body.t) || 0), Math.max(0, (v.duration || 1) - 0.1));
  const name = `cover_${v.id}_t${Math.round(t * 1000)}.jpg`;
  const { makeCover } = await import('../stages/render.js');
  try { await makeCover(store.videoPath(wsId, v.file), store.videoPath(wsId, name), { at: t }); } catch { bad(500, 'That frame couldn’t be used as a cover. Try another.'); }
  if (v.cover && v.cover !== name) fs.rmSync(store.videoPath(wsId, v.cover), { force: true });
  return { video: videoView(store.updateVideo(wsId, v.id, { cover: name, coverAt: Math.round(t * 10) / 10 })) };
});

/* ----- Approval records ----- */
// Cells that start like a formula get a leading apostrophe, so spreadsheets show them as text.
const csvCell = x => { let t = String(x ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
const recordRows = wsId => store.readAllVideos(wsId).filter(v => v.approval);   // every year, the archive too
route('GET', '/api/records.csv', 'ws', ({ res, wsId, ws }) => {
  const head = ['Video', 'Made', 'Approved', 'Approved by', 'Signed off by', 'Signed off', 'Checklist', 'Posted', 'Instagram link', 'Topic', 'Fact', 'Fact source', 'Fact confirmed', 'Script', 'Post text', 'File SHA-256'];
  const rows = recordRows(wsId).map(v => [v.id, v.createdAt, v.approval.at, v.approval.byName, v.signoff?.status === 'ok' ? v.signoff.byName : '', v.signoff?.status === 'ok' ? v.signoff.at : '', (v.approval.checklist || []).join(' | '), v.posted?.at || '', v.posted?.url || '', v.meta?.painPoint, v.meta?.insight, v.meta?.insightSource, v.meta?.insightConfirmedAt, (v.scenes || []).map(s => s.say || s.text).join(' / '), v.post, v.approval.sha256]);
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${slug(ws.name)}-approval-records.csv"`, 'Cache-Control': 'no-store', ...BASE_HEADERS });
  res.end('﻿' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n'));
});
const recE = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const recD = s => (s ? new Date(s).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
// One approved video's record. `full` (the receipt) adds the automatic checks, the rules every script
// is held to, fixes and the honest-persuasion read.
function recordSection(v, { full = false } = {}) {
  const e = recE, d = recD;
  const extra = !full ? '' : `
<dt>Automatic checks</dt><dd>${(v.preflight || []).map(p => `${p.ok ? '✓' : '!'} ${e(p.label)}`).join('<br>') || '—'}</dd>
${(v.preflight || []).length ? `<dt>Rules applied</dt><dd>The script and post were checked in code before review: no prices, rates or percentages that weren’t in the confirmed fact; no promises of approval or coverage; no fear or invented urgency; no words that suggest a government connection${(v.meta?.neverUse || []).length ? `; the agent’s own never-use list: ${v.meta.neverUse.map(x => `“${e(x)}”`).join(', ')}` : ''}.</dd>` : '<dt>Rules applied</dt><dd>Made by an older version, before automatic checks were recorded.</dd>'}
${(v.meta?.say || []).length ? `<dt>Pronunciations</dt><dd>${v.meta.say.map(x => `${e(x.word)} → said “${e(x.say)}”`).join('<br>')}</dd>` : ''}
${(v.meta?.principles || []).length || (v.meta?.pressure || []).length ? `<dt>Persuasion</dt><dd>${(v.meta?.principles || []).map(p => e(mc.PERSUASION[p]?.label || p)).join(', ') || '—'}${(v.meta?.pressure || []).length ? `<br><small>Pressure flagged: ${(v.meta.pressure).map(e).join(', ')}</small>` : '<br><small>No pressure tactics found.</small>'}</dd>` : ''}
${(v.meta?.locked || []).length ? `<dt>Locked checks</dt><dd>Checked in code, and passed, on this version: ${v.meta.locked.map(k => e(RULES[k]?.label || k)).join('; ')}.</dd>` : ''}
${(v.meta?.notes || []).length ? `<dt>Notes rendered past</dt><dd>${v.meta.notes.map(e).join('<br>')}<br><small>Style notes, not compliance rules: shown again in Review before approval.</small></dd>` : ''}
<dt>Versions</dt><dd>Version ${e(v.version || 1)}${(v.fixLog || []).length ? `, fixed ${v.fixLog.length}× (${v.fixLog.map(f => e(d(f.at))).join(', ')})` : ''}${v.mode === 'voiceover' ? '<br><small>AI voiceover' + (String(v.post || '').includes(AI_VOICE_NOTE) ? ', disclosed in the post text' : '') + '.</small>' : ''}
${(v.versions || []).length > 1 ? `<ol>${v.versions.map(x => `<li>Version ${e(x.v)}, ${e(d(x.at))}${x.byName ? `, submitted by ${e(x.byName)}` : ''}${(x.changed || []).length ? `: changed scene${x.changed.length > 1 ? 's' : ''} ${x.changed.map(i => i + 1).join(', ')}` : ''}${x.asked ? `<br><small>Changes asked for by ${e(x.asked.byName || 'the agent')}${x.asked.note ? ` (“${e(x.asked.note)}”)` : ''}: ${(x.asked.items || []).map(i => `${i.done ? '✓' : '○'} ${e(i.label)}`).join(', ') || 'see the note'}</small>` : ''}</li>`).join('')}</ol>` : ''}</dd>`;
  return `<section><h2>${e(d(v.approval.at))} · ${e(v.meta?.painPoint)}</h2>
<dl><dt>Approved by</dt><dd>${e(v.approval.byName)}</dd>${(v.signoffs || []).length ? `<dt>Compliance sign-off</dt><dd>${v.signoffs.map(x => `${x.status === 'ok' ? 'Signed off' : 'Sent back'} by ${e(x.byName)}, ${e(d(x.at))} (version ${e(x.version)})${x.note ? `: “${e(x.note)}”` : ''}`).join('<br>')}</dd>` : ''}<dt>Checklist</dt><dd>${(v.approval.checklist || []).map(e).join('<br>')}${v.approval.notice ? `<br><small>${e(v.approval.notice)}</small>` : ''}</dd>
<dt>Posted</dt><dd>${e(d(v.posted?.at))}${v.posted?.url ? ` · ${e(v.posted.url)}` : ''}</dd>
<dt>Fact</dt><dd>${e(v.meta?.insight)}<br><small>Source: ${e(v.meta?.insightSource || 'not given')} · confirmed ${e(d(v.meta?.insightConfirmedAt))}</small></dd>
<dt>Script</dt><dd><ol>${(v.scenes || []).map(s => `<li>${e(s.say || s.text)}</li>`).join('')}</ol></dd>
<dt>Post text</dt><dd>${e(v.post).replace(/\n/g, '<br>')}</dd><dt>File</dt><dd><code>${e(v.approval.file || v.file)}</code><br><small>SHA-256 ${e(v.approval.sha256)}</small></dd>${extra}</dl></section>`;
}
const RECORD_CSS = '<style>body{font:15px/1.5 system-ui,sans-serif;max-width:820px;margin:32px auto;padding:0 16px;color:#1b1d22}h1{font-size:24px}h2{font-size:16px;margin:28px 0 8px;border-top:1px solid #ccc;padding-top:16px}dl{display:grid;grid-template-columns:130px 1fr;gap:6px 12px}dt{color:#5c616b}dd{margin:0}ol{margin:0;padding-left:20px}small{color:#5c616b}code{font-size:12px;overflow-wrap:anywhere}@media print{body{margin:0}}</style>';
// One video's compliance receipt: everything about how it was checked and approved, on one page to
// print or save as PDF.
route('GET', '/api/videos/:id/receipt.html', 'ws', ({ res, wsId, ws, params }) => {
  const v = getV(wsId, params.id);
  if (!v.approval) bad(404, 'This video hasn’t been approved, so there’s no receipt yet.');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...BASE_HEADERS });
  res.end(`<!doctype html><meta charset="utf-8"><title>Compliance receipt · ${recE(ws.name)}</title>${RECORD_CSS}
<h1>Compliance receipt</h1><p>${recE(ws.name)} · video ${recE(v.id)} · printed ${recE(recD(nowIso()))}. The agent approved this video and remains responsible for it and for any carrier or state review.</p>${recordSection(v, { full: true })}`);
});
route('GET', '/api/records.html', 'ws', ({ res, wsId, ws }) => {
  const e = recE, d = recD;
  const items = recordRows(wsId).map(v => recordSection(v)).join('');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="${slug(ws.name)}-approval-records.html"`, 'Cache-Control': 'no-store', ...BASE_HEADERS });
  res.end(`<!doctype html><meta charset="utf-8"><title>Approval records · ${e(ws.name)}</title>
${RECORD_CSS}
<h1>Approval records · ${e(ws.name)}</h1><p>Exported ${e(d(nowIso()))}. ${recordRows(wsId).length} approved video(s). Each record shows who approved the video, what they checked, the fact it used and a fingerprint (SHA-256) of the exact file approved. Scripts were compliance-checked automatically; the agent approved each video and remains responsible for it and for any carrier or state review.</p>${items || '<p>No approved videos yet.</p>'}`);
});
}
