// lib/anthropic.js — Claude (Anthropic) as a second company for the writing, coaching and vision jobs,
// over plain HTTPS (no SDK). Off unless ANTHROPIC_API_KEY is set. lib/ai.js uses it as a backup rung
// on each job's ladder: when OpenAI is down, out of credit, or retires a model, the work carries on.
//
// Requests arrive in OpenAI's shape (system/user messages, image_url parts) and are translated here.
import { AIError, backoff } from './openai.js';
import { jobSignal, checkStopped } from './proc.js';

const base = () => (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/$/, '');
const VERSION = '2023-06-01';
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const anthropicOn = () => !!process.env.ANTHROPIC_API_KEY;
const headers = () => ({ 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': VERSION, 'content-type': 'application/json' });

// OpenAI-style content (a string, or parts with text and image_url) → Claude content blocks.
function blocks(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return (content || []).map(part => {
    if (part.type === 'text') return { type: 'text', text: part.text };
    if (part.type === 'image_url') {
      const url = String(part.image_url?.url || '');
      const m = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/.exec(url);
      return m ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } } : { type: 'image', source: { type: 'url', url } };
    }
    return { type: 'text', text: JSON.stringify(part) };
  });
}
export function toClaude(messages) {
  const system = messages.filter(m => m.role === 'system').map(m => (typeof m.content === 'string' ? m.content : blocks(m.content).map(b => b.text || '').join('\n'))).join('\n\n');
  const rest = [];
  for (const m of messages.filter(x => x.role !== 'system')) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const last = rest[rest.length - 1];
    if (last && last.role === role) last.content.push(...blocks(m.content));   // Claude wants turns to alternate
    else rest.push({ role, content: blocks(m.content) });
  }
  return { system, messages: rest };
}
// The JSON in a reply (Claude may wrap it in a code fence or a sentence when no schema is enforced).
export function jsonIn(text) {
  const t = String(text || '').trim();
  try { JSON.parse(t); return t; } catch { /* look inside */ }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(t)?.[1];
  if (fenced) { try { JSON.parse(fenced.trim()); return fenced.trim(); } catch { /* keep looking */ } }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { const s = t.slice(a, b + 1); try { JSON.parse(s); return s; } catch { /* no JSON */ } }
  return '';
}

const refused = new Map();   // model → parameters it refused (like temperature with thinking on)
async function send(body, { timeout = 90000, tries = 3 } = {}) {
  if (!anthropicOn()) throw new AIError('ANTHROPIC_API_KEY is missing from .env', { code: 'config' });
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${base()}/messages`, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal: jobSignal(timeout) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return data;
      const msg = data.error?.message || `HTTP ${res.status}`, type = data.error?.type || '';
      const retry = res.status === 429 || res.status === 529 || res.status >= 500;
      const code = res.status === 404 && /model/i.test(msg) ? 'model_not_found' : /credit balance|billing/i.test(msg) ? 'insufficient_quota' : type;
      last = new AIError(`Anthropic ${res.status}: ${msg}`, { status: res.status, retry, code, outage: retry });
      if (!retry || i === tries - 1) throw last;
      await sleep(backoff(i, Number(res.headers.get('retry-after')) * 1000));
    } catch (e) {
      checkStopped();
      if (e instanceof AIError && !e.retry) throw e;
      last = e instanceof AIError ? e : new AIError(`Anthropic request failed: ${e.name === 'TimeoutError' ? 'no answer in time' : e.message || e}`, { retry: true, outage: true });
      if (i === tries - 1) break;
      await sleep(backoff(i));
    }
  }
  throw last;
}

// One reply that must be JSON. Returns { text, usage } with usage in OpenAI's names (for the meter).
export async function anthropicChat(model, { messages, temperature = 0.8, maxTokens = 1500, schema = null }) {
  const { system, messages: msgs } = toClaude(messages);
  const no = refused.get(model) || new Set();
  for (let fixes = 0; ; fixes++) {
    const body = { model, max_tokens: Math.max(256, maxTokens || 1500), messages: msgs };
    if (system) body.system = `${system}\n\nReply with only a JSON object, no other text.`;
    else body.system = 'Reply with only a JSON object, no other text.';
    if (!no.has('temperature')) body.temperature = Math.min(1, Math.max(0, temperature));
    if (schema && !no.has('output_config')) body.output_config = { format: { type: 'json_schema', schema: schema.schema } };
    let data;
    try { data = await send(body); }
    catch (e) {
      const p = e.status === 400 && fixes < 3 ? (/temperature/i.test(e.message) ? 'temperature' : /output_config|json_schema|format/i.test(e.message) ? 'output_config' : '') : '';
      if (p && !no.has(p)) { no.add(p); refused.set(model, no); continue; }
      throw e;
    }
    const text = jsonIn((data.content || []).filter(b => b.type === 'text').map(b => b.text).join(''));
    const usage = { prompt_tokens: data.usage?.input_tokens || 0, completion_tokens: data.usage?.output_tokens || 0 };
    if (text) return { text, usage };
    if (data.stop_reason === 'refusal') throw new AIError('Claude declined this request.', { status: 400, code: 'refusal' });
    if (fixes >= 1) throw new AIError('Claude returned no JSON twice. Try again in a minute.', { retry: true });
  }
}

export async function anthropicModelInfo(model) {
  if (!anthropicOn()) return { unknown: true, error: 'ANTHROPIC_API_KEY is missing' };
  try {
    const res = await fetch(`${base()}/models/${encodeURIComponent(model)}`, { headers: headers(), signal: AbortSignal.timeout(15000) });
    if (res.status === 404) return { gone: true };
    if (!res.ok) return { unknown: true, error: `Anthropic ${res.status}` };
    return { ok: true, shutdownDate: '' };
  } catch (e) { return { unknown: true, error: e.message }; }
}
