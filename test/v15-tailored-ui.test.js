// v15 Phase 8 in a real browser: the simpler Studio start, Away from start to welcome back, the page
// behind a tracking link (form → lead on the Desk), the save bar away from the settings pages, comfort and
// the privacy curtain, and the phone details (the keyboard, the bottom of the screen). Runs in Chromium
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

let server, stubs, browser, base, store, clients, links, ws;
test.before(async () => {
  if (skip) return;
  stubs = await startStubs();
  store = await import('../lib/store.js');
  clients = await import('../lib/clients.js');
  links = await import('../lib/links.js');
  const auth = await import('../lib/auth.js');
  const { starterStory } = await import('../templates.js');
  const S = await import('../server.js');
  server = await S.start({ port: 0, scheduler: false, worker: false });
  base = `http://127.0.0.1:${server.address().port}`;
  ws = store.createWorkspace({ name: 'Fit Agent', comped: true });
  const cfg = store.loadConfig(ws.id);
  cfg.story = { ...cfg.story, ...starterStory(['final_expense']) };
  cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); i.source = 'Carrier guide'; });
  cfg.look = { ...cfg.look, name: 'Dana Agent', title: 'Licensed Agent', location: 'Gallup, NM', bookingUrl: 'https://calendly.com/dana' };
  cfg.schedule = { ...cfg.schedule, keepReady: 2, autopost: { ...cfg.schedule.autopost, on: false, days: [1, 2, 3, 4, 5], time: '09:00' } };
  store.saveConfig(ws.id, cfg);
  store.updateWorkspace(ws.id, { onboarded: true });
  for (let i = 0; i < 3; i++) store.addVideo(ws.id, { id: 'ap' + i, status: 'approved', file: `video_ap${i}.mp4`, createdAt: new Date().toISOString(), approval: { at: new Date().toISOString() }, scenes: [{ text: `Approved video number ${['one', 'two', 'three'][i]}`, keyword: 'family' }], meta: { painPoint: 'Funeral costs' }, post: 'p', preflight: [] });
  store.addVideo(ws.id, { id: 'pe1', status: 'pending', file: 'video_pe1.mp4', createdAt: new Date().toISOString(), scenes: [{ text: 'Waiting one', keyword: 'family' }], meta: { painPoint: 'Funeral costs' }, post: 'p', preflight: [] });
  clients.add(ws.id, { name: 'Maria Lopez', stage: 'lead' });
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
  assert.equal(await page.$('[data-stb="audienceId"]'), null, 'the full panel stays out of the way');
  await page.click('.panel.story [data-act="st-more"]');
  await page.waitForSelector('[data-stb="audienceId"]');
  await page.click('[data-act="st-less"]');
  await page.waitForSelector('.st-summary');
  assert.deepEqual(errors, []);
  await page.close();
});

test('Away: preview, start, the quiet banner, I’m back, and the welcome-back card goes once seen', { skip, timeout: 120000 }, async () => {
  const { page, errors } = await open('#/settings');
  await page.waitForSelector('#awayPanel');
  await page.click('[data-act="away-preview"]');
  await page.waitForSelector('[data-act="away-start"]');
  await page.click('[data-act="away-start"]');
  await page.waitForFunction(() => /back/i.test(document.getElementById('awayPanel')?.innerText || '') && !document.querySelector('[data-act="away-start"]'));
  assert.ok(store.getWorkspace(ws.id).away?.until, 'Away is stored');
  await page.evaluate(() => { location.hash = '#/review'; });
  await page.waitForSelector('.away-note [data-act="away-back"]');
  await page.click('.away-note [data-act="away-back"]');
  await page.waitForSelector('.welcome-back button[data-act="away-welcome"]');
  await page.click('.welcome-back button[data-act="away-welcome"]');
  await page.waitForFunction(() => !document.querySelector('.welcome-back'));
  const w = store.getWorkspace(ws.id);
  assert.ok(!w.away && w.awayLast, 'the stay is kept as the last one');
  assert.deepEqual(errors, []);
  await page.close();
});

