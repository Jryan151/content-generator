// lib/abtests.js — A/B tests of openings (v15 Phase 9).
//
// The opening line decides whether the right person keeps watching, so it's the thing worth testing.
// From Studio, "Test two openings" makes two videos that are the same in every way but the opening
// (version A and version B). Both go to Review (each uses one of the month's videos). Once both have been
// posted for RESULT_DAYS and have their views (from Instagram, or added by hand), the one with clearly
// more views wins: at least MARGIN more, with at least MIN_VIEWS on the better one. Closer than that is
// "too close to call". A test where one version is rejected or deleted, or whose views never come in, is
// stopped.
//
// What's learned: each decided test is written on both videos (video.abtest.result), so the writer is
// shown the winning opening and the one it beat (mixer-core winnersFrom), and Review shows which kinds of
// opening (a question, a story…) have won for this agent.
//
// workspaces/<ws>/abtests.json: [{ id, draftId, topic, status, arms: { A: { hook, style, videoId, jobId },
// B: {...} }, createdAt, by, decidedAt, winner, ratio, why }]
import crypto from 'crypto';
import path from 'path';
import { readJSON, updateJSON } from './paths.js';
import * as store from './store.js';
import * as queue from './queue.js';

export const RESULT_DAYS = 7, GIVE_UP_DAYS = 21, MIN_VIEWS = 100, MARGIN = 0.2, MAX_RUNNING = 3;
const DAY = 86400000;
const file = ws => path.join(store.wsDir(ws), 'abtests.json');
export const list = ws => readJSON(file(ws), []);
export const get = (ws, id) => list(ws).find(x => x.id === id) || null;

