// Career stages: where someone actually is, not where they want to be.
//
//   Starting → Selling → Producer → Coach │ Director → Upline (parked)
//
// The focus is producer to builder, so the ladder tops out at Coach for now
// (FOCUS_TOP). Director and Upline stay defined and tested; pass
// topStage: 'upline' to switch them back on.
//
// Many agencies push new agents to recruit from day one. People end up
// recruiting before they can teach anyone to sell, and the recruits quit.
// This ladder does the opposite on purpose: you build only once you have
// something worth copying.
//
// Black and white:
//   • The stage is computed from activity, never chosen.
//   • Each stage has ONE focus, the reason for it, what's unlocked, and
//     what stays locked until the gate.
//   • Leader gates are measured by the PEOPLE UNDER YOU: you move up when
//     you've produced the next level of people, never by head count.
//   • Leaders keep their stage only while they keep selling. Below the hold
//     line, focus steps back to Selling. That's a focus change, not a
//     demotion: titles and contracts are the agency's.

import { totalsFor, keyForCalendarDate, previousKey, rangeOf } from './timeframes.js';
import { levelProgress, LADDER } from './ladder.js';

export const STAGES = Object.freeze([
  {
    id: 'starting', name: 'Starting',
    focus: 'Get your first sale.',
    why: 'Nothing else is real until you have closed once.',
    unlocked: ['Today', 'Playbook', '30-day Training'],
    locked: ['Recruiting', 'Team'],
  },
  {
    id: 'selling', name: 'Selling',
    focus: 'Sell every week.',
    why: 'One sale can be luck. Steady weeks prove you have a process.',
    unlocked: ['Today', 'Playbook', 'Pipeline', 'Your numbers by week'],
    locked: ['Recruiting', 'Team'],
  },
  {
    id: 'producer', name: 'Producer',
    focus: 'Make your selling copyable.',
    why: 'A recruit inherits your process. If you can’t explain why you close, you’ll recruit people into confusion. Put your selling into your Playbook and keep a list of names for later.',
    unlocked: ['Everything in Selling', 'Your Playbook', 'Names list'],
    locked: ['Recruiting pipeline', 'Team'],
  },
  {
    id: 'coach', name: 'Coach',
    focus: 'Get your agents to a first sale, then to steady sales.',
    why: 'Your income starts shifting to the spread on your agents’ sales, which only pays if they sell. One recruit who reaches Selling is worth more than five who quit.',
    unlocked: ['Everything in Producer', 'Recruiting pipeline', 'Team', 'Red list', 'Noon check'],
    locked: ['Coaches view'],
  },
  {
    id: 'director', name: 'Director',
    focus: 'Build coaches, not agents.',
    why: 'One person can coach only a handful of agents well. Growth past that needs people who do what you did as a Coach. Agents’ problems go to their coach; you handle only what’s red.',
    unlocked: ['Everything in Coach', 'Coaches view'],
    locked: ['All-teams view'],
  },
  {
    id: 'upline', name: 'Upline',
    focus: 'Protect the standard.',
    why: 'Your income is teams of teams. The risk is the system getting diluted: sloppy selling, chargebacks, recruiting hype. Keep the Playbook, compliance and retention strong, and spot the next Director.',
    unlocked: ['Everything', 'All-teams view'],
    locked: [],
  },
]);

const ORDER = STAGES.map((s) => s.id);

/** The highest stage the system places anyone at while the focus is producer to builder. */
export const FOCUS_TOP = 'coach';
export const PARKED_STAGES = Object.freeze(['director', 'upline']);
const rank = (id) => ORDER.indexOf(id);

/** Gates below the leader stages (starters). */
export const SELLING_GATES = Object.freeze({
  toProducer: { weeksWithASale: 4, outOfWeeks: 6 },
  holdLeader: { weeksWithASale: 3, outOfWeeks: 6 }, // Producer and up keep their stage only while selling
  steadyOutOfWeeks: 8,                              // the window for the steadyWeeks gate to Coach
});

/** The last `n` completed weeks before the week containing dayKey, newest first. */
function lastWeeks(dayKey, n) {
  let k = previousKey(keyForCalendarDate(rangeOf(dayKey, '1D').start, '1W'), '1W');
  const keys = [];
  for (let i = 0; i < n; i++) { keys.push(k); k = previousKey(k, '1W'); }
  return keys;
}

/** How many of the last N completed weeks had at least one application. */
export function weeksWithASale(activities, { personId, dayKey, tz, outOf }) {
  const weeks = lastWeeks(dayKey, outOf);
  const flags = weeks.map((k) => totalsFor(activities, { tf: '1W', key: k, tz, agentIds: [personId] }).appsWritten > 0);
  return { count: flags.filter(Boolean).length, outOf, weeks, flags };
}

const everSold = (activities, id) => activities.some((a) => a.agent_id === id && a.type === 'app_written');

