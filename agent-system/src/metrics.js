// The single list of what the system counts.
//
// Rule: every action leaves ONE activity row behind. Every number on every
// screen is a count (or sum) of those rows over a timeframe. If a new number
// is needed, add an activity type and a metric here — never a one-off counter.

/** Every kind of activity row the app can write. */
export const ACTIVITY_TYPES = Object.freeze([
  'dial',             // agent placed a call
  'conversation',     // call connected and a real conversation happened
  'followup_done',    // a scheduled follow-up was completed
  'post',             // a piece of content was posted (from the generator)
  'appt_set',         // appointment booked
  'appt_held',        // appointment actually happened
  'app_written',      // application submitted; value = annual premium
  'policy_issued',    // carrier issued the policy; value = annual premium
  'chargeback',       // policy lapsed inside the chargeback window; value = premium lost
  'recruit_added',    // builder added a new recruit (prospect) to the pipeline
  'training_task_done', // agent finished a step in the 30-day plan
  'recruit_interviewed', // builder interviewed a recruit
  'recruit_licensed',    // a recruit passed licensing
  'names_conversation',  // producer talked with someone on their names list
  'recruit_step',        // a recruiting next step done that isn't a stage move (e.g. licensing check-in)
  'recruit_first_sale',  // a recruit made their first sale
  'study_session',       // studied for the licensing exam; value = minutes
  'practice_test',       // took a practice licensing exam; value = score (0-100)
  'license_passed',      // passed the state licensing exam
  'care_call',           // a welcome, pre-draft or save call on an approved policy (never a sales dial)
  'exam_booked',         // booked the licensing exam; meta.exam_on = 'YYYY-MM-DD'
  'checkin',             // a leader checked in with someone on their team; meta.person_id
]);

/** Every recruiting action a builder takes. Counts toward the daily recruiting step. */
export const RECRUIT_STEP_TYPES = Object.freeze(['recruit_added', 'recruit_interviewed', 'recruit_licensed', 'recruit_step', 'recruit_first_sale']);

/**
 * Metric definitions.
 * kind: 'count' counts rows; 'sum' adds up row.value.
 * type (one activity type) or types (any of several) says which rows count.
 * level: 'input' = what an agent controls today; 'outcome' = what the
 *        inputs produce. The zoom-in loop reads outcomes at the top and
 *        inputs at the bottom.
 */
export const METRICS = Object.freeze({
  dials:          { label: 'Dials',             type: 'dial',          kind: 'count', level: 'input' },
  conversations:  { label: 'Conversations',     type: 'conversation',  kind: 'count', level: 'input' },
  followups:      { label: 'Follow-ups done',   type: 'followup_done', kind: 'count', level: 'input' },
  posts:          { label: 'Posts',             type: 'post',          kind: 'count', level: 'input' },
  apptsSet:       { label: 'Appointments set',  type: 'appt_set',      kind: 'count', level: 'outcome' },
  apptsHeld:      { label: 'Appointments held', type: 'appt_held',     kind: 'count', level: 'outcome' },
  appsWritten:    { label: 'Applications',      type: 'app_written',   kind: 'count', level: 'outcome' },
  premiumWritten: { label: 'Premium written',   type: 'app_written',   kind: 'sum',   level: 'outcome', unit: 'USD' },
  policiesPlaced: { label: 'Policies placed',   type: 'policy_issued', kind: 'count', level: 'outcome' }, // only business that sticks counts: see quality.js
  premiumIssued:  { label: 'Premium issued',    type: 'policy_issued', kind: 'sum',   level: 'outcome', unit: 'USD' },
  chargebacks:    { label: 'Chargebacks',       type: 'chargeback',    kind: 'count', level: 'outcome' },
  recruits:       { label: 'Recruits added',    type: 'recruit_added', kind: 'count', level: 'input' }, // never a headline: head count doesn't count
  trainingDone:   { label: 'Training steps',    type: 'training_task_done', kind: 'count', level: 'input' },
  interviews:     { label: 'Recruit interviews', type: 'recruit_interviewed', kind: 'count', level: 'input' },
  licensed:       { label: 'Recruits licensed', type: 'recruit_licensed', kind: 'count', level: 'outcome' },
  firstSales:     { label: 'Recruits to a first sale', type: 'recruit_first_sale', kind: 'count', level: 'outcome' },
  namesConversations: { label: 'Names-list conversations', type: 'names_conversation', kind: 'count', level: 'input' },
  recruitSteps:   { label: 'Recruiting steps',  types: RECRUIT_STEP_TYPES, kind: 'count', level: 'input' },
  studySessions:  { label: 'Study sessions',    type: 'study_session',  kind: 'count', level: 'input' },
  studyMinutes:   { label: 'Minutes studied',   type: 'study_session',  kind: 'sum',   level: 'input' },
  practiceTests:  { label: 'Practice tests',    type: 'practice_test',  kind: 'count', level: 'input' },
  licensesPassed: { label: 'Exam passed',       type: 'license_passed', kind: 'count', level: 'outcome' },
  careCalls:      { label: 'Policy care calls', type: 'care_call',      kind: 'count', level: 'input' },
});

const matches = (m, type) => (m.types ? m.types.includes(type) : m.type === type);

/**
 * Which metrics each timeframe headlines. Recruiting is headlined by people
 * who get licensed and reach a first sale, never by recruits added.
 */
export const HEADLINE_METRICS = Object.freeze({
  '1D': ['dials', 'conversations', 'followups'],
  '1W': ['apptsSet', 'apptsHeld', 'appsWritten'],
  '1M': ['premiumWritten', 'premiumIssued', 'chargebacks', 'licensed', 'firstSales'],
  '1Q': ['premiumIssued', 'appsWritten', 'firstSales'],
  '1Y': ['premiumIssued', 'firstSales'],
});

/** Starter daily targets for an agent. Builders override these per team. */
export const DEFAULT_DAILY_TARGETS = Object.freeze({
  dials: 15,
  conversations: 5,
  followups: 4,
  posts: 1,
});

export function emptyTotals() {
  const t = {};
  for (const key of Object.keys(METRICS)) t[key] = 0;
  return t;
}

/** Add one activity row into a totals object (mutates and returns it). */
export function addActivity(totals, activity) {
  for (const [key, m] of Object.entries(METRICS)) {
    if (!matches(m, activity.type)) continue;
    totals[key] += m.kind === 'sum' ? Number(activity.value || 0) : 1;
  }
  return totals;
}
