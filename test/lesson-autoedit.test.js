// Lessons edit themselves (lib/autoedit.js): long pauses get shorter (not removed), "Mango" commands
// said while recording are followed, every lesson's sound is mastered to the same level, and the
// original is always one tap away.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { tempEnv, startStubs, client, queueTranscript } from './helpers.js';

tempEnv();
const stubs = await startStubs();
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const lessons = await import('../lib/lessons.js');
const ae = await import('../lib/autoedit.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });
test.after(() => { server.close(); stubs.close(); });
const port = server.address().port;

// Words at a steady pace: [text, start] pairs, each word 0.3 s long.
const say = (...pairs) => pairs.map(([word, start]) => ({ word, start, end: start + 0.3 }));
const run = (s, from = 0, gap = 0.35) => s.split(' ').map((word, i) => ({ word, start: from + i * gap, end: from + i * gap + 0.3 }));
const kept = (p) => p.wordsKept.map((w) => w.word).join(' ');

test('a long pause gets shorter, not removed; a natural one stays', () => {
  const words = [...run('so here is the thing', 0), ...run('ask what part', 6)];   // a 4.3 s gap
  const p = ae.plan(words, 7.5, { text: 'so here is the thing ask what part' });
  assert.equal(p.changed, true); assert.equal(p.pauses, 1); assert.equal(p.spokenCut, false);
  assert.equal(p.keep.length, 2);
  const joined = (p.keep[0][1] - words[4].end) + (words[5].start - p.keep[1][0]);
  assert.ok(Math.abs(joined - ae.PAUSE.keep) < 0.01, `the joined pause is about ${ae.PAUSE.keep}s, not zero`);
  const calm = ae.plan(run('so here is the thing', 0), 2, { text: 'so here is the thing' });
  assert.equal(calm.changed, false, 'nothing to cut: the video is used as it is');
});

test('Mango commands: start, back, redo and end, and the command itself is always cut', () => {
  const start = ae.plan([...run('okay is this on', 0), ...run('mango start', 2), ...run('hi team', 3)], 4, {});
  assert.equal(kept(start), 'hi team');
  // "back": the last sentence (back to the last short pause).
  const back = ae.plan([...run('ask what part', 0), ...run('then uh no wait', 1.6), ...run('mango back', 3.2), ...run('then show the smaller option', 4)], 6, {});
  assert.equal(kept(back), 'ask what part then show the smaller option');
  // "redo": back to the last long pause, the whole point.
  const redo = ae.plan([...run('first point done', 0), ...run('second point', 3), ...run('more of it', 3.9), ...run('mango redo', 5.2), ...run('second point clean', 6)], 7.5, {});
  assert.equal(kept(redo), 'first point done second point clean');
  const end = ae.plan([...run('that is the lesson', 0), ...run('mango end', 2), ...run('how do I stop this', 3)], 5, {});
  assert.equal(kept(end), 'that is the lesson');
  assert.deepEqual(end.commands.map((c) => c.cmd), ['end']);
  // Punctuation and capitals from the transcript don't matter.
  assert.equal(kept(ae.plan([...say(['Okay,', 0]), ...say(['Mango,', 1], ['start.', 1.35]), ...run('hi', 2)], 3, {})), 'hi');
});

test('“back” never reaches past an earlier command, and the trigger word alone does nothing', () => {
  const p = ae.plan([...run('junk', 0), ...run('mango start', 1), ...run('one', 2), ...run('mango back', 2.4), ...run('two', 3.2)], 4, {});
  assert.equal(kept(p), 'two');
  const alone = ae.plan(run('I love mango smoothies', 0), 2, { text: 'I love mango smoothies' });
  assert.equal(kept(alone), 'I love mango smoothies'); assert.deepEqual(alone.commands, []);
});

test('stress-test fixes: "back" and "redo" stay within reach and find sentence starts', () => {
  // Two "backs" in a row cut two sentences.
  const twice = ae.plan([...run('one two three', 0), ...run('bad sentence one', 1.6), ...run('bad sentence two', 3.2), ...run('mango back', 4.8), ...run('mango back', 5.6), ...run('good ending', 6.6)], 8, {});
  assert.equal(kept(twice), 'one two three good ending');
  // "redo" with no long pause before it acts like "back" instead of wiping everything.
  const redo = ae.plan([...run('point one is this', 0), ...run('point two is that', 2.0), ...run('oops wrong', 4.0), ...run('mango redo', 5.0), ...run('point two clean', 5.9)], 7.5, {});
  assert.equal(kept(redo), 'point one is this point two is that point two clean');
  // A fast talker with no pauses: the transcript's periods mark the sentence.
  const said = 'So ask about their family. Then ask about the price. Then wrong thing here';
  const fast = ae.plan([...run(said.replace(/\./g, ''), 0, 0.32), ...run('mango back right thing', 6.8, 0.32)], 9, { text: `${said}. Mango back. Right thing.` });
  assert.equal(kept(fast), 'So ask about their family Then ask about the price right thing');
  // No sentence start anywhere: it stops at the limit and says so.
  const blind = ae.plan([...run(Array(80).fill('word').join(' '), 0, 0.3), ...run('mango back x', 24.1)], 26, {});
  assert.ok(blind.wordsKept.length > 20, 'never cuts more than the reach');
  assert.match(blind.warnings[0], /stopped 15 seconds back/);
  // A late "start" is pointed out.
  assert.match(ae.plan([...run('real teaching', 0), ...run('mango start rest', 125)], 127, {}).warnings[0], /cut the first 2:05/);
});

test('stress-test fixes: misheard commands still work', () => {
  for (const said of ['man go back', 'mangos back', 'mangoes back', 'mango um back']) {
    assert.equal(kept(ae.plan([...run('wrong sentence', 0), ...run(said, 1.5), ...run('right', 3)], 4, {})), 'right', said);
  }
  assert.equal(kept(ae.plan(run('a man go to the store', 0), 3, {})), 'a man go to the store', 'no command word: nothing happens');
});

test('stress-test fixes: a very slow talker never goes over the join limit', () => {
  const slow = [];
  for (let i = 0; i < 600; i++) slow.push({ word: 'w', start: i * (1.2 + (i % 5) * 0.4), end: i * (1.2 + (i % 5) * 0.4) + 0.3 });
  slow.sort((a, b) => a.start - b.start);
  const p = ae.plan(slow, slow.at(-1).end + 1, {});
  assert.ok(p.keep.length <= ae.MAX_PARTS, `${p.keep.length} parts`);
  assert.ok(p.pauses > 0, 'the longest pauses are still shortened');
});

test('timings that don’t cover what was said: nothing is cut', () => {
  const p = ae.plan(say(['When', 0]), 6, { text: 'When they say they need to think about it, ask what part.' });
  assert.equal(p.changed, false);
});

test('the leader gets one plain line about what was done', () => {
  const p = ae.plan([...run('okay', 0), ...run('mango start', 1), ...run('so here is the thing', 2), ...run('ask what part', 8)], 9.5, {});
  assert.match(ae.summary(p), /^Edited for you: shortened 1 long pause and followed your Mango command \(“start”\)\. \d+ seconds shorter\.$/);
});

test('a gap with no word is cut; a gap where the text has a word the timings dropped is kept', () => {
  // "behaviors" spoken at 1.5–2.6 s: in the transcript text, but missing from the word timings.
  const words = [...run('the key is', 0), ...run('that matter', 3.3)];
  const dropped = ae.plan(words, 4.5, { text: 'the key is behaviors that matter' });
  assert.ok(dropped.cut < 0.5, 'the gap holds a transcribed word, so it stays (only the end trims)');
  assert.equal(dropped.keep.length, 1);
  const empty = ae.plan(words, 4.5, { text: 'the key is that matter' });
  assert.ok(empty.cut > 1.5, 'no word transcribed there: it is a pause and gets shortened');
});

test('words the timings dropped before the first or after the last timed word keep that edge', () => {
  const words = run('so here is the thing', 2.5);
  const p = ae.plan(words, 5, { text: 'listen up so here is the thing' });
  assert.equal(p.keep[0][0], 0);
  const q = ae.plan(words, 5, { text: 'so here is the thing okay done' });
  assert.equal(q.keep.at(-1)[1], 5);
  const r = ae.plan(words, 5, { text: 'so here is the thing' });
  assert.ok(r.keep[0][0] > 2, 'nothing transcribed before: the start is trimmed');
});

test('Mango commands still cut, even with dropped words around them', () => {
  const words = [...run('wrong opening', 0), ...run('mango start', 1), ...run('the real point', 2)];
  const p = ae.plan(words, 3.2, { text: 'um wrong opening mango start the real point' });
  assert.equal(kept(p), 'the real point');
  assert.ok(p.keep[0][0] > 1.5);
});

// With real video from here on.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoedit-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const ff = (...args) => spawnSync('ffmpeg', ['-y', '-v', 'error', ...args]);
const seconds = (f) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).stdout.toString());
// Speech-like tone, 4 s of near silence, tone again: 10 s long.
const clip = path.join(dir, 'pause.mp4');
ff('-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=10', '-f', 'lavfi', '-i', "aevalsrc='if(between(t,3,7),0.0005*random(0),0.3*sin(2*PI*300*t))':d=10:s=48000",
  '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', clip);

