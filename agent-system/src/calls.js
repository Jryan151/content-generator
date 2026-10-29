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

import { moveLead } from './pipeline.js';

/** What can happen on a call, in the order a person thinks of them. */
export const CALL_OUTCOMES = Object.freeze([
  { id: 'no_answer',      label: 'No answer',      hint: 'Try again tomorrow' },
  { id: 'talked',         label: 'Talked',         hint: 'Follow up in 2 days' },
  { id: 'booked',         label: 'Booked a meeting', hint: 'Pick the day' },
  { id: 'not_interested', label: 'Not interested', hint: 'Closes them out' },
]);

/** What can happen at an appointment. */
export const MEETING_OUTCOMES = Object.freeze([
  { id: 'applied',  label: 'Application sent', hint: 'Enter the yearly premium' },
  { id: 'no_sale',  label: 'Met, no sale yet', hint: 'Follow up in 3 days' },
  { id: 'no_show',  label: 'No-show',          hint: 'Call again tomorrow' },
]);

/** 'YYYY-MM-DD' plus n calendar days. */
export function addDays(dayKey, n) {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Days until the next try after `tries` unanswered calls: 1, 1, then 3. */
const retryAfter = (tries) => (tries >= 2 ? 3 : 1);

/**
 * Log a call.
 *   lead      the person called, or null for a quick call with no name
 *   outcome   one of CALL_OUTCOMES
 *   agentId, at (ISO time), today ('YYYY-MM-DD' local), meetingOn (for 'booked')
 * Returns { lead, rows }: the person after the call (null if none) and the rows to log.
 */
export function logCall(lead, outcome, { agentId, at, today, meetingOn = null }) {
  if (!CALL_OUTCOMES.some((o) => o.id === outcome)) throw new Error(`Unknown call outcome: ${outcome}`);
  const base = { agent_id: lead?.agent_id ?? agentId, ...(lead ? { lead_id: lead.id } : {}), occurred_at: at };
  const rows = [{ ...base, type: 'dial' }];
  // Calling someone you've already talked with is a follow-up, answered or not.
  if (lead?.stage === 'contacted') rows.push({ ...base, type: 'followup_done' });

  if (outcome === 'no_answer') {
    if (!lead) return { lead: null, rows };
    const tries = (lead.tries ?? 0) + 1;
    return { lead: { ...lead, tries, nextOn: addDays(today, retryAfter(tries)) }, rows };
  }

  if (outcome === 'booked') {
    if (!lead) throw new Error('Booking needs a name, so the meeting has someone to belong to');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingOn || '')) throw new Error('Pick the day of the meeting');
    if (meetingOn < today) throw new Error('The meeting day can’t be in the past');
  }

  // Every outcome below means you talked with them.
  const target = { talked: 'contacted', booked: 'appointment', not_interested: 'lost' }[outcome];
  if (!lead) return { lead: null, rows: [...rows, { ...base, type: 'conversation' }] };

  // Exactly one conversation per call that connected: moving to Talked writes it; otherwise add it.
  const moved = moveLead(lead, target, { at });
  if (!moved.rows.some((r) => r.type === 'conversation')) rows.push({ ...base, type: 'conversation' });
  rows.push(...moved.rows);
  let next = moved.lead;
  next = { ...next, tries: 0 };
  if (outcome === 'talked') next.nextOn = addDays(today, 2);
  if (outcome === 'booked') { next.meetingOn = meetingOn; next.nextOn = meetingOn; }
  if (outcome === 'not_interested') { delete next.nextOn; }
  return { lead: next, rows };
}

/**
 * Log what happened at a meeting (the lead is at 'appointment').
 *   outcome  one of MEETING_OUTCOMES; 'applied' needs `premium`
 */
export function logMeeting(lead, outcome, { at, today, premium = null }) {
  if (!MEETING_OUTCOMES.some((o) => o.id === outcome)) throw new Error(`Unknown meeting outcome: ${outcome}`);
  if (lead.stage !== 'appointment') throw new Error('Only a booked meeting can be logged');
  const base = { agent_id: lead.agent_id, lead_id: lead.id, occurred_at: at };
  if (outcome === 'no_show') {
    const { lead: back } = moveLead(lead, 'contacted', { at }); // no conversation happened, so no row
    const next = { ...back, nextOn: addDays(today, 1) };
    delete next.meetingOn;
    return { lead: next, rows: [] };
  }
  const rows = [{ ...base, type: 'appt_held' }];
  if (outcome === 'no_sale') {
    const next = { ...lead, stage: 'contacted', nextOn: addDays(today, 3) };
    delete next.meetingOn;
    return { lead: next, rows };
  }
  const moved = moveLead(lead, 'application', { at, premium });
  const next = { ...moved.lead };
  delete next.meetingOn; delete next.nextOn;
  return { lead: next, rows: [...rows, ...moved.rows] };
}

/**
 * Who to call today, in order: meetings today first, then people due
 * (oldest due date first), then new people never called.
 */
export function queueFor(leads, today) {
  const meetings = leads.filter((l) => l.stage === 'appointment' && (l.meetingOn ?? today) <= today);
  const due = leads.filter((l) => ['new', 'contacted'].includes(l.stage) && l.nextOn && l.nextOn <= today)
    .sort((a, b) => a.nextOn.localeCompare(b.nextOn));
  const fresh = leads.filter((l) => l.stage === 'new' && !l.nextOn);
  return { meetings, calls: [...due, ...fresh] };
}
