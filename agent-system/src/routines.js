// Timeframes as WHAT TO DO, not what to watch.
//
// Like trading: the higher timeframe sets the plan, the lower timeframe is
// where you act. Two directions:
//   Plan flows DOWN  — a yearly goal becomes monthly premium, weekly
//                      appointments, daily dials, and the blocks of a day.
//   Results flow UP  — every finished action leaves an activity row, and the
//                      roll-ups (timeframes.js) check whether the plan held.
//
// This file owns the downward half: the plan cascade and the routine for
// each timeframe. Every number and time here is a STARTER default, meant to
// be replaced by the builder's real ones.

import { METRICS } from './metrics.js';
import { totalsFor, rangeOf } from './timeframes.js';

/** Starter conversion rates. ratesFrom() replaces these with real history. */
export const STARTER_RATES = Object.freeze({
  avgPremium: 600,   // USD annual premium per application
  closeRate: 0.5,    // appointments set → applications
  bookingRate: 0.25, // conversations → appointments set
  contactRate: 0.25, // dials → conversations
});

export const WORKDAYS_PER_MONTH = 21;
const WEEKS_PER_MONTH = 52 / 12;

/**
 * Plan flows down: break a yearly premium goal into what to do each
 * month, week and day. Rounds UP at every step — a plan you can't hit
 * because of rounding isn't a plan.
 */
export function planDown({ yearlyPremium, rates = STARTER_RATES, workdaysPerMonth = WORKDAYS_PER_MONTH }) {
  if (!(yearlyPremium > 0)) throw new Error('yearlyPremium must be a positive number');
  for (const k of ['avgPremium', 'closeRate', 'bookingRate', 'contactRate']) {
    if (!(rates[k] > 0)) throw new Error(`rate ${k} must be positive`);
  }
  const monthlyPremium = yearlyPremium / 12;
  const apps = Math.ceil(monthlyPremium / rates.avgPremium);
  const appts = Math.ceil(apps / rates.closeRate);
  const conversations = Math.ceil(appts / rates.bookingRate);
  const dials = Math.ceil(conversations / rates.contactRate);
  return {
    yearly: { premium: yearlyPremium },
    monthly: { premium: Math.ceil(monthlyPremium), apps, appts, conversations, dials },
    weekly: { apps: Math.ceil(apps / WEEKS_PER_MONTH), appts: Math.ceil(appts / WEEKS_PER_MONTH) },
    daily: {
      dials: Math.ceil(dials / workdaysPerMonth),
      conversations: Math.ceil(conversations / workdaysPerMonth),
      followups: 4, // starter: clear every follow-up due
      posts: 1,
      namesConversations: 1, // Producer: one names-list conversation a day
      recruitSteps: 1,       // Coach: one recruiting step a day
    },
    rates,
  };
}

/**
 * Real conversion rates from an agent's (or team's) history, so the plan
 * uses their numbers instead of starters. Falls back to the starter rate
 * for any step with too little data to trust.
 */
export function ratesFrom(activities, { agentIds = null, minEach = 10 } = {}) {
  const t = { dials: 0, conversations: 0, apptsSet: 0, appsWritten: 0, premiumWritten: 0 };
  for (const a of activities) {
    if (agentIds && !agentIds.includes(a.agent_id)) continue;
    for (const key of Object.keys(t)) {
      const m = METRICS[key];
      if (m.type === a.type) t[key] += m.kind === 'sum' ? Number(a.value || 0) : 1;
    }
  }
  const pick = (num, den, starter) => (den >= minEach && num > 0 ? num / den : starter);
  const r3 = (n) => Math.round(n * 1000) / 1000;
  return {
    avgPremium: Math.round(pick(t.premiumWritten, t.appsWritten, STARTER_RATES.avgPremium)),
    closeRate: r3(pick(t.appsWritten, t.apptsSet, STARTER_RATES.closeRate)),
    bookingRate: r3(pick(t.apptsSet, t.conversations, STARTER_RATES.bookingRate)),
    contactRate: r3(pick(t.conversations, t.dials, STARTER_RATES.contactRate)),
    basedOn: t,
  };
}

