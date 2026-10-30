// The leader rules: fixed lines that turn into "if THIS, then do THAT" with a name in it.
//
// There is one ladder: the career stages in career.js. A leader's rules depend on her stage
// (producer or coach; director is parked). One yes/no question at setup picks the stage she
// starts at; after that her real activity places her (career.js). Agents never pick anything.
//
// Black and white means: every status is green or red by a fixed number, and
// every rule is "if THIS, then do THAT" with a person's name in it. Nobody has
// to interpret a chart to know what to do next.

import { totalsFor, keyForCalendarDate, previousKey, rangeOf } from './timeframes.js';

/** The leader stages these rules know. Director is parked (career.js PARKED_STAGES). */
const LEADER_STAGES = Object.freeze(['producer', 'coach', 'director']);

/**
 * One yes/no question → the stage she starts at. It only seeds day one; after that her
 * activity places her (career.js).
 *   Do you have agents under you who are selling right now?   no → producer, yes → coach
 */
export const START_QUESTION = Object.freeze({ id: 'hasAgents', text: 'Do you have agents under you who are selling right now?' });

export function startingStage({ hasAgents }) {
  if (typeof hasAgents !== 'boolean') throw new Error('Answer yes or no: do you have agents selling right now?');
  return hasAgents ? 'coach' : 'producer';
}

/** The fixed lines. Change them per team; never make them fuzzy. */
export const THRESHOLDS = Object.freeze({
  redBelow: 0.7,          // under 70% of pace = red
  noonCheck: '12:00',     // zero dials by noon = noon message
  postBy: null,           // content is optional; set a time (e.g. '10:00') to turn the post reminder on
  selfHalfDialsBy: '12:00', // leader under half their dials by noon = add a block
  newAgentDays: 30,       // first 30 days = training rules apply
  trainingBy: '16:30',    // no training step by 4:30 = call them
});

/** Scripts for the rules, so nobody has to decide what to say. */
export const MESSAGES = Object.freeze({
  noon: (name) => `Hey ${name}, no calls on the board yet today. What's in the way? Let's get your first 5 done in the next 30 minutes.`,
  trainingSkipped: (name) => `Hey ${name}, today's training step is still open. It takes 15 minutes. Can you finish it before 5?`,
});

const WORKDAY_INDEX = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }; // Mon..Fri → days elapsed
const DAY_MS = 86_400_000;

/** Week-to-date appointments vs pace. Green or red, nothing else. */
export function weekStatus(activities, { agentId, dayKey, tz, weeklyAppts, fullWeek = false, redBelow = THRESHOLDS.redBelow }) {
  const weekKey = keyForCalendarDate(rangeOf(dayKey, '1D').start, '1W');
  const { start } = rangeOf(weekKey, '1W');
  const today = rangeOf(dayKey, '1D').start;
  let appts = 0;
  for (let t = start.getTime(); t <= today.getTime(); t += DAY_MS) {
    const k = new Date(t).toISOString().slice(0, 10);
    appts += totalsFor(activities, { tf: '1D', key: k, tz, agentIds: [agentId] }).apptsSet;
  }
  const elapsed = fullWeek ? 5 : (WORKDAY_INDEX[today.getUTCDay()] ?? 5);
  const pace = (weeklyAppts * elapsed) / 5;
  const ratio = pace > 0 ? appts / pace : 1;
  return { weekKey, appts, pace: Math.round(pace * 10) / 10, status: ratio < redBelow ? 'red' : 'green' };
}

function fullWeekStatus(activities, { agentId, weekKey, tz, weeklyAppts, redBelow = THRESHOLDS.redBelow }) {
  const appts = totalsFor(activities, { tf: '1W', key: weekKey, tz, agentIds: [agentId] }).apptsSet;
  return appts / weeklyAppts < redBelow ? 'red' : 'green';
}

const daysBetween = (fromKey, toKey) =>
  Math.round((rangeOf(toKey, '1D').start - rangeOf(fromKey, '1D').start) / DAY_MS);

/**
 * Run the rules for one leader at one moment. Returns a list of actions,
 * each one sentence with a name in it, ordered most urgent first.
 *
 * input:
 *   stage     her career stage: 'producer' | 'coach' (or the parked 'director')
 *   dayKey    '2026-10-30'   now  '15:00' (the leader's local time)
 *   selfId    the leader's id (their own production counts too)
 *   team      [{ id, name, startedOn: 'YYYY-MM-DD', coach: 'Name' }]  (agents under them)
 *   plan      planDown() result (daily.dials, daily.posts, weekly.appts)
 *   activities, tz
 */
