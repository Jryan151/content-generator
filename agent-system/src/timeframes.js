// Timeframes: micro inside macro.
//
// 1D (daily) sits inside 1W, inside 1M, inside 1Q, inside 1Y — like reading a
// chart. Every bucket is keyed by the agent's LOCAL calendar (a 9 PM call in
// Phoenix belongs to that day, not to the next UTC day).
//
// All internal math happens on "calendar dates": a Date at UTC midnight that
// stands for a local day. Real timestamps are converted once, on the way in.

import { emptyTotals, addActivity, METRICS } from './metrics.js';

export const TIMEFRAMES = Object.freeze(['1D', '1W', '1M', '1Q', '1Y']);
const CHILD = Object.freeze({ '1Y': '1Q', '1Q': '1M', '1M': '1W', '1W': '1D', '1D': null });
const DAY_MS = 86_400_000;

export const DEFAULT_TZ = 'America/Phoenix';

function assertTf(tf) {
  if (!TIMEFRAMES.includes(tf)) throw new Error(`Unknown timeframe: ${tf}`);
}

const pad = (n) => String(n).padStart(2, '0');
const isoDay = (cal) => `${cal.getUTCFullYear()}-${pad(cal.getUTCMonth() + 1)}-${pad(cal.getUTCDate())}`;
const cal = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

// Building a formatter is the slow part, so keep one per time zone.
const FORMATTERS = new Map();
function formatterFor(tz) {
  let f = FORMATTERS.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }); FORMATTERS.set(tz, f); }
  return f;
}

/** A real timestamp → the local calendar date it falls on in `tz`. */
export function toCalendarDate(when, tz = DEFAULT_TZ) {
  const date = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(date.getTime())) throw new Error(`Bad timestamp: ${when}`);
  const parts = formatterFor(tz).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return cal(get('year'), get('month'), get('day'));
}

