// v15 Phase 9 in a real browser: the reviewer's Sign-off page (send back with a note, sign off), the
// agent's Review while a video waits, and keyword replies. Runs in Chromium when Playwright is around
// (PLAYWRIGHT_DIR, or /opt/node-tools/node_modules), and is skipped otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { tempEnv, startStubs } from './helpers.js';

tempEnv();
let chromium = null;
try { chromium = createRequire(path.join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x.js'))('playwright').chromium; } catch { chromium = null; }
const exe = [process.env.PLAYWRIGHT_CHROMIUM, '/opt/pw-browsers/chromium'].find(p => p && fs.existsSync(p));
const skip = !chromium ? 'Playwright isn’t installed here' : false;

let server, stubs, browser, base, store, studio, replies, ws, draftId;
test.before(async () => {
  if (skip) return;
  stubs = await startStubs();
  store = await import('../lib/store.js');
  studio = await import('../lib/studio.js');
  replies = await import('../lib/replies.js');
  const signoff = await import('../lib/signoff.js');
  const auth = await import('../lib/auth.js');
  const M = await import('../mixer-core.js');
  const { starterStory } = await import('../templates.js');
  const S = await import('../server.js');
  server = await S.start({ port: 0, scheduler: false, worker: false });
  base = `http://127.0.0.1:${server.address().port}`;
  ws = store.createWorkspace({ name: 'Nine Agent', comped: true });
  const cfg = store.loadConfig(ws.id);
  cfg.story = { ...cfg.story, ...starterStory(['final_expense']) };
  cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); i.source = 'Carrier guide'; });
  cfg.look = { ...cfg.look, name: 'Dana Agent', bookingUrl: 'https://calendly.com/dana', disclaimer: 'NM Lic #123' };
  store.saveConfig(ws.id, cfg);
  store.updateWorkspace(ws.id, { onboarded: true });
  store.createAccount({ email: 'nine@example.com', name: 'Dana Agent', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('ninepass1234') });
  const r = store.createAccount({ email: 'rev@example.com', name: 'Rita Review', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('revpass12345') });
  store.setMembership(r.id, ws.id, { role: 'reviewer' });
  signoff.setOn(ws.id, true, 'test');
  const now = Date.now();
  for (const id of ['w1', 'w2']) { fs.writeFileSync(store.videoPath(ws.id, `video_${id}.mp4`), 'x'); store.addVideo(ws.id, { id, status: 'approved', version: 1, file: `video_${id}.mp4`, createdAt: new Date().toISOString(), approval: { at: new Date().toISOString(), byName: 'Dana Agent' }, scenes: [{ text: `Opening of ${id}`, keyword: 'family' }, { text: 'Second', keyword: 'x' }], meta: { painPoint: 'Funeral costs' }, post: 'The post text', preflight: [{ ok: true, label: 'No prices' }] }); }
  for (const [id, hook, views] of [['a1', 'Funeral costs add up fast.', 400], ['a2', 'Who pays for your funeral?', 900]]) store.addVideo(ws.id, { id, status: 'posted', version: 1, file: `video_${id}.mp4`, createdAt: new Date(now - 9 * 864e5).toISOString(), posted: { at: new Date(now - 8 * 864e5).toISOString() }, results: { views, messages: 0 }, bookings: { total: 1 }, scenes: [{ text: hook, keyword: 'family' }], meta: { painPoint: 'Funeral costs' }, post: 'p', preflight: [] });
  const U = M.usableRoutes(store.loadConfig(ws.id)), p = U.pains[0];
  draftId = studio.create(ws.id, store.loadConfig(ws.id), { painId: p.id, audienceId: U.audiences.find(x => p.links.includes(x.id)).id, insightIds: [U.insights.find(i => i.links.includes(p.id)).id], scenes: 6, format: 'question', structure: 'classic' }).id;
  browser = await chromium.launch(exe ? { executablePath: exe } : {});
});
test.after(async () => { await browser?.close(); server?.close(); stubs?.close(); });

