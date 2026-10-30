// lib/ai.js — which AI model does which job, and what happens when one fails.
//
// Each job has a ladder: a first choice and backups, in order.
//   writer  scripts and post text          coach   the coach, content help, replies
//   hooks   the 8 openings                 quick   short checks (fit, lens, links)
//   critic  ranking openings and drafts    vision  checking footage thumbnails
//   voice   voiceovers                     timing  word timings for a voiceover (transcription)
// The first rung is what your .env says (OPENAI_MODEL and friends, as before); the backups are newer
// OpenAI models and, when their keys are set, Claude (ANTHROPIC_API_KEY) and ElevenLabs voices
// (ELEVENLABS_API_KEY). AI_LADDER_<JOB> in .env replaces a whole ladder, e.g.
//   AI_LADDER_WRITER=gpt-6-luna,anthropic:claude-sonnet-5-5
//
// When a rung fails:
//   - the model was retired or doesn't exist: it's marked gone (re-tried after a day), the call steps
//     down at once, and you're alerted once a day: "Writing is using X because Y was retired";
//   - its company isn't answering (an outage, after its own retries) or the account is out of credit:
//     the call moves to the next rung from a *different* company; with none, the error goes back as
//     before (a video then waits out the outage in the queue);
//   - anything else (a bad request) isn't a model problem: the error goes back unchanged.
// Every day checkModels() asks each company whether each model on every ladder still exists and when
// it's scheduled to shut down, and warns you 90 days ahead.
import path from 'path';
import { DIRS, readJSON, updateJSON } from './paths.js';
import { notify } from './alerts.js';
import * as breaker from './breaker.js';
import { service as flightService } from './flight.js';
import { AIError, openaiChat, openaiSpeech, transcribeWords as openaiTranscribe, openaiModelInfo } from './openai.js';
import { anthropicChat, anthropicOn, anthropicModelInfo } from './anthropic.js';
import { elevenSpeech, elevenOn, elevenModelInfo, DEFAULT_MODEL as ELEVEN_DEFAULT } from './elevenlabs.js';

const env = process.env;
const HEALTH = path.join(DIRS.data, 'ai-health.json');
const DAY = 86400000;
export const JOBS = {
  writer: 'Writing scripts', hooks: 'Writing openings', critic: 'Ranking drafts', coach: 'The coach',
  quick: 'Quick checks', vision: 'Checking footage', voice: 'Voiceovers', timing: 'Voice timing',
};
const list = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
export const parseRung = s => { const t = String(s).trim(), i = t.indexOf(':'); return i > 0 && /^(openai|anthropic|elevenlabs)$/.test(t.slice(0, i)) ? { provider: t.slice(0, i), model: t.slice(i + 1) } : { provider: 'openai', model: t }; };
export const rungKey = r => `${r.provider}:${r.model}`;
const PROVIDER = { openai: 'OpenAI', anthropic: 'Anthropic', elevenlabs: 'ElevenLabs' };
// OpenAI is always on the list: without its key, its "missing key" error is what you see if nothing else is set up.
const providerOn = p => (p === 'openai' ? true : p === 'anthropic' ? anthropicOn() : p === 'elevenlabs' ? elevenOn() : false);

// The backups after each job's first choice. OpenAI's own recommended replacement first (October 2026:
// gpt-6-luna for text; it named no replacement that works for plain speech), then another company.
const BACKUPS = {
  writer: ['gpt-6-luna', 'anthropic:claude-sonnet-5-5'], hooks: ['gpt-6-luna', 'anthropic:claude-sonnet-5-5'],
  critic: ['gpt-6-luna', 'anthropic:claude-sonnet-5-5'], coach: ['gpt-6-luna', 'anthropic:claude-sonnet-5-5'],
  quick: ['gpt-6-luna', 'anthropic:claude-haiku-5-5'], vision: ['gpt-6-luna', 'anthropic:claude-haiku-5-5'],
  voice: ['tts-1', `elevenlabs:${env.ELEVENLABS_MODEL || ELEVEN_DEFAULT}`], timing: [],
};
export const DEFAULT_MODEL = 'gpt-4o';
function firstChoice(job) {
  const writer = env.OPENAI_MODEL || DEFAULT_MODEL;
  return {
    writer, hooks: env.OPENAI_HOOK_MODEL || writer, critic: env.OPENAI_CRITIC_MODEL || writer, coach: env.OPENAI_COACH_MODEL || writer,
    quick: env.OPENAI_QUICK_MODEL || 'gpt-4o-mini', vision: env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
    voice: env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts', timing: env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1',
  }[job];
}
// Every rung of a job, in order, whether or not its company is set up (for Admin and the daily check).
export function fullLadder(job) {
  if (!JOBS[job]) throw new Error(`Unknown AI job: ${job}`);
  const set = list(env[`AI_LADDER_${job.toUpperCase()}`]);
  const raw = set.length ? set : [firstChoice(job), ...BACKUPS[job]];
  const seen = new Set();
  return raw.map(parseRung).filter(r => r.model && !seen.has(rungKey(r)) && seen.add(rungKey(r)));
}
// The rungs that can be used here (their company's key is set).
export const ladder = job => fullLadder(job).filter(r => providerOn(r.provider));
// The model a job uses first (for the golden set's labels and Admin).
export const modelFor = (job = 'writer') => (ladder(job)[0] || fullLadder(job)[0])?.model || '';

