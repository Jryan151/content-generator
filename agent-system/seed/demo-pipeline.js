// Demo pipeline for the fictional leader Morgan: clients, recruits and the
// team's start dates. Made up and labeled as demo everywhere it shows, like
// seed/sample.js. The demo runs the same engine as the real system.

import { LEADER, DEVON, TASHA, MARCUS, DEMO } from './sample.js';

/** Morgan's team, with the dates each agent started. */
export const DEMO_TEAM = Object.freeze([
  { id: DEVON, name: 'Devon L.', startedOn: '2026-08-17' },
  { id: TASHA, name: 'Tasha R.', startedOn: '2026-08-24' },
  { id: MARCUS, name: 'Marcus J.', startedOn: '2026-08-31' },
]);

/** Contract levels (set by you in the agency kit): Morgan's, and her agents'. Demo only. */
export const DEMO_LEVELS = Object.freeze({ [LEADER]: DEMO.contractPercent, [DEVON]: 60, [TASHA]: 60, [MARCUS]: 60 });

/** Morgan has written her Playbook in her own words (demo only). */
export const DEMO_PLAYBOOK_READY = true;

/**
 * Morgan's clients. `issuedOn` / `lapsedOn` are when the carrier placed the
 * policy and when it lapsed; they become policy_issued and chargeback rows
 * so quality() can follow each policy by its lead.
 */
export const DEMO_LEADS = Object.freeze([
  { id: 'demo-lead-1', agent_id: LEADER, name: 'R. Alvarez', stage: 'contacted', premium: null, nextOn: '2026-10-29' },
  { id: 'demo-lead-2', agent_id: LEADER, name: 'K. Brooks', stage: 'contacted', premium: null, nextOn: '2026-10-30' },
  { id: 'demo-lead-3', agent_id: LEADER, name: 'D. Nguyen', stage: 'appointment', premium: null, meetingOn: '2026-10-30' },
  { id: 'demo-lead-15', agent_id: LEADER, name: 'F. Ortiz', stage: 'new', premium: null },
  { id: 'demo-lead-16', agent_id: LEADER, name: 'H. Kim', stage: 'new', premium: null },
  { id: 'demo-lead-4', agent_id: LEADER, name: 'S. Patel', stage: 'application', premium: 640 },
  { id: 'demo-lead-5', agent_id: LEADER, name: 'T. Okafor', stage: 'application', premium: 710 },
  { id: 'demo-lead-6', agent_id: LEADER, name: 'J. Romero', stage: 'issued', premium: 680, issuedOn: '2026-10-09', approvedOn: '2026-10-09', draftOn: '2026-11-03', care: { pre_draft: '2026-10-30' } },
  { id: 'demo-lead-17', agent_id: LEADER, name: 'B. Walker', stage: 'lapse_risk', premium: 610, issuedOn: '2026-08-12', approvedOn: '2026-08-12', graceEndsOn: '2026-11-06', care: { save: '2026-10-30' } },
  { id: 'demo-lead-7', agent_id: LEADER, name: 'M. Chen', stage: 'issued', premium: 590, issuedOn: '2026-07-14' },
  { id: 'demo-lead-8', agent_id: LEADER, name: 'L. Harris', stage: 'issued', premium: 720, issuedOn: '2026-04-21' },
  { id: 'demo-lead-9', agent_id: LEADER, name: 'P. Gomez', stage: 'lost', premium: 560, issuedOn: '2026-05-05', lapsedOn: '2026-08-18' },
  { id: 'demo-lead-10', agent_id: DEVON, name: 'A. Reyes', stage: 'issued', premium: 600, issuedOn: '2026-09-22' },
  { id: 'demo-lead-11', agent_id: DEVON, name: 'C. Diaz', stage: 'issued', premium: 540, issuedOn: '2026-10-13' },
  { id: 'demo-lead-12', agent_id: TASHA, name: 'B. Foster', stage: 'issued', premium: 510, issuedOn: '2026-09-29' },
  { id: 'demo-lead-13', agent_id: TASHA, name: 'E. Ward', stage: 'lost', premium: 530, issuedOn: '2026-09-18', lapsedOn: '2026-10-23' },
  { id: 'demo-lead-14', agent_id: MARCUS, name: 'G. Lee', stage: 'application', premium: 500 },
]);

/**
 * Devon's own call list for the producer demo: his placed clients from
 * DEMO_LEADS plus people to call today. Kept apart from DEMO_LEADS so the
 * leader demo's numbers don't change.
 */
export const DEMO_PRODUCER_LEADS = Object.freeze([
  ...DEMO_LEADS.filter((l) => l.agent_id === DEVON),
  { id: 'demo-p-lead-1', agent_id: DEVON, name: 'V. Morales', stage: 'contacted', premium: null, nextOn: '2026-10-30' },
  { id: 'demo-p-lead-2', agent_id: DEVON, name: 'N. Baker', stage: 'contacted', premium: null, nextOn: '2026-10-29' },
  { id: 'demo-p-lead-3', agent_id: DEVON, name: 'W. Price', stage: 'appointment', premium: null, meetingOn: '2026-10-30' },
  { id: 'demo-p-lead-4', agent_id: DEVON, name: 'I. Torres', stage: 'new', premium: null },
  { id: 'demo-p-lead-5', agent_id: DEVON, name: 'Y. Bell', stage: 'application', premium: 560 },
]);

/** People on Morgan's way to becoming agents. */
export const DEMO_RECRUITS = Object.freeze([
  { id: 'demo-recruit-1', name: 'Aaliyah K.', stage: 'interviewed', since: '2026-10-22T17:00:00.000Z' },
  { id: 'demo-recruit-2', name: 'Ben S.', stage: 'licensing', since: '2026-10-02T17:00:00.000Z' },
  { id: 'demo-recruit-3', name: 'Carla V.', stage: 'prospect', since: '2026-10-27T17:00:00.000Z' },
]);

const at = (day) => `${day}T17:00:00.000Z`;

const daysBefore = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/**
 * The submitted → placed → lapsed rows for the demo leads, each carrying its
 * lead, so the demo's quality numbers describe exactly these clients.
 */
export function demoQualityActivities() {
  const rows = [];
  for (const l of DEMO_LEADS) {
    if (l.premium) rows.push({ agent_id: l.agent_id, lead_id: l.id, type: 'app_written', value: l.premium, occurred_at: at(l.issuedOn ? daysBefore(l.issuedOn, 14) : '2026-10-26') });
    if (l.issuedOn) rows.push({ agent_id: l.agent_id, lead_id: l.id, type: 'policy_issued', value: l.premium, occurred_at: at(l.issuedOn) });
    if (l.lapsedOn) rows.push({ agent_id: l.agent_id, lead_id: l.id, type: 'chargeback', value: l.premium, occurred_at: at(l.lapsedOn) });
  }
  return rows;
}
