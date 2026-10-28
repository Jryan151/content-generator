// lib/inspect.js — the nightly inspection: every saved document is read (a damaged one is repaired then,
// lib/paths.js), and the links between records and files are checked. What's safe to fix is fixed;
// the rest comes to you as one alert. Like a full inspection at every service, not only when a light
// comes on.
//
//   Fixed automatically (each is listed in the report):
//     - video files and covers left behind by a crash or a deleted video (no record has their id), a day old or more
//     - folders of videos and fixes for workspaces that no longer exist
//     - a video record whose file is gone (approved or posted): marked as "file removed", as the cleanup would
//     - a login's membership in a workspace that no longer exists
//     - videos in line for a workspace that no longer exists: canceled
//   Reported (needs a person):
//     - a video waiting for review whose file is gone
//     - a login that belongs to no workspace at all
//     - more assistants than seats (the newest are paused until there's a seat)
//     - handoffs about a client or video that no longer exists
//     - with SQLite: the database's own integrity check
//   node admin.js inspect   runs it now and prints the report.
import fs from 'fs';
import path from 'path';
import { DIRS, readJSON, storageEngine, openDb, DB_FILE, jsonExists } from './paths.js';
import { cancelWhere } from './queue.js';
import { seatsFor } from './billing.js';
import * as store from './store.js';
import * as keepsakes from './keepsakes.js';
import { membershipsOf } from './roles.js';
import { jsonDocuments } from './storage.js';

const DAY = 86400000;
const ID_RE = /^(?:video|cover)_(\d{8}T\d{6}-[0-9a-f]{6})(?:_[\w-]+)?\.(?:mp4|jpg)$/;

// Reads every document once. A damaged one is repaired on the spot (and alerted) by readJSON; one
// that can't be repaired is listed.
function readEverything() {
  const out = { read: 0, unreadable: [] };
  if (storageEngine() === 'sqlite') {
    const d = openDb(DB_FILE);
    const keys = d.prepare('SELECT key FROM docs').all().map(r => r.key);
    d.close();
    for (const k of keys) { try { readJSON(path.join(DIRS.data, ...k.split('/')), null); out.read++; } catch (e) { out.unreadable.push(k); } }
  } else {
    for (const { file, key } of jsonDocuments()) { try { readJSON(file, null); out.read++; } catch { out.unreadable.push(key); } }
  }
  return out;
}

// The database checks itself (SQLite only): 'ok', or what it found.
export function dbCheck() {
  if (storageEngine() !== 'sqlite' || !fs.existsSync(DB_FILE)) return 'ok';
  const d = openDb(DB_FILE);
  try { const rows = d.prepare('PRAGMA quick_check').all().map(r => Object.values(r)[0]); return rows.length === 1 && rows[0] === 'ok' ? 'ok' : rows.slice(0, 5).join('; '); }
  finally { d.close(); }
}

