// lib/offsite.js — encrypted off-site copies of the nightly backup.
// The backup archive (data/: accounts, workspaces, settings, approval records) is encrypted with
// AES-256-GCM and uploaded to S3-compatible storage: Backblaze B2, Cloudflare R2, Wasabi, AWS S3,
// DigitalOcean Spaces… Requests are signed with AWS Signature V4 by hand (no SDK).
//
//   .env: BACKUP_KEY=…                 (required: 64 hex characters or a long passphrase; keep a copy!)
//         BACKUP_S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
//         BACKUP_S3_BUCKET=my-agent-reels-backups
//         BACKUP_S3_REGION=us-west-004 (R2: auto; AWS: the bucket's region)
//         BACKUP_S3_ACCESS_KEY=…  BACKUP_S3_SECRET_KEY=…
//         BACKUP_S3_PREFIX=agent-reels/   BACKUP_S3_KEEP_DAYS=30
//
// Encrypted file layout: "ARB1" | salt (16) | iv (12) | ciphertext | auth tag (16).
// The key never goes into data/, the backups or the bucket. Without it a backup can't be read,
// by anyone, including you: keep BACKUP_KEY in your password manager.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { spawnSync } from 'child_process';
import { pipeline } from 'stream/promises';

const MAGIC = Buffer.from('ARB1');
const HEAD = MAGIC.length + 16 + 12, TAG = 16;
const env = process.env;

/* ---------------- Settings ---------------- */
export function offsiteConfig() {
  const c = {
    key: String(env.BACKUP_KEY || ''), endpoint: String(env.BACKUP_S3_ENDPOINT || '').trim().replace(/\/$/, ''),
    bucket: String(env.BACKUP_S3_BUCKET || '').trim(), region: String(env.BACKUP_S3_REGION || 'us-east-1').trim(),
    accessKey: String(env.BACKUP_S3_ACCESS_KEY || '').trim(), secretKey: String(env.BACKUP_S3_SECRET_KEY || '').trim(),
    prefix: String(env.BACKUP_S3_PREFIX ?? 'agent-reels/').trim().replace(/^\/+/, ''),
    keepDays: Math.max(1, Number(env.BACKUP_S3_KEEP_DAYS) || 30),
  };
  c.keyOk = keyProblem(c.key) === '';
  // https only, except storage on this same machine (for example MinIO on localhost).
  const goodEndpoint = /^https:\/\/[^\s/]+$/.test(c.endpoint) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(c.endpoint);
  c.on = c.keyOk && goodEndpoint && !!c.bucket && !!c.accessKey && !!c.secretKey;
  return c;
}
export const offsiteOn = () => offsiteConfig().on;
export function keyProblem(k = env.BACKUP_KEY) {
  const s = String(k || '');
  if (!s) return 'BACKUP_KEY isn’t set.';
  if (/^[0-9a-f]{64}$/i.test(s)) return '';
  if (s.length < 20) return 'BACKUP_KEY is too short: use 64 hex characters (openssl rand -hex 32) or a passphrase of 20+ characters.';
  return '';
}
// A 64-hex key is used as is; a passphrase is stretched with scrypt and a per-file salt.
const fileKey = (k, salt) => (/^[0-9a-f]{64}$/i.test(k) ? crypto.createHmac('sha256', Buffer.from(k, 'hex')).update(salt).digest() : crypto.scryptSync(k, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }));

/* ---------------- Encryption ---------------- */
export async function encryptFile(src, dst, key = env.BACKUP_KEY) {
  const p = keyProblem(key); if (p) throw new Error(p);
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', fileKey(key, salt), iv);
  const out = fs.createWriteStream(dst, { mode: 0o600 });
  out.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(fs.createReadStream(src), c, out, { end: false }).catch(e => { out.destroy(); throw e; });
  await new Promise((res, rej) => out.end(c.getAuthTag(), e => (e ? rej(e) : res())));
  return dst;
}
// Throws "wrong key or damaged file" if the tag doesn't match; nothing partial is left behind.
export async function decryptFile(src, dst, key = env.BACKUP_KEY) {
  const size = fs.statSync(src).size;
  if (size < HEAD + TAG) throw new Error('That isn’t an encrypted backup (too small).');
  const fd = fs.openSync(src, 'r');
  const head = Buffer.alloc(HEAD), tag = Buffer.alloc(TAG);
  try { fs.readSync(fd, head, 0, HEAD, 0); fs.readSync(fd, tag, 0, TAG, size - TAG); } finally { fs.closeSync(fd); }
  if (!head.subarray(0, 4).equals(MAGIC)) throw new Error('That isn’t an encrypted backup from this app.');
  const d = crypto.createDecipheriv('aes-256-gcm', fileKey(String(key || ''), head.subarray(4, 20)), head.subarray(20, 32));
  d.setAuthTag(tag);
  const tmp = dst + '.part';
  try {
    await pipeline(fs.createReadStream(src, { start: HEAD, end: size - TAG - 1 }), d, fs.createWriteStream(tmp, { mode: 0o600 }));
    fs.renameSync(tmp, dst);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new Error(/auth|Unsupported state/i.test(e.message) ? 'Wrong BACKUP_KEY, or the backup file is damaged.' : e.message);
  }
  return dst;
}

