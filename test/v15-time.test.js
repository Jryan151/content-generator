// v15 Phase 4: the time machine. Every agent time zone, through the days clocks change (March and
// November), month and year ends and a leap day, ticking like the real scheduler: the posting plan posts
// once per plan day at its wall-clock time, quiet hours and days off hold, the overnight top-up runs
// once a night, and "the next few days" never skip or repeat a day.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempEnv } from './helpers.js';

tempEnv();
const store = await import('../lib/store.js');
const paths = await import('../lib/paths.js');
const { planDue } = await import('../lib/posting.js');
const { quietNow } = await import('../lib/push.js');
const { keepReady } = await import('../lib/scheduler.js');
const { localClock } = await import('../lib/instagram.js');
const mc = await import('../mixer-core.js');
const S = await import('../server.js');

// The zones agents are in (the app's own list), plus two without daylight saving.
const ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'America/Puerto_Rico'];
// Windows around the hard days (UTC starts; each runs 4 days).
const WINDOWS = {
  'spring forward 2027': '2027-03-12T00:00:00Z',
  'fall back 2027': '2027-11-05T00:00:00Z',
  'month end': '2026-10-30T00:00:00Z',
  'year end': '2027-12-30T00:00:00Z',
  'leap day 2028': '2028-02-27T00:00:00Z',
};
const STEP = 10 * 60000, SPAN = 4 * 86400000;
const ticks = start => { const out = []; for (let t = Date.parse(start); t < Date.parse(start) + SPAN; t += STEP) out.push(t); return out; };
// The local wall-clock time, independently (en-US parts), to check the app's own helpers against.
const wall = (tz, t) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(t)).map(x => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) }; };

test('the local clock helpers agree with the wall clock in every zone, every 10 minutes, on the hard days', () => {
  for (const tz of ZONES) for (const start of Object.values(WINDOWS)) for (const t of ticks(start)) {
    const w = wall(tz, t), lt = paths.localTime(tz, new Date(t)), lc = localClock(tz, new Date(t));
    assert.equal(lt.date, w.date); assert.equal(lt.hour, w.hour);
    assert.equal(lc.date, w.date); assert.equal(lc.weekday, w.wd); assert.equal(lc.minutes, w.hour * 60 + w.minute);
    assert.equal(mc.weekdayIn(tz, t), w.wd);
  }
});

test('the posting plan posts exactly once per plan day, at its wall-clock time, through clock changes', () => {
  for (const tz of ZONES) for (const [name, start] of Object.entries(WINDOWS)) for (const time of ['09:00', '01:30', '02:30', '23:50']) {
    const cfg = { profile: { timezone: tz }, schedule: { autopost: { on: true, days: [0, 1, 2, 3, 4, 5, 6], time } } };
    let done = '';
    const posts = [];
    for (const t of ticks(start)) { const d = planDue(cfg, done, t); if (d) { posts.push({ d, t }); done = d; } }
    const dates = posts.map(p => p.d);
    assert.equal(new Set(dates).size, dates.length, `${tz} ${name} ${time}: a day posted twice`);
    // Every full local day in the window posted (the first and last may be partial).
    const all = [...new Set(ticks(start).map(t => wall(tz, t).date))].slice(1, -1);
    for (const d of all) assert.ok(dates.includes(d), `${tz} ${name} ${time}: ${d} never posted`);
    // Never before its time on the wall clock (on a spring-forward day, 2:30 doesn't exist: it posts at 3:00).
    const [h, m] = time.split(':').map(Number);
    for (const p of posts) { const w = wall(tz, p.t); assert.ok(w.hour * 60 + w.minute >= h * 60 + m, `${tz} ${name}: posted at ${w.hour}:${w.minute} for ${time}`); }
  }
});

test('plan days and days off follow the local weekday (not the server’s)', () => {
  for (const tz of ZONES) {
    const cfg = { profile: { timezone: tz }, schedule: { autopost: { on: true, days: [1, 3, 5], time: '09:00' } } };
    let done = '';
    for (const t of ticks('2027-11-05T00:00:00Z').concat(ticks('2027-11-09T00:00:00Z'))) {
      const d = planDue(cfg, done, t);
      if (d) { done = d; assert.ok([1, 3, 5].includes(wall(tz, t).wd), `${tz}: posted on a ${wall(tz, t).wd}`); }
    }
  }
});

test('quiet hours (9pm–7am) hold on the wall clock through clock changes', () => {
  for (const tz of ZONES) for (const start of Object.values(WINDOWS)) for (const t of ticks(start)) {
    const h = wall(tz, t).hour;
    assert.equal(quietNow(tz, new Date(t)), h >= 21 || h < 7, `${tz} ${new Date(t).toISOString()}`);
  }
});