export function inspect({ now = Date.now(), fix = true } = {}) {
  const fixed = [], problems = [];
  const docs = readEverything();
  docs.unreadable.forEach(k => problems.push(`${k} is damaged and has no good copy (see SETUP.md section AK).`));
  const db = dbCheck();
  if (db !== 'ok') problems.push(`The database's own check found: ${db}. Restore from last night's backup (SETUP.md section I).`);

  const workspaces = store.listWorkspaces(), listed = new Set(workspaces.map(w => w.id));
  // A workspace counts as existing if it's listed, or its folder or record is there at all (one whose
  // record couldn't be read is still somebody's workspace: nothing of it is removed or unlinked).
  const exists = id => listed.has(id) || (store.validWs(id) && (fs.existsSync(path.join(DIRS.workspaces, id)) || jsonExists(path.join(DIRS.workspaces, id, 'workspace.json'))));
  const ids = { has: exists };
  // Folders under videos/ and assets/ for workspaces that are gone.
  for (const base of [DIRS.videos, DIRS.assets]) {
    if (!fs.existsSync(base)) continue;
    for (const n of fs.readdirSync(base)) {
      if (!store.validWs(n) || ids.has(n)) continue;
      if (fix) fs.rmSync(path.join(base, n), { recursive: true, force: true });
      fixed.push(`Removed ${path.basename(base)}/${n}/ (its workspace was deleted).`);
    }
  }
  for (const ws of workspaces) {
    let videos;
    try { videos = store.readVideos(ws.id); } catch { continue; }   // listed above as unreadable
    const known = new Set([...videos.map(v => v.id), ...keepsakes.ids(ws.id)]);   // (v15: a keepsake's file is known too)
    // Files no record knows (a crash between rendering and saving, or a video deleted mid-way).
    const dir = path.join(DIRS.videos, ws.id);
    if (fs.existsSync(dir)) {
      for (const n of fs.readdirSync(dir)) {
        const m = ID_RE.exec(n);
        if (!m || known.has(m[1])) continue;
        let old = false;
        try { old = now - fs.statSync(path.join(dir, n)).mtimeMs > DAY; } catch { continue; }
        if (!old) continue;
        if (fix) fs.rmSync(path.join(dir, n), { force: true });
        fixed.push(`Removed ${ws.id}/${n} (no video has it).`);
      }
    }
    // Saved stages for fixes of videos that are gone.
    const adir = path.join(DIRS.assets, ws.id);
    if (fs.existsSync(adir)) {
      for (const n of fs.readdirSync(adir)) {
        if (!/^\d{8}T\d{6}-[0-9a-f]{6}$/.test(n) || known.has(n)) continue;
        try { if (now - fs.statSync(path.join(adir, n)).mtimeMs < DAY) continue; } catch { continue; }   // a video may be being saved right now
        if (fix) fs.rmSync(path.join(adir, n), { recursive: true, force: true });
        fixed.push(`Removed the fix files of a deleted video (${ws.id}/${n}).`);
      }
    }
    // Records whose file is gone.
    for (const v of videos) {
      if (!v.file || v.fileDeleted || v.legacy) continue;
      if (fs.existsSync(path.join(dir, v.file))) continue;
      if (['approved', 'posted'].includes(v.status)) { if (fix) store.updateVideo(ws.id, v.id, { fileDeleted: true }); fixed.push(`Marked ${ws.name}'s video ${v.id} as "file removed" (its file was gone).`); }
      else if (v.status === 'pending') problems.push(`${ws.name}: a video waiting for review (${v.id}) has lost its file. It can be rejected and made again.`);
    }
    // Handoffs about things that are gone.
    try {
      const clients = new Set(readJSON(path.join(store.wsDir(ws.id), 'clients.json'), []).map(c => c.id));
      const stale = readJSON(path.join(store.wsDir(ws.id), 'handoffs.json'), []).filter(h => h.status === 'open' && ((h.clientId && !clients.has(h.clientId)) || (h.videoId && !known.has(h.videoId))));
      if (stale.length) problems.push(`${ws.name}: ${stale.length} open handoff${stale.length === 1 ? ' is' : 's are'} about a client or video that was deleted.`);
    } catch { /* listed above if unreadable */ }
  }
  // Logins and memberships.
  const accounts = store.listAccounts();
  for (const a of accounts) {
    if (a.role === 'admin') continue;
    const mine = membershipsOf(a), gone = mine.filter(m => !ids.has(m.ws));
    // Never while anything couldn't be read: a membership is only removed when it's certain.
    if (gone.length && docs.unreadable.length) continue;
    if (gone.length && fix) {
      const rest = mine.filter(m => ids.has(m.ws));
      store.updateAccount(a.id, { memberships: (a.memberships || []).filter(m => ids.has(m.ws)), workspaceId: ids.has(a.workspaceId) ? a.workspaceId : rest[0]?.ws || null });
    }
    if (gone.length) fixed.push(`Removed ${a.email}'s membership in ${gone.length} deleted workspace${gone.length === 1 ? '' : 's'}.`);
    if (mine.length && mine.length === gone.length) problems.push(`${a.email} no longer belongs to any workspace. Remove the login or invite them again.`);
  }
  // Seats.
  for (const ws of workspaces) {
    const assistants = accounts.filter(a => membershipsOf(a).some(m => m.ws === ws.id && m.role === 'assistant')).length;
    const seats = seatsFor(ws);
    if (assistants > seats) problems.push(`${ws.name} has ${assistants} assistant${assistants === 1 ? '' : 's'} and ${seats} seat${seats === 1 ? '' : 's'}: the newest are paused until there's a seat.`);
  }
  // Videos in line for workspaces that no longer exist.
  const canceled = fix ? cancelWhere(j => !ids.has(j.ws)) : 0;
  if (canceled) fixed.push(`Canceled ${canceled} video${canceled === 1 ? '' : 's'} in line for deleted workspaces.`);
  return { at: new Date(now).toISOString(), documents: docs.read, fixed, problems };
}