// The kind of opening it is, in plain words (for what's learned).
export const STYLES = { question: 'A question', myth: 'A myth or a surprise', story: 'A story', number: 'A number or a list', you: 'Talks straight to them', statement: 'A plain statement' };
export function styleOf(text) {
  const s = String(text || '').trim();
  if (/\?\s*$/.test(s)) return 'question';
  if (/\b(myth|most people think|you'?d think|believe|assume|actually|truth|wrong|surpris)/i.test(s)) return 'myth';
  if (/^(i |i'|my |when i |last (week|month|year)|a client|one client|she |he |yesterday)/i.test(s)) return 'story';
  if (/\b\d+\b|\b(one|two|three|four|five|six|seven)\b (things?|ways?|questions?|mistakes?|reasons?|steps?)/i.test(s)) return 'number';
  if (/^(if you|you |you'|your )/i.test(s)) return 'you';
  return 'statement';
}

export function start(ws, { draftId, topic = '', a, b, by }) {
  if (list(ws).filter(x => ['making', 'review', 'live'].includes(x.status)).length >= MAX_RUNNING) throw Object.assign(new Error(`That’s ${MAX_RUNNING} tests running. Let one finish first.`), { status: 409 });
  const test = { id: crypto.randomBytes(5).toString('hex'), draftId, topic: String(topic).slice(0, 120), status: 'making', createdAt: new Date().toISOString(), by,
    arms: { A: { hook: a, style: styleOf(a), videoId: '', jobId: '' }, B: { hook: b, style: styleOf(b), videoId: '', jobId: '' } } };
  updateJSON(file(ws), [], all => [test, ...all].slice(0, 100));
  return test;
}
const save = (ws, id, fn) => { let out = null; updateJSON(file(ws), [], all => all.map(x => (x.id === id ? (out = fn(x)) : x))); return out; };
export const setJob = (ws, id, arm, jobId) => save(ws, id, x => ({ ...x, arms: { ...x.arms, [arm]: { ...x.arms[arm], jobId } } }));
// A version is made: the video knows it's in a test.
export function attach(ws, id, arm, videoId) {
  store.updateVideo(ws, videoId, { abtest: { id, arm } });
  return save(ws, id, x => ({ ...x, arms: { ...x.arms, [arm]: { ...x.arms[arm], videoId } } }));
}
export const stop = (ws, id, why) => save(ws, id, x => (['decided', 'stopped'].includes(x.status) ? x : { ...x, status: 'stopped', why, decidedAt: new Date().toISOString() }));

// Where each test is now; decides the ones whose results are in. Returns the list.
export function refresh(ws, now = Date.now()) {
  for (const t of list(ws)) {
    if (['decided', 'stopped'].includes(t.status)) continue;
    const va = t.arms.A.videoId ? store.getVideo(ws, t.arms.A.videoId) : null, vb = t.arms.B.videoId ? store.getVideo(ws, t.arms.B.videoId) : null;
    if (!t.arms.A.videoId || !t.arms.B.videoId) {
      // Still being made, unless a version's job ended without a video (canceled, failed, or refused
      // before it started: the draft deleted, the plan or the AI budget out).
      const ended = ['A', 'B'].find(arm => !t.arms[arm].videoId && t.arms[arm].jobId && !['queued', 'running'].includes(queue.getJob(t.arms[arm].jobId)?.status || 'gone'));
      if (ended) stop(ws, t.id, `Version ${ended} wasn’t made.`);
      continue;
    }
    if (!va || !vb) { stop(ws, t.id, 'One version was deleted.'); continue; }
    if (va.status === 'rejected' || vb.status === 'rejected') { stop(ws, t.id, 'One version was rejected.'); continue; }
    const posted = [va, vb].every(v => v.status === 'posted' && v.posted?.at);
    if (!posted) { if (t.status !== 'review') save(ws, t.id, x => ({ ...x, status: 'review' })); continue; }
    const since = Math.max(Date.parse(va.posted.at), Date.parse(vb.posted.at)), age = (now - since) / DAY;
    if (t.status !== 'live') save(ws, t.id, x => ({ ...x, status: 'live', liveAt: new Date(since).toISOString() }));
    if (age < RESULT_DAYS) continue;
    // Views from Instagram, or added by hand (a field left empty, or 0, isn't a result yet).
    const views = v => (Number.isFinite(v.results?.views) && (v.results.auto || v.results.views > 0) ? v.results.views : null);
    const a = views(va), b = views(vb);
    if (a === null || b === null) { if (age > GIVE_UP_DAYS) stop(ws, t.id, 'Views were never added for both versions.'); continue; }
    decide(ws, t, va, vb, a, b, now);
  }
  return list(ws);
}
function decide(ws, t, va, vb, a, b, now) {
  const hi = Math.max(a, b), lo = Math.min(a, b);
  const close = hi < MIN_VIEWS || hi < lo * (1 + MARGIN);   // at least 20% more views than the other
  const winner = close ? '' : a > b ? 'A' : 'B', ratio = Math.round((hi / Math.max(1, lo)) * 10) / 10;
  const why = close ? (hi < MIN_VIEWS ? `Too few views to tell (${a} and ${b}).` : `Too close to call (${a} and ${b} views).`) : `Version ${winner} had ${ratio}× the views (${winner === 'A' ? a : b} to ${winner === 'A' ? b : a}).`;
  const at = new Date(now).toISOString();
  for (const [arm, v] of [['A', va], ['B', vb]]) {
    store.updateVideo(ws, v.id, { abtest: { id: t.id, arm, result: close ? 'tie' : winner === arm ? 'won' : 'lost', beat: winner === arm ? t.arms[arm === 'A' ? 'B' : 'A'].hook : '', ratio: winner === arm ? ratio : null, decidedAt: at, views: arm === 'A' ? a : b, otherViews: arm === 'A' ? b : a } });
  }
  return save(ws, t.id, x => ({ ...x, status: 'decided', decidedAt: at, winner, ratio: close ? null : ratio, views: { A: a, B: b }, why }));
}
// What the tests have shown, by kind of opening: [{ style, label, won, lost, tied }], most wins first.
export function lessons(ws) {
  const m = {};
  for (const t of list(ws).filter(x => x.status === 'decided')) {
    for (const arm of ['A', 'B']) {
      const s = t.arms[arm].style, r = m[s] ||= { style: s, label: STYLES[s] || s, won: 0, lost: 0, tied: 0 };
      if (!t.winner) r.tied++; else if (t.winner === arm) r.won++; else r.lost++;
    }
  }
  return Object.values(m).sort((x, y) => y.won - x.won || x.lost - y.lost);
}
