// v15 Phase 5: built for 300,000 miles. The yearly archive, versioned keys, fonts and music checked
// against their checksums, the expiry calendar, numbered data changes, the portal/server handshake and
// the portal's screens each in their own file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import { tempEnv, client } from './helpers.js';

tempEnv();
const paths = await import('../lib/paths.js');
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const alerts = await import('../lib/alerts.js');
const secrets = await import('../lib/secrets.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });
test.after(() => server.close());
const port = server.address().port;
const DAY = 86400000;
const listen = handler => new Promise(r => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r(s)); });
const here = path.dirname(new URL(import.meta.url).pathname);

const ws = store.createWorkspace({ name: 'Old Hand', comped: true });
store.updateWorkspace(ws.id, { onboarded: true });
store.createAccount({ email: 'oldhand@example.com', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('oldhandpass12') });
const login = async () => { const c = client(port); assert.equal((await c.post('/api/login', { email: 'oldhand@example.com', password: 'oldhandpass12' })).status, 200); return c; };

/* ---------------- The yearly archive ---------------- */
test('finished videos over a year old move to their year’s archive; every record is still there', async () => {
  const now = Date.now(), iso = t => new Date(t).toISOString();
  const mk = (id, ageDays, extra = {}) => ({ id, status: 'posted', createdAt: iso(now - ageDays * DAY), updatedAt: iso(now - ageDays * DAY + 3600000), file: `video_${id}.mp4`, fileDeleted: true, approval: { at: iso(now - ageDays * DAY), byName: 'Old Hand', checklist: ['ok'], sha256: 'x' }, posted: { at: iso(now - ageDays * DAY), url: `https://example.com/${id}` }, ...extra });
  const vids = [mk('new1', 10, { fileDeleted: false }), mk('mid1', 200), mk('old1', 400), mk('old2', 800), mk('busy', 500, { autopost: { status: 'unsure' } }), mk('kept', 450, { fileDeleted: false })];
  paths.writeJSON(path.join(store.wsDir(ws.id), 'videos.json'), vids);
  const before = store.videoCounts(ws.id);
  assert.equal(store.archiveOld(ws.id, now), 2);
  assert.deepEqual(store.readVideos(ws.id).map(v => v.id).sort(), ['busy', 'kept', 'mid1', 'new1']);
  assert.deepEqual(store.readAllVideos(ws.id).map(v => v.id).sort(), ['busy', 'kept', 'mid1', 'new1', 'old1', 'old2']);
  assert.equal(store.getVideo(ws.id, 'old2').id, 'old2', 'found in the archive');
  assert.deepEqual(store.videoCounts(ws.id), before, 'all-time counts unchanged');
  assert.equal(store.archiveOld(ws.id, now), 0, 'nothing twice');
  // The approval records, the receipt and the data export still have every year.
  const c = await login();
  const csv = (await c.get('/api/records.csv')).data.toString();
  for (const id of ['old1', 'old2', 'mid1']) assert.ok(csv.includes(id), id);
  assert.equal((await c.get('/api/videos/old2/receipt.html')).status, 200);
  const exp = (await c.get('/api/data/export')).data;
  assert.ok(exp.videos.some(v => v.id === 'old1'));
  // A cut-off between the two writes leaves a copy in both places: it counts once.
  const arc = path.join(store.wsDir(ws.id), `videos-${new Date(now - 400 * DAY).getUTCFullYear()}.json`);
  paths.updateJSON(path.join(store.wsDir(ws.id), 'videos.json'), [], list => [...list, paths.readJSON(arc, []).find(v => v.id === 'old1')]);
  assert.equal(store.readAllVideos(ws.id).filter(v => v.id === 'old1').length, 1);
  assert.equal(store.archiveOld(ws.id, now), 1, 'the next run tidies it');
  assert.equal(paths.readJSON(arc, []).filter(v => v.id === 'old1').length, 1);
});

test('the shared video list can’t be changed by accident (frozen in the checks), and reads are cached', () => {
  const a = store.readVideos(ws.id), b = store.readVideos(ws.id);
  assert.equal(a, b, 'the same list until the file changes');
  assert.throws(() => { a[0].status = 'rejected'; }, TypeError);
  const copy = store.getVideo(ws.id, a[0].id);
  copy.status = 'rejected';   // getVideo gives a copy the caller may change
  assert.notEqual(store.readVideos(ws.id)[0].status, 'rejected');
  store.updateVideo(ws.id, a[0].id, { post: 'changed' });
  assert.notEqual(store.readVideos(ws.id), a, 'a change gives a fresh list');
});

