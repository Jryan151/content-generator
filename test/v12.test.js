// Version 12: release-ready changes (Phase 1). One section per step.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { tempEnv, client, portalSource } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
tempEnv();
delete process.env.OPENAI_API_KEY;
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const { starterStory } = await import('../templates.js');
const { start, APPROVAL_NOTE } = await import('../server.js');
const server = await start({ port: 0, scheduler: false, worker: false });
const port = server.address().port;
test.after(() => server.close());

// A ready-to-use agent workspace and logged-in clients.
async function agent(email, { comped = true } = {}) {
  const ws = store.createWorkspace({ name: email, comped });
  const cfg = store.loadConfig(ws.id);
  cfg.story = { ...cfg.story, ...starterStory(['final_expense']) };
  cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); });
  cfg.look.name = 'Jane Smith';
  store.saveConfig(ws.id, cfg);
  store.updateWorkspace(ws.id, { onboarded: true });
  store.createAccount({ email, role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('agentpass123') });
  const c = client(port);
  assert.equal((await c.post('/api/login', { email, password: 'agentpass123' })).status, 200);
  return { c, ws: ws.id };
}
function fakeVideo(ws, status = 'pending', extra = {}) {
  const id = store.validWs(ws) ? `${Date.now()}${Math.random().toString(36).slice(2, 6)}` : '';
  fs.writeFileSync(store.videoPath(ws, `video_${id}.mp4`), Buffer.from('fake mp4 ' + id));
  return store.addVideo(ws, { id, file: `video_${id}.mp4`, cover: '', status, createdAt: new Date().toISOString(), meta: { painPoint: 'Worry', insight: 'Fact', painId: 'fe_p1', format: 'question' }, scenes: [{ text: 'Hi' }], post: 'Post', clips: [], preflight: [], ...extra });
}

/* ---------------- Step 1: "compliance-checked", never "compliant" ---------------- */
test('user-facing text says compliance-checked, never that videos are compliant', () => {
  // The only allowed uses of "compliant" are the ones that say the checks DON'T make something compliant.
  const allowed = /make (?:a video|them) compliant/g;
  const split = [...fs.readdirSync(path.join(ROOT, 'public', 'screens')).map(f => `public/screens/${f}`), ...fs.readdirSync(path.join(ROOT, 'routes')).map(f => `routes/${f}`)];
  for (const f of ['public/app.js', 'public/index.html', 'SETUP.md', 'package.json', 'server.js', 'mixer-core.js', 'lib/coach.js', 'lib/comms.js', 'comms-core.js', ...split]) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(allowed, '');
    assert.doesNotMatch(text, /\bcompliant\b/i, `${f} still claims "compliant"`);
  }
  assert.match(portalSource(), /compliance-checked Reels/);
});

test('approval shows and records the agent-responsibility reminder', async () => {
  assert.match(APPROVAL_NOTE, /responsible for final approval/);
  assert.match(APPROVAL_NOTE, /carriers or state/);
  const { c, ws } = await agent('step1@example.com');
  assert.equal((await c.get('/api/me')).data.approvalNote, APPROVAL_NOTE, 'the portal shows it next to Approve');
  assert.match(portalSource(), /S\.me\.approvalNote/);
  const v = fakeVideo(ws);
  const ok = await c.post(`/api/videos/${v.id}/approve`, { checklist: ['watched', 'footage', 'facts', 'rules'] });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.video.approval.notice, APPROVAL_NOTE, 'kept on the approval record');
  const html = (await c.get('/api/records.html')).data.toString();
  assert.match(html, /remains responsible/);
  assert.ok(html.includes('You stay responsible for final approval'));
});

