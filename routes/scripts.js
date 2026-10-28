// routes/scripts.js — Scripts and jobs.
// Split out of server.js by area (v15). server.js mounts it, passing in the helpers these routes share
// with the rest of the server; the capability each route needs is still listed in one place
// (server.js ROUTE_CAPS). The code below is as it was in server.js (not re-indented, so its text and
// templates are unchanged).
import crypto from 'crypto';
import { PRODUCT_NAME } from '../lib/paths.js';
import * as store from '../lib/store.js';
import * as allowance from '../lib/allowance.js';
import * as usage from '../lib/usage.js';
import * as switches from '../lib/switches.js';
import * as studio from '../lib/studio.js';
import * as memory from '../lib/memory.js';
import { stampFacts } from '../lib/onboarding.js';
import { migrate, whyNoVideos, FORMATS, boostsFrom, tasteFrom, winnersFrom, roll, applySuggestionTo, usableRoutes, studioChecks, shortReason, hiddenNote } from '../mixer-core.js';

export default function mount(ctx) {
const { TESTS_PER_DAY, api, bad, clip, coach, coachGate, content, draftCfg, draftPicks, getV, route, spendGate, workingConfig } = ctx;
/* ----- Scripts and jobs ----- */
route('POST', '/api/script', 'ws', async ({ wsId, ws, body, me }) => {
  if (!switches.isOn('coach', ws)) bad(503, switches.offText('coach', ws));
  const a = allowance.access(ws);
  if (!a.allowed) bad(402, a.reason);
  spendGate(ws);
  if (usage.scriptsToday(wsId) >= TESTS_PER_DAY) bad(429, `That’s ${TESTS_PER_DAY} test scripts today. More tomorrow.`);
  const saved = store.loadConfig(wsId);
  const cfg = body.config ? stampFacts(saved, migrate(body.config), me.account.id) : saved;
  const { generateScript } = await import('../stages/script.js');
  const lines = [];
  usage.count(wsId, 'scripts');
  try {
    const vids = store.readVideos(wsId);
    const force = { painId: clip(body.painId, 40), insightId: clip(body.insightId, 40), format: FORMATS[body.format] ? body.format : '', perf: { ...boostsFrom(vids), taste: tasteFrom(vids) } };
    const r = await generateScript({ cfg, recent: store.readRecent(wsId), examples: store.readExamples(wsId), winners: winnersFrom(vids), turnedDown: memory.read(wsId).openings.map(o => o.text), force, meter: usage.meter(wsId), log: l => lines.push(l) });
    return { scenes: r.scenes, post: r.post, chosen: r.chosen, drafts: r.drafts.map(d => ({ n: d.n, ok: d.ok, hook: d.hook?.text || '' })), hooks: r.hooks, scores: r.scores, meta: r.meta, ...(me.account.role === 'admin' ? { prompt: r.prompt } : {}), log: lines };
  } catch (e) { bad(422, e.message, { log: lines }); }
});

// See what the clip check sees: one footage search, scored. Counts as a test.
route('POST', '/api/footage-test', 'ws', async ({ wsId, ws, body }) => {
  const a = allowance.access(ws);
  if (!a.allowed) bad(402, a.reason);
  spendGate(ws);
  if (usage.scriptsToday(wsId) >= TESTS_PER_DAY) bad(429, `That’s ${TESTS_PER_DAY} tests today. More tomorrow.`);
  const keyword = clip(body.keyword, 60);
  if (!keyword) bad(400, 'Enter a footage search, like “older woman kitchen table”.');
  const cfg = store.loadConfig(wsId);
  const audience = cfg.story.audiences.find(x => x.id === body.audienceId) || cfg.story.audiences[0];
  const { testFootage } = await import('../stages/broll.js');
  const { clipChecker } = await import('../pipeline.js');
  usage.count(wsId, 'scripts');
  const rank = clipChecker({ ...cfg, output: { ...cfg.output, clipCheck: 'on' } }, audience?.visual || '', usage.meter(wsId));
  return { visual: audience?.visual || '', results: await testFootage({ keyword, caption: clip(body.caption, 120), visual: audience?.visual, rank }) };
});

route('POST', '/api/coach', 'ws', async ({ wsId, ws, body, me }) => {
  coachGate(wsId, ws);
  const { askCoach, coachContext, coachKind } = await coach();
  const cfg = workingConfig(wsId, body, me);
  const videos = store.readVideos(wsId);
  const f = body.focus || {};
  const video = f.videoId ? videos.find(v => v.id === f.videoId) || null : null;
  const focus = { video, fact: typeof f.factId === 'string' ? f.factId : '', audience: typeof f.audienceId === 'string' ? f.audienceId : '', test: f.test && typeof f.test === 'object' ? f.test : null, prompt: me.account.role === 'admin' && typeof f.prompt === 'string' ? f.prompt : '' };
  // A Studio draft in focus: the coach sees the board as it is on screen (saved or not) and its checks.
  let studioFocus = null;
  if (f.studio && typeof f.studio === 'object' && body.mode !== 'comms') {
    const d = studio.get(wsId, clip(f.studio.draftId, 40));
    if (d) {
      const picks = draftPicks(wsId, cfg, d), scenes = studio.cleanScenes(Array.isArray(f.studio.scenes) ? f.studio.scenes : d.scenes);
      // A new board has no cards yet: the coach works on as many empty ones as the brief asks for.
      while (scenes.length < picks.scenes) scenes.push({ say: '', text: '', accent: '', keyword: '' });
      const c = draftCfg(cfg, { ...d, scenes });
      const check = scenes.length ? studioChecks(scenes, c, picks) : null;
      studioFocus = { draft: d, scenes, picks, cfg: c, check, voice: cfg.output.mode === 'voiceover', available: usableRoutes(cfg).insights.filter(i => picks.painPoint && i.links.includes(picks.painPoint.id)) };
      focus.studio = studioFocus;
    }
  }
  // What kind of question this is decides how much context and which suggestions go with it.
  const kind = body.mode === 'comms' ? 'content' : coachKind({ view: clip(body.view, 20), focus });
  const ctx = coachContext(cfg, { view: clip(body.view, 20), videos, recent: store.readRecent(wsId), notes: store.readNotes(wsId), weekly: store.readWeekly(wsId), focus, kind });
  // Communicate mode: the same chat, coached on how people take in information (DISC, behavior, selling).
  if (body.mode === 'comms') {
    const { askComms } = await import('../lib/comms.js');
    return askComms({ product: PRODUCT_NAME, cfg, messages: body.messages, ctx, meter: usage.meter(wsId) });
  }
  return { ...(await askCoach({ product: PRODUCT_NAME, cfg, messages: body.messages, ctx, video, studio: studioFocus, meter: usage.meter(wsId), kind })), kind };
});

// The input workshop: scores one input (a worry, question, hook, fact, audience or call to action)
// and rewrites it for different communication styles, each rewrite checked and ready to apply.
route('POST', '/api/comms/workshop', 'ws', async ({ wsId, ws, body, me }) => {
  coachGate(wsId, ws);
  const { workshop } = await import('../lib/comms.js');
  try {
    return await workshop({ cfg: workingConfig(wsId, body, me), kind: clip(body.kind, 20), text: body.text, itemId: clip(body.itemId, 40), audienceId: clip(body.audienceId, 40), painId: clip(body.painId, 40), style: clip(body.style, 2), meter: usage.meter(wsId) });
  } catch (e) { if (e.user) bad(400, e.message); throw e; }
});

// Try it: the same video idea written with and without a suggestion, side by side. Counts as 2 tests.
const seeded = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
route('POST', '/api/coach/try', 'ws', async ({ wsId, ws, body, me }) => {
  if (!switches.isOn('coach', ws)) bad(503, switches.offText('coach', ws));
  const a = allowance.access(ws);
  if (!a.allowed) bad(402, a.reason);
  spendGate(ws);
  if (usage.scriptsToday(wsId) + 2 > TESTS_PER_DAY) bad(429, `Trying a change uses 2 of your ${TESTS_PER_DAY} test scripts a day, and there aren’t enough left today.`);
  const { checkSuggestions, tryPlan, compareScripts } = await coach();
  const cfg = workingConfig(wsId, body, me);
  const [sg] = checkSuggestions(cfg, [body.suggestion]);
  if (!sg?.tryable) bad(400, 'This suggestion can’t be tried with a test script.');
  const why = whyNoVideos(cfg);
  if (why) bad(409, why.msg);
  const plan = tryPlan(cfg, sg);
  if (plan.error) bad(409, plan.error);
  const next = applySuggestionTo(cfg, sg);
  const recent = store.readRecent(wsId), seed = crypto.randomInt(1, 2 ** 31);
  const pa = roll(cfg, seeded(seed), recent, plan.before);
  if (!pa.insight) bad(409, pa.breaks[0] || 'Nothing to test with yet.');
  const pb = roll(next, seeded(seed), recent, { painId: pa.painPoint.id, insightId: pa.insight.id, format: plan.after.format || pa.format });
  const { generateScript } = await import('../stages/script.js');
  const one = c => ({ ...c, output: { ...c.output, drafts: 1 } });
  const videos = store.readVideos(wsId), examples = store.readExamples(wsId), winners = winnersFrom(videos), meter = usage.meter(wsId);
  usage.count(wsId, 'scripts'); usage.count(wsId, 'scripts');
  const run = (c, picks) => generateScript({ cfg: one(c), picks, recent, examples, winners, meter, log: () => {}, withPost: false });
  let A, B;
  try { [A, B] = await Promise.all([run(cfg, pa), run(next, pb)]); } catch (e) { bad(422, 'The test scripts didn’t pass the checks this time. Try again. ' + e.message); }
  const verdict = await compareScripts({ cfg, sg, before: A.scenes, after: B.scenes, meter }).catch(() => null);
  const side = r => ({ scenes: r.scenes, format: FORMATS[r.meta.format]?.label || r.meta.format, topic: r.meta.painPoint });
  return { before: side(A), after: side(B), verdict };
});

// Three rewrites of one caption in a video under review, each checked like a fix.
route('POST', '/api/coach/rewrite', 'ws', async ({ wsId, ws, body }) => {
  const v = getV(wsId, clip(body.videoId, 40));
  if (!['pending', 'rejected'].includes(v.status)) bad(409, 'Send the video back to review before changing it.');
  const i = Number(body.i);
  if (!Number.isInteger(i) || i < 0 || i >= (v.scenes || []).length) bad(400, 'Pick a scene.');
  const { checkFix, readPicks } = await import('../pipeline.js');
  const picks = readPicks(wsId, v.id);
  if (!picks || !v.clips) bad(409, 'This video can’t be changed. Make a new one instead.');
  coachGate(wsId, ws);
  const { rewriteLine } = await coach();
  const facts = (picks.insights?.length ? picks.insights : [picks.insight]).filter(Boolean).map(f => f.text);
  const options = await rewriteLine({ cfg: store.loadConfig(wsId), video: v, i, facts, meter: usage.meter(wsId) });
  // (v15) Held back only for what would stop a render; a line with notes is offered with them.
  const judged = options.map(o => {
    const edit = [{ i, text: o.text, accent: o.accent, ...(o.say ? { say: o.say } : {}) }];
    const f = checkFix(wsId, v.id, edit, { findings: true });
    if (!Array.isArray(f)) return { o, problem: [f], notes: [] };
    const stops = f.filter(x => x.kind === 'stop'), mine = x => x.scene === i || x.scene === null;
    return { o, problem: stops.length ? stops.map(x => x.text) : null, notes: f.filter(x => x.kind === 'warn' && mine(x)).map(x => x.text) };
  });
  const firstFor = list => (Array.isArray(list) ? list.find(p => p.startsWith(`Scene ${i + 1} `)) || list[0] : list);
  const reasons = judged.filter(x => x.problem).map(x => shortReason(firstFor(x.problem)));
  return { options: judged.filter(x => !x.problem).map(x => ({ ...x.o, ...(x.notes.length ? { notes: x.notes } : {}) })), dropped: reasons.length, reasons, hidden: hiddenNote(reasons) };
});

// Which worries a fact answers (for facts linked to none).
route('POST', '/api/coach/links', 'ws', async ({ wsId, ws, body, me }) => {
  coachGate(wsId, ws);
  const { suggestLinks } = await coach();
  return { painIds: await suggestLinks({ cfg: workingConfig(wsId, body, me), text: clip(body.text, 300), meter: usage.meter(wsId) }) };
});
}
