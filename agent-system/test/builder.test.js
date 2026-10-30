// Fixes from the six-month "Renee" run (week by week, with feelings): why a top producer
// keeps working instead of building. Each test is one thing the run showed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whoNeedsYou, ownProduction, dayOffRow, daysOff } from '../src/attention.js';
import { developedHere } from '../src/career.js';
import { payPicture } from '../src/pay.js';
import { addWorkdays } from '../src/calls.js';

const TZ = 'America/Phoenix';
const at = (d, t = '10:00') => new Date(`${d}T${t}:00-07:00`).toISOString();
const rows = (id, d, type, n = 1, extra = {}) => Array.from({ length: n }, () => ({ agent_id: id, type, occurred_at: at(d), ...extra }));
const workdays = (from, to) => { const out = []; for (let k = from; k <= to; k = addWorkdays(k, 1)) out.push(k); return out; };
const daily = (id, from, to, type, n, skip = []) => workdays(from, to).filter((d) => !skip.includes(d)).flatMap((d) => rows(id, d, type, n));

test('days off are not "down": holidays stop triggering weeks of "your calls are down"', () => {
  const off = ['2026-12-24', '2026-12-25', '2027-01-01'];
  const calls = daily('me', '2026-10-05', '2027-01-06', 'dial', 46, off);
  const before = ownProduction(calls, { me: 'me', dayKey: '2027-01-06', tz: TZ });
  assert.equal(before.down, true, 'unmarked holidays read as a drop');
  assert.deepEqual(before.unmarkedZeroDays.sort(), off, 'the card can offer to mark exactly those days');
  const marked = [...calls, ...off.map((day) => dayOffRow({ me: 'me', day, at: at('2027-01-06') }))];
  assert.equal(ownProduction(marked, { me: 'me', dayKey: '2027-01-06', tz: TZ }).down, false);
  assert.deepEqual([...daysOff(marked, TZ)].sort(), off);
});

test('a real slump still shows, days off or not', () => {
  const calls = [...daily('me', '2026-09-14', '2026-11-13', 'dial', 46), ...daily('me', '2026-11-16', '2026-11-27', 'dial', 25)];
  assert.equal(ownProduction([...calls, dayOffRow({ me: 'me', day: '2026-11-20', at: at('2026-11-20') })], { me: 'me', dayKey: '2026-11-30', tz: TZ }).down, true);
});

// A steady seller with a big book always has a lapse or two; that shouldn't put them at the top every month.
const book = (id, placed, lapses, calls = 20) => ({
  id, name: id, startedOn: '2026-01-05',
  activities: [
    ...Array.from({ length: placed }, (_, i) => ({ agent_id: id, type: 'policy_issued', lead_id: `${id}${i}`, value: 600, occurred_at: at('2026-06-01') })),
    ...Array.from({ length: lapses }, (_, i) => ({ agent_id: id, type: 'chargeback', lead_id: `${id}${i}`, value: 600, occurred_at: at('2026-10-20') })),
    ...daily(id, '2026-10-12', '2026-10-29', 'dial', calls),
  ],
});

test('lapses are judged against the agent’s own book and the team’s typical rate', () => {
  const team = [book('keisha', 60, 2), book('dante', 50, 1), book('ana', 40, 1), book('jordan', 30, 6)];
  const r = Object.fromEntries(whoNeedsYou({ members: team, dayKey: '2026-10-29', now: '15:00', tz: TZ }).map((x) => [x.id, x]));
  assert.equal(r.keisha.level, 'ok', '2 of 60 is normal for this team');
  assert.equal(r.jordan.level, 'watch');
  assert.match(r.jordan.reason, /6 customers stopped paying this month: 20% of their customers vs the team’s 3%/);
});

test('a new agent’s first lapse still gets a look', () => {
  const team = [book('keisha', 60, 2), book('dante', 50, 1), book('new', 4, 1)];
  const r = whoNeedsYou({ members: team, dayKey: '2026-10-29', now: '15:00', tz: TZ }).find((x) => x.id === 'new');
  assert.match(r.reason, /1 customer stopped paying this month$/);
});

test('"developed here" never counts a veteran whose history starts mid-stream', () => {
  // Joined in July; the app's log starts in September; first logged sale 43 days after that.
  const vet = { id: 'j', startedOn: '2026-07-06', activities: [...rows('j', '2026-09-07', 'dial', 10), ...rows('j', '2026-10-20', 'app_written', 1, { value: 600 })] };
  assert.equal(developedHere(vet, 'producer'), false);
  // Joined and logged from day one, first sale after 30 days: developed here.
  const grown = { id: 'g', startedOn: '2026-09-07', activities: [...rows('g', '2026-09-08', 'dial', 10), ...rows('g', '2026-10-20', 'app_written', 1, { value: 600 })] };
  assert.equal(developedHere(grown, 'producer'), true);
});

test('her pay picture: her sales next to what her team paid her, after lapses; blank until levels are in', () => {
  const acts = [
    { agent_id: 'renee', type: 'policy_issued', lead_id: 'r1', value: 800, occurred_at: at('2026-10-27') },
    { agent_id: 'ana', type: 'policy_issued', lead_id: 'a1', value: 600, occurred_at: at('2026-10-28') },
    { agent_id: 'ana', type: 'policy_issued', lead_id: 'a0', value: 600, occurred_at: at('2026-06-01') },
    { agent_id: 'ana', type: 'chargeback', lead_id: 'a0', value: 600, occurred_at: at('2026-10-29') },
  ];
  const p = payPicture({ me: 'renee', activities: acts, levels: { renee: 100, ana: 70 }, dayKey: '2026-10-30', tz: TZ, days: 7 });
  assert.equal(p.ready, true);
  assert.deepEqual(p.own, { paid: 600, clawback: 0, net: 600 }, '800 × 100% × 75% advance');
  assert.deepEqual(p.team, { paid: 135, clawback: 135, net: 0 }, 'override 600 × 30% × 75%, and the same clawed back on Ana’s lapse');
  const blank = payPicture({ me: 'renee', activities: acts, levels: { renee: 100 }, names: { ana: 'Ana' }, dayKey: '2026-10-30', tz: TZ, days: 7 });
  assert.equal(blank.ready, false);
  assert.equal(blank.team, null, 'a partial override would mislead: blank');
  assert.deepEqual(blank.waitingOn, ['Ana']);
  assert.equal(payPicture({ me: 'renee', activities: acts, levels: {}, dayKey: '2026-10-30', tz: TZ }).own, null);
});
