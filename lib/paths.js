// lib/paths.js — where everything lives, plus safe JSON file helpers.
// Every other module gets its folders from here, so tests can point DATA_DIR somewhere else.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { fault } from './faults.js';

// ROOT: where this version's code is. HOME: where the app lives (data, videos, .env, .app-key). They're
// the same folder, unless this code is one of side-by-side releases (releases/<version>/, SETUP.md
// section AO): then home is two levels up, shared by every release.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOME = path.basename(path.dirname(ROOT)) === 'releases' ? path.dirname(path.dirname(ROOT)) : ROOT;
// The checks (npm test) never read your real .env, so its keys and settings can't change their results.
if (process.env.NODE_ENV !== 'test' && !process.env.NO_DOTENV) { try { process.loadEnvFile(path.join(HOME, '.env')); } catch { /* no .env: use the shell's environment */ } }

const dir = (env, fallback) => (process.env[env] ? path.resolve(process.env[env]) : fallback);
const DATA = dir('DATA_DIR', path.join(HOME, 'data'));
export const DIRS = {
  data: DATA,
  workspaces: path.join(DATA, 'workspaces'),
  cache: path.join(DATA, 'cache'),
  assets: path.join(DATA, 'assets'),
  work: path.join(DATA, 'work'),
  videos: dir('VIDEOS_DIR', path.join(HOME, 'videos')),
  backups: dir('BACKUP_DIR', path.join(HOME, 'backups')),
  music: dir('MUSIC_DIR', path.join(HOME, 'music')),
  fonts: dir('FONT_DIR', path.join(HOME, 'fonts')),
};
// Run as root (an admin.js command, say) on a server where the app runs as its own user (SETUP.md
// section U)? Act as that user, so nothing here creates files the app can't read or write later.
if (process.getuid?.() === 0 && !process.env.KEEP_ROOT) {
  try { const st = fs.statSync(DATA); if (st.uid !== 0) { process.setgid(st.gid); process.setuid(st.uid); } } catch { /* no data/ yet: a fresh install */ }
}
Object.values(DIRS).forEach(d => fs.mkdirSync(d, { recursive: true }));

export const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
export const PRODUCT_NAME = process.env.PRODUCT_NAME || 'Agent Reels';

