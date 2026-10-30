// lib/lessons.js — the team's lessons (Agent Reels → Guide): the leader teaches once, on video, and
// every agent can learn it any time of day, instead of sitting through another meeting.
//
// One lesson, four layers, so every kind of learner gets what they need (DISC):
//   point      1–2 sentences: the problem and the fix          (the bottom line first)
//   doThis     1–3 things to do on their next calls             (something concrete to act on)
//   video      the leader explaining it in her own words        (her voice, her stories)
//   transcript the exact words, to read at their own speed      (the detail, checkable)
// The leader uploads a video; the server makes a phone-friendly copy, writes the transcript (speech to
// text) and drafts the title, point and "do this" from it. She edits, then publishes. Nothing reaches
// her agents until she does. Each lesson can belong to one step of the call, so the course and her
// playbook are the same thing.
//
// Stored per team: lessons.json in the workspace, video files in the workspace's video folder.
// Agents tap "I tried it" on a lesson: that's a `lesson_tried` row in their own log (lib/reels.js),
// so the leader sees who is doing it, not just who watched.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { DIRS, readJSON, updateJSON } from './paths.js';
import * as store from './store.js';
import * as ai from './ai.js';
import * as usage from './usage.js';

/** The steps of the call a lesson can belong to, in course order. `basics` is everything else. */
export const STEPS = Object.freeze([
  { id: 'basics', label: 'The basics' },
  { id: 'open', label: 'Opening the call' },
  { id: 'need', label: 'Finding the need' },
  { id: 'qualify', label: 'Health and budget' },
  { id: 'options', label: 'Showing options' },
  { id: 'close', label: 'Closing' },
]);
const STEP_IDS = new Set(STEPS.map((s) => s.id));

export const LIMITS = Object.freeze({
  title: 80, point: 240, doThis: 3, doThisLen: 140, transcript: 30_000,
  lessons: 200, minSeconds: 5, maxMinutes: 15,
});
// Phone video is big (a 5-minute clip is often 150–300 MB); nginx must allow it (SETUP.md).
export const MAX_UPLOAD_MB = () => Math.max(20, Number(process.env.LESSON_UPLOAD_MAX_MB) || 500);

export class LessonError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, msg) => { throw new LessonError(status, msg); };

const listFile = (wsId) => path.join(store.wsDir(wsId), 'lessons.json');
const dirOf = (wsId) => { const d = path.join(store.videoDir(wsId), 'lessons'); fs.mkdirSync(d, { recursive: true }); return d; };
const ID = /^l[0-9a-f]{10}$/;
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const clipText = (v, n) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, n);
const now = () => new Date().toISOString();

// Lessons being prepared right now in this process. One left "processing" after a restart failed.
const working = new Set();

/** Every lesson, in course order. A lesson stuck mid-preparation by a restart reads as failed. */
export function list(wsId) {
  return readJSON(listFile(wsId), [])
    .map((l) => (l.status === 'processing' && !working.has(l.id) ? { ...l, status: 'failed', error: 'The server restarted while this was being prepared. Upload the video again.' } : l))
    .sort((a, b) => a.position - b.position);
}
export const get = (wsId, id) => list(wsId).find((l) => l.id === id) || null;
/** What an agent sees: published and ready, nothing else. */
export const published = (wsId) => list(wsId).filter((l) => l.published && l.status === 'ready');

export function fileOf(wsId, id, kind = 'video') {
  const l = get(wsId, id);
  const name = kind === 'thumb' ? l?.video?.thumb : l?.video?.file;
  const f = name && path.join(dirOf(wsId), name);
  return f && fs.existsSync(f) ? f : null;
}

function save(wsId, id, fn) {
  let out = null;
  updateJSON(listFile(wsId), [], (all) => all.map((l) => (l.id === id ? (out = { ...fn(l), updatedAt: now() }) : l)));
  return out;
}

/** The fields the leader edits. Anything not sent stays as it is. */
export function edit(wsId, id, body = {}) {
  const l = get(wsId, id);
  if (!l) fail(404, 'That lesson isn’t here anymore.');
  const next = {};
  if (body.title !== undefined) next.title = clip(body.title, LIMITS.title);
  if (body.point !== undefined) next.point = clipText(body.point, LIMITS.point);
  if (body.doThis !== undefined) {
    if (!Array.isArray(body.doThis)) fail(400, '“Do this” is a short list.');
    next.doThis = body.doThis.map((x) => clip(x, LIMITS.doThisLen)).filter(Boolean).slice(0, LIMITS.doThis);
  }
  if (body.transcript !== undefined) next.transcript = clipText(body.transcript, LIMITS.transcript);
  if (body.step !== undefined) { if (body.step !== null && !STEP_IDS.has(body.step)) fail(400, 'Pick a step of the call.'); next.step = body.step; }
  if (body.published !== undefined) {
    const after = { ...l, ...next };
    if (body.published && after.status !== 'ready') fail(409, 'This lesson is still being prepared.');
    if (body.published && (!after.title || !after.point || !after.doThis?.length)) fail(400, 'Before publishing: give it a title, the point, and at least one thing to do.');
    next.published = !!body.published;
    if (next.published && !l.published) next.publishedAt = now();
  }
  return save(wsId, id, (x) => ({ ...x, ...next }));
}