test('render cuts the video to the kept stretches', async () => {
  const out = path.join(dir, 'cut.mp4');
  await ae.render(clip, out, [[0, 3.2], [6.8, 10]]);
  assert.ok(Math.abs(seconds(out) - 6.4) < 0.25, `about 6.4 s, got ${seconds(out)}`);
});

test('mastering: quiet and loud recordings come out at the same loudness', () => {
  const loud = (gain) => {
    const out = path.join(dir, `m${gain}.mp4`);
    ff('-i', clip, '-af', `volume=${gain},${ae.MASTER}`, '-c:v', 'copy', '-c:a', 'aac', out);
    const r = spawnSync('ffmpeg', ['-v', 'info', '-i', out, '-af', 'ebur128', '-f', 'null', '-']).stderr.toString();
    return Number([...r.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1)[1]);   // the summary at the end, not a progress line
  };
  const quiet = loud(0.1), hot = loud(2);
  assert.ok(Math.abs(quiet - hot) < 2, `quiet ${quiet} vs loud ${hot} LUFS`);
  assert.ok(Math.abs(hot + 16) < 3, `close to -16 LUFS, got ${hot}`);
});

// The whole way through: she uploads, says "Mango end" while recording, and can switch back.
const mkWs = (name) => { const ws = store.createWorkspace({ name }); store.updateWorkspace(ws.id, { onboarded: true }); return store.getWorkspace(ws.id); };
const team = mkWs('Melanie’s Team');
store.createAccount({ email: 'mel@example.com', name: 'Melanie', role: 'agent', workspaceId: team.id, hash: await auth.hashPassword('melpass123456') });
const waitReady = async (id) => { for (let i = 0; i < 300; i++) { const l = lessons.get(team.id, id); if (l.status !== 'processing') return l; await new Promise((r) => setTimeout(r, 100)); } throw new Error('never ready'); };

