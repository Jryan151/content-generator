// Who needs you: one ranking of a leader's team, used on every screen.
//
// The simulated day showed three screens giving three different answers.
// This file is the one answer. Today's "Needs you", the Team list and the
// weekly summary all read from it.
//
// Order, most urgent first:
//   1. Silence      nothing logged for 2+ workdays. The earliest warning there is,
//                   and it needs no targets, so it works on day one.
//   2. Quality      a lapsed policy (always above everything below it).
//   3. Stalled      studying 3+ weeks with no exam booked, or an exam date that passed.
//   4. Selling      meetings that don't show, meetings with no sales, far fewer
//                   calls than the rest of the team.
//   5. Pace         behind on meetings this week (only once real targets exist).
// Each person gets ONE action that names their actual problem.
//
// The leader can clear the top card: "I talked to them" logs a check-in and
// rests that person for 3 workdays (applyCheckins). If they're still in
// trouble after that, they come back.
//
// Also here, because they read the same logs:
//   ownProduction  the leader's own calls against her own recent normal
//   builderMeasure is she building: steady sellers, agents developed, team vs her premium
//   trainer        the strongest agent, paired with the one who needs help

import { totalsFor, keyForCalendarDate, rangeOf, toCalendarDate, bucketKey } from './timeframes.js';
import { placeOnLadder, weeksWithASale, developedHere } from './career.js';
import { showRate } from './quality.js';
import { weekStatus } from './paths.js';
import { payPicture } from './pay.js';

