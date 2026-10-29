// The climb: Producer → Coach → Director → Upline.
//
// Most CRMs help someone sell more. This file answers the builder's question:
// "What exactly do I need to reach the next level, and what do I do next?"
//
// Two rules keep it honest:
//   1. Growth is measured in agents who PRODUCE and STAY, never head count.
//   2. Level requirements are STARTERS. Replace them with the agency's real
//      promotion rules and the diamond group's criteria before going live.

import { rangeOf, toCalendarDate, bucketKey } from './timeframes.js';
import { emptyTotals, addActivity } from './metrics.js';

const DAY_MS = 86_400_000;

/** Recruiting pipeline: the builder's version of a lead pipeline. */
export const RECRUIT_STAGES = Object.freeze([
  { id: 'prospect',    label: 'Prospect',    next: 'Book an interview' },
  { id: 'interviewed', label: 'Interviewed', next: 'Start licensing' },
  { id: 'licensing',   label: 'Licensing',   next: 'Check exam date; help them study' },
  { id: 'licensed',    label: 'Licensed',    next: 'Start the 30-day Training plan' },
  { id: 'first_sale',  label: 'First sale',  next: 'Keep them on the daily routine' },
  { id: 'producing',   label: 'Producing',   next: 'Ready to coach others? Check the ladder' },
]);

/**
 * The gates between leader stages. Each one is measured by the PEOPLE UNDER
 * YOU, not by head count: you move up when you've produced the next level of
 * people. Values are starters; the agency kit may replace the numbers.
 *   steadyWeeks     weeks with a sale, out of the last 8
 *   playbookReady   every Playbook step has your real words (fixed: not configurable)
 *   agentsSelling   people under you at Selling or above
 *   agentsProducer  people under you at Producer or above
 *   coachesBuilt    people under you at Coach or above
 */
export const LADDER = Object.freeze([
  { from: 'producer', to: 'coach', requires: [
    { metric: 'steadyWeeks', need: 6, label: 'weeks with a sale (last 8)' },
    { metric: 'playbookReady', need: 1, label: 'Playbook in your own words', fixed: true },
  ] },
  { from: 'coach', to: 'director', requires: [
    { metric: 'agentsSelling', need: 3, label: 'agents selling every week' },
    { metric: 'agentsProducer', need: 1, label: 'agent at Producer (ready to train others)' },
  ] },
  { from: 'director', to: 'upline', requires: [
    { metric: 'coachesBuilt', need: 3, label: 'coaches you developed' },
  ] },
]);

const days = (fromKey, toKey) => Math.round((rangeOf(toKey, '1D').start - rangeOf(fromKey, '1D').start) / DAY_MS);
const shiftKey = (dayKey, n) => new Date(rangeOf(dayKey, '1D').start.getTime() + n * DAY_MS).toISOString().slice(0, 10);

/** Sum of an agent's activity over the last `n` days ending on dayKey (one pass over their rows). */
function lastNDays(activities, agentId, dayKey, n, tz) {
  const keys = new Set(Array.from({ length: n }, (_, i) => shiftKey(dayKey, -i)));
  const out = { appsWritten: 0, any: 0 };
  for (const a of activities) {
    if (a.agent_id !== agentId || !keys.has(bucketKey(a.occurred_at, '1D', tz))) continue;
    const t = addActivity(emptyTotals(), a);
    if (t.appsWritten) out.appsWritten += t.appsWritten;
    if (Object.values(t).some((v) => v > 0)) out.any += 1;
  }
  return out;
}

/**
 * Duplication metrics for a builder's team on a given day.
 *   team: [{ id, name, startedOn: 'YYYY-MM-DD', coaches: true|false }]
 *   recruits: [{ stage }]  (people not yet agents)
 *
 * producing   = at least 1 application in the last 30 days
 * active      = any activity in the last 14 days
 * retention90 = of agents who started 90+ days ago, the share still active
 * daysToFirstSale = median days from start to first application
 */