/**
 * Place one person on the ladder.
 *   person       { id, name }
 *   team         the people directly under them: [{ id, name, team?, playbookReady? }]
 *                (nested teams let the system see the coaches they've built)
 *   playbookReady  true once every Playbook step has their real words
 *
 * Returns { stage, name, focus, why, unlocked, locked, gate, nextAction, slipped }.
 */
export function placeOnLadder({ person, team = [], activities, dayKey, tz, ladder = LADDER, gates = SELLING_GATES, playbookReady = false, depth = 0, topStage = FOCUS_TOP }) {
  const result = (id, extra) => {
    const s = STAGES[rank(id)];
    return { stage: id, name: s.name, focus: s.focus, why: s.why, unlocked: s.unlocked, locked: s.locked, slipped: false, gate: null, ...extra };
  };

  if (!everSold(activities, person.id)) {
    return result('starting', {
      gate: { to: 'Selling', requirements: [{ label: 'first application', have: '0', need: '1', met: false }] },
      nextAction: 'Get your first sale. Work the 30-day plan and hit today’s dials.',
    });
  }

  const recent = weeksWithASale(activities, { personId: person.id, dayKey, tz, outOf: gates.toProducer.outOfWeeks });
  const consistent = recent.count >= gates.toProducer.weeksWithASale;
  const holding = recent.count >= gates.holdLeader.weeksWithASale;

  // Where the people under them are (depth-limited so a bad tree can't loop forever).
  const under = depth < 4
    ? team.map((m) => placeOnLadder({ person: m, team: m.team || [], activities, dayKey, tz, ladder, gates, playbookReady: !!m.playbookReady, depth: depth + 1, topStage }).stage)
    : [];
  const atLeast = (id) => under.filter((st) => rank(st) >= rank(id)).length;
  const metrics = {
    steadyWeeks: weeksWithASale(activities, { personId: person.id, dayKey, tz, outOf: gates.steadyOutOfWeeks }).count,
    playbookReady: playbookReady ? 1 : 0,
    agentsSelling: atLeast('selling'),
    agentsProducer: atLeast('producer'),
    coachesBuilt: atLeast('coach'),
  };

  // The steady-weeks gate is proof before building. Once someone under you
  // sells, that proof is established; from then on the hold line applies.
  if (metrics.agentsSelling >= 1 && holding) metrics.steadyWeeks = Math.max(metrics.steadyWeeks, ladder.at(0).requires.find((q) => q.metric === 'steadyWeeks')?.need ?? 0);

  // Highest leader stage whose gates they've passed.
  let leader = 'producer';
  for (const rung of ladder) {
    if (rung.from !== leader) break;
    if (levelProgress({ path: rung.from, metrics, ladder }).ready) leader = rung.to; else break;
  }
  const capped = rank(leader) > rank(topStage);
  if (capped) leader = topStage;
  const isLeader = rank(leader) >= rank('coach');

  if (!consistent && !(isLeader && holding)) {
    const slipped = isLeader || team.length > 0;
    const need = gates.toProducer.weeksWithASale - recent.count;
    const weeks = `${need} more week${need === 1 ? '' : 's'}`;
    return result('selling', {
      slipped,
      gate: { to: 'Producer', requirements: [{ label: `weeks with a sale (last ${gates.toProducer.outOfWeeks})`, have: String(recent.count), need: String(gates.toProducer.weeksWithASale), met: false }] },
      nextAction: slipped
        ? `Your own selling slipped (${recent.count} of the last ${gates.toProducer.outOfWeeks} weeks). Focus on your sales for ${weeks} with a sale; building waits.`
        : `Sell in ${weeks} to reach Producer.`,
    });
  }

  if (leader === 'upline') return result('upline', { nextAction: 'Pick the next Director to develop and copy the system to them.' });
  const p = levelProgress({ path: leader, metrics, ladder });
  const parked = PARKED_STAGES.includes(p.to) && rank(p.to) > rank(topStage);
  const nextAction = parked && p.ready
    ? 'Your team is selling steadily. Director is parked for now: keep every agent green and your own sales steady.'
    : p.nextAction;
  return result(leader, { gate: { to: cap(p.to), parked, requirements: p.requirements }, nextAction, metrics });
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Which routine a stage runs (feeds todoFor). Starting gets a daily training block. */
export function routineFor(stageId) {
  switch (stageId) {
    case 'starting': return { role: 'agent', path: null, starting: true };
    case 'selling': return { role: 'agent', path: null, starting: false };
    case 'producer': return { role: 'builder', path: 'producer', starting: false };
    case 'coach': return { role: 'builder', path: 'coach', starting: false };
    default: return { role: 'builder', path: 'director', starting: false };
  }
}

/** Is a feature open at this stage? Yes or no. */
export function isUnlocked(stageId, feature) {
  const opensAt = {
    'Names list': 'producer', Recruiting: 'coach', 'Recruiting pipeline': 'coach', Team: 'coach',
    'Red list': 'coach', 'Coaches view': 'director', 'All-teams view': 'upline',
  };
  const at = opensAt[feature];
  return at ? rank(stageId) >= rank(at) : true;
}
