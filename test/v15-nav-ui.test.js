// In a real browser: three daily stops (Review, Create, Grow) and Setup's six
// steps; Account, Guide and Billing under the initial; where each person lands; older addresses still
// open; every Setup step shows its panels and saves like the pages they came from. Runs in Chromium
// when Playwright is around (PLAYWRIGHT_DIR, or /opt/node-tools/node_modules), and is skipped otherwise.
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

let server, stubs, browser, base, store, ws;
test.before(async () => {
  if (skip) return;
  stubs = await startStubs();
  store = await import('../lib/store.js');
  const auth = await import('../lib/auth.js');
  const { starterStory } = await import('../templates.js');
  const S = await import('../server.js');
  server = await S.start({ port: 0, scheduler: false, worker: false });
  base = `http://127.0.0.1:${server.address().port}`;
  ws = store.createWorkspace({ name: 'Ten Agent', comped: true });
  const cfg = store.loadConfig(ws.id);
  cfg.story = { ...cfg.story, ...starterStory(['final_expense']) };
  cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); i.source = 'Carrier guide'; });
  cfg.look = { ...cfg.look, name: 'Dana Agent', location: 'Gallup, NM' };
  store.saveConfig(ws.id, cfg);
  store.updateWorkspace(ws.id, { onboarded: true, limits: { assistantSeats: 1 } });
  for (let i = 0; i < 2; i++) store.addVideo(ws.id, { id: 'tv' + i, status: 'pending', version: 1, file: `video_tv${i}.mp4`, createdAt: new Date().toISOString(), scenes: [{ text: `Video ${i} line`, keyword: 'family' }], meta: { painPoint: 'Funeral costs' }, post: 'p', preflight: [] });
  store.createAccount({ email: 'ten@example.com', name: 'Dana Agent', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('tenpass12345') });
  const r = store.createAccount({ email: 'tenr@example.com', name: 'Rita Review', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('tenrpass1234') });
  store.setMembership(r.id, ws.id, { role: 'reviewer' });
  browser = await chromium.launch(exe ? { executablePath: exe } : {});
});
test.after(async () => { await browser?.close(); server?.close(); stubs?.close(); });

async function open(email, password) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.status() >= 400 && !/favicon|\/media\//.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${base}/#/login`);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', password);
  await page.click('form button[type=submit], form .btn.primary');
  await page.waitForSelector('.nav');
  return { page, errors };
}
const goto = async (page, hash, sel = 'main h1') => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForFunction(s => !document.querySelector('main > .empty .spin') && document.querySelector(s), sel); };
const tabs = page => page.$$eval('.nav a', a => a.map(x => x.textContent.replace(/\d+$/, '').trim()));
const current = page => page.$eval('.nav a[aria-current="page"]', a => a.textContent.replace(/\d+$/, '').trim()).catch(() => '');
const headings = page => page.$$eval('main h2', h => h.map(x => x.textContent.trim()));

test('the agent: lands on Review; three stops and Setup; the menu under the initial; old addresses still open', { skip, timeout: 180000 }, async () => {
  const { page, errors } = await open('ten@example.com', 'tenpass12345');
  await page.waitForFunction(() => location.hash === '#/review' && document.querySelector('main h1'));
  assert.deepEqual(await tabs(page), ['Review', 'Create', 'Grow', 'Setup']);
  // They all fit across a phone.
  assert.ok(await page.$eval('.nav', n => n.scrollWidth <= n.clientWidth + 1), 'no scrolling the tabs');
  // The initial's menu: Account, Guide (no Billing for a comped workspace), Log out; closes on a tap elsewhere.
  await page.click('.me-btn');
  assert.deepEqual(await page.$$eval('#mePop a, #mePop button', a => a.map(x => x.textContent.trim())), ['Account', 'Guide', 'Log out']);
  await page.mouse.click(30, 500);
  assert.equal(await page.$eval('#mePop', e => e.hidden), true);
  // Where each page sits in the bar.
  for (const [hash, tab] of [['#/review', 'Review'], ['#/create', 'Create'], ['#/grow', 'Grow'], ['#/communicate', 'Grow'], ['#/mindset', 'Grow'], ['#/profile', 'Setup'], ['#/team', 'Setup'], ['#/brand', 'Setup']]) {
    await goto(page, hash);
    assert.equal(await current(page), tab, hash);
  }
  // Grow's tabs.
  await goto(page, '#/grow');
  assert.deepEqual(await page.$$eval('.subnav a', a => a.map(x => x.textContent)), ['Results', 'Communicate', 'Mindset']);
  // Older addresses: Today and Leads open Review; Setup opens its first step; Content, Brand and Settings still open whole.
  await goto(page, '#/today');
  assert.equal(await page.evaluate(() => location.hash), '#/review');
  await goto(page, '#/setup');
  assert.equal(await page.evaluate(() => location.hash), '#/profile');
  for (const [hash, h1] of [['#/content', 'Content'], ['#/brand', 'Brand'], ['#/settings', 'Settings']]) { await goto(page, hash); assert.equal(await page.$eval('main h1', e => e.textContent), h1); }
  assert.deepEqual(errors, []);
  await page.close();
});

