import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveLead, nextLeadStage, moveRecruit, nextRecruitStage, addRecruit } from '../src/pipeline.js';
import { quality } from '../src/quality.js';

const at = '2026-10-28T17:00:00.000Z';
const lead = { id: 'L1', agent_id: 'A', name: 'Client', stage: 'new', premium: null };

test('every forward move logs what the database trigger logs', () => {
  let l = lead; const rows = [];
  for (const [to, extra] of [['contacted'], ['appointment'], ['application', { premium: 600 }], ['issued']]) {
    const r = moveLead(l, to, { at, ...extra }); l = r.lead; rows.push(...r.rows);
  }
  assert.deepEqual(rows.map((r) => r.type), ['conversation', 'appt_set', 'app_written', 'policy_issued']);
  assert.equal(rows[2].value, 600);
  assert.equal(rows[3].value, 600);
  assert.ok(rows.every((r) => r.lead_id === 'L1'));
});

test('submitting needs a premium', () => {
  assert.throws(() => moveLead({ ...lead, stage: 'appointment' }, 'application', { at }), /premium/);
});

test('a placed policy that is lost becomes a chargeback, and quality sees it', () => {
  const placed = { ...lead, stage: 'issued', premium: 600 };
  const { rows } = moveLead(placed, 'lost', { at: '2026-03-01T17:00:00.000Z' });
  assert.deepEqual(rows.map((r) => r.type), ['chargeback']);
  const acts = [{ agent_id: 'A', lead_id: 'L1', type: 'policy_issued', occurred_at: '2026-01-02T17:00:00.000Z' }, ...rows];
  assert.equal(quality({ activities: acts, dayKey: '2026-10-28' }).activeAt[3].active, 0);
});

test('losing a client who never bought logs nothing extra', () => {
  assert.deepEqual(moveLead({ ...lead, stage: 'appointment' }, 'lost', { at }).rows, []);
});

test('the next step is always one step', () => {
  assert.equal(nextLeadStage('new'), 'contacted');
  assert.equal(nextLeadStage('issued'), null);
  assert.equal(nextRecruitStage('prospect'), 'interviewed');
  assert.equal(nextRecruitStage('producing'), null);
});

test('recruit moves log against the builder, with the right type', () => {
  const r = { id: 'R1', name: 'Recruit', stage: 'licensing' };
  assert.equal(moveRecruit(r, 'licensed', { builderId: 'B', at }).rows[0].type, 'recruit_licensed');
  assert.equal(moveRecruit({ ...r, stage: 'interviewed' }, 'licensing', { builderId: 'B', at }).rows[0].type, 'recruit_step');
  assert.equal(addRecruit({ id: 'R2', name: ' Ana ' }, { builderId: 'B', at }).recruit.name, 'Ana');
  assert.throws(() => addRecruit({ id: 'R3', name: '  ' }, { builderId: 'B', at }));
});