/* ---------------- Storage: JSON files, or one SQLite database ---------------- */
// Every module reads and writes its data through readJSON / writeJSON / updateJSON, so the storage
// engine can change without touching them. Two engines:
//   json   (default)  one file per document under data/, written atomically (temp file + rename)
//   sqlite            data/app.db (Node's built-in node:sqlite): each document is a row, and
//                     updateJSON runs in a transaction, so the server and `node admin.js` can never
//                     overwrite each other's changes. Switch with `node admin.js storage migrate`.
// Only data/*.json documents move into the database; caches, work folders, video assets, logos,
// settings history and the activity log stay as files either way.
const ENGINE_FILE = path.join(DATA, 'storage-engine');
export const DB_FILE = path.join(DATA, 'app.db');
export const SNAPSHOT_FILE = path.join(DATA, 'app-snapshot.db');   // the database's copy inside a backup
export function storageEngine() {
  const forced = process.env.STORAGE_ENGINE;   // tests only
  if (forced === 'sqlite' || forced === 'json') return forced;
  try { return fs.readFileSync(ENGINE_FILE, 'utf8').trim() === 'sqlite' ? 'sqlite' : 'json'; } catch { /* not chosen yet */ }
  // v15: a fresh install (no data yet) starts on SQLite, the standard, when this Node has it.
  if (process.env.NODE_ENV !== 'test' && !process.env.STAY_ON_JSON && freshInstall() && hasSqlite()) { try { fs.writeFileSync(ENGINE_FILE, 'sqlite\n'); return 'sqlite'; } catch { /* read-only: stay on files */ } }
  return 'json';
}
// Fresh: no saved document at all (a single-agent install from before workspaces has data/*.json).
const freshInstall = () => !fs.readdirSync(DATA).some(n => n.endsWith('.json')) && !fs.readdirSync(path.join(DATA, 'workspaces')).length;
// Can this Node load its built-in SQLite without flags? (22.5–22.12 need --experimental-sqlite.)
export function hasSqlite() { try { loadSqlite(); return true; } catch { return false; } }
function loadSqlite() {
  // node:sqlite prints an "experimental" warning on Node 22; it's stable for what this app uses.
  const warn = process.emitWarning;
  process.emitWarning = (w, ...a) => (/SQLite/.test(String(w?.message || w)) ? undefined : warn.call(process, w, ...a));
  try { return createRequire(import.meta.url)('node:sqlite'); } finally { process.emitWarning = warn; }
}
export const setStorageEngine = e => fs.writeFileSync(ENGINE_FILE, e + '\n');
const ENGINE = storageEngine();
// Golden-set runs (lib/golden.js) are working files you download, not documents: they stay plain files.
// data/damaged/ holds copies of files that couldn't be read (see "Damaged files" below).
export const DAMAGED_DIR = path.join(DATA, 'damaged');
const SKIP = [DIRS.cache, DIRS.work, DIRS.assets, path.join(DIRS.data, 'golden'), DAMAGED_DIR].map(d => d + path.sep);
// The key for a document in the database ('accounts.json', 'workspaces/w…/videos.json'), or null
// when the file isn't a document (outside data/, not .json, or in a folder that stays as files).
export function docKey(file) {
  const f = path.resolve(file);
  if (!f.startsWith(DATA + path.sep) || !f.endsWith('.json') || SKIP.some(d => f.startsWith(d))) return null;
  const rel = path.relative(DATA, f).split(path.sep);
  if (rel.includes('history')) return null;
  return rel.join('/');
}

let db = null, depth = 0;
export function openDb(file = DB_FILE) {
  let DatabaseSync;
  try { ({ DatabaseSync } = loadSqlite()); }
  catch { throw new Error('This server’s Node can’t load its built-in SQLite (it needs Node 22.13 or newer). Update Node, or switch back: node admin.js storage rollback'); }
  const d = new DatabaseSync(file);
  d.exec('PRAGMA busy_timeout=10000');   // first: wait (up to 10s) for another process's write instead of failing
  // synchronous=FULL: a save is on the disk before it's reported done, so a power cut can't lose it.
  d.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
  d.exec('CREATE TABLE IF NOT EXISTS docs (key TEXT PRIMARY KEY, body TEXT NOT NULL, ver INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, prev TEXT)');
  // Databases from before v15 get the `prev` column (each document's previous save, for repairs).
  if (!d.prepare('PRAGMA table_info(docs)').all().some(c => c.name === 'prev')) d.exec('ALTER TABLE docs ADD COLUMN prev TEXT');
  return d;
}
// A backup restored into data/ carries the database as app-snapshot.db: it becomes app.db.
const DB = () => {
  if (!db && !fs.existsSync(DB_FILE) && fs.existsSync(SNAPSHOT_FILE)) fs.renameSync(SNAPSHOT_FILE, DB_FILE);
  return (db ||= openDb());
};
const q = {};
const stmt = (name, sql) => (q[name] ||= DB().prepare(sql));
const dbRead = key => stmt('get', 'SELECT body FROM docs WHERE key = ?').get(key)?.body;
// Each save keeps the document's previous save in `prev` (for repairs, see below).
const diskFull = where => Object.assign(new Error(`ENOSPC: no space left on device, write '${where}'`), { code: 'ENOSPC', diskFull: true });
const dbWrite = (key, data) => { if (fault('enospc', key)) throw diskFull(key); return dbPut(key, data); };
const dbPut = (key, data) => stmt('put', 'INSERT INTO docs (key, body, ver, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET prev = docs.body, body = excluded.body, ver = docs.ver + 1, updated_at = excluded.updated_at').run(key, JSON.stringify(data), new Date().toISOString());
const useDb = file => ENGINE === 'sqlite' && docKey(file);

