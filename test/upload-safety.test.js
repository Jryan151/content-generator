// Uploads can't make the server fetch web addresses or read its own files: a "video" that is really
// a DASH playlist is refused without ffmpeg following its links. Real phone videos (MP4, MOV) still work.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { tempEnv, hasFfmpeg } from './helpers.js';

tempEnv();
const library = await import('../lib/library.js');
const store = await import('../lib/store.js');
const ws = store.createWorkspace({ name: 'Uploads', comped: true }).id;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-safety-'));
const skip = !hasFfmpeg() && 'needs ffmpeg';

test('a playlist dressed as a video is refused, and nothing is fetched', { skip }, async () => {
  let hits = 0;
  const bait = http.createServer((req, res) => { hits++; res.end(''); });
  await new Promise(r => bait.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${bait.address().port}/seg`;
  const file = path.join(tmp, 'evil.mp4');
  fs.writeFileSync(file, `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S" minBufferTime="PT1S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011">
 <Period><AdaptationSet mimeType="video/mp4"><Representation id="1" bandwidth="1000" width="640" height="360">
  <BaseURL>${url}</BaseURL><SegmentBase indexRange="0-100"><Initialization range="0-100"/></SegmentBase>
 </Representation></AdaptationSet></Period>
</MPD>`);
  await assert.rejects(library.add(ws, file), e => e.status === 400);
  await new Promise(r => setTimeout(r, 300));
  bait.close();
  assert.equal(hits, 0, 'the server fetched the playlist’s link');
});

test('real phone videos (MP4 and MOV) still upload', { skip }, async () => {
  for (const ext of ['mp4', 'mov']) {
    const file = path.join(tmp, `ok.${ext}`);
    const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=360x640:rate=30', '-t', '2', '-pix_fmt', 'yuv420p', file]);
    assert.equal(r.status, 0, String(r.stderr));
    const clip = await library.add(ws, file);
    assert.ok(clip.id && clip.width > 0, `${ext} upload failed`);
  }
});
