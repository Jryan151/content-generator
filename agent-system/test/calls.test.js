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
  const applied = logMeeting(booked, 'applied', { at, today, premium: 720 });
  assert.deepEqual(types(applied.rows), ['app_written', 'appt_held']);
  assert.equal(applied.lead.stage, 'application');
  assert.throws(() => logMeeting(booked, 'applied', { at, today }), /premium/);
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
