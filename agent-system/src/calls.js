// The call chain: who → what happened → what's next.
//
// After a call the agent answers one question ("How did it go?") and the
// system writes every row that call earned and sets the person's next date.
// Agents never tap a counter, so dials, conversations, appointments and
// follow-ups can't drift from what really happened.
//
// Stage changes go through moveLead (the same rows the database trigger
// writes); this file adds only the rows a stage change doesn't: the dial,
// a conversation that didn't change the stage, and the follow-up.
//
// Built for final expense first: a sale often happens on the first call, and
// the main risk afterwards is a missed payment draft. So an application can
// be sent from a call, every application passes the kitchen-table check, and
// each approved policy gets two protective calls and a save call if a draft fails.

import { moveLead } from './pipeline.js';

/** What can happen on a call. `minor` outcomes sit below the main choices. */
export const CALL_OUTCOMES = Object.freeze([
  { id: 'no_answer',      label: 'No answer',        hint: 'Try again tomorrow' },
  { id: 'talked',         label: 'Talked',           hint: 'Follow up in 2 days' },
  { id: 'callback',       label: 'Call back later',  hint: 'Pick a day and time' },
  { id: 'booked',         label: 'Booked a meeting', hint: 'Pick a day and time' },
  { id: 'applied',        label: 'Application sent', hint: 'Sold on this call' },
  { id: 'not_interested', label: 'Not interested',   hint: 'Closes them out' },
  { id: 'bad_number',     label: 'Wrong or bad number', hint: 'Removes them', minor: true },
]);

/** What can happen at an appointment. */
export const MEETING_OUTCOMES = Object.freeze([
  { id: 'applied',  label: 'Application sent', hint: 'Enter the yearly premium' },
  { id: 'no_sale',  label: 'Met, no sale yet', hint: 'Follow up in 3 days' },
  { id: 'no_show',  label: 'No-show',          hint: 'Call again tomorrow' },
]);

/**
 * The kitchen-table check: four things that keep a policy from lapsing.
 * Every application passes all four before it's sent.
 */
export const KITCHEN_CHECK = Object.freeze([
  { id: 'affordable',   label: 'They can afford it comfortably every month' },
  { id: 'draft_date',   label: 'Draft date set right after their income lands' },
  { id: 'bank_checked', label: 'Bank details read back and confirmed' },
  { id: 'wants_it',     label: 'They want it, not talked into it' },
]);

