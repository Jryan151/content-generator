// The core: what Agent Reels is built on while the focus is producer to builder.
//
// Every feature has to serve these values and feed one of these screens.
// Anything that doesn't is PARKED until there's real data from a real team.
// See CORE.md for the same thing in plain words.

/** The product the system is built for first. Others wait until this works. */
export const FOCUS_PRODUCT = Object.freeze({ id: 'final_expense', name: 'Final expense' });

/** The five core values, each with the code that enforces it. */
export const CORE_VALUES = Object.freeze([
  {
    id: 'production-first',
    value: 'Production first.',
    meaning: 'A builder is a producer who never stopped producing. When her own calls are down (days off don’t count), that comes first and team work waits.',
    enforcedBy: ['attention.ownProduction', 'career.placeOnLadder'],
  },
  {
    id: 'business-that-sticks',
    value: 'Only business that sticks counts.',
    meaning: 'Placed and still-active policies are the score, not applications or recruits signed. Selling every week counts placed policies once there are any.',
    enforcedBy: ['quality.quality', 'career.weeksWithASale', 'pay.payPicture'],
  },
  {
    id: 'one-next-action',
    value: 'One next action.',
    meaning: 'Every screen answers “what do I do now?” in black and white. Today shows five things at most.',
    enforcedBy: ['today.todayLayout', 'today.dayStatus', 'career.placeOnLadder'],
  },
  {
    id: 'log-once',
    value: 'Log once, compute everything.',
    meaning: 'One tap per action. Every number on every screen comes from the activity log.',
    enforcedBy: ['metrics.addActivity', 'timeframes.totalsFor'],
  },
  {
    id: 'real-or-blank',
    value: 'Real or blank.',
    meaning: 'No fake or placeholder numbers. Missing data shows as “needs data.”',
    enforcedBy: ['setup.buildSystem', 'quality.quality'],
  },
]);

/** The only screens being built now, and the engine functions each one reads. */
export const SCREENS = Object.freeze([
  {
    id: 'setup', name: 'Setup', who: 'Leader, once',
    job: 'Three answers: agents selling now, start of day, what she wants to earn.',
    reads: ['setup.buildSystem'],
  },
  {
    id: 'today', name: 'Today', who: 'Every agent',
    job: 'One short chain: what can’t wait, the next call, one team thing, her day so far, done. Everything else is behind More. Before licensing, a study day instead.',
    reads: ['today.todayLayout', 'today.dayStatus', 'calls.queueFor', 'calls.logCall', 'calls.logMeeting', 'calls.logCareCall', 'calls.dayText', 'routines.todoFor', 'routines.productionRed', 'career.routineFor', 'attention.teamSummary', 'attention.ownProduction', 'attention.dayOffRow', 'pay.payPicture', 'store.migrate'],
  },
  {
    id: 'pipeline', name: 'Clients', who: 'Every agent',
    job: 'Everyone she’s working with, by where they stand: talked, meeting, application sent, approved, payment missed.',
    reads: ['pipeline.LEAD_STAGES', 'pipeline.moveLead', 'calls.approvePolicy', 'calls.markPaymentMissed', 'career.isUnlocked'],
  },
  {
    id: 'ladder', name: 'Progress', who: 'Every agent',
    job: 'A leader: what her team paid her next to her own sales, three readings, one step this month. An agent: their focus and the one thing to the next stage.',
    reads: ['career.placeOnLadder', 'attention.builderMeasure', 'pay.payPicture', 'quality.quality', 'quality.showRate'],
  },
  {
    id: 'team', name: 'My people', who: 'Leader (and a producer with recruits)',
    job: 'Who could use her, one action each, then her recruits one at a time. Invites on the team site.',
    reads: ['attention.leaderView', 'attention.teamSummary', 'attention.applyCheckins', 'ladder.RECRUIT_STAGES', 'pipeline.moveRecruit', 'pipeline.dropRecruit', 'pipeline.daysInStage'],
  },
]);

/**
 * Simple, held by tests (test/simple.test.js): the app is for busy people who don't read instructions.
 *   todayMaxSlots   Today shows at most this many things above "More"
 *   plainWords      words that never appear in what a person reads on screen
 *   jobs            one feature per job; a job listed twice, or a feature doing two jobs, fails
 */
export const SIMPLE = Object.freeze({
  todayMaxSlots: 5,
  plainWords: Object.freeze(['pipeline', 'override', 'parked', 'production first', 'red list', 'recruiting step', 'names list', 'ladder']),
  jobs: Object.freeze([
    { job: 'Who to call next', feature: 'calls.queueFor' },
    { job: 'Log what happened', feature: 'calls.logCall' },
    { job: 'Protect a policy', feature: 'calls.logCareCall' },
    { job: 'Is her day done?', feature: 'today.dayStatus' },
    { job: 'What Today shows', feature: 'today.todayLayout' },
    { job: 'Is her own selling okay?', feature: 'attention.ownProduction' },
    { job: 'Who on her team needs her', feature: 'attention.leaderView' },
    { job: 'Her recruits', feature: 'pipeline.moveRecruit' },
    { job: 'Is she building?', feature: 'attention.builderMeasure' },
    { job: 'What she and her team earned', feature: 'pay.payPicture' },
    { job: 'Where an agent is going next', feature: 'career.placeOnLadder' },
  ]),
});

/** Parked until there's real data. Code stays where it exists, so nothing needs a rebuild. */
export const PARKED = Object.freeze([
  { feature: 'Director and Upline paths and views', where: 'paths.PARKED_PATHS, career PARKED_STAGES' },
  { feature: 'Plan cascade and earnings-to-premium math', where: 'routines.planDown (stays off until setup.buildSystem has real data)' },
  { feature: 'Monthly, quarterly and yearly views', where: 'routines ROUTINES above 1W' },
  { feature: 'Playbook screen', where: 'scripts attach to Today steps once the leader shares them' },
  { feature: 'Commission tracker: payments received, late and partial (her pay picture is live: src/pay.js)', where: 'src/parked/commissions.js reconcile' },
  { feature: 'Content and the post block', where: 'routines.todoFor({ content: false })' },
  { feature: 'Rules beyond production first', where: 'paths.actionsFor beyond the red line' },
  { feature: 'Pricing and billing', where: 'not built' },
  { feature: 'Real estate expansion', where: 'not built' },
]);