/* ---------------- Step 2: Terms of Service and Privacy Policy ---------------- */
test('terms: off without URLs, required at invite-accept, setup and when the version changes', async () => {
  const admin = client(port);
  store.createAccount({ email: 'boss2@example.com', role: 'admin', hash: await auth.hashPassword('bosspass1234') });
  await admin.post('/api/login', { email: 'boss2@example.com', password: 'bosspass1234' });
  const old = await agent('older@example.com');
  assert.equal((await old.c.get('/api/me')).data.terms.on, false, 'off until both URLs are set');
  assert.equal((await old.c.get('/api/videos')).status, 200);

  Object.assign(process.env, { TERMS_URL: 'https://example.com/terms', PRIVACY_URL: 'https://example.com/privacy', TERMS_VERSION: '2026-10' });
  try {
    const me = (await old.c.get('/api/me')).data;
    assert.deepEqual(me.terms, { on: true, version: '2026-10', termsUrl: 'https://example.com/terms', privacyUrl: 'https://example.com/privacy' });
    assert.equal(me.termsRequired, true, 'existing agents are asked once');
    const blocked = await old.c.get('/api/videos');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.terms, true);
    assert.equal((await old.c.post('/api/terms/accept', { accept: false })).status, 400);
    const ok = await old.c.post('/api/terms/accept', { accept: true });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.account.termsVersion, '2026-10');
    assert.ok(ok.data.account.acceptedAt);
    assert.equal(store.findAccountByEmail('older@example.com').termsVersion, '2026-10', 'stored on the account');
    assert.equal((await old.c.get('/api/videos')).status, 200);

    // A new version asks again.
    process.env.TERMS_VERSION = '2027-01';
    assert.equal((await old.c.get('/api/me')).data.termsRequired, true);
    assert.equal((await old.c.get('/api/videos')).status, 403);
    await old.c.post('/api/terms/accept', { accept: true });
    assert.equal((await old.c.get('/api/videos')).status, 200);

    // Invite-accept needs the box ticked.
    const inv = await admin.post('/api/admin/invite', { email: 'newbie@example.com', workspaceName: 'Newbie', comped: true });
    const token = inv.data.link.split('/').pop();
    const n = client(port);
    assert.equal((await n.post('/api/link/accept', { token, kind: 'invite', name: 'New', password: 'agentpass123' })).status, 400);
    assert.equal((await n.post('/api/link/accept', { token, kind: 'invite', name: 'New', password: 'agentpass123', acceptTerms: true })).status, 200, 'the link still works after a refused try');
    const acc = store.findAccountByEmail('newbie@example.com');
    assert.equal(acc.termsVersion, '2027-01');
    assert.ok(acc.acceptedAt);
    assert.equal((await n.get('/api/me')).data.termsRequired, false);

    // Setup has its own checkbox: an agent who hasn't accepted can still finish setup by ticking it.
    process.env.TERMS_VERSION = '2027-02';
    const d = await n.post('/api/setup/draft', { answers: { name: 'New Agent', products: ['final_expense'] } });
    assert.equal(d.status, 200, 'setup stays open before accepting');
    d.data.config.story.insights[0].confirmed = true;
    assert.equal((await n.post('/api/setup/finish', { config: d.data.config, accept: true })).status, 400);
    assert.equal((await n.post('/api/setup/finish', { config: d.data.config, accept: true, acceptTerms: true })).status, 200);
    assert.equal(store.findAccountByEmail('newbie@example.com').termsVersion, '2027-02');

    // Admins run the service: never asked, and they see who has accepted.
    assert.equal((await admin.get('/api/me')).data.termsRequired, false);
    const o = await admin.get('/api/admin/overview');
    assert.equal(o.status, 200);
    const members = o.data.workspaces.flatMap(w => w.members);
    assert.equal(members.find(m => m.email === 'newbie@example.com').termsCurrent, true);
    assert.equal(members.find(m => m.email === 'step1@example.com').termsCurrent, false);
  } finally {
    ['TERMS_URL', 'PRIVACY_URL', 'TERMS_VERSION'].forEach(k => delete process.env[k]);
  }
});

test('terms: bad URLs keep the feature off', async () => {
  Object.assign(process.env, { TERMS_URL: 'javascript:alert(1)', PRIVACY_URL: 'https://example.com/privacy' });
  try {
    const { terms } = await import('../server.js');
    assert.equal(terms().on, false);
  } finally { delete process.env.TERMS_URL; delete process.env.PRIVACY_URL; }
});

