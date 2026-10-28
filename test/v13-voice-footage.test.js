// v13 Phase 2: single-take voiceover (cut by word timings, pauses or word share), captions timed to
// the voice, Pexels as a second footage source, no shared stock clips between agents, and the shot list.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { tempEnv, startStubs, hasFfmpeg } from './helpers.js';

tempEnv();
const stubs = await startStubs();
const M = await import('../mixer-core.js');
const V = await import('../stages/voice.js');
const R = await import('../stages/render.js');
const store = await import('../lib/store.js');
test.after(() => stubs.close());

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reels-voice-'));
// Three spoken "lines" as tones, with clear pauses between them: 0-1.2s, 1.8-3.0s, 3.6-4.6s.
function take(file) {
  spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=f=300:d=1.2', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-f', 'lavfi', '-i', 'sine=f=400:d=1.2', '-f', 'lavfi', '-i', 'sine=f=500:d=1.0',
    '-filter_complex', '[1]atrim=0:0.6[s1];[1]atrim=0:0.6[s2];[0]aresample=44100,aformat=channel_layouts=mono[a];[2]aresample=44100,aformat=channel_layouts=mono[b];[3]aresample=44100,aformat=channel_layouts=mono[c];[s1]asetpts=PTS-STARTPTS[p];[s2]asetpts=PTS-STARTPTS[q];[a][p][b][q][c]concat=n=5:v=0:a=1', '-c:a', 'libmp3lame', '-q:a', '4', file]);
  return file;
}
const LINES = ['Most families plan for this', 'Many policies may skip the exam', 'Message me to talk'];

test('alignment: script words are matched to the transcript, even with a misheard word', () => {
  const words = [];
  let t = 0.1;
  LINES.forEach((l, k) => { l.split(' ').forEach(w => { words.push({ word: k === 1 && w === 'skip' ? 'ship' : w, start: t, end: t + 0.25 }); t += 0.3; }); t += 0.5; });
  const al = V.alignScenes(LINES, words);
  assert.ok(al);
  assert.equal(al.length, 3);
  assert.ok(al[0].last < al[1].first && al[1].last < al[2].first);
  assert.equal(al[1].words.some(w => w.i === 3), false, 'the misheard word (skip → ship) has no time');
  assert.equal(V.alignScenes(LINES, [{ word: 'banana', start: 0, end: 1 }]), null, 'too little matches');
  // A skipped line is flagged, not cut around.
  const skip = words.filter(w => !LINES[2].split(' ').includes(w.word));
  assert.equal(V.alignScenes(LINES.slice(0, 2).concat(['Call me anytime please']), skip.concat([{ word: 'unrelated', start: 9, end: 9.2 }])).skipped, 2);
  // Times that go backwards aren't trusted.
  const back = words.map((w, j) => (j === 3 ? { ...w, start: 0.01, end: 0.02 } : w));
  assert.equal(V.alignScenes(LINES, back), null);
  // "40-year-old" in the transcript matches the script's three words.
  const hy = V.alignScenes(['If you are 40 year old', 'then this is for you'], [
    { word: 'If', start: 0, end: 0.2 }, { word: 'you', start: 0.2, end: 0.4 }, { word: 'are', start: 0.4, end: 0.6 }, { word: '40-year-old', start: 0.6, end: 1.4 },
    { word: 'then', start: 2, end: 2.2 }, { word: 'this', start: 2.2, end: 2.4 }, { word: 'is', start: 2.4, end: 2.6 }, { word: 'for', start: 2.6, end: 2.8 }, { word: 'you', start: 2.8, end: 3 }]);
  assert.equal(hy[0].words.length, 6);
});

test('cutting by pauses finds the gaps between lines', { skip: !hasFfmpeg() }, async () => {
  const f = take(path.join(tmp, 'take.mp3'));
  const total = await V.probeDuration(f);
  const cuts = await V.cutsFromSilence(f, LINES, total);
  assert.ok(cuts, 'pauses found');
  assert.equal(cuts.length, 3);
  assert.ok(Math.abs(cuts[0].to - 1.25) < 0.25, `first cut ${cuts[0].to}`);
  assert.ok(Math.abs(cuts[1].from - 1.8) < 0.25 && Math.abs(cuts[2].from - 3.6) < 0.25, JSON.stringify(cuts));
});

