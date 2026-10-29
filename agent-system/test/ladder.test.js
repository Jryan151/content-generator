import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duplication, levelProgress, LADDER, RECRUIT_STAGES } from '../src/ladder.js';
import { buildActivities, TZ, DEVON, TASHA, MARCUS } from '../seed/sample.js';

const acts = buildActivities();
const team = [
  { id: DEVON, name: 'Devon', startedOn: '2026-05-01', coaches: true },
  { id: TASHA, name: 'Tasha', startedOn: '2026-07-15' },
  { id: MARCUS, name: 'Marcus', startedOn: '2026-09-01' },
];
const recruits = [{ stage: 'prospect' }, { stage: 'interviewed' }, { stage: 'licensing' }, { stage: 'licensed' }];

test('duplication counts producing agents and coaches, not head count', () => {
  const m = duplication({ team, recruits, activities: acts, dayKey: '2026-10-30', tz: TZ });
  assert.equal(m.producingAgents, 3);
  assert.equal(m.coaches, 1);
  assert.equal(m.licensedRecruits, 4); // 3 agents + 1 licensed recruit
  assert.deepEqual(m.recruitingFunnel, { prospect: 1, interviewed: 1, licensing: 1, licensed: 1, first_sale: 0, producing: 0 });
  assert.equal(typeof m.daysToFirstSale, 'number');
});

test('an agent with no sale in 30 days is not producing; 14 quiet days means not active', () => {
  const quietMarcus = acts.filter((a) => !(a.agent_id === MARCUS && a.occurred_at >= '2026-10-01'));
  const m = duplication({ team, activities: quietMarcus, dayKey: '2026-10-30', tz: TZ });
  assert.equal(m.producingAgents, 2);
  assert.equal(m.agents.find((a) => a.name === 'Marcus').active, false);
});

test('90-day retention only counts agents who started 90+ days ago', () => {
  const m = duplication({ team, activities: acts, dayKey: '2026-10-30', tz: TZ });
  assert.equal(m.retention90, 1); // Devon and Tasha both still active; Marcus too new
});

test('producer → coach: steady selling AND a Playbook in your own words', () => {
  const p = levelProgress({ path: 'producer', metrics: { steadyWeeks: 6, playbookReady: 0 } });
  assert.equal(p.to, 'coach');
  assert.equal(p.ready, false);
  assert.deepEqual(p.requirements.map((r) => r.met), [true, false]);
  assert.equal(p.nextAction, 'Finish your Playbook in your own words. It is what every recruit will learn from.');
});

test('coach → director is measured by agents under you, and the next action targets the closest gap', () => {
  const p = levelProgress({ path: 'coach', metrics: { agentsSelling: 2, agentsDeveloped: 0 } });
  assert.equal(p.nextAction, 'Get 1 more agent to steady weekly sales. Start with whoever is closest on Team.');
});

test('ready means every box is checked', () => {
  const p = levelProgress({ path: 'director', metrics: { coachesBuilt: 3 } });
  assert.equal(p.ready, true);
  assert.match(p.nextAction, /Upline/);
});

test('the ladder is one straight line and the funnel ends in producing', () => {
  assert.deepEqual(LADDER.map((r) => `${r.from}>${r.to}`), ['producer>coach', 'coach>director', 'director>upline']);
  assert.deepEqual(LADDER.flatMap((r) => r.requires.map((q) => q.metric)), ['steadyWeeks', 'playbookReady', 'agentsSelling', 'agentsDeveloped', 'coachesBuilt']);
  assert.equal(RECRUIT_STAGES.at(-1).id, 'producing');
  assert.throws(() => levelProgress({ path: 'upline', metrics: {} }), /No rung/);
});
