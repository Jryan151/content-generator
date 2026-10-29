// Who needs you: one ranking of a leader's team, used on every screen.
//
// The simulated day showed three screens giving three different answers.
// This file is the one answer. Today's "Needs you", the Team list and the
// weekly summary all read from it.
//
// Order, most urgent first:
//   1. Silence      nothing logged for 2+ workdays. The earliest warning there is,
//                   and it needs no targets, so it works on day one.
//   2. Stalled      studying for the exam for 3+ weeks with no exam yet.
//   3. Quality      a lapsed policy, meetings that don't show, meetings with no sales.
//   4. Pace         behind on meetings this week (only once real targets exist).
// Each person gets ONE action that names their actual problem.

import { totalsFor, keyForCalendarDate, rangeOf, toCalendarDate } from './timeframes.js';
import { placeOnLadder } from './career.js';
import { showRate } from './quality.js';
import { weekStatus } from './paths.js';

const DAY_MS = 86_400_000;
const LEVELS = { urgent: 0, watch: 1, ok: 2 };
const dayStart = (k) => rangeOf(k, '1D').start;
const shift = (k, n) => new Date(dayStart(k).getTime() + n * DAY_MS).toISOString().slice(0, 10);
const isWorkday = (k) => ![0, 6].includes(dayStart(k).getUTCDay());
const localDay = (iso, tz) => keyForCalendarDate(toCalendarDate(iso, tz), '1D');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Workdays with nothing logged since the last active day, counting today once it's past noon. */
export function quietWorkdays({ lastDay, dayKey, now = '00:00', fallbackDay = null }) {
  const from = lastDay ?? fallbackDay;
  if (!from) return 0;
  let n = 0;
  for (let k = shift(from, 1); k < dayKey; k = shift(k, 1)) if (isWorkday(k)) n++;
  if (from < dayKey && isWorkday(dayKey) && now >= '12:00') n++;
  return n;
}

/**
 * Rank one leader's people.
 *   members   [{ id, name, startedOn?: 'YYYY-MM-DD', licensed?: boolean, activities: [...] }]
 *             each person's own rows (agent_id === id)
 *   dayKey    'YYYY-MM-DD' in the leader's time zone, now 'HH:MM', tz
 *   plan      the leader's plan, or null until targets are real (pace is skipped)
 * Returns [{ id, name, level: 'urgent'|'watch'|'ok', reason, action, facts }], most urgent first.
 */