test('an uploaded lesson is trimmed and mastered, and the original is one tap away', async () => {
  const mel = client(port);
  assert.equal((await mel.post('/api/login', { email: 'mel@example.com', password: 'melpass123456' })).status, 200);
  const words = [...run('ask what part it is', 0.2), ...run('then show the smaller option', 1.8), ...run('mango end', 7.5), ...run('how do I stop', 8.4)];
  queueTranscript(
    { text: 'Ask what part it is. Then show the smaller option. Mango end. How do I stop?', duration: 10, words },
    { text: 'Ask what part it is. Then show the smaller option.', duration: 4, words: [] },
  );
  const up = await fetch(`http://127.0.0.1:${port}/api/reels/lessons`, { method: 'POST', headers: { cookie: mel.cookie, 'Content-Type': 'video/mp4' }, body: fs.readFileSync(clip) }).then(async (r) => ({ status: r.status, data: await r.json() }));
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const l = await waitReady(up.data.lesson.id);
  assert.equal(l.status, 'ready', l.error);
  assert.equal(l.video.using, 'edited');
  assert.ok(l.video.original && l.video.original !== l.video.file, 'the original is kept');
  assert.equal(l.transcript, 'Ask what part it is. Then show the smaller option.', 'the words match the edited video');
  assert.ok(seconds(lessons.fileOf(team.id, l.id)) < 5, 'cut after “Mango end”');
  assert.match(l.edit.summary, /followed your Mango command \(“end”\)/);
  const view = (await mel.get('/api/reels/lessons')).data.lessons.find((x) => x.id === l.id);
  assert.equal(view.edit.using, 'edited'); assert.equal(view.v, 'edited');

  const back = await mel.put(`/api/reels/lessons/${l.id}`, { version: 'original' });
  assert.equal(back.status, 200, JSON.stringify(back.data));
  const orig = lessons.get(team.id, l.id);
  assert.equal(orig.video.using, 'original'); assert.equal(orig.video.seconds, 10);
  assert.match(orig.transcript, /Mango end/, 'the words follow the video she chose');
  assert.ok(seconds(lessons.fileOf(team.id, l.id)) > 9);
  await mel.put(`/api/reels/lessons/${l.id}`, { version: 'edited' });
  assert.equal(lessons.get(team.id, l.id).video.using, 'edited');

  const files = [orig.video.edited, orig.video.original].map((f) => path.join(path.dirname(lessons.fileOf(team.id, l.id)), f));
  assert.equal((await mel.del(`/api/reels/lessons/${l.id}`)).status, 200);
  assert.ok(files.every((f) => !fs.existsSync(f)), 'deleting the lesson removes both versions');
});
