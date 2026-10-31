// src/course.js — which team lesson a recruit sees today (the server's lib/lessons.js makes the lessons).
//
// One a day. The lesson opened today stays on Today until it's tried; otherwise it's the next one not
// yet watched, tried or skipped. Watching is enough to move on, so a recruit still studying for the
// license is never stuck waiting on a call they can't make yet. A recruit who already knows a lesson
// can skip it, and the next one shows straight away.
//
// Log rows (in the person's own activity log):
//   lesson_watched  opened the lesson                       meta.lesson_id
//   lesson_tried    used it on a call, and how it went       meta.lesson_id, meta.how: good | okay | not_great
//   lesson_known    skipped: already knows it                meta.lesson_id
import { bucketKey } from './timeframes.js';

/** The latest row of one kind per lesson, for one person: Map(lessonId → row). */
export function lessonRows(activities, me, type) {
  return new Map(activities.filter((a) => a.agent_id === me && a.type === type && a.meta?.lesson_id).map((a) => [a.meta.lesson_id, a]));
}

/** Today's lesson for this person, or null (done for today, or the course is finished). `lessons` in course order. */
export function nextLesson(lessons, activities, { me, dayKey, tz }) {
  const tried = lessonRows(activities, me, 'lesson_tried'), watched = lessonRows(activities, me, 'lesson_watched'), known = lessonRows(activities, me, 'lesson_known');
  const isToday = (a) => !!a && bucketKey(a.occurred_at, '1D', tz) === dayKey;
  if (lessons.some((l) => isToday(tried.get(l.id)) && !known.has(l.id))) return null;
  const today = lessons.find((l) => isToday(watched.get(l.id)) && !known.has(l.id) && !tried.has(l.id));
  if (today) return today;
  return lessons.find((l) => !tried.has(l.id) && !watched.has(l.id) && !known.has(l.id)) || null;
}