async function open(email, password, hash = '') {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.status() >= 400 && !/favicon|\/media\//.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${base}/#/login`);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', password);
  await page.click('form button[type=submit], form .btn.primary');
  await page.waitForSelector('.nav');
  if (hash) await page.evaluate(h => { location.hash = h; }, hash);
  return { page, errors };
}
const text = async (page, sel) => (await page.$eval(sel, e => e.innerText)).replace(/\s+/g, ' ');

test('the reviewer lands on Sign-off: sends one back with a note, signs one off; nothing else is asked for', { skip, timeout: 120000 }, async () => {
  const { page, errors } = await open('rev@example.com', 'revpass12345');
  await page.waitForSelector('[data-act="so-ok"]');
  assert.equal(await page.evaluate(() => location.hash), '#/signoff');
  assert.deepEqual(await page.$$eval('.nav a', a => a.map(x => x.textContent)), ['Sign-off']);   // (v15 Phase 10: Guide and Account are under the initial)
  assert.equal(await page.$('.coach-fab'), null, 'no coach for a reviewer');
  assert.match(await text(page, 'main'), /End card disclaimer: NM Lic #123/);
  await page.click('[data-so="w1"] [data-act="so-back"]');
  await page.fill('[data-form="so-back"] textarea', 'Add the carrier name to scene 2.');
  await page.click('[data-form="so-back"] .btn.primary');
  await page.waitForFunction(() => !document.querySelector('[data-so="w1"]'));
  await page.click('[data-so="w2"] [data-act="so-ok"]');
  await page.waitForSelector('text=Nothing is waiting for you');
  assert.deepEqual([store.getVideo(ws.id, 'w1').status, store.getVideo(ws.id, 'w2').signoff.status], ['pending', 'ok']);
  assert.deepEqual(errors, []);
  await page.close();
});

test('the agent: the note on the sent-back video, a signed-off one ready to post, and the reviewer panel', { skip, timeout: 120000 }, async () => {
  const { page, errors } = await open('nine@example.com', 'ninepass1234', '#/review');
  await page.waitForSelector('[data-vid="w1"]');
  assert.match(await text(page, '[data-vid="w1"]'), /Rita Review sent this back .*“Add the carrier name to scene 2\.”/);
  assert.match(await text(page, '[data-vid="w2"]'), /Signed off by Rita Review/);
  assert.ok(await page.$('[data-vid="w2"] [data-act="save-video"]'), 'signed off: it can be posted');
  await page.evaluate(() => { location.hash = '#/team'; });
  await page.waitForSelector('#reviewerPanel');
  assert.match(await text(page, '#reviewerPanel'), /Rita Review.*Approved videos wait for sign-off/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('keyword replies: add one, turn them on, try a comment', { skip, timeout: 120000 }, async () => {
  const { page, errors } = await open('nine@example.com', 'ninepass1234', '#/autopilot');   // keyword replies live in Setup → Autopilot
  await page.waitForSelector('#repliesPanel [data-act="reply-new"]');
  await page.click('[data-act="reply-new"]');
  await page.fill('[data-form="reply-rule"] input[name=keyword]', 'plan');
  await page.fill('[data-form="reply-rule"] textarea', 'Plans from $5 a month: {link}');
  await page.click('[data-form="reply-rule"] .btn.primary');
  await page.waitForFunction(() => /prices/i.test(document.querySelector('[data-form="reply-rule"] [data-st]')?.textContent || ''));   // the rules hold
  await page.fill('[data-form="reply-rule"] textarea', 'Hi {name}! Here’s the checklist: {link}');
  await page.click('[data-form="reply-rule"] .btn.primary');
  await page.waitForSelector('#repliesPanel >> text=Approved by Dana Agent');
  await page.click('[data-act="replies-on"]');
  await page.waitForFunction(() => /Turn off/.test(document.querySelector('[data-act="replies-on"]')?.textContent || ''));
  await page.fill('[data-form="reply-try"] input', 'PLAN please!');
  await page.click('[data-form="reply-try"] button');
  await page.waitForSelector('#repliesPanel >> text=would send');
  assert.match(await text(page, '#repliesPanel'), /PLAN would send: “Hi Maria! Here’s the checklist:/);
  assert.equal(replies.state(ws.id).on, true);
  assert.deepEqual(errors.filter(e => !/^400 .*\/api\/replies\/rules$/.test(e)), [], 'only the refused wording');
  await page.close();
});