/** Move a lesson to a new place in the course (0 = first). */
export function move(wsId, id, to) {
  const all = list(wsId);
  const from = all.findIndex((l) => l.id === id);
  if (from < 0) fail(404, 'That lesson isn’t here anymore.');
  const [it] = all.splice(from, 1);
  all.splice(Math.max(0, Math.min(all.length, Math.round(Number(to) || 0))), 0, it);
  const pos = new Map(all.map((l, i) => [l.id, i]));
  updateJSON(listFile(wsId), [], (raw) => raw.map((l) => ({ ...l, position: pos.get(l.id) ?? l.position })));
  return list(wsId);
}

export function remove(wsId, id) {
  const l = get(wsId, id);
  if (!l) fail(404, 'That lesson isn’t here anymore.');
  for (const f of [l.video?.file, l.video?.thumb]) if (f) fs.rmSync(path.join(dirOf(wsId), f), { force: true });
  updateJSON(listFile(wsId), [], (all) => all.filter((x) => x.id !== id));
  return list(wsId);
}

/* ---------------- A new lesson from an uploaded video ---------------- */
const run = (bin, args, timeout = 15 * 60_000) => new Promise((resolve, reject) => {
  execFile(bin, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).slice(-300))) : resolve(stdout)));
});
const FF = () => process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = () => process.env.FFPROBE_PATH || 'ffprobe';
async function probe(file) {
  const out = JSON.parse(await run(FFPROBE(), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file], 60_000));
  const types = (out.streams || []).map((s) => s.codec_type);
  return { duration: Number(out.format?.duration) || 0, video: types.includes('video'), audio: types.includes('audio') };
}

/**
 * Start a lesson from an uploaded file (moved, not copied: the caller's temp file is taken over).
 * Checks it's a video of a sensible length right away; the slow part (a phone-friendly copy, the
 * transcript, the draft) runs after, and the lesson reads `processing` until it's done.
 */
export async function create(wsId, upload, { step = null } = {}) {
  if (list(wsId).length >= LIMITS.lessons) fail(409, `You have ${LIMITS.lessons} lessons. Delete some before adding more.`);
  let src;
  try { src = await probe(upload); } catch { fail(400, 'That file isn’t a video we can read. Try a video straight from your phone.'); }
  if (!src.video) fail(400, 'That file has no video in it.');
  if (src.duration < LIMITS.minSeconds) fail(400, 'That video is too short.');
  if (src.duration > LIMITS.maxMinutes * 60) fail(400, `Keep a lesson under ${LIMITS.maxMinutes} minutes. Short lessons get watched: 2 to 5 minutes is best.`);
  if (!src.audio) fail(400, 'That video has no sound, so there’s nothing to write down. Record it with your voice.');
  const id = 'l' + crypto.randomBytes(5).toString('hex');
  const kept = path.join(DIRS.work, `lesson-${id}-src`);
  fs.renameSync(upload, kept);
  const lesson = {
    id, step: STEP_IDS.has(step) ? step : null, title: '', point: '', doThis: [], transcript: '',
    video: null, status: 'processing', error: '', note: '', published: false,
    position: list(wsId).length, createdAt: now(), updatedAt: now(),
  };
  updateJSON(listFile(wsId), [], (all) => [...all, lesson]);
  working.add(id);
  const done = queue = queue.then(() => prepare(wsId, id, kept, src.duration)).catch(() => {}).finally(() => { working.delete(id); fs.rmSync(kept, { force: true }); });
  lesson.ready = done; // tests wait on it; not stored
  return lesson;
}
// One lesson prepared at a time: converting video is heavy, and the server has other work.
let queue = Promise.resolve();