/** Monday of the week that contains this calendar date. */
function weekStart(c) {
  const dow = (c.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(c.getTime() - dow * DAY_MS);
}

/** Bucket key for a calendar date. 1D '2026-10-28' · 1W 'W:2026-10-26' (its Monday) · 1M '2026-10' · 1Q '2026-Q4' · 1Y '2026'. */
export function keyForCalendarDate(c, tf) {
  assertTf(tf);
  const y = c.getUTCFullYear();
  const m = c.getUTCMonth() + 1;
  switch (tf) {
    case '1D': return isoDay(c);
    case '1W': return `W:${isoDay(weekStart(c))}`;
    case '1M': return `${y}-${pad(m)}`;
    case '1Q': return `${y}-Q${Math.ceil(m / 3)}`;
    case '1Y': return `${y}`;
  }
}

/** Bucket key for a real timestamp, in the agent's time zone. */
export function bucketKey(when, tf, tz = DEFAULT_TZ) {
  return keyForCalendarDate(toCalendarDate(when, tz), tf);
}

/** The calendar range a key covers: start inclusive, end exclusive. */
export function rangeOf(key, tf) {
  assertTf(tf);
  let m;
  switch (tf) {
    case '1D': {
      m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
      if (!m) break;
      const s = cal(+m[1], +m[2], +m[3]);
      return { start: s, end: new Date(s.getTime() + DAY_MS) };
    }
    case '1W': {
      m = /^W:(\d{4})-(\d{2})-(\d{2})$/.exec(key);
      if (!m) break;
      const s = cal(+m[1], +m[2], +m[3]);
      return { start: s, end: new Date(s.getTime() + 7 * DAY_MS) };
    }
    case '1M': {
      m = /^(\d{4})-(\d{2})$/.exec(key);
      if (!m) break;
      return { start: cal(+m[1], +m[2], 1), end: cal(+m[1], +m[2] + 1, 1) };
    }
    case '1Q': {
      m = /^(\d{4})-Q([1-4])$/.exec(key);
      if (!m) break;
      const first = (+m[2] - 1) * 3 + 1;
      return { start: cal(+m[1], first, 1), end: cal(+m[1], first + 3, 1) };
    }
    case '1Y': {
      m = /^(\d{4})$/.exec(key);
      if (!m) break;
      return { start: cal(+m[1], 1, 1), end: cal(+m[1] + 1, 1, 1) };
    }
  }
  throw new Error(`Bad ${tf} key: ${key}`);
}

/** The key just before this one (last week, last month…). */
export function previousKey(key, tf) {
  const { start } = rangeOf(key, tf);
  return keyForCalendarDate(new Date(start.getTime() - DAY_MS), tf);
}

/** Child buckets inside a parent bucket, in order (a month → its weeks). */
export function childKeys(key, tf) {
  const child = CHILD[tf];
  if (!child) return [];
  const { start, end } = rangeOf(key, tf);
  const keys = [];
  for (let t = start.getTime(); t < end.getTime(); t += DAY_MS) {
    const k = keyForCalendarDate(new Date(t), child);
    if (keys.at(-1) !== k) keys.push(k);
  }
  return keys;
}

export const childTimeframe = (tf) => CHILD[tf];

/** How many days of bucket (key, tf) fall inside the outer bucket. */
function daysInside(key, tf, outer) {
  const a = rangeOf(key, tf);
  const b = rangeOf(outer.key, outer.tf);
  const s = Math.max(a.start.getTime(), b.start.getTime());
  const e = Math.min(a.end.getTime(), b.end.getTime());
  return Math.max(1, Math.round((e - s) / DAY_MS));
}

/** True when the activity's local day falls inside this bucket. A week that
 *  spills over a month edge only counts the days inside the month. */
function inBucket(activity, key, tf, tz) {
  const c = toCalendarDate(activity.occurred_at, tz).getTime();
  const { start, end } = rangeOf(key, tf);
  return c >= start.getTime() && c < end.getTime();
}

/** Totals for one bucket. Options: agentIds (only these agents), within
 *  (an outer bucket {key, tf} to clip to — used when a week straddles a month). */
export function totalsFor(activities, { tf, key, tz = DEFAULT_TZ, agentIds = null, within = null }) {
  const totals = emptyTotals();
  // No time zone is more than 14 hours from UTC, so a row more than 15 hours
  // outside the bucket can't be in it: skip it before the slower local-date check.
  const { start, end } = rangeOf(key, tf);
  const lo = start.getTime() - 15 * 3_600_000, hi = end.getTime() + 15 * 3_600_000;
  for (const a of activities) {
    if (agentIds && !agentIds.includes(a.agent_id)) continue;
    const t = Date.parse(a.occurred_at);
    if (t < lo || t >= hi) continue;
    if (!inBucket(a, key, tf, tz)) continue;
    if (within && !inBucket(a, within.key, within.tf, tz)) continue;
    addActivity(totals, a);
  }
  return totals;
}

/** Totals for every bucket that has activity, in time order. */
export function rollup(activities, { tf, tz = DEFAULT_TZ, agentIds = null }) {
  assertTf(tf);
  const byKey = new Map();
  for (const a of activities) {
    if (agentIds && !agentIds.includes(a.agent_id)) continue;
    const k = bucketKey(a.occurred_at, tf, tz);
    if (!byKey.has(k)) byKey.set(k, emptyTotals());
    addActivity(byKey.get(k), a);
  }
  return [...byKey.entries()]
    .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
    .map(([key, totals]) => ({ key, totals }));
}

/** This period vs the one before, for every metric. */
export function compareToPrevious(activities, { tf, key, tz = DEFAULT_TZ, agentIds = null }) {
  const prevKey = previousKey(key, tf);
  const current = totalsFor(activities, { tf, key, tz, agentIds });
  const previous = totalsFor(activities, { tf, key: prevKey, tz, agentIds });
  const change = {};
  for (const k of Object.keys(METRICS)) change[k] = current[k] - previous[k];
  return { key, previousKey: prevKey, current, previous, change };
}

/**
 * The zoom-in loop: "fix the agent, not the month".
 *
 * 1. Is `metric` down in this period vs the last one? If not, stop.
 * 2. Drop one timeframe at a time (month → week) to the weakest child bucket.
 * 3. In that bucket, find the agent whose daily INPUT (dials by default)
 *    fell furthest below their own average for the other child buckets.
 *
 * Returns { down, trail: [...steps], agent } — `agent` is null when nobody
 * clearly dropped (the whole team slowed down evenly).
 */
export function whereItBroke(activities, {
  tf, key, tz = DEFAULT_TZ, metric = 'premiumWritten', input = 'dials',
  stopAt = '1W', agentIds = null,
}) {
  if (!METRICS[metric]) throw new Error(`Unknown metric: ${metric}`);
  if (!METRICS[input]) throw new Error(`Unknown input metric: ${input}`);
  const top = compareToPrevious(activities, { tf, key, tz, agentIds });
  const trail = [{
    tf, key, metric, current: top.current[metric], previous: top.previous[metric],
    note: `${METRICS[metric].label} ${top.current[metric]} vs ${top.previous[metric]} the period before`,
  }];
  if (top.current[metric] >= top.previous[metric]) return { down: false, trail, agent: null };

  // Walk down to the weakest child bucket.
  let curTf = tf, curKey = key;
  let siblings = [];
  const outer = { key, tf };
  while (CHILD[curTf] && TIMEFRAMES.indexOf(curTf) > TIMEFRAMES.indexOf(stopAt)) {
    const childTf = CHILD[curTf];
    const keys = childKeys(curKey, curTf);
    // Compare per day, so a 3-day partial week at a month edge isn't
    // "weakest" just because it is short.
    const values = keys.map((k) => {
      const value = totalsFor(activities, { tf: childTf, key: k, tz, agentIds, within: outer })[metric];
      const days = daysInside(k, childTf, outer);
      return { key: k, value, days, perDay: value / days };
    });
    const weakest = values.reduce((lo, v) => (v.perDay < lo.perDay ? v : lo));
    trail.push({
      tf: childTf, key: weakest.key, metric, current: weakest.value,
      note: `Weakest ${childTf} inside ${curKey}: ${METRICS[metric].label} ${weakest.value} over ${weakest.days} day(s)`,
    });
    siblings = keys;
    curTf = childTf;
    curKey = weakest.key;
  }

  // Who dropped? Compare each agent's input in the weak bucket with their
  // own average across the sibling buckets.
  const ids = agentIds || [...new Set(activities.map((a) => a.agent_id))];
  const others = siblings.filter((k) => k !== curKey);
  let worst = null;
  const perDay = (id, k) =>
    totalsFor(activities, { tf: curTf, key: k, tz, agentIds: [id], within: outer })[input] / daysInside(k, curTf, outer);
  const round1 = (n) => Math.round(n * 10) / 10;
  for (const id of ids) {
    if (!others.length) continue;
    const inWeak = perDay(id, curKey);
    const usual = others.map((k) => perDay(id, k)).reduce((s, v) => s + v, 0) / others.length;
    const drop = usual - inWeak;
    if (drop > 0 && (!worst || drop > worst.drop)) {
      worst = { agent_id: id, input, perDayInWeakBucket: round1(inWeak), usualPerDay: round1(usual), drop: round1(drop) };
    }
  }
  if (worst) {
    trail.push({
      tf: curTf, key: curKey, metric: input, agent_id: worst.agent_id, current: worst.perDayInWeakBucket,
      note: `${worst.agent_id}: ${METRICS[input].label} ${worst.perDayInWeakBucket}/day vs usual ${worst.usualPerDay}/day`,
    });
  }
  return { down: true, trail, agent: worst };
}

/** Today's progress toward daily targets, for one agent. */
export function dailyProgress(activities, { agentId, day, tz = DEFAULT_TZ, targets }) {
  const totals = totalsFor(activities, { tf: '1D', key: day, tz, agentIds: [agentId] });
  return Object.entries(targets).map(([metric, goal]) => ({
    metric, label: METRICS[metric].label, done: totals[metric], goal,
    pct: Math.min(100, Math.round((totals[metric] / goal) * 100)),
  }));
}
