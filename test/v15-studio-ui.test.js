// v15 Phase 7 in a real browser: Studio's three kinds (a stop with its one-tap fix, notes that don't
// block), Needs changes from the review card to the Desk, the Fix a scene clip picker, and Admin → Render
// rules (try first, save, undo). Runs in Chromium when Playwright is around (PLAYWRIGHT_DIR, or
// /opt/node-tools/node_modules), and is skipped otherwise.
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

let server, stubs, browser, base, store, studio, queue, paths, ws, sam, d;
const sc = (text, accent = '') => ({ text, accent, keyword: 'older woman kitchen', say: '' });
test.before(async () => {
  if (skip) return;
  stubs = await startStubs();
  store = await import('../lib/store.js');
  studio = await import('../lib/studio.js');
  queue = await import('../lib/queue.js');
  paths = await import('../lib/paths.js');
  const auth = await import('../lib/auth.js');
  const { starterStory } = await import('../templates.js');
  const S = await import('../server.js');
  server = await S.start({ port: 0, scheduler: false, worker: false });
  base = `http://127.0.0.1:${server.address().port}`;
  ws = store.createWorkspace({ name: 'UI Agent', comped: true });
  const cfg = store.loadConfig(ws.id);
  cfg.story = { ...cfg.story, ...starterStory(['final_expense']) };
  cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); i.source = 'Carrier guide'; });
  store.saveConfig(ws.id, cfg);
  store.updateWorkspace(ws.id, { onboarded: true, limits: { assistantSeats: 1 } });
  store.createAccount({ email: 'ui@example.com', name: 'Dana Agent', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('uipass123456') });
  sam = store.createAccount({ email: 'sam@example.com', name: 'Sam Helper', role: 'agent', workspaceId: null, hash: await auth.hashPassword('sampass12345') });
  store.setMembership(sam.id, ws.id, { role: 'assistant' });
  store.createAccount({ email: 'admin@example.com', role: 'admin', hash: await auth.hashPassword('adminpass1234') });
  d = studio.create(ws.id, cfg, { painId: 'fe_p1', audienceId: 'fe_a1', insightIds: [cfg.story.insights[0].id], scenes: 6, format: 'question', structure: 'classic' });
  studio.save(ws.id, d.id, { scenes: [sc('Who pays for your funeral someday?', 'funeral'), sc('Final expense insurance is a small policy', 'small'), sc('It is meant to cover funeral and end-of-life costs', 'Affordable'),
    sc('Ask me about a simple plan, $30 a month, for this', 'simple'), sc('Ask me how to get peace of mind', 'Ask'), sc(`${cfg.story.ctaAction || 'Message me'} and we can talk it through`, 'talk')] });
  // A Studio video the assistant submitted, and the files a fix needs.
  const scenes = [sc('Who pays for your funeral someday?', 'funeral'), sc('Final expense insurance is usually a small policy', 'small'), sc('It is meant to cover funeral and end-of-life costs', 'funeral')];
  store.addVideo(ws.id, { id: 'u1', file: 'video_u1.mp4', cover: '', status: 'pending', source: 'studio', by: sam.id, createdAt: new Date().toISOString(), mode: 'captions', meta: { painPoint: 'Funeral costs', madeIn: 'studio', draftId: d.id, music: 'calm.mp3', visual: 'older adults' }, scenes, clips: scenes.map((_, i) => ({ id: 1000 + i, checked: true, score: 3 })), post: 'Post', preflight: [{ ok: true, label: 'Checked' }], version: 1 });
  fs.mkdirSync(path.join(paths.DIRS.assets, ws.id, 'u1'), { recursive: true });
  fs.writeFileSync(path.join(paths.DIRS.assets, ws.id, 'u1', 'picks.json'), JSON.stringify({ insights: [cfg.story.insights[0]], format: 'question', structure: 'classic' }));
  browser = await chromium.launch(exe ? { executablePath: exe } : {});
});
test.after(async () => { await browser?.close(); server?.close(); stubs?.close(); });

async function open(email, password, hash) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${base}/#/login`);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', password);
  await page.click('form button[type=submit], form .btn.primary');
  await page.waitForSelector('.nav');
  await page.evaluate(h => { location.hash = h; }, hash);
  return { page, errors };
}
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v || Date.now() > end) return v; await new Promise(r => setTimeout(r, 100)); } };
const text = async (page, sel) => (await page.$eval(sel, e => e.innerText)).replace(/\s+/g, ' ');

