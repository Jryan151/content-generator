import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_VALUES, SCREENS, PARKED } from '../src/core.js';

// "module.export" → the real export, so the core can never point at code that doesn't exist.
const MODULES = {
  calls: '../src/calls.js', store: '../src/store.js', career: '../src/career.js', ladder: '../src/ladder.js', metrics: '../src/metrics.js',
  paths: '../src/paths.js', pipeline: '../src/pipeline.js', quality: '../src/quality.js', routines: '../src/routines.js',
  setup: '../src/setup.js', timeframes: '../src/timeframes.js',
};
async function resolve(ref) {
  const [mod, name] = ref.split('.');
  assert.ok(MODULES[mod], `unknown module in "${ref}"`);
  const m = await import(MODULES[mod]);
  return m[name];
}

test('five core values, each enforced by real code', async () => {
  assert.equal(CORE_VALUES.length, 5);
  for (const v of CORE_VALUES) {
    assert.ok(v.enforcedBy.length > 0, `${v.id} has nothing enforcing it`);
    for (const ref of v.enforcedBy) assert.ok(await resolve(ref), `${v.id}: ${ref} does not exist`);
  }
});

test('exactly the five required screens, each reading only real engine functions', async () => {
  assert.deepEqual(SCREENS.map((s) => s.id), ['setup', 'today', 'pipeline', 'ladder', 'team']);
  for (const s of SCREENS) {
    for (const ref of s.reads) assert.ok(await resolve(ref), `${s.name}: ${ref} does not exist`);
  }
});

test('no required screen reads parked code', () => {
  const parkedRefs = ['planDown', 'commissions', 'PARKED_PATHS'];
  for (const s of SCREENS) {
    for (const ref of s.reads) assert.ok(!parkedRefs.some((p) => ref.includes(p)), `${s.name} reads parked ${ref}`);
  }
  assert.ok(PARKED.length > 0);
});

test('the Team screen sees quality, not just volume', () => {
  assert.ok(SCREENS.find((s) => s.id === 'team').reads.includes('quality.quality'));
});
