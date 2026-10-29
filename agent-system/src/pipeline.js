// Pipeline moves: moving a client or a recruit is the log entry.
//
// This mirrors the database trigger (db/schema.sql log_stage_change) so a
// screen running without the database writes exactly the rows the database
// would. Agents never log twice: they move a card, the row is written.

import { RECRUIT_STAGES } from './ladder.js';

/** Client stages in order, with the label a person recognizes. */
export const LEAD_STAGES = Object.freeze([
  { id: 'new', label: 'New' },
  { id: 'contacted', label: 'Talked' },
  { id: 'appointment', label: 'Appointment' },
  { id: 'application', label: 'Application sent' },
  { id: 'issued', label: 'Insurer approved' },
  { id: 'lapse_risk', label: 'Payment missed' },
  { id: 'lost', label: 'Lost' },
]);

const LEAD_IDS = LEAD_STAGES.map((s) => s.id);
const ACTIVITY_FOR = { contacted: 'conversation', appointment: 'appt_set', application: 'app_written', issued: 'policy_issued' };

/** The one forward step for a client, or null at the end of the line. */
export function nextLeadStage(stage) {
  return { new: 'contacted', contacted: 'appointment', appointment: 'application', application: 'issued' }[stage] ?? null;
}

/**
 * Move a client to a new stage.
 *   premium   annual premium; required when moving to Submitted
 *   at        ISO timestamp of the move
 * Returns { lead, rows } — the updated client and the activity rows to log.
 */
export function moveLead(lead, to, { at, premium = null } = {}) {
  if (!LEAD_IDS.includes(to)) throw new Error(`Unknown client stage: ${to}`);
  if (lead.stage === to) return { lead, rows: [] };
  const next = { ...lead, stage: to };
  if (to === 'application') {
    const p = premium ?? lead.premium;
    if (!(p > 0)) throw new Error('Submitting needs the annual premium');
    next.premium = p;
  }
  const rows = [];
  // A missed payment that gets fixed was already placed: coming back from Payment missed logs nothing new.
  const type = to === 'issued' && lead.stage === 'lapse_risk' ? null : ACTIVITY_FOR[to];
  if (type) {
    rows.push({
      agent_id: lead.agent_id, lead_id: lead.id, type, occurred_at: at,
      ...(type === 'app_written' || type === 'policy_issued' ? { value: next.premium } : {}),
    });
  }
  // A lapse after placement is a chargeback on the same client.
  if (to === 'lost' && ['issued', 'lapse_risk'].includes(lead.stage)) {
    rows.push({ agent_id: lead.agent_id, lead_id: lead.id, type: 'chargeback', value: lead.premium, occurred_at: at });
  }
  return { lead: next, rows };
}

const RECRUIT_IDS = RECRUIT_STAGES.map((s) => s.id);
const RECRUIT_ACTIVITY = { interviewed: 'recruit_interviewed', licensed: 'recruit_licensed', first_sale: 'recruit_first_sale' };

/** The one forward step for a recruit, or null once they're producing. */
export function nextRecruitStage(stage) {
  const i = RECRUIT_IDS.indexOf(stage);
  return i >= 0 && i < RECRUIT_IDS.length - 1 ? RECRUIT_IDS[i + 1] : null;
}

/** Move a recruit. The builder's move is logged against the builder. */
export function moveRecruit(recruit, to, { builderId, at }) {
  if (!RECRUIT_IDS.includes(to)) throw new Error(`Unknown recruit stage: ${to}`);
  if (recruit.stage === to) return { recruit, rows: [] };
  return {
    recruit: { ...recruit, stage: to, since: at },
    rows: [{ agent_id: builderId, type: RECRUIT_ACTIVITY[to] ?? 'recruit_step', occurred_at: at, meta: { recruit_id: recruit.id, to_stage: to } }],
  };
}

/** A recruit who isn't moving forward leaves the pipeline (kept, marked, never deleted). */
export function dropRecruit(recruit, { builderId, at }) {
  if (recruit.stage === 'dropped') return { recruit, rows: [] };
  return {
    recruit: { ...recruit, stage: 'dropped', droppedFrom: recruit.stage, since: at },
    rows: [{ agent_id: builderId, type: 'recruit_step', occurred_at: at, meta: { recruit_id: recruit.id, to_stage: 'dropped' } }],
  };
}

/** Days in the current stage, and whether that's long enough to worry about. */
export const STUCK_AFTER_DAYS = Object.freeze({ licensing: 21, default: 14 });
export function daysInStage(recruit, dayKey) {
  if (!recruit.since) return { days: null, stuck: false };
  const days = Math.max(0, Math.floor((Date.parse(`${dayKey}T23:59:59Z`) - Date.parse(recruit.since)) / 86_400_000));
  const limit = STUCK_AFTER_DAYS[recruit.stage] ?? STUCK_AFTER_DAYS.default;
  return { days, stuck: recruit.stage !== 'dropped' && recruit.stage !== 'producing' && days >= limit };
}

/** Adding a recruit is a recruiting step too. */
export function addRecruit({ id, name }, { builderId, at }) {
  if (!name?.trim()) throw new Error('A recruit needs a name');
  return {
    recruit: { id, name: name.trim(), stage: 'prospect', since: at },
    rows: [{ agent_id: builderId, type: 'recruit_added', occurred_at: at, meta: { recruit_id: id } }],
  };
}