test('a single take is recorded once and cut into scenes with word timings', { skip: !hasFfmpeg() }, async () => {
  const audio = fs.readFileSync(take(path.join(tmp, 'take2.mp3')));
  const calls = { speech: 0, stt: 0 };
  const times = [[0.05, 1.15], [1.85, 2.95], [3.65, 4.55]];
  const srv = http.createServer(async (req, res) => {
    let raw = Buffer.alloc(0); for await (const c of req) raw = Buffer.concat([raw, c]);
    if (req.url.endsWith('/audio/speech')) { calls.speech++; const body = JSON.parse(raw); assert.equal(body.input, LINES.join('\n\n')); res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); return res.end(audio); }
    if (req.url.endsWith('/audio/transcriptions')) {
      calls.stt++;
      assert.match(raw.toString('latin1'), /timestamp_granularities\[\]/);
      const words = LINES.flatMap((l, k) => { const ws = l.split(' '), [a, b] = times[k], step = (b - a) / ws.length; return ws.map((w, j) => ({ word: w, start: a + j * step, end: a + (j + 1) * step - 0.02 })); });
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ duration: 4.6, words }));
    }
    res.writeHead(404); res.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${srv.address().port}/v1`;
  try {
    const cfg = M.migrate(M.DEFAULT_CONFIG);
    const dir = fs.mkdtempSync(path.join(tmp, 'w-'));
    const logs = [], spent = [];
    const meter = { tts: () => spent.push('tts'), stt: () => spent.push('stt') };
    const out = await V.speakTake(LINES.map(t => ({ say: t, text: t })), cfg, dir, l => logs.push(l), meter, { style: 'S' });
    assert.equal(calls.speech, 1); assert.equal(calls.stt, 1);
    assert.deepEqual(spent, ['tts', 'stt'], 'both costs are counted');
    assert.equal(out.length, 3);
    // Cuts touch halfway between scenes, so nothing spoken falls between them.
    const expect = [[0, 1.5], [1.5, 3.3], [3.3, 4.6]];
    out.forEach((o, k) => { assert.ok(fs.existsSync(o.file)); assert.ok(Math.abs(o.duration - (expect[k][1] - expect[k][0])) < 0.3, `scene ${k + 1}: ${o.duration}`); assert.ok(o.words.length >= 4); });
    assert.ok(Math.abs(out[1].words[0].start - 0.35) < 0.05, 'times are from the scene’s own start');
    assert.match(logs.join('\n'), /cut into 3 scenes by word timings/);
  } finally { process.env.OPENAI_BASE_URL = base; srv.close(); }
});

test('with no clean cuts the video is recorded scene by scene (never cut mid-word), and per-scene mode still works', { skip: !hasFfmpeg() }, async () => {
  // The shared stub has no transcription endpoint and its voice has no pauses: no clean cut points.
  const cfg = M.migrate(M.DEFAULT_CONFIG);
  const dir = fs.mkdtempSync(path.join(tmp, 's-'));
  const logs = [];
  const before = stubs.calls.speech;
  const out = await V.speakVoice(LINES.map(t => ({ say: t, text: t })), cfg, dir, l => logs.push(l), null);
  assert.equal(stubs.calls.speech - before, 4, 'the take, then one recording per scene');
  assert.equal(out.length, 3); assert.ok(out.every(o => o.duration > 0.2 && !o.words));
  assert.match(logs.join('\n'), /no clean places to cut the take between scenes.*recording scene by scene/);
  process.env.VOICE_TAKE = 'scene';
  try {
    const b2 = stubs.calls.speech;
    const per = await V.speakVoice(LINES.map(t => ({ say: t, text: t })), cfg, fs.mkdtempSync(path.join(tmp, 'p-')), () => {}, null);
    assert.equal(stubs.calls.speech - b2, 3, 'one recording per scene');
    assert.equal(per.length, 3);
  } finally { delete process.env.VOICE_TAKE; }
});

test('word-by-word captions appear when each word is spoken', () => {
  const say = 'Many families don’t know this part about funeral costs';
  const words = Array.from({ length: 9 }, (_, i) => ({ i, start: 0.3 + i * 0.35, end: 0.6 + i * 0.35 }));
  const k = R.spokenTimings('families know funeral costs', say, words, 3.5);
  assert.deepEqual(k, [130, 140, 35, 45]);
  assert.equal(k.reduce((a, b) => a + b, 0), 350, 'spans the caption');
  assert.equal(R.spokenTimings('totally different words', say, words, 3), null, 'no match: length-weighted timing instead');
  assert.equal(R.spokenTimings('anything', say, null, 3), null);
});

test('Pexels: a second source, mixed in, with its own ids and downloads', async () => {
  const B = await import('../stages/broll.js');
  const v = { id: 77, image: 'https://images.pexels.com/x.jpg', video_files: [
    { link: 'http://x/hd.mp4', file_type: 'video/mp4', width: 1080, height: 1920 }, { link: 'http://x/sd.mp4', file_type: 'video/mp4', width: 540, height: 960 }, { link: 'http://x/4k.mp4', file_type: 'video/mp4', width: 2160, height: 3840 }] };
  const h = B.fromPexels(v);
  assert.equal(h.id, 'px77');
  assert.equal(h.videos.medium.url, 'http://x/sd.mp4');
  assert.equal(h.videos.large.url, 'http://x/hd.mp4', 'never the 4K file');
  assert.equal(B.fromPexels({ id: 1, video_files: [] }), null);
  // Pexels clips go through the same blocked-content filter, using the words in their page address.
  assert.match(B.fromPexels({ ...v, url: 'https://www.pexels.com/video/woman-praying-in-church-8263/' }).tags, /church/);
  // Against a stand-in Pexels: results are mixed with Pixabay's and download like any clip.
  let pxCalls = 0;
  const srv = http.createServer((req, res) => {
    pxCalls++;
    assert.equal(req.headers.authorization, 'px-key');
    const base = `http://127.0.0.1:${srv.address().port}`;
    const mk = (id, what = 'grandmother-reading') => ({ id, url: `https://www.pexels.com/video/${what}-${id}/`, image: `${base}/t.jpg`, video_files: [{ link: `${stubs.base}/clip/${id}.mp4`, file_type: 'video/mp4', width: 720, height: 1280 }] });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url.startsWith('/videos/videos/')) return res.end(JSON.stringify(mk(Number(req.url.split('/').pop()))));
    res.end(JSON.stringify({ videos: [mk(9001), mk(9002), mk(9003), mk(9004, 'funeral-flowers-cemetery')] }));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  process.env.PEXELS_API_KEY = 'px-key'; process.env.PEXELS_BASE_URL = `http://127.0.0.1:${srv.address().port}/videos/`;
  try {
    const list = await B.testFootage({ keyword: 'grandmother reading pexels', caption: 'x', visual: 'older adults', rank: null });
    assert.ok(list.some(x => String(x.id).startsWith('px')) && list.some(x => !String(x.id).startsWith('px')), 'both sources');
    assert.ok(!list.some(x => x.id === 'px9004'), 'the cemetery clip is filtered out');
    const got = await B.findClips([{ text: 'a', keyword: 'grandmother reading pexels' }, { text: 'b', keyword: 'grandmother reading pexels' }], { log: () => {} });
    assert.equal(got.length, 2);
    const px = await B.downloadClip('px9002');
    assert.ok(fs.statSync(px).size > 1000, 'a Pexels clip downloads by id');
    assert.ok(pxCalls >= 2);
  } finally { delete process.env.PEXELS_API_KEY; delete process.env.PEXELS_BASE_URL; srv.close(); }
});

