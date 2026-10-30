// The demo has two made-up people: Morgan (the leader) and Devon (one of her
// producers). This keeps the producer demo honest: Devon's clients are his,
// and the real engine puts him at Producer, not somewhere else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildActivities, DEMO, DEVON, TZ } from '../seed/sample.js';
import { DEMO_LEADS, DEMO_PRODUCER_LEADS } from '../seed/demo-pipeline.js';
import { placeOnLadder } from '../src/career.js';

test('producer demo: every client belongs to Devon', () => {
  assert.equal(DEMO.producerId, DEVON);
  assert.ok(DEMO_PRODUCER_LEADS.length > 0);
  for (const l of DEMO_PRODUCER_LEADS) assert.equal(l.agent_id, DEVON, l.id);
});

test('producer demo: has a call due today, so Today shows a next call', () => {
  assert.ok(DEMO_PRODUCER_LEADS.some((l) => l.nextOn && l.nextOn <= DEMO.activityTo));
});

test('producer demo: the engine puts Devon at Producer', () => {
  const L = placeOnLadder({ person: { id: DEVON, name: DEMO.producerName, licensed: true }, team: [], activities: buildActivities(), dayKey: DEMO.activityTo, tz: TZ, playbookReady: false });
  assert.equal(L.stage, 'producer');
});

test('producer demo leaves the leader demo untouched', () => {
  const ids = new Set(DEMO_LEADS.map((l) => l.id));
  assert.ok(DEMO_PRODUCER_LEADS.filter((l) => !ids.has(l.id)).every((l) => !l.issuedOn));
});