/** Calls that protect a policy once it's approved, plus the save call. */
export const CARE_CALLS = Object.freeze({
  welcome:   { label: 'Welcome call', why: 'Approved. Tell them what happens next.', outcomes: ['reached', 'no_answer', 'payment_problem'] },
  pre_draft: { label: 'Before the first payment', why: 'Their first draft is coming. Make sure it still works.', outcomes: ['reached', 'no_answer', 'payment_problem'] },
  save:      { label: 'Payment missed: save it', why: 'Usually a bank or card issue, not a cancel. Call today.', outcomes: ['fixed', 'no_answer', 'canceling'] },
});
export const CARE_OUTCOMES = Object.freeze({
  reached:         { label: 'Reached them', hint: 'All set' },
  no_answer:       { label: 'No answer', hint: 'Try again tomorrow' },
  payment_problem: { label: 'Payment problem', hint: 'Starts a save' },
  fixed:           { label: 'Fixed it', hint: 'Payment back on' },
  canceling:       { label: 'They’re canceling', hint: 'Policy lost' },
});

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 'YYYY-MM-DD' plus n calendar days. */
export function addDays(dayKey, n) {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Days until the next try after `tries` unanswered calls: 1, 1, then 3. */
const retryAfter = (tries) => (tries >= 2 ? 3 : 1);

/** Throws, naming what's missing, unless all four kitchen-table checks are ticked. */
export function checkKitchenTable(checks = {}) {
  const missing = KITCHEN_CHECK.filter((c) => !(checks ?? {})[c.id]);
  if (missing.length) throw new Error(`Before sending the application: ${missing.map((c) => c.label.toLowerCase()).join('; ')}`);
  return Object.fromEntries(KITCHEN_CHECK.map((c) => [c.id, true]));
}

/**
 * Log a call.
 *   lead      the person called, or null for a quick call with no name
 *   outcome   one of CALL_OUTCOMES
 *   agentId, at (ISO time), today ('YYYY-MM-DD' local)
 *   meetingOn, meetingAt ('HH:MM')     for 'booked'
 *   callbackOn, callbackAt ('HH:MM')   for 'callback'
 *   premium, checks                    for 'applied'
 * Returns { lead, rows }: the person after the call (null if none) and the rows to log.
 */
export function logCall(lead, outcome, { agentId, at, today, meetingOn = null, meetingAt = null, callbackOn = null, callbackAt = null, premium = null, checks = null }) {
  if (!CALL_OUTCOMES.some((o) => o.id === outcome)) throw new Error(`Unknown call outcome: ${outcome}`);
  const base = { agent_id: lead?.agent_id ?? agentId, ...(lead ? { lead_id: lead.id } : {}), occurred_at: at };
  const rows = [{ ...base, type: 'dial' }];
  // Calling someone you've already talked with is a follow-up, answered or not.
  if (lead?.stage === 'contacted') rows.push({ ...base, type: 'followup_done' });

  if (outcome === 'no_answer') {
    if (!lead) return { lead: null, rows };
    const tries = (lead.tries ?? 0) + 1;
    const next = { ...lead, tries, nextOn: addDays(today, retryAfter(tries)) };
    delete next.callbackAt;
    return { lead: next, rows };
  }

  if (outcome === 'bad_number') {
    if (!lead) return { lead: null, rows };
    const moved = moveLead(lead, 'lost', { at });
    const next = { ...moved.lead, lostReason: 'bad_number' };
    delete next.nextOn; delete next.callbackAt;
    return { lead: next, rows: [...rows, ...moved.rows] };
  }

  const needsName = { booked: 'Booking needs a name, so the meeting has someone to belong to', applied: 'An application needs the client’s name', callback: 'A call-back needs a name, so it has someone to come back to' }[outcome];
  if (needsName && !lead) throw new Error(needsName);
  if (outcome === 'booked') {
    if (!DAY.test(meetingOn || '')) throw new Error('Pick the day of the meeting');
    if (meetingOn < today) throw new Error('The meeting day can’t be in the past');
    if (meetingAt && !TIME.test(meetingAt)) throw new Error('Pick a time like 14:30');
  }
  if (outcome === 'callback') {
    if (!DAY.test(callbackOn || '')) throw new Error('Pick the day to call back');
    if (callbackOn < today) throw new Error('The call-back day can’t be in the past');
    if (callbackAt && !TIME.test(callbackAt)) throw new Error('Pick a time like 14:30');
  }
  let checked = null;
  if (outcome === 'applied') {
    if (!(premium > 0)) throw new Error('Submitting needs the annual premium');
    checked = checkKitchenTable(checks);
  }

  // Every outcome below means you talked with them.
  const target = { talked: 'contacted', callback: 'contacted', booked: 'appointment', applied: 'application', not_interested: 'lost' }[outcome];
  if (!lead) return { lead: null, rows: [...rows, { ...base, type: 'conversation' }] };

  // Exactly one conversation per call that connected: moving to Talked writes it; otherwise add it.
  const moved = moveLead(lead, target, { at, premium });
  if (!moved.rows.some((r) => r.type === 'conversation')) rows.push({ ...base, type: 'conversation' });
  rows.push(...moved.rows.map((r) => (r.type === 'app_written' ? { ...r, meta: { kitchen_check: checked } } : r.type === 'appt_set' ? { ...r, meta: { meeting_on: meetingOn } } : r)));
  const next = { ...moved.lead, tries: 0 };
  delete next.nextOn; delete next.callbackAt;
  if (outcome === 'talked') next.nextOn = addDays(today, 2);
  if (outcome === 'callback') { next.nextOn = callbackOn; if (callbackAt) next.callbackAt = callbackAt; }
  if (outcome === 'booked') { next.meetingOn = meetingOn; next.nextOn = meetingOn; if (meetingAt) next.meetingAt = meetingAt; }
  return { lead: next, rows };
}

/**
 * Log what happened at a meeting (the lead is at 'appointment').
 *   outcome  one of MEETING_OUTCOMES; 'applied' needs `premium` and the four `checks`
 */
export function logMeeting(lead, outcome, { at, today, premium = null, checks = null }) {
  if (!MEETING_OUTCOMES.some((o) => o.id === outcome)) throw new Error(`Unknown meeting outcome: ${outcome}`);
  if (lead.stage !== 'appointment') throw new Error('Only a booked meeting can be logged');
  const base = { agent_id: lead.agent_id, lead_id: lead.id, occurred_at: at };
  const clear = (l) => { const n = { ...l }; delete n.meetingOn; delete n.meetingAt; return n; };
  if (outcome === 'no_show') {
    const { lead: back } = moveLead(lead, 'contacted', { at }); // no conversation happened, so no row
    return { lead: { ...clear(back), nextOn: addDays(today, 1) }, rows: [] };
  }
  const rows = [{ ...base, type: 'appt_held' }];
  if (outcome === 'no_sale') return { lead: { ...clear(lead), stage: 'contacted', nextOn: addDays(today, 3) }, rows };
  if (!(premium > 0)) throw new Error('Submitting needs the annual premium');
  const checked = checkKitchenTable(checks);
  const moved = moveLead(lead, 'application', { at, premium });
  const next = clear(moved.lead);
  delete next.nextOn;
  return { lead: next, rows: [...rows, ...moved.rows.map((r) => (r.type === 'app_written' ? { ...r, meta: { kitchen_check: checked } } : r))] };
}

/**
 * The insurer approved the policy. Queues a welcome call tomorrow and, when the
 * first draft date is known, a call 3 days before it (or tomorrow, if sooner).
 * The draft date is optional: nothing blocks an agent who doesn't know it.
 */
export function approvePolicy(lead, { at, today, draftOn }) {
  if (lead.stage !== 'application') throw new Error('Only a sent application can be approved');
  if (draftOn && !DAY.test(draftOn)) throw new Error('Enter the first payment draft as a date');
  const moved = moveLead(lead, 'issued', { at });
  const tomorrow = addDays(today, 1);
  const care = { welcome: tomorrow };
  // No draft date known: the welcome call still happens; only the pre-draft call is skipped.
  if (draftOn) { const preDraft = addDays(draftOn, -3); care.pre_draft = preDraft < tomorrow ? tomorrow : preDraft; }
  const next = { ...moved.lead, approvedOn: today, care };
  if (draftOn) next.draftOn = draftOn; else delete next.draftOn;
  return { lead: next, rows: moved.rows };
}

/**
 * A draft failed. Starts a save: the save call is due today, and if the
 * agent knows when the grace period ends, Today counts down to it.
 */
export function markPaymentMissed(lead, { at, today, graceEndsOn = null }) {
  if (lead.stage !== 'issued') throw new Error('Only an approved policy can miss a payment');
  if (graceEndsOn && !DAY.test(graceEndsOn)) throw new Error('Enter the grace period end as a date');
  const moved = moveLead(lead, 'lapse_risk', { at });
  const next = { ...moved.lead, care: { ...(lead.care || {}), save: today } };
  if (graceEndsOn) next.graceEndsOn = graceEndsOn; else delete next.graceEndsOn;
  return { lead: next, rows: moved.rows };
}

/** Days left in the grace period, or null when the agent didn't enter its end. */
export function graceDaysLeft(lead, today) {
  return lead.graceEndsOn ? daysBetween(today, lead.graceEndsOn) : null;
}

/**
 * Log a policy-care call (welcome, pre_draft or save). Each attempt writes
 * one care_call row, kept apart from sales calls so it never inflates them.
 */
export function logCareCall(lead, kind, outcome, { at, today }) {
  const spec = CARE_CALLS[kind];
  if (!spec) throw new Error(`Unknown care call: ${kind}`);
  if (!spec.outcomes.includes(outcome)) throw new Error(`“${outcome}” doesn’t fit a ${spec.label.toLowerCase()}`);
  const rows = [{ agent_id: lead.agent_id, lead_id: lead.id, type: 'care_call', occurred_at: at, meta: { kind, outcome } }];
  const care = { ...(lead.care || {}) };
  if (outcome === 'no_answer') { care[kind] = addDays(today, 1); return { lead: { ...lead, care }, rows }; }
  delete care[kind];
  if (outcome === 'reached') return { lead: { ...lead, care }, rows };
  if (outcome === 'payment_problem') {
    const r = markPaymentMissed({ ...lead, care }, { at, today });
    return { lead: r.lead, rows: [...rows, ...r.rows] };
  }
  if (outcome === 'fixed') {
    const moved = moveLead(lead, 'issued', { at });
    const next = { ...moved.lead, care };
    delete next.graceEndsOn;
    return { lead: next, rows: [...rows, ...moved.rows] };
  }
  // canceling: the policy is lost, and a lost policy after approval is a chargeback.
  const moved = moveLead(lead, 'lost', { at });
  const next = { ...moved.lead, care: {} };
  delete next.graceEndsOn;
  return { lead: next, rows: [...rows, ...moved.rows] };
}

/**
 * Who to call today, in order:
 *   saves      policies with a missed payment (fewest grace days first)
 *   meetings   meetings today (by time)
 *   care       welcome and pre-draft calls due
 *   calls      people due (oldest first; set call-back times in order), then new people
 */
export function queueFor(leads, today) {
  const saves = leads.filter((l) => l.stage === 'lapse_risk' && l.care?.save && l.care.save <= today)
    .sort((a, b) => (graceDaysLeft(a, today) ?? 99) - (graceDaysLeft(b, today) ?? 99));
  const meetings = leads.filter((l) => l.stage === 'appointment' && (l.meetingOn ?? today) <= today)
    .sort((a, b) => (a.meetingAt || '99').localeCompare(b.meetingAt || '99'));
  const care = [];
  for (const l of leads) {
    if (l.stage !== 'issued' || !l.care) continue;
    for (const kind of ['welcome', 'pre_draft']) if (l.care[kind] && l.care[kind] <= today) { care.push({ lead: l, kind }); break; }
  }
  const due = leads.filter((l) => ['new', 'contacted'].includes(l.stage) && l.nextOn && l.nextOn <= today)
    .sort((a, b) => a.nextOn.localeCompare(b.nextOn) || (a.callbackAt || '99').localeCompare(b.callbackAt || '99'));
  const fresh = leads.filter((l) => l.stage === 'new' && !l.nextOn);
  return { saves, meetings, care, calls: [...due, ...fresh] };
}

/** The text an agent sends their upline at the end of the day. */
export function dayText(totals, { name = null, dayKey }) {
  const d = new Date(`${dayKey}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const n = (v, one, many) => `${v} ${v === 1 ? one : many}`;
  return `${name ? `${name} · ` : ''}${d}: ${n(totals.dials, 'call', 'calls')}, ${totals.conversations} talked, ${n(totals.apptsSet, 'meeting', 'meetings')} booked, ${n(totals.apptsHeld, 'meeting', 'meetings')} held, ${n(totals.appsWritten, 'application', 'applications')} sent.`;
}
