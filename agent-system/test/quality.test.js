import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quality, CHECKPOINTS } from '../src/quality.js';
import { totalsFor } from '../src/timeframes.js';

const A = 'agent-a', B = 'agent-b';
const at = (iso) => new Date(iso).toISOString();
const row = (agent_id, type, iso, extra = {}) => ({ agent_id, type, occurred_at: at(iso), ...extra });

test('nothing logged → every rate is blank, not zero', () => {
  const q = quality({ activities: [], dayKey: '2026-10-28' });
  assert.equal(q.placeRate, null);
  for (const m of CHECKPOINTS) assert.equal(q.activeAt[m].rate, null);
  assert.ok(q.needsData.includes('No applications logged yet'));
  assert.ok(q.needsData.some((n) => n.startsWith('Approvals aren’t tracked yet')));
});

test('applications with no approvals marked read as not tracked, not 0%', () => {
  const q = quality({ activities: [row(A, 'app_written', '2026-09-01T17:00:00Z', { value: 600 })], dayKey: '2026-10-28' });
  assert.equal(q.placeRate, null);
});

test('placed ÷ submitted is the place rate', () => {
  const acts = [
    row(A, 'app_written', '2026-09-01T17:00:00Z', { value: 600 }),
    row(A, 'app_written', '2026-09-02T17:00:00Z', { value: 600 }),
    row(A, 'app_written', '2026-09-03T17:00:00Z', { value: 600 }),
    row(A, 'app_written', '2026-09-04T17:00:00Z', { value: 600 }),
    row(A, 'policy_issued', '2026-09-20T17:00:00Z', { value: 600, lead_id: 'L1' }),
    row(A, 'policy_issued', '2026-09-21T17:00:00Z', { value: 600, lead_id: 'L2' }),
    row(A, 'policy_issued', '2026-09-22T17:00:00Z', { value: 600, lead_id: 'L3' }),
  ];
  const q = quality({ activities: acts, dayKey: '2026-10-28' });
  assert.equal(q.submitted, 4);
  assert.equal(q.placed, 3);
  assert.equal(q.placeRate, 0.75);
});

test('a policy only counts at a checkpoint once it is old enough', () => {
  const acts = [
    row(A, 'policy_issued', '2026-01-10T17:00:00Z', { lead_id: 'OLD' }),   // 9+ months old
    row(A, 'policy_issued', '2026-10-01T17:00:00Z', { lead_id: 'NEW' }),   // under a month old
  ];
  const q = quality({ activities: acts, dayKey: '2026-10-28' });
  assert.equal(q.activeAt[3].eligible, 1);
  assert.equal(q.activeAt[6].eligible, 1);
  assert.equal(q.activeAt[12].eligible, 0);
  assert.equal(q.activeAt[12].rate, null);
  assert.ok(q.needsData.includes('No policy is 12 months old yet'));
});

test('a lapse on the same lead removes the policy from every later checkpoint', () => {
  const acts = [
    row(A, 'policy_issued', '2025-06-01T17:00:00Z', { lead_id: 'STAYS' }),
    row(A, 'policy_issued', '2025-06-01T17:00:00Z', { lead_id: 'LAPSES' }),
    row(A, 'chargeback', '2025-10-15T17:00:00Z', { lead_id: 'LAPSES', value: 600 }), // between month 4 and 5
  ];
  const q = quality({ activities: acts, dayKey: '2026-10-28' });
  assert.deepEqual(q.activeAt[3], { eligible: 2, active: 2, rate: 1 });
  assert.deepEqual(q.activeAt[6], { eligible: 2, active: 1, rate: 0.5 });
  assert.deepEqual(q.activeAt[12], { eligible: 2, active: 1, rate: 0.5 });
  assert.equal(q.lapsed, 1);
});

test('a chargeback on a different lead does not touch this policy', () => {
  const acts = [
    row(A, 'policy_issued', '2025-06-01T17:00:00Z', { lead_id: 'MINE' }),
    row(A, 'chargeback', '2025-07-01T17:00:00Z', { lead_id: 'SOMEONE_ELSE' }),
  ];
  assert.equal(quality({ activities: acts, dayKey: '2026-10-28' }).activeAt[12].active, 1);
});

test('only the agents asked for are counted', () => {
  const acts = [
    row(A, 'app_written', '2026-09-01T17:00:00Z'),
    row(B, 'app_written', '2026-09-01T17:00:00Z'),
    row(B, 'policy_issued', '2026-09-20T17:00:00Z', { lead_id: 'B1' }),
  ];
  const q = quality({ activities: acts, agentIds: [A], dayKey: '2026-10-28' });
  assert.equal(q.submitted, 1);
  assert.equal(q.placed, 0);
});

test('nothing after the day asked about leaks in', () => {
  const acts = [row(A, 'policy_issued', '2026-11-05T17:00:00Z', { lead_id: 'LATER' })];
  assert.equal(quality({ activities: acts, dayKey: '2026-10-28' }).placed, 0);
});

test('a placed policy without a lead is counted but flagged as untracked', () => {
  const q = quality({ activities: [row(A, 'policy_issued', '2026-09-20T17:00:00Z')], dayKey: '2026-10-28' });
  assert.equal(q.placed, 1);
  assert.equal(q.untracked, 1);
  assert.ok(q.needsData.some((n) => n.includes('no lead attached')));
});

test('placed policies roll up like every other number', () => {
  const acts = [
    row(A, 'policy_issued', '2026-10-05T17:00:00Z', { lead_id: 'X', value: 900 }),
    row(A, 'policy_issued', '2026-10-06T17:00:00Z', { lead_id: 'Y', value: 600 }),
  ];
  const t = totalsFor(acts, { tf: '1M', key: '2026-10', tz: 'America/Phoenix' });
  assert.equal(t.policiesPlaced, 2);
  assert.equal(t.premiumIssued, 1500);
});
