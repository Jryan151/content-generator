// End to end: script → voice → footage → render → cover → review record, then a scene fix.
// Uses fake OpenAI and Pixabay servers and real FFmpeg. Skipped if FFmpeg or a Poppins font isn't available.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { tempEnv, testFont, hasFfmpeg, startStubs } from './helpers.js';

tempEnv();
const font = testFont();
// Slow (renders three videos), so it only runs with: npm run test:full
const skip = !process.env.FULL_TEST ? 'renders videos; run with npm run test:full' : !hasFfmpeg() ? 'FFmpeg not installed' : !font ? 'No Poppins font in fonts/ yet (make one video first)' : false;

test('a video is made, checked, saved for review, then fixed', { skip, timeout: 600000 }, async t => {
  const stubs = await startStubs();
  t.after(() => stubs.close());
  const store = await import('../lib/store.js');
  const { starterStory } = await import('../templates.js');
  const { makeVideo, fixVideo } = await import('../pipeline.js');
  const { monthUsage } = await import('../lib/usage.js');

  const ws = store.createWorkspace({ name: 'Test Agent', comped: true });
  const cfg = store.loadConfig(ws.id);
  cfg.story = { ...cfg.story, ...starterStory() };
  cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); i.source = 'Carrier guide'; });
  cfg.look = { ...cfg.look, name: 'Test Agent', location: 'Gallup, NM', font };
  store.saveConfig(ws.id, cfg);

  const logs = [];
  const say = l => { logs.push(l); if (process.env.DEBUG) fs.appendFileSync(process.env.DEBUG, new Date().toISOString().slice(11, 19) + ' ' + l + '\n'); };
  const v = await makeVideo({ ws: ws.id, log: say });
  assert.equal(v.status, 'pending');
  assert.ok(fs.existsSync(store.videoPath(ws.id, v.file)), 'video file exists');
  assert.ok(v.cover && fs.existsSync(store.videoPath(ws.id, v.cover)), 'cover exists');
  assert.ok(v.duration > 10 && v.duration < 60, 'sensible length: ' + v.duration);
  assert.equal(v.scenes.length, 6);
  assert.ok(v.preflight.every(p => p.ok), 'preflight passes: ' + JSON.stringify(v.preflight.filter(p => !p.ok)));
  assert.ok(v.post.length > 20, 'post text written');
  assert.equal(v.meta.insightSource, 'Carrier guide');
  assert.ok(v.clips.every(c => c.checked), 'every clip checked');
  assert.equal(store.readRecent(ws.id)[0].videoId, v.id, 'remembered for freshness');
  assert.equal(monthUsage(ws.id).videos, 1);
  assert.ok(monthUsage(ws.id).cost > 0, 'cost metered');

  // Fix: new CTA wording and a different clip for scene 1.
  const firstClip = v.clips[0].id;
  const fixed = await fixVideo({ ws: ws.id, videoId: v.id, edits: [{ i: 5, text: 'Message me and we can find your answer.', accent: 'your answer' }], swaps: [0], log: say });
  assert.equal(fixed.version, 2);
  assert.equal(fixed.scenes[5].text, 'Message me and we can find your answer.');
  assert.notEqual(fixed.clips[0].id, firstClip, 'scene 1 got a different clip');
  assert.ok(fs.existsSync(store.videoPath(ws.id, fixed.file)), 'new file exists');
  assert.ok(!fs.existsSync(store.videoPath(ws.id, v.file)), 'old file removed');

  // An edit that breaks a rule is refused before anything renders.
  await assert.rejects(fixVideo({ ws: ws.id, videoId: v.id, edits: [{ i: 2, text: 'Everyone qualifies, guaranteed.', accent: 'qualifies' }] }), /breaks a rule/);

  // Voiceover mode records the script in one take (v13), cuts it into scenes and mixes it in.
  store.saveConfig(ws.id, { ...store.loadConfig(ws.id), output: { ...store.loadConfig(ws.id).output, mode: 'voiceover' } });
  const before = stubs.calls.speech;
  const vo = await makeVideo({ ws: ws.id, log: say });
  assert.equal(vo.mode, 'voiceover');
  // The stand-in voice has no pauses and there's no transcription here, so the take can't be cut
  // cleanly: the video falls back to one recording per scene, as v12 did.
  assert.equal(stubs.calls.speech - before, 1 + vo.scenes.length, 'one take tried, then scene by scene');
  assert.ok(vo.scenes.every(s => s.say), 'each scene has a spoken line');
});
