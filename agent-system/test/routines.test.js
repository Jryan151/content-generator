import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDown, ratesFrom, todoFor, STARTER_RATES } from '../src/routines.js';
import { buildActivities, TZ, DEVON, TEAM_IDS } from '../seed/sample.js';

test('plan flows down: a yearly goal becomes daily dials', () => {
  const p = planDown({ yearlyPremium: 96_000 });
  assert.equal(p.monthly.premium, 8000);
  assert.equal(p.monthly.apps, 14);          // 8000 / 600 → 13.3, rounded up
  assert.equal(p.monthly.appts, 28);         // 14 / 50%
  assert.equal(p.monthly.conversations, 112); // 28 / 25%
  assert.equal(p.monthly.dials, 448);        // 112 / 25%
  assert.equal(p.weekly.appts, 7);
  assert.equal(p.daily.dials, 22);           // 448 / 21 workdays
  assert.equal(p.daily.conversations, 6);
});

test('a bigger goal means more daily dials, never fewer', () => {
  const small = planDown({ yearlyPremium: 60_000 }).daily.dials;
  const big = planDown({ yearlyPremium: 120_000 }).daily.dials;
  assert.ok(big > small);
});

test('bad plans are rejected', () => {
  assert.throws(() => planDown({ yearlyPremium: 0 }), /positive/);
  assert.throws(() => planDown({ yearlyPremium: 1000, rates: { ...STARTER_RATES, closeRate: 0 } }), /closeRate/);
});

test('real rates come from history; thin data falls back to starters', () => {
  const r = ratesFrom(buildActivities(), { agentIds: TEAM_IDS });
  assert.ok(r.contactRate > 0.2 && r.contactRate < 0.3, `contact ${r.contactRate}`);
  assert.ok(r.avgPremium > 500 && r.avgPremium < 700, `premium ${r.avgPremium}`);
  const thin = ratesFrom([{ agent_id: 'x', type: 'dial', occurred_at: '2026-10-01T16:00:00Z' }]);
  assert.deepEqual(
    [thin.avgPremium, thin.closeRate, thin.bookingRate, thin.contactRate],
    [STARTER_RATES.avgPremium, STARTER_RATES.closeRate, STARTER_RATES.bookingRate, STARTER_RATES.contactRate],
  );
});

const plan = planDown({ yearlyPremium: 96_000 });

test('an ordinary Wednesday is just the blocks of the day, in time order', () => {
  const list = todoFor('2026-10-28', { role: 'agent', plan });
  assert.deepEqual(list.map((t) => t.at), ['09:00', '13:00', '14:00', '16:45']);
  assert.equal(list.find((t) => t.id === 'a-dials').title, 'Call block: 22 calls from your list');
});

test('content is optional: it shows up only when turned on, after the dial block', () => {
  const off = todoFor('2026-10-28', { role: 'builder', path: 'producer', plan });
  assert.ok(!off.some((t) => t.part === 'Content'));
  const on = todoFor('2026-10-28', { role: 'builder', path: 'producer', plan, content: true });
  const post = on.find((t) => t.id === 'p-post');
  assert.ok(post && post.at > on.find((t) => t.id === 'p-dials').at, 'the post never comes before production');
});

test('Monday adds the weekly plan on top; Friday adds the review', () => {
  const mon = todoFor('2026-10-26', { role: 'agent', plan });
  assert.equal(mon.at(0).id, 'a-week-plan');
  assert.match(mon.at(0).title, /7 appointments/);
  const fri = todoFor('2026-10-30', { role: 'agent', plan });
  assert.ok(fri.some((t) => t.id === 'a-week-review'));
});

test('the first workday of a quarter stacks month and quarter tasks above the day', () => {
  // Oct 1, 2026 is a Thursday and the first workday of Q4.
  const list = todoFor('2026-10-01', { role: 'builder', path: 'coach', plan });
  assert.deepEqual(list.slice(0, 2).map((t) => t.tf), ['1Q', '1M']);
});

test('first workday rolls past a weekend (Nov 1, 2026 is a Sunday)', () => {
  assert.ok(todoFor('2026-11-02', { role: 'agent', plan }).some((t) => t.id === 'a-month'));
  assert.equal(todoFor('2026-11-01', { role: 'agent', plan }).length, 0);
});

test('builders and agents get different routines', () => {
  const b = todoFor('2026-10-28', { role: 'builder', path: 'coach', plan }).map((t) => t.id);
  assert.ok(b.includes('c-coach') && !b.includes('a-dials'));
});

test('progress is filled in from the activity log', () => {
  const list = todoFor('2026-10-30', { role: 'agent', plan, activities: buildActivities(), agentId: DEVON, tz: TZ });
  const dials = list.find((t) => t.id === 'a-dials');
  assert.equal(dials.goal, 22);
  assert.ok(dials.progress >= 17);
  assert.equal(typeof dials.done, 'boolean');
});

test('recruiting steps leave activity rows, so they can be marked done', async () => {
  const { HEADLINE_METRICS } = await import('../src/metrics.js');
  const p = planDown({ yearlyPremium: 96_000 });
  const step = [{ agent_id: 'lead', type: 'recruit_licensed', occurred_at: '2026-10-28T17:00:00Z' }];
  const coach = todoFor('2026-10-28', { role: 'builder', path: 'coach', plan: p, activities: step, agentId: 'lead', tz: 'America/Phoenix' });
  assert.equal(coach.find((t) => t.id === 'c-recruit').done, true, 'a stage move counts as the day’s recruiting step');
  const names = [{ agent_id: 'lead', type: 'names_conversation', occurred_at: '2026-10-28T17:00:00Z' }];
  const producer = todoFor('2026-10-28', { role: 'builder', path: 'producer', plan: p, activities: names, agentId: 'lead', tz: 'America/Phoenix' });
  assert.equal(producer.find((t) => t.id === 'p-names').done, true);
  for (const list of Object.values(HEADLINE_METRICS)) assert.ok(!list.includes('recruits'), 'head count is never a headline');
  assert.ok(HEADLINE_METRICS['1M'].includes('firstSales'));
});
