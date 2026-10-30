// Simple, held by tests: the app is for busy people who don't read instructions.
// If complexity creeps back in (a sixth thing on Today, an insider word on screen, two features
// for one job), these fail instead of the drift going unnoticed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SIMPLE } from '../src/core.js';
import { todayLayout, dayStatus, TODAY_MAX_SLOTS } from '../src/today.js';
import { STAGES, weeksWithASale } from '../src/career.js';
import { leaderView } from '../src/attention.js';

const MODULES = {
  attention: '../src/attention.js', calls: '../src/calls.js', career: '../src/career.js', ladder: '../src/ladder.js',
  pay: '../src/pay.js', pipeline: '../src/pipeline.js', today: '../src/today.js',
};
const TZ = 'America/Phoenix';
const at = (d, t = '10:00') => new Date(`${d}T${t}:00-07:00`).toISOString();

test('Today never shows more than five things above "More", in chain order, and "done" is last', () => {
  assert.equal(TODAY_MAX_SLOTS, SIMPLE.todayMaxSlots);
  const ORDER = ['notice', 'now', 'next', 'team', 'day', 'done'];
  for (let bits = 0; bits < 16; bits++) {
    const [notice, now, team, done] = [1, 2, 4, 8].map((b) => !!(bits & b));
    const { slots } = todayLayout({ notice, now, team, done });
    assert.ok(slots.length <= SIMPLE.todayMaxSlots, `${slots.length} slots: ${slots}`);
    assert.deepEqual(slots, [...slots].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)), 'chain order');
    assert.ok(!(slots.includes('next') && slots.includes('done')), 'next call and done never together');
    if (done) assert.equal(slots.at(-1), 'done', 'done is the last slot');
    assert.ok(slots.includes('day'), 'her day so far always shows');
  }
});

test('one rule says when her day is done: her full day of calls, or her end time on a workday', () => {
  assert.deepEqual(dayStatus({ goal: 40, dials: 40, now: '11:00' }), { done: true, by: 'calls', callsDone: false });
  assert.deepEqual(dayStatus({ goal: 40, dials: 12, now: '17:30', stopAt: '17:30' }), { done: true, by: 'time', callsDone: false });
  assert.equal(dayStatus({ goal: 40, dials: 12, now: '17:30', stopAt: '17:30', workday: false }).done, false, 'no end time on a weekend');
  assert.equal(dayStatus({ goal: 40, dials: 45, keepGoing: true }).done, false);
  assert.equal(dayStatus({ goal: 40, dials: 45, late: true }).done, false, 'never done while catching up after midnight');
  assert.equal(dayStatus({ goal: null, dials: 90 }).done, false, 'no full day set: never a guess');
});

// Found by the 13-week run: 40 calls by noon said "Done for today" with 1–4 PM meetings still ahead.
test('her calls being done doesn\'t end a day that still has meetings in it', () => {
  assert.deepEqual(dayStatus({ goal: 40, dials: 40, now: '11:30', meetingsLeft: 2 }), { done: false, by: null, callsDone: true });
  assert.deepEqual(dayStatus({ goal: 40, dials: 40, now: '16:30', meetingsLeft: 0 }), { done: true, by: 'calls', callsDone: false }, 'done once they are logged');
  assert.equal(dayStatus({ goal: 40, dials: 12, now: '11:30', meetingsLeft: 2 }).callsDone, false, 'calls not done yet');
  assert.equal(dayStatus({ goal: 40, dials: 40, now: '17:30', stopAt: '17:30', meetingsLeft: 1 }).done, true, 'her end time still ends the day');
  assert.equal(dayStatus({ goal: 40, dials: 40, meetingsLeft: 1, keepGoing: true }).callsDone, false, 'keep calling means the next call shows');
  for (const meetingsLeft of [0, 3]) {
    const s = dayStatus({ goal: 40, dials: 40, now: '12:00', meetingsLeft });
    assert.ok(!(s.done && s.callsDone), 'never both');
  }
});