export function actionsFor({ stage, dayKey, now, selfId, team = [], plan, activities, tz, thresholds = THRESHOLDS, messages = MESSAGES }) {
  if (!LEADER_STAGES.includes(stage)) throw new Error(`Unknown leader stage: ${stage}`);
  if (!/^\d{2}:\d{2}$/.test(now)) throw new Error('now must be HH:MM');
  const day = rangeOf(dayKey, '1D').start;
  const isFriday = day.getUTCDay() === 5;
  const isWeekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
  if (isWeekend) return [];
  const T = { ...THRESHOLDS, ...thresholds };
  const M = { ...MESSAGES, ...messages };
  const today = (id) => totalsFor(activities, { tf: '1D', key: dayKey, tz, agentIds: [id] });
  const actions = [];
  const add = (priority, rule, text, who = null) => actions.push({ priority, rule, text, who });
  const routeTo = (agent) => (stage === 'director' ? (agent.coach || 'their coach') : null);

  // ── Your own production (Producer and Coach) ──
  if (stage !== 'director') {
    const me = today(selfId);
    if (T.postBy && now >= T.postBy && me.posts < (plan?.daily?.posts ?? 1)) {
      add(2, 'post-now', 'Post now. Today’s post is still waiting.');
    }
    const goal = plan?.daily?.dials ?? 0;
    if (goal && now >= T.selfHalfDialsBy && me.dials < goal / 2) {
      add(2, 'add-dial-block', `Add a 30-minute call block at 1:30. You have ${goal - me.dials} calls left.`);
    }
  }

  // ── Your team (Coach and Director) ──
  if (stage !== 'producer') {
    for (const a of team) {
      const t = today(a.id);
      const coach = routeTo(a);
      if (now >= T.noonCheck && t.dials === 0) {
        add(1, 'noon-zero', coach
          ? `Tell ${coach} to call ${a.name}. Zero calls at noon.`
          : `Send ${a.name} the noon message. Zero calls so far.`, a.name);
        actions.at(-1).message = M.noon(a.name);
      }
      const isNew = a.startedOn && daysBetween(a.startedOn, dayKey) < T.newAgentDays && daysBetween(a.startedOn, dayKey) >= 0;
      if (isNew && now >= T.trainingBy && t.trainingDone === 0) {
        add(1, 'training-skipped', coach
          ? `Tell ${coach}: ${a.name} skipped training today.`
          : `Call ${a.name}. They skipped today’s training step.`, a.name);
        actions.at(-1).message = M.trainingSkipped(a.name);
      }
      if (isFriday && plan?.weekly?.appts) {
        const wk = weekStatus(activities, { agentId: a.id, dayKey, tz, weeklyAppts: plan.weekly.appts, fullWeek: true, redBelow: T.redBelow });
        if (wk.status === 'red') {
          const lastWeek = previousKey(wk.weekKey, '1W');
          const redBefore = fullWeekStatus(activities, { agentId: a.id, weekKey: lastWeek, tz, weeklyAppts: plan.weekly.appts, redBelow: T.redBelow }) === 'red';
          if (redBefore) {
            add(0, 'red-two-weeks', `Decide today: coaching plan or let go. ${a.name} has been red two weeks in a row.`, a.name);
          } else {
            add(1, 'week-red', coach
              ? `Put ${a.name} on ${coach}’s 1:1 list. ${wk.appts} of ${plan.weekly.appts} appointments this week.`
              : `Book a 1:1 with ${a.name} today. ${wk.appts} of ${plan.weekly.appts} appointments this week.`, a.name);
          }
        }
      }
    }
  }
  return actions.sort((x, y) => x.priority - y.priority);
}

/** The red list: every agent under pace right now. Green agents are not shown. */
export function redList({ team, dayKey, tz, plan, activities, redBelow = THRESHOLDS.redBelow }) {
  return team
    .map((a) => ({ ...a, ...weekStatus(activities, { agentId: a.id, dayKey, tz, weeklyAppts: plan.weekly.appts, redBelow }) }))
    .filter((a) => a.status === 'red');
}
