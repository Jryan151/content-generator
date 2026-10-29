// Quality: only business that sticks counts.
//
// A builder's real goal is agents whose policies stay on the books. Volume
// that lapses becomes chargebacks, and recruits who write it quit. So the
// score is:
//
//   submitted → placed (carrier issued it) → still active at 3, 6, 12 months
//
// Everything is read from the activity log, never typed in:
//   app_written     submitted
//   policy_issued   placed (carries lead_id so its lapse can be matched)
//   chargeback      the same lead lapsed after issue (logged by the schema
//                   trigger when a lead moves from issued/lapse_risk to lost)
//
// Real or blank: a rate is null until there is something real to divide.
// A policy only counts at a checkpoint once it is old enough to be judged,
// so a policy placed last week never makes 12-month persistency look perfect.

import { rangeOf } from './timeframes.js';

/** Months after placement at which a policy is checked. */
export const CHECKPOINTS = Object.freeze([3, 6, 12]);

const addMonths = (d, n) => {
  const out = new Date(d.getTime());
  out.setUTCMonth(out.getUTCMonth() + n);
  return out;
};

const rate = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) / 100 : null);

/**
 * Quality of the business written by `agentIds` (null = everyone in the log),
 * as of the end of `dayKey` in their local time.
 *
 * Returns {
 *   submitted, placed, lapsed,
 *   placeRate          placed ÷ submitted, or null
 *   untracked          placed policies with no lead attached (can't be followed)
 *   activeAt: { 3: { eligible, active, rate }, 6: …, 12: … }
 *   needsData: [ what's missing, in plain words ]
 * }
 */
export function quality({ activities, agentIds = null, dayKey }) {
  const asOf = rangeOf(dayKey, '1D').end;
  const mine = activities.filter((a) =>
    (agentIds === null || agentIds.includes(a.agent_id)) && new Date(a.occurred_at) < asOf);

  const submitted = mine.filter((a) => a.type === 'app_written').length;
  const issued = mine.filter((a) => a.type === 'policy_issued');
  const lapses = mine.filter((a) => a.type === 'chargeback' && a.lead_id);

  const tracked = issued.filter((p) => p.lead_id);
  const policies = tracked.map((p) => {
    const placedAt = new Date(p.occurred_at);
    const lapse = lapses
      .filter((c) => c.lead_id === p.lead_id && new Date(c.occurred_at) >= placedAt)
      .map((c) => new Date(c.occurred_at))
      .sort((x, y) => x - y)
      .at(0) ?? null;
    return { placedAt, lapse };
  });

  const activeAt = {};
  for (const months of CHECKPOINTS) {
    const due = policies.filter((p) => addMonths(p.placedAt, months) <= asOf);
    const active = due.filter((p) => !p.lapse || p.lapse >= addMonths(p.placedAt, months)).length;
    activeAt[months] = { eligible: due.length, active, rate: rate(active, due.length) };
  }

  const needsData = [];
  if (submitted === 0) needsData.push('No applications logged yet');
  if (issued.length === 0) needsData.push('Approvals aren’t tracked yet: mark “Insurer approved” in Pipeline when the carrier approves');
  if (issued.length > 0 && tracked.length < issued.length) needsData.push('Some placed policies have no lead attached, so their lapses can’t be matched');
  for (const m of CHECKPOINTS) {
    if (tracked.length > 0 && activeAt[m].eligible === 0) needsData.push(`No policy is ${m} months old yet`);
  }

  return {
    submitted,
    placed: issued.length,
    lapsed: policies.filter((p) => p.lapse).length,
    // No approval ever marked means approvals aren't being tracked yet, not that none happened.
    placeRate: issued.length ? rate(issued.length, submitted) : null,
    untracked: issued.length - tracked.length,
    activeAt,
    needsData,
  };
}

/**
 * Show rate: meetings held out of meetings booked over the last `days` days
 * (ending on dayKey). Booking but not sitting usually means fear, so a low
 * show rate is an early warning. Null until something was booked.
 */
export function showRate({ activities, agentIds = null, dayKey, days = 30 }) {
  const end = rangeOf(dayKey, '1D').end.getTime();
  const start = end - days * 86_400_000;
  let booked = 0, held = 0;
  for (const a of activities) {
    if (agentIds && !agentIds.includes(a.agent_id)) continue;
    const t = Date.parse(a.occurred_at);
    if (t < start || t >= end) continue;
    // A meeting that hasn't happened yet can't be a no-show, so it isn't counted until its day has passed.
    if (a.type === 'appt_set') { if (!(a.meta?.meeting_on >= dayKey)) booked++; }
    else if (a.type === 'appt_held') held++;
  }
  return { booked, held, rate: booked > 0 ? Math.round(Math.min(1, held / booked) * 100) / 100 : null };
}