/* ---------------- Versioned keys ---------------- */
test('sealed values name their key; old ones (and pre-v15 ones) still open; rotating keeps everything', async () => {
  const s1 = secrets.seal('totp-secret', 'twofa');
  assert.match(s1, new RegExp(`^k1\\.${secrets.currentKeyId()}\\.`));
  assert.equal(secrets.unseal(s1, 'twofa'), 'totp-secret');
  // A value sealed before v15 (three parts, no key id) opens.
  const raw = fs.readFileSync(secrets.keyFile(), 'utf8').trim();
  const k = crypto.createHmac('sha256', crypto.createHash('sha256').update(raw).digest()).update('agent-reels:twofa').digest();
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const enc = Buffer.concat([c.update('legacy-secret', 'utf8'), c.final()]);
  const legacy = [iv, c.getAuthTag(), enc].map(b => b.toString('base64url')).join('.');
  assert.equal(secrets.unseal(legacy, 'twofa'), 'legacy-secret');
  // An Instagram token sealed the pre-v15 way (a key from the app secret) opens too.
  const ig = await import('../lib/instagram.js');
  process.env.INSTAGRAM_APP_SECRET = 'meta-secret';
  const lk = crypto.createHash('sha256').update('agent-reels:instagram:meta-secret').digest();
  const iv2 = crypto.randomBytes(12), c2 = crypto.createCipheriv('aes-256-gcm', lk, iv2);
  const enc2 = Buffer.concat([c2.update('ig-token', 'utf8'), c2.final()]);
  const tok = [iv2, c2.getAuthTag(), enc2].map(b => b.toString('base64url')).join('.');
  assert.equal(ig.unseal(tok), 'ig-token');
  // Rotate: a new key; everything sealed before still opens; resealing moves it to the new key.
  store.createAccount({ email: 'twofa-old@example.com', role: 'agent', workspaceId: ws.id, hash: 'x' });
  const acc = store.findAccountByEmail('twofa-old@example.com');
  store.updateAccount(acc.id, { twofa: { secret: legacy, enabledAt: new Date().toISOString(), backup: [] } });
  paths.writeJSON(path.join(store.wsDir(ws.id), 'instagram.json'), { userId: '1', token: tok, expiresAt: new Date(Date.now() + 30 * DAY).toISOString() });
  const oldId = secrets.currentKeyId();
  const r = secrets.newKey();
  assert.notEqual(secrets.currentKeyId(), oldId);
  assert.ok(fs.readFileSync(secrets.oldKeyFile(), 'utf8').includes(raw), 'the old key is kept');
  assert.equal(secrets.unseal(s1, 'twofa'), 'totp-secret', 'sealed with the old key: still opens');
  const { resealAll } = await import('../lib/rekey.js');
  const out = resealAll();
  assert.ok(out.twofa >= 1 && out.instagram === 1 && out.unreadable === 0, JSON.stringify(out));
  const sealedNow = store.findAccountByEmail('twofa-old@example.com').twofa.secret;
  assert.ok(secrets.isCurrent(sealedNow));
  assert.equal(secrets.unseal(sealedNow, 'twofa'), 'legacy-secret');
  assert.ok(secrets.isCurrent(paths.readJSON(path.join(store.wsDir(ws.id), 'instagram.json')).token));
  assert.equal(r.inEnv, false);
  delete process.env.INSTAGRAM_APP_SECRET;
});

test('the key check: a server whose key doesn’t match its data says so plainly (and health shows it)', async () => {
  const f = path.join(paths.DIRS.data, 'key-canary.json');
  const good = paths.readJSON(f, null);
  // A canary sealed by some other key (as on a server restored without its .app-key).
  const other = crypto.randomBytes(32);
  const k = crypto.createHmac('sha256', other).update('agent-reels:canary').digest();
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const enc = Buffer.concat([c.update('agent-reels canary', 'utf8'), c.final()]);
  paths.writeJSON(f, { sealed: ['k1', 'deadbeef', ...[iv, c.getAuthTag(), enc].map(b => b.toString('base64url'))].join('.'), keyId: 'deadbeef' });
  try {
    const r = secrets.checkCanary();
    assert.equal(r.ok, false);
    const h = await client(port).get('/api/health');
    assert.equal(h.data.checks.keys, false);
  } finally { paths.writeJSON(f, good); secrets.checkCanary(); }
  assert.equal(secrets.checkCanary().ok, true);
});

