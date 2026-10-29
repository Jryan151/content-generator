// Commission tracker: what you should have been paid vs what arrived.
//
// Leaders often can't easily check their pay. The system already knows every
// issued policy; with contract levels (filled in by you, never typed by the
// agent) it can show, black and white:
//
//   expected  the advance on your own policies and the override (spread) on
//             your team's, and when each should land
//   received  what was marked paid (one tap per payment)
//   late      due and not fully paid: in red, with the policy and amount
//
// This is a tracker and a record, not accounting or legal advice. It covers
// ADVANCES only (the part most agents are paid up front). The unadvanced
// balance and renewals depend on each carrier's schedule and are not tracked.

import { rangeOf } from '../timeframes.js';

export const STARTER_COMP = Object.freeze({
  advancePercent: 75,  // share of first-year commission paid up front
  advanceDueDays: 14,  // days after issue the advance should arrive
});

const DAY_MS = 86_400_000;
const addDays = (dayKey, n) => new Date(rangeOf(dayKey, '1D').start.getTime() + n * DAY_MS).toISOString().slice(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;
const usd = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/**
 * Who is directly below `me` on the way down to `agentId`, or null if the
 * agent isn't in my downline. Returns me if the agent is me.
 */
function stepBelow(people, me, agentId) {
  let cur = agentId, prev = null, guard = 0;
  while (cur && guard++ < 50) {
    if (cur === me) return prev ?? me;
    prev = cur;
    cur = people[cur]?.uplineId ?? null;
  }
  return null;
}

/**
 * Expected payments for one person.
 *   me        person id
 *   people    { [id]: { name, contractPercent, uplineId } }  (contract levels from you)
 *   policies  [{ id, agentId, client, annualPremium, issuedOn: 'YYYY-MM-DD' }]
 *   comp      { advancePercent, advanceDueDays }  (agency kit; starters if blank)
 */
export function expectedPayments({ me, people, policies, comp = STARTER_COMP }) {
  const adv = (comp.advancePercent ?? STARTER_COMP.advancePercent) / 100;
  const dueDays = comp.advanceDueDays ?? STARTER_COMP.advanceDueDays;
  const mine = people[me]?.contractPercent;
  const missingLevels = new Set();
  if (mine == null) missingLevels.add(people[me]?.name || 'You');
  const items = [];
  for (const p of policies) {
    const below = stepBelow(people, me, p.agentId);
    if (!below) continue; // not mine and not my downline
    const base = { policyId: p.id, client: p.client, agentId: p.agentId, agent: people[p.agentId]?.name || 'Agent', issuedOn: p.issuedOn, dueOn: addDays(p.issuedOn, dueDays) };
    if (mine == null) continue;
    if (below === me) {
      items.push({ ...base, id: `${p.id}:advance:${me}`, kind: 'advance', amount: round2(p.annualPremium * (mine / 100) * adv) });
    } else {
      const theirs = people[below]?.contractPercent;
      if (theirs == null) { missingLevels.add(people[below]?.name || 'An agent'); continue; }
      const spread = mine - theirs;
      if (spread > 0) items.push({ ...base, id: `${p.id}:override:${me}`, kind: 'override', amount: round2(p.annualPremium * (spread / 100) * adv) });
    }
  }
  return { items, missingLevels: [...missingLevels] };
}

/**
 * Match payments to what was expected and put every item in exactly one state:
 *   paid · partial · late · due
 * Payments: [{ expectedId, amount, receivedOn }]  (one tap marks an item paid)
 */
export function reconcile({ expected, payments = [], today }) {
  const paidBy = new Map();
  for (const pay of payments) paidBy.set(pay.expectedId, round2((paidBy.get(pay.expectedId) || 0) + Number(pay.amount || 0)));
  const rows = expected.items.map((it) => {
    const received = paidBy.get(it.id) || 0;
    const short = round2(Math.max(0, it.amount - received));
    let status;
    if (short <= 0.99) status = 'paid';
    else if (it.dueOn <= today) status = received > 0 ? 'partial' : 'late';
    else status = 'due';
    return { ...it, received, short, status };
  });
  const late = rows.filter((r) => r.status === 'late' || r.status === 'partial').sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const sum = (xs, f) => round2(xs.reduce((s, x) => s + f(x), 0));
  const summary = {
    expected: sum(rows, (r) => r.amount),
    received: sum(rows, (r) => r.received),
    lateAmount: sum(late, (r) => r.short),
    lateCount: late.length,
    dueSoon: sum(rows.filter((r) => r.status === 'due'), (r) => r.amount),
  };
  let nextAction;
  if (expected.missingLevels.length) {
    nextAction = `Can’t check pay yet: contract levels missing for ${expected.missingLevels.join(', ')}.`;
  } else if (late.length) {
    const o = late.at(0);
    nextAction = `Ask your agency in writing about ${late.length} late payment${late.length === 1 ? '' : 's'} (${usd(summary.lateAmount)}). Oldest: ${o.client}, ${o.agent}, ${usd(o.short)} due ${o.dueOn}.`;
  } else {
    nextAction = 'Every payment due so far has arrived.';
  }
  return { rows, late, summary, nextAction };
}

/** Policies from the activity log: each policy_issued row with its lead and premium. */
export function policiesFromActivities(activities, { clients = {}, tz } = {}) {
  return activities
    .filter((a) => a.type === 'policy_issued')
    .map((a, i) => ({
      id: a.lead_id || `policy-${i + 1}`,
      agentId: a.agent_id,
      client: clients[a.lead_id] || 'Client',
      annualPremium: Number(a.value || 0),
      issuedOn: new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/Phoenix' }).format(new Date(a.occurred_at)),
    }));
}
