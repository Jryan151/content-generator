// Niche presets: everything insurance-specific lives in niches/life-insurance.js. The digest below pins
// the engine's output: 300 combinations of products, formats, modes and names → prompts (script, hooks,
// both critics, post), merged rules, the agent's role, and the checks' verdicts on scripts, hooks,
// posts and facts. v12 proved the niche move changed nothing (6eb45f36…). v13 changed the prompts on
// purpose (structures, bridge and CTA styles, per-scene style guidance, the critic's fresh score), so
// that was the v13 digest (7d7fbb9c…). v14 adds the shot plan (a FOOTAGE PLAN section and a per-shot
// footage search rule); with the plan removed the output is still exactly v13's. This is the v14 digest:
// a prompt change that isn't meant to happen fails here. Changing a prompt on purpose means updating it.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { tempEnv, client } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
tempEnv();
// A fixed day in a month with no calendar moment, so this month's seasons never change the pinned output.
const NOW = Date.parse('2026-10-15T18:00:00Z');
const BEFORE = 'f19082fcb341358bbd12a004bbd3ff7e88a67f05bf75b8b2c077be3871c9c02d';

test('niche: the engine’s output is byte-for-byte the pinned v14 output', async () => {
  const M = await import('../mixer-core.js');
  const P = await import('../lib/prompts.js');
  const { starterStory } = await import('../templates.js');
  const seeded = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [];
  const products = [['final_expense'], ['mortgage'], ['family'], ['final_expense', 'mortgage', 'family']];
  const scripts = [
    { scenes: [{ text: 'Everyone qualifies for this government program', accent: 'program', keyword: 'insurance money' }] },
    { scenes: [{ text: 'You will qualify with no medical exam', accent: 'policy', keyword: 'grandmother kitchen' }] },
    { scenes: [{ text: 'Most families can plan for this', accent: 'families', keyword: 'family dinner' }] },
  ];
  for (let k = 0; k < 300; k++) {
    const cfg = M.migrate(M.DEFAULT_CONFIG);
    cfg.story = { ...cfg.story, ...starterStory(products[k % 4]) };
    cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date(NOW - 86400000).toISOString(); });
    if (k % 3 === 0) { cfg.look.name = 'Jane Smith'; cfg.look.location = 'Gallup, NM'; }
    if (k % 5 === 0) cfg.look.title = 'Insurance Broker';
    cfg.output.mode = k % 2 ? 'voiceover' : 'captions';
    const picks = M.roll(cfg, seeded(k + 1), [], { format: cfg.output.formats[k % cfg.output.formats.length] }, NOW);
    if (!picks.insight) { out.push('noinsight'); continue; }
    const b = P.buildPrompt(cfg, picks);
    out.push(b.system, b.user, JSON.stringify(P.buildHookPrompt(cfg, picks)), JSON.stringify(P.buildCriticPrompt(cfg, picks, [{ scenes: [] }])), JSON.stringify(P.buildHookCriticPrompt(cfg, picks, ['a', 'b'])), JSON.stringify(P.buildPostPrompt(cfg, picks, [{ text: 'x' }])));
    out.push(JSON.stringify(M.guardrailsFor(cfg)), M.roleText(cfg));
    for (const s of scripts) out.push(JSON.stringify(M.validateScript(JSON.stringify(s), cfg, picks).problems || M.validateScript(JSON.stringify(s), cfg, picks)));
    out.push(JSON.stringify(M.validatePost(JSON.stringify({ caption: 'Medicare program guaranteed, everyone qualifies' }), cfg, picks)));
    out.push(JSON.stringify(M.validateHook({ text: 'Social Security never denied anyone can' }, cfg, picks)));
  }
  out.push(JSON.stringify(M.checkInsightText('The federal program always pays for everything guaranteed')), JSON.stringify(M.checkStoryText('My client got Medicare')));
  out.push(JSON.stringify(M.analyze(M.migrate(M.DEFAULT_CONFIG))));
  const d = crypto.createHash('sha256');
  for (const x of out) d.update(String(x) + '\u0000');
  assert.equal(d.digest('hex'), BEFORE);
});

test('niche: workspaces default to life insurance, and the platform floor still can’t be removed', async () => {
  const M = await import('../mixer-core.js');
  const { NICHES, nicheOf } = await import('../niches/index.js');
  const cfg = M.migrate(M.DEFAULT_CONFIG);
  assert.equal(cfg.niche, 'life_insurance');
  assert.equal(M.migrate({ ...cfg, niche: 'made_up' }).niche, 'life_insurance', 'unknown niches fall back');
  const old = { ...cfg }; delete old.niche;
  assert.equal(M.migrate(old).niche, 'life_insurance', 'existing agents get it automatically');
  assert.equal(nicheOf({}), NICHES.life_insurance);
  // Agents still can't remove a platform rule: it's merged back in and stripped from their own list.
  const mine = M.migrate({ ...cfg, guardrails: { ...cfg.guardrails, neverUse: ['guaranteed', 'my own rule'] } });
  assert.deepEqual(mine.guardrails.neverUse, ['my own rule']);
  assert.ok(M.guardrailsFor(mine).neverUse.includes('guaranteed'));
  // The niche rules are served to the portal with mixer-core.js; prompt wording is not.
  const { start } = await import('../server.js');
  const server = await start({ port: 0, scheduler: false, worker: false });
  try {
    const c = client(server.address().port);
    for (const p of ['/niches/index.js', '/niches/life-insurance.js']) assert.equal((await c.get(p)).status, 200, p);
    assert.doesNotMatch((await c.get('/niches/life-insurance.js')).data.toString(), /You write short videos|Follow these rules/);
  } finally { server.close(); }
});