const DAY_MS = 86_400_000;
const LEVELS = { urgent: 0, watch: 1, ok: 2 };
const dayStart = (k) => rangeOf(k, '1D').start;
const shift = (k, n) => new Date(dayStart(k).getTime() + n * DAY_MS).toISOString().slice(0, 10);
const isWorkday = (k) => ![0, 6].includes(dayStart(k).getUTCDay());
const localDay = (iso, tz) => keyForCalendarDate(toCalendarDate(iso, tz), '1D');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dateText = (k) => new Date(`${k}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** The standard lines. Not targets: they compare people with themselves or their team. */
export const ATTENTION = Object.freeze({
  restWorkdays: 3,          // a check-in rests someone this many workdays
  lowActivityShare: 0.25,   // under a quarter of the team's typical calls...
  lowActivityDays: 14,      // ...over the last two weeks
  ownDropShare: 0.8,        // the leader's last 10 workdays under 80% of her 20 before
  eveningShare: 0.6,        // someone who starts logging after 5 PM on 60%+ of their days logs at night
  lapseBookDays: 365,       // a lapse is judged against the policies placed in the last year
  lapseOverTeam: 1.5,       // flagged when their lapse share is over 1.5× the team's typical
  lapseSmallBook: 10,       // under 10 placed policies, any lapse is worth a look
});

/** Workdays with nothing logged since the last active day, counting today once it's past noon. */
export function quietWorkdays({ lastDay, dayKey, now = '00:00', fallbackDay = null }) {
  const from = lastDay ?? fallbackDay;
  if (!from) return 0;
  let n = 0;
  for (let k = shift(from, 1); k < dayKey; k = shift(k, 1)) if (isWorkday(k)) n++;
  if (from < dayKey && isWorkday(dayKey) && now >= '12:00') n++;
  return n;
}

/** The workday `n` workdays after dayKey. */
function workdaysAfter(dayKey, n) {
  let k = dayKey;
  for (let left = n; left > 0;) { k = shift(k, 1); if (isWorkday(k)) left--; }
  return k;
}

const hmCache = new Map();
function localHM(iso, tz) {
  let f = hmCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); hmCache.set(tz, f); }
  return f.format(new Date(iso));
}

/**
 * Does this person log at night? Looks at the last two weeks before today:
 * on most active days, their first entry came after 5 PM. Then "zero calls
 * at noon" means nothing, and today doesn't count as quiet.
 */
export function logsAtNight(rows, { dayKey, tz }) {
  const firstByDay = new Map();
  const from = rangeOf(shift(dayKey, -14), '1D').start.toISOString();
  for (const a of rows) {
    if (a.occurred_at < from) continue;
    const k = bucketKey(a.occurred_at, '1D', tz);
    if (k >= dayKey) continue;
    const hm = localHM(a.occurred_at, tz);
    if (!firstByDay.has(k) || hm < firstByDay.get(k)) firstByDay.set(k, hm);
  }
  const days = [...firstByDay.values()];
  return days.length >= 3 && days.filter((hm) => hm >= '17:00').length / days.length >= ATTENTION.eveningShare;
}

const pctText = (x) => `${Math.round(x * 100)}%`;
/** Lapses in the last 30 days as a share of the policies placed in the last year. */
function lapseShare(rows, dayKey) {
  const since = (d) => rangeOf(shift(dayKey, -d), '1D').start.toISOString();
  const lapses = rows.filter((a) => a.type === 'chargeback' && a.occurred_at >= since(30)).length;
  const book = rows.filter((a) => a.type === 'policy_issued' && a.occurred_at >= since(ATTENTION.lapseBookDays)).length;
  return { lapses, book, share: book ? lapses / book : (lapses ? 1 : 0) };
}

/** Calls per local day for one person: a Map of 'YYYY-MM-DD' → dials. One pass. */
function dialsByDay(rows, tz) {
  const m = new Map();
  for (const a of rows) if (a.type === 'dial') { const k = bucketKey(a.occurred_at, '1D', tz); m.set(k, (m.get(k) || 0) + 1); }
  return m;
}
const dialsSince = (byDay, dayKey, days) => { let n = 0; for (let i = 1; i <= days; i++) n += byDay.get(shift(dayKey, -i)) || 0; return n; };

/**
 * Rank one leader's people.
 *   members   [{ id, name, startedOn?: 'YYYY-MM-DD', licensed?: boolean, activities: [...] }]
 *             each person's own rows (agent_id === id)
 *   dayKey    'YYYY-MM-DD' in the leader's time zone, now 'HH:MM', tz
 *   plan      the leader's plan, or null until targets are real (pace is skipped)
 * Returns [{ id, name, level: 'urgent'|'watch'|'ok', reason, action, facts }], most urgent first.
 */
export function whoNeedsYou({ members, dayKey, now = '12:00', tz, plan = null }) {
  // Two weeks of calls for everyone selling, so "low" means low for this team, not a number we picked.
  const studyingOf = (m) => m.licensed === false && !(m.activities || []).some((a) => a.type === 'license_passed');
  const calls14 = new Map(members.map((m) => [m.id, studyingOf(m) ? null : dialsSince(dialsByDay(m.activities || [], tz), dayKey, ATTENTION.lowActivityDays)]));
  // Lapses, measured against each person's own book: a steady seller with a big book always has a few.
  const lapseOf = new Map(members.map((m) => [m.id, lapseShare(m.activities || [], dayKey)]));

  const out = members.map((m) => {
    const rows = m.activities || [];
    const last = rows.reduce((mx, a) => (a.occurred_at > mx ? a.occurred_at : mx), '');
    const lastDay = last ? localDay(last, tz) : null;
    const today = totalsFor(rows, { tf: '1D', key: dayKey, tz, agentIds: [m.id] });
    const studying = studyingOf(m);
    const night = logsAtNight(rows, { dayKey, tz });
    const facts = { lastActiveDay: lastDay, callsToday: today.dials, studying, logsAtNight: night };
    const say = (level, score, reason, action) => ({ id: m.id, name: m.name, level, score, reason, action, facts });

    // 1. Silence. Someone who logs at night isn't quiet today until tomorrow.
    const quiet = quietWorkdays({ lastDay, dayKey, now: night ? '00:00' : now, fallbackDay: m.startedOn || null });
    facts.quietWorkdays = quiet;
    if (!lastDay && !m.startedOn) return say('watch', 1, 'Nothing logged yet', `Help ${m.name} log their first ${studying ? 'study session' : 'call'} today.`);
    if (quiet >= 2) return say('urgent', 100 + quiet, `Nothing logged for ${plural(quiet, 'workday')}`, `Call ${m.name} today. Ask what’s in the way, and whether they still want this.`);

    if (studying) {
      const week = totalsFor(rows, { tf: '1W', key: keyForCalendarDate(dayStart(dayKey), '1W'), tz, agentIds: [m.id] });
      const scores = rows.filter((a) => a.type === 'practice_test').sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).map((a) => Number(a.value));
      const booked = rows.filter((a) => a.type === 'exam_booked' && a.meta?.exam_on).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).at(-1)?.meta.exam_on ?? null;
      facts.studyThisWeek = week.studySessions; facts.lastScore = scores.at(-1) ?? null; facts.examOn = booked;
      const days = m.startedOn ? Math.round((dayStart(dayKey) - dayStart(m.startedOn)) / DAY_MS) : null;
      facts.daysStudying = days;
      // 3. Stalled before the exam. Capped below a lapse, so a lost policy always comes first.
      if (booked && booked < dayKey) return say('watch', 74, `Exam was ${dateText(booked)}: no result logged`, `Ask ${m.name} how the exam went. Passed: have them tap “I passed my exam”. Not yet: pick the retake date together.`);
      if (booked) return say('ok', 0, `Exam booked for ${dateText(booked)}`, `${m.name} is on track: keep them taking practice tests until then.`);
      if (days !== null && days >= 21) {
        const trend = scores.length >= 2 ? (scores.at(-1) > scores.at(-2) ? ', going up' : scores.at(-1) < scores.at(-2) ? ', going down' : ', flat') : '';
        return say('watch', 60 + Math.min(days - 21, 12), `Studying ${days} days, no exam booked`, scores.length
          ? `Sit down with ${m.name} and their practice scores (last ${scores.at(-1)}${trend}). Agree on an exam date they can hit, and have them book it.`
          : `Ask ${m.name} to take a practice test this week, then pick an exam date together.`);
      }
      if (quiet === 1) return say('watch', 40, 'No studying logged yesterday', `Check in with ${m.name}: one study session today keeps them on track.`);
      return say('ok', 0, `Studying: ${plural(week.studySessions, 'session')} this week`, `${m.name} is on track for the exam.`);
    }

    // 2. Quality.
    const month = { activities: rows, agentIds: [m.id], dayKey };
    const lapses = rows.filter((a) => a.type === 'chargeback' && a.occurred_at >= rangeOf(shift(dayKey, -30), '1D').start.toISOString()).length;
    const sr = showRate(month);
    const since = (d) => rows.filter((a) => a.occurred_at >= rangeOf(shift(dayKey, -d), '1D').start.toISOString());
    const recent = since(14);
    const held = recent.filter((a) => a.type === 'appt_held').length, apps = recent.filter((a) => a.type === 'app_written').length;
    facts.showRate = sr.booked >= 3 ? sr.rate : null; facts.lapses30 = lapses;
    const ls = lapseOf.get(m.id);
    const otherShares = members.filter((x) => x.id !== m.id).map((x) => lapseOf.get(x.id)).filter((x) => x.book >= ATTENTION.lapseSmallBook).map((x) => x.share);
    const typicalLapse = otherShares.length >= 2 ? median(otherShares) : null;
    facts.lapseShare = ls.share; facts.teamLapseShare = typicalLapse;
    const lapseFlag = lapses > 0 && (ls.book < ATTENTION.lapseSmallBook || typicalLapse === null || ls.share > typicalLapse * ATTENTION.lapseOverTeam);
    if (lapseFlag) {
      const vs = ls.book >= ATTENTION.lapseSmallBook && typicalLapse !== null ? `: ${pctText(ls.share)} of their book vs the team’s ${pctText(typicalLapse)}` : '';
      return say('watch', 80 + lapses, `${plural(lapses, 'policy', 'policies')} lapsed this month${vs}`, `Go over the lapse with ${m.name}: was the kitchen-table check really done?`);
    }

    // 4. Selling.
    if (sr.booked >= 3 && sr.rate < 0.6) return say('watch', 70, `${sr.held} of ${sr.booked} meetings showed`, `Help ${m.name} confirm every meeting the day before, and book closer to the call.`);
    if (held >= 3 && apps === 0) return say('watch', 65, `${plural(held, 'meeting')}, no applications`, `Sit in on ${m.name}’s next meeting and coach the close.`);
    const mine = calls14.get(m.id);
    const others = members.filter((x) => x.id !== m.id).map((x) => calls14.get(x.id)).filter((n) => n !== null);
    const typical = others.length >= 2 ? median(others) : null;
    const settled = !m.startedOn || m.startedOn <= shift(dayKey, -ATTENTION.lowActivityDays);
    facts.calls14 = mine; facts.teamTypical14 = typical;
    if (settled && typical >= 20 && mine < typical * ATTENTION.lowActivityShare) {
      return say('watch', 55, `${plural(mine, 'call')} in 2 weeks; the team’s typical is ${Math.round(typical)}`, `Ask ${m.name} what’s taking their time, and agree on a daily call number together.`);
    }
    if (quiet === 1) {
      const noon = now >= '12:00' && !night && lastDay === shift(dayKey, -1);
      return say('watch', 50, noon ? 'No calls yet today' : 'Nothing logged yesterday', `Send ${m.name} a quick check-in: ${noon ? 'zero calls at noon' : 'nothing logged yesterday'}.`);
    }

    // 5. Pace, only with real targets.
    if (plan?.weekly?.appts) {
      const wk = weekStatus(rows, { agentId: m.id, dayKey, tz, weeklyAppts: plan.weekly.appts });
      if (wk.status === 'red') return say('watch', 30, `${wk.appts} of ${wk.pace} meetings on pace this week`, `Book a 1:1 with ${m.name} about filling the calendar.`);
    }
    return say('ok', 0, today.dials ? `${plural(today.dials, 'call')} today` : night ? 'Logs in the evening' : 'On track', `${m.name} is on track.`);
  });
  return out.sort((a, b) => LEVELS[a.level] - LEVELS[b.level] || b.score - a.score || a.name.localeCompare(b.name))
    .map(({ score, ...rest }) => rest);
}

/** Has this person sold in 3 of the last 6 weeks? That's "selling steadily". */
const steadyNow = (m, dayKey, tz) => weeksWithASale(m.activities || [], { personId: m.id, dayKey, tz, outOf: 6 }).count >= 3;

/**
 * Is she building? Three numbers, each now and 30 days ago, from the team's logs:
 *   steady      agents with a sale in 3 of the last 6 weeks
 *   developed   agents who reached Producer on her team
 *   teamPremium premium the team wrote in the last 30 days (her own is added on her phone)
 */
export function builderMeasure({ members, dayKey, tz }) {
  const before = shift(dayKey, -30);
  const licensed = members.filter((m) => m.licensed !== false || (m.activities || []).some((a) => a.type === 'license_passed'));
  const at = (k) => {
    const cut = rangeOf(k, '1D').end.toISOString();
    const upto = licensed.map((m) => ({ ...m, activities: (m.activities || []).filter((a) => a.occurred_at < cut) }));
    return {
      steady: upto.filter((m) => steadyNow(m, k, tz)).length,
      developed: upto.filter((m) => developedHere(m, placeOnLadder({ person: { id: m.id, name: m.name, licensed: m.licensed }, activities: m.activities, dayKey: k, tz }).stage)).length,
    };
  };
  const premium = (from, to) => licensed.reduce((s, m) => s + (m.activities || []).filter((a) => a.type === 'app_written' && a.occurred_at >= from && a.occurred_at < to).reduce((x, a) => x + Number(a.value || 0), 0), 0);
  const t = (k) => rangeOf(k, '1D').end.toISOString();
  const now = at(dayKey), then = at(before);
  return {
    steady: { now: now.steady, before: then.steady },
    developed: { now: now.developed, before: then.developed },
    teamPremium: { now: premium(t(shift(dayKey, -30)), t(dayKey)), before: premium(t(shift(dayKey, -60)), t(before)) },
  };
}

/** The leader's own premium, same windows as builderMeasure's teamPremium. */
export function ownPremium(activities, { me, dayKey }) {
  const t = (k) => rangeOf(k, '1D').end.toISOString();
  const sum = (from, to) => activities.filter((a) => a.agent_id === me && a.type === 'app_written' && a.occurred_at >= from && a.occurred_at < to).reduce((x, a) => x + Number(a.value || 0), 0);
  return { now: sum(t(shift(dayKey, -30)), t(dayKey)), before: sum(t(shift(dayKey, -60)), t(shift(dayKey, -30))) };
}

/**
 * Develop a trainer: the agent selling steadily and on track, paired with the
 * person who needs selling help (not someone silent or studying: that's the leader's call).
 */
export function trainer(people) {
  const t = people.filter((p) => p.level === 'ok' && p.stage === 'producer').sort((a, b) => b.applications - a.applications)[0];
  if (!t) return null;
  const helpable = /meetings showed|no applications|calls in 2 weeks|lapsed|meetings on pace/;
  const l = people.find((p) => p.id !== t.id && p.level !== 'ok' && helpable.test(p.reason));
  if (!l) return { trainerId: t.id, trainerName: t.name, learnerId: null, learnerName: null, action: `Ask ${t.name} to run the next team role-play. Training others starts there.` };
  const action = /lapsed/.test(l.reason)
    ? `Have ${t.name} walk ${l.name} through how they do the kitchen-table check.`
    : `Have ${t.name} sit in on ${l.name}’s next meeting, then tell you one thing ${l.name} should change.`;
  return { trainerId: t.id, trainerName: t.name, learnerId: l.id, learnerName: l.name, action };
}

/**
 * Everything the leader's Team screen and "Needs you" read, in one call.
 * Also places each person on the ladder, so the leader's own stage can use their real stages.
 */
export function teamSummary({ members, dayKey, now, tz, plan = null }) {
  const ranked = whoNeedsYou({ members, dayKey, now, tz, plan });
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));
  const people = ranked.map((r) => {
    const m = byId[r.id];
    const p = placeOnLadder({ person: { id: m.id, name: m.name, licensed: m.licensed }, activities: m.activities || [], dayKey, tz });
    const rows = m.activities || [];
    return {
      ...r, stage: p.stage, stageName: p.name,
      steady: steadyNow(m, dayKey, tz),
      placed: rows.filter((a) => a.type === 'policy_issued').length,
      lapsed: rows.filter((a) => a.type === 'chargeback').length,
      applications: rows.filter((a) => a.type === 'app_written').length,
    };
  });
  const builder = builderMeasure({ members, dayKey, tz });
  return finish({
    dayKey, people, builder, trainer: trainer(people),
    // What the leader's ladder reads: each person's stage, whether they sell steadily, and whether they were developed here.
    stages: people.map((p) => ({ stage: p.stage, steady: p.steady, developed: developedHere(byId[p.id], p.stage) })),
  });
}

function finish(s) {
  const active = s.people.filter((p) => p.level !== 'ok' && !p.restingUntil);
  return {
    ...s,
    top: active[0] || null,
    counts: {
      urgent: active.filter((p) => p.level === 'urgent').length,
      watch: active.filter((p) => p.level === 'watch').length,
      ok: s.people.filter((p) => p.level === 'ok').length,
      resting: s.people.filter((p) => p.level !== 'ok' && p.restingUntil).length,
    },
  };
}

/**
 * The leader's check-ins (her own 'checkin' rows, meta.person_id) rest a person
 * for 3 workdays: they drop below everyone who still needs her, and the top
 * card moves on. After that, if they're still in trouble, they're back.
 */
export function applyCheckins(summary, activities, { dayKey, tz }) {
  if (!summary) return summary;
  const lastBy = new Map();
  for (const a of activities) {
    if (a.type !== 'checkin' || !a.meta?.person_id) continue;
    const k = localDay(a.occurred_at, tz);
    if (!lastBy.has(a.meta.person_id) || k > lastBy.get(a.meta.person_id)) lastBy.set(a.meta.person_id, k);
  }
  const people = summary.people.map((p) => {
    const on = lastBy.get(p.id);
    const until = on ? workdaysAfter(on, ATTENTION.restWorkdays) : null;
    const { restingUntil, checkedInOn, ...rest } = p;
    return until && until > dayKey ? { ...rest, checkedInOn: on, restingUntil: until } : { ...rest, ...(on ? { checkedInOn: on } : {}) };
  });
  const rank = (p) => (p.level === 'ok' ? 2 : p.restingUntil ? 1 : 0);
  people.sort((a, b) => rank(a) - rank(b));   // stable: keeps the ranking inside each group
  return finish({ ...summary, people });
}

/** One check-in row. */
export const checkinRow = ({ me, personId, at }) => ({ agent_id: me, type: 'checkin', occurred_at: at, meta: { person_id: personId } });

/**
 * Production first, for the leader too: her calls over the last 10 workdays
 * against the 20 workdays before. Needs a real "before" (10+ days with calls),
 * so a new user never gets a made-up warning.
 */
export function ownProduction(activities, { me, dayKey, tz }) {
  const mineRows = activities.filter((a) => a.agent_id === me);
  const byDay = dialsByDay(mineRows, tz);
  const off = daysOff(mineRows, tz);
  // Days she marked off (a holiday, a sick day) are not "down": they're skipped, like weekends.
  const workdaysBefore = (from, n) => { const out = []; let k = from; let guard = 0; while (out.length < n && guard++ < 400) { k = shift(k, -1); if (isWorkday(k) && !off.has(k)) out.push(k); } return out; };
  const recentDays = workdaysBefore(dayKey, 10);
  const priorDays = workdaysBefore(recentDays.at(-1), 20);
  const sum = (ks) => ks.reduce((s, k) => s + (byDay.get(k) || 0), 0);
  const priorActive = priorDays.filter((k) => byDay.get(k)).length;
  const recentPerDay = Math.round(sum(recentDays) / 10), priorPerDay = priorActive ? Math.round(sum(priorDays) / priorActive) : null;
  const down = priorActive >= 10 && priorPerDay >= 10 && recentPerDay < priorPerDay * ATTENTION.ownDropShare;
  return { down, recentPerDay, priorPerDay, unmarkedZeroDays: down ? recentDays.filter((k) => !byDay.get(k)) : [] };
}

/** The days someone marked off (their own 'day_off' rows), as local day keys. */
export function daysOff(rows, tz) {
  return new Set(rows.filter((a) => a.type === 'day_off').map((a) => a.meta?.day || bucketKey(a.occurred_at, '1D', tz)));
}

/** One 'day_off' row per day. `day` is the local day it covers (it can be marked afterwards). */
export const dayOffRow = ({ me, day, at, reason = null }) => ({ agent_id: me, type: 'day_off', occurred_at: at, meta: { day, ...(reason ? { reason } : {}) } });

/**
 * Everything a leader's screens read, in ONE call: the ranking, her check-ins applied, and her pay
 * next to her team's. The team's site calls this (and only this) so a signed-in leader gets exactly
 * the tested logic the app and the demo use.
 *   members      her people: [{ id, name, startedOn?, licensed?, activities }]
 *   me, mine     her id and her own rows (check-ins, her own sales)
 *   levels       contract levels set by you { [id]: percent }, or null until they're in (pay stays blank)
 */
export function leaderView({ members, me, mine = [], levels = null, dayKey, now, tz, plan = null, payDays = 30 }) {
  const ranked = applyCheckins(teamSummary({ members, dayKey, now, tz, plan }), mine, { dayKey, tz });
  const names = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const pay = payPicture({ me, activities: [...mine, ...members.flatMap((m) => m.activities || [])], names, levels: levels || {}, dayKey, tz, days: payDays });
  return { ...ranked, pay };
}

/** The two-minute weekly read for a leader, as plain lines. */
export function weeklyLines(summary) {
  const { counts, people } = summary;
  const lines = [`${plural(people.length, 'person', 'people')} on your team: ${counts.urgent} need you now, ${counts.watch} to watch, ${counts.ok} on track.`];
  for (const p of people.filter((x) => x.level !== 'ok')) lines.push(`${p.name}: ${p.reason}. ${p.action}`);
  return lines;
}
