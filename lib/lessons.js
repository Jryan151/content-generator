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
import * as autoedit from './autoedit.js';

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
// Phone video is big: 1080p at 60 fps is about 100 MB a minute. Big files come in pieces (below), so
// no single request is ever large enough for nginx or Cloudflare (100 MB on its free plan) to refuse.
// The cap is only there so one file can't fill the disk; the length limit is what keeps lessons short.
export const MAX_UPLOAD_MB = () => Math.max(20, Number(process.env.LESSON_UPLOAD_MAX_MB) || 4096);
/** Each piece of an upload. Well under Cloudflare's 100 MB per request. */
export const PIECE_MB = 32;

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
  if (body.version !== undefined) {
    if (!['edited', 'original'].includes(body.version)) fail(400, 'Pick the edited or the original video.');
    if (!l.video?.original) fail(409, 'This lesson wasn’t edited, so there’s only one version.');
    const want = body.version, was = l.video.using || 'edited';
    if (want !== was) {
      const e = l.edit || {};
      next.video = { ...l.video, using: want, file: want === 'original' ? l.video.original : l.video.edited, seconds: want === 'original' ? e.originalSeconds : e.editedSeconds };
      // The words follow the video, unless she has rewritten them herself.
      const words = { edited: e.editedText, original: e.originalText };
      if (body.transcript === undefined && words[was] !== undefined && (l.transcript === words[was])) next.transcript = words[want] || '';
    }
  }
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
  for (const f of new Set([l.video?.file, l.video?.thumb, l.video?.edited, l.video?.original])) if (f) fs.rmSync(path.join(dirOf(wsId), f), { force: true });
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
  const dir = dirOf(wsId), file = `${id}.mp4`, full = `${id}-full.mp4`, thumb = `${id}.jpg`, audio = path.join(DIRS.work, `lesson-${id}.mp3`);
  const at = (f) => path.join(dir, f);
  const clean = () => [file, full, thumb].forEach((f) => fs.rmSync(at(f), { force: true }));
  try {
    // A copy every phone can play and scrub: H.264, at most 720 p, starts playing at once, and the sound
    // mastered the same way for every lesson (lib/autoedit.js MASTER).
    await run(FF(), ['-y', '-v', 'error', '-i', src, '-vf', "scale='if(gt(ih,iw),min(720,iw),-2)':'if(gt(ih,iw),-2,min(720,ih))'", '-af', autoedit.MASTER, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', at(full)]);
  } catch (e) {
    clean();
    save(wsId, id, (l) => ({ ...l, status: 'failed', error: 'That video couldn’t be converted. Try recording it again, or a different file.' }));
    return;
  }

  // The exact words, with a time for each. Without them the lesson still works: she can type or paste them.
  const meter = usage.meter(wsId);
  const listen = async (video) => {
    try {
      await run(FF(), ['-y', '-v', 'error', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', audio], 5 * 60_000);
      return await ai.transcribeWords({ file: audio, meter });
    } catch { return null; } finally { fs.rmSync(audio, { force: true }); }
  };
  const heard = await listen(at(full));
  const fullText = clipText(heard?.text || '', LIMITS.transcript);

  // She just teaches: long pauses get shorter and her "Mango" commands are followed (lib/autoedit.js).
  // The original stays, one tap away.
  let p = heard ? autoedit.plan(heard.words, duration, { text: heard.text }) : null, editNote = '';
  if (p?.changed) {
    try { await autoedit.render(at(full), at(file), p.keep, { ffmpeg: FF(), workFile: path.join(DIRS.work, `lesson-${id}-cuts.txt`) }); }
    catch { fs.rmSync(at(file), { force: true }); p = null; editNote = 'The automatic edit didn’t work this time, so this is your video as recorded.'; }
  } else p = null;
  if (!p) fs.renameSync(at(full), at(file));

  let text = fullText, seconds = Math.round(duration);
  if (p) {
    seconds = Math.round(autoedit.keptSeconds(p.keep));
    // Words were cut, not just silence: write down what's left. If that fails, the kept words will do.
    if (p.spokenCut) text = clipText((await listen(at(file)))?.text || p.wordsKept.map((w) => w.word).join(' '), LIMITS.transcript);
  }
  try { await run(FF(), ['-y', '-v', 'error', '-ss', String(Math.min(1, seconds / 2)), '-i', at(file), '-frames:v', '1', '-vf', 'scale=480:-2', at(thumb)], 60_000); }
  catch { /* the video plays without a picture */ }
  save(wsId, id, (l) => ({
    ...l,
    video: { file, thumb: fs.existsSync(at(thumb)) ? thumb : null, seconds, edited: p ? file : null, original: p ? full : null, using: p ? 'edited' : null },
    edit: p ? { summary: autoedit.summary(p), warnings: p.warnings || [], commands: p.commands, pauses: p.pauses, cut: p.cut, originalSeconds: Math.round(duration), editedSeconds: seconds, originalText: fullText, editedText: text } : null,
  }));

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
    note: [editNote, text ? (draft.point ? '' : 'Write the point and what to do: the draft couldn’t be made this time.') : 'The transcript couldn’t be made this time. You can type or paste it.'].filter(Boolean).join(' '),
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

/* ---------------- Uploading a big video in pieces ---------------- */
// start → send each piece (in order; a piece sent twice is fine) → finish. If the signal drops, the phone
// asks how much arrived and carries on from there. Unfinished uploads are cleared after a day.
const uploads = new Map(); // id → { wsId, size, type, received, file, at }
const UPLOAD_ID = /^u[0-9a-f]{16}$/;
const DAY_MS = 86_400_000;
function sweepUploads(t = Date.now()) {
  for (const [id, u] of uploads) if (t - u.at > DAY_MS) { fs.rmSync(u.file, { force: true }); uploads.delete(id); }
}
const freeBytes = () => { try { const s = fs.statfsSync(DIRS.work); return s.bavail * s.bsize; } catch { return Infinity; } };
const uploadOf = (wsId, id) => { const u = UPLOAD_ID.test(id) && uploads.get(id); if (!u || u.wsId !== wsId) fail(404, 'That upload expired. Choose the video again.'); return u; };

export function startUpload(wsId, { size, type = '' } = {}) {
  sweepUploads();
  const bytes = Math.floor(Number(size));
  if (!(bytes > 0)) fail(400, 'Choose a video file.');
  if (!/^video\//.test(String(type || 'video/mp4'))) fail(415, 'Choose a video file.');
  const mb = MAX_UPLOAD_MB();
  if (bytes > mb * 1024 * 1024) fail(413, `That video is over ${Math.round(mb / 1024 * 10) / 10} GB. Record at 1080p (not 4K) and keep it under ${LIMITS.maxMinutes} minutes.`);
  // Room for the upload and its converted copy, with some to spare for everything else.
  if (freeBytes() < bytes * 2 + 1024 ** 3) fail(507, 'The server is low on space for a video this size. Try a shorter one, or ask whoever runs your site to free up space.');
  if (list(wsId).length >= LIMITS.lessons) fail(409, `You have ${LIMITS.lessons} lessons. Delete some before adding more.`);
  const id = 'u' + crypto.randomBytes(8).toString('hex');
  const file = path.join(DIRS.work, `lesson-up-${id}`);
  fs.writeFileSync(file, '');
  uploads.set(id, { wsId, size: bytes, type, received: 0, file, at: Date.now() });
  return { uploadId: id, received: 0, size: bytes, pieceMB: PIECE_MB };
}
export const uploadStatus = (wsId, id) => { const u = uploadOf(wsId, id); return { uploadId: id, received: u.received, size: u.size }; };

/**
 * One piece, starting at byte `offset`. A piece that already arrived (a retry) is acknowledged and dropped;
 * a gap is refused with how much arrived, so the phone resends from there.
 */
export async function addPiece(wsId, id, offset, stream, length) {
  const u = uploadOf(wsId, id);
  const at = Math.floor(Number(offset));
  const len = Math.floor(Number(length));
  if (!(len > 0) || len > PIECE_MB * 1024 * 1024 + 1024) fail(413, 'That piece is too big.');
  if (at + len > u.size) fail(400, 'That piece goes past the end of the video.');
  if (at + len <= u.received) { stream.resume(); return { received: u.received, size: u.size }; }
  if (at !== u.received) { stream.resume(); throw Object.assign(new LessonError(409, 'A piece went missing. Sending from where it stopped.'), { received: u.received }); }
  const chunks = []; let got = 0;
  await new Promise((resolve, reject) => {
    stream.on('data', (c) => { got += c.length; if (got > len) { reject(new LessonError(400, 'That piece is bigger than it said.')); stream.destroy(); } else chunks.push(c); });
    stream.on('end', resolve); stream.on('error', reject);
  });
  if (got !== len) fail(400, 'That piece arrived incomplete. Sending it again.');
  if (u.received !== at) fail(409, 'A piece went missing. Sending from where it stopped.'); // another request landed first
  fs.appendFileSync(u.file, Buffer.concat(chunks));
  u.received += got; u.at = Date.now();
  return { received: u.received, size: u.size };
}

/** Every piece is in: the lesson is made from the whole file (and the upload is gone). */
export async function finishUpload(wsId, id, { step = null } = {}) {
  const u = uploadOf(wsId, id);
  if (u.received !== u.size) fail(409, `Only ${Math.round((u.received / u.size) * 100)}% of the video arrived. Sending the rest.`);
  uploads.delete(id);
  try { return await create(wsId, u.file, { step }); }
  finally { fs.rmSync(u.file, { force: true }); }
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
/** Who said a lesson didn't go well when they tried it (their latest answer counts): { [lessonId]: Set(accountId) }. */
export function struggledBy(rowsByPerson) {
  const out = {};
  for (const [personId, rows] of Object.entries(rowsByPerson)) {
    const last = {};
    for (const a of rows) if (a.type === 'lesson_tried' && a.meta?.lesson_id) last[a.meta.lesson_id] = a.meta.how;
    for (const [id, how] of Object.entries(last)) if (how === 'not_great') (out[id] ||= new Set()).add(personId);
  }
  return out;
}
const pub = (l) => ({ id: l.id, step: l.step, title: l.title, point: l.point, doThis: l.doThis, transcript: l.transcript, seconds: l.video?.seconds ?? null, hasVideo: !!l.video, v: l.video?.using || '', publishedAt: l.publishedAt || null });
/** For an agent: the published course. */
export const agentView = (wsId) => published(wsId).map(pub);
/** For the leader: every lesson, its state, and how many of her people tried it. */
export function leaderView(wsId, { tried = {}, struggled = {}, teamSize = 0 } = {}) {
  return list(wsId).map((l) => ({ ...pub(l), status: l.status, error: l.error, note: l.note, published: l.published, edit: l.edit ? { summary: l.edit.summary, warnings: l.edit.warnings || [], using: l.video?.using || 'edited' } : null, struggled: struggled[l.id]?.size || 0, tried: tried[l.id]?.size || 0, teamSize }));
}