/* ---------------- Damaged files ---------------- */
// A document that can't be read (a hand edit gone wrong, a disk fault, a power cut at the wrong moment)
// is never treated as empty: the next save would write over it and lose everything in it (every login,
// or an agent's approval records). Instead:
//   1. a copy of it goes to data/damaged/ (kept, never deleted by the app);
//   2. it's repaired from its previous save (every save keeps one: <file>.prev, or `prev` in SQLite),
//      or else from the newest nightly or pre-update backup that has a good copy;
//   3. you're alerted (onDamage, set by the server), with what was restored and from where.
// If there's no good copy anywhere, reading it throws DamagedError (shown as "try again shortly") and
// nothing is ever written over it until you restore it by hand (SETUP.md section AK).
// Caches, work folders and video assets are disposable: for those a damaged file still reads as empty.
export class DamagedError extends Error {
  constructor(rel) {
    super('Some saved data couldn’t be read, so nothing was changed. The admin has been alerted and will restore it.');
    this.status = 503; this.damaged = true; this.file = rel;
  }
}
let damageHook = null, reporting = false;
export const onDamage = fn => { damageHook = fn; };
// Damage that couldn't be repaired, by document and content: the same damaged content is reported once,
// then refused at once (no new copy, no backup search, no alert) until it changes.
const unrepaired = new Map();
const hashOf = text => crypto.createHash('sha1').update(String(text ?? '')).digest('hex');
function refuseKnown(rel, text) {
  if (unrepaired.get(rel) === hashOf(text)) throw new DamagedError(rel);
}
const stampNow = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
function reportDamage(info) {
  if (process.env.NODE_ENV !== 'test') console.error(`[damaged] ${info.file}: ${info.restored ? `repaired from ${info.restored}` : 'NO good copy found'}; the damaged copy is in ${info.kept}`);
  if (!damageHook) return;
  const fire = () => {
    if (reporting) return;
    reporting = true;
    try { damageHook(info); } catch { /* an alert that can't be saved must not hide the repair */ } finally { reporting = false; }
  };
  // Inside a database transaction the alert would be rolled back with it: send it once that's over.
  if (depth > 0) queueMicrotask(fire); else fire();
}
function quarantine(rel, text) {
  const out = path.join(DAMAGED_DIR, `${rel.replace(/[\\/]/g, '__')}.${stampNow()}.${crypto.randomBytes(2).toString('hex')}.txt`);
  try { fs.mkdirSync(DAMAGED_DIR, { recursive: true }); fs.writeFileSync(out, text ?? '', { mode: 0o600 }); } catch { /* keep going: the repair matters more */ }
  return path.relative(DATA, out);
}
const parse = text => { try { if (typeof text !== 'string' || !text.trim()) return { ok: false }; return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false }; } };
// Backups to repair from, newest first: nightly (data-YYYY-MM-DD.tar.gz) and pre-update archives.
function backupArchives() {
  try {
    return fs.readdirSync(DIRS.backups).filter(n => /^(data-\d{4}-\d{2}-\d{2}|pre-update-[\w-]+)\.tar\.gz$/.test(n))
      .map(n => ({ n, t: fs.statSync(path.join(DIRS.backups, n)).mtimeMs })).sort((a, b) => b.t - a.t).slice(0, 4).map(x => path.join(DIRS.backups, x.n));
  } catch { return []; }
}
function fromBackup(archive, rel) {
  const r = spawnSync('tar', ['-xzOf', archive, './' + rel.split(path.sep).join('/')], { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024, timeout: 60000 });
  return r.status === 0 ? r.stdout : null;
}
// Remembers each document's last known-good state, so a save only keeps a previous copy that's good.
const goodSig = new Map();
const sigOf = file => { try { const st = fs.statSync(file); return `${st.ino}:${st.mtimeMs}:${st.size}`; } catch { return null; } };
function writeRaw(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  writeDurable(tmp, text);
  fs.renameSync(tmp, file);
  syncDir(path.dirname(file));
  goodSig.set(file, sigOf(file));
}
// Saves that survive a power cut: the new file's bytes are forced onto the disk before it replaces the
// old one, and the folder is synced after, so the rename itself is on the disk too. (Without this the
// system may hold both in memory for a while, and a power cut can leave an empty file.) DURABLE=off
// turns it off (tests on slow disks).
const durable = () => !/^(off|0|false|no)$/i.test(String(process.env.DURABLE || 'on'));
// writeFileSync on a file descriptor writes every byte or throws (ENOSPC on a full disk); a cut-off
// temp file is deleted and never renamed over a good document.
function writeDurable(file, text) {
  const fd = fs.openSync(file, 'w');
  try { if (fault('enospc', file)) throw diskFull(file); fs.writeFileSync(fd, text); if (durable()) fs.fsyncSync(fd); }
  catch (e) { try { fs.closeSync(fd); } catch {} fs.rmSync(file, { force: true }); throw e; }
  fs.closeSync(fd);
}
function syncDir(dir) {
  if (!durable() || process.platform === 'win32') return;
  let fd;
  try { fd = fs.openSync(dir, 'r'); fs.fsyncSync(fd); } catch { /* some filesystems can't sync a folder; the file itself is synced */ } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}
