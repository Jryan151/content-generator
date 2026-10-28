// routes/brand.js — Brand: logo for the end card; The agent's own clips (Brand → Your own clips).
// Split out of server.js by area (v15). server.js mounts it, passing in the helpers these routes share
// with the rest of the server; the capability each route needs is still listed in one place
// (server.js ROUTE_CAPS). The code below is as it was in server.js (not re-indented, so its text and
// templates are unchanged).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DIRS } from '../lib/paths.js';
import * as store from '../lib/store.js';
import * as landing from '../lib/landing.js';
import * as data from '../lib/data.js';
import * as library from '../lib/library.js';
import * as bookings from '../lib/bookings.js';
import { logoColors } from '../lib/logocolors.js';

export default function mount(ctx) {
const { HttpError, api, bad, clip, content, main, route, streamFile } = ctx;
/* ----- Brand: logo for the end card ----- */
route('GET', '/api/brand/logo', 'ws', ({ req, res, wsId }) => {
  if (!store.hasLogo(wsId)) bad(404, 'No logo yet.');
  streamFile(req, res, store.logoPath(wsId), 'image/png');
});
// The portal shrinks the image first and sends it as a data URL; the server re-encodes it as PNG.
route('POST', '/api/brand/logo', 'ws', async ({ wsId, body }) => {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image || ''));
  if (!m) bad(400, 'Send a PNG or JPEG image.');
  const buf = Buffer.from(m[2], 'base64');
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), jpg = buf[0] === 0xff && buf[1] === 0xd8, webp = buf.subarray(8, 12).toString('latin1') === 'WEBP';
  if (!png && !jpg && !webp) bad(400, 'That file isn’t a PNG or JPEG image.');
  if (buf.length > 700_000) bad(413, 'That image is too large. Use one under 700 KB.');
  const tmp = path.join(DIRS.work, `logo-${crypto.randomBytes(4).toString('hex')}`);
  fs.writeFileSync(tmp, buf);
  try {
    const { normalizeImage } = await import('../stages/render.js');
    await normalizeImage(tmp, tmp + '.png');
    fs.renameSync(tmp + '.png', store.logoPath(wsId));
  } catch { bad(400, 'That image couldn’t be read. Try a PNG with a transparent background.'); }
  finally { fs.rmSync(tmp, { force: true }); fs.rmSync(tmp + '.png', { force: true }); }
  return { ok: true, logo: true, colors: await logoColors(store.logoPath(wsId)) };
});
// The logo's main colors, offered as a highlight color in Brand.
route('GET', '/api/brand/logo-colors', 'ws', async ({ wsId }) => ({ colors: store.hasLogo(wsId) ? await logoColors(store.logoPath(wsId)) : [] }));
route('DELETE', '/api/brand/logo', 'ws', ({ wsId }) => { fs.rmSync(store.logoPath(wsId), { force: true }); return { ok: true, logo: false }; });

/* ----- Brand: the agent's photo, for the page behind each video's link (v15) ----- */
route('GET', '/api/brand/photo', 'ws', ({ req, res, wsId }) => {
  if (!landing.hasPhoto(wsId)) bad(404, 'No photo yet.');
  streamFile(req, res, landing.photoPath(wsId), 'image/jpeg');
});
route('POST', '/api/brand/photo', 'ws', async ({ wsId, body }) => {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image || ''));
  if (!m) bad(400, 'Send a JPEG or PNG photo.');
  const buf = Buffer.from(m[2], 'base64');
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), jpg = buf[0] === 0xff && buf[1] === 0xd8, webp = buf.subarray(8, 12).toString('latin1') === 'WEBP';
  if (!png && !jpg && !webp) bad(400, 'That file isn’t a JPEG or PNG photo.');
  if (buf.length > 2_000_000) bad(413, 'That photo is too large. Use one under 2 MB.');
  const tmp = path.join(DIRS.work, `photo-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(DIRS.work, { recursive: true });
  fs.writeFileSync(tmp, buf);
  try {
    const { squarePhoto } = await import('../stages/render.js');
    await squarePhoto(tmp, tmp + '.jpg');
    fs.renameSync(tmp + '.jpg', landing.photoPath(wsId));
  } catch { bad(400, 'That photo couldn’t be read. Try a JPEG from your phone’s camera.'); }
  finally { fs.rmSync(tmp, { force: true }); fs.rmSync(tmp + '.jpg', { force: true }); }
  return { ok: true, photo: true };
});
route('DELETE', '/api/brand/photo', 'ws', ({ wsId }) => { fs.rmSync(landing.photoPath(wsId), { force: true }); return { ok: true, photo: false }; });

/* ----- The agent's own clips (Brand → Your own clips) ----- */
route('GET', '/api/library', 'ws', ({ wsId }) => ({ clips: library.list(wsId), max: library.MAX_CLIPS(), maxMB: library.MAX_UPLOAD_MB() }));
// The video file itself is the request body (Content-Type: video/…); its description comes in ?d=.
route('POST', '/api/library', 'ws', async ({ req, wsId, url }) => {
  if (!/^video\//.test(req.headers['content-type'] || '')) bad(415, 'Choose a video file.');
  const limit = library.MAX_UPLOAD_MB() * 1024 * 1024;
  if (Number(req.headers['content-length']) > limit) bad(413, `That video is too large. Keep it under ${library.MAX_UPLOAD_MB()} MB (a short clip is plenty).`);
  const tmp = path.join(DIRS.work, `upload-${crypto.randomBytes(6).toString('hex')}`);
  try {
    await new Promise((resolve, reject) => {
      let size = 0;
      const out = fs.createWriteStream(tmp);
      req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, `That video is too large. Keep it under ${library.MAX_UPLOAD_MB()} MB.`)); req.destroy(); out.destroy(); } });
      req.pipe(out);
      out.on('finish', resolve); out.on('error', reject); req.on('error', reject);
    });
    return { clip: await library.add(wsId, tmp, { description: url.searchParams.get('d') || '' }), clips: library.list(wsId) };
  } catch (e) { bad(typeof e.code === 'number' ? e.code : e.status || 400, e.message); }
  finally { fs.rmSync(tmp, { force: true }); }
}, { raw: true });
route('POST', '/api/library/:id', 'ws', ({ wsId, params, body }) => (library.describe(wsId, params.id, body.description) ? { clips: library.list(wsId) } : bad(404, 'Clip not found.')));
route('DELETE', '/api/library/:id', 'ws', ({ wsId, params }) => (library.remove(wsId, params.id) ? { clips: library.list(wsId) } : bad(404, 'Clip not found.')));
route('GET', '/api/library/:id/thumb', 'ws', ({ req, res, wsId, params }) => { const f = library.thumbOf(wsId, params.id); if (!f) bad(404, 'Not found'); streamFile(req, res, f, 'image/jpeg'); });
route('GET', '/api/library/:id/video', 'ws', ({ req, res, wsId, params }) => { const f = library.fileOf(wsId, params.id); if (!f) bad(404, 'Not found'); streamFile(req, res, f, 'video/mp4'); });
// Booking confirmations (v15, lib/bookings.js): the private address the booking tool calls, a new one on
// request (the old one stops working), and an optional signing key.
route('GET', '/api/bookings/hook', 'ws', ({ wsId }) => bookings.hookFor(wsId));
route('POST', '/api/bookings/hook', 'ws', ({ wsId, body }) => (body.rotate ? bookings.hookFor(wsId, { rotate: true }) : 'key' in body ? bookings.setKey(wsId, clip(body.key, 200)) : bookings.hookFor(wsId)));
}
