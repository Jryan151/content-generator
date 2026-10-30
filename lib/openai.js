// lib/openai.js — the OpenAI calls the generator makes, over plain HTTPS (no SDK).
// Retries on rate limits, server errors and dropped connections.
import { jobSignal, checkStopped } from './proc.js';
const base = () => (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Waits 1.5s, 4.5s, 13.5s… with ±25% jitter (so parallel calls don't retry in lockstep), at most 20s.
const RETRY_BASE = () => Number(process.env.RETRY_BASE_MS) || 1500;   // tests set this low
export const backoff = (i, retryAfterMs = 0) => Math.min(20000, retryAfterMs || RETRY_BASE() * 3 ** i * (0.75 + Math.random() * 0.5));
// Plain words for the errors you can fix in your OpenAI account; the rest keep OpenAI's message.
function plain(status, code, msg) {
  if (code === 'insufficient_quota') return 'OpenAI: your account is out of credit or over its monthly limit. Add credit or raise the limit at platform.openai.com → Settings → Billing / Limits.';
  if (status === 401) return 'OpenAI rejected the API key. Check OPENAI_API_KEY in .env (and that the key wasn’t deleted), then restart.';
  if (status === 404 && /model/i.test(msg)) return `OpenAI: that model isn’t available to your account (${msg}). Check OPENAI_MODEL in .env.`;
  return `OpenAI ${status}: ${msg}`;
}

export class AIError extends Error {
  // `outage`: OpenAI itself didn't answer (network, timeout, rate limit, its servers): a video waits it out.
  constructor(msg, { status = 0, retry = false, code = '', outage = false } = {}) {
    super(msg); this.status = status; this.retry = retry; this.code = code; this.outage = outage;
    // A bad key or an empty account won't fix itself: the job queue doesn't try the video again.
    this.permanent = !retry && (status === 401 || code === 'insufficient_quota' || code === 'config');
  }
}

async function post(route, body, { timeout = 90000, tries = 3 } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new AIError('OPENAI_API_KEY is missing from .env', { code: 'config' });
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(base() + route, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: jobSignal(Number(process.env.OPENAI_TIMEOUT_MS) > 0 ? Number(process.env.OPENAI_TIMEOUT_MS) : timeout),
      });
      if (res.ok) return res;
      const text = await res.text();
      let msg = text.slice(0, 300), code = '';
      try { const j = JSON.parse(text); msg = j.error?.message || msg; code = j.error?.code || j.error?.type || ''; } catch {}
      // Out of credit or a bad key won't fix itself; don't retry those.
      const retry = (res.status === 429 && code !== 'insufficient_quota') || res.status >= 500;
      last = new AIError(plain(res.status, code, msg), { status: res.status, retry, code, outage: retry });
      if (!retry || i === tries - 1) throw last;
      await sleep(backoff(i, Number(res.headers.get('retry-after')) * 1000));
    } catch (e) {
      checkStopped();   // the job was stopped: don't retry, don't call it an outage
      if (e instanceof AIError && !e.retry) throw e;
      last = e instanceof AIError ? e : new AIError(`OpenAI request failed: ${e.name === 'TimeoutError' ? 'no answer in time' : e.message || e}`, { retry: true, outage: true });
      if (i === tries - 1) break;   // no pointless wait after the last try
      await sleep(backoff(i));
    }
  }
  throw last;
}

// Low-level OpenAI calls. Which model does which job, and what happens when one is retired or down,
// is decided in lib/ai.js (the model ladders); everything else calls lib/ai.js.

// Models change what they accept over time (newer ones refuse `temperature`, or want
// max_completion_tokens). A refusal of a parameter is remembered per model and the call goes again
// without it, so a model swap never breaks every video.
const dropParams = new Map();   // model → Set of parameters it refused
const noSchema = new Set();
export const structuredOn = () => !/^(off|0|false|no)$/i.test(String(process.env.OPENAI_STRUCTURED || 'on'));
// Only "this model doesn't support it" falls back. An invalid schema is our bug: it's reported, not hidden.
const schemaUnsupported = e => e instanceof AIError && e.status === 400 && /response_format|json_schema|structured/i.test(e.message) && /not supported|unsupported|does not support|isn't supported|is not available/i.test(e.message);
// "Unsupported parameter: 'temperature'…" / "'max_tokens' is not supported with this model…"
export function refusedParam(e) {
  if (!(e instanceof AIError) || e.status !== 400) return '';
  const m = /(?:unsupported (?:parameter|value)|not supported|does not support|isn't supported|unrecognized request argument)[^'"`]*['"`]?(temperature|max_tokens|max_completion_tokens|reasoning_effort|top_p)/i.exec(e.message)
    || /['"`](temperature|max_tokens|max_completion_tokens|reasoning_effort|top_p)['"`][^.]*(?:not supported|unsupported|does not support|isn't supported|only the default)/i.exec(e.message);
  return m ? m[1].toLowerCase() : '';
}

