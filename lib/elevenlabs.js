// lib/elevenlabs.js — ElevenLabs as a second voice company (optional; off unless ELEVENLABS_API_KEY
// and a voice are set). lib/ai.js uses it as the backup rung for voiceovers: OpenAI is retiring its
// speech models (tts-1 and gpt-4o-mini-tts on January 6, 2027).
//
// It reads with timestamps: each character's start and end come back with the audio, so the single-take
// voiceover is cut into scenes, and word-by-word captions are timed, without a transcription.
//
//   .env: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID (the voice to use), optionally
//         ELEVENLABS_VOICES={"coral":"<voice id>","sage":"<voice id>"} to match each Brand voice,
//         ELEVENLABS_MODEL (default eleven_multilingual_v2), ELEVENLABS_PRICE_PER_1K_CHARS (for the cost meter)
import { AIError, backoff } from './openai.js';
import { jobSignal, checkStopped } from './proc.js';

const env = process.env;
const base = () => (env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io/v1').replace(/\/$/, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const DEFAULT_MODEL = 'eleven_multilingual_v2';
function voices() { try { return JSON.parse(env.ELEVENLABS_VOICES || '{}'); } catch { return {}; } }
// The ElevenLabs voice for one of the app's voice names (Brand → Voice), or the default one.
export const voiceFor = name => String(voices()[name] || env.ELEVENLABS_VOICE_ID || '');
export const elevenOn = () => !!(env.ELEVENLABS_API_KEY && (env.ELEVENLABS_VOICE_ID || Object.keys(voices()).length));

// Characters with times → words with times: [{ word, start, end }], the same shape a transcription gives.
export function wordsFrom(alignment) {
  const ch = alignment?.characters || [], st = alignment?.character_start_times_seconds || [], en = alignment?.character_end_times_seconds || [];
  const out = [];
  let cur = null;
  ch.forEach((c, i) => {
    if (/\s/.test(c)) { if (cur) { out.push(cur); cur = null; } return; }
    if (!cur) cur = { word: '', start: Number(st[i]) || 0, end: Number(en[i]) || 0 };
    cur.word += c; cur.end = Number(en[i]) || cur.end;
  });
  if (cur) out.push(cur);
  return out.filter(w => /\w/.test(w.word));
}

// Returns { audio: Buffer (MP3), words, duration }.
export async function elevenSpeech(model = env.ELEVENLABS_MODEL || DEFAULT_MODEL, { input, voice = '' }) {
  if (!env.ELEVENLABS_API_KEY) throw new AIError('ELEVENLABS_API_KEY is missing from .env', { code: 'config' });
  const id = voiceFor(voice);
  if (!id) throw new AIError('No ElevenLabs voice is set (ELEVENLABS_VOICE_ID in .env).', { code: 'config' });
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${base()}/text-to-speech/${encodeURIComponent(id)}/with-timestamps?output_format=mp3_44100_128`, {
        method: 'POST', headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input, model_id: model }), signal: jobSignal(90000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.audio_base64) {
        const words = wordsFrom(data.alignment);
        return { audio: Buffer.from(data.audio_base64, 'base64'), words, duration: words.length ? words[words.length - 1].end : 0 };
      }
      const msg = (Array.isArray(data.detail) ? data.detail.map(d => d.msg).join('; ') : data.detail?.message || data.detail) || `HTTP ${res.status}`;
      const retry = res.status === 429 || res.status >= 500;
      const code = res.status === 401 ? 'config' : /quota|credits|character limit/i.test(String(msg)) ? 'insufficient_quota' : /model/i.test(String(msg)) && [400, 404, 422].includes(res.status) ? 'model_not_found' : '';
      last = new AIError(`ElevenLabs ${res.status}: ${String(msg).slice(0, 200)}`, { status: res.status, retry, code, outage: retry });
      if (!retry || i === 2) throw last;
      await sleep(backoff(i));
    } catch (e) {
      checkStopped();
      if (e instanceof AIError && !e.retry) throw e;
      last = e instanceof AIError ? e : new AIError(`ElevenLabs request failed: ${e.name === 'TimeoutError' ? 'no answer in time' : e.message}`, { retry: true, outage: true });
      if (i === 2) break;
      await sleep(backoff(i));
    }
  }
  throw last;
}

export async function elevenModelInfo(model) {
  if (!env.ELEVENLABS_API_KEY) return { unknown: true, error: 'ELEVENLABS_API_KEY is missing' };
  try {
    const res = await fetch(`${base()}/models`, { headers: { 'xi-api-key': env.ELEVENLABS_API_KEY }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { unknown: true, error: `ElevenLabs ${res.status}` };
    const list = await res.json().catch(() => []);
    return (Array.isArray(list) ? list : []).some(m => m.model_id === model) ? { ok: true, shutdownDate: '' } : { gone: true };
  } catch (e) { return { unknown: true, error: e.message }; }
}
