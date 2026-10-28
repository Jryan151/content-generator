// Version 12, Phase 1.5: launch-ready and security (steps A–G). One section per step.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { tempEnv, startStubs, client, portalSource } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
tempEnv();
const stubs = await startStubs();
const store = await import('../lib/store.js');
const { readJSON, writeJSON } = await import('../lib/paths.js');
const auth = await import('../lib/auth.js');
const { starterStory } = await import('../templates.js');
const { start } = await import('../server.js');
const server = await start({ port: 0, scheduler: false, worker: false });
const port = server.address().port;
test.after(() => { server.close(); stubs.close(); });

// A ready-to-use agent workspace and a logged-in client.
async function agent(email, { comped = true, password = 'agentpass123' } = {}) {
  const ws = store.createWorkspace({ name: email, comped });
  const cfg = store.loadConfig(ws.id);
  cfg.story = { ...cfg.story, ...starterStory(['final_expense']) };
  cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); });
  cfg.look.name = 'Jane Smith';
  store.saveConfig(ws.id, cfg);
  store.updateWorkspace(ws.id, { onboarded: true });
  const acc = store.createAccount({ email, role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword(password) });
  const c = client(port);
  assert.equal((await c.post('/api/login', { email, password })).status, 200);
  return { c, ws: ws.id, acc };
}
async function admin(email) {
  const acc = store.createAccount({ email, role: 'admin', hash: await auth.hashPassword('bosspass1234') });
  const c = client(port);
  assert.equal((await c.post('/api/login', { email, password: 'bosspass1234' })).status, 200);
  return { c, acc };
}

