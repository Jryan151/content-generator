// lib/storage.js — moving the app's data between JSON files and SQLite (data/app.db), safely.
//   node admin.js storage status
//   node admin.js storage migrate --dry-run   checks every file, changes nothing
//   node admin.js storage migrate             JSON files → SQLite (stop the server first)
//   node admin.js storage rollback            SQLite → JSON files, with everything written since
// Migrating copies every document into the database in one transaction, reads each one back to
// check it matches, and only then moves the JSON files aside (to data/json-before-sqlite-<date>/,
// never deleted) and switches the engine. Any mismatch: the database is removed and nothing changes.
import fs from 'fs';
import path from 'path';
import { DIRS, DB_FILE, docKey, openDb, storageEngine, setStorageEngine, closeDb, hasSqlite } from './paths.js';
const ENGINE_FILE = path.join(DIRS.data, 'storage-engine');

const pidFile = name => path.join(DIRS.data, `${name}.pid`);
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The server (and a separate worker, worker.js) notes its process id while it runs, so data isn't
// moved under it. Returns the first one still running, or 0.
export function serverRunning() {
  const names = ['server', ...fs.readdirSync(DIRS.data).filter(n => /^worker-\d+\.pid$/.test(n)).map(n => n.slice(0, -4))];
  for (const name of names) {
    try { const pid = Number(fs.readFileSync(pidFile(name), 'utf8')); if (!pid || pid === process.pid) continue; process.kill(pid, 0); return pid; } catch { /* not running */ }
  }
  return 0;
}
// `name`: 'server', or 'worker' (each worker process has its own file: worker-<pid>.pid).
export function markRunning(name = 'server') {
  const PID = pidFile(name === 'worker' ? `worker-${process.pid}` : name);
  fs.writeFileSync(PID, String(process.pid));
  process.on('exit', () => { try { if (Number(fs.readFileSync(PID, 'utf8')) === process.pid) fs.rmSync(PID); } catch {} });
}

// Every JSON document under data/ that belongs in the database.
export function jsonDocuments(dir = DIRS.data) {
  const out = [];
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!/^json-before-sqlite-/.test(e.name)) walk(p); }
      else if (docKey(p)) out.push({ file: p, key: docKey(p) });
    }
  };
  walk(dir);
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

// v15: the database is the standard. A server still on JSON files is moved once, by update.sh (with the
// app stopped), unless STAY_ON_JSON=1 or this Node has no SQLite. A fresh install starts on it.
export const sqliteAvailable = () => hasSqlite();
// Only a server that never chose: one moved back with `storage rollback` (its engine file says json) stays.
export const autoMoveNeeded = () => !process.env.STAY_ON_JSON && !fs.existsSync(ENGINE_FILE) && sqliteAvailable() && storageEngine() !== 'sqlite' && jsonDocuments().length > 0;

export function status() {
  const engine = storageEngine();
  const r = { engine, dbFile: DB_FILE, dbBytes: fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE).size : 0, jsonFiles: jsonDocuments().length, saved: fs.readdirSync(DIRS.data).filter(n => /^json-before-sqlite-/.test(n)) };
  if (engine === 'sqlite' && fs.existsSync(DB_FILE)) { const d = openDb(DB_FILE); r.documents = d.prepare('SELECT COUNT(*) n FROM docs').get().n; d.close(); }
  return r;
}

// Reads and parses every file. Throws listing any file that isn't valid JSON.
function readAll(docs) {
  const bad = [], parsed = [];
  let bytes = 0;
  for (const d of docs) {
    const text = fs.readFileSync(d.file, 'utf8');
    bytes += Buffer.byteLength(text);
    try { parsed.push({ ...d, data: JSON.parse(text) }); } catch (e) { bad.push(`${d.key}: ${e.message}`); }
  }
  return { parsed, bad, bytes };
}

