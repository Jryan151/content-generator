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
  const type = ACTIVITY_FOR[to];
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
    recruit: { ...recruit, stage: to },
    rows: [{ agent_id: builderId, type: RECRUIT_ACTIVITY[to] ?? 'recruit_step', occurred_at: at, meta: { recruit_id: recruit.id, to_stage: to } }],
  };
}

/** Adding a recruit is a recruiting step too. */
export function addRecruit({ id, name }, { builderId, at }) {
  if (!name?.trim()) throw new Error('A recruit needs a name');
  return {
    recruit: { id, name: name.trim(), stage: 'prospect' },
    rows: [{ agent_id: builderId, type: 'recruit_added', occurred_at: at, meta: { recruit_id: id } }],
  };
}
