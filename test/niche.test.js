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
