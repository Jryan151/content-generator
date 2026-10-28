// v15 Phase 8 in a real browser: the simpler Studio start, the save bar away from the settings pages,
// and the phone details (the keyboard, the bottom of the screen). Runs in Chromium
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

let server, stubs, browser, base, store, links, ws;
test.before(async () => {
  if (skip) return;
  stubs = await startStubs();
  store = await import('../lib/store.js');
  links = await import('../lib/links.js');
  const auth = await import('../lib/auth.js');
  const { starterStory } = await import('../templates.js');
  const S = await import('../server.js');
  server = await S.start({ port: 0, scheduler: false, worker: false });
  base = `http://127.0.0.1:${server.address().port}`;
  ws = store.createWorkspace({ name: 'Fit Agent', comped: true });
  const cfg = store.loadConfig(ws.id);
  cfg.story = { ...cfg.story, ...starterStory() };
  cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); i.source = 'Carrier guide'; });
  cfg.look = { ...cfg.look, name: 'Dana Agent', title: 'Licensed Agent', location: 'Gallup, NM', bookingUrl: 'https://calendly.com/dana' };
  cfg.schedule = { ...cfg.schedule, keepReady: 2, autopost: { ...cfg.schedule.autopost, on: false, days: [1, 2, 3, 4, 5], time: '09:00' } };
  store.saveConfig(ws.id, cfg);
  store.updateWorkspace(ws.id, { onboarded: true });
  for (let i = 0; i < 3; i++) store.addVideo(ws.id, { id: 'ap' + i, status: 'approved', file: `video_ap${i}.mp4`, createdAt: new Date().toISOString(), approval: { at: new Date().toISOString() }, scenes: [{ text: `Approved video number ${['one', 'two', 'three'][i]}`, keyword: 'family' }], meta: { painPoint: 'Funeral costs' }, post: 'p', preflight: [] });
  store.addVideo(ws.id, { id: 'pe1', status: 'pending', file: 'video_pe1.mp4', createdAt: new Date().toISOString(), scenes: [{ text: 'Waiting one', keyword: 'family' }], meta: { painPoint: 'Funeral costs' }, post: 'p', preflight: [] });
  store.createAccount({ email: 'fit@example.com', name: 'Dana Agent', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('fitpass123456') });
  browser = await chromium.launch(exe ? { executablePath: exe } : {});
});
test.after(async () => { await browser?.close(); server?.close(); stubs?.close(); });

