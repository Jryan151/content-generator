// Setup, black and white.
//
// The system ships as the standard. A leader doesn't build it; she follows it.
// So setup asks only what can't be learned and can't be filled in by you:
//
//   FROM HER (under a minute)  one yes/no tap, a start time, what she wants to earn
//   FROM YOU (once per agency) the agency kit: playbook, promotion rules
//   LEARNED (no one types it)  conversion rates, from her own logging; no starters, no guesses
//   FIXED (the standard)       red line, check times, messages, routines
//
//   emptyLeaderSetup() / validateLeaderSetup()
//   emptyAgencyKit()   / validateAgencyKit()
//   buildSystem({ leader, kit, activities, agentIds }) → what the engine runs on

import { planDown, ratesFrom, ROUTINES } from './routines.js';
import { THRESHOLDS, MESSAGES, choosePath, PARKED_PATHS } from './paths.js';
import { LADDER } from './ladder.js';
import { toCalendarDate } from './timeframes.js';
import { STARTER_COMP } from './parked/commissions.js';

export const LEADER_SETUP_VERSION = 4;
export const AGENCY_KIT_VERSION = 1;

/**
 * She answers in what she wants to EARN. The plan runs on premium, so the
 * system converts: premium = earnings ÷ contract level. The contract level
 * (her commission as a percent of annual premium) is set by you on her
 * profile, never typed by her and never guessed. The goal covers her own
 * sales; overrides from her team come on top.
 */
/** Yearly premium needed to earn `income` at a contract level. Rounds up. */
export function premiumForIncome(income, contractPercent) {
  if (!(income > 0)) throw new Error('income must be a positive number');
  if (!(contractPercent > 0)) throw new Error('contractPercent must be a positive number');
  return Math.ceil(income / (contractPercent / 100));
}

/** Start-of-day presets: every routine shifts together. */
export const START_PRESETS = Object.freeze({
  early: { label: 'Early', shiftMinutes: -60, example: 'Dial block at 8:00' },
  standard: { label: 'Standard', shiftMinutes: 0, example: 'Dial block at 9:00' },
  late: { label: 'Late', shiftMinutes: 60, example: 'Dial block at 10:00' },
});

/** Conversion rates switch from starters to hers after this much logging. */
export const LEARN_AFTER_DAYS = 10;

export const STARTER_PLAYBOOK = Object.freeze([
  { title: 'Opening the call', goal: 'Earn 30 seconds and permission to continue.', say: [], objections: [] },
  { title: 'Finding the need', goal: 'Find out who they protect and what worries them.', say: [], objections: [] },
  { title: 'Presenting options', goal: 'Two or three options with a monthly price they can picture.', say: [], objections: [] },
  { title: 'Handling objections', goal: 'Agree, ask a question, answer it. Never argue.', say: [], objections: [] },
  { title: 'Closing and follow-up', goal: 'Confirm the choice, set the next step, log it.', say: [], objections: [] },
]);

const LADDER_KEYS = Object.freeze({ producerToCoach: 'producer', coachToDirector: 'coach', directorToUpline: 'director' });

const blank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

// ── From her ──────────────────────────────────────────────────────────

export function emptyLeaderSetup() {
  return { version: LEADER_SETUP_VERSION, name: '', hasAgents: null, start: null, yearlyIncome: null };
}

export function validateLeaderSetup(s) {
  const errors = [];
  if (!s || typeof s !== 'object') return { ok: false, errors: ['setup must be an object'] };
  if (s.version !== LEADER_SETUP_VERSION) errors.push(`version: expected ${LEADER_SETUP_VERSION}`);
  if (!blank(s.hasAgents) && typeof s.hasAgents !== 'boolean') errors.push('hasAgents: answer yes or no');
  if (!blank(s.start) && !START_PRESETS[s.start]) errors.push('start: pick early, standard or late');
  if (!blank(s.yearlyIncome) && !(typeof s.yearlyIncome === 'number' && s.yearlyIncome > 0)) errors.push('yearlyIncome: a dollar amount above 0');
  return { ok: errors.length === 0, errors };
}

// ── From you, once per agency ────────────────────────────────────────

export function emptyAgencyKit() {
  return {
    version: AGENCY_KIT_VERSION,
    agency: '',
    ladder: {
      producerToCoach: { steadyWeeks: null },
      coachToDirector: { agentsSelling: null, agentsDeveloped: null },
      directorToUpline: { coachesBuilt: null },
    },
    eliteGroup: { name: '', requirements: '' },
    compensation: { advancePercent: null, advanceDueDays: null }, // agency-wide; each person's contract level is set on their profile
    playbook: STARTER_PLAYBOOK.map((s) => ({ title: s.title, goal: '', say: [], objections: [] })),
    training: null, // null = built from the playbook automatically
    messages: null, // null = the standard messages
  };
}