export function migrate({ dryRun = false, force = false } = {}) {
  if (storageEngine() === 'sqlite') throw new Error('Already on SQLite. (To go back: node admin.js storage rollback)');
  const pid = serverRunning();
  if (pid && !force) throw new Error(`The server is running (process ${pid}). Stop it first: pm2 stop generator`);
  const docs = jsonDocuments();
  const { parsed, bad, bytes } = readAll(docs);
  const report = { documents: docs.length, bytes, unreadable: bad, dryRun };
  if (bad.length) throw Object.assign(new Error(`${bad.length} file(s) aren’t valid JSON, so nothing was changed:\n  ${bad.join('\n  ')}`), { report });
  if (dryRun) return report;
  if (fs.existsSync(DB_FILE)) {
    if (!force) throw new Error(`${DB_FILE} already exists. Move it aside first (or add --force to replace it).`);
    ['', '-wal', '-shm'].forEach(x => fs.rmSync(DB_FILE + x, { force: true }));
  }
  const d = openDb(DB_FILE);
  try {
    const put = d.prepare('INSERT INTO docs (key, body, ver, updated_at) VALUES (?, ?, 1, ?)');
    const now = new Date().toISOString();
    d.exec('BEGIN IMMEDIATE');
    try { for (const p of parsed) put.run(p.key, JSON.stringify(p.data), now); d.exec('COMMIT'); }
    catch (e) { d.exec('ROLLBACK'); throw e; }
    // Read every document back and compare before anything else changes.
    const get = d.prepare('SELECT body FROM docs WHERE key = ?');
    const wrong = parsed.filter(p => { const r = get.get(p.key); return !r || !same(JSON.parse(r.body), p.data); }).map(p => p.key);
    if (wrong.length || d.prepare('SELECT COUNT(*) n FROM docs').get().n !== parsed.length) throw new Error(`The check after copying didn’t match (${wrong.slice(0, 5).join(', ') || 'document count'}). Nothing was changed.`);
    d.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch (e) {
    d.close(); ['', '-wal', '-shm'].forEach(x => fs.rmSync(DB_FILE + x, { force: true }));
    throw e;
  }
  d.close();
  // The database is complete and checked: switch now, so a failure moving the old files aside below
  // can't leave the app on JSON files with some of them missing.
  setStorageEngine('sqlite');
  const saved = path.join(DIRS.data, `json-before-sqlite-${stamp()}`);
  for (const p of parsed) {
    const to = path.join(saved, p.key);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(p.file, to);
    if (fs.existsSync(p.file + '.prev')) fs.renameSync(p.file + '.prev', to + '.prev');   // its previous save goes with it
  }
  return { ...report, savedTo: saved };
}

export function rollback({ force = false } = {}) {
  if (storageEngine() !== 'sqlite') throw new Error('Already on JSON files.');
  const pid = serverRunning();
  if (pid && !force) throw new Error(`The server is running (process ${pid}). Stop it first: pm2 stop generator`);
  closeDb();
  const d = openDb(DB_FILE);
  const rows = d.prepare('SELECT key, body FROM docs ORDER BY key').all();
  d.close();
  // Write every document back as a file (atomically), then check each one reads back the same.
  for (const r of rows) {
    const file = path.join(DIRS.data, ...r.key.split('/'));
    if (!docKey(file) || docKey(file) !== r.key) throw new Error(`Unexpected document name: ${r.key}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(JSON.parse(r.body), null, 2));
    fs.renameSync(tmp, file);
  }
  const wrong = rows.filter(r => !same(JSON.parse(fs.readFileSync(path.join(DIRS.data, ...r.key.split('/')), 'utf8')), JSON.parse(r.body)));
  if (wrong.length) throw new Error(`Some files didn’t write correctly (${wrong.slice(0, 5).map(r => r.key).join(', ')}). Still on SQLite; nothing was switched.`);
  setStorageEngine('json');
  const kept = `${DB_FILE}.rolled-back-${stamp()}`;
  fs.renameSync(DB_FILE, kept);
  ['-wal', '-shm'].forEach(x => fs.rmSync(DB_FILE + x, { force: true }));
  return { documents: rows.length, keptDatabase: kept };
}
