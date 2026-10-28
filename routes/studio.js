// routes/studio.js — Studio: videos built by hand.
// Split out of server.js by area (v15). server.js mounts it, passing in the helpers these routes share
// with the rest of the server; the capability each route needs is still listed in one place
// (server.js ROUTE_CAPS). The code below is as it was in server.js (not re-indented, so its text and
// templates are unchanged).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DIRS } from '../lib/paths.js';
import * as store from '../lib/store.js';
import * as allowance from '../lib/allowance.js';
import * as usage from '../lib/usage.js';
import * as queue from '../lib/queue.js';
import * as switches from '../lib/switches.js';
import * as insights from '../lib/insights.js';
import * as library from '../lib/library.js';
import * as studio from '../lib/studio.js';
import * as memory from '../lib/memory.js';
import * as spell from '../lib/spell.js';
import { FORMATS, winnersFrom, gaps, studioPicks, studioChecks, suggestAccent, nicheOf, shortReason, hiddenNote, beatPlan, lineFindings, applyAutoFixes, rulesOf, spellFixed, seriesProgress } from '../mixer-core.js';

// A Studio video's versions (each resubmit of its draft while it's in review is one).
export const MAX_VERSIONS = 10;
export default function mount(ctx) {
const { BASE_HEADERS, MAX_PER_REQUEST, TESTS_PER_DAY, api, autoPlanState, bad, clip, coach, coachGate, draftCfg, draftPicks, enqueueVideos, fixing, jobView, lowFor, plainError, route, spendGate, typicalSeconds, usedThisMonth, wsSummary } = ctx;
/* ----- Studio: videos built by hand ----- */
// Each AI helper (openings, write the rest, rewrites, footage scores, voice preview) counts like a test
// script; only rendering uses one of the month's videos.
function studioGate(wsId, ws) {
  if (!ws.onboarded) bad(409, 'Finish setup first.');
  if (!switches.isOn('coach', ws)) bad(503, switches.offText('coach', ws));
  const a = allowance.access(ws);
  if (!a.allowed) bad(402, a.reason);
  spendGate(ws);
  if (usage.scriptsToday(wsId) >= TESTS_PER_DAY) bad(429, `That’s ${TESTS_PER_DAY} test scripts and Studio helpers today. More tomorrow.`);
  usage.count(wsId, 'scripts');
}
const getDraft = (wsId, id) => studio.get(wsId, clip(id, 40)) || bad(404, 'Draft not found.');
const notRendering = d => { if (d.status === 'rendering') bad(409, 'This video is rendering. Wait for it to finish.'); return d; };
// A draft whose render job was canceled or failed for good goes back to being a draft.
function liveStatus(wsId, d) {
  if (d.status !== 'rendering') return d;
  const j = queue.listJobs(wsId).find(x => x.id === d.jobId);
  return j && ['queued', 'running'].includes(j.status) ? d : { ...d, status: 'draft', error: d.error || (j?.status === 'failed' ? plainError(j.error) : 'The render was canceled.') };
}
function draftView(wsId, d0, cfg = store.loadConfig(wsId)) {
  const d = liveStatus(wsId, d0);
  const picks = draftPicks(wsId, cfg, d);
  const check = d.scenes.length ? studioChecks(d.scenes, draftCfg(cfg, d), picks) : null;
  // The video it was submitted as (v15).
  const v = d.videoId ? store.getVideo(wsId, d.videoId) : null;
  const submitted = v ? { id: v.id, status: v.status, version: v.version || 1, approved: !!v.approval } : null;
  return { ...d, submitted, picks: { audience: picks.audience, painPoint: picks.painPoint, insights: picks.insights, solutions: picks.solutions, question: picks.question, format: picks.format, structure: picks.structure, scenes: picks.scenes, bridgeStyle: picks.bridgeStyle, ctaStyle: picks.ctaStyle, series: picks.series || null, story: picks.story, askQuestion: picks.askQuestion, problems: picks.problems }, check };
}
route('GET', '/api/studio', 'ws', ({ wsId }) => {
  const cfg = store.loadConfig(wsId);
  const all = studio.list(wsId);
  // Newest first, with each draft's format, so the simple start can take turns (v15); each series says
  // which part comes next, for the Continue a series card.
  const recentFormats = [...all].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).filter(d => d.brief?.painId).map(d => ({ id: d.id, format: studioPicks(cfg, d.brief).format }));
  return { drafts: all.map(x => liveStatus(wsId, x)).map(d => ({ id: d.id, title: d.title, status: d.status, updatedAt: d.updatedAt, videoId: d.videoId, error: d.error, scenes: d.scenes.length })), series: seriesProgress(nicheOf(cfg).series || [], all), recentFormats, max: studio.MAX_DRAFTS };
});
route('GET', '/api/studio/:id', 'ws', ({ wsId, params }) => ({ draft: draftView(wsId, getDraft(wsId, params.id)) }));
route('POST', '/api/studio', 'ws', ({ wsId, body }) => {
  const cfg = store.loadConfig(wsId);
  try { return { draft: draftView(wsId, studio.create(wsId, cfg, body.brief || {}), cfg) }; } catch (e) { bad(e.status || 400, e.message); }
});
route('PUT', '/api/studio/:id', 'ws', ({ wsId, params, body }) => {
  const d = notRendering(liveStatus(wsId, getDraft(wsId, params.id)));
  const cfg = store.loadConfig(wsId);
  // An edit after submitting makes the draft a draft again; it keeps its video, so the next submit is a
  // new version of it (v15), unless that video was approved or posted (then it's a new video).
  const kept = d.videoId && ['pending', 'rejected'].includes(store.getVideo(wsId, d.videoId)?.status) ? d.videoId : '';
  return { draft: draftView(wsId, studio.save(wsId, d.id, { ...(body.brief ? { brief: body.brief } : {}), ...(body.scenes ? { scenes: body.scenes } : {}), ...(body.hooks ? { hooks: body.hooks } : {}), ...(d.status === 'done' && (body.scenes || body.brief) ? { status: 'draft', videoId: kept } : {}), error: '' }, cfg), cfg) };
});
route('DELETE', '/api/studio/:id', 'ws', ({ wsId, params }) => (studio.remove(wsId, clip(params.id, 40)) ? { ok: true } : bad(404, 'Draft not found.')));
// Eight openings for the draft's brief, each checked and scored.
route('POST', '/api/studio/:id/hooks', 'ws', async ({ wsId, ws, params }) => {
  const d = getDraft(wsId, params.id), cfg = store.loadConfig(wsId), picks = studioPicks(cfg, d.brief);
  if (picks.problems.length) bad(409, picks.problems[0]);
  studioGate(wsId, ws);
  const { writeHooks, makeAsk } = await import('../stages/script.js');
  const hooks = await writeHooks(draftCfg(cfg, d), { ...picks, recent: store.readRecent(wsId), winners: winnersFrom(store.readVideos(wsId)), turnedDown: memory.read(wsId).openings.map(o => o.text).reverse().slice(0, 8) }, makeAsk(usage.meter(wsId)), () => {}, 8);
  return { draft: draftView(wsId, studio.save(wsId, d.id, { hooks }), cfg) };
});
// Write the scenes left empty, keeping the agent's own (and their chosen opening).
route('POST', '/api/studio/:id/fill', 'ws', async ({ wsId, ws, params, body }) => {
  const d = notRendering(liveStatus(wsId, getDraft(wsId, params.id))), cfg = store.loadConfig(wsId), picks = studioPicks(cfg, d.brief);
  if (picks.problems.length) bad(409, picks.problems[0]);
  studioGate(wsId, ws);
  const cards = studio.cleanScenes(body.scenes || d.scenes);
  const n = picks.scenes;
  while (cards.length < n) cards.push({ say: '', text: '', accent: '', keyword: '' });
  const voice = cfg.output.mode === 'voiceover';
  const first = cards[0];
  const hook = first?.text ? { text: first.text, ...(voice && first.say ? { say: first.say } : {}) } : null;
  const { generateScript } = await import('../stages/script.js');
  const c = { ...cfg, output: { ...cfg.output, scenes: n, drafts: 1 } };
  let r;
  try { r = await generateScript({ cfg: c, picks: { ...picks, hook, recent: store.readRecent(wsId) }, recent: store.readRecent(wsId), examples: store.readExamples(wsId), winners: winnersFrom(store.readVideos(wsId)), meter: usage.meter(wsId), log: () => {}, withPost: false }); }
  catch (e) { bad(422, 'The AI couldn’t write scenes that pass the checks this time. Try again, or write a little more yourself. ' + e.message); }
  const empty = s => !s.text.trim() && !s.say.trim();
  const merged = cards.slice(0, n).map((s, i) => (empty(s) ? { ...r.scenes[i], clip: s.clip } : { ...s, keyword: s.keyword || r.scenes[i]?.keyword || '', accent: s.accent || (r.scenes[i]?.accent && s.text.toLowerCase().includes(r.scenes[i].accent.toLowerCase()) ? r.scenes[i].accent : suggestAccent(s.text, cfg)) }));
  if (liveStatus(wsId, getDraft(wsId, d.id)).status === 'rendering') bad(409, 'This video started rendering while the scenes were being written. Nothing was changed.');
  const kept = d.videoId && ['pending', 'rejected'].includes(store.getVideo(wsId, d.videoId)?.status) ? d.videoId : '';
  return { draft: draftView(wsId, studio.save(wsId, d.id, { scenes: merged, ...(d.status === 'done' ? { status: 'draft', videoId: kept } : {}), error: '' }, cfg), cfg) };
});
// Lines for one card (v15: the same three kinds as everywhere): a line that would stop a render is held
// back and counted, with why; one with only notes is offered with its note, never dropped.
const judgeLines = (scenes, i, c, picks, opts) => {
  const judged = opts.map(o => { const f = lineFindings(scenes, i, o, c, picks); return { o, stop: f.find(x => x.kind === 'stop')?.text || '', notes: f.filter(x => x.kind === 'warn').map(x => x.text) }; });
  const reasons = judged.filter(x => x.stop).map(x => shortReason(x.stop));
  return { options: judged.filter(x => !x.stop).map(x => ({ ...x.o, ...(x.notes.length ? { notes: x.notes } : {}) })), dropped: reasons.length, reasons, hidden: hiddenNote(reasons) };
};
// Rewrites of one card (five styles), checked like everything else in Studio.
route('POST', '/api/studio/:id/rewrite', 'ws', async ({ wsId, ws, params, body }) => {
  const d = getDraft(wsId, params.id), cfg = store.loadConfig(wsId), picks = draftPicks(wsId, cfg, d);
  const i = Number(body.i), scenes = studio.cleanScenes(body.scenes || d.scenes);
  if (!Number.isInteger(i) || i < 0 || i >= scenes.length || !scenes[i].text) bad(400, 'Write something in that scene first.');
  coachGate(wsId, ws);
  const { rewriteLine } = await coach();
  const c = draftCfg(cfg, { ...d, scenes });
  const product = (nicheOf(cfg).productLines || []).find(l => l.id === (picks.painPoint?.product || picks.audience?.product))?.label || '';
  const opts = await rewriteLine({ cfg: c, video: { scenes, mode: cfg.output.mode, meta: { format: picks.format, structure: picks.structure } }, i, facts: picks.insights.map(f => f.text), meter: usage.meter(wsId), fix: clip(body.fix, 300), product });
  return judgeLines(scenes, i, c, picks, opts);
});
// ✦ Ideas for one card: lines (checked), footage searches (any subject) and scenery to film.
route('POST', '/api/studio/:id/ideas', 'ws', async ({ wsId, ws, params, body }) => {
  const d = notRendering(liveStatus(wsId, getDraft(wsId, params.id))), cfg = store.loadConfig(wsId), picks = draftPicks(wsId, cfg, d);
  if (picks.problems.length) bad(409, picks.problems[0]);
  const scenes = studio.cleanScenes(body.scenes || d.scenes);
  while (scenes.length < picks.scenes) scenes.push({ say: '', text: '', accent: '', keyword: '' });
  const i = Number(body.i);
  if (!Number.isInteger(i) || i < 0 || i >= scenes.length) bad(400, 'Pick a scene.');
  coachGate(wsId, ws);
  const { sceneIdeas } = await coach();
  const c = draftCfg(cfg, { ...d, scenes });
  const plan = beatPlan(scenes.length, picks.format, Math.max(1, picks.insights.length), picks.structure);
  const beat = plan.find(b => i + 1 >= b.from && i + 1 <= b.to)?.beat || '';
  const r = await sceneIdeas({ cfg: c, scenes, i, beat, facts: picks.insights.map(f => f.text), audience: picks.audience, meter: usage.meter(wsId) });
  return { ...judgeLines(scenes, i, c, picks, r.lines), searches: r.searches, scenery: r.scenery, beat };
});
// The clips a scene's footage search finds, scored by the AI clip check.
route('POST', '/api/studio/:id/footage', 'ws', async ({ wsId, ws, params, body }) => {
  const d = getDraft(wsId, params.id), cfg = store.loadConfig(wsId), picks = studioPicks(cfg, d.brief);
  const keyword = clip(body.keyword, 60);
  if (!keyword) bad(400, 'Write a footage search for this scene first.');
  studioGate(wsId, ws);
  const { testFootage } = await import('../stages/broll.js');
  const { clipChecker } = await import('../pipeline.js');
  const rank = clipChecker({ ...cfg, output: { ...cfg.output, clipCheck: 'on' } }, picks.audience?.visual || '', usage.meter(wsId));
  return { results: (await testFootage({ keyword, caption: clip(body.caption, 120), visual: picks.audience?.visual, rank, manual: true })).slice(0, 6), own: library.list(wsId).map(c => ({ id: `own:${c.id}`, description: c.description, thumb: `/api/library/${c.id}/thumb` })) };
});
// Hear one line in the agent's voice before rendering.
route('POST', '/api/studio/:id/voice', 'ws', async ({ res, wsId, ws, params, body }) => {
  const d = getDraft(wsId, params.id), cfg = store.loadConfig(wsId);
  const text = clip(body.text, 300);
  if (!text) bad(400, 'Write the spoken line first.');
  studioGate(wsId, ws);
  const { speakScene } = await import('../stages/voice.js');
  const tmp = path.join(DIRS.work, `preview-${crypto.randomBytes(5).toString('hex')}.mp3`);
  fs.mkdirSync(DIRS.work, { recursive: true });
  try {
    await speakScene(text, cfg, tmp, usage.meter(wsId), studioPicks(cfg, d.brief).audience?.style);
    const buf = fs.readFileSync(tmp);
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length, 'Cache-Control': 'no-store', ...BASE_HEADERS });
    res.end(buf);
  } finally { fs.rmSync(tmp, { force: true }); }
});
// Spelling notes for captions (v15): words not in the dictionary or the agent's own words, with a
// correction, and the common mix-ups ("its" for "it's"). Instant and free (no AI). texts: up to 40.
route('POST', '/api/spell', 'ws', ({ wsId, body }) => {
  const cfg = store.loadConfig(wsId), own = spell.ownWords(cfg);
  if (rulesOf(cfg).level('spelling', 'draft') === 'off') return { results: [], off: true };
  const budget = spell.newBudget();   // one budget for the whole request (a caption full of junk can't tie up the server)
  return { results: (Array.isArray(body.texts) ? body.texts : []).slice(0, 40).map(t => spell.checkSpelling(clip(t, 400), own, budget)) };
});
// The spelling notes on a draft's captions, as findings (they never stop a render).
function spellFindings(cfg, scenes) {
  if (rulesOf(cfg).level('spelling', 'draft') === 'off') return [];
  const own = spell.ownWords(cfg), out = [], budget = spell.newBudget();
  scenes.forEach((s, i) => spell.checkSpelling(s.text, own, budget).forEach(m => out.push({ rule: 'spelling', kind: 'warn', scene: i, text: `Scene ${i + 1}: “${m.word}”${m.suggestion ? ` may be “${m.suggestion}”` : ' isn’t a word we know'}.`, ...(m.suggestion && spellFixed(s.text, m) ? { fix: { label: `Change to “${m.suggestion}”`, edits: [{ i, field: 'text', value: spellFixed(s.text, m) }] } } : {}) })));
  return out;
}
// Render: the same checks as every video, then into the queue. Uses one of the month's videos.
route('POST', '/api/studio/:id/render', 'ws', ({ wsId, ws, params, me }) => {
  const d = liveStatus(wsId, getDraft(wsId, params.id)), cfg = store.loadConfig(wsId), picks = draftPicks(wsId, cfg, d);
  if (d.status === 'rendering') bad(409, 'This video is already rendering.');
  if (!ws.onboarded) bad(409, 'Finish setup first.');
  if (picks.problems.length) bad(409, picks.problems[0]);
  if (d.scenes.length !== picks.scenes) bad(400, `This draft needs ${picks.scenes} scenes; it has ${d.scenes.length}.`);
  // Only what would stop a render (locked compliance rules, and rules set to block) refuses it, with the
  // one-tap fixes; notes go along with the video, onto its review card and compliance receipt.
  const check = studioChecks(d.scenes, draftCfg(cfg, d), picks);
  if (!check.ok) bad(400, 'Fix these first: ' + check.problems.join(' '), { problems: check.problems, findings: check.findings });
  const a = allowance.access(ws);
  if (!a.allowed) bad(402, a.reason);
  spendGate(ws);
  // Submitted before and still in review: this is its next version (like a fix, it isn't a new video).
  const prev = d.videoId ? store.getVideo(wsId, d.videoId) : null;
  const replace = prev && ['pending', 'rejected'].includes(prev.status) ? prev.id : '';
  if (!replace && a.limit - usedThisMonth(wsId) <= 0) bad(402, `You’ve used all ${a.limit} videos for this month.`);
  // A new version costs a render like any video: up to MAX_VERSIONS of one video (fixes have their own limit).
  if (replace && (prev.versions?.length || 1) >= MAX_VERSIONS) bad(409, `This video already has ${MAX_VERSIONS} versions. The agent can approve or reject it; for something new, start a new draft.`);
  if (replace && fixing(wsId, replace)) bad(409, 'This video is being fixed. Submit again when the new version is ready.');
  if (!switches.isOn('videos', ws)) bad(503, switches.offText('videos', ws));
  let job;
  const spelling = spellFindings(cfg, d.scenes).map(f => f.text);
  try { job = queue.enqueue({ ws: wsId, kind: 'studio', opts: { draftId: d.id, brief: d.brief, scenes: applyAutoFixes(d.scenes, check.findings), ...(spelling.length ? { notes: spelling } : {}), ...(replace ? { replace } : {}) }, by: me.account.id, source: 'studio' }); } catch (e) { bad(429, e.message); }
  studio.save(wsId, d.id, { status: 'rendering', jobId: job.id, error: '' });
  return { job: jobView(job), draft: draftView(wsId, studio.get(wsId, d.id), cfg) };
});

