import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, readBackup, writeBackup, backupAge, emptyStore, STORE_VERSION } from '../src/store.js';
import { logCall } from '../src/calls.js';
import { totalsFor } from '../src/timeframes.js';
import { placeOnLadder } from '../src/career.js';
import { quality } from '../src/quality.js';

test('an old v1 copy is upgraded without losing anything', () => {
  const v1 = { activities: [{ agent_id: 'me', type: 'dial', occurred_at: '2026-10-01T16:00:00Z' }], leads: [{ id: 'a' }], recruits: [], names: [] };
  const s = migrate(v1);
  assert.equal(s.version, STORE_VERSION);
  assert.equal(s.activities.length, 1);
  assert.equal(s.leads.length, 1);
  assert.equal(s.profile.licensed, true); // they were already dialing
});

test('a damaged copy falls back to empty instead of breaking', () => {
  assert.deepEqual(migrate(null), emptyStore());
  assert.deepEqual(migrate({ activities: 'oops' }).activities, []);
});

test('backups round-trip, and bad ones are refused before replacing anything', () => {
  const s = { ...emptyStore(), activities: [{ agent_id: 'me', type: 'dial', occurred_at: '2026-10-01T16:00:00Z' }] };
  const back = readBackup(writeBackup(s, new Date('2026-10-02T00:00:00Z')));
  assert.equal(back.ok, true);
  assert.equal(back.store.activities.length, 1);
  assert.match(back.summary, /1 log entries.*2026-10-02/);
  assert.equal(readBackup('hello').ok, false);
  assert.equal(readBackup('{"app":"other","data":{}}').ok, false);
  assert.equal(readBackup(JSON.stringify({ app: 'agent-reels', data: { version: STORE_VERSION + 1 } })).ok, false);
  assert.match(readBackup(JSON.stringify({ app: 'agent-reels', data: { activities: [{ type: 'dial' }] } })).error, /damaged/);
});

test('backup age counts from the last backup, or the first entry', () => {
  const now = new Date('2026-10-20T00:00:00Z');
  assert.equal(backupAge(emptyStore(), now), null);
  const s = { ...emptyStore(), activities: [{ type: 'dial', occurred_at: '2026-10-10T00:00:00Z' }] };
  assert.equal(backupAge(s, now), 10);
  assert.equal(backupAge({ ...s, lastBackupAt: '2026-10-18T00:00:00Z' }, now), 2);
});

test('three months of heavy daily use stays fast enough for a phone', () => {
  // 90 workdays × 60 calls, every call through the real call chain.
  const acts = [], tz = 'America/Phoenix';
  let leads = [];
  const start = new Date('2026-11-02T00:00:00Z');
  for (let d = 0, n = 0; d < 126; d++) {
    const day = new Date(start.getTime() + d * 86_400_000);
    if ([0, 6].includes(day.getUTCDay())) continue;
    const key = day.toISOString().slice(0, 10);
    for (let i = 0; i < 60; i++, n++) {
      const lead = { id: `L${n}`, agent_id: 'me', name: `P${n}`, stage: 'new' };
      const outcome = ['no_answer', 'no_answer', 'talked', 'not_interested', 'booked'][n % 5];
      const r = logCall(lead, outcome, { agentId: 'me', at: `${key}T${String(16 + (i % 6)).padStart(2, '0')}:00:00Z`, today: key, meetingOn: key });
      acts.push(...r.rows); leads.push(r.lead);
    }
  }
  assert.ok(acts.length > 9_000, `only ${acts.length} rows`);
  const t0 = performance.now();
  totalsFor(acts, { tf: '1D', key: '2027-02-26', tz, agentIds: ['me'] });
  placeOnLadder({ person: { id: 'me', name: 'Me' }, activities: acts, dayKey: '2027-02-26', tz });
  quality({ activities: acts, agentIds: ['me'], dayKey: '2027-02-26' });
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `took ${Math.round(ms)} ms`);
  // And the saved copy stays well under what a phone browser allows (~5 MB).
  const size = writeBackup({ ...emptyStore(), activities: acts, leads }).length;
  assert.ok(size < 4_000_000, `backup is ${Math.round(size / 1e6 * 10) / 10} MB`);
});
