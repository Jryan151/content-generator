import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedPayments, reconcile, policiesFromActivities, STARTER_COMP } from '../src/commissions.js';

const people = {
  mel: { name: 'Morgan', contractPercent: 100, uplineId: 'up' },
  dev: { name: 'Devon', contractPercent: 80, uplineId: 'mel' },
  tas: { name: 'Tasha', contractPercent: 70, uplineId: 'dev' }, // Devon's recruit
  out: { name: 'Outside', contractPercent: 90, uplineId: null },
  up:  { name: 'Upline', contractPercent: 120, uplineId: null },
};
const policies = [
  { id: 'p1', agentId: 'mel', client: 'Ruth A.', annualPremium: 600, issuedOn: '2026-10-01' },
  { id: 'p2', agentId: 'dev', client: 'George B.', annualPremium: 1000, issuedOn: '2026-10-05' },
  { id: 'p3', agentId: 'tas', client: 'Helen S.', annualPremium: 500, issuedOn: '2026-10-20' },
  { id: 'p4', agentId: 'out', client: 'Not mine', annualPremium: 900, issuedOn: '2026-10-01' },
];

test('advance on her own policy, override (her spread) on her team’s', () => {
  const { items } = expectedPayments({ me: 'mel', people, policies });
  const by = Object.fromEntries(items.map((i) => [i.policyId, i]));
  assert.equal(by.p1.kind, 'advance');
  assert.equal(by.p1.amount, 450);             // 600 × 100% × 75%
  assert.equal(by.p2.kind, 'override');
  assert.equal(by.p2.amount, 150);             // 1000 × (100 − 80)% × 75%
  assert.equal(by.p3.amount, 75);              // 500 × (100 − 80)% × 75%: her spread is over Devon, the person below her
  assert.equal(by.p4, undefined, 'an outsider’s policy never shows up');
  assert.equal(by.p1.dueOn, '2026-10-15');
});

test('the upline sees their own spread on the same policies', () => {
  const { items } = expectedPayments({ me: 'up', people, policies });
  assert.equal(items.find((i) => i.policyId === 'p1').amount, 90); // 600 × 20% × 75%
});

test('every item is paid, partial, late or due — nothing in between', () => {
  const expected = expectedPayments({ me: 'mel', people, policies });
  const payments = [
    { expectedId: 'p1:advance:mel', amount: 450, receivedOn: '2026-10-14' },
    { expectedId: 'p2:override:mel', amount: 100, receivedOn: '2026-10-19' },
  ];
  const r = reconcile({ expected, payments, today: '2026-10-28' });
  const status = Object.fromEntries(r.rows.map((x) => [x.policyId, x.status]));
  assert.deepEqual(status, { p1: 'paid', p2: 'partial', p3: 'due' });
  assert.equal(r.summary.lateAmount, 50);
  assert.equal(r.nextAction, 'Ask your agency in writing about 1 late payment ($50). Oldest: George B., Devon, $50 due 2026-10-19.');
});

test('nothing late → it says so plainly', () => {
  const expected = expectedPayments({ me: 'mel', people, policies: policies.slice(0, 1) });
  const r = reconcile({ expected, payments: [{ expectedId: 'p1:advance:mel', amount: 450 }], today: '2026-10-28' });
  assert.equal(r.nextAction, 'Every payment due so far has arrived.');
});

test('missing contract levels block the check instead of guessing', () => {
  const noLevels = { ...people, dev: { ...people.dev, contractPercent: null } };
  const expected = expectedPayments({ me: 'mel', people: noLevels, policies });
  const r = reconcile({ expected, today: '2026-10-28' });
  assert.match(r.nextAction, /contract levels missing for Devon/);
  assert.ok(!expected.items.some((i) => i.policyId === 'p2'));
});

test('the agency’s advance terms change the numbers', () => {
  const { items } = expectedPayments({ me: 'mel', people, policies: policies.slice(0, 1), comp: { advancePercent: 100, advanceDueDays: 30 } });
  assert.equal(items.at(0).amount, 600);
  assert.equal(items.at(0).dueOn, '2026-10-31');
  assert.equal(STARTER_COMP.advancePercent, 75);
});

test('policies come straight from the activity log', () => {
  const ps = policiesFromActivities([
    { agent_id: 'mel', type: 'policy_issued', value: 600, lead_id: 'L1', occurred_at: '2026-10-02T03:00:00Z' },
    { agent_id: 'mel', type: 'app_written', value: 600, occurred_at: '2026-09-20T18:00:00Z' },
  ], { clients: { L1: 'Ruth A.' }, tz: 'America/Phoenix' });
  assert.deepEqual(ps, [{ id: 'L1', agentId: 'mel', client: 'Ruth A.', annualPremium: 600, issuedOn: '2026-10-01' }]);
});