export function whoNeedsYou({ members, dayKey, now = '12:00', tz, plan = null }) {
  const out = members.map((m) => {
    const rows = m.activities || [];
    const last = rows.reduce((mx, a) => (a.occurred_at > mx ? a.occurred_at : mx), '');
    const lastDay = last ? localDay(last, tz) : null;
    const today = totalsFor(rows, { tf: '1D', key: dayKey, tz, agentIds: [m.id] });
    const studying = m.licensed === false && !rows.some((a) => a.type === 'license_passed');
    const facts = { lastActiveDay: lastDay, callsToday: today.dials, studying };
    const say = (level, score, reason, action) => ({ id: m.id, name: m.name, level, score, reason, action, facts });

    // 1. Silence.
    const quiet = quietWorkdays({ lastDay, dayKey, now, fallbackDay: m.startedOn || null });
    facts.quietWorkdays = quiet;
    if (!lastDay && !m.startedOn) return say('watch', 1, 'Nothing logged yet', `Help ${m.name} log their first ${studying ? 'study session' : 'call'} today.`);
    if (quiet >= 2) return say('urgent', 100 + quiet, `Nothing logged for ${plural(quiet, 'workday')}`, `Call ${m.name} today. Ask what’s in the way, and whether they still want this.`);

    if (studying) {
      const week = totalsFor(rows, { tf: '1W', key: keyForCalendarDate(dayStart(dayKey), '1W'), tz, agentIds: [m.id] });
      const scores = rows.filter((a) => a.type === 'practice_test').sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).map((a) => Number(a.value));
      facts.studyThisWeek = week.studySessions; facts.lastScore = scores.at(-1) ?? null;
      const days = m.startedOn ? Math.round((dayStart(dayKey) - dayStart(m.startedOn)) / DAY_MS) : null;
      facts.daysStudying = days;
      // 2. Stalled before the exam.
      if (days !== null && days >= 21) return say('watch', 60 + days, `Studying ${days} days, no exam yet`, `Ask ${m.name} to book the exam date${scores.length ? ` (last practice score ${scores.at(-1)})` : ''}.`);
      if (quiet === 1) return say('watch', 40, 'No studying logged yesterday', `Check in with ${m.name}: one study session today keeps them on track.`);
      return say('ok', 0, `Studying: ${plural(week.studySessions, 'session')} this week`, `${m.name} is on track for the exam.`);
    }

    // 3. Quality.
    const month = { activities: rows, agentIds: [m.id], dayKey };
    const lapses = rows.filter((a) => a.type === 'chargeback' && a.occurred_at >= rangeOf(shift(dayKey, -30), '1D').start.toISOString()).length;
    const sr = showRate(month);
    const since = (d) => rows.filter((a) => a.occurred_at >= rangeOf(shift(dayKey, -d), '1D').start.toISOString());
    const recent = since(14);
    const held = recent.filter((a) => a.type === 'appt_held').length, apps = recent.filter((a) => a.type === 'app_written').length;
    facts.showRate = sr.booked >= 3 ? sr.rate : null; facts.lapses30 = lapses;
    if (lapses > 0) return say('watch', 80 + lapses, `${plural(lapses, 'policy', 'policies')} lapsed this month`, `Go over the lapse with ${m.name}: was the kitchen-table check really done?`);
    if (sr.booked >= 3 && sr.rate < 0.6) return say('watch', 70, `${sr.held} of ${sr.booked} meetings showed`, `Help ${m.name} confirm every meeting the day before, and book closer to the call.`);
    if (held >= 3 && apps === 0) return say('watch', 65, `${plural(held, 'meeting')}, no applications`, `Sit in on ${m.name}’s next meeting and coach the close.`);
    if (quiet === 1) return say('watch', 50, now >= '12:00' ? 'No calls yet today' : 'Nothing logged yesterday', `Send ${m.name} a quick check-in: ${now >= '12:00' ? 'zero calls at noon' : 'nothing logged yesterday'}.`);

    // 4. Pace, only with real targets.
    if (plan?.weekly?.appts) {
      const wk = weekStatus(rows, { agentId: m.id, dayKey, tz, weeklyAppts: plan.weekly.appts });
      if (wk.status === 'red') return say('watch', 30, `${wk.appts} of ${wk.pace} meetings on pace this week`, `Book a 1:1 with ${m.name} about filling the calendar.`);
    }
    return say('ok', 0, today.dials ? `${plural(today.dials, 'call')} today` : 'On track', `${m.name} is on track.`);
  });
  return out.sort((a, b) => LEVELS[a.level] - LEVELS[b.level] || b.score - a.score || a.name.localeCompare(b.name))
    .map(({ score, ...rest }) => rest);
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
      placed: rows.filter((a) => a.type === 'policy_issued').length,
      lapsed: rows.filter((a) => a.type === 'chargeback').length,
      applications: rows.filter((a) => a.type === 'app_written').length,
    };
  });
  const top = people.find((p) => p.level !== 'ok') || null;
  return {
    dayKey, people, top,
    counts: { urgent: people.filter((p) => p.level === 'urgent').length, watch: people.filter((p) => p.level === 'watch').length, ok: people.filter((p) => p.level === 'ok').length },
    stages: people.map((p) => p.stage),
  };
}

/** The two-minute weekly read for a leader, as plain lines. */
export function weeklyLines(summary) {
  const { counts, people } = summary;
  const lines = [`${plural(people.length, 'person', 'people')} on your team: ${counts.urgent} need you now, ${counts.watch} to watch, ${counts.ok} on track.`];
  for (const p of people.filter((x) => x.level !== 'ok')) lines.push(`${p.name}: ${p.reason}. ${p.action}`);
  return lines;
}