/* ---------------- Step A: the prompt engine stays on the server; headers; sessions ---------------- */
test('prompts: the browser engine has no prompt text, and the prompt builder is never served', async () => {
  const anon = client(port);
  const core = (await anon.get('/mixer-core.js')).data.toString();
  assert.equal((await anon.get('/mixer-core.js')).status, 200, 'the rules and checks still load in the portal');
  for (const secret of ['buildPrompt', 'buildHookPrompt', 'buildCriticPrompt', 'WHAT MAKES A HOOK WORK', 'Follow these rules in priority order', 'Score each draft', 'Open with their worry as a direct']) {
    assert.ok(!core.includes(secret), `mixer-core.js still contains "${secret}"`);
  }
  for (const p of ['/lib/prompts.js', '/prompts.js', '/lib/coach.js', '/server.js', '/.env']) assert.equal((await anon.get(p)).status, 404, p);
  assert.doesNotMatch(portalSource(), /buildPrompt\(/, 'the portal no longer builds prompts');
});

test('prompts: agents get the recipe, not the prompt; admins can preview it', async () => {
  const { c, ws } = await agent('recipe@example.com');
  assert.equal((await c.post('/api/prompt-preview', {})).status, 403);
  const script = await c.post('/api/script', {});
  assert.equal(script.status, 200, JSON.stringify(script.data).slice(0, 200));
  assert.equal('prompt' in script.data, false, 'test scripts don’t include the prompt for agents');
  // An agent can't slip the prompt into the coach's context either.
  const { c: boss } = await admin('recipe-boss@example.com');
  await boss.post('/api/admin/open', { workspaceId: ws });
  const pv = await boss.post('/api/prompt-preview', {});
  assert.equal(pv.status, 200);
  assert.match(pv.data.system, /priority order/);
  assert.ok(pv.data.sections.some(s => s.title === 'GUARDRAILS'));
  const adminScript = await boss.post('/api/script', {});
  assert.ok(adminScript.data.prompt?.system, 'admins still see it on test scripts');
});

test('security headers on pages and API responses', async () => {
  const anon = client(port);
  for (const p of ['/', '/api/me']) {
    const r = await anon.get(p);
    assert.equal(r.headers.get('x-frame-options'), 'DENY', p);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p);
    assert.match(r.headers.get('permissions-policy') || '', /camera=\(\)/, p);
    assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin', p);
  }
  assert.match((await anon.get('/')).headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
});

test('sessions: list devices, log one out, log out everywhere else, idle sessions expire', async () => {
  const { c, acc } = await agent('devices@example.com');
  const phone = client(port);
  await phone.post('/api/login', { email: 'devices@example.com', password: 'agentpass123' });
  let list = (await c.get('/api/account/sessions')).data.sessions;
  assert.equal(list.length, 2);
  assert.equal(list.filter(s => s.current).length, 1);
  assert.ok(list.every(s => s.device && s.lastSeenAt && /^[0-9a-f]{12}$/.test(s.id)));
  const other = list.find(s => !s.current);
  assert.equal((await c.del(`/api/account/sessions/${list.find(s => s.current).id}`)).status, 400, 'use Log out for this one');
  assert.equal((await c.del(`/api/account/sessions/${other.id}`)).status, 200);
  assert.equal((await phone.get('/api/videos')).status, 401, 'that device is logged out');
  // Log out everywhere else.
  const tablet = client(port);
  await tablet.post('/api/login', { email: 'devices@example.com', password: 'agentpass123' });
  list = (await c.post('/api/account/sessions/logout-others', {})).data.sessions;
  assert.equal(list.length, 1);
  assert.equal((await tablet.get('/api/videos')).status, 401);
  assert.equal((await c.get('/api/videos')).status, 200, 'this device stays in');
  // Someone else's session id can't be ended.
  const { c: other2 } = await agent('devices2@example.com');
  assert.equal((await other2.del(`/api/account/sessions/${list[0].id}`)).status, 404);
  // Idle: unused for SESSION_IDLE_DAYS ends the session.
  const token = auth.createSession(acc.id);
  const h = auth.tokenHash(token);
  const file = path.join(process.env.DATA_DIR, 'sessions.json');
  const all = readJSON(file);
  all[h].lastSeenAt = Date.now() - 15 * 86400000;
  writeJSON(file, (all));
  assert.equal(auth.getSession(token), null);
});

test('sessions: admins get shorter sessions; cookies are __Host- on https', async () => {
  assert.equal(auth.ADMIN_SESSION_DAYS(), 7);
  const { c } = await admin('short@example.com');
  assert.ok(c.cookie.startsWith('sid='));
  const set = auth.sessionCookie('tok', true, 7);
  assert.match(set, /^__Host-sid=tok; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/);
  assert.equal(auth.sessionToken({ '__Host-sid': 'a', sid: 'b' }, true), 'a');
  assert.equal(auth.sessionToken({ sid: 'b' }, true), 'b', 'an older cookie still works until the next login');
  assert.deepEqual(auth.clearCookie(true).map(x => x.split('=')[0]), ['__Host-sid', 'sid']);
  assert.equal(auth.deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'), 'Safari on iPhone');
  assert.equal(auth.deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'), 'Chrome on Windows');
});

/* ---------------- Step B: two-factor login ---------------- */
test('2FA: codes match the RFC 6238 test vectors; QR codes are made locally', async () => {
  const totp = await import('../lib/totp.js');
  const secret = totp.base32(Buffer.from('12345678901234567890'));
  assert.equal(totp.code(secret, Math.floor(59 / 30)), '287082');
  assert.equal(totp.code(secret, Math.floor(1111111109 / 30)), '081804');
  assert.equal(totp.code(secret, Math.floor(1234567890 / 30)), '005924');
  const now = 1234567890 * 1000;
  const step = totp.check(secret, '005924', { now });
  assert.equal(step, Math.floor(1234567890 / 30));
  assert.equal(totp.check(secret, '005924', { now, lastStep: step }), -1, 'the same code can’t be used twice');
  assert.equal(totp.check(secret, totp.code(secret, step - 1), { now }), step - 1, 'one step of clock drift is fine');
  assert.equal(totp.check(secret, totp.code(secret, step - 3), { now }), -1);
  const { qrMatrix, qrSvg } = await import('../lib/qr.js');
  assert.equal(qrMatrix('hello').length, 21);
  assert.equal(qrMatrix('x'.repeat(120)).length, 45, 'version 7');
  assert.match(qrSvg('hello'), /^<svg[^>]+viewBox/);
  assert.throws(() => qrMatrix('x'.repeat(400)), /Too long/);
});

test('2FA: an agent turns it on, logs in with a code or a backup code, and can turn it off', async () => {
  const totp = await import('../lib/totp.js');
  const { unseal } = await import('../lib/secrets.js');
  const { c, acc } = await agent('twofa@example.com');
  const other = client(port);
  await other.post('/api/login', { email: 'twofa@example.com', password: 'agentpass123' });
  const setup = await c.post('/api/2fa/setup', {});
  assert.equal(setup.status, 200);
  assert.match(setup.data.otpauth, /^otpauth:\/\/totp\/Agent%20Reels:twofa%40example\.com\?secret=[A-Z2-7]{32}&issuer=Agent%20Reels/);
  assert.match(setup.data.qr, /^<svg/);
  const secret = setup.data.secret.replace(/\s/g, '');
  // The key is stored encrypted, never in plain text.
  const raw = readJSON(path.join(process.env.DATA_DIR, 'accounts.json')).find(a => a.id === acc.id);
  assert.ok(!JSON.stringify(raw).includes(secret));
  assert.equal(unseal(raw.twofaPending.secret, 'twofa'), secret);
  assert.equal((await c.post('/api/2fa/enable', { code: '000000' })).status, 400);
  const on = await c.post('/api/2fa/enable', { code: totp.code(secret, totp.stepAt()) });
  assert.equal(on.status, 200);
  assert.equal(on.data.on, true);
  assert.equal(on.data.backupCodes.length, 10);
  assert.equal((await other.get('/api/videos')).status, 401, 'other devices are logged out');
  assert.equal((await c.get('/api/me')).data.account.twofa, true);

  // Logging in now takes a code.
  const d = client(port);
  const first = await d.post('/api/login', { email: 'twofa@example.com', password: 'agentpass123' });
  assert.equal(first.data.twofa, true);
  assert.equal((await d.get('/api/videos')).status, 401, 'no session yet');
  assert.equal((await d.post('/api/login/2fa', { ticket: first.data.ticket, code: '123456' })).status, 401);
  const reused = totp.code(secret, totp.stepAt());
  assert.equal((await d.post('/api/login/2fa', { ticket: first.data.ticket, code: reused })).status, 401, 'the code used to turn it on can’t log in again');
  const backup = on.data.backupCodes[0];
  const ok = await d.post('/api/login/2fa', { ticket: first.data.ticket, code: backup.toUpperCase() });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.usedBackup, true);
  assert.equal(ok.data.backupLeft, 9);
  assert.equal((await d.get('/api/videos')).status, 200);
  assert.equal((await d.post('/api/login/2fa', { ticket: first.data.ticket, code: backup })).status, 401, 'tickets are single use');
  const e = client(port);
  const t2 = (await e.post('/api/login', { email: 'twofa@example.com', password: 'agentpass123' })).data.ticket;
  assert.equal((await e.post('/api/login/2fa', { ticket: t2, code: backup })).status, 401, 'a backup code works once');
  // A wrong ticket gets nowhere, and five wrong codes end the ticket.
  assert.equal((await e.post('/api/login/2fa', { ticket: 'nope', code: '123456' })).status, 401);
  for (let i = 0; i < 5; i++) await e.post('/api/login/2fa', { ticket: t2, code: '111111' });
  assert.match((await e.post('/api/login/2fa', { ticket: t2, code: '111111' })).data.error, /too long|Too many/);

  // New backup codes need a code; turning off needs the password and a code.
  const fresh = await c.post('/api/2fa/backup-codes', { code: on.data.backupCodes[1] });
  assert.equal(fresh.status, 200);
  assert.equal(fresh.data.backupCodes.length, 10);
  assert.equal((await c.post('/api/2fa/disable', { password: 'wrong-password', code: fresh.data.backupCodes[0] })).status, 400);
  const off = await c.post('/api/2fa/disable', { password: 'agentpass123', code: fresh.data.backupCodes[0] });
  assert.equal(off.status, 200);
  assert.equal(off.data.on, false);
  assert.equal((await client(port).post('/api/login', { email: 'twofa@example.com', password: 'agentpass123' })).data.ok, true, 'back to a password only');
});

test('2FA: required for admins (blocked until set up), reset by another admin, and still asked after a reset link', async () => {
  const totp = await import('../lib/totp.js');
  process.env.TWO_FACTOR = 'admins';
  try {
    const { c: boss } = await admin('boss2fa@example.com');
    const me = (await boss.get('/api/me')).data;
    assert.equal(me.twofaSetupRequired, true);
    const blocked = await boss.get('/api/admin/overview');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.twofaSetup, true);
    const setup = await boss.post('/api/2fa/setup', {});
    const secret = setup.data.secret.replace(/\s/g, '');
    await boss.post('/api/2fa/enable', { code: totp.code(secret, totp.stepAt()) });
    assert.equal((await boss.get('/api/admin/overview')).status, 200);
    assert.equal((await boss.post('/api/2fa/disable', { password: 'bosspass1234', code: '000000' })).status, 400, 'admins can’t turn it off');
    // Agents aren't required to by default.
    const { c: agentC, acc } = await agent('free@example.com');
    assert.equal((await agentC.get('/api/videos')).status, 200);
    // Lost phone: another admin resets it; the person is logged out.
    const s2 = await agentC.post('/api/2fa/setup', {});
    await agentC.post('/api/2fa/enable', { code: totp.code(s2.data.secret.replace(/\s/g, ''), totp.stepAt()) });
    assert.equal((await boss.post(`/api/admin/accounts/${acc.id}/reset-2fa`, {})).status, 200);
    assert.equal((await agentC.get('/api/videos')).status, 401);
    assert.equal(store.getAccount(acc.id).twofa, null);
    const bossAcc = store.findAccountByEmail('boss2fa@example.com');
    assert.equal((await boss.post(`/api/admin/accounts/${bossAcc.id}/reset-2fa`, {})).status, 400, 'not your own');
    // A password reset link doesn't skip the code.
    const link = auth.createLink('reset', { accountId: bossAcc.id }, 'test');
    const anon = client(port);
    const r = await anon.post('/api/link/accept', { token: link, kind: 'reset', password: 'newbosspass123' });
    assert.equal(r.data.twofa, true);
    assert.equal((await anon.get('/api/admin/overview')).status, 401);
    // TWO_FACTOR=all requires it for agents too.
    process.env.TWO_FACTOR = 'all';
    const { c: agent2 } = await agent('all2fa@example.com');
    assert.equal((await agent2.get('/api/videos')).data.twofaSetup, true);
  } finally { process.env.TWO_FACTOR = 'off'; }
});

test('2FA: the encryption key lives outside data/, and the CLI can reset it', async () => {
  const { keyFile, seal, unseal } = await import('../lib/secrets.js');
  assert.ok(!keyFile().startsWith(process.env.DATA_DIR + path.sep), 'not inside data/ (or its backups)');
  assert.ok(fs.existsSync(keyFile()));
  assert.equal((fs.statSync(keyFile()).mode & 0o777).toString(8), '600');
  assert.equal(unseal(seal('abc', 'x'), 'x'), 'abc');
  assert.equal(unseal(seal('abc', 'x'), 'y'), null, 'each purpose has its own key');
  const { spawnSync } = await import('child_process');
  store.createAccount({ email: 'cli2fa@example.com', role: 'agent', workspaceId: null, hash: 'x' });
  store.updateAccount(store.findAccountByEmail('cli2fa@example.com').id, { twofa: { enabledAt: 'now', secret: 'x', backup: [] } });
  const out = spawnSync(process.execPath, [path.join(ROOT, 'admin.js'), 'reset-2fa', 'cli2fa@example.com'], { env: process.env, encoding: 'utf8' });
  assert.match(out.stdout, /Two-factor login is off/);
  assert.equal(store.findAccountByEmail('cli2fa@example.com').twofa, null);
});

/* ---------------- Step C: audit log ---------------- */
test('audit: logins, failures, approvals, exports and admin actions are recorded and viewable', async () => {
  const audit = await import('../lib/audit.js');
  const { c, ws } = await agent('audited@example.com');
  await client(port).post('/api/login', { email: 'audited@example.com', password: 'wrong-password-1' });
  await client(port).post('/api/login', { email: 'nobody-at-all@example.com', password: 'whatever12345' });
  const { c: boss, acc: bossAcc } = await admin('auditboss@example.com');
  await boss.post('/api/admin/open', { workspaceId: ws });
  await boss.post(`/api/admin/workspaces/${ws}`, { suspended: false, aiCostUsd: 30 });
  await c.get('/api/records.csv');
  await c.get('/api/data/export');
  await c.post('/api/account/sessions/logout-others', {});
  const mine = audit.list({ ws });
  const actions = mine.map(e => e.action);
  for (const a of ['login.ok', 'login.failed', 'admin.open', 'workspace.changed', 'records.exported', 'data.exported', 'session.others']) assert.ok(actions.includes(a), a);
  const failed = mine.find(e => e.action === 'login.failed');
  assert.equal(failed.email, 'audited@example.com');
  assert.ok(failed.ip);
  assert.ok(audit.list({ action: 'login.failed' }).some(e => e.email === 'nobody-at-all@example.com' && !e.ws), 'unknown emails are recorded too');
  assert.match(mine.find(e => e.action === 'workspace.changed').detail, /aiCostUsd: 30/);
  assert.equal(mine.find(e => e.action === 'admin.open').by, bossAcc.id);
  // Admin view and CSV, filtered.
  const view = await boss.get(`/api/admin/audit?ws=${ws}&kind=logins`);
  assert.equal(view.status, 200);
  assert.ok(view.data.entries.length >= 2);
  assert.ok(view.data.entries.every(e => /^(login|logout|password|twofa|session)/.test(e.action)));
  assert.ok(view.data.entries.every(e => e.label && e.workspace === 'audited@example.com'));
  const csv = (await boss.get(`/api/admin/audit.csv?ws=${ws}`)).data.toString();
  assert.match(csv, /"When \(UTC\)","Who","Role","What"/);
  assert.match(csv, /Downloaded all their data/);
  assert.equal((await c.get('/api/admin/audit')).status, 403, 'agents can’t read it');
  // The agent's own export includes the workspace's activity, with admins shown only as "admin".
  const exp = (await c.get('/api/data/export')).data;
  assert.ok(exp.activity.some(e => e.action === 'login.ok'));
  const adminEntry = exp.activity.find(e => e.action === 'admin.open');
  assert.equal(adminEntry.email, 'admin');
  assert.equal(adminEntry.ip, '');
});

test('audit: approvals, 2FA changes and deletion are recorded; old months are pruned', async () => {
  const audit = await import('../lib/audit.js');
  const totp = await import('../lib/totp.js');
  const { c, ws } = await agent('audit2@example.com');
  const s = await c.post('/api/2fa/setup', {});
  await c.post('/api/2fa/enable', { code: totp.code(s.data.secret.replace(/\s/g, ''), totp.stepAt()) });
  const vid = `${Date.now()}aa`;
  fs.writeFileSync(store.videoPath(ws, `video_${vid}.mp4`), 'x');
  store.addVideo(ws, { id: vid, file: `video_${vid}.mp4`, status: 'pending', createdAt: new Date().toISOString(), meta: {}, scenes: [{ text: 'Hi' }], post: 'P', clips: [] });
  await c.post(`/api/videos/${vid}/approve`, { checklist: ['watched', 'footage', 'facts', 'rules'] });
  await c.post(`/api/videos/${vid}/reopen`, {});
  await c.post(`/api/videos/${vid}/reject`, { reason: 'Too salesy' });
  const actions = audit.list({ ws }).map(e => e.action);
  for (const a of ['twofa.on', 'video.approved', 'video.reopened', 'video.rejected']) assert.ok(actions.includes(a), a);
  assert.equal(audit.list({ ws, action: 'video.rejected' })[0].detail, 'Too salesy');
  // Pruning: months past AUDIT_KEEP_MONTHS go.
  const dir = path.join(process.env.DATA_DIR, 'audit');
  fs.writeFileSync(path.join(dir, '2023-01.jsonl'), JSON.stringify({ at: '2023-01-05T00:00:00Z', action: 'login.ok' }) + '\n');
  assert.equal(audit.prune(new Date('2026-10-15T00:00:00Z')), 1);
  assert.ok(!fs.existsSync(path.join(dir, '2023-01.jsonl')));
  // A bad line never breaks reading.
  fs.appendFileSync(path.join(dir, `${new Date().toISOString().slice(0, 7)}.jsonl`), 'not json\n');
  assert.ok(audit.list({ ws }).length > 0);
  assert.match(audit.toCsv([{ at: 'x', email: '=cmd()', action: 'login.ok' }]), /"'=cmd\(\)"/, 'spreadsheet formulas are neutralized');
});


// A stand-in for Postmark: records what was sent.
async function fakeMail() {
  const got = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => { b += d; }); req.on('end', () => {
      got.push({ path: req.url, body: JSON.parse(b || '{}') });
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ MessageID: 'm' + got.length }));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const keys = { EMAIL_PROVIDER: 'postmark', EMAIL_API_KEY: 'pm', EMAIL_FROM: 'hello@example.com', EMAIL_API_BASE: `http://127.0.0.1:${srv.address().port}` };
  Object.assign(process.env, keys);
  return { got, close: () => { Object.keys(keys).forEach(k => delete process.env[k]); srv.close(); } };
}

