// lib/away.js — is the agent away today? (v15 Phase 8: Away mode). Kept apart, with no imports, so push,
// email, the scheduler and today's greeting can all ask without importing each other.
//
// workspace.away = { from, until, since, by, byName, ... }: `from` and `until` are the agent's local dates
// (until = the last day away; they're back the day after). `endedAt` is set when they come back early.

// Away on this local date (YYYY-MM-DD)?
export const awayOn = (ws, date) => !!ws?.away && !ws.away.endedAt && !!date && date >= ws.away.from && date <= ws.away.until;
// Away is over (they came back early, or the last day has passed) but the welcome back hasn't been seen.
export const backFrom = (ws, date) => !!ws?.away && (!!ws.away.endedAt || (!!date && date > ws.away.until));
