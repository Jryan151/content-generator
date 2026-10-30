// Today, as one short chain. Five slots at most above "More", in a fixed order,
// like an effects chain: each does one job, and nothing does a job twice.
//
//   notice   something about the app itself she must see (after midnight, backup)
//   now      what can't wait: a missed payment, a meeting today
//   next     the next call (a welcome or pre-draft call counts as a call)
//   team     one team thing; while her own calls are down, that instead (production first)
//   day      her day so far: calls, and when it ends
//   done     done for today: the last slot, the ceiling
//
// `next` and `done` never show together, so at most five slots ever render.
// Everything else (a quick call, adding people, texting her day, a day off,
// her schedule) lives behind "More".

/** The most slots Today may show above "More". The simplicity tests hold the app to it. */
export const TODAY_MAX_SLOTS = 5;

/** What lives behind "More", in this order. */
export const MORE = Object.freeze(['quickCall', 'addPeople', 'sendDay', 'dayOff', 'schedule']);

/**
 * Is her day done? One rule, used by Today and anything that asks.
 *   goal      her full day in calls: real targets once they exist, else the number she set. Null = none.
 *   dials     calls logged today
 *   now       'HH:MM' local; stopAt 'HH:MM' when her workday ends (optional)
 *   workday   false on a weekend (an end time doesn't fire then)
 *   keepGoing she tapped "Keep working anyway" today
 *   late      she's logging yesterday after midnight (never "done" mid-catch-up)
 * Returns { done, by: 'calls'|'time'|null }.
 */
export function dayStatus({ goal = null, dials = 0, now = '00:00', stopAt = null, workday = true, keepGoing = false, late = false } = {}) {
  const byCalls = !!goal && dials >= goal;
  const byTime = !!stopAt && workday && now >= stopAt;
  const done = (byCalls || byTime) && !keepGoing && !late;
  return { done, by: done ? (byCalls ? 'calls' : 'time') : null };
}

/**
 * Which slots Today shows, in order. Pass what exists right now.
 *   notice, now, team: booleans (is there one?)
 *   done: dayStatus().done
 * Returns { slots: [ids], more: MORE }.
 */
export function todayLayout({ notice = false, now = false, team = false, done = false } = {}) {
  const slots = [];
  if (notice) slots.push('notice');
  if (now) slots.push('now');
  if (!done) slots.push('next');
  if (team) slots.push('team');
  slots.push('day');
  if (done) slots.push('done');
  return { slots, more: MORE };
}
