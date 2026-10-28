// lib/usage.js — counts what each workspace uses and what it costs in AI calls.
// Costs are estimates from a price table (USD). Override with OPENAI_PRICES in .env, e.g.
//   OPENAI_PRICES={"gpt-4o":[2.5,10],"gpt-4o-mini":[0.15,0.6],"tts_per_min":0.015}
//
// Spend guard: each workspace has a monthly AI cost cap (AI_COST_CAP_USD in .env, or its own in
// Admin). At 80% you get an alert; at 100% the server stops starting anything that calls the AI
// for that workspace until the month turns over or the cap is raised. 0 means no cap.
import path from 'path';
import { readJSON, updateJSON, monthKey, dayKey } from './paths.js';
import { wsDir, getWorkspace } from './store.js';
import { notify } from './alerts.js';

const DEFAULT_PRICES = {
  // per 1M tokens: [input, output]
  'gpt-4o': [2.5, 10], 'gpt-4o-mini': [0.15, 0.6], 'gpt-4.1': [2, 8], 'gpt-4.1-mini': [0.4, 1.6], 'gpt-6-luna': [0.1, 0.5],
  // Claude (backup rungs, lib/ai.js), per 1M tokens, October 2026
  'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5],
  tts_per_min: 0.015,          // gpt-4o-mini-tts, per minute of audio
  stt_per_min: 0.006,          // whisper-1 transcription (single-take voiceover timing), per minute
  'tts-1_per_1m_chars': 15,
  eleven_per_1k_chars: 0.3,    // ElevenLabs (backup voice): depends on your plan; set ELEVENLABS_PRICE_PER_1K_CHARS
};
let prices = DEFAULT_PRICES;
try { if (process.env.OPENAI_PRICES) prices = { ...DEFAULT_PRICES, ...JSON.parse(process.env.OPENAI_PRICES) }; } catch { /* keep defaults */ }

const file = ws => path.join(wsDir(ws), 'usage.json');
const blank = () => ({ videos: 0, fixes: 0, scripts: 0, cost: 0, calls: 0 });

export function chatCost(model, usage = {}) {
  const key = Object.keys(prices).filter(k => Array.isArray(prices[k]) && String(model).startsWith(k)).sort((a, b) => b.length - a.length)[0];
  const [pin, pout] = prices[key] || prices['gpt-4o'];
  return ((usage.prompt_tokens || 0) * pin + (usage.completion_tokens || 0) * pout) / 1e6;
}
const elevenPrice = () => (Number(process.env.ELEVENLABS_PRICE_PER_1K_CHARS) > 0 ? Number(process.env.ELEVENLABS_PRICE_PER_1K_CHARS) : prices.eleven_per_1k_chars);
export const ttsCost = (model, seconds, chars) => (model === 'tts-1' ? (chars * prices['tts-1_per_1m_chars']) / 1e6
  : String(model).startsWith('eleven') ? (chars / 1000) * elevenPrice() : (seconds / 60) * prices.tts_per_min);

/* ---------------- Spend guard ---------------- */
export const DEFAULT_CAP_USD = 20;
export const WARN_AT = 0.8;
const amount = x => (x === null || x === undefined || String(x).trim() === '' || !Number.isFinite(Number(x)) ? null : Math.max(0, Number(x)));
// The default cap: AI_COST_CAP_USD, else $20. 0 = no cap.
export const defaultCap = () => amount(process.env.AI_COST_CAP_USD) ?? DEFAULT_CAP_USD;
// A workspace's cap: its Admin override (limits.aiCostUsd), else the default.
export const capFor = w => amount(w?.limits?.aiCostUsd) ?? defaultCap();
// This month's spend against the cap. `warn` from 80%, `over` from 100%.
export function spend(w, key = monthKey()) {
  const cost = w ? monthUsage(w.id, key).cost : 0, cap = capFor(w);
  return { cost, cap, custom: amount(w?.limits?.aiCostUsd) !== null, pct: cap ? Math.round((cost / cap) * 100) : 0, warn: cap > 0 && cost >= cap * WARN_AT, over: cap > 0 && cost >= cap };
}
export const usd = x => `$${Number(x || 0).toFixed(2)}`;
// Alerts you once per month per level (again if the cap changes), as the spend crosses 80% and 100%.
function checkSpend(wsId, m) {
  const w = getWorkspace(wsId);
  if (!w) return;
  const cap = capFor(w);
  if (!cap) return;
  const sent = (m.capAlerts ||= {});
  if (m.cost >= cap && sent.over !== cap) {
    sent.over = cap; sent.warn = cap;
    notify({ level: 'error', kind: 'spend', title: 'AI spend cap reached: generation paused', text: `${usd(m.cost)} of its ${usd(cap)} monthly AI cap.`, did: 'Paused new videos, test scripts and coach answers for this workspace until next month.', run: 'If it’s expected, raise the cap in Admin (its workspace card → AI cap).', ws: wsId, workspaceName: w.name });
  } else if (m.cost >= cap * WARN_AT && m.cost < cap && sent.warn !== cap) {
    sent.warn = cap;
    notify({ level: 'warning', kind: 'spend', title: 'AI spend at 80% of the monthly cap', text: `${usd(m.cost)} of its ${usd(cap)} monthly AI cap.`, did: `Nothing yet: it pauses by itself at ${usd(cap)}.`, run: 'If this is expected, raise the cap in Admin.', ws: wsId, workspaceName: w.name });
  }
}

// A meter is handed to every stage that calls the AI. Without a workspace it only adds up.
export function meter(ws = null) {
  let total = 0, calls = 0;
  const add = cost => {
    total += cost; calls++;
    if (ws) updateJSON(file(ws), {}, u => { const m = (u[monthKey()] ||= blank()); m.cost = Math.round((m.cost + cost) * 1e5) / 1e5; m.calls++; checkSpend(ws, m); });
  };
  return {
    chat: (model, usage) => add(chatCost(model, usage)),
    tts: (model, seconds, chars) => add(ttsCost(model, seconds, chars)),
    stt: (model, seconds) => add((seconds / 60) * prices.stt_per_min),
    get total() { return total; },
    get calls() { return calls; },
  };
}

// Counts: videos made, fixes, test scripts (also per day, for the daily test limit).
export function count(ws, kind, n = 1) {
  updateJSON(file(ws), {}, u => {
    const m = (u[monthKey()] ||= blank()); m[kind] = (m[kind] || 0) + n;
    if (kind === 'scripts') { u.days ||= {}; u.days[dayKey()] = (u.days[dayKey()] || 0) + n; Object.keys(u.days).sort().slice(0, -14).forEach(k => delete u.days[k]); }
  });
}
export const monthUsage = (ws, key = monthKey()) => ({ ...blank(), ...(readJSON(file(ws), {})[key] || {}) });
export const scriptsToday = ws => (readJSON(file(ws), {}).days || {})[dayKey()] || 0;
export const allUsage = ws => readJSON(file(ws), {});