/**
 * The routines. `tf` is the timeframe the action belongs to; `block` is the
 * intraday level (15 minutes to 2 hours). `when` says which days it is due:
 *   { daily: true }                — every workday
 *   { weekday: 1 }                 — Monday (5 = Friday)
 *   { firstWorkdayOf: '1M' | '1Q' | '1Y' }
 * `{n.xxx}` in a title is filled from the plan (planDown().daily/weekly/monthly).
 */
export const ROUTINES = Object.freeze([
  // ── Agent: blocks of the day (micro) ──
  { id: 'a-dials',     role: 'agent', tf: 'block', at: '09:00', minutes: 120, part: 'Today',    when: { daily: true }, title: 'Dial block: {daily.dials} dials from the call list', doneWhen: 'dials' },
  { id: 'a-followups', role: 'agent', tf: 'block', at: '13:00', minutes: 30,  part: 'Pipeline', when: { daily: true }, title: 'Clear follow-ups due and send appointment reminders', doneWhen: 'followups' },
  { id: 'a-appts',     role: 'agent', tf: 'block', at: '14:00', minutes: 120, part: 'Playbook', when: { daily: true }, title: 'Run appointments with the Playbook open' },
  { id: 'a-close',     role: 'agent', tf: 'block', at: '16:45', minutes: 15,  part: 'Pipeline', when: { daily: true }, title: 'Log everything; give every lead a next step for tomorrow' },
  // ── Optional: content, only when the leader turns it on (todoFor content: true) ──
  { id: 'a-post',      role: 'agent', tf: 'block', at: '11:20', minutes: 15,  part: 'Content',  when: { daily: true }, content: true, title: 'Optional: post today’s content', doneWhen: 'posts' },
  // ── Starting stage only (no first sale yet): a daily training block ──
  { id: 'a-training',  role: 'agent', tf: 'block', at: '11:15', minutes: 30, part: 'Training', when: { daily: true }, startingOnly: true, title: 'Training: today’s step from your 30-day plan' },
  // ── Agent: bigger timeframes ──
  { id: 'a-week-plan',   role: 'agent', tf: '1W', at: '07:45', minutes: 15, part: 'Pipeline', when: { weekday: 1 }, title: 'Plan the week: {weekly.appts} appointments to book; refill leads if the list is short' },
  { id: 'a-week-review', role: 'agent', tf: '1W', at: '16:00', minutes: 15, part: 'Playbook', when: { weekday: 5 }, title: 'Review with your leader: one lost deal, one objection to practice' },
  { id: 'a-month',       role: 'agent', tf: '1M', at: '07:30', minutes: 30, part: 'Pipeline', when: { firstWorkdayOf: '1M' }, title: 'Check your conversion (dials → appointments → apps), pick one skill, call every lapse-risk client' },
  { id: 'a-quarter',     role: 'agent', tf: '1Q', at: '07:15', minutes: 30, part: 'Training', when: { firstWorkdayOf: '1Q' }, title: '90-day check with your leader: on pace for the next contract level?' },
  { id: 'a-year',        role: 'agent', tf: '1Y', at: '07:00', minutes: 60, part: 'Team',     when: { firstWorkdayOf: '1Y' }, title: 'Set your yearly income goal; it becomes your daily numbers' },

  // ── Leaders: one routine per path (see paths.js). Black and white: a time,
  //    a length, one action, and a number or a rule that says when it's done.
  // Path 1 · Producer — "I sell, and I get ready to build." Production first;
  // one names-list conversation a day, hidden while their dials are red.
  { id: 'p-year',      role: 'builder', path: 'producer', tf: '1Y', at: '07:00', minutes: 60,  part: 'Team',     when: { firstWorkdayOf: '1Y' }, title: 'Set what you want to earn this year. The system turns it into your daily numbers' },
  { id: 'p-quarter',   role: 'builder', path: 'producer', tf: '1Q', at: '07:15', minutes: 30,  part: 'Team',     when: { firstWorkdayOf: '1Q' }, title: 'Ladder check: steady weeks and your Playbook. Both done means Coach' },
  { id: 'p-month',     role: 'builder', path: 'producer', tf: '1M', at: '07:30', minutes: 45,  part: 'Pipeline', when: { firstWorkdayOf: '1M' }, title: 'Check conversion, reorder leads, call every lapse-risk client' },
  { id: 'p-week',      role: 'builder', path: 'producer', tf: '1W', at: '07:45', minutes: 15,  part: 'Pipeline', when: { weekday: 1 }, title: 'Plan the week: book {weekly.appts} appointments; order leads if under 2 days of calls are left' },
  { id: 'p-dials',     role: 'builder', path: 'producer', tf: 'block', at: '09:00', minutes: 120, part: 'Today',    when: { daily: true }, title: 'Dial block: {daily.dials} dials', doneWhen: 'dials' },
  { id: 'p-names',     role: 'builder', path: 'producer', tf: 'block', at: '11:00', minutes: 20,  part: 'Recruiting', when: { daily: true }, recruiting: true, title: 'Names list: one conversation with someone on your list', doneWhen: 'namesConversations' },
  { id: 'p-post',      role: 'builder', path: 'producer', tf: 'block', at: '11:20', minutes: 15,  part: 'Content',  when: { daily: true }, content: true, title: 'Optional: post today’s content', doneWhen: 'posts' },
  { id: 'p-followups', role: 'builder', path: 'producer', tf: 'block', at: '13:00', minutes: 30,  part: 'Pipeline', when: { daily: true }, title: 'Clear every follow-up due; text tomorrow’s appointments', doneWhen: 'followups' },
  { id: 'p-appts',     role: 'builder', path: 'producer', tf: 'block', at: '14:00', minutes: 150, part: 'Playbook', when: { daily: true }, title: 'Run appointments' },
  { id: 'p-friday',    role: 'builder', path: 'producer', tf: '1W', at: '15:30', minutes: 30,  part: 'Playbook', when: { weekday: 5 }, title: 'Review one lost call; add the fix to your Playbook' },
  { id: 'p-close',     role: 'builder', path: 'producer', tf: 'block', at: '16:45', minutes: 15,  part: 'Pipeline', when: { daily: true }, title: 'Close out: log everything; every lead gets a next date' },

  // Path 2 · Coach — "I sell and I train." Mornings are yours plus one recruiting
  // step (hidden while your dials are red); afternoons are the team's.
  { id: 'c-year',      role: 'builder', path: 'coach', tf: '1Y', at: '07:00', minutes: 120, part: 'Team',     when: { firstWorkdayOf: '1Y' }, title: 'Set what you want to earn from your own sales this year; it becomes your daily numbers. Each agent sets their own the same way' },
  { id: 'c-quarter',   role: 'builder', path: 'coach', tf: '1Q', at: '07:15', minutes: 90,  part: 'Training', when: { firstWorkdayOf: '1Q' }, title: 'For each agent, apply the rule: promote, coach plan, or let go' },
  { id: 'c-month',     role: 'builder', path: 'coach', tf: '1M', at: '07:30', minutes: 60,  part: 'Playbook', when: { firstWorkdayOf: '1M' }, title: 'Set every agent’s monthly target; add one winning line to the Playbook; book 2 recruiting interviews' },
  { id: 'c-huddle',    role: 'builder', path: 'coach', tf: '1W', at: '08:15', minutes: 30,  part: 'Team',     when: { weekday: 1 }, title: 'Huddle: each agent says their appointment number for the week; role-play one objection' },
  { id: 'c-dials',     role: 'builder', path: 'coach', tf: 'block', at: '09:00', minutes: 90,  part: 'Today',    when: { daily: true }, title: 'Your dial block: {daily.dials} dials', doneWhen: 'dials' },
  { id: 'c-recruit',   role: 'builder', path: 'coach', tf: 'block', at: '10:30', minutes: 20,  part: 'Recruiting', when: { daily: true }, recruiting: true, title: 'Recruiting: one next step in the recruiting pipeline', doneWhen: 'recruitSteps' },
  { id: 'c-post',      role: 'builder', path: 'coach', tf: 'block', at: '10:50', minutes: 15,  part: 'Content',  when: { daily: true }, content: true, title: 'Optional: post today’s content', doneWhen: 'posts' },
  { id: 'c-noon',      role: 'builder', path: 'coach', tf: 'block', at: '12:00', minutes: 10,  part: 'Team',     when: { daily: true }, title: 'Noon check: send the noon message to every agent at 0 dials' },
  { id: 'c-followups', role: 'builder', path: 'coach', tf: 'block', at: '13:00', minutes: 30,  part: 'Pipeline', when: { daily: true }, title: 'Your follow-ups due', doneWhen: 'followups' },
  { id: 'c-coach',     role: 'builder', path: 'coach', tf: 'block', at: '15:00', minutes: 45,  part: 'Team',     when: { daily: true }, title: 'Coach block: work the red list, one agent at a time' },
  { id: 'c-1on1',      role: 'builder', path: 'coach', tf: '1W', at: '15:45', minutes: 60,  part: 'Team',     when: { weekday: 5 }, title: '1:1s with every agent under 70% of their weekly appointment target' },
  { id: 'c-close',     role: 'builder', path: 'coach', tf: 'block', at: '16:45', minutes: 15,  part: 'Team',     when: { daily: true }, title: 'Close out: log yours; check every agent logged today' },

  // Path 3 · Director (PARKED) — "My team sells." You run coaches, not calls.
  // Not offered at setup while the focus is producer to builder; kept so it
  // can come back without a rebuild.
  { id: 'd-year',      role: 'builder', path: 'director', tf: '1Y', at: '07:00', minutes: 120, part: 'Team',     when: { firstWorkdayOf: '1Y' }, title: 'Set the organization’s goal; cascade it to each coach’s team' },
  { id: 'd-quarter',   role: 'builder', path: 'director', tf: '1Q', at: '07:15', minutes: 120, part: 'Training', when: { firstWorkdayOf: '1Q' }, title: 'Contract-level reviews; pick the next agent to become a coach' },
  { id: 'd-month',     role: 'builder', path: 'director', tf: '1M', at: '07:30', minutes: 90,  part: 'Team',     when: { firstWorkdayOf: '1M' }, title: 'Set each coach’s team target and recruiting target; approve Playbook changes' },
  { id: 'd-huddle',    role: 'builder', path: 'director', tf: '1W', at: '08:00', minutes: 30,  part: 'Team',     when: { weekday: 1 }, title: 'Leaders’ huddle: each coach reports their team’s number for the week' },
  { id: 'd-scan',      role: 'builder', path: 'director', tf: 'block', at: '08:30', minutes: 15,  part: 'Team',     when: { daily: true }, title: 'Morning scan: open the red list only; every red agent goes to their coach' },
  { id: 'd-recruit',   role: 'builder', path: 'director', tf: 'block', at: '09:00', minutes: 120, part: 'Training', when: { daily: true }, title: 'Recruiting block: interviews and new-agent onboarding' },
  { id: 'd-noon',      role: 'builder', path: 'director', tf: 'block', at: '12:00', minutes: 10,  part: 'Team',     when: { daily: true }, title: 'Noon: confirm every coach sent their noon messages' },
  { id: 'd-develop',   role: 'builder', path: 'director', tf: 'block', at: '14:00', minutes: 60,  part: 'Team',     when: { daily: true }, title: 'Develop one coach: one call, one thing to fix' },
  { id: 'd-friday',    role: 'builder', path: 'director', tf: '1W', at: '15:00', minutes: 45,  part: 'Team',     when: { weekday: 5 }, title: 'Review each coach’s red list; no agent stays red two weeks' },
  { id: 'd-close',     role: 'builder', path: 'director', tf: 'block', at: '16:30', minutes: 15,  part: 'Training', when: { daily: true }, title: 'Close out: confirm tomorrow’s interviews' },
]);