test('Studio: a stop holds the render with its one-tap fix; after it, notes travel but don’t block', { skip, timeout: 120000 }, async () => {
  const { page, errors } = await open('ui@example.com', 'uipass123456', `#/studio/${d.id}`);
  await page.waitForSelector('#stChecks');
  await page.waitForFunction(() => document.querySelectorAll('[data-act="st-fix"]').length >= 2);
  assert.equal(await page.$eval('[data-act="st-render"]', e => e.disabled), true, 'a locked rule holds the render');
  // The dropped "usually" is on the scene that says the words around it, with its fix.
  assert.match(await text(page, '[data-stp="1"]'), /Dropped the qualifier.*Put “usually” back/);
  assert.match(await text(page, '[data-stp="2"]'), /highlighted instead/, 'fixed for you, said so');
  for (const label of ['Put “usually” back', 'Take out “$30”']) {
    await page.click(`[data-stp] [data-act="st-fix"]:has-text("${label}")`);
    await page.waitForFunction(l => ![...document.querySelectorAll('[data-act="st-fix"]')].some(b => b.textContent === l), label);
  }
  await page.waitForFunction(() => !document.querySelector('[data-act="st-render"]').disabled);
  assert.match(await text(page, '[data-act="st-render"]'), /Submit for review \(\d notes?\)/);
  await page.click('[data-act="st-notes"]');
  assert.match(await text(page, '#stChecks'), /overused ad wording.*Notes are suggestions/i);
  await until(() => studio.get(ws.id, d.id).scenes[3].text === 'Ask me about a simple plan for this');   // saved a moment after
  const saved = studio.get(ws.id, d.id).scenes.map(s => s.text);
  assert.equal(saved[1], 'Final expense insurance is usually a small policy');
  assert.equal(saved[3], 'Ask me about a simple plan for this', 'the price and the commas around it are gone');
  assert.deepEqual(errors, []);
  await page.close();
});

test('Review: the clip picker’s pick goes to the fix exactly', { skip, timeout: 120000 }, async () => {
  const { page, errors } = await open('ui@example.com', 'uipass123456', '#/review');
  await page.waitForSelector('[data-act="fix-open"][data-id="u1"]');
  // Fix a scene → Show clips → pick one → Re-render: the job carries the pick.
  await page.click('[data-act="fix-open"][data-id="u1"]');
  await page.click('[data-act="fix-clips"][data-i="2"]');
  await page.waitForSelector('[data-act="fix-pick"][data-i="2"]');
  const n = await page.$$eval('[data-act="fix-pick"][data-i="2"]', b => b.length);
  assert.ok(n >= 5 && n <= 10, String(n));
  await page.click('[data-act="fix-pick"][data-i="2"][data-k="0"]');
  assert.equal(await page.$eval('[data-act="fix-pick"][data-i="2"][data-k="0"]', b => b.getAttribute('aria-pressed')), 'true');
  assert.match(await text(page, '#main'), /Picked: it’ll be used as is/);
  await page.click('[data-act="fix-send"][data-id="u1"]');
  await page.waitForFunction(() => /re-render|being fixed|in a minute/i.test(document.getElementById('main').innerText));
  const job = queue.listJobs(ws.id).find(j => j.kind === 'fix' && j.opts.videoId === 'u1');
  assert.ok(job?.opts.picks?.[2]?.id, JSON.stringify(job?.opts));
  assert.ok(![1000, 1001, 1002].includes(job.opts.picks[2].id), 'never a clip the video already uses');
  queue.cancel(ws.id, job.id);
  assert.deepEqual(errors, []);
  await page.close();
});

test('Admin → Render rules: try a change on a script, save it, see it in the history, undo it', { skip, timeout: 120000 }, async () => {
  const { page, errors } = await open('admin@example.com', 'adminpass1234', '#/rules');
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForSelector('[data-rr-scope]');
  assert.equal(await page.$('[data-rr-level="price"]'), null, 'locked rules have no level to change');
  await page.selectOption('[data-rr-level="cliche"][data-ctx="draft"]', 'block');
  await page.fill('[data-rr-script]', 'Who pays for your funeral someday?\nFinal expense gives you peace of mind.\nMessage me');
  await page.click('[data-act="rr-try"]');
  await page.waitForFunction(() => /Blocks · Overused ad wording/.test(document.getElementById('main').innerText));
  assert.deepEqual(store.loadConfig(ws.id).rules.levels, {}, 'trying doesn’t save');
  await page.click('[data-act="rr-save"]');
  await page.waitForFunction(() => /drafts warn → block/.test(document.getElementById('main').innerText));
  assert.equal(store.loadConfig(ws.id).rules.levels.cliche.draft, 'block');
  await page.click('[data-act="rr-restore"][data-which="before"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-act="rr-restore"]').length >= 2);
  await page.waitForTimeout(300);
  assert.deepEqual(store.loadConfig(ws.id).rules.levels, {}, 'undone');
  assert.deepEqual(errors, []);
  await page.close();
});
