// Sample team + one month of activity, fully deterministic (same output every run).
// Story: September is a normal month. In October, Marcus (a new agent) stops
// dialing in the third week, appointments dry up, and team premium falls.
// The zoom-in loop should find exactly that.

export const TZ = 'America/Phoenix';

export const PEOPLE = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'Morgan (builder)', role: 'builder', upline: null },
  { id: '00000000-0000-4000-8000-000000000002', name: 'Devon L.', role: 'agent', upline: '00000000-0000-4000-8000-000000000001' },
  { id: '00000000-0000-4000-8000-000000000003', name: 'Tasha R.', role: 'agent', upline: '00000000-0000-4000-8000-000000000001' },
  { id: '00000000-0000-4000-8000-000000000004', name: 'Marcus J.', role: 'agent', upline: '00000000-0000-4000-8000-000000000001' },
  { id: '00000000-0000-4000-8000-000000000009', name: 'Outside agent', role: 'agent', upline: null }, // not on the team
];

export const LEADER = PEOPLE[0].id;
export const DEVON = PEOPLE[1].id;
export const TASHA = PEOPLE[2].id;
export const MARCUS = PEOPLE[3].id;
export const OUTSIDER = PEOPLE[4].id;

// Small deterministic generator (no Math.random) so tests are stable.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A local Phoenix time (UTC-7, no DST) as an ISO timestamp. */
const phx = (y, m, d, hour) => new Date(Date.UTC(y, m - 1, d, hour + 7, 0, 0)).toISOString();

const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const isWeekday = (y, m, d) => {
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow !== 0 && dow !== 6;
};

/**
 * Build activity rows. Each agent has a daily dial rhythm; dials turn into
 * conversations, appointments, applications and premium at steady rates.
 */
export function buildActivities() {
  const rand = seeded(42);
  const rows = [];
  const plan = [
    { id: LEADER, dials: 22, closeRate: 0.5, premium: 650 },
    { id: DEVON, dials: 18, closeRate: 0.45, premium: 570 },
    { id: TASHA, dials: 16, closeRate: 0.35, premium: 550 },
    { id: MARCUS, dials: 15, closeRate: 0.3, premium: 520 },
  ];

  for (const [y, m] of [[2026, 9], [2026, 10]]) {
    for (let d = 1; d <= daysIn(y, m); d++) {
      if (!isWeekday(y, m, d)) continue;
      for (const p of plan) {
        // The break: Marcus goes quiet Oct 12–18 (third week of October).
        const stalled = p.id === MARCUS && y === 2026 && m === 10 && d >= 12 && d <= 18;
        const dials = stalled ? 0 : p.dials + Math.floor(rand() * 4) - 1;
        for (let i = 0; i < dials; i++) rows.push({ agent_id: p.id, type: 'dial', occurred_at: phx(y, m, d, 9 + (i % 8)) });
        const convos = Math.floor(dials / 4);
        for (let i = 0; i < convos; i++) rows.push({ agent_id: p.id, type: 'conversation', occurred_at: phx(y, m, d, 10 + (i % 6)) });
        if (!stalled) rows.push({ agent_id: p.id, type: 'post', occurred_at: phx(y, m, d, 8) });
        // Roughly one appointment every other day from steady dialing.
        if (convos >= 3 && rand() < 0.55) {
          rows.push({ agent_id: p.id, type: 'appt_set', occurred_at: phx(y, m, d, 15) });
          if (rand() < p.closeRate * 1.6) {
            rows.push({ agent_id: p.id, type: 'appt_held', occurred_at: phx(y, m, d, 16) });
            rows.push({ agent_id: p.id, type: 'app_written', value: p.premium, occurred_at: phx(y, m, d, 17) });
          }
        }
      }
    }
  }
  // A late-evening call: 9 PM Phoenix on Oct 30 is Oct 31 in UTC.
  // It must count on Oct 30 in Phoenix.
  rows.push({ agent_id: DEVON, type: 'dial', occurred_at: phx(2026, 10, 30, 21) });
  // An outsider's activity that must never show up in Morgan's totals.
  rows.push({ agent_id: OUTSIDER, type: 'app_written', value: 9999, occurred_at: phx(2026, 10, 14, 12) });
  return rows;
}

export const TEAM_IDS = [LEADER, DEVON, TASHA, MARCUS];

/**
 * Demo mode: a fictional leader (Morgan) with two months of logged activity
 * and a set contract level. The demo runs the exact same engine as the real
 * system; only the data is made up, and it is labeled that way everywhere.
 */
export const DEMO = Object.freeze({
  leaderName: 'Morgan',
  leaderId: LEADER,
  contractPercent: 80,
  activityFrom: '2026-09-01',
  activityTo: '2026-10-30',
});