test('stock clips one agent used are avoided for the others, and forgotten when a workspace goes', () => {
  const a = store.createWorkspace({ name: 'A' }), b = store.createWorkspace({ name: 'B' });
  store.addUsedClips(a.id, [111, 'px222']);
  assert.deepEqual(store.clipsUsedElsewhere(b.id).sort(), [111, 'px222'].sort());
  assert.deepEqual(store.clipsUsedElsewhere(a.id), [], 'not its own (those are already in its own list)');
  assert.ok(store.clipsToAvoid(a.id).includes(111));
  assert.ok(store.clipsToAvoid(b.id).includes('px222'));
  process.env.SHARED_CLIP_DAYS = '0';
  assert.deepEqual(store.clipsUsedElsewhere(b.id), [], 'turned off');
  delete process.env.SHARED_CLIP_DAYS;
  assert.equal(store.clipsUsedElsewhere(b.id, Date.now() + 200 * 86400000).length, 0, 'old uses expire');
  store.forgetServerClips(a.id);
  assert.deepEqual(store.clipsUsedElsewhere(b.id), []);
});

test('shot list: shots tick off when a clip is described with their words', () => {
  const cfg = M.migrate(M.DEFAULT_CONFIG);
  const none = M.shotList(cfg, []);
  assert.ok(none.length >= 8 && none.every(x => !x.done));
  const some = M.shotList(cfg, [{ description: 'Me at my desk' }, { description: 'waving bye' }]);
  assert.deepEqual(some.filter(x => x.done).map(x => x.id).sort(), ['desk', 'wave']);
  assert.equal(some.at(-1).done, true, 'filmed shots go last');
  assert.ok(none.every(x => !/client/i.test(x.shot) || /never/i.test(x.why)), 'never client faces or papers');
});

test('transcription is priced in the AI cost estimate', async () => {
  const U = await import('../lib/usage.js');
  const m = U.meter();
  m.stt('whisper-1', 60);
  assert.ok(Math.abs(m.total - 0.006) < 1e-9);
});

test('other agents’ clips are avoided gently: allowed again before an unchecked reuse', async () => {
  const B = await import('../stages/broll.js');
  const scenes = [{ text: 'a', keyword: 'older woman kitchen' }];
  const first = await B.findClips(scenes, { log: () => {} });
  // Every result for this search marked as used by another agent: it still finds a checked pick.
  const all = (await B.testFootage({ keyword: 'older woman kitchen', rank: null })).map(x => x.id);
  const logs = [];
  const got = await B.findClips(scenes, { shared: [...all, first[0].id], log: l => logs.push(l) });
  assert.equal(got.length, 1);
  assert.doesNotMatch(logs.join('\n'), /reusing one/);
});