/* ---------------- Step 3: AI voice disclosure ---------------- */
test('voiceover posts say the voice is AI (Brand toggle), and the note passes the post checks', async () => {
  const core = await import('../mixer-core.js');
  const { writePost } = await import('../stages/script.js');
  const cfg = core.migrate(core.DEFAULT_CONFIG);
  cfg.story = { ...cfg.story, ...starterStory(['final_expense']) };
  cfg.look.name = 'Jane Smith';
  assert.equal(cfg.voice.aiNote, 'on', 'on by default');
  assert.equal(core.migrate({ ...cfg, voice: { ...cfg.voice, aiNote: 'maybe' } }).voice.aiNote, 'on');
  assert.equal(core.migrate({ ...cfg, voice: { ...cfg.voice, aiNote: 'off' } }).voice.aiNote, 'off');
  const picks = { insight: cfg.story.insights[1], solution: cfg.story.solutions[1], recent: [] };
  const caption = 'Health questions instead of an exam?\nMany policies work this way. Message me.\n#LifeInsurance #FinalExpense';
  const ask = async () => JSON.stringify({ caption });
  const scenes = [{ text: 'Hi', say: 'Hi' }];

  cfg.output.mode = 'voiceover';
  const post = await writePost(cfg, picks, scenes, ask, () => {});
  assert.ok(post.endsWith('\n' + core.AI_VOICE_NOTE), post);
  assert.equal(core.validatePost(JSON.stringify({ caption: post }), cfg, picks).ok, true, 'passes validatePost');

  cfg.look.disclaimer = 'Licensed in NM.';
  const withSmall = await writePost(cfg, picks, scenes, async () => JSON.stringify({ caption: caption + '\nLicensed in NM.' }), () => {});
  assert.deepEqual(withSmall.split('\n').slice(-2), [core.AI_VOICE_NOTE, 'Licensed in NM.'], 'small print stays the last line');
  assert.equal(core.validatePost(JSON.stringify({ caption: withSmall }), cfg, picks).ok, true);
  assert.equal(core.withAiVoiceNote(withSmall, cfg), withSmall, 'never added twice');

  cfg.voice.aiNote = 'off'; cfg.look.disclaimer = '';
  assert.equal(await writePost(cfg, picks, scenes, ask, () => {}), caption, 'toggle off: no note');
  cfg.voice.aiNote = 'on'; cfg.output.mode = 'captions';
  assert.equal(await writePost(cfg, picks, scenes, ask, () => {}), caption, 'captions-only videos have no voice to disclose');
  assert.match(portalSource(), /data-bind="voice\.aiNote"|onOff\('voice\.aiNote'/, 'the Brand tab has the toggle');
});

/* ---------------- Step 4: transactional email ---------------- */
async function fakeMail() {
  const got = [];
  let fail = false;
  const srv = http.createServer(async (req, res) => {
    let raw = ''; for await (const x of req) raw += x;
    got.push({ path: req.url, headers: req.headers, body: JSON.parse(raw || '{}') });
    res.writeHead(fail ? 422 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(fail ? { ErrorCode: 300, Message: 'Invalid From address' } : { MessageID: 'm' + got.length, id: 'r' + got.length }));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { got, base: `http://127.0.0.1:${srv.address().port}`, fail: v => { fail = v; }, close: () => srv.close() };
}
const MAIL_KEYS = ['EMAIL_PROVIDER', 'EMAIL_API_KEY', 'EMAIL_FROM', 'EMAIL_API_BASE', 'EMAIL_REPLY_TO'];

test('email: off without a key; invites and resets are emailed with Postmark, and the link is still returned', async () => {
  const mail = await import('../lib/email.js');
  assert.equal(mail.emailOn(), false);
  const admin = client(port);
  store.createAccount({ email: 'boss4@example.com', role: 'admin', hash: await auth.hashPassword('bosspass1234') });
  await admin.post('/api/login', { email: 'boss4@example.com', password: 'bosspass1234' });
  const off = await admin.post('/api/admin/invite', { email: 'nomail@example.com', workspaceName: 'No mail', comped: true });
  assert.equal(off.data.emailed, false, 'no key: copy-the-link flow');
  assert.match(off.data.link, /#\/invite\//);
  assert.equal((await client(port).post('/api/password/forgot', { email: 'boss4@example.com' })).status, 400, 'no self-serve reset without email');

  const fm = await fakeMail();
  Object.assign(process.env, { EMAIL_PROVIDER: 'postmark', EMAIL_API_KEY: 'pm-token', EMAIL_FROM: 'Agent Reels <hello@example.com>', EMAIL_API_BASE: fm.base, EMAIL_REPLY_TO: 'help@example.com' });
  try {
    assert.equal((await admin.get('/api/me')).data.email, true);
    const inv = await admin.post('/api/admin/invite', { email: 'mailed@example.com', workspaceName: 'Mailed Agency', comped: true });
    assert.equal(inv.status, 200);
    assert.equal(inv.data.emailed, true);
    assert.match(inv.data.link, /#\/invite\//, 'the link is still there to copy');
    const m = fm.got.at(-1);
    assert.equal(m.path, '/email');
    assert.equal(m.headers['x-postmark-server-token'], 'pm-token');
    assert.equal(m.body.To, 'mailed@example.com');
    assert.equal(m.body.From, 'Agent Reels <hello@example.com>');
    assert.equal(m.body.ReplyTo, 'help@example.com');
    assert.match(m.body.Subject, /invited/);
    assert.ok(m.body.TextBody.includes(inv.data.link) && m.body.HtmlBody.includes('Mailed Agency'));

    const acc = store.findAccountByEmail('step1@example.com');
    const rs = await admin.post('/api/admin/reset', { accountId: acc.id });
    assert.equal(rs.data.emailed, true);
    assert.equal(fm.got.at(-1).body.To, 'step1@example.com');
    assert.ok(fm.got.at(-1).body.TextBody.includes(rs.data.link));

    // Forgot password: same answer either way, email only for real accounts.
    const before = fm.got.length;
    const anon = client(port);
    assert.equal((await anon.post('/api/password/forgot', { email: 'nobody-here@example.com' })).status, 200);
    assert.equal(fm.got.length, before, 'unknown address: nothing sent');
    assert.equal((await anon.post('/api/password/forgot', { email: 'STEP1@example.com' })).status, 200);
    assert.equal(fm.got.length, before + 1);
    const token = fm.got.at(-1).body.TextBody.match(/#\/reset\/([\w-]+)/)[1];
    assert.equal((await anon.post('/api/link/accept', { token, kind: 'reset', password: 'freshpass12345' })).status, 200, 'the emailed link works');

    // A provider error doesn't lose the link.
    fm.fail(true);
    const bad = await admin.post('/api/admin/invite', { email: 'bounce@example.com', workspaceName: 'Bounce', comped: true });
    assert.equal(bad.status, 200);
    assert.equal(bad.data.emailed, false);
    assert.match(bad.data.emailError, /Invalid From address/);
    assert.match(bad.data.link, /#\/invite\//);
    fm.fail(false);
  } finally { MAIL_KEYS.forEach(k => delete process.env[k]); fm.close(); }
});

test('email: Resend format and the Monday review reminder', async () => {
  const mail = await import('../lib/email.js');
  const { emailJobs } = await import('../server.js');
  const fm = await fakeMail();
  Object.assign(process.env, { EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: 're_key', EMAIL_FROM: 'hello@example.com', EMAIL_API_BASE: fm.base, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_mail', STRIPE_API_BASE: fm.base + '/stripe' });
  try {
    await mail.send({ to: 'x@example.com', subject: 'Hi', text: 't', html: '<p>t</p>' });
    const r = fm.got.at(-1);
    assert.equal(r.path, '/emails');
    assert.equal(r.headers.authorization, 'Bearer re_key');
    assert.deepEqual(r.body.to, ['x@example.com']);

    // Monday 9am in Denver with a video waiting: one reminder per Monday; agents can turn it off.
    const { c, ws } = await agent('payer@example.com');
    fakeVideo(ws, 'pending');
    const monday = new Date('2026-10-19T15:00:00Z');
    assert.deepEqual((await mail.reviewReminders(new Date('2026-10-20T15:00:00Z'))).filter(x => x.ws === ws), [], 'Tuesday: nothing');
    const rem = (await mail.reviewReminders(monday)).filter(x => x.ws === ws);
    assert.deepEqual(rem, [{ ws, count: 1, sent: 1 }]);
    assert.match(fm.got.at(-1).body.subject, /1 video is ready for your review/);
    assert.deepEqual((await mail.reviewReminders(monday)).filter(x => x.ws === ws), [], 'once per Monday');
    assert.equal((await c.post('/api/account', { weeklyEmail: false })).data.account.weeklyEmail, false);
    store.updateWorkspace(ws, { reviewEmailDay: '' });
    assert.deepEqual((await mail.reviewReminders(monday)).filter(x => x.ws === ws), [], 'turned off under Account');
  } finally { [...MAIL_KEYS, 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_API_BASE'].forEach(k => delete process.env[k]); fm.close(); }
});

/* ---------------- Step 5: data export, deletion requests, the public deletion page ---------------- */
test('data: an agent downloads everything as JSON (no secrets), and can export even before accepting new terms', async () => {
  const { c, ws } = await agent('export@example.com');
  const v = fakeVideo(ws);
  assert.equal((await c.post(`/api/videos/${v.id}/approve`, { checklist: ['watched', 'footage', 'facts', 'rules'] })).status, 200);
  fakeVideo(ws, 'pending');
  store.addNote(ws, 'Likes short hooks');
  const r = await c.get('/api/data/export');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /attachment; filename=".+-data-\d{4}-\d{2}-\d{2}\.json"/);
  const d = r.data;
  assert.equal(d.format, 'agent-reels-export-1');
  assert.equal(d.workspace.id, ws);
  assert.equal(d.people.length, 1);
  assert.equal(d.people[0].email, 'export@example.com');
  assert.equal(d.settings.look.name, 'Jane Smith');
  assert.ok(d.settingsHistory.length >= 1, 'past versions of the settings are included');
  assert.equal(d.videos.length, 2);
  assert.equal(d.approvalRecords.length, 1);
  assert.equal(d.approvalRecords[0].videoId, v.id);
  assert.equal(d.approvalRecords[0].notice, APPROVAL_NOTE);
  assert.match(d.approvalRecords[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(d.coachNotes[0].text, 'Likes short hooks');
  const raw = JSON.stringify(d);
  assert.doesNotMatch(raw, /"hash"|scrypt|"token"/, 'no password hashes, sessions or tokens');

  // Someone who won't accept new terms can still take their data (and ask to be deleted).
  Object.assign(process.env, { TERMS_URL: 'https://example.com/terms', PRIVACY_URL: 'https://example.com/privacy', TERMS_VERSION: 'export-v' });
  try {
    assert.equal((await c.get('/api/videos')).status, 403);
    assert.equal((await c.get('/api/data/export')).status, 200);
    const req = await c.post('/api/data/delete-request', { confirm: true });
    assert.equal(req.status, 200);
    assert.equal((await c.del('/api/data/delete-request')).status, 200);
  } finally { ['TERMS_URL', 'PRIVACY_URL', 'TERMS_VERSION'].forEach(k => delete process.env[k]); }

  // Only their own workspace: another agent's export never includes it.
  const other = await agent('export-other@example.com');
  assert.ok(!JSON.stringify((await other.c.get('/api/data/export')).data).includes('export@example.com'));
  assert.equal((await client(port).get('/api/data/export')).status, 401);
});

test('data: deletion is requested by the agent, confirmed by an admin, and removes everything', async () => {
  const fm = await fakeMail();
  Object.assign(process.env, { EMAIL_PROVIDER: 'postmark', EMAIL_API_KEY: 'pm-token', EMAIL_FROM: 'hello@example.com', EMAIL_API_BASE: fm.base });
  try {
    const admin = client(port);
    store.createAccount({ email: 'boss5@example.com', role: 'admin', hash: await auth.hashPassword('bosspass1234') });
    await admin.post('/api/login', { email: 'boss5@example.com', password: 'bosspass1234' });
    const { c, ws } = await agent('leaving@example.com');
    const v = fakeVideo(ws, 'pending');
    fs.mkdirSync(path.join(process.env.DATA_DIR, 'assets', ws, v.id), { recursive: true });
    // A second login in the same workspace, and an unused invite into it.
    store.createAccount({ email: 'assistant@example.com', role: 'agent', workspaceId: ws, hash: await auth.hashPassword('assistpass123') });
    const helper = client(port);
    await helper.post('/api/login', { email: 'assistant@example.com', password: 'assistpass123' });
    const invite = await admin.post('/api/admin/invite', { email: 'late@example.com', workspaceId: ws });
    const inviteToken = invite.data.link.split('/').pop();

    // The admin can't delete a workspace that hasn't asked.
    assert.equal((await admin.post(`/api/admin/workspaces/${ws}/delete`, { confirm: 'leaving@example.com' })).status, 409);
    // Asking needs the box ticked; then it's stored, the admin is alerted and the agent emailed.
    assert.equal((await c.post('/api/data/delete-request', {})).status, 400);
    const sentBefore = fm.got.length;
    const asked = await c.post('/api/data/delete-request', { confirm: true, note: 'Retiring' });
    assert.equal(asked.status, 200);
    assert.equal(asked.data.emailed, true);
    assert.equal(fm.got.length, sentBefore + 1);
    assert.equal(fm.got.at(-1).body.To, 'leaving@example.com');
    assert.match(fm.got.at(-1).body.Subject, /request to delete/);
    assert.ok(asked.data.workspace.deletionRequest.at);
    assert.equal((await c.get('/api/me')).data.workspace.deletionRequest.byName, 'leaving@example.com');
    const { listAlerts } = await import('../lib/alerts.js');
    assert.ok(listAlerts().some(a => a.ws === ws && a.title === 'Data deletion requested' && /Retiring/.test(a.text)));
    const card = (await admin.get('/api/admin/overview')).data.workspaces.find(w => w.id === ws);
    assert.equal(card.deletionRequest.email, 'leaving@example.com');
    assert.equal(card.deletionRequest.note, 'Retiring');
    // Asking twice doesn't send a second email.
    assert.equal((await c.post('/api/data/delete-request', { confirm: true })).data.emailed, false);

    // Confirming: the typed name must match.
    assert.equal((await admin.post(`/api/admin/workspaces/${ws}/delete`, { confirm: 'wrong name' })).status, 400);
    assert.ok(store.getWorkspace(ws), 'nothing deleted yet');
    const done = await admin.post(`/api/admin/workspaces/${ws}/delete`, { confirm: 'LEAVING@example.com' });
    assert.equal(done.status, 200);
    assert.deepEqual({ logins: done.data.deleted.logins, videos: done.data.deleted.videos }, { logins: 2, videos: 1 });
    assert.equal(done.data.emailed, true);
    assert.match(fm.got.at(-1).body.Subject, /data was deleted/);
    assert.equal(fm.got.at(-1).body.To, 'leaving@example.com');

    // Everything is gone: workspace, files, logins, sessions, and the unused invite.
    assert.equal(store.getWorkspace(ws), null);
    assert.ok(!fs.existsSync(path.join(process.env.DATA_DIR, 'workspaces', ws)));
    assert.ok(!fs.existsSync(path.join(process.env.VIDEOS_DIR, ws)));
    assert.ok(!fs.existsSync(path.join(process.env.DATA_DIR, 'assets', ws)));
    assert.equal(store.findAccountByEmail('leaving@example.com'), null);
    assert.equal(store.findAccountByEmail('assistant@example.com'), null);
    assert.equal((await c.get('/api/me')).data.account, null, 'logged out everywhere');
    assert.equal((await helper.get('/api/videos')).status, 401);
    assert.equal((await client(port).post('/api/link/check', { token: inviteToken, kind: 'invite' })).status, 410, 'old invites stop working');
    assert.ok(!(await admin.get('/api/admin/overview')).data.workspaces.some(w => w.id === ws));
    assert.ok(listAlerts().some(a => a.ws === ws && a.title === 'Workspace deleted'));
  } finally { MAIL_KEYS.forEach(k => delete process.env[k]); fm.close(); }
});

test('data: the agent or the admin can cancel a deletion request; admins can’t file one', async () => {
  const admin = client(port);
  store.createAccount({ email: 'boss5b@example.com', role: 'admin', hash: await auth.hashPassword('bosspass1234') });
  await admin.post('/api/login', { email: 'boss5b@example.com', password: 'bosspass1234' });
  const { c, ws } = await agent('maybe@example.com');
  await c.post('/api/data/delete-request', { confirm: true });
  const back = await c.del('/api/data/delete-request');
  assert.equal(back.status, 200);
  assert.equal(back.data.workspace.deletionRequest, null);
  await c.post('/api/data/delete-request', { confirm: true });
  assert.equal((await admin.del(`/api/admin/workspaces/${ws}/delete-request`)).status, 200, 'admin declines');
  assert.equal(store.getWorkspace(ws).deletionRequest, null);
  assert.equal((await admin.post(`/api/admin/workspaces/${ws}/delete`, { confirm: 'maybe@example.com' })).status, 409, 'declined: nothing to confirm');
  assert.ok(store.getWorkspace(ws));
  await admin.post('/api/admin/open', { workspaceId: ws });
  assert.equal((await admin.post('/api/data/delete-request', { confirm: true })).status, 400, 'an admin helping in the workspace can’t ask for it');
  assert.equal((await admin.get('/api/data/export')).status, 200, 'but can download it for them');
});

test('data: deleting waits for a video that is rendering, and cancels videos waiting in line', async () => {
  const queue = await import('../lib/queue.js');
  const data = await import('../lib/data.js');
  const { ws } = await agent('busy@example.com');
  const job = queue.enqueue({ ws, kind: 'video' });
  queue._patch(job.id, { status: 'running' });
  assert.throws(() => data.deleteWorkspace(ws), /being made/);
  queue._patch(job.id, { status: 'queued' });
  data.deleteWorkspace(ws);
  assert.equal(queue.getJob(job.id).status, 'canceled');
  assert.equal(store.getWorkspace(ws), null);
});

test('data: the public deletion page needs no login and names the contact address', async () => {
  const anon = client(port);
  const plain = await anon.get('/data-deletion');
  assert.equal(plain.status, 200);
  assert.match(plain.headers.get('content-type'), /text\/html/);
  const html = plain.data.toString();
  assert.match(html, /How to delete your data/);
  assert.match(html, /Account/);
  assert.match(html, /Apps and websites/);
  assert.match(html, /within 14 days/);
  assert.match(html, /contact the person who set up your account/, 'no contact set: a fallback, never a raw placeholder');
  assert.doesNotMatch(html, /\{\{/);
  process.env.SUPPORT_EMAIL = 'privacy@example.com';
  try {
    const withContact = (await anon.get('/data-deletion.html')).data.toString();
    assert.match(withContact, /<a href="mailto:privacy@example\.com">privacy@example\.com<\/a>/);
    process.env.SUPPORT_EMAIL = 'bad"<script>@x.com';
    assert.doesNotMatch((await anon.get('/data-deletion')).data.toString(), /<script>/, 'a bad address is ignored');
  } finally { delete process.env.SUPPORT_EMAIL; }
  assert.match(portalSource(), /href="\/data-deletion"/, 'linked from the login page and Account');
});

/* ---------------- Step 6: spend guard (monthly AI cost cap per workspace) ---------------- */
test('spend guard: default cap from .env, Admin override, 0 = no cap', async () => {
  const usage = await import('../lib/usage.js');
  delete process.env.AI_COST_CAP_USD;
  assert.equal(usage.defaultCap(), 20, '$20 when .env doesn’t say');
  process.env.AI_COST_CAP_USD = '7.5';
  try {
    assert.equal(usage.defaultCap(), 7.5);
    assert.equal(usage.capFor({ limits: {} }), 7.5);
    assert.equal(usage.capFor({ limits: { aiCostUsd: 40 } }), 40, 'Admin override wins');
    assert.equal(usage.capFor({ limits: { aiCostUsd: 0 } }), 0, '0 = no cap for this workspace');
    process.env.AI_COST_CAP_USD = '0';
    assert.equal(usage.defaultCap(), 0);
    process.env.AI_COST_CAP_USD = 'lots';
    assert.equal(usage.defaultCap(), 20, 'nonsense falls back to $20');
  } finally { delete process.env.AI_COST_CAP_USD; }

  const admin = client(port);
  store.createAccount({ email: 'boss6@example.com', role: 'admin', hash: await auth.hashPassword('bosspass1234') });
  await admin.post('/api/login', { email: 'boss6@example.com', password: 'bosspass1234' });
  const { ws } = await agent('capped@example.com');
  await admin.post(`/api/admin/workspaces/${ws}`, { videosPerMonth: 12 });
  assert.equal((await admin.post(`/api/admin/workspaces/${ws}`, { aiCostUsd: '$35' })).status, 200);
  assert.deepEqual(store.getWorkspace(ws).limits, { videosPerMonth: 12, aiCostUsd: 35 }, 'the video limit is kept');
  let card = (await admin.get('/api/admin/overview')).data.workspaces.find(w => w.id === ws);
  assert.equal(card.spend.cap, 35);
  assert.equal(card.spend.custom, true);
  assert.equal((await admin.post(`/api/admin/workspaces/${ws}`, { aiCostUsd: '-3' })).status, 400);
  assert.equal((await admin.post(`/api/admin/workspaces/${ws}`, { aiCostUsd: 'abc' })).status, 400);
  await admin.post(`/api/admin/workspaces/${ws}`, { aiCostUsd: '' });
  card = (await admin.get('/api/admin/overview')).data.workspaces.find(w => w.id === ws);
  assert.deepEqual({ cap: card.spend.cap, custom: card.spend.custom }, { cap: 20, custom: false }, 'blank = back to the default');
  assert.equal((await admin.get('/api/admin/overview')).data.system.aiCap, 20);
});

test('spend guard: alert at 80%, pause at 100% (videos, tests, coach, queued jobs), resume when raised', async () => {
  const usage = await import('../lib/usage.js');
  const { listAlerts } = await import('../lib/alerts.js');
  const queue = await import('../lib/queue.js');
  const { enqueueVideos, runJob } = await import('../server.js');
  const admin = client(port);
  store.createAccount({ email: 'boss6b@example.com', role: 'admin', hash: await auth.hashPassword('bosspass1234') });
  await admin.post('/api/login', { email: 'boss6b@example.com', password: 'bosspass1234' });
  const { c, ws } = await agent('spender@example.com');
  await admin.post(`/api/admin/workspaces/${ws}`, { aiCostUsd: 1 });
  const alerts = () => listAlerts().filter(a => a.ws === ws && a.kind === 'spend');

  // Under 80%: nothing. Crossing 80%: one warning, not repeated.
  const m = usage.meter(ws);
  m.tts('gpt-4o-mini-tts', 60 * 50, 0);          // $0.75
  assert.equal(alerts().length, 0);
  assert.equal((await c.get('/api/me')).data.workspace.spend.warn, false);
  m.tts('gpt-4o-mini-tts', 60 * 5, 0);           // $0.825
  assert.equal(alerts().length, 1);
  assert.match(alerts()[0].title, /80%/);
  assert.equal(alerts()[0].level, 'warning');
  m.tts('gpt-4o-mini-tts', 60, 0);               // $0.84
  assert.equal(alerts().length, 1, 'once per month');
  const me = (await c.get('/api/me')).data.workspace.spend;
  assert.deepEqual(me, { pct: 84, warn: true, over: false }, 'agents see a percentage, never dollars');
  assert.equal((await c.post('/api/jobs', { count: 1 })).status, 200, 'still allowed under 100%');

  // Crossing 100%: an error alert, and everything that calls the AI is refused.
  m.tts('gpt-4o-mini-tts', 60 * 11, 0);          // $1.005
  assert.equal(alerts().length, 2);
  assert.match(alerts()[0].title, /cap reached/);
  assert.equal(alerts()[0].level, 'error');
  for (const [p, body] of [['/api/jobs', { count: 1 }], ['/api/script', {}], ['/api/footage-test', { keyword: 'kitchen' }], ['/api/coach', { messages: [{ role: 'user', content: 'Hi' }] }], ['/api/coach/reply', { message: 'hello' }]]) {
    const r = await c.post(p, body);
    assert.equal(r.status, 402, p);
    assert.equal(r.data.spend, true, p);
    assert.match(r.data.error, /AI budget/);
  }
  assert.throws(() => enqueueVideos(ws, 1, 'overnight', 'overnight'), /AI budget/, 'overnight videos stop too');
  assert.equal((await c.get('/api/me')).data.workspace.spend.over, true);
  // Setup drafts fall back to the starter content instead of calling the AI.
  // (Setup happens before a workspace is onboarded, v14.)
  process.env.OPENAI_API_KEY = 'sk-test';
  store.updateWorkspace(ws, { onboarded: false });
  try {
    const d = await c.post('/api/setup/draft', { answers: {} });
    assert.equal(d.status, 200);
    assert.match(d.data.note, /paused this month/);
  } finally { delete process.env.OPENAI_API_KEY; store.updateWorkspace(ws, { onboarded: true }); }
  // A video already waiting in line fails quietly with the same reason (you were alerted once already).
  const waiting = queue.listJobs(ws).find(j => j.status === 'queued');
  assert.ok(waiting, 'the video queued at 84% is still in line');
  await assert.rejects(runJob(waiting, () => {}), e => e.quiet === true && e.permanent === true && /AI budget/.test(e.message));
  queue.cancel(ws, waiting.id);

  // Raising the cap resumes it right away.
  await admin.post(`/api/admin/workspaces/${ws}`, { aiCostUsd: 5 });
  assert.equal((await c.get('/api/me')).data.workspace.spend.over, false);
  assert.equal((await c.post('/api/jobs', { count: 1 })).status, 200);
  // 0 = no cap at all.
  await admin.post(`/api/admin/workspaces/${ws}`, { aiCostUsd: 0 });
  m.tts('gpt-4o-mini-tts', 60 * 1000, 0);
  assert.equal((await c.get('/api/me')).data.workspace.spend.over, false);
  assert.equal(alerts().length, 2, 'no alerts without a cap');
  queue.listJobs(ws).filter(j => j.status === 'queued').forEach(j => queue.cancel(ws, j.id));
});