/* ---------------- Health: retired models and step-downs ---------------- */
export const health = () => readJSON(HEALTH, { rungs: {}, alerted: {} });
const setRung = (key, patch) => updateJSON(HEALTH, { rungs: {}, alerted: {} }, h => ({ ...h, rungs: { ...h.rungs, [key]: { ...(h.rungs?.[key] || {}), ...patch } } }));
// Gone for a day: after that it's tried again (a model can come back, or a 404 can be a blip).
const isGone = (r, now = Date.now()) => { const x = health().rungs?.[rungKey(r)]; return !!x?.gone && now - Date.parse(x.goneAt || 0) < DAY; };
// Once a day per key at most.
function alertOnce(key, alert, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  let fresh = false;
  updateJSON(HEALTH, { rungs: {}, alerted: {} }, h => { if (h.alerted?.[key] === day) return h; fresh = true; return { ...h, alerted: { ...(h.alerted || {}), [key]: day } }; });
  if (fresh) notify(alert, now);
  return fresh;
}
// The model doesn't exist (any more) for this account.
export const isGoneError = e => e instanceof AIError && (e.code === 'model_not_found' || ((e.status === 404 || e.status === 400) && /model/i.test(e.message) && /does not exist|not found|no longer|deprecated|retired|shut ?down|isn’t available|is not available|not available/i.test(e.message)));
// The company can't do it right now (down, or the account is out of credit / rejected): try another company.
const isCompanyProblem = e => e instanceof AIError && (e.outage || e.code === 'insufficient_quota' || e.status === 401 || e.code === 'config');

function markGone(r, e, job) {
  setRung(rungKey(r), { gone: true, goneAt: new Date().toISOString(), reason: String(e.message).slice(0, 200) });
  alertOnce(`gone:${rungKey(r)}`, { level: 'error', kind: 'server', title: `${PROVIDER[r.provider]} no longer offers ${r.model}`, text: `It answered: ${String(e.message).slice(0, 140)}`, did: `${JOBS[job]} moved to the next model on its list, and this one is skipped for a day.`, run: 'Choose the replacement in .env (SETUP.md section AK), after running the golden set with it.' });
}
function noteStepDown(job, from, to, why) {
  setRung(rungKey(to), { lastUsedAt: new Date().toISOString(), lastStepDownFor: job });
  alertOnce(`step:${job}:${rungKey(to)}`, { level: 'warning', kind: 'server', title: `${JOBS[job]} used a backup model today`, text: `${to.model} (${PROVIDER[to.provider]}) was used because ${from.model} (${PROVIDER[from.provider]}) ${why}.`, did: 'Used the backup so nothing waited; the first choice is tried first again on the next call.', run: '' });
}
const whyOf = e => (isGoneError(e) ? 'is no longer available' : e?.code === 'insufficient_quota' ? 'is out of credit' : e?.status === 401 || e?.code === 'config' ? 'rejected the key' : 'wasn’t answering');

// Runs `call(rung)` down a job's ladder. `start`: rungs to put first (an explicit model).
async function climb(job, call, { start = [], only = null } = {}) {
  let rungs = only ? [only] : [...start, ...ladder(job)].filter((r, i, a) => a.findIndex(x => rungKey(x) === rungKey(r)) === i);
  if (!rungs.length) throw new AIError(`No AI company is set up for ${JOBS[job].toLowerCase()} (add OPENAI_API_KEY to .env).`, { code: 'config' });
  const usable = rungs.filter(r => !isGone(r));
  if (usable.length) rungs = usable;
  let last = null, outage = null, first = rungs[0];
  const skipped = new Set();
  for (const r of rungs) {
    if (skipped.has(r.provider)) continue;
    // That company's breaker is open (it kept failing): skip it without waiting on its timeouts.
    if (!breaker.allow(r.provider)) {
      const e = new AIError(`${PROVIDER[r.provider]} isn’t answering right now (paused for a few minutes).`, { retry: true, outage: true });
      last = e; outage ||= e; skipped.add(r.provider);
      continue;
    }
    const t0 = Date.now();
    try {
      const out = await call(r);
      flightService(r.provider, { ms: Date.now() - t0, ok: true, detail: `${job}: ${r.model}` });
      breaker.success(r.provider);
      if (last) noteStepDown(job, first, r, whyOf(last));
      return { ...out, rung: r };
    } catch (e) {
      flightService(r.provider, { ms: Date.now() - t0, ok: false, detail: `${job}: ${r.model}` });
      breaker.failure(r.provider, e);
      if (isGoneError(e)) { markGone(r, e, job); last = e; continue; }
      if (isCompanyProblem(e)) { last = e; outage ||= e.outage ? e : null; skipped.add(r.provider); continue; }
      throw e;
    }
  }
  // If any company was only down for now, that's what's reported: the video waits it out and goes
  // again, instead of failing for good on a backup company's key or credit.
  throw outage || last;
}