export function duplication({ team, recruits = [], activities, dayKey, tz }) {
  let producingAgents = 0, coaches = 0, eligible90 = 0, retained90 = 0;
  const firstSaleDays = [];
  const perAgent = team.map((a) => {
    const recent = lastNDays(activities, a.id, dayKey, 30, tz);
    const active = lastNDays(activities, a.id, dayKey, 14, tz).any > 0;
    const producing = recent.appsWritten > 0;
    if (producing) producingAgents++;
    if (a.coaches && producing) coaches++;
    const tenure = days(a.startedOn, dayKey);
    if (tenure >= 90) { eligible90++; if (active) retained90++; }
    const firstApp = activities
      .filter((x) => x.agent_id === a.id && x.type === 'app_written')
      .map((x) => x.occurred_at).sort().at(0);
    if (firstApp) firstSaleDays.push(Math.max(0, days(a.startedOn, toCalendarDate(firstApp, tz).toISOString().slice(0, 10))));
    return { id: a.id, name: a.name, producing, active, tenure };
  });
  firstSaleDays.sort((x, y) => x - y);
  const median = firstSaleDays.length ? firstSaleDays.at(Math.floor((firstSaleDays.length - 1) / 2)) : null;
  const byStage = Object.fromEntries(RECRUIT_STAGES.map((s) => [s.id, 0]));
  for (const r of recruits) if (byStage[r.stage] !== undefined) byStage[r.stage]++;
  const licensedRecruits = team.length + recruits.filter((r) => ['licensed', 'first_sale', 'producing'].includes(r.stage)).length;
  return {
    producingAgents, coaches, licensedRecruits,
    retention90: eligible90 ? Math.round((retained90 / eligible90) * 100) / 100 : null,
    daysToFirstSale: median,
    recruitingFunnel: byStage,
    agents: perAgent,
  };
}

/**
 * Where a leader stands on the ladder, black and white:
 * each requirement is met or not, and there is ONE next action — the unmet
 * requirement closest to done (the fastest win).
 */
export function levelProgress({ path, metrics, ladder = LADDER }) {
  const rung = ladder.find((r) => r.from === path);
  if (!rung) throw new Error(`No rung above ${path}`);
  const reqs = rung.requires.map((q) => {
    const have = metrics[q.metric] ?? 0;
    const met = have >= q.need;
    const gap = Math.max(0, q.need - have);
    const share = q.need ? Math.min(1, have / q.need) : 1;
    return { ...q, have, met, gap, share };
  });
  const unmet = reqs.filter((q) => !q.met).sort((x, y) => y.share - x.share);
  const fmt = (q, v) => (q.pct ? `${Math.round(v * 100)}%` : String(v));
  const nextAction = unmet.length === 0
    ? `You meet every requirement for ${cap(rung.to)}. Ask your upline about the promotion this week.`
    : actionFor(unmet.at(0), fmt);
  return {
    from: path, to: rung.to, ready: unmet.length === 0,
    requirements: reqs.map((q) => ({ label: q.label, have: fmt(q, q.have), need: fmt(q, q.need), met: q.met })),
    nextAction,
  };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function actionFor(q, fmt) {
  const n = q.gap, s = n === 1 ? '' : 's';
  switch (q.metric) {
    case 'steadyWeeks':
      return `Keep selling every week: ${fmt(q, q.have)} of the last 8 weeks had a sale, and building opens at ${fmt(q, q.need)}.`;
    case 'playbookReady':
      return 'Finish your Playbook in your own words. It is what every recruit will learn from.';
    case 'agentsSelling':
      return `Get ${n} more agent${s} to steady weekly sales. Start with whoever is closest on the red list.`;
    case 'agentsProducer':
      return 'Help your strongest agent reach Producer: steady sales and their own Playbook. They become your first trainer.';
    case 'coachesBuilt':
      return `Develop ${n} more coach${n === 1 ? '' : 'es'}. Give your strongest Producer the Coach routine and a first recruit.`;
    default:
      return `Close the gap on ${q.label}.`;
  }
}
