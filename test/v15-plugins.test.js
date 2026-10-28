// v15 Phase 5: the standard mounts (lib/plugins.js). Every registered platform, footage source and
// niche runs its kit (test/kits/), with a stand-in for its outside API.
import test from 'node:test';
import http from 'http';
import path from 'path';
import { tempEnv, startStubs } from './helpers.js';
import { platformKit } from './kits/platform-kit.js';
import { footageKit } from './kits/footage-kit.js';
import { nicheKit } from './kits/niche-kit.js';

tempEnv();
const stubs = await startStubs();
const paths = await import('../lib/paths.js');
const store = await import('../lib/store.js');
const plugins = await import('../lib/plugins.js');
await import('../lib/platforms.js');
const igMod = await import('../lib/instagram.js'), fbMod = await import('../lib/facebook.js');
await import('../stages/broll.js');
const { NICHES } = await import('../niches/index.js');
test.after(() => stubs.close());
const listen = handler => new Promise(r => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r(s)); });
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const body = async req => { let b = ''; for await (const c of req) b += c; return b; };

// Stand-ins for Instagram and Facebook (each publish is counted).
const igs = { status: {}, caption: {}, media: [], n: 0, published: 0 };
const ig = await listen(async (req, res) => {
  const url = new URL(req.url, 'http://x'), form = new URLSearchParams(await body(req));
  if (/\/media$/.test(url.pathname) && req.method === 'POST') { const id = `c${++igs.n}`; igs.status[id] = 'FINISHED'; igs.caption[id] = form.get('caption'); return json(res, 200, { id }); }
  if (/\/media$/.test(url.pathname)) return json(res, 200, { data: igs.media });
  let m = /\/(c\d+)$/.exec(url.pathname);
  if (m) return json(res, 200, { status_code: igs.status[m[1]] });
  if (/\/media_publish$/.test(url.pathname)) { igs.published++; const c = form.get('creation_id'); igs.status[c] = 'PUBLISHED'; const id = `m${igs.media.length + 1}`; igs.media.unshift({ id, caption: igs.caption[c], timestamp: new Date().toISOString() }); return json(res, 200, { id }); }
  m = /\/(m\d+)$/.exec(url.pathname);
  if (m) return json(res, 200, { permalink: `https://www.instagram.com/reel/${m[1]}/` });
  json(res, 404, { error: { message: 'no stub ' + url.pathname } });
});
const fbs = { n: 0, published: new Set() };
const fb = await listen(async (req, res) => {
  const url = new URL(req.url, 'http://x'), form = new URLSearchParams(await body(req));
  if (/\/video_reels$/.test(url.pathname)) { const ph = form.get('upload_phase'); if (ph === 'start') return json(res, 200, { video_id: `v${++fbs.n}` }); if (ph === 'finish') { fbs.published.add(form.get('video_id')); return json(res, 200, { success: true }); } }
  if (/\/video-upload\//.test(url.pathname)) return json(res, 200, { success: true });
  const m = /\/(v\d+)$/.exec(url.pathname);
  if (m) return json(res, 200, { status: fbs.published.has(m[1]) ? { video_status: 'ready', publishing_phase: { status: 'complete' } } : { video_status: 'processing' }, permalink_url: `/reel/${m[1]}` });
  json(res, 404, { error: { message: 'no stub ' + url.pathname } });
});
const px = await listen(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const clip = i => ({ id: i, url: `https://www.pexels.com/video/family-at-home-${i}/`, image: `${stubs.base}/thumb.jpg`, video_files: [{ link: `${stubs.base}/clip/${i}.mp4`, file_type: 'video/mp4', width: 720, height: 1280 }] });
  if (url.pathname.endsWith('/search')) return json(res, 200, { videos: [clip(901), clip(902)] });
  const m = /\/videos\/(\d+)$/.exec(url.pathname);
  if (m) return json(res, 200, clip(Number(m[1])));
  json(res, 404, {});
});
test.after(() => { ig.close(); fb.close(); px.close(); });

const harness = {
  instagram: {
    env: { INSTAGRAM_APP_ID: '1', INSTAGRAM_APP_SECRET: 's', INSTAGRAM_GRAPH_BASE: `http://127.0.0.1:${ig.address().port}`, INSTAGRAM_ALLOW_HTTP: '1', PUBLIC_URL: 'http://127.0.0.1:1', INSTAGRAM_TIMEOUT_MS: '2000' },
    connect: ws => { paths.writeJSON(path.join(store.wsDir(ws.id), 'instagram.json'), { userId: '17841', username: 'kit', token: igMod.seal('tok'), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), connectedAt: new Date().toISOString() }); },
    published: () => igs.published,
  },
  facebook: {
    env: { FACEBOOK_APP_ID: '9', FACEBOOK_APP_SECRET: 'fs', FACEBOOK_GRAPH_BASE: `http://127.0.0.1:${fb.address().port}`, FACEBOOK_UPLOAD_BASE: `http://127.0.0.1:${fb.address().port}`, INSTAGRAM_ALLOW_HTTP: '1', PUBLIC_URL: 'http://127.0.0.1:1' },
    connect: ws => { paths.writeJSON(path.join(store.wsDir(ws.id), 'facebook.json'), { pageId: '555', pageName: 'Kit Page', token: fbMod.seal('ptok'), connectedAt: new Date().toISOString() }); },
    published: () => fbs.published.size,
  },
};
const footageHarness = {
  pixabay: { env: {}, sampleIds: ['1234', 42] },
  pexels: { env: { PEXELS_API_KEY: 'pk', PEXELS_BASE_URL: `http://127.0.0.1:${px.address().port}/videos/` }, sampleIds: ['px901'] },
};

test('every posting platform passes the platform kit', async t => {
  for (const part of plugins.list('platform')) {
    const h = harness[part.id];
    if (!h) throw new Error(`No test harness for the platform ${part.id}: add one here.`);
    await platformKit(t, part, h, { store });
  }
});
test('every footage source passes the footage kit', async t => {
  for (const part of plugins.list('footage')) {
    const h = footageHarness[part.id];
    if (!h) throw new Error(`No test harness for the footage source ${part.id}: add one here.`);
    await footageKit(t, part, h);
  }
});
test('every niche passes the niche kit', async t => {
  for (const n of Object.values(NICHES)) await nicheKit(t, n);
});
test('a part that doesn’t fit its mount is refused', () => {
  const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
  let threw = false;
  try { plugins.register('platform', { id: 'tiktok', label: 'TikTok', on: () => false }); } catch (e) { threw = /doesn’t fit its mount/.test(e.message); }
  assert(threw, 'refused');
  assert(!plugins.get('platform', 'tiktok'), 'not registered');
});
