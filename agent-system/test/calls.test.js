import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logCall, logMeeting, queueFor, addDays } from '../src/calls.js';
import { totalsFor } from '../src/timeframes.js';
import { placeOnLadder, routineFor, isUnlocked } from '../src/career.js';
import { todoFor } from '../src/routines.js';

const today = '2026-11-02';
const at = '2026-11-02T17:00:00.000Z';
const opts = { agentId: 'A', at, today };
const fresh = { id: 'L1', agent_id: 'A', name: 'Sam', stage: 'new', premium: null };
const types = (rows) => rows.map((r) => r.type).sort();
const sum = (rows) => totalsFor(rows, { tf: '1D', key: today, tz: 'UTC' });

test('no answer: one dial, and they come back tomorrow, then in 3 days', () => {
  const a = logCall(fresh, 'no_answer', opts);
  assert.deepEqual(types(a.rows), ['dial']);
  assert.equal(a.lead.nextOn, '2026-11-03');
  const b = logCall(a.lead, 'no_answer', opts);
  assert.equal(b.lead.nextOn, '2026-11-05');
});

test('talked with someone new: a dial and exactly one conversation, follow up in 2 days', () => {
  const r = logCall(fresh, 'talked', opts);
  assert.deepEqual(types(r.rows), ['conversation', 'dial']);
  assert.equal(r.lead.stage, 'contacted');
  assert.equal(r.lead.nextOn, '2026-11-04');
});

test('calling back someone you talked with counts as a follow-up', () => {
  const talked = { ...fresh, stage: 'contacted', nextOn: today };
  assert.deepEqual(types(logCall(talked, 'no_answer', opts).rows), ['dial', 'followup_done']);
  assert.deepEqual(types(logCall(talked, 'talked', opts).rows), ['conversation', 'dial', 'followup_done']);
});

test('booked: dial, conversation and appointment, and the meeting day is set', () => {
  const r = logCall(fresh, 'booked', { ...opts, meetingOn: '2026-11-05' });
  assert.deepEqual(types(r.rows), ['appt_set', 'conversation', 'dial']);
  assert.equal(r.lead.stage, 'appointment');
  assert.equal(r.lead.meetingOn, '2026-11-05');
  const t = sum(r.rows);
  assert.equal(t.dials + t.conversations + t.apptsSet, 3);
});

test('booking needs a name and a day that isn’t past', () => {
  assert.throws(() => logCall(null, 'booked', { ...opts, meetingOn: '2026-11-05' }), /name/);
  assert.throws(() => logCall(fresh, 'booked', opts), /day/);
  assert.throws(() => logCall(fresh, 'booked', { ...opts, meetingOn: '2026-11-01' }), /past/);
});

test('not interested: they talked, then they leave the queue', () => {
  const r = logCall(fresh, 'not_interested', opts);
  assert.deepEqual(types(r.rows), ['conversation', 'dial']);
  assert.equal(r.lead.stage, 'lost');
  assert.equal(queueFor([r.lead], today).calls.length, 0);
});

test('a quick call with no name still counts', () => {
  assert.deepEqual(types(logCall(null, 'no_answer', opts).rows), ['dial']);
  const r = logCall(null, 'talked', opts);
  assert.deepEqual(types(r.rows), ['conversation', 'dial']);
  assert.equal(r.lead, null);
});

test('meetings: applied writes the application, no-show sends them back to call', () => {
  const booked = { ...fresh, stage: 'appointment', meetingOn: today };
  const applied = logMeeting(booked, 'applied', { at, today, premium: 720, checks: allChecks });
  assert.deepEqual(types(applied.rows), ['app_written', 'appt_held']);
  assert.equal(applied.lead.stage, 'application');
  assert.throws(() => logMeeting(booked, 'applied', { at, today, checks: allChecks }), /premium/);
  const noShow = logMeeting(booked, 'no_show', { at, today });
  assert.deepEqual(noShow.rows, []);
  assert.equal(noShow.lead.stage, 'contacted');
  assert.equal(noShow.lead.nextOn, '2026-11-03');
  const noSale = logMeeting(booked, 'no_sale', { at, today });
  assert.deepEqual(types(noSale.rows), ['appt_held']);
  assert.equal(noSale.lead.nextOn, '2026-11-05');
});