test('the overnight top-up runs once a night between 1 and 6am, through clock changes', () => {
  for (const tz of ZONES) {
    const ws = store.createWorkspace({ name: `Night ${tz}`, comped: true });
    store.updateWorkspace(ws.id, { onboarded: true });
    const cfg = store.loadConfig(ws.id); cfg.profile = { ...(cfg.profile || {}), timezone: tz }; cfg.schedule = { ...(cfg.schedule || {}), keepReady: 2 }; store.saveConfig(ws.id, cfg);
    for (const [name, start] of Object.entries(WINDOWS)) {
      store.updateWorkspace(ws.id, { keepReadyDay: '' });
      const runs = [];
      for (const t of ticks(start)) keepReady((wsId, n) => { if (wsId === ws.id) runs.push(t); return [{}]; }, new Date(t));
      const nights = runs.map(t => wall(tz, t));
      assert.equal(new Set(nights.map(n => n.date)).size, nights.length, `${tz} ${name}: twice in one night`);
      for (const n of nights) assert.ok(n.hour >= 1 && n.hour < 6, `${tz} ${name}: ran at ${n.hour}h`);
      assert.ok(nights.length >= 3, `${tz} ${name}: only ${nights.length} nights`);
    }
    store.updateWorkspace(ws.id, { suspended: true });
  }
});

test('“the next few days” never skips or repeats a day (running low, the Monday plan, the week ahead)', () => {
  for (const tz of ZONES) for (const start of Object.values(WINDOWS)) for (const t of ticks(start).filter((_, i) => i % 3 === 0)) {
    // Running low: needed = plan days among the next 3 local dates (by the calendar).
    const today0 = wall(tz, t).date;
    const next3 = [0, 1, 2].map(d => new Date(Date.parse(`${today0}T12:00:00Z`) + d * 86400000).getUTCDay());
    for (const wd of [0, 1, 6]) {
      const one = { profile: { timezone: tz }, schedule: { autopost: { on: true, days: [wd], time: '09:00', platforms: ['instagram'] } } };
      const want = next3.filter(x => x === wd).length;
      assert.equal(mc.runningLow(one, [], t, 3)?.needed || 0, want, `${tz} ${new Date(t).toISOString()} plan day ${wd}`);
    }
    const cfg = { profile: { timezone: tz }, schedule: { autopost: { on: true, days: [0, 1, 2, 3, 4, 5, 6], time: '09:00', platforms: ['instagram'] } } };
    // The week ahead: seven consecutive local dates starting today.
    const wa = mc.weekAhead(cfg, [], t);
    const today = wall(tz, t).date;
    assert.equal(wa.days[0].date, today);
    for (let i = 1; i < 7; i++) assert.equal(Date.parse(`${wa.days[i].date}T00:00:00Z`) - Date.parse(`${wa.days[i - 1].date}T00:00:00Z`), 86400000);
  }
});

test('the next Monday plan is always the next local Monday, through clock changes', () => {
  const ws = store.createWorkspace({ name: 'Mondays', comped: true });
  for (const tz of ZONES) {
    const cfg = { profile: { timezone: tz }, schedule: { autoPlan: true } };
    for (const start of Object.values(WINDOWS)) for (const t of ticks(start).filter((_, i) => i % 6 === 0)) {
      const got = S.nextPlanMonday(ws.id, cfg, new Date(t));
      const w = wall(tz, t);
      assert.equal(new Date(`${got}T12:00:00Z`).getUTCDay(), 1, `${tz}: ${got} isn’t a Monday`);
      const days = (Date.parse(`${got}T00:00:00Z`) - Date.parse(`${w.date}T00:00:00Z`)) / 86400000;
      assert.ok(days >= 0 && days <= 7, `${tz} ${new Date(t).toISOString()}: ${got} is ${days} days from ${w.date}`);
      if (w.wd !== 1) assert.ok(days >= 1 && days <= 6, `${tz}: skipped a Monday (${w.date} → ${got})`);
    }
  }
});

test('leap day and year end: dates step by the calendar', () => {
  const tz = 'America/Denver';
  const cfg = { profile: { timezone: tz }, schedule: { autopost: { on: true, days: [0, 1, 2, 3, 4, 5, 6], time: '09:00' } } };
  const wa = mc.weekAhead(cfg, [], Date.parse('2028-02-27T20:00:00Z'));
  assert.deepEqual(wa.days.slice(0, 4).map(d => d.date), ['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01']);
  const ye = mc.weekAhead(cfg, [], Date.parse('2027-12-30T20:00:00Z'));
  assert.deepEqual(ye.days.slice(0, 4).map(d => d.date), ['2027-12-30', '2027-12-31', '2028-01-01', '2028-01-02']);
});