export function validateAgencyKit(k) {
  const errors = [];
  if (!k || typeof k !== 'object') return { ok: false, errors: ['kit must be an object'] };
  if (k.version !== AGENCY_KIT_VERSION) errors.push(`version: expected ${AGENCY_KIT_VERSION}`);
  for (const [key, req] of Object.entries(k.ladder || {})) {
    for (const [f, v] of Object.entries(req || {})) {
      const pct = f.endsWith('Percent');
      if (!blank(v) && !(typeof v === 'number' && v > 0 && (!pct || v <= 100))) errors.push(`ladder.${key}.${f}: ${pct ? 'a percent from 1 to 100' : 'a number above 0'}`);
    }
  }
  (k.playbook || []).forEach((step, i) => {
    if (((step.say || []).length || (step.objections || []).length) && blank(step.title)) errors.push(`playbook[${i}].title: a step with content needs a title`);
    (step.objections || []).forEach((o, j) => {
      if (blank(o.ifTheySay) !== blank(o.answer)) errors.push(`playbook[${i}].objections[${j}]: needs what they say and the answer`);
    });
  });
  if (k.training !== null && k.training !== undefined) {
    if (!Array.isArray(k.training)) errors.push('training: a list of weeks, or null to build it from the playbook');
    else k.training.forEach((w, i) => { if (!Array.isArray(w.tasks) || !w.tasks.length) errors.push(`training[${i}]: needs at least one task`); });
  }
  const c = k.compensation || {};
  if (!blank(c.advancePercent) && !(typeof c.advancePercent === 'number' && c.advancePercent > 0 && c.advancePercent <= 100)) errors.push('compensation.advancePercent: a percent from 1 to 100');
  if (!blank(c.advanceDueDays) && !(Number.isInteger(c.advanceDueDays) && c.advanceDueDays > 0)) errors.push('compensation.advanceDueDays: a whole number of days');
  for (const [name, text] of Object.entries(k.messages || {})) {
    if (!MESSAGES[name]) errors.push(`messages.${name}: unknown message`);
    else if (!String(text).includes('{name}')) errors.push(`messages.${name}: must include {name}`);
  }
  return { ok: errors.length === 0, errors };
}

/** The 30-day plan, built from the playbook so nobody types it twice. */
export function trainingFromPlaybook(playbook) {
  const titles = playbook.map((s) => s.title);
  return [
    { week: 1, title: 'Learn the playbook', tasks: [...titles.map((t) => `Learn “${t}” and say it out loud 5 times`), 'Shadow 5 of your leader’s calls'] },
    { week: 2, title: 'First calls', tasks: ['Hit your daily dials every day', 'Log every call', `Use “${titles.at(0)}” on every call`] },
    { week: 3, title: 'First appointments', tasks: ['Book 3 appointments', `Practice “${titles.at(3) ?? titles.at(-1)}” with your leader`, 'Run one appointment with your leader listening'] },
    { week: 4, title: 'First application', tasks: ['Write your first application', 'Hit your daily numbers 4 of 5 days', 'Check-in with your leader: one thing to fix next month'] },
  ];
}

