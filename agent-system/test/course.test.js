// Which lesson a recruit sees today (src/course.js): watching is enough to move on, one a day,
// skipping what you know, and "how did it go".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextLesson, lessonRows } from '../src/course.js';

const TZ = 'America/Phoenix';
const L = ['a', 'b', 'c'].map((id) => ({ id }));
const at = (d, t = '10:00') => new Date(`${d}T${t}:00-07:00`).toISOString();
const row = (type, id, d, meta = {}) => ({ agent_id: 'me', type, occurred_at: at(d), meta: { lesson_id: id, ...meta } });
const next = (acts, day = '2026-11-02') => nextLesson(L, acts, { me: 'me', dayKey: day, tz: TZ })?.id ?? null;

test('a recruit still studying moves on by watching: never stuck on lesson 1', () => {
  assert.equal(next([]), 'a');
  assert.equal(next([row('lesson_watched', 'a', '2026-11-02')]), 'a', 'today’s lesson stays on Today after opening it');
  assert.equal(next([row('lesson_watched', 'a', '2026-11-02')], '2026-11-03'), 'b', 'the next day: the next lesson, without a call');
});

test('one a day: trying today’s lesson finishes the day', () => {
  assert.equal(next([row('lesson_tried', 'a', '2026-11-02', { how: 'good' })]), null);
  assert.equal(next([row('lesson_tried', 'a', '2026-11-02')], '2026-11-03'), 'b');
});

test('skipping a lesson you already know shows the next one straight away', () => {
  assert.equal(next([row('lesson_known', 'a', '2026-11-02')]), 'b');
  assert.equal(next([row('lesson_known', 'a', '2026-11-02'), row('lesson_known', 'b', '2026-11-02')]), 'c');
  assert.equal(next(['a', 'b', 'c'].map((id) => row('lesson_known', id, '2026-11-01'))), null, 'course finished');
});

test('someone else’s rows never move my course', () => {
  assert.equal(next([{ ...row('lesson_watched', 'a', '2026-11-01'), agent_id: 'jay' }]), 'a');
  assert.equal(lessonRows([row('lesson_tried', 'a', '2026-11-01', { how: 'not_great' })], 'me', 'lesson_tried').get('a').meta.how, 'not_great');
});