function repairFile(file, text) {
  const rel = path.relative(DATA, file);
  refuseKnown(rel, text);
  const kept = quarantine(rel, text);
  const prev = (() => { try { return fs.readFileSync(file + '.prev', 'utf8'); } catch { return null; } })();
  const p = parse(prev);
  if (p.ok) { writeRaw(file, prev); reportDamage({ file: rel, kept, restored: 'its previous save (the latest change to it may be missing)' }); return p.value; }
  for (const a of backupArchives()) {
    const t = fromBackup(a, rel), b = parse(t);
    if (b.ok) { writeRaw(file, t); reportDamage({ file: rel, kept, restored: `the backup ${path.basename(a)} (changes since then are missing)` }); return b.value; }
  }
  unrepaired.set(rel, hashOf(text));
  reportDamage({ file: rel, kept, restored: '' });
  throw new DamagedError(rel);
}
function repairRow(key, body) {
  refuseKnown(key, body);
  const kept = quarantine(key, body);
  const row = stmt('prev', 'SELECT prev FROM docs WHERE key = ?').get(key);
  const p = parse(row?.prev);
  if (p.ok) {
    stmt('restore', 'UPDATE docs SET body = prev, ver = ver + 1, updated_at = ? WHERE key = ?').run(new Date().toISOString(), key);
    reportDamage({ file: key, kept, restored: 'its previous save (the latest change to it may be missing)' });
    return p.value;
  }
  unrepaired.set(key, hashOf(body));
  reportDamage({ file: key, kept, restored: '' });
  throw new DamagedError(key);
}

