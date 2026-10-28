// lib/golden.js — the golden set: the same video ideas written again after every prompt or model
// change, so you can compare the writing before and after instead of judging one lucky script.
//
//   node admin.js golden <workspaceId> [--label before] [--count 12]
//   OPENAI_MODEL=<other model> node admin.js golden <workspaceId> --label new-model
//   node admin.js golden-compare <fileA.json> <fileB.json>      → a side-by-side page to read
//
// Each case is a fixed random seed, so case 3 is always the same audience, worry, fact, format and
// structure for a given setup. Only the writing changes. Runs cost a test script each (~1 cent).
import fs from 'fs';
import path from 'path';
import { DIRS } from './paths.js';
import { roll, FORMATS, STRUCTURES } from '../mixer-core.js';
import { modelFor } from './ai.js';

export const GOLDEN_DIR = () => path.join(DIRS.data, 'golden');
const seeded = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// The fixed cases for a setup: same seeds every time.
export function goldenCases(cfg, count = 12) {
  return Array.from({ length: count }, (_, k) => ({ k, picks: roll(cfg, seeded(7001 + k), [], {}) })).filter(c => c.picks.insight);
}

const slug = s => String(s || 'run').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'run';

// Writes every case (no video, no post text) and saves the run. `generate` is stages/script.js
// generateScript (passed in so tests can use a stand-in).
export async function runGolden({ cfg, generate, count = 12, label = '', meter = null, log = console.log, now = new Date() }) {
  const cases = goldenCases(cfg, count);
  const out = [];
  for (const c of cases) {
    const p = c.picks, base = { k: c.k, format: p.format, structure: p.structure, topic: p.painPoint?.text || '', fact: p.insight?.text || '', audience: p.audience?.text || '' };
    try {
      const r = await generate({ cfg: { ...cfg, output: { ...cfg.output, drafts: Math.max(2, cfg.output.drafts) } }, picks: { ...p, recent: [] }, recent: [], examples: [], winners: [], meter, log: () => {}, withPost: false });
      out.push({ ...base, ok: true, scenes: r.scenes.map(s => s.say || s.text), scores: r.scores || null, chosen: r.chosen });
      log(`Case ${c.k + 1}: ${FORMATS[p.format]?.label || p.format} · ${STRUCTURES[p.structure]?.label || p.structure} · ok`);
    } catch (e) {
      out.push({ ...base, ok: false, error: e.message.slice(0, 300) });
      log(`Case ${c.k + 1}: failed (${e.message.slice(0, 120)})`);
    }
  }
  const run = { label: label || 'run', at: now.toISOString(), models: { writer: modelFor('writer'), hooks: modelFor('hooks'), critic: modelFor('critic') }, cases: out };
  fs.mkdirSync(GOLDEN_DIR(), { recursive: true });
  const file = path.join(GOLDEN_DIR(), `${now.toISOString().slice(0, 16).replace(/[:T]/g, '-')}-${slug(label)}.json`);
  fs.writeFileSync(file, JSON.stringify(run, null, 2));
  return { file, run };
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const avg = (cases, key) => { const v = cases.flatMap(c => (c.scores || []).filter(s => s.draft === c.chosen).map(s => Number(s[key]))).filter(Number.isFinite); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '–'; };

// A plain page with both runs side by side, case by case. Read it with sound off: which column
// would you approve?
export function compareHtml(a, b) {
  const head = r => `<th>${esc(r.label)}<br><small>${esc(r.models.writer)} · critic ${esc(r.models.critic)} · ${esc(r.at.slice(0, 16).replace('T', ' '))}</small></th>`;
  const cell = c => (!c ? '<td class="none">—</td>' : c.ok ? `<td><ol>${c.scenes.map(l => `<li>${esc(l)}</li>`).join('')}</ol></td>` : `<td class="err">Didn’t pass the checks: ${esc(c.error)}</td>`);
  const ks = [...new Set([...a.cases, ...b.cases].map(c => c.k))].sort((x, y) => x - y);
  const rows = ks.map(k => {
    const x = a.cases.find(c => c.k === k), y = b.cases.find(c => c.k === k), any = x || y;
    return `<tr><td class="case"><b>Case ${k + 1}</b><br>${esc(FORMATS[any.format]?.label || any.format)} · ${esc(STRUCTURES[any.structure]?.label || any.structure || 'Classic')}<br><small>${esc(any.topic)}</small><br><small class="muted">Fact: ${esc(any.fact)}</small></td>${cell(x)}${cell(y)}</tr>`;
  }).join('');
  const sum = r => `${r.cases.filter(c => c.ok).length}/${r.cases.length} passed · critic averages: hook ${avg(r.cases, 'hook')}, flow ${avg(r.cases, 'flow')}, fresh ${avg(r.cases, 'fresh')}`;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Golden set: ${esc(a.label)} vs ${esc(b.label)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:24px auto;max-width:1100px;padding:0 16px;color:#1b1d22}table{border-collapse:collapse;width:100%}td,th{border-top:1px solid #ddd;padding:10px;vertical-align:top;text-align:left}th{background:#f4f4f6}.case{width:22%}ol{margin:0;padding-left:20px}small{color:#5c616b}.err{color:#a1281c}.none{color:#999}@media(max-width:700px){td,th{display:block}}</style>
<h1>Golden set</h1><p>Same video ideas, written by each run. Read each row and ask which script you’d approve. The critic’s numbers are a hint, not the verdict.</p>
<p><b>${esc(a.label)}:</b> ${sum(a)}<br><b>${esc(b.label)}:</b> ${sum(b)}</p>
<table><thead><tr><th>Video idea</th>${head(a)}${head(b)}</tr></thead><tbody>${rows}</tbody></table>`;
}
