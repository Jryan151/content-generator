// test/kits/niche-kit.js — what every niche (niches/*.js) must have: the full shape, a compliance floor
// agents can't remove, and the engine's checks working with it.
import assert from 'node:assert/strict';
import { problemsOf } from '../../lib/plugins.js';
import { DEFAULT_CONFIG, validatePost, PLATFORM_GUARDRAILS } from '../../mixer-core.js';

export async function nicheKit(t, niche) {
  await t.test(`${niche.id}: fits the niche mount`, () => assert.deepEqual(problemsOf('niche', niche), []));
  await t.test(`${niche.id}: products, and a compliance floor that isn't empty`, () => {
    assert.ok(niche.productLines.length && niche.productLines.every(p => p.id && p.label));
    assert.ok(niche.productLines.some(p => p.label === niche.defaultProduct), 'the default product is one of its products');
    const g = niche.platformGuardrails;
    assert.ok(g.neverUse.length >= 5 && g.neverDo.length >= 3, 'a real floor of rules');
    assert.ok(niche.govTerms.length && niche.eligibility.length && niche.absolutes.length);
  });
  await t.test(`${niche.id}: the engine refuses a post that breaks its floor`, () => {
    const cfg = { ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)), niche: niche.id };
    const word = niche.platformGuardrails.neverUse[0];
    const bad = validatePost(JSON.stringify({ caption: `Here is something ${word} for you. Message me to talk it through.` }), cfg);
    assert.equal(bad.ok, false, `"${word}" is refused`);
    assert.ok(PLATFORM_GUARDRAILS !== undefined);
  });
}