const TF_ORDER = { '1Y': 0, '1Q': 1, '1M': 2, '1W': 3, block: 4 };
const isWorkday = (c) => c.getUTCDay() !== 0 && c.getUTCDay() !== 6;
const asCal = (dayKey) => rangeOf(dayKey, '1D').start;

function firstWorkday(start) {
  let c = start;
  while (!isWorkday(c)) c = new Date(c.getTime() + 86_400_000);
  return c;
}

function isDue(when, c) {
  if (!isWorkday(c)) return false;
  if (when.daily) return true;
  if (when.weekday) return c.getUTCDay() === when.weekday;
  if (when.firstWorkdayOf) {
    const key = { '1M': `${c.getUTCFullYear()}-${String(c.getUTCMonth() + 1).padStart(2, '0')}`,
                  '1Q': `${c.getUTCFullYear()}-Q${Math.ceil((c.getUTCMonth() + 1) / 3)}`,
                  '1Y': `${c.getUTCFullYear()}` }[when.firstWorkdayOf];
    return firstWorkday(rangeOf(key, when.firstWorkdayOf).start).getTime() === c.getTime();
  }
  return false;
}

const RED_BELOW = 0.7;
const addMinutes = (hhmm, m) => {
  const [h, mm] = hhmm.split(':').map(Number);
  const t = h * 60 + mm + m;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * Production comes first, black and white: once the dial block is over, the
 * day's dials are red if under 70% of the goal. Before the block ends,
 * nothing is red yet. Red dials hide that day's recruiting steps.
 */
export function productionRed({ role = 'builder', path, plan, dialsDone, now, times = {}, redBelow = RED_BELOW }) {
  const goal = plan?.daily?.dials;
  if (!goal) return false;
  const block = ROUTINES.find((r) => r.role === role && r.doneWhen === 'dials' && (role === 'agent' || r.path === path));
  if (!block) return false;
  const ends = addMinutes(times[block.id] ?? block.at, block.minutes);
  return now >= ends && dialsDone < goal * redBelow;
}

/** Replace {daily.dials}-style tokens with the plan's numbers. */
function fill(title, plan) {
  return title.replace(/\{(daily|weekly|monthly)\.(\w+)\}/g, (all, level, key) => {
    const v = plan?.[level]?.[key];
    return v === undefined ? all : String(v);
  });
}

/**
 * The to-do list for one day and one role, in time order. Planning for the
 * bigger timeframes is scheduled before the day starts, so the plan always
 * comes first: set the direction, then execute the blocks.
 * Agents all get the same day. Leaders get the routine for their path.
 * Pass `activities` + `agentId` to mark what is already done.
 * Content blocks appear only with `content: true` (content is optional).
 * Pass `now` too, and recruiting steps hide while their dials are red:
 * production comes first.
 */
export function todoFor(dayKey, { role, path = null, plan, activities = null, agentId = null, tz, times = {}, starting = false, content = false, now = null } = {}) {
  if (!['agent', 'builder'].includes(role)) throw new Error(`Unknown role: ${role}`);
  if (role === 'builder' && !['producer', 'coach', 'director'].includes(path)) {
    throw new Error('A leader needs a path: producer or coach');
  }
  const c = asCal(dayKey);
  const done = activities && agentId ? totalsFor(activities, { tf: '1D', key: dayKey, tz, agentIds: [agentId] }) : null;
  const holdRecruiting = now && done ? productionRed({ role, path, plan, dialsDone: done.dials, now, times }) : false;
  return ROUTINES
    .filter((r) => r.role === role && (role === 'agent' || r.path === path) && (!r.startingOnly || starting) && isDue(r.when, c))
    .filter((r) => (!r.content || content) && !(r.recruiting && holdRecruiting))
    .map((r) => ({ ...r, at: times[r.id] ?? r.at }))
    .sort((x, y) => x.at.localeCompare(y.at) || TF_ORDER[x.tf] - TF_ORDER[y.tf])
    .map((r) => {
      const goal = r.doneWhen && plan?.daily?.[r.doneWhen];
      const progress = done && r.doneWhen ? done[r.doneWhen] : null;
      return {
        id: r.id, tf: r.tf, at: r.at, minutes: r.minutes, part: r.part,
        title: fill(r.title, plan),
        goal: goal ?? null,
        progress,
        done: goal != null && progress != null ? progress >= goal : null,
      };
    });
}
