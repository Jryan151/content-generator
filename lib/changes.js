// lib/changes.js — numbered data changes. Every change an update makes to stored data is a numbered step
// here, run once, in order, when the server starts (and first on a copy of the data by update.sh, which
// starts the new version on a spare port before switching: section AO). What ran, when, and what it did
// is recorded in data/changes.json: for the whole server, and for each workspace a step touches.
//
// Rules for a step:
//   - it can run again safely (a cut-off part-way is finished by the next start);
//   - it never removes what an older version needs (fields are added, not taken away), so going back a
//     version (update.sh --rollback) still works;
//   - it says what it did, in a few words.
// A step that fails is recorded with its error, the steps after it wait, the server still starts, and
// you're alerted; the health check reports it, which stops an update before it goes live.
import path from 'path';
import { DIRS, readJSON, writeJSON } from './paths.js';
import * as store from './store.js';

//
// Version 15 has none: what it changes in stored data either happens by itself later (the yearly
// archive, in the nightly cleanup) or when you choose (`node admin.js rotate-key --reseal` moves secrets
// sealed the old way onto the versioned key). Nothing that version 14 couldn't read is written while
// the update is still being checked, so an update that goes back to 14 finds its data as it left it.
export const CHANGES = [];
const FILE = () => path.join(DIRS.data, 'changes.json');
export const record = () => { const r = readJSON(FILE(), null); return { applied: {}, workspaces: {}, failed: null, ...(r || {}) }; };
export const latest = () => CHANGES.at(-1)?.n || 0;
// Steps not yet run here.
export const pending = (r = record()) => CHANGES.filter(c => !r.applied[c.n]);
export let problem = '';

export async function runChanges({ log = console.log, now = Date.now() } = {}) {
  const r = record(), ran = [];
  problem = '';
  for (const c of CHANGES) {
    if (r.applied[c.n]) continue;
    try {
      let result;
      if (c.scope === 'workspace') {
        // One workspace that can't be changed (a damaged file) is recorded and skipped, not a reason to
        // stop every later update; you're told which.
        const done = { count: 0, results: {}, skipped: {} };
        let since = Date.now(), n = 0;
        for (const ws of store.listWorkspaces()) {
          const mine = (r.workspaces[ws.id] ||= {});
          if (mine[c.n]) continue;
          try {
            const out = await c.run(ws);
            mine[c.n] = new Date(now).toISOString();
            done.count++;
            if (out && Object.values(out).some(Boolean)) done.results[ws.id] = out;
          } catch (e) { done.skipped[ws.id] = String(e.message || e).slice(0, 160); }
          // Saved every 50 workspaces or 2 seconds (so a cut-off resumes near where it was, without a
          // write per workspace on a big server).
          if (++n % 50 === 0 || Date.now() - since > 2000) { writeJSON(FILE(), r); since = Date.now(); }
        }
        result = done;
        if (Object.keys(done.skipped).length) log(`[changes] ${c.n}. ${c.name}: skipped ${Object.keys(done.skipped).length} workspace(s): ${JSON.stringify(done.skipped).slice(0, 300)}`);
      } else result = await c.run();
      r.applied[c.n] = { at: new Date(now).toISOString(), name: c.name, result: result ?? null };
      r.failed = null;
      writeJSON(FILE(), r);
      ran.push(c.n);
      log(`[changes] ${c.n}. ${c.name}: done`);
    } catch (e) {
      r.failed = { n: c.n, name: c.name, at: new Date(now).toISOString(), error: String(e.message || e).slice(0, 300) };
      writeJSON(FILE(), r);
      problem = `Data change ${c.n} (${c.name}) failed: ${r.failed.error}`;
      log(`[changes] ${problem}`);
      break;   // later steps may depend on this one
    }
  }
  return { ran, failed: r.failed, latest: latest() };
}