// One chat completion that must return JSON. Returns { text, usage }.
export async function openaiChat(model, { messages, temperature = 0.8, maxTokens, schema = null }) {
  const refused = dropParams.get(model) || new Set();
  const strict = schema && structuredOn() && !noSchema.has(model);
  const build = () => {
    const body = { model, messages, response_format: strict && !noSchema.has(model) ? { type: 'json_schema', json_schema: { name: schema.name, strict: true, schema: schema.schema } } : { type: 'json_object' } };
    if (!refused.has('temperature')) body.temperature = temperature;
    // Newer models want max_completion_tokens instead of max_tokens.
    if (maxTokens && !refused.has('max_tokens')) body.max_tokens = maxTokens;
    else if (maxTokens && !refused.has('max_completion_tokens')) body.max_completion_tokens = maxTokens;
    return body;
  };
  // An empty or cut-off reply (it happens under load) gets one more try; a refused parameter or an
  // unsupported schema is dropped and the call goes again (at most a few times).
  for (let attempt = 0, fixes = 0; ; attempt++) {
    let res;
    try { res = await post('/chat/completions', build()); }
    catch (e) {
      const param = refusedParam(e);
      if (param && fixes < 3 && !refused.has(param)) {
        refused.add(param); dropParams.set(model, refused); fixes++; attempt--;
        console.warn(`[openai] ${model} doesn't accept ${param}; leaving it out from now on.`);
        continue;
      }
      if (strict && schemaUnsupported(e) && !noSchema.has(model)) {
        noSchema.add(model); fixes++; attempt--;
        console.warn(`[openai] ${model} doesn't support structured outputs; using JSON mode for it from now on.`);
        continue;
      }
      throw e;
    }
    const data = await res.json().catch(() => ({}));
    const text = data.choices?.[0]?.message?.content;
    if (text) return { text, usage: data.usage || {} };
    if (attempt >= 1) throw new AIError('OpenAI returned an empty reply twice. Try again in a minute.', { retry: true });
    await sleep(backoff(0));
  }
}

// Text to speech on one model. Returns an MP3 buffer. Newer voice models take speaking-style instructions.
export async function openaiSpeech(model, { input, voice = 'coral', instructions = '' }) {
  const res = await post('/audio/speech', { model, voice, input, response_format: 'mp3', ...(instructions && model !== 'tts-1' ? { instructions } : {}) }, { timeout: 60000 });
  return Buffer.from(await res.arrayBuffer());
}

// Is this model still offered? { ok, shutdownDate } | { gone: true } | { unknown: true, error }.
// OpenAI lists a shutdown_date on models it has scheduled for removal.
export async function openaiModelInfo(model) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { unknown: true, error: 'OPENAI_API_KEY is missing' };
  try {
    const res = await fetch(`${base()}/models/${encodeURIComponent(model)}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
    if (res.status === 404) return { gone: true };
    if (!res.ok) return { unknown: true, error: `OpenAI ${res.status}` };
    const d = await res.json().catch(() => ({}));
    return { ok: true, shutdownDate: dateOf(d.shutdown_date ?? d.deprecation?.shutdown_date) };
  } catch (e) { return { unknown: true, error: e.message }; }
}
// A shutdown date as YYYY-MM-DD, from seconds, milliseconds or a date string.
export function dateOf(x) {
  if (x === null || x === undefined || x === '') return '';
  const n = Number(x);
  const t = Number.isFinite(n) && n > 0 ? (n < 1e11 ? n * 1000 : n) : Date.parse(String(x));
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '';
}

// Speech to text with a start and end time for every word (whisper-1 supports word timestamps).
// Used to cut one voiceover take into scenes and to time word-by-word captions to the voice.
// Returns { words: [{ word, start, end }], duration }.
export async function transcribeWords({ file, model = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1', meter = null }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new AIError('OPENAI_API_KEY is missing from .env', { code: 'config' });
  const fs = await import('fs');
  const buf = fs.readFileSync(file);
  let last;
  for (let i = 0; i < 2; i++) {
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'audio/mpeg' }), 'voice.mp3');
    form.append('model', model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    try {
      const res = await fetch(base() + '/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: jobSignal(60000) });
      if (!res.ok) { last = new AIError(`OpenAI ${res.status} on transcription`, { status: res.status, retry: res.status === 429 || res.status >= 500 }); if (!last.retry) throw last; }
      else {
        const data = await res.json();
        const words = (data.words || []).map(w => ({ word: String(w.word || ''), start: Number(w.start), end: Number(w.end) })).filter(w => w.word && Number.isFinite(w.start) && Number.isFinite(w.end));
        meter?.stt?.(model, Number(data.duration) || 0);
        return { words, duration: Number(data.duration) || 0, text: String(data.text || '').trim() };
      }
    } catch (e) { checkStopped(); if (e instanceof AIError && !e.retry) throw e; last = e; }
    await sleep(backoff(i));
  }
  throw last;
}