/* ---------------- Fonts and music ---------------- */
test('fonts come from the release and are checked; a damaged one is put back', async () => {
  const fonts = await import('../stages/fonts.js');
  const r = await fonts.ensureFont('Poppins SemiBold', () => {});
  const p = path.join(r.dir, 'Poppins-SemiBold.ttf');
  const sha = b => crypto.createHash('sha256').update(b).digest('hex');
  assert.equal(sha(fs.readFileSync(p)), fonts.SHA256['Poppins-SemiBold.ttf']);
  fs.writeFileSync(p, Buffer.alloc(20000, 1));   // damaged
  const c = fonts.checkFonts();
  assert.ok(c.fixed.includes('Poppins-SemiBold.ttf'));
  assert.equal(sha(fs.readFileSync(p)), fonts.SHA256['Poppins-SemiBold.ttf']);
  // Every shipped file matches the table, and the licence ships with them.
  for (const f of fs.readdirSync(fonts.SHIPPED).filter(n => n.endsWith('.ttf'))) assert.equal(sha(fs.readFileSync(path.join(fonts.SHIPPED, f))), fonts.SHA256[f], f);
  assert.ok(fs.existsSync(path.join(fonts.SHIPPED, 'OFL.txt')));
  // A download that isn't the right file is refused.
  const bad = await listen((req, res) => { res.writeHead(200); res.end(Buffer.alloc(50000, 7)); });
  process.env.FONT_SOURCE_URL = `http://127.0.0.1:${bad.address().port}/`;
  const keepFonts = path.join(paths.DIRS.fonts, 'Poppins-Medium.ttf');
  try {
    fs.rmSync(keepFonts, { force: true });
    // (The release has it, so it's put back from there without downloading.)
    await fonts.ensureFont('Poppins Medium', () => {});
    assert.equal(sha(fs.readFileSync(keepFonts)), fonts.SHA256['Poppins-Medium.ttf']);
  } finally { bad.close(); delete process.env.FONT_SOURCE_URL; }
});

test('music: each track’s checksum is noted, and a track that changes on disk is reported once', async () => {
  const { checkMusic } = await import('../lib/assets.js');
  fs.writeFileSync(path.join(paths.DIRS.music, 'calm.mp3'), Buffer.alloc(3000, 3));
  let r = checkMusic();
  assert.deepEqual(r.added, ['calm.mp3']);
  fs.writeFileSync(path.join(paths.DIRS.music, 'calm.mp3'), Buffer.alloc(3000, 4));
  r = checkMusic();
  assert.deepEqual(r.changed, ['calm.mp3']);
  assert.deepEqual(checkMusic().changed, [], 'told once');
});