async function prepare(wsId, id, src, duration) {
  const dir = dirOf(wsId), file = `${id}.mp4`, thumb = `${id}.jpg`, audio = path.join(DIRS.work, `lesson-${id}.mp3`);
  try {
    // A copy every phone can play and scrub: H.264, at most 720 p, sound kept, starts playing at once.
    await run(FF(), ['-y', '-v', 'error', '-i', src, '-vf', "scale='if(gt(ih,iw),min(720,iw),-2)':'if(gt(ih,iw),-2,min(720,ih))'", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', path.join(dir, file)]);
    await run(FF(), ['-y', '-v', 'error', '-ss', String(Math.min(1, duration / 2)), '-i', path.join(dir, file), '-frames:v', '1', '-vf', 'scale=480:-2', path.join(dir, thumb)], 60_000);
  } catch (e) {
    [file, thumb].forEach((f) => fs.rmSync(path.join(dir, f), { force: true }));
    save(wsId, id, (l) => ({ ...l, status: 'failed', error: 'That video couldn’t be converted. Try recording it again, or a different file.' }));
    return;
  }
  save(wsId, id, (l) => ({ ...l, video: { file, thumb, seconds: Math.round(duration) } }));

  // The exact words. Without them the lesson still works: she can type or paste the transcript.
  let text = '';
  const meter = usage.meter(wsId);
  try {
    await run(FF(), ['-y', '-v', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', audio], 5 * 60_000);
    text = clipText((await ai.transcribeWords({ file: audio, meter })).text, LIMITS.transcript);
  } catch { /* noted below */ }
  finally { fs.rmSync(audio, { force: true }); }

  // A first draft of the other layers, in her words, for her to edit. She always has the last word.
  let draft = {};
  if (text) { try { draft = await draftFrom(text, meter); } catch { /* she writes them herself */ } }
  save(wsId, id, (l) => ({
    ...l,
    transcript: l.transcript || text,
    title: l.title || clip(draft.title, LIMITS.title),
    point: l.point || clipText(draft.point, LIMITS.point),
    doThis: l.doThis?.length ? l.doThis : (Array.isArray(draft.doThis) ? draft.doThis.map((x) => clip(x, LIMITS.doThisLen)).filter(Boolean).slice(0, LIMITS.doThis) : []),
    step: l.step ?? (STEP_IDS.has(draft.step) ? draft.step : null),
    status: 'ready',
    note: text ? (draft.point ? '' : 'Write the point and what to do: the draft couldn’t be made this time.') : 'The transcript couldn’t be made this time. You can type or paste it.',
  }));
}

const DRAFT_SCHEMA = {
  name: 'lesson_draft',
  schema: {
    type: 'object', additionalProperties: false, required: ['title', 'point', 'doThis', 'step'],
    properties: {
      title: { type: 'string' }, point: { type: 'string' },
      doThis: { type: 'array', items: { type: 'string' } },
      step: { type: 'string', enum: STEPS.map((s) => s.id) },
    },
  },
};
async function draftFrom(transcript, meter) {
  const text = await ai.chatJSON({
    job: 'coach', temperature: 0.3, meter, schema: DRAFT_SCHEMA,
    messages: [
      { role: 'system', content: 'You turn a life insurance team leader’s training video into a short lesson card for brand-new agents. Use only what she says, in her words where you can. No new claims, numbers or product details she didn’t say. Plain words a first-week agent knows. Return JSON: title (under 60 characters), point (1–2 sentences: the problem and the fix), doThis (1–3 short actions to try on their next calls, each starting with a verb), step (which part of the sale it teaches: ' + STEPS.map((s) => `${s.id} = ${s.label}`).join(', ') + ').' },
      { role: 'user', content: `Her video, word for word:\n"""\n${transcript.slice(0, 12_000)}\n"""` },
    ],
  });
  return JSON.parse(text);
}

/* ---------------- What each person sees ---------------- */
/** Who tried which lesson, from the team's logs: { [lessonId]: Set(accountId) }. */
export function triedBy(rowsByPerson) {
  const out = {};
  for (const [personId, rows] of Object.entries(rowsByPerson)) {
    for (const a of rows) if (a.type === 'lesson_tried' && a.meta?.lesson_id) (out[a.meta.lesson_id] ||= new Set()).add(personId);
  }
  return out;
}
const pub = (l) => ({ id: l.id, step: l.step, title: l.title, point: l.point, doThis: l.doThis, transcript: l.transcript, seconds: l.video?.seconds ?? null, hasVideo: !!l.video, publishedAt: l.publishedAt || null });
/** For an agent: the published course. */
export const agentView = (wsId) => published(wsId).map(pub);
/** For the leader: every lesson, its state, and how many of her people tried it. */
export function leaderView(wsId, { tried = {}, teamSize = 0 } = {}) {
  return list(wsId).map((l) => ({ ...pub(l), status: l.status, error: l.error, note: l.note, published: l.published, tried: tried[l.id]?.size || 0, teamSize }));
}