/* ---------------- What the rest of the app calls ---------------- */
// A JSON reply. Returns the text (as before). `model`: try this one first (then the job's ladder).
export async function chatJSON({ messages, model, job = 'writer', temperature = 0.8, maxTokens, meter, schema = null }) {
  const out = await climb(job, r => (r.provider === 'anthropic' ? anthropicChat(r.model, { messages, temperature, maxTokens, schema }) : openaiChat(r.model, { messages, temperature, maxTokens, schema })),
    { start: model ? [parseRung(model)] : [] });
  meter?.chat(out.rung.model, out.usage);
  return out.text;
}
// A voiceover. Returns { audio, model, words? } (words: when the voice company times them itself).
// `rung`: use exactly this one (so every scene of a video has the same voice).
export async function speech({ input, voice = 'coral', instructions = '', rung = null }) {
  const out = await climb('voice', async r => (r.provider === 'elevenlabs'
    ? await elevenSpeech(r.model, { input, voice })
    : { audio: await openaiSpeech(r.model, { input, voice, instructions }) }), { only: rung });
  return { audio: out.audio, model: out.rung.model, words: out.words || null, rung: out.rung };
}
// Word timings for a voiceover take (OpenAI's whisper-1 is the one that gives them).
export async function transcribeWords({ file, meter = null }) {
  const out = await climb('timing', async r => openaiTranscribe({ file, model: r.model, meter }));
  return { words: out.words, duration: out.duration, text: out.text || '' };
}

/* ---------------- The daily check ---------------- */
const infoFor = r => (r.provider === 'anthropic' ? anthropicModelInfo(r.model) : r.provider === 'elevenlabs' ? elevenModelInfo(r.model) : openaiModelInfo(r.model));
export const WARN_DAYS = 90;
// Asks each company about every model on every ladder. Returns [{ job, rung, ok|gone|unknown, shutdownDate }].
export async function checkModels(now = Date.now()) {
  const seen = new Map();
  for (const job of Object.keys(JOBS)) {
    for (const r of ladder(job)) {
      if (!seen.has(rungKey(r))) seen.set(rungKey(r), { r, jobs: [] });
      seen.get(rungKey(r)).jobs.push(job);
    }
  }
  const out = [];
  for (const { r, jobs } of seen.values()) {
    const info = await infoFor(r);
    const at = new Date(now).toISOString();
    if (info.gone) setRung(rungKey(r), { gone: true, goneAt: at, reason: 'Not on the company’s list of models', checkedAt: at });
    else if (info.ok) setRung(rungKey(r), { gone: false, checkedAt: at, shutdownDate: info.shutdownDate || '' });
    else setRung(rungKey(r), { checkedAt: at, checkError: info.error || '' });
    out.push({ rung: rungKey(r), jobs, ...info });
    const firstFor = jobs.filter(j => rungKey(ladder(j)[0] || {}) === rungKey(r));
    if (info.gone && firstFor.length) {
      alertOnce(`gone:${rungKey(r)}`, { level: 'error', kind: 'server', title: `${PROVIDER[r.provider]} no longer offers ${r.model}`, text: `It isn’t on ${PROVIDER[r.provider]}’s list of models any more.`, did: `${firstFor.map(j => JOBS[j]).join(', ')} will use the next model on the list (${firstFor.map(j => ladder(j)[1]?.model || 'none set up').join(', ')}).`, run: 'Choose the replacement in .env (SETUP.md section AK), after running the golden set with it.' }, now);
    }
    const left = info.shutdownDate ? Math.ceil((Date.parse(`${info.shutdownDate}T00:00:00Z`) - now) / DAY) : null;
    if (left !== null && left <= WARN_DAYS && firstFor.length) {
      const next = firstFor.map(j => `${JOBS[j]} → ${ladder(j).find(x => rungKey(x) !== rungKey(r))?.model || 'nothing (add a backup)'}`).join('; ');
      alertOnce(`shutdown:${rungKey(r)}:${new Date(now).toISOString().slice(0, 7)}`, { level: left <= 30 ? 'error' : 'warning', kind: 'server', title: `${PROVIDER[r.provider]} will remove ${r.model} on ${info.shutdownDate}`, text: `${left} days left.`, did: `Nothing yet: after that date the app moves on by itself (${next}).`, run: 'To choose the replacement yourself: run the golden set with the new model, then set it in .env (SETUP.md section AK).' }, now);
    }
  }
  return out;
}
// Each job's ladder with what's known about every rung (Admin and `node admin.js models`).
export function overview() {
  const h = health().rungs || {};
  return Object.entries(JOBS).map(([job, label]) => ({
    job, label,
    rungs: fullLadder(job).map(r => ({ key: rungKey(r), provider: r.provider, model: r.model, on: providerOn(r.provider), ...(h[rungKey(r)] || {}) })),
  }));
}