test('The page behind a tracking link: the opening line, a refused send kept, a sent one is a lead', { skip, timeout: 120000 }, async () => {
  const code = links.codeFor(ws.id, 'ap0');
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });   // a refused send is a 400 on purpose
  await page.goto(`${base}/r/${code}`);
  const body = (await page.innerText('main')).replace(/\s+/g, ' ');
  assert.match(body, /You watched:.*Approved video number one/);
  assert.match(body, /Dana Agent.*Licensed Agent · Gallup, NM/);
  assert.ok(await page.$(`a[href="/r/${code}/book"]`), 'Pick a time goes through the counted link');
  await page.fill('input[name=name]', 'Rosa'); await page.fill('input[name=contact]', 'nope');
  await page.click('button[type=submit]'); await page.waitForSelector('.err');
  assert.equal(await page.inputValue('input[name=name]'), 'Rosa', 'what was typed stays');
  await page.fill('input[name=contact]', '505-555-0142'); await page.fill('textarea[name=message]', 'Does it cover cremation?');
  await page.click('button[type=submit]'); await page.waitForSelector('text=will get back to you');
  const lead = clients.list(ws.id).find(c => c.name === 'Rosa');
  assert.ok(lead && lead.stage === 'lead' && lead.videoId === 'ap0' && /cremation/.test(lead.notes));
  assert.deepEqual(errors, []);
  await page.close();
});

test('Unsaved settings, seen from Account, say where they are and go back there', { skip, timeout: 120000 }, async () => {
  const { page, errors } = await open('#/settings');
  await page.waitForSelector('main input[type=text], main textarea');
  const f = await page.$('main input[type=text], main textarea');
  await f.type('z'); await f.evaluate(x => x.blur());
  await page.evaluate(() => { location.hash = '#/account'; });
  await page.waitForSelector('#comfortPanel');
  await page.waitForFunction(() => !document.getElementById('savebar').hidden);
  assert.match(await text(page, '#savebar'), /Unsaved changes in Settings\. Nothing on this page needs saving\./);
  await page.click('#savebar [data-act="savebar-go"]');
  await page.waitForFunction(() => location.hash === '#/settings');
  await page.click('#savebar [data-act="discard"]');
  await page.waitForFunction(() => document.getElementById('savebar').hidden);
  assert.deepEqual(errors, []);
  await page.close();
});

test('Comfort and the privacy curtain', { skip, timeout: 120000 }, async () => {
  const { page, errors } = await open('#/account');
  await page.waitForSelector('#comfortPanel');
  await page.click('[data-act="comfort-set"][data-k="comfort"][data-v="on"]');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.comfort), 'on');
  await page.click('[data-act="comfort-set"][data-k="theme"][data-v="dark"]');
  await page.reload(); await page.waitForSelector('.nav');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.comfort), 'on', 'kept on this device');
  await page.click('[data-act="comfort-set"][data-k="comfort"][data-v=""]');
  await page.evaluate(() => { location.hash = '#/desk'; });
  await page.waitForSelector('main .pii');
  await page.click('[data-act="curtain"]');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.curtain), 'on');
  const blur = await page.$eval('main .pii', e => getComputedStyle(e).filter);
  assert.match(blur, /blur/, 'client names are blurred');
  await page.click('[data-act="curtain"]');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.curtain), undefined);
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
  const hits = await page.evaluate(() => {
    const box = Object.assign(document.createElement('div'), { id: 'ready', className: 'ready' }); document.body.append(box);
    box.innerHTML = '<div class="ready-card"><div class="stack" style="flex:1"><b class="small">A new video is ready</b><span class="small muted clamp">A hook line long enough to wrap</span></div><a class="btn sm primary">Review</a></div>';
    document.querySelector('[data-act="curtain"]').click();
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