// Every string with a space in it is something a person may read. None of them uses insider words.
function screenStrings(file) {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
    .replace(/^import .*$/gm, '');
  return [...src.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0]).filter((x) => /\s/.test(x));
}
test('screens speak plainly: no insider words in anything a person reads', () => {
  const words = SIMPLE.plainWords.map((w) => new RegExp(`\\b${w}\\b`, 'i'));
  for (const file of ['../public/app.js', '../src/attention.js', '../src/calls.js', '../src/today.js', '../src/rules.js', '../src/ladder.js']) {
    for (const text of screenStrings(file)) {
      const hit = words.find((w) => w.test(text));
      assert.ok(!hit, `${file}: ${text.slice(0, 90)} uses "${hit}"`);
    }
  }
  for (const st of STAGES) for (const text of [st.focus, st.why]) {
    const hit = words.find((w) => w.test(text));
    assert.ok(!hit, `${st.name}: ${text} uses "${hit}"`);
  }
});

test('one feature per job, and every feature is real code', async () => {
  const jobs = SIMPLE.jobs.map((j) => j.job), features = SIMPLE.jobs.map((j) => j.feature);
  assert.equal(new Set(jobs).size, jobs.length, 'a job listed twice');
  assert.equal(new Set(features).size, features.length, 'one feature doing two jobs');
  for (const f of features) {
    const [mod, name] = f.split('.');
    assert.ok(MODULES[mod], `unknown module in ${f}`);
    assert.equal(typeof (await import(MODULES[mod]))[name], 'function', `${f} does not exist`);
  }
});

test('selling every week counts business that stuck once there is placement data', () => {
  const app = (d, lead) => ({ agent_id: 'a', type: 'app_written', lead_id: lead, value: 600, occurred_at: at(d) });
  const placed = (d, lead) => ({ agent_id: 'a', type: 'policy_issued', lead_id: lead, value: 600, occurred_at: at(d) });
  const DAY = '2026-10-29';
  const apps = [app('2026-10-05', 'x1'), app('2026-10-12', 'x2'), app('2026-10-19', 'x3')];
  const before = weeksWithASale(apps, { personId: 'a', dayKey: DAY, tz: TZ, outOf: 6 });
  assert.deepEqual([before.count, before.source], [3, 'applications'], 'no placement data yet: applications, and it says so');
  // Only x1 was placed (a week later): one week counts, the week it was SOLD.
  const after = weeksWithASale([...apps, placed('2026-10-14', 'x1')], { personId: 'a', dayKey: DAY, tz: TZ, outOf: 6 });
  assert.deepEqual([after.count, after.source], [1, 'placed']);
  assert.equal(after.flags.at(-4), true, 'the week of Oct 5 counts');
});

test('one call gives the team site everything a leader sees: the ranking, her check-ins, her pay', () => {
  const members = [{ id: 'k', name: 'Keisha', startedOn: '2026-06-01', activities: [
    { agent_id: 'k', type: 'dial', occurred_at: at('2026-10-29') },
    { agent_id: 'k', type: 'policy_issued', lead_id: 'k1', value: 600, occurred_at: at('2026-10-20') }] }];
  const mine = [{ agent_id: 'me', type: 'policy_issued', lead_id: 'm1', value: 800, occurred_at: at('2026-10-21') }];
  const v = leaderView({ members, me: 'me', mine, levels: { me: 100, k: 70 }, dayKey: '2026-10-29', now: '15:00', tz: TZ });
  assert.ok(Array.isArray(v.people) && v.builder && 'top' in v);
  assert.equal(v.pay.ready, true);
  assert.deepEqual([v.pay.own.net, v.pay.team.net], [600, 135]);
  assert.equal(leaderView({ members, me: 'me', mine, levels: null, dayKey: '2026-10-29', now: '15:00', tz: TZ }).pay.ready, false, 'blank until levels are in');
});