async function open(hash, { keyboard = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 700 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  // A stand-in for the phone keyboard: window.__kb(px) makes the visible area that much shorter.
  if (keyboard) await page.addInitScript(() => {
    const vv = new EventTarget(); let kb = 0;
    Object.defineProperties(vv, { height: { get: () => innerHeight - kb }, width: { get: () => innerWidth }, offsetTop: { get: () => 0 }, offsetLeft: { get: () => 0 }, scale: { get: () => 1 } });
    Object.defineProperty(window, 'visualViewport', { value: vv });
    window.__kb = px => { kb = px; vv.dispatchEvent(new Event('resize')); };
  });
  await page.goto(`${base}/#/login`);
  await page.fill('input[name=email]', 'fit@example.com');
  await page.fill('input[name=password]', 'fitpass123456');
  await page.click('form button[type=submit], form .btn.primary');
  await page.waitForSelector('.nav');
  await page.evaluate(h => { location.hash = h; }, hash);
  return { page, errors };
}
const text = async (page, sel) => (await page.$eval(sel, e => e.innerText)).replace(/\s+/g, ' ');

test('Studio starts simply: a worry, one sentence of choices, the full panel a tap away', { skip, timeout: 120000 }, async () => {
  const { page, errors } = await open('#/create');
  await page.click('[data-act="studio-new"]:not([data-series])');
  await page.waitForSelector('.worry-card');
  assert.match(await text(page, '.panel.story'), /What.s this video about\?/);
  await page.click('.worry-card');
  await page.waitForSelector('.st-summary');
  assert.ok(await page.$('.panel.story [data-act="st-surprise"]'), 'Surprise me is offered');
  assert.equal(await page.$('[data-stb="painId"]'), null, 'the full panel stays out of the way');
  await page.click('.panel.story [data-act="st-more"]');
  await page.waitForSelector('[data-stb="painId"]');
  await page.click('[data-act="st-less"]');
  await page.waitForSelector('.st-summary');
  assert.deepEqual(errors, []);
  await page.close();
});

test('Unsaved settings, seen from Account, say where they are and go back there', { skip, timeout: 120000 }, async () => {
  const { page, errors } = await open('#/settings');
  await page.waitForSelector('main input[type=text], main textarea');
  const f = await page.$('main input[type=text], main textarea');
  await f.type('z'); await f.evaluate(x => x.blur());
  await page.evaluate(() => { location.hash = '#/account'; });
  await page.waitForFunction(() => /Account/.test(document.querySelector('main h1')?.textContent || ''));
  await page.waitForFunction(() => !document.getElementById('savebar').hidden);
  assert.match(await text(page, '#savebar'), /Unsaved changes in Settings\. Nothing on this page needs saving\./);
  await page.click('#savebar [data-act="savebar-go"]');
  await page.waitForFunction(() => location.hash === '#/settings');
  await page.click('#savebar [data-act="discard"]');
  await page.waitForFunction(() => document.getElementById('savebar').hidden);
  assert.deepEqual(errors, []);
  await page.close();
});

test('On a phone: the box being typed in clears the keyboard; the bottom of the screen never piles up', { skip, timeout: 120000 }, async () => {
  const { page, errors } = await open('#/brand', { keyboard: true });
  await page.waitForSelector('main textarea, main input[type=text]', { state: 'attached' });
  await page.evaluate(() => document.querySelectorAll('main details:not([open])').forEach(d => { d.open = true; }));   // Brand's boxes sit in sections
  const clear = await page.evaluate(async () => {
    const boxes = [...document.querySelectorAll('main input[type=text], main input:not([type]), main textarea')].filter(b => b.checkVisibility() && !b.disabled);
    const b = boxes[boxes.length - 1]; b.scrollIntoView({ block: 'end' });
    b.focus(); window.__kb(320); await new Promise(r => setTimeout(r, 450));
    const r = b.getBoundingClientRect(), out = r.bottom <= innerHeight - 320; window.__kb(0); b.blur(); return out;
  });
  assert.ok(clear, 'the last box on Brand scrolls up above the keyboard');
  // Unsaved changes (the save bar wraps to two lines at this width), a ready card and a message at once.
  await page.evaluate(() => { location.hash = '#/settings'; });
  await page.waitForSelector('main input[type=text], main textarea');
  const f = await page.$('main input[type=text], main textarea'); await f.type('z'); await f.evaluate(x => x.blur());
  await page.waitForFunction(() => !document.getElementById('savebar').hidden);
  const hits = await page.evaluate(async () => {
    const box = Object.assign(document.createElement('div'), { id: 'ready', className: 'ready' }); document.body.append(box);
    box.innerHTML = '<div class="ready-card"><div class="stack" style="flex:1"><b class="small">A new video is ready</b><span class="small muted clamp">A hook line long enough to wrap</span></div><a class="btn sm primary">Review</a></div>';
    const t = Object.assign(document.createElement('button'), { hidden: true }); t.dataset.act = 'copy-text'; t.dataset.text = 'x'; t.dataset.what = 'Text'; document.body.append(t); t.click(); await new Promise(r => setTimeout(r, 300));
    const R = el => { const r = el.getBoundingClientRect(); return r.width ? r : null; };
    const rs = { savebar: R(document.getElementById('savebar')), coach: R(document.querySelector('.coach-fab')), ready: R(box), toast: R(document.getElementById('toast')) };
    const names = Object.keys(rs), out = [];
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const a = rs[names[i]], b = rs[names[j]];
      if (a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) out.push(`${names[i]} × ${names[j]}`);
    }
    return out;
  });
  assert.deepEqual(hits, []);
  // The Coach's own box, with the save bar showing: the page behind it stays where it is.
  await page.evaluate(() => { document.getElementById('ready')?.remove(); window.scrollTo(0, 300); });
  await page.click('[data-act="coach-open"]');
  await page.waitForSelector('#coach textarea, #coach input[type=text]');
  const y0 = await page.evaluate(() => scrollY);
  await page.focus('#coach textarea, #coach input[type=text]'); await page.evaluate(() => window.__kb(320)); await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => scrollY), y0, 'the page under the Coach didn’t move');
  await page.evaluate(() => window.__kb(0));
  assert.deepEqual(errors, []);
  await page.close();
});