/* ---------------- The expiry calendar ---------------- */
test('the expiry calendar: Node, Meta’s API, cards, connections and the certificate, warned at 90, 30 and 7 days', async () => {
  const expiry = await import('../lib/expiry.js');
  const major = Number(process.versions.node.split('.')[0]);
  let items = expiry.calendar();
  if (expiry.NODE_EOL[major]) assert.ok(items.some(i => i.id === 'node' && i.date === expiry.NODE_EOL[major]));
  assert.ok(items.some(i => i.id === 'meta-instagram' && i.date === '2028-07-29'));
  // A paying agent's card ending next month, and an Instagram connection that isn't renewing.
  const now = Date.now(), next = new Date(now + 20 * DAY);
  store.updateWorkspace(ws.id, w => ({ billing: { ...(w.billing || {}), status: 'active', card: { brand: 'visa', last4: '4242', exp: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}` } } }));
  paths.writeJSON(path.join(store.wsDir(ws.id), 'instagram.json'), { userId: '1', token: 'x', expiresAt: new Date(now + 5 * DAY).toISOString() });
  items = await expiry.checkExpiry(now, { cert: async () => ({ date: new Date(now + 25 * DAY).toISOString().slice(0, 10), issuer: 'Let’s Encrypt' }) });
  const card = items.find(i => i.id === `card-${ws.id}`), conn = items.find(i => i.id === `ig-${ws.id}`), cert = items.find(i => i.id === 'cert');
  assert.ok(card && conn && cert, JSON.stringify(items.map(i => i.id)));
  assert.equal(conn.level, 'error');
  const titles = () => alerts.listAlerts().map(a => a.title);
  assert.ok(titles().some(t => /HTTPS certificate .* runs out in 25 days/.test(t)));
  const n = titles().length;
  await expiry.checkExpiry(now + 3600000, { cert: async () => ({ date: cert.date, issuer: 'x' }) });
  assert.equal(titles().length, n, 'not again the same day or threshold');
  await expiry.checkExpiry(now + 19 * DAY, { cert: async () => ({ date: cert.date, issuer: 'x' }) });
  assert.ok(alerts.listAlerts().some(a => /HTTPS certificate .* runs out in 6 days/.test(a.title) && a.level === 'error'), 'the 7-day one');
});

/* ---------------- Numbered data changes ---------------- */
test('numbered data changes run once, in order, recorded per workspace; a failing one stops the rest and shows in health', async () => {
  const changes = await import('../lib/changes.js');
  const rec = changes.record();
  for (const c of changes.CHANGES) assert.ok(rec.applied[c.n], `change ${c.n} ran at start`);
  assert.deepEqual((await changes.runChanges({ log: () => {} })).ran, [], 'nothing twice');
  // A step for every workspace: recorded for each one it touched.
  const seen = [];
  changes.CHANGES.push({ n: 97, name: 'A step for each workspace', scope: 'workspace', run: w => { seen.push(w.id); return { touched: true }; } });
  await changes.runChanges({ log: () => {} });
  assert.ok(seen.includes(ws.id));
  assert.ok(changes.record().workspaces[ws.id][97], 'recorded for the workspace');
  assert.equal(changes.record().applied[97].result.results[ws.id].touched, true);
  let ran = 0;
  changes.CHANGES.push({ n: 98, name: 'A step that fails', scope: 'server', run: () => { throw new Error('disk on fire'); } }, { n: 99, name: 'A step after it', scope: 'server', run: () => { ran++; } });
  try {
    const r = await changes.runChanges({ log: () => {} });
    assert.equal(r.failed.n, 98);
    assert.equal(ran, 0, 'the step after it waits');
    assert.equal((await client(port).get('/api/health')).data.checks.changes, false);
    changes.CHANGES[changes.CHANGES.length - 2].run = () => ({ fixed: true });
    const again = await changes.runChanges({ log: () => {} });
    assert.deepEqual(again.ran, [98, 99]);
    assert.equal((await client(port).get('/api/health')).data.checks.changes, true);
  } finally { changes.CHANGES.splice(-3, 3); }
});

/* ---------------- The portal stays in step with the server ---------------- */
test('every answer names the server’s version; the portal knows its own, and refreshes when they differ', async () => {
  const r = await client(port).get('/api/health');
  assert.equal(r.headers.get('x-app-version'), S.VERSION);
  const app = fs.readFileSync(path.join(here, '..', 'public', 'app.js'), 'utf8');
  assert.equal(/const APP_VERSION = '([^']+)'/.exec(app)[1], S.VERSION, 'app.js APP_VERSION matches server.js VERSION');
  assert.match(app, /noteServerVersion\(res\.headers\.get\('x-app-version'\)\)/);
  assert.match(app, /function keepDraft/);
  assert.match(app, /restoreDraft\(\);/);
});

test('the portal’s screens are separate files, each served, and every import resolves', async () => {
  const pub = path.join(here, '..', 'public');
  const files = ['app.js', ...fs.readdirSync(path.join(pub, 'screens')).map(f => `screens/${f}`)];
  assert.ok(files.length >= 10);
  const c = client(port);
  for (const f of files) {
    const r = await c.get(`/${f}`);
    assert.equal(r.status, 200, f);
    assert.match(r.headers.get('content-type'), /javascript/);
    const src = fs.readFileSync(path.join(pub, f), 'utf8');
    for (const m of src.matchAll(/^import [^;]*? from '([^']+)';/gms)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(`/${f}`), m[1]));
      assert.equal((await c.get(target)).status, 200, `${f} imports ${m[1]} (${target})`);
    }
  }
  assert.ok(fs.readFileSync(path.join(pub, 'app.js'), 'utf8').split('\n').length < 2500, 'app.js is the shell, not every screen');
});

test('server.js keeps one list of route capabilities; the routes live in routes/ by area', async () => {
  const dir = path.join(here, '..', 'routes');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  assert.ok(files.length >= 10);
  for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), /ROUTE_CAPS\s*=/, `${f} doesn’t keep its own capability list`);
  assert.deepEqual(S.deadCaps(), [], 'every capability names a route that exists');
  assert.deepEqual(S.unlistedRoutes(), [], 'every workspace change route has a capability');
  assert.ok(fs.readFileSync(path.join(here, '..', 'server.js'), 'utf8').split('\n').length < 1500);
});

/* ---------------- Review fixes ---------------- */
test('a key changed by another process (rotate-key while the server runs) is picked up, not taken for damage', async () => {
  const { spawnSync } = await import('child_process');
  const before = secrets.currentKeyId();
  // Another process makes a new key and seals with it.
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `const s = await import(${JSON.stringify(path.join(here, '..', 'lib', 'secrets.js'))}); s.newKey(); console.log(s.seal('from-elsewhere', 'twofa'));`], { env: process.env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const sealed = r.stdout.trim().split('\n').pop();
  assert.equal(secrets.currentKeyId(), before, 'this process still has the old ring cached');
  assert.equal(secrets.unseal(sealed, 'twofa'), 'from-elsewhere', 'an unknown key id reads the key files again');
  assert.notEqual(secrets.currentKeyId(), before);
  // A signature made with the earlier key still checks out (link-fit verdicts survive a rotation).
  const sigOld = (() => { const raw = fs.readFileSync(secrets.oldKeyFile(), 'utf8').trim().split('\n').pop(); const k = crypto.createHmac('sha256', crypto.createHash('sha256').update(raw).digest()).update('agent-reels:fit').digest(); return crypto.createHmac('sha256', k).update('a|b|c').digest('base64url').slice(0, 16); })();
  assert.equal(secrets.signedBy('a|b|c', sigOld, 'fit'), true);
  assert.equal(secrets.signedBy('a|b|c', 'x'.repeat(16), 'fit'), false);
});

test('a token sealed with a key this server doesn’t have isn’t treated as a broken connection', async () => {
  const ig = await import('../lib/instagram.js');
  const w = store.createWorkspace({ name: 'Missing key', comped: true });
  const bogus = 'k1.deadbeef.AAAA.BBBB.CCCC';
  assert.equal(secrets.keyMissing(bogus), true);
  assert.equal(secrets.keyMissing(secrets.seal('x')), false);
  paths.writeJSON(path.join(store.wsDir(w.id), 'instagram.json'), { userId: '1', token: bogus, expiresAt: new Date(Date.now() + 30 * DAY).toISOString() });
  Object.assign(process.env, { INSTAGRAM_APP_ID: '1', INSTAGRAM_APP_SECRET: 's' });
  try { await ig.tick(); } finally { delete process.env.INSTAGRAM_APP_ID; delete process.env.INSTAGRAM_APP_SECRET; }
  assert.equal(paths.readJSON(path.join(store.wsDir(w.id), 'instagram.json')).problem, undefined, 'not marked “reconnect”');
});

test('a data change that can’t touch one (damaged) workspace skips it and goes on', async () => {
  const changes = await import('../lib/changes.js');
  const bad = store.createWorkspace({ name: 'Damaged one', comped: true });
  changes.CHANGES.push({ n: 96, name: 'Each workspace', scope: 'workspace', run: w => { if (w.id === bad.id) throw new Error('videos.json is damaged'); return { ok: true }; } });
  try {
    const r = await changes.runChanges({ log: () => {} });
    assert.deepEqual(r.ran, [96]);
    assert.equal(r.failed, null);
    const rec = changes.record().applied[96].result;
    assert.match(rec.skipped[bad.id], /damaged/);
    assert.equal((await client(port).get('/api/health')).data.checks.changes, true, 'later updates aren’t blocked');
  } finally { changes.CHANGES.splice(-1, 1); }
});