/* ---------------- Step D: public landing page and "request access" ---------------- */

/* ---------------- Step E: encrypted off-site backups ---------------- */
// A stand-in for S3-compatible storage that checks every request's Signature V4.
async function fakeS3({ accessKey = 'AKTEST', secretKey = 'secret-test', region = 'us-west-004', bucket = 'reels-backups' } = {}) {
  const { signV4 } = await import('../lib/offsite.js');
  const objects = new Map(), log = [];
  const srv = http.createServer((req, res) => {
    const chunks = []; req.on('data', d => chunks.push(d)); req.on('end', () => {
      const body = Buffer.concat(chunks), u = new URL(req.url, 'http://x');
      const amz = req.headers['x-amz-date'], now = new Date(`${amz.slice(0, 4)}-${amz.slice(4, 6)}-${amz.slice(6, 11)}:${amz.slice(11, 13)}:${amz.slice(13, 15)}Z`);
      const query = Object.fromEntries(u.searchParams), signed = /SignedHeaders=([^,]+)/.exec(req.headers.authorization || '')?.[1].split(';') || [];
      const headers = Object.fromEntries(signed.filter(h => !['host', 'x-amz-date'].includes(h)).map(h => [h, req.headers[h]]));
      const expect = signV4({ method: req.method, host: req.headers.host, path: u.pathname, query, headers, payloadHash: req.headers['x-amz-content-sha256'], region, accessKey, secretKey, now }).authorization;
      log.push({ method: req.method, path: u.pathname, ok: expect === req.headers.authorization });
      if (expect !== req.headers.authorization) { res.writeHead(403); return res.end('<Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match</Message></Error>'); }
      if (crypto.createHash('sha256').update(body).digest('hex') !== req.headers['x-amz-content-sha256']) { res.writeHead(400); return res.end('<Error><Code>XAmzContentSHA256Mismatch</Code></Error>'); }
      const [, b, ...rest] = u.pathname.split('/'), key = rest.map(decodeURIComponent).join('/');
      if (b !== bucket) { res.writeHead(404); return res.end('<Error><Code>NoSuchBucket</Code></Error>'); }
      if (req.method === 'PUT') { objects.set(key, { body, modified: new Date().toISOString() }); res.writeHead(200); return res.end(); }
      if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); return res.end(); }
      if (req.method === 'GET' && !key) {
        const items = [...objects].filter(([k]) => k.startsWith(query.prefix || '')).map(([k, o]) => `<Contents><Key>${k}</Key><LastModified>${o.modified}</LastModified><Size>${o.body.length}</Size></Contents>`).join('');
        res.writeHead(200, { 'Content-Type': 'application/xml' }); return res.end(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${items}</ListBucketResult>`);
      }
      const o = objects.get(key);
      if (!o) { res.writeHead(404); return res.end('<Error><Code>NoSuchKey</Code></Error>'); }
      res.writeHead(200); res.end(o.body);
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const env = { BACKUP_KEY: 'a'.repeat(64), BACKUP_S3_ENDPOINT: `http://127.0.0.1:${srv.address().port}`, BACKUP_S3_BUCKET: bucket, BACKUP_S3_REGION: region, BACKUP_S3_ACCESS_KEY: accessKey, BACKUP_S3_SECRET_KEY: secretKey, BACKUP_S3_PREFIX: 'agent-reels/' };
  Object.assign(process.env, env);
  return { objects, log, close: () => { Object.keys(env).forEach(k => delete process.env[k]); srv.close(); } };
}

test('backups: Signature V4 matches AWS’s published test vectors', async () => {
  const { signV4 } = await import('../lib/offsite.js');
  const a = signV4({ method: 'GET', host: 'example.amazonaws.com', path: '/', region: 'us-east-1', service: 'service', accessKey: 'AKIDEXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', now: new Date('2015-08-30T12:36:00Z') });
  assert.match(a.authorization, /Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31$/, 'get-vanilla');
  const empty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const b = signV4({ method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', headers: { range: 'bytes=0-9', 'x-amz-content-sha256': empty }, payloadHash: empty, region: 'us-east-1', accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', now: new Date('2013-05-24T00:00:00Z') });
  assert.match(b.authorization, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/, 'S3 GET object example');
});

test('backups: AES-256-GCM encryption round-trips, and wrong keys or damage are caught', async () => {
  const off = await import('../lib/offsite.js');
  const dir = fs.mkdtempSync(path.join(process.env.DATA_DIR, '..', 'enc-'));
  const src = path.join(dir, 'x.tar.gz'), enc = path.join(dir, 'x.enc'), out = path.join(dir, 'y');
  const data = crypto.randomBytes(300000);
  fs.writeFileSync(src, data);
  for (const key of ['0123456789abcdef'.repeat(4), 'a long backup passphrase 2026']) {
    await off.encryptFile(src, enc, key);
    const raw = fs.readFileSync(enc);
    assert.equal(raw.subarray(0, 4).toString(), 'ARB1');
    assert.ok(!raw.includes(data.subarray(0, 64)), 'no plaintext inside');
    assert.equal((fs.statSync(enc).mode & 0o777).toString(8), '600');
    await off.decryptFile(enc, out, key);
    assert.ok(fs.readFileSync(out).equals(data));
    await assert.rejects(off.decryptFile(enc, out + '2', key.replace(/.$/, 'X')), /Wrong BACKUP_KEY/);
    assert.ok(!fs.existsSync(out + '2') && !fs.existsSync(out + '2.part'), 'nothing partial left behind');
  }
  const raw = fs.readFileSync(enc); raw[5000] ^= 1; fs.writeFileSync(enc, raw);
  await assert.rejects(off.decryptFile(enc, out, 'a long backup passphrase 2026'), /Wrong BACKUP_KEY, or the backup file is damaged/);
  await assert.rejects(off.encryptFile(src, enc, 'short'), /too short/);
  await assert.rejects(off.decryptFile(src, out, 'a long backup passphrase 2026'), /isn’t an encrypted backup/);
  assert.equal(off.offsiteOn(), false, 'off until set up');
  process.env.BACKUP_S3_ENDPOINT = 'http://backups.example.com'; process.env.BACKUP_S3_BUCKET = 'b'; process.env.BACKUP_S3_ACCESS_KEY = 'k'; process.env.BACKUP_S3_SECRET_KEY = 's'; process.env.BACKUP_KEY = 'b'.repeat(64);
  try { assert.equal(off.offsiteOn(), false, 'plain http to another machine is refused'); }
  finally { ['BACKUP_S3_ENDPOINT', 'BACKUP_S3_BUCKET', 'BACKUP_S3_ACCESS_KEY', 'BACKUP_S3_SECRET_KEY', 'BACKUP_KEY'].forEach(k => delete process.env[k]); }
});

test('backups: nightly upload is encrypted and signed, old copies are pruned, the weekly restore test checks it', async () => {
  const { backup, offsiteJobs, maintenanceState } = await import('../lib/scheduler.js');
  const { listAlerts } = await import('../lib/alerts.js');
  await agent('backed-up@example.com');
  const s3 = await fakeS3();
  try {
    // Two old copies and one recent one already in the bucket.
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    for (const d of ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']) s3.objects.set(`agent-reels/data-${d}.tar.gz.enc`, { body: Buffer.from('x'), modified: old });
    s3.objects.set('other-app/keep.tar.gz.enc', { body: Buffer.from('x'), modified: old });
    const file = await backup(new Date('2026-10-15T09:00:00Z'));
    const r = await offsiteJobs(file, () => {}, new Date());
    assert.equal(r.upload.key, 'agent-reels/data-2026-10-15.tar.gz.enc');
    assert.ok(s3.log.every(x => x.ok), 'every request was correctly signed');
    const up = s3.objects.get('agent-reels/data-2026-10-15.tar.gz.enc').body;
    assert.equal(up.subarray(0, 4).toString(), 'ARB1');
    assert.notEqual(up[4 + 28], 0x1f, 'not a readable gzip');
    assert.ok(!up.toString('latin1').includes('backed-up@example.com'), 'no readable emails in the upload');
    assert.ok(!fs.existsSync(file + '.enc'), 'the local encrypted copy is cleaned up');
    // Retention: older than 30 days goes, but the newest 3 always stay; other prefixes are untouched.
    const kept = [...s3.objects.keys()].filter(k => k.startsWith('agent-reels/')).sort();
    assert.deepEqual(kept, ['agent-reels/data-2026-01-03.tar.gz.enc', 'agent-reels/data-2026-01-04.tar.gz.enc', 'agent-reels/data-2026-10-15.tar.gz.enc']);
    assert.ok(s3.objects.has('other-app/keep.tar.gz.enc'));
    // The restore test downloaded the newest copy, decrypted it and found the data.
    assert.equal(r.restoreTest.ok, true);
    assert.ok(r.restoreTest.accounts >= 1 && r.restoreTest.workspaces >= 1);
    const st = maintenanceState();
    assert.ok(st.offsiteAt && st.restoreTestAt && !st.offsiteError);
    // Next night: uploaded, but the restore test isn't due again for a week.
    const r2 = await offsiteJobs(file, () => {}, new Date(Date.now() + 86400000));
    assert.ok(r2.upload && !r2.restoreTest);
    // Admin → Server shows it.
    const { c: boss } = await admin('backupboss@example.com');
    const sys = (await boss.get('/api/admin/overview')).data.system.offsite;
    assert.equal(sys.on, true);
    assert.ok(sys.at && sys.testAt && !sys.error);

    // Wrong credentials: the upload fails, you get an alert, the local backup stays.
    process.env.BACKUP_S3_SECRET_KEY = 'wrong';
    const bad = await offsiteJobs(file, () => {}, new Date());
    assert.match(bad.uploadError, /403.*signature/i);
    assert.ok(fs.existsSync(file));
    assert.ok(listAlerts().some(a => a.title === 'The off-site backup didn’t upload'));
    process.env.BACKUP_S3_SECRET_KEY = 'secret-test';
    // A changed BACKUP_KEY can't read the old copies: the restore test fails loudly.
    process.env.BACKUP_KEY = 'c'.repeat(64);
    const off = await import('../lib/offsite.js');
    s3.objects.set('agent-reels/data-2099-01-01.tar.gz.enc', { body: s3.objects.get('agent-reels/data-2026-10-15.tar.gz.enc').body, modified: new Date().toISOString() });
    await assert.rejects(off.restoreTest(), /Wrong BACKUP_KEY/);

    // The terminal: restore-test on a local file, and decrypt-backup.
    const { spawnSync } = await import('child_process');
    const cli = (...a) => spawnSync(process.execPath, [path.join(ROOT, 'admin.js'), ...a], { env: process.env, encoding: 'utf8' });
    assert.match(cli('restore-test', file).stdout, /Restore test passed: data-2026-10-15\.tar\.gz/);
    const encLocal = file + '.manual.enc';
    await off.encryptFile(file, encLocal);
    assert.equal(cli('decrypt-backup', encLocal, file + '.out').status, 0);
    assert.ok(fs.readFileSync(file + '.out').equals(fs.readFileSync(file)));
    process.env.BACKUP_KEY = 'd'.repeat(64);
    const fail = cli('restore-test', encLocal);
    assert.notEqual(fail.status, 0);
    assert.match(fail.stderr, /Restore test FAILED: Wrong BACKUP_KEY/);
  } finally { s3.close(); }
});

/* ---------------- Step F: monitoring ---------------- */
test('health: 200 when fine, 503 with the failing check; details only with HEALTH_TOKEN', async () => {
  const monitor = await import('../lib/monitor.js');
  const queue = await import('../lib/queue.js');
  // Independent of the machine running the checks: its free disk space and any backup settings.
  process.env.LOW_DISK_GB = '0.001';
  for (const k of ['BACKUP_KEY', 'BACKUP_S3_ENDPOINT', 'BACKUP_S3_BUCKET', 'BACKUP_S3_ACCESS_KEY', 'BACKUP_S3_SECRET_KEY']) delete process.env[k];
  const anon = client(port);
  const ok = await anon.get('/api/health');
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.ok, true);
  assert.deepEqual(Object.keys(ok.data.checks).sort(), ['backup', 'changes', 'disk', 'keys', 'queue']);
  assert.equal('version' in ok.data || 'detail' in ok.data, false, 'strangers learn nothing useful');
  process.env.HEALTH_TOKEN = 'h'.repeat(24);
  try {
    assert.equal('detail' in (await anon.get('/api/health?token=wrong')).data, false);
    const full = (await anon.get(`/api/health?token=${'h'.repeat(24)}`)).data;
    assert.ok(full.version && full.detail && 'freeGB' in full.detail);
  } finally { delete process.env.HEALTH_TOKEN; }
  // A video stuck rendering for over 30 minutes.
  const { ws } = await agent('stuck@example.com');
  const job = queue.enqueue({ ws, kind: 'video' });
  queue._patch(job.id, { status: 'running', startedAt: new Date(Date.now() - 2 * 3600000).toISOString(), lease: { worker: 'elsewhere:1', until: new Date(Date.now() + 3600000).toISOString() } });
  try {
    const bad = await anon.get('/api/health');
    assert.equal(bad.status, 503);
    assert.equal(bad.data.checks.queue, false);
  } finally { queue._patch(job.id, { status: 'canceled' }); }
  // Two days on with no backup: the backup check fails and you're alerted once that day.
  const later = Date.now() + 48 * 3600000;
  assert.equal(monitor.health(later).checks.backup, false);
  const { listAlerts } = await import('../lib/alerts.js');
  assert.deepEqual(monitor.checkBackups(later), ['backupLate']);
  assert.deepEqual(monitor.checkBackups(later + 60000), [], 'once a day');
  assert.ok(listAlerts().some(a => a.title === 'The nightly backup is late'));
});

test('monitoring: a burst of unexpected errors alerts you once', async () => {
  const monitor = await import('../lib/monitor.js');
  const { listAlerts } = await import('../lib/alerts.js');
  monitor._resetErrors();
  const t = Date.now();
  for (let i = 0; i < 4; i++) assert.equal(monitor.noteError(new Error('boom ' + i), 'GET /api/x', t + i), false);
  assert.equal(monitor.noteError(new Error('boom 4'), 'GET /api/x', t + 5), true);
  assert.equal(monitor.noteError(new Error('boom 5'), 'GET /api/x', t + 6), false, 'quiet for 30 minutes after an alert');
  const a = listAlerts().find(x => x.title === 'The server is throwing errors');
  assert.match(a.text, /5 unexpected errors.*boom 4/);
  // Old errors fall out of the 10-minute window.
  monitor._resetErrors();
  for (let i = 0; i < 4; i++) monitor.noteError(new Error('old'), '', t);
  assert.equal(monitor.noteError(new Error('new'), '', t + 11 * 60000), false);
  monitor._resetErrors();
});

test('monitoring: a login from a new device emails the account owner', async () => {
  const fm = await fakeMail();
  try {
    await agent('watched@example.com');   // first login: no email
    assert.equal(fm.got.length, 0);
    const again = client(port);
    await again.post('/api/login', { email: 'watched@example.com', password: 'agentpass123' });
    assert.equal(fm.got.length, 0, 'same device and network: no email');
    const res = await fetch(`http://127.0.0.1:${port}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0' }, body: JSON.stringify({ email: 'watched@example.com', password: 'agentpass123' }) });
    assert.equal(res.status, 200);
    for (let i = 0; i < 50 && !fm.got.length; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(fm.got.length, 1);
    assert.equal(fm.got[0].body.To, 'watched@example.com');
    assert.match(fm.got[0].body.Subject, /New login/);
    assert.match(fm.got[0].body.TextBody, /Firefox on Windows/);
    assert.match(fm.got[0].body.TextBody, /change your password/);
    // The same new device again: no second email.
    await fetch(`http://127.0.0.1:${port}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0' }, body: JSON.stringify({ email: 'watched@example.com', password: 'agentpass123' }) });
    await new Promise(r => setTimeout(r, 100));
    assert.equal(fm.got.length, 1);
    assert.equal('knownDevices' in (await again.get('/api/me')).data.account, false, 'device fingerprints aren’t sent to the browser');
  } finally { fm.close(); }
});

/* ---------------- Step G: tuning (retries, clearer errors, fewer reads, parallel stages) ---------------- */
// A scripted stand-in: answers each request with the next response in the list.
async function scripted(responses) {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => { b += d; }); req.on('end', () => {
      calls.push({ path: req.url, body: b });
      const [code, obj] = responses[Math.min(calls.length - 1, responses.length - 1)];
      res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { calls, base: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() };
}

test('tuning: OpenAI calls retry outages, not unfixable errors, and say what to fix', async () => {
  const { chatJSON } = await import('../lib/ai.js');
  const saved = { base: process.env.OPENAI_BASE_URL, key: process.env.OPENAI_API_KEY };
  process.env.RETRY_BASE_MS = '5'; process.env.OPENAI_API_KEY = 'sk-test';
  const ok = [200, { choices: [{ message: { content: '{"a":1}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }];
  const run = async (responses, fn) => { const s = await scripted(responses); process.env.OPENAI_BASE_URL = s.base; try { return await fn(s); } finally { s.close(); } };
  try {
    await run([[503, { error: { message: 'overloaded' } }], ok], async s => {
      assert.equal(await chatJSON({ messages: [] }), '{"a":1}');
      assert.equal(s.calls.length, 2, 'an outage is retried');
    });
    await run([[401, { error: { message: 'Incorrect API key', code: 'invalid_api_key' } }]], async s => {
      const e = await chatJSON({ messages: [] }).catch(x => x);
      assert.equal(s.calls.length, 1, 'a bad key isn’t retried');
      assert.match(e.message, /rejected the API key.*OPENAI_API_KEY/);
      assert.equal(e.permanent, true, 'the queue won’t try the video again');
    });
    await run([[429, { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } }]], async s => {
      const e = await chatJSON({ messages: [] }).catch(x => x);
      assert.equal(s.calls.length, 1);
      assert.match(e.message, /out of credit/);
      assert.equal(e.permanent, true);
    });
    await run([[200, { choices: [{ message: { content: '' } }] }], ok], async s => {
      assert.equal(await chatJSON({ messages: [] }), '{"a":1}', 'an empty reply gets one more try');
      assert.equal(s.calls.length, 2);
    });
    await run([[500, { error: { message: 'down' } }]], async s => {
      const t = Date.now();
      const e = await chatJSON({ messages: [] }).catch(x => x);
      assert.equal(s.calls.length, 3);
      assert.equal(e.permanent, false, 'an outage can be tried again later');
      assert.ok(Date.now() - t < 2000, 'no wait after the last try');
    });
  } finally { process.env.OPENAI_BASE_URL = saved.base; process.env.OPENAI_API_KEY = saved.key; delete process.env.RETRY_BASE_MS; if (!saved.key) delete process.env.OPENAI_API_KEY; }
});

test('tuning: email gets one more try after an outage, never after a refusal', async () => {
  const mail = await import('../lib/email.js');
  process.env.RETRY_BASE_MS = '5';
  const keys = { EMAIL_PROVIDER: 'postmark', EMAIL_API_KEY: 'pm', EMAIL_FROM: 'hello@example.com' };
  Object.assign(process.env, keys);
  try {
    let s = await scripted([[503, { Message: 'down' }], [200, { MessageID: 'x' }]]);
    process.env.EMAIL_API_BASE = s.base;
    assert.equal((await mail.send({ to: 'a@example.com', subject: 's', text: 't', html: 'h' })).id, 'x');
    assert.equal(s.calls.length, 2);
    s.close();
    s = await scripted([[422, { ErrorCode: 300, Message: 'Invalid email request' }]]);
    process.env.EMAIL_API_BASE = s.base;
    await assert.rejects(mail.send({ to: 'a@example.com', subject: 's', text: 't', html: 'h' }), /Invalid email request/);
    assert.equal(s.calls.length, 1);
    s.close();
  } finally { [...Object.keys(keys), 'EMAIL_API_BASE', 'RETRY_BASE_MS'].forEach(k => delete process.env[k]); }
});

test('tuning: video counts are cached until videos.json changes', async () => {
  const { ws } = await agent('counts@example.com');
  const v = (id, status) => ({ id, status, createdAt: new Date().toISOString(), scenes: [], meta: {} });
  store.addVideo(ws, v('a', 'pending')); store.addVideo(ws, v('b', 'pending')); store.addVideo(ws, v('c', 'posted'));
  assert.deepEqual(store.videoCounts(ws), { total: 3, pending: 2, approved: 0, posted: 1, rejected: 0 });
  store.updateVideo(ws, 'a', { status: 'approved' });
  assert.deepEqual(store.videoCounts(ws), { total: 3, pending: 1, approved: 1, posted: 1, rejected: 0 }, 'a change is seen right away');
  const c = store.videoCounts(ws); c.pending = 99;
  assert.equal(store.videoCounts(ws).pending, 1, 'callers can’t change the cache');
  assert.equal(store.videoCounts('w000000000000').total, 0);
});

test('tuning: clip downloads run while later scenes are picked, and stay in scene order', async () => {
  const { findClips } = await import('../stages/broll.js');
  const scenes = Array.from({ length: 5 }, (_, i) => ({ text: `Scene ${i}`, keyword: ['grandmother kitchen', 'family dinner', 'couple talking', 'senior man smiling', 'mother child home'][i] }));
  const t = Date.now();
  const clips = await findClips(scenes, { log: () => {} });
  assert.equal(clips.length, 5);
  for (const c of clips) {
    assert.ok(fs.existsSync(c.file), 'every clip is downloaded');
    assert.equal(path.basename(c.file), `${c.id}.mp4`, 'each file belongs to its own scene');
  }
  assert.equal(new Set(clips.map(c => c.id)).size, 5, 'no clip twice in one video');
  assert.ok(Date.now() - t < 30000);
});