const shiftTime = (hhmm, minutes) => {
  const [h, m] = hhmm.split(':').map(Number);
  const t = Math.min(23 * 60 + 59, Math.max(0, h * 60 + m + minutes));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

/** How many distinct days the team has logged anything. */
function daysLogged(activities, agentIds, tz) {
  const days = new Set();
  for (const a of activities || []) {
    if (agentIds && !agentIds.includes(a.agent_id)) continue;
    days.add(toCalendarDate(a.occurred_at, tz).getTime());
  }
  return days.size;
}

/**
 * Everything the engine runs on. Never throws for missing information —
 * it reports what it's waiting on, split by who provides it:
 *   waitingOn.her      — the leader's 3 answers
 *   waitingOn.you      — the agency kit
 *   waitingOn.learning — what fills itself in from logging
 */
export function buildSystem({ leader = emptyLeaderSetup(), kit = emptyAgencyKit(), contractPercent = null, activities = [], agentIds = null, tz = 'America/Phoenix' } = {}) {
  const lv = validateLeaderSetup(leader);
  const kv = validateAgencyKit(kit);
  if (!blank(contractPercent) && !(typeof contractPercent === 'number' && contractPercent > 0 && contractPercent <= 200)) {
    lv.ok = false; lv.errors.push('contractPercent: a percent above 0 (her commission on annual premium)');
  }
  if (!lv.ok || !kv.ok) throw new Error(`Setup has errors:\n  ${[...lv.errors, ...kv.errors].join('\n  ')}`);
  const waitingOn = { her: [], you: [], learning: [] };

  // Her three answers. The first only seeds the path; activity decides after that.
  if (blank(leader.hasAgents)) waitingOn.her.push('Agents selling now?');
  if (blank(leader.start)) waitingOn.her.push('Start of day');
  if (blank(leader.yearlyIncome)) waitingOn.her.push('Yearly earnings goal');
  const path = choosePath({ hasAgents: leader.hasAgents ?? true });
  const start = leader.start || 'standard';
  // No guessed numbers. Every target comes from her answer, her real
  // contract level, and her own logged activity. Until all three exist she
  // runs the baseline: the routine without numbers, logging what she does.
  const yearlyIncome = blank(leader.yearlyIncome) ? null : leader.yearlyIncome;
  const contract = blank(contractPercent) ? null : contractPercent;
  if (contract === null) waitingOn.you.push('Her contract level (commission % of annual premium)');
  const yearlyPremium = yearlyIncome !== null && contract !== null ? premiumForIncome(yearlyIncome, contract) : null;

  // Learned: her real rates, each from enough of her own activity. Never a starter.
  const logged = daysLogged(activities, agentIds, tz);
  const { basedOn, ...measured } = ratesFrom(activities, { agentIds, strict: true });
  const RATE_DATA = {
    contactRate: ['conversations from dials', 'dials'],
    bookingRate: ['appointments from conversations', 'conversations'],
    closeRate: ['applications from appointments', 'apptsSet'],
    avgPremium: ['average premium per application', 'appsWritten'],
  };
  if (logged < LEARN_AFTER_DAYS) waitingOn.learning.push(`${LEARN_AFTER_DAYS} days of logged activity (${logged} so far)`);
  for (const [k, [label, den]] of Object.entries(RATE_DATA)) {
    if (measured[k] === null) waitingOn.learning.push(`Enough ${den === 'apptsSet' ? 'appointments' : den === 'appsWritten' ? 'applications' : den} to measure ${label} (${basedOn[den]} of 10)`);
  }
  const ratesReady = logged >= LEARN_AFTER_DAYS && Object.values(measured).every((v) => v !== null);
  const rates = ratesReady ? measured : null;
  const ratesSource = ratesReady ? 'learned' : 'not yet';
  const plan = rates && yearlyPremium !== null ? planDown({ yearlyPremium, rates }) : null;
  if (plan) plan.yearly.income = yearlyIncome;

  // Times: one preset shifts every routine.
  const shift = START_PRESETS[start].shiftMinutes;
  const times = Object.fromEntries(ROUTINES.map((r) => [r.id, shiftTime(r.at, shift)]));

  // From you: the agency kit.
  const playbookIn = kit.playbook?.length ? kit.playbook : STARTER_PLAYBOOK;
  const playbook = playbookIn.map((step, i) => {
    const starter = STARTER_PLAYBOOK.at(i) || { title: `Step ${i + 1}`, goal: '' };
    const filled = (step.say || []).length > 0;
    if (!filled) waitingOn.you.push(`Playbook: ${step.title || starter.title}`);
    return {
      position: i + 1,
      title: step.title || starter.title,
      goal: blank(step.goal) ? starter.goal : step.goal,
      say: step.say || [],
      objections: (step.objections || []).filter((o) => !blank(o.ifTheySay)),
      isStarter: !filled,
    };
  });
  const training = Array.isArray(kit.training) && kit.training.length ? kit.training : trainingFromPlaybook(playbook);

  const ladder = LADDER.map((rung) => {
    const key = Object.keys(LADDER_KEYS).find((k) => LADDER_KEYS[k] === rung.from);
    const given = kit.ladder?.[key] || {};
    return {
      ...rung,
      requires: rung.requires.map((q) => {
        if (q.fixed) return { ...q, isStarter: false };
        const v = given[q.pct ? `${q.metric}Percent` : q.metric];
        if (blank(v)) {
          // Rungs into a parked stage keep their starters quietly: not something to fill in yet.
          if (!PARKED_PATHS[rung.to] && rung.to !== 'upline') waitingOn.you.push(`Promotion rule: ${rung.from} → ${rung.to}, ${q.label}`);
          return { ...q, isStarter: true };
        }
        return { ...q, need: q.pct ? v / 100 : v, isStarter: false };
      }),
    };
  });
  if (blank(kit.eliteGroup?.requirements)) waitingOn.you.push('Elite group requirements');
  const comp = {
    advancePercent: kit.compensation?.advancePercent ?? STARTER_COMP.advancePercent,
    advanceDueDays: kit.compensation?.advanceDueDays ?? STARTER_COMP.advanceDueDays,
  };
  if (blank(kit.compensation?.advancePercent) || blank(kit.compensation?.advanceDueDays)) waitingOn.you.push('Advance terms (percent and days to pay)');

  // Fixed: the standard. Only the kit (you) may reword a message.
  const messages = { ...MESSAGES };
  for (const [name, text] of Object.entries(kit.messages || {})) messages[name] = (who) => text.replaceAll('{name}', who);

  return {
    name: leader.name || '',
    path, start, plan, rates, ratesSource, times,
    yearlyIncome, yearlyPremium, contractPercent: contract,
    targetsReady: plan !== null, // false = baseline: the routine, no numbers
    measuredFrom: { daysLogged: logged, ...basedOn },
    thresholds: { ...THRESHOLDS },
    messages, playbook, training, ladder,
    playbookReady: playbook.every((p) => !p.isStarter),
    comp,
    eliteGroup: kit.eliteGroup || { name: '', requirements: '' },
    agency: kit.agency || '',
    waitingOn,
    ready: { her: waitingOn.her.length === 0, you: waitingOn.you.length === 0, learning: waitingOn.learning.length === 0 },
  };
}
