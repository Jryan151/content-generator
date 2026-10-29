// The core: what Agent Reels is built on while the focus is producer to builder.
//
// Every feature has to serve these values and feed one of these screens.
// Anything that doesn't is PARKED until there's real data from a real team.
// See CORE.md for the same thing in plain words.

/** The five core values, each with the code that enforces it. */
export const CORE_VALUES = Object.freeze([
  {
    id: 'production-first',
    value: 'Production first.',
    meaning: 'A builder is a producer who never stopped producing. Recruiting work only shows when today’s production is on track.',
    enforcedBy: ['routines.productionRed', 'career.placeOnLadder'],
  },
  {
    id: 'business-that-sticks',
    value: 'Only business that sticks counts.',
    meaning: 'Placed and still-active policies are the score, not applications or recruits signed.',
    enforcedBy: ['quality.quality'],
  },
  {
    id: 'one-next-action',
    value: 'One next action.',
    meaning: 'Every screen answers “what do I do now?” in black and white.',
    enforcedBy: ['career.placeOnLadder', 'routines.todoFor'],
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
    job: 'The day’s next actions in order: production block first, then one recruiting step only if production is on track. One tap logs each.',
    reads: ['routines.todoFor', 'routines.productionRed', 'career.routineFor', 'paths.actionsFor'],
  },
  {
    id: 'pipeline', name: 'Pipeline', who: 'Every agent',
    job: 'Clients: contacted, appointment, submitted, placed. Recruits: name, interviewed, studying, licensed, first sale.',
    reads: ['pipeline.LEAD_STAGES', 'pipeline.moveLead', 'ladder.RECRUIT_STAGES', 'pipeline.moveRecruit', 'career.isUnlocked'],
  },
  {
    id: 'ladder', name: 'Ladder', who: 'Every agent',
    job: 'Current stage, why it’s the focus, and the one gate to the next.',
    reads: ['career.placeOnLadder', 'quality.quality'],
  },
  {
    id: 'team', name: 'Team', who: 'Leader',
    job: 'Each recruit’s stage, whether production is on track, how much of their business sticks, and who needs help today.',
    reads: ['career.placeOnLadder', 'paths.redList', 'ladder.duplication', 'quality.quality', 'timeframes.whereItBroke'],
  },
]);

/** Parked until there's real data. Code stays where it exists, so nothing needs a rebuild. */
export const PARKED = Object.freeze([
  { feature: 'Director and Upline paths and views', where: 'paths.PARKED_PATHS, career PARKED_STAGES' },
  { feature: 'Plan cascade and earnings-to-premium math', where: 'routines.planDown (stays off until setup.buildSystem has real data)' },
  { feature: 'Monthly, quarterly and yearly views', where: 'routines ROUTINES above 1W' },
  { feature: 'Playbook screen', where: 'scripts attach to Today steps once the leader shares them' },
  { feature: 'Commission tracker', where: 'src/parked/commissions.js' },
  { feature: 'Content and the post block', where: 'routines.todoFor({ content: false })' },
  { feature: 'Licensing study tracker', where: 'not built' },
  { feature: 'Rules beyond production first', where: 'paths.actionsFor beyond the red line' },
  { feature: 'Pricing and billing', where: 'not built' },
  { feature: 'Real estate expansion', where: 'not built' },
]);
