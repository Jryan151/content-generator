// What the week paid her: her own sales next to what her team paid her.
//
// The six-month Renee run showed the main reason a top producer keeps working
// instead of building: her own sales are money she can see, and the override
// from her team is money she never sees beside it. In her worst month the team
// paid her almost as much as she paid herself, and nothing on screen said so.
//
// This reads the same activity log as everything else (policy_issued and
// chargeback rows, matched by lead) and the advance math from the commission
// tracker (src/parked/commissions.js). It adds one thing the tracker leaves out:
// clawbacks, because only business that sticks counts.
//
// Real or blank: contract levels are set by you (never typed by the agent).
// Until her level, and every level under her, is in, the numbers stay blank
// and `waitingOn` names who is missing.

import { expectedPayments, STARTER_COMP } from './parked/commissions.js';
import { bucketKey, rangeOf } from './timeframes.js';

/** A lapse claws the advance back only inside this window after the policy was placed. */
export const CHARGEBACK_MONTHS = 12;

const DAY_MS = 86_400_000;
const round = (n) => Math.round(n * 100) / 100;
const shift = (k, n) => new Date(rangeOf(k, '1D').start.getTime() + n * DAY_MS).toISOString().slice(0, 10);

/**
 * Her pay picture for the last `days` days ending on dayKey (her time zone).
 *   me          her id
 *   activities  her rows and her team's rows (agent_id tells them apart)
 *   names       { [id]: name } (optional, for waitingOn)
 *   levels      { [id]: contract percent } — hers and each person's under her, set by you
 *   uplineOf    { [id]: their upline's id } — anyone missing is directly under her
 *   comp        { advancePercent, advanceDueDays } from the agency kit (starters if blank)
 * Returns {
 *   ready, waitingOn: [names whose level is missing],
 *   own:  { paid, clawback, net } | null   advances on her own placed policies
 *   team: { paid, clawback, net } | null   overrides on her team's placed policies
 *   teamShare  team net ÷ (own net + team net), or null
 * }
 */
export function payPicture({ me, activities, names = {}, levels = {}, uplineOf = {}, dayKey, tz, days = 7, comp = STARTER_COMP }) {
  const ids = new Set(activities.map((a) => a.agent_id));
  ids.add(me);
  const people = {};
  for (const id of ids) people[id] = { name: names[id] || (id === me ? 'You' : id), contractPercent: levels[id] ?? null, uplineId: id === me ? null : (uplineOf[id] ?? me) };

  const from = shift(dayKey, -(days - 1));
  const inWindow = (a) => { const k = bucketKey(a.occurred_at, '1D', tz); return k >= from && k <= dayKey; };
  const issued = activities.filter((a) => a.type === 'policy_issued' && a.lead_id);
  const policies = issued.filter(inWindow).map((a) => ({ id: a.lead_id, agentId: a.agent_id, client: a.lead_id, annualPremium: Number(a.value || 0), issuedOn: bucketKey(a.occurred_at, '1D', tz) }));
  const exp = expectedPayments({ me, people, policies, comp });

  // Clawbacks in the window: the advance on a policy placed within CHARGEBACK_MONTHS before the lapse.
  const issuedBy = new Map(issued.map((a) => [`${a.agent_id}|${a.lead_id}`, a]));
  const lapses = activities.filter((a) => a.type === 'chargeback' && a.lead_id && inWindow(a)).flatMap((c) => {
    const p = issuedBy.get(`${c.agent_id}|${c.lead_id}`);
    if (!p || Date.parse(c.occurred_at) - Date.parse(p.occurred_at) > CHARGEBACK_MONTHS * 30.5 * DAY_MS) return [];
    return [{ id: c.lead_id, agentId: c.agent_id, client: c.lead_id, annualPremium: Number(p.value || c.value || 0), issuedOn: bucketKey(p.occurred_at, '1D', tz) }];
  });
  const back = expectedPayments({ me, people, policies: lapses, comp });

  const sum = (items, kind) => round(items.filter((i) => i.kind === kind).reduce((s, i) => s + i.amount, 0));
  const waitingOn = [...new Set([...exp.missingLevels, ...back.missingLevels])];
  // Anyone on the team whose level is missing blanks the team number: a partial override would mislead.
  for (const id of ids) if (id !== me && levels[id] == null && activities.some((a) => a.agent_id === id && (a.type === 'policy_issued' || a.type === 'chargeback')) && !waitingOn.includes(people[id].name)) waitingOn.push(people[id].name);
  const mine = levels[me] != null;
  const own = mine ? { paid: sum(exp.items, 'advance'), clawback: sum(back.items, 'advance') } : null;
  if (own) own.net = round(own.paid - own.clawback);
  const teamReady = mine && waitingOn.length === 0;
  const team = teamReady ? { paid: sum(exp.items, 'override'), clawback: sum(back.items, 'override') } : null;
  if (team) team.net = round(team.paid - team.clawback);
  const total = own && team ? own.net + team.net : 0;
  return { ready: !!(own && team), waitingOn, own, team, teamShare: own && team && total > 0 ? team.net / total : null, days };
}