/* ---------------- AWS Signature V4 ---------------- */
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
// Returns the headers to send (including Authorization). `path` is already URI-encoded per segment.
export function signV4({ method, host, path: p = '/', query = {}, headers = {}, payloadHash, region, service = 's3', accessKey, secretKey, now = new Date() }) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''), day = amzDate.slice(0, 8);
  const all = { host, 'x-amz-date': amzDate, ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')])) };
  const names = Object.keys(all).sort();
  const canonQuery = Object.keys(query).sort().map(k => `${enc(k)}=${enc(query[k])}`).join('&');
  const canon = [method, p, canonQuery, names.map(n => `${n}:${all[n]}\n`).join(''), names.join(';'), payloadHash ?? sha256('')].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canon)].join('\n');
  const kSign = hmac(hmac(hmac(hmac('AWS4' + secretKey, day), region), service), 'aws4_request');
  const sig = crypto.createHmac('sha256', kSign).update(toSign).digest('hex');
  return { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}` };
}

/* ---------------- S3 requests (path-style: endpoint/bucket/key) ---------------- */
async function s3(method, key = '', { body = null, query = {}, c = offsiteConfig(), timeout = 120000 } = {}) {
  const u = new URL(c.endpoint);
  const p = '/' + [c.bucket, ...key.split('/')].filter(Boolean).map(enc).join('/');
  const payload = body || Buffer.alloc(0), payloadHash = sha256(payload);
  const headers = signV4({ method, host: u.host, path: p, query, headers: { 'x-amz-content-sha256': payloadHash, ...(body ? { 'content-type': 'application/octet-stream' } : {}) }, payloadHash, region: c.region, accessKey: c.accessKey, secretKey: c.secretKey });
  delete headers.host;
  const qs = Object.keys(query).length ? '?' + Object.keys(query).sort().map(k => `${enc(k)}=${enc(query[k])}`).join('&') : '';
  const res = await fetch(`${u.origin}${p}${qs}`, { method, headers, body: body || undefined, signal: AbortSignal.timeout(timeout) });
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    const msg = /<Message>([^<]*)<\/Message>/.exec(buf.toString('utf8'))?.[1] || /<Code>([^<]*)<\/Code>/.exec(buf.toString('utf8'))?.[1] || '';
    throw new Error(`Off-site storage answered ${res.status}${msg ? `: ${msg}` : ''}.`);
  }
  return buf;
}
const xmlAll = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map(m => m[1]);
const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export async function listBackups(c = offsiteConfig()) {
  const out = [];
  let token = '';
  for (let page = 0; page < 20; page++) {
    const xml = (await s3('GET', '', { c, query: { 'list-type': '2', prefix: c.prefix, ...(token ? { 'continuation-token': token } : {}) } })).toString('utf8');
    for (const item of xmlAll(xml, 'Contents')) out.push({ key: unxml(xmlAll(item, 'Key')[0] || ''), modified: xmlAll(item, 'LastModified')[0] || '', size: Number(xmlAll(item, 'Size')[0] || 0) });
    token = unxml(xmlAll(xml, 'NextContinuationToken')[0] || '');
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml) || !token) break;
  }
  return out.filter(o => /\.tar\.gz\.enc$/.test(o.key)).sort((a, b) => b.key.localeCompare(a.key));
}

// Encrypts a local backup, uploads it, then removes copies older than BACKUP_S3_KEEP_DAYS
// (always keeping the newest 3). Returns { key, bytes, removed }.
export async function upload(localFile, { c = offsiteConfig(), now = Date.now() } = {}) {
  if (!c.on) throw new Error('Off-site backups aren’t set up.');
  const encFile = localFile + '.enc';
  await encryptFile(localFile, encFile, c.key);
  try {
    const body = fs.readFileSync(encFile);
    const key = c.prefix + path.basename(encFile);
    await s3('PUT', key, { body, c });
    let removed = 0;
    try {
      const list = await listBackups(c);
      for (const o of list.slice(3)) {
        if (o.modified && now - Date.parse(o.modified) > c.keepDays * 86400000) { await s3('DELETE', o.key, { c }); removed++; }
      }
    } catch (e) { console.error('[offsite] retention:', e.message); }   // an upload that worked still counts
    return { key, bytes: body.length, removed };
  } finally { fs.rmSync(encFile, { force: true }); }
}

export async function download(key, dst, c = offsiteConfig()) {
  fs.writeFileSync(dst, await s3('GET', key, { c, timeout: 300000 }), { mode: 0o600 });
  return dst;
}

/* ---------------- Restore test ---------------- */
const readJSONFile = f => JSON.parse(fs.readFileSync(f, 'utf8'));
// A backup holds either JSON files or a SQLite snapshot (app-snapshot.db); read documents from either.
async function documents(dir) {
  const snap = path.join(dir, 'app-snapshot.db');
  if (!fs.existsSync(snap)) return { get: key => (fs.existsSync(path.join(dir, key)) ? readJSONFile(path.join(dir, key)) : undefined), ids: () => (fs.existsSync(path.join(dir, 'workspaces')) ? fs.readdirSync(path.join(dir, 'workspaces')) : []), close: () => {} };
  const { openDb } = await import('./paths.js');
  const d = openDb(snap);
  const row = d.prepare('SELECT body FROM docs WHERE key = ?');
  return {
    get: key => { const r = row.get(key); return r ? JSON.parse(r.body) : undefined; },
    ids: () => d.prepare("SELECT key FROM docs WHERE key LIKE 'workspaces/%/workspace.json'").all().map(r => r.key.split('/')[1]),
    close: () => d.close(),
  };
}
// Unpacks a backup archive (.tar.gz, or .tar.gz.enc with BACKUP_KEY) into a temp folder and checks
// it holds a usable copy of the app's data. Never touches the live data/. Returns a report; throws
// with a plain reason if the backup can't be read.
export async function verifyArchive(file, { key = env.BACKUP_KEY } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-test-'));
  try {
    let tgz = file;
    if (/\.enc$/.test(file)) { tgz = path.join(tmp, 'backup.tar.gz'); await decryptFile(file, tgz, key); }
    const dir = path.join(tmp, 'data');
    fs.mkdirSync(dir);
    const t = spawnSync('tar', ['-xzf', tgz, '-C', dir], { encoding: 'utf8' });
    if (t.status !== 0) throw new Error('The archive couldn’t be unpacked: ' + String(t.stderr).slice(-200));
    const docs = await documents(dir);
    try {
      const accounts = docs.get('accounts.json');
      if (!Array.isArray(accounts)) throw new Error('The backup has no list of logins (accounts.json).');
      const ids = docs.ids().filter(n => /^w[0-9a-f]{12}$/.test(n));
      let videos = 0, approved = 0;
      for (const id of ids) {
        if (!docs.get(`workspaces/${id}/workspace.json`)) throw new Error(`Workspace ${id} has no workspace.json.`);
        if (!docs.get(`workspaces/${id}/config.json`)) throw new Error(`Workspace ${id} has no settings (config.json).`);
        // Its videos: the current list and each year of the archive (lib/store.js).
        const years = Object.keys(docs.get(`workspaces/${id}/videos-archive.json`)?.years || {});
        for (const name of ['videos.json', ...years.map(y => `videos-${y}.json`)]) {
          const v = docs.get(`workspaces/${id}/${name}`) || [];
          videos += v.length; approved += v.filter(x => x.approval).length;
        }
      }
      return { ok: true, file: path.basename(file), storage: fs.existsSync(path.join(dir, 'app-snapshot.db')) ? 'sqlite' : 'json', accounts: accounts.length, admins: accounts.filter(a => a.role === 'admin').length, workspaces: ids.length, videos, approved, bytes: fs.statSync(file).size };
    } finally { docs.close(); }
  } catch (e) {
    throw new Error(e instanceof SyntaxError ? `A file in the backup isn’t valid JSON (${e.message}).` : e.message);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
// The newest off-site backup, downloaded and checked. Used weekly by the scheduler and by
// `node admin.js restore-test`.
export async function restoreTest(c = offsiteConfig()) {
  if (!c.on) throw new Error('Off-site backups aren’t set up.');
  const newest = (await listBackups(c))[0];
  if (!newest) throw new Error('There are no off-site backups yet.');
  const tmp = path.join(os.tmpdir(), `restore-${crypto.randomBytes(4).toString('hex')}.tar.gz.enc`);
  try { await download(newest.key, tmp, c); return { ...(await verifyArchive(tmp, { key: c.key })), key: newest.key, modified: newest.modified }; }
  finally { fs.rmSync(tmp, { force: true }); }
}
