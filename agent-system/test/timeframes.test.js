import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bucketKey, rangeOf, previousKey, childKeys, rollup, totalsFor,
  compareToPrevious, whereItBroke, dailyProgress,
} from '../src/timeframes.js';
import { DEFAULT_DAILY_TARGETS } from '../src/metrics.js';
import { buildActivities, TZ, TEAM_IDS, MARCUS, DEVON, OUTSIDER } from '../seed/sample.js';

const acts = buildActivities();

test('a 9 PM Phoenix call counts on that Phoenix day, not the next UTC day', () => {
  const ts = '2026-10-31T04:00:00.000Z'; // Oct 30, 9 PM in Phoenix
  assert.equal(bucketKey(ts, '1D', TZ), '2026-10-30');
  assert.equal(bucketKey(ts, '1D', 'UTC'), '2026-10-31');
});

test('weeks start on Monday', () => {
  assert.equal(bucketKey('2026-10-28T18:00:00Z', '1W', TZ), 'W:2026-10-26'); // Wed → Mon 26
  assert.equal(bucketKey('2026-11-01T18:00:00Z', '1W', TZ), 'W:2026-10-26'); // Sun → same week
  assert.equal(bucketKey('2026-11-02T18:00:00Z', '1W', TZ), 'W:2026-11-02'); // next Mon
});

test('month, quarter and year keys', () => {
  const ts = '2026-10-28T18:00:00Z';
  assert.equal(bucketKey(ts, '1M', TZ), '2026-10');
  assert.equal(bucketKey(ts, '1Q', TZ), '2026-Q4');
  assert.equal(bucketKey(ts, '1Y', TZ), '2026');
});

test('previous period steps back across year edges', () => {
  assert.equal(previousKey('2026-01', '1M'), '2025-12');
  assert.equal(previousKey('2026-Q1', '1Q'), '2025-Q4');
  assert.equal(previousKey('2026-01-01', '1D'), '2025-12-31');
  assert.equal(previousKey('W:2026-01-05', '1W'), 'W:2025-12-29');
});

test('children nest: a month holds its weeks, a quarter its months', () => {
  assert.deepEqual(childKeys('2026-10', '1M'), ['W:2026-09-28', 'W:2026-10-05', 'W:2026-10-12', 'W:2026-10-19', 'W:2026-10-26']);
  assert.deepEqual(childKeys('2026-Q4', '1Q'), ['2026-10', '2026-11', '2026-12']);
  assert.equal(childKeys('W:2026-10-26', '1W').length, 7);
  assert.deepEqual(childKeys('2026-10-28', '1D'), []);
});

test('ranges are start-inclusive, end-exclusive', () => {
  const r = rangeOf('2026-02', '1M');
  assert.equal(r.start.toISOString().slice(0, 10), '2026-02-01');
  assert.equal(r.end.toISOString().slice(0, 10), '2026-03-01');
});

test('bad input is rejected loudly', () => {
  assert.throws(() => bucketKey('2026-10-28T18:00:00Z', '2D', TZ), /Unknown timeframe/);
  assert.throws(() => rangeOf('2026-13', '1W'), /Bad 1W key/);
  assert.throws(() => bucketKey('not a date', '1D', TZ), /Bad timestamp/);
});

test('micro adds up to macro: the weeks inside October sum to October', () => {
  const month = totalsFor(acts, { tf: '1M', key: '2026-10', tz: TZ, agentIds: TEAM_IDS });
  const weeks = childKeys('2026-10', '1M').map((k) =>
    totalsFor(acts, { tf: '1W', key: k, tz: TZ, agentIds: TEAM_IDS, within: { key: '2026-10', tf: '1M' } }));
  for (const metric of ['dials', 'appsWritten', 'premiumWritten']) {
    assert.equal(weeks.reduce((s, w) => s + w[metric], 0), month[metric], metric);
  }
});

test('the team view never includes people outside the team', () => {
  const team = totalsFor(acts, { tf: '1D', key: '2026-10-14', tz: TZ, agentIds: TEAM_IDS });
  const everyone = totalsFor(acts, { tf: '1D', key: '2026-10-14', tz: TZ });
  assert.equal(everyone.premiumWritten - team.premiumWritten, 9999);
  assert.ok(!TEAM_IDS.includes(OUTSIDER));
});

test('rollup returns buckets in time order', () => {
  const months = rollup(acts, { tf: '1M', tz: TZ, agentIds: TEAM_IDS });
  assert.deepEqual(months.map((m) => m.key), ['2026-09', '2026-10']);
});

test('October premium is down vs September (the story in the sample)', () => {
  const cmp = compareToPrevious(acts, { tf: '1M', key: '2026-10', tz: TZ, agentIds: TEAM_IDS });
  assert.ok(cmp.change.premiumWritten < 0, `expected a drop, got ${cmp.change.premiumWritten}`);
});

test('where it broke: month → week 3 → Marcus stopped dialing', () => {
  const r = whereItBroke(acts, { tf: '1M', key: '2026-10', tz: TZ, agentIds: TEAM_IDS });
  assert.equal(r.down, true);
  assert.equal(r.trail.at(1).key, 'W:2026-10-12');
  assert.equal(r.agent.agent_id, MARCUS);
  assert.equal(r.agent.perDayInWeakBucket, 0);
});

test('where it broke: says nothing is wrong when the period is up', () => {
  const r = whereItBroke(acts, { tf: '1M', key: '2026-09', tz: TZ, agentIds: TEAM_IDS });
  assert.equal(r.down, false);
  assert.equal(r.agent, null);
});

test('daily progress toward targets', () => {
  const rows = dailyProgress(acts, { agentId: DEVON, day: '2026-10-30', tz: TZ, targets: DEFAULT_DAILY_TARGETS });
  const dials = rows.find((r) => r.metric === 'dials');
  assert.ok(dials.done >= 15, 'includes the 9 PM call');
  assert.equal(dials.pct, 100);
});