export function readJSON(file, fallback) {
  const key = useDb(file);
  if (key) {
    const b = dbRead(key);
    if (b === undefined) return fallback;
    const p = parse(b);
    return p.ok ? p.value : repairRow(key, b);
  }
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return fallback;
    if (!docKey(file)) return fallback;
    throw Object.assign(new Error(`Couldn’t read saved data (${e.code}).`), { status: 503 });   // unreadable for now (permissions, disk): never treated as empty
  }
  const p = parse(text);
  if (p.ok) { if (docKey(file)) goodSig.set(file, sigOf(file)); return p.value; }
  return docKey(file) ? repairFile(file, text) : fallback;
}
// Write to a temp file, then rename: a crash mid-write never leaves a half-written file. The copy being
// replaced is kept as <file>.prev when it's known to be good.
export function writeJSON(file, data) {
  const key = useDb(file);
  if (key) { dbWrite(key, data); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  const doc = !!docKey(file);
  // Documents are written durably (caches and work files don't need to be).
  try { if (doc) writeDurable(tmp, JSON.stringify(data, null, 2)); else fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); }
  catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  if (doc) keepPrevious(file);
  fs.renameSync(tmp, file);
  if (doc) { syncDir(path.dirname(file)); goodSig.set(file, sigOf(file)); }
}
function keepPrevious(file) {
  const sig = sigOf(file);
  if (!sig) return;   // a new document
  if (goodSig.get(file) !== sig) {
    // Not read or written by this process since it last changed: check it before keeping it.
    let text = null;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
    if (!parse(text).ok) { reportDamage({ file: path.relative(DATA, file), kept: quarantine(path.relative(DATA, file), text), restored: 'a full save that replaced it' }); return; }
  }
  // A real copy, not a hard link: an editor that saves in place (nano, vim) would change both.
  const tmp = `${file}.prev.${process.pid}.tmp`;
  try { fs.copyFileSync(file, tmp, fs.constants.COPYFILE_FICLONE); fs.renameSync(tmp, file + '.prev'); }
  catch { fs.rmSync(tmp, { force: true }); /* the save still goes ahead; the old previous copy stays */ }
}
// Read, change and write back in one step (in one transaction with SQLite).
export function updateJSON(file, fallback, fn) {
  const key = useDb(file);
  if (!key) { const data = readJSON(file, fallback); const out = fn(data) ?? data; writeJSON(file, out); return out; }
  const outer = depth === 0;
  if (outer) DB().exec('BEGIN IMMEDIATE');
  depth++;
  try {
    const data = readJSON(file, fallback);
    const out = fn(data) ?? data;
    dbWrite(key, out);
    depth--;
    if (outer) DB().exec('COMMIT');
    return out;
  } catch (e) {
    depth--;
    if (outer) { try { DB().exec('ROLLBACK'); } catch {} }
    throw e;
  }
}
export function jsonExists(file) {
  const key = useDb(file);
  return key ? dbRead(key) !== undefined : fs.existsSync(file);
}
export function removeJSON(file) {
  const key = useDb(file);
  if (key) stmt('del', 'DELETE FROM docs WHERE key = ?').run(key);
  else { fs.rmSync(file, { force: true }); fs.rmSync(file + '.prev', { force: true }); goodSig.delete(file); }
}
// Removes a folder and, with SQLite, every document stored under it.
export function removeTree(dir) {
  if (ENGINE === 'sqlite') {
    const rel = path.relative(DATA, path.resolve(dir)).split(path.sep).join('/');
    if (rel && !rel.startsWith('..')) stmt('delTree', 'DELETE FROM docs WHERE key LIKE ? ESCAPE \'\\\'').run(rel.replace(/[\\%_]/g, c => '\\' + c) + '/%');
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
// Changes whenever the document is written (for caches keyed on "has this changed?").
export function docVersion(file) {
  const key = useDb(file);
  if (key) { const r = stmt('ver', 'SELECT ver, updated_at FROM docs WHERE key = ?').get(key); return r ? `${r.ver}:${r.updated_at}` : null; }
  try { const st = fs.statSync(file, { bigint: true }); return `${st.ino}:${st.mtimeNs}:${st.ctimeNs}:${st.size}`; } catch { return null; }
}
// A consistent copy of the database (safe while the server is running), for backups.
export function snapshotDb(dest) {
  fs.rmSync(dest, { force: true });
  DB().exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  return dest;
}
export const closeDb = () => { if (db) { db.close(); db = null; for (const k in q) delete q[k]; } };

export const randomId = (prefix, bytes = 6) => prefix + crypto.randomBytes(bytes).toString('hex');
// Video ids sort by time: 20261014T153000-k3x9q
export const newId = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, '') + '-' + crypto.randomBytes(3).toString('hex');
export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

// Local date and hour in a time zone (for overnight jobs).
export function localTime(tz, d = new Date()) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(p => [p.type, p.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
  } catch { return { date: dayKey(d), hour: d.getUTCHours() }; }
}