route('GET', '/api/overview', 'ws', ({ wsId, caps }) => ({
  workspace: wsSummary(wsId, caps),
  // What to make next (gaps), and whether the posting plan is about to run dry.
  ...(() => { const cfg = store.loadConfig(wsId), vids = store.readVideos(wsId); return { next: gaps(cfg, vids), low: lowFor(wsId, cfg, vids), plan: autoPlanState(wsId, cfg) }; })(),
  jobs: queue.listJobs(wsId).slice(-20).reverse().map(jobView),
  typical: typicalSeconds(queue.listJobs(wsId)),
  usage: caps.includes('billing') ? usage.monthUsage(wsId) : null,
  testsLeft: Math.max(0, TESTS_PER_DAY - usage.scriptsToday(wsId)),
}));
route('POST', '/api/jobs', 'ws', ({ wsId, body, me }) => {
  const n = Math.max(1, Math.min(MAX_PER_REQUEST, Math.round(Number(body.count) || 1)));
  const force = { painId: clip(body.painId, 40), insightId: clip(body.insightId, 40), format: FORMATS[body.format] ? body.format : '' };
  return { jobs: enqueueVideos(wsId, n, 'manual', me.account.id, force).map(jobView) };
});
route('DELETE', '/api/jobs/:id', 'ws', ({ wsId, params }) => {
  if (!queue.cancel(wsId, params.id)) bad(404, 'Only videos still waiting in line can be canceled.');
  return { ok: true };
});
}