test('Setup’s six steps: each shows its panels, in order, with the way on; a change saves like before', { skip, timeout: 180000 }, async () => {
  const { page, errors } = await open('ten@example.com', 'tenpass12345');
  const expect = {
    profile: ['End card', 'Profile'],
    library: ['Checks', 'Your own clips'],
    voice: ['Voice', 'Your voice', 'Rules', 'What the app remembers'],
    look: ['Captions and footage', 'Video', 'Saved versions'],
    autopilot: ['Keyword replies', 'Also running by itself'],
    team: ['Compliance reviewer'],
  };
  for (const [step, want] of Object.entries(expect)) {
    await goto(page, `#/${step}`, '.steps');
    const h = await headings(page);
    for (const x of want) assert.ok(h.includes(x), `${step}: ${x} in ${JSON.stringify(h)}`);
    assert.equal(await page.$eval('.steps [aria-current="step"]', a => a.textContent.replace(/^\d+\s*/, '')), { profile: 'Profile', library: 'Library', voice: 'Voice and rules', look: 'Look', autopilot: 'Autopilot', team: 'Reviewer' }[step]);
  }
  // Library leaves "Your voice" to Voice and rules.
  await goto(page, '#/library', '.steps');
  assert.ok(!(await page.$$eval('[data-act="content-tab"]', b => b.map(x => x.dataset.v))).includes('voice'));
  // A change on a step: the save bar, then saved.
  await goto(page, '#/profile', '.steps');
  await page.fill('[data-bind="look.title"]', 'Licensed Agent, NM');
  await page.waitForFunction(() => !document.getElementById('savebar').hidden);
  assert.match(await page.$eval('#savebar', e => e.innerText), /Unsaved changes/);
  await page.click('#savebar [data-act="save"]');
  await page.waitForFunction(() => document.getElementById('savebar').hidden);
  assert.equal(store.loadConfig(ws.id).look.title, 'Licensed Agent, NM');
  // The way on.
  await page.click('.step-next a');
  await page.waitForFunction(() => location.hash === '#/library');
  assert.deepEqual(errors, []);
  await page.close();
});

test('the steps behave like their old pages: autolink, save redraws, one Never use, the connect return, the menu, phone strips', { skip, timeout: 240000 }, async () => {
  const { page, errors } = await open('ten@example.com', 'tenpass12345');
  // Library: adding a worry links it automatically and shows what it did (not a spinner left turning).
  const aud = store.loadConfig(ws.id).story.audiences[0].id;
  await page.route('**/api/content/autolink', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ parents: [aud], children: [], fit: {} }) }));
  await goto(page, '#/library/painPoints', '.steps');
  await page.fill('[data-form="add"][data-list="painPoints"] input[name=text]', 'Worried the kids would have to pay for the funeral');
  await page.click('[data-form="add"][data-list="painPoints"] button');
  await page.waitForFunction(() => /Linked automatically/.test(document.getElementById('main').innerText));
  assert.ok(!(await page.$eval('main', m => m.innerText)).includes('Linking it to what it fits'));
  await page.click('[data-act="discard"]').catch(() => {});
  await page.unroute('**/api/content/autolink');
  // Look: a save shows the new saved version straight away.
  await goto(page, '#/look', '.steps');
  const before = await page.$$eval('#versionSel option', o => o.length).catch(() => 0);
  await page.evaluate(() => { const s = document.querySelector('select[data-bind="look.font"]'); s.selectedIndex = (s.selectedIndex + 1) % s.options.length; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => !document.getElementById('savebar').hidden);
  await page.click('#savebar [data-act="save"]');
  await page.waitForFunction(n => document.querySelectorAll('#versionSel option').length > n, before);
  // Voice and rules: one Never use editor (in Rules), not two.
  await goto(page, '#/voice', '.steps');
  assert.equal(await page.$$eval('main', m => (m[0].innerText.match(/Words I never use/g) || []).length), 0);
  assert.equal(await page.$$eval('[data-form="rule"][data-k="neverUse"]', f => f.length), 1);
  // Back from connecting Instagram: Autopilot, with the toast, and a tidy address.
  await goto(page, '#/autopilot?ig=connected&msg=%40dana', '.steps');
  await page.waitForFunction(() => location.hash === '#/autopilot');
  assert.match(await page.$eval('#toast', t => t.textContent), /Instagram connected: @dana/);
  // On a phone the current step is in view (Autopilot sits past the edge otherwise).
  assert.ok(await page.$eval('.steps [aria-current="step"]', a => { const r = a.getBoundingClientRect(), s = a.parentElement.getBoundingClientRect(); return r.left >= s.left - 1 && r.right <= s.right + 1; }), 'the current step is in view');
  // The menu: Escape closes it and puts focus back on the initial; tabbing out closes it.
  await page.click('.me-btn');
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('#mePop', e => e.hidden), true);
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('me-btn')), true);
  await page.click('.me-btn');
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  assert.equal(await page.$eval('#mePop', e => e.hidden), true, 'tabbing out closes the menu');
  assert.deepEqual(errors, []);
  await page.close();
});

test('a reviewer lands on Sign-off', { skip, timeout: 120000 }, async () => {
  const { page, errors } = await open('tenr@example.com', 'tenrpass1234');
  await page.waitForFunction(() => location.hash === '#/signoff');
  assert.deepEqual(await tabs(page), ['Sign-off']);
  assert.deepEqual(errors, []);
  await page.close();
});