test('the queue: meetings first, then people due oldest first, then new people', () => {
  const leads = [
    { id: 'n', stage: 'new' },
    { id: 'late', stage: 'contacted', nextOn: '2026-10-30' },
    { id: 'due', stage: 'contacted', nextOn: today },
    { id: 'later', stage: 'contacted', nextOn: '2026-11-09' },
    { id: 'm', stage: 'appointment', meetingOn: today },
    { id: 'm2', stage: 'appointment', meetingOn: '2026-11-04' },
  ];
  const q = queueFor(leads, today);
  assert.deepEqual(q.meetings.map((l) => l.id), ['m']);
  assert.deepEqual(q.calls.map((l) => l.id), ['late', 'due', 'n']);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('someone not licensed yet starts at Licensing, with a study day and Pipeline locked', () => {
  const me = { id: 'me', name: 'Me', licensed: false };
  const p = placeOnLadder({ person: me, activities: [], dayKey: today, tz: 'UTC' });
  assert.equal(p.stage, 'licensing');
  assert.ok(!isUnlocked('licensing', 'Pipeline'));
  assert.ok(isUnlocked('starting', 'Pipeline'));
  const day = todoFor(today, { ...routineFor('licensing'), activities: [], agentId: 'me', tz: 'UTC' }).map((t) => t.id);
  assert.ok(day.includes('t-study') && day.includes('t-practice'));
});

test('passing the exam moves you to Starting; someone who never said they were unlicensed starts there', () => {
  const me = { id: 'me', name: 'Me', licensed: false };
  const passed = [{ agent_id: 'me', type: 'license_passed', occurred_at: at }];
  assert.equal(placeOnLadder({ person: me, activities: passed, dayKey: today, tz: 'UTC' }).stage, 'starting');
  assert.equal(placeOnLadder({ person: { id: 'x', name: 'X' }, activities: [], dayKey: today, tz: 'UTC' }).stage, 'starting');
});

import { approvePolicy, markPaymentMissed, logCareCall, graceDaysLeft, checkKitchenTable, dayText, KITCHEN_CHECK } from '../src/calls.js';
import { showRate, quality } from '../src/quality.js';
import { moveLead } from '../src/pipeline.js';

const allChecks = Object.fromEntries(KITCHEN_CHECK.map((c) => [c.id, true]));

test('an application can be sent on the first call, after the kitchen-table check', () => {
  assert.throws(() => logCall(fresh, 'applied', { ...opts, premium: 600, checks: { affordable: true } }), /Before sending.*bank details/);
  assert.throws(() => logCall(fresh, 'applied', { ...opts, checks: allChecks }), /premium/);
  const r = logCall(fresh, 'applied', { ...opts, premium: 600, checks: allChecks });
  assert.deepEqual(types(r.rows), ['app_written', 'conversation', 'dial']);
  assert.equal(r.lead.stage, 'application');
  assert.equal(r.rows.find((x) => x.type === 'app_written').meta.kitchen_check.wants_it, true);
});

test('meetings need the check too', () => {
  const booked = { ...fresh, stage: 'appointment', meetingOn: today };
  assert.throws(() => logMeeting(booked, 'applied', { at, today, premium: 700 }), /Before sending/);
  assert.equal(logMeeting(booked, 'applied', { at, today, premium: 700, checks: allChecks }).lead.stage, 'application');
});

test('call back later sets the day and time; bad number removes them', () => {
  const cb = logCall(fresh, 'callback', { ...opts, callbackOn: '2026-11-03', callbackAt: '18:30' });
  assert.equal(cb.lead.nextOn, '2026-11-03');
  assert.equal(cb.lead.callbackAt, '18:30');
  assert.deepEqual(types(cb.rows), ['conversation', 'dial']);
  assert.throws(() => logCall(fresh, 'callback', { ...opts, callbackOn: '2026-11-03', callbackAt: '7pm' }), /time/);
  const bad = logCall(fresh, 'bad_number', opts);
  assert.deepEqual(types(bad.rows), ['dial']);
  assert.equal(bad.lead.stage, 'lost');
  assert.equal(bad.lead.lostReason, 'bad_number');
});

test('booking keeps the meeting time, and meetings sort by time', () => {
  const r = logCall(fresh, 'booked', { ...opts, meetingOn: today, meetingAt: '15:00' });
  assert.equal(r.lead.meetingAt, '15:00');
  const q = queueFor([{ ...r.lead, id: 'late' }, { ...r.lead, id: 'early', meetingAt: '10:00' }], today);
  assert.deepEqual(q.meetings.map((l) => l.id), ['early', 'late']);
});

test('approval queues a welcome call tomorrow and a call 3 days before the first draft', () => {
  const sent = { ...fresh, stage: 'application', premium: 600 };
  assert.throws(() => approvePolicy(sent, { at, today }), /draft/);
  const a = approvePolicy(sent, { at, today, draftOn: '2026-11-20' });
  assert.deepEqual(types(a.rows), ['policy_issued']);
  assert.deepEqual(a.lead.care, { welcome: '2026-11-03', pre_draft: '2026-11-17' });
  const soon = approvePolicy(sent, { at, today, draftOn: '2026-11-03' });
  assert.equal(soon.lead.care.pre_draft, '2026-11-03'); // never before tomorrow
  assert.equal(queueFor([a.lead], '2026-11-03').care[0].kind, 'welcome');
  assert.equal(queueFor([a.lead], today).care.length, 0);
});

test('care calls never count as sales calls', () => {
  const p = approvePolicy({ ...fresh, stage: 'application', premium: 600 }, { at, today, draftOn: '2026-11-20' }).lead;
  const r = logCareCall(p, 'welcome', 'reached', { at, today: '2026-11-03' });
  const t = sum(r.rows);
  assert.equal(t.dials, 0);
  assert.equal(t.careCalls, 1);
  assert.equal(r.lead.care.welcome, undefined);
  assert.equal(logCareCall(p, 'welcome', 'no_answer', { at, today: '2026-11-03' }).lead.care.welcome, '2026-11-04');
  assert.throws(() => logCareCall(p, 'welcome', 'fixed', { at, today }), /doesn’t fit/);
});

test('a missed payment jumps to the top, counts down, and is saved without a second placement', () => {
  const placed = { ...fresh, stage: 'issued', premium: 600, care: {} };
  const missed = markPaymentMissed(placed, { at, today, graceEndsOn: '2026-11-20' }).lead;
  assert.equal(missed.stage, 'lapse_risk');
  assert.equal(graceDaysLeft(missed, today), 18);
  const q = queueFor([missed, { ...fresh, id: 'x' }], today);
  assert.equal(q.saves[0].id, 'L1');
  const fixed = logCareCall(missed, 'save', 'fixed', { at, today });
  assert.equal(fixed.lead.stage, 'issued');
  assert.ok(!fixed.rows.some((r) => r.type === 'policy_issued'));
  const lost = logCareCall(missed, 'save', 'canceling', { at, today });
  assert.ok(lost.rows.some((r) => r.type === 'chargeback'));
  // Moving back from Payment missed in the Pipeline doesn't double-count either.
  assert.deepEqual(moveLead(missed, 'issued', { at }).rows, []);
});

test('a problem found on a welcome call starts a save', () => {
  const p = approvePolicy({ ...fresh, stage: 'application', premium: 600 }, { at, today, draftOn: '2026-11-20' }).lead;
  const r = logCareCall(p, 'welcome', 'payment_problem', { at, today });
  assert.equal(r.lead.stage, 'lapse_risk');
  assert.equal(r.lead.care.save, today);
});

test('show rate: meetings held out of booked, blank until something is booked', () => {
  const rows = [
    { agent_id: 'A', type: 'appt_set', occurred_at: '2026-10-20T17:00:00Z' },
    { agent_id: 'A', type: 'appt_set', occurred_at: '2026-10-21T17:00:00Z' },
    { agent_id: 'A', type: 'appt_held', occurred_at: '2026-10-22T17:00:00Z' },
    { agent_id: 'A', type: 'appt_set', occurred_at: '2026-08-01T17:00:00Z' }, // outside 30 days
  ];
  assert.deepEqual(showRate({ activities: rows, dayKey: today }), { booked: 2, held: 1, rate: 0.5 });
  assert.equal(showRate({ activities: [], dayKey: today }).rate, null);
  // A meeting booked for later isn't a no-show yet.
  const future = logCall(fresh, 'booked', { ...opts, meetingOn: '2026-11-05' }).rows;
  assert.equal(showRate({ activities: future, dayKey: today }).booked, 0);
  assert.equal(showRate({ activities: future, dayKey: '2026-11-06' }).booked, 1);
});

test('the day text for the upline reads like a person wrote it', () => {
  const t = { dials: 64, conversations: 6, apptsSet: 1, apptsHeld: 0, appsWritten: 0 };
  assert.equal(dayText(t, { name: 'Jason', dayKey: '2026-11-02' }), 'Jason · Mon, Nov 2: 64 calls, 6 talked, 1 meeting booked, 0 meetings held, 0 applications sent.');
  void checkKitchenTable; void quality;
});
