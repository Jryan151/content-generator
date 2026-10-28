// v15 Phase 6: smoothness you don't notice — the portal's speed budget, compressed and checked-not-
// downloaded files, screens that appear in their final shape (no jumping), the next video loaded while
// one is watched, a notification opening its exact video, and a 10-second Undo instead of "Are you sure?".
// The browser part runs in a real Chromium when Playwright is around (PLAYWRIGHT_DIR, or
// /opt/node-tools/node_modules), and is skipped otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { tempEnv, startStubs, hasFfmpeg } from './helpers.js';

tempEnv();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let chromium = null;
try { chromium = createRequire(path.join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x.js'))('playwright').chromium; } catch { chromium = null; }
const exe = [process.env.PLAYWRIGHT_CHROMIUM, '/opt/pw-browsers/chromium'].find(p => p && fs.existsSync(p));
const noBrowser = !chromium ? 'Playwright isn’t installed here' : !hasFfmpeg() ? 'FFmpeg not installed' : false;

// The speed budget: what a phone downloads the first time it opens the portal (after that the service
// worker keeps a copy, and the server only confirms it's current). Raising it is a decision, not drift.
// (Raised in v15 Phase 9, from 24 files / 760 KB / 240 KB, for four features: the reviewer's Sign-off
// page, keyword replies, booking confirmations and opening tests; and in Phase 10 by three small screens,
// Today, Grow and Setup's steps, for the new navigation.)
const BUDGET = { files: 28, rawKB: 820, gzipKB: 256 };
test('the speed budget: the portal’s size, compressed for the trip, and never downloaded twice', async () => {
  const sw = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
  const shell = JSON.parse(sw.match(/const SHELL_PATHS = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  const file = p => path.join(ROOT, p === '/' ? 'public/index.html' : fs.existsSync(path.join(ROOT, 'public', p)) ? path.join('public', p) : p.slice(1));
  const code = shell.filter(p => /\.(js|html)$/.test(p) || p === '/').filter((p, i, a) => a.indexOf(p) === i && p !== '/index.html');
  let raw = 0, gz = 0;
  for (const p of code) { const b = fs.readFileSync(file(p)); raw += b.length; gz += zlib.gzipSync(b, { level: 9 }).length; }
  assert.ok(code.length <= BUDGET.files, `${code.length} files`);
  assert.ok(raw / 1024 <= BUDGET.rawKB, `portal is ${Math.round(raw / 1024)} KB (budget ${BUDGET.rawKB})`);
  assert.ok(gz / 1024 <= BUDGET.gzipKB, `portal is ${Math.round(gz / 1024)} KB compressed (budget ${BUDGET.gzipKB})`);
  // The server compresses it, and answers "you already have it" (304) to a browser with the same copy.
  const S = await import('../server.js');
  const server = await S.start({ port: 0, scheduler: false, worker: false });
  try {
    const url = `http://127.0.0.1:${server.address().port}/app.js`;
    const a = await fetch(url, { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(a.status, 200);
    assert.equal(a.headers.get('content-encoding'), 'gzip');
    const etag = a.headers.get('etag');
    assert.match(etag, /^"[\w-]{10,}"$/);
    assert.ok((await a.text()).includes('function page('), 'decompresses to the portal');
    const b = await fetch(url, { headers: { 'if-none-match': etag } });
    assert.equal(b.status, 304);
    assert.equal((await b.arrayBuffer()).byteLength, 0);
    const plain = await fetch(url, { headers: { 'accept-encoding': 'identity' } });
    assert.equal(plain.headers.get('content-encoding'), null);
    assert.equal(Number(plain.headers.get('content-length')), (await plain.arrayBuffer()).byteLength);
  } finally { server.close(); }
});

test('in a real browser: no jumping, the next video preloaded, the exact video opened, and Undo', { skip: noBrowser, timeout: 240000 }, async t => {
  const stubs = await startStubs();
  t.after(() => stubs.close());
  const store = await import('../lib/store.js');
  const auth = await import('../lib/auth.js');
  const { starterStory } = await import('../templates.js');
  const S = await import('../server.js');
  const server = await S.start({ port: 0, scheduler: false, worker: false });
  let browser = null;
  t.after(async () => { await browser?.close().catch(() => {}); server.closeAllConnections?.(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const ws = store.createWorkspace({ name: 'Smooth Agent', comped: true });
  const cfg = store.loadConfig(ws.id);
  cfg.story = { ...cfg.story, ...starterStory(['final_expense']) };
  cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); });
  store.saveConfig(ws.id, cfg);
  store.updateWorkspace(ws.id, { onboarded: true });
  for (let i = 0; i < 4; i++) {
    const file = `video_s${i}.mp4`;
    spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=#${['6b8fb5', 'b58f6b', '7aa874', 'a8749b'][i]}:s=180x320:d=2`, '-r', '15', '-pix_fmt', 'yuv420p', store.videoPath(ws.id, file)]);
    store.addVideo(ws.id, { id: `s${i}`, status: i < 3 ? 'pending' : 'approved', file, cover: '', createdAt: new Date(Date.now() - i * 60000).toISOString(), duration: 2, mode: 'captions', scenes: [{ text: `Video ${i}`, keyword: 'family' }], meta: { painPoint: 'Funeral costs', insight: 'A fact' }, post: 'A post', clips: [], preflight: [{ ok: true, label: 'Checked' }] });
  }
  store.createAccount({ email: 'smooth@example.com', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('smoothpass1234') });

  browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], sent = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (r.method() !== 'GET' || r.url().includes('/media/')) sent.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  await page.addInitScript(() => {
    window.__shifts = [];
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__shifts.push(e.value); }).observe({ type: 'layout-shift', buffered: true });
  });
  // A phone on an ordinary connection: every request takes a moment.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1_500_000, uploadThroughput: 500_000 });
  await page.goto(`${base}/#/login`);
  await page.fill('input[name=email]', 'smooth@example.com');
  await page.fill('input[name=password]', 'smoothpass1234');
  await page.click('form button[type=submit], form .btn.primary');
  await page.waitForSelector('.nav');
  await page.evaluate(() => { location.hash = '#/review'; });
  await page.waitForSelector('[data-vid="s0"]');
  // The service worker takes charge after a reload (the preloading plays through it).
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  await page.waitForSelector('[data-vid="s0"]');

  // 1. No jumping: each screen appears in its final shape, within the time budget.
  const ready = async hash => {
    await page.evaluate(h => { window.__shifts = []; location.hash = h; }, hash);
    const ms = await page.evaluate(async () => { const t0 = performance.now(); await new Promise(r => setTimeout(r, 30)); while (document.querySelector('#main > .empty .spin') && performance.now() - t0 < 8000) await new Promise(r => setTimeout(r, 15)); return performance.now() - t0; });
    await page.waitForTimeout(900);
    return { ms, cls: await page.evaluate(() => window.__shifts.reduce((a, b) => a + b, 0)) };
  };
  for (const tab of ['create', 'content', 'communicate', 'mindset', 'brand', 'settings', 'guide', 'account', 'review']) {
    const r = await ready(`#/${tab}`);
    assert.ok(r.cls <= 0.01, `${tab}: the screen moved after it appeared (layout shift ${r.cls.toFixed(3)})`);
    assert.ok(r.ms <= 3000, `${tab}: took ${Math.round(r.ms)} ms to appear (budget 3000)`);
  }

  // 2. The next video is fetched ahead while one is watched, into the preload cache.
  await page.evaluate(() => { const v = document.querySelector('[data-vid="s0"] video.player'); v.muted = true; return v.play().catch(() => {}); });
  await page.waitForFunction(async () => (await (await caches.open('preload-v1')).keys()).some(k => k.url.endsWith('/media/video_s1.mp4')), null, { timeout: 15000 });
  // …and plays from there (the service worker answers the player's byte ranges).
  const fromCache = await page.evaluate(async () => { const r = await fetch('/media/video_s1.mp4', { headers: { Range: 'bytes=0-99' } }); return [r.status, (await r.arrayBuffer()).byteLength]; });
  assert.deepEqual(fromCache, [206, 100]);

  // 3. A notification's link opens that exact video, brought into view and marked.
  await page.evaluate(() => { location.hash = '#/review/s2'; });
  await page.waitForSelector('[data-vid="s2"].opened');

  // 4. Delete: gone at once, with Undo; Undo brings it back and nothing was sent.
  await page.evaluate(() => sessionStorage.setItem('soft-ms', '1500'));
  sent.length = 0;
  await page.click('[data-vid="s2"] [data-act="delete"]');
  assert.equal(await page.$('[data-vid="s2"]'), null, 'gone at once');
  await page.click('#toast [data-act="soft-undo"]');
  await page.waitForSelector('[data-vid="s2"]');
  await page.waitForTimeout(1800);
  assert.ok(!sent.some(x => x.startsWith('DELETE')), 'nothing was deleted: ' + sent.join(', '));
  assert.ok(store.getVideo(ws.id, 's2'), 'still there');
  // Without Undo, it's deleted when the time is up.
  await page.click('[data-vid="s2"] [data-act="delete"]');
  await page.waitForFunction(() => !document.querySelector('[data-vid="s2"]'));
  await page.waitForTimeout(2200);
  assert.ok(sent.includes('DELETE /api/videos/s2'), sent.join(', '));
  assert.equal(store.getVideo(ws.id, 's2'), null);
  assert.equal(await page.$('[data-vid="s2"]'), null, 'and stays gone');

  // 5. Reject works the same way, and a decision waiting for its Undo still goes out if the page closes.
  await page.evaluate(() => sessionStorage.setItem('soft-ms', '60000'));
  await page.click('[data-vid="s1"] [data-act="reject-open"]');
  await page.click('[data-act="reason"]');
  await page.click('[data-act="reject"][data-id="s1"]');
  assert.equal(await page.$('[data-vid="s1"]'), null);
  assert.equal(store.getVideo(ws.id, 's1').status, 'pending', 'not sent yet');
  // The phone switches apps (the page is hidden, the moment before it may be closed): what's waiting goes now.
  // (Hidden is simulated here: a headless browser drops some requests made as a page really closes.)
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  for (let i = 0; i < 100 && store.getVideo(ws.id, 's1').status !== 'rejected'; i++) await new Promise(r => setTimeout(r, 100));
  assert.equal(store.getVideo(ws.id, 's1').status, 'rejected', 'sent when the page was hidden');
  assert.deepEqual(errors, []);
});

test('the service worker opens a tapped notification’s video without a reload, and fetches it ahead', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
  assert.match(sw, /m\.media \? preload\(m\.media\)/, 'the video is fetched when the notification arrives');
  assert.match(sw, /postMessage\(\{ type: 'open', url \}/, 'an open portal is asked to switch screens itself');
  assert.match(sw, /if \(!answered\) await open\.navigate\(url\)/, 'one that doesn’t answer is sent there');
  assert.match(sw, /caches\.open\(PRELOAD\)\)\.match\(pathname\)/, 'preloaded videos play from the cache');
});
