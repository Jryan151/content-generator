// v15 Phase 6: the finishing work on every video — caption craft, Instagram's safe zones, even footage,
// cuts on the beat, a clean loop and sound leveled for Instagram.
// The measurements run with the real FFmpeg (skipped without it).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { tempEnv, hasFfmpeg, startStubs } from './helpers.js';

tempEnv();
const noFfmpeg = !hasFfmpeg() && 'FFmpeg not installed';
const render = await import('../stages/render.js');
const craft = await import('../stages/craft.js');
const ff = args => { const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]); assert.equal(r.status, 0, String(r.stderr)); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'finish-test-'));
const linesOf = t => { const w = render.smartQuotes(t).split(' '); return render.balanceLines(w).map(l => l.map(i => w[i]).join(' ')); };

test('caption craft: real quotes and apostrophes, and no line breaks that read badly', () => {
  assert.equal(render.smartQuotes(`Don't wait for "someday"`), 'Don’t wait for “someday”');
  assert.equal(render.smartQuotes(`It's the agents' job`), 'It’s the agents’ job');
  assert.equal(render.smartQuotes(`Back in the '90s`), 'Back in the ’90s');
  assert.equal(render.smartQuotes(`She said 'call me'`), 'She said ‘call me’');
  // Names, set phrases and numbers stay on one line; no line ends on "the", "your", "a".
  const cases = ['Social Security survivor benefits may help your family', 'What would your mortgage look like without you', 'Final expense coverage can often fit a tight budget',
    'In 10 years your needs will change', 'Planning ahead is a gift to the people you love', 'Whole life builds cash value over time', 'Have you thought about who pays for your funeral?'];
  for (const c of cases) {
    const lines = linesOf(c);
    assert.ok(lines.length <= 3, c);
    assert.equal(lines.join(' '), render.smartQuotes(c), 'no words lost or moved');
    for (const l of lines.slice(0, -1)) assert.doesNotMatch(l, /\s(the|a|an|your|my|our)$/i, `"${l}" ends badly in: ${lines.join(' / ')}`);
    const joined = lines.join(' / ');
    for (const pair of ['Social / Security', 'Final / expense', 'cash / value', '10 / years', 'Whole / life']) assert.ok(!joined.includes(pair), `${pair} split in: ${joined}`);
  }
  assert.deepEqual(linesOf('Social Security survivor benefits may help'), ['Social Security', 'survivor benefits', 'may help'], 'no thin middle line');
  assert.deepEqual(linesOf('Message me to talk'), ['Message me to talk']);
  // Fewer words than the length would need lines for: one word a line, never a crash.
  assert.deepEqual(linesOf('#LifeInsuranceAwarenessMonth #FinalExpensePlanning'), ['#LifeInsuranceAwarenessMonth', '#FinalExpensePlanning']);
  assert.deepEqual(linesOf('Supercalifragilisticexpialidocious'), ['Supercalifragilisticexpialidocious']);
  assert.equal(render.captionMarkup('Visit https://example.com/a-very-long-booking-link-for-you', null).lines, 2);
  // The end card's small print is sized by its length (three lines at most, clear of the handle).
  const ass = render.assFile({ scenes: [{ text: 'Hi' }], starts: [0], durs: [2], cfg: { look: { name: 'A', disclaimer: 'x '.repeat(200) } }, family: 'Poppins SemiBold', endAt: 2, total: 4.5 });
  const fsSmall = Number(ass.match(/\\q0\\fs(\d+)/)[1]);
  assert.ok(fsSmall >= 24 && fsSmall < 44, String(fsSmall));
  // The accent word still matches with a straight or curly apostrophe.
  const m = render.captionMarkup(`It's never too early`, `it’s`, { color: render.assColor('#F6C453') });
  assert.match(m.text, /\{\\i1\\1c&H0053C4F6&\}It’s\{\\i0/);
  assert.doesNotMatch(m.text, /'/);
});

test('beats: a steady beat is found (tempo and where it starts), noise has none, and cuts move to it within limits', () => {
  // 10 ms energies: a pulse every 0.5 s starting at 0.23 s, over quiet noise.
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const energy = Array.from({ length: 3000 }, (_, i) => 0.001 + 0.0005 * rnd() + ((i - 23) % 50 === 0 && i >= 23 ? 0.2 : 0));
  const b = craft.findBeat(energy);
  assert.ok(b, 'found');
  assert.ok(Math.abs(b.period - 0.5) < 0.01, JSON.stringify(b));
  assert.ok(Math.abs(b.phase - 0.23) < 0.02, JSON.stringify(b));
  assert.equal(craft.findBeat(Array.from({ length: 3000 }, () => 0.001 + 0.001 * rnd())), null, 'noise has no beat');
  assert.equal(craft.findBeat(energy.slice(0, 300)), null, 'too short to tell');
  const beats = craft.beatTimes(b, 12);
  assert.ok(beats.length >= 24 && Math.abs(beats[1] - beats[0] - b.period) < 0.002);
  // Cuts land on beats; a scene never shrinks below its minimum (a spoken line), and the body never grows past `most`.
  const durs = [2.1, 2.6, 1.9];
  const snapped = craft.snapCuts(durs, [0.23, 0.73, 1.23, 1.73, 2.23, 2.73, 3.23, 3.73, 4.23, 4.73, 5.23, 5.73, 6.23, 6.73, 7.23], { mins: [2.0, 2.3, 1.7], stretch: 0.4 });
  let t = 0; for (const d of snapped) { t += d; assert.ok([2.23, 4.73, 6.73].some(x => Math.abs(x - t) < 0.011), `cut at ${t}`); }
  assert.ok(snapped.every((d, i) => d >= [2.0, 2.3, 1.7][i]));
  assert.deepEqual(craft.snapCuts(durs, [9, 10]), durs, 'no beat close by: unchanged');
  const capped = craft.snapCuts([2, 2], [2.35, 4.7], { stretch: 0.4, most: 4.1 });
  assert.ok(capped.reduce((a, c) => a + c, 0) <= 4.1 + 1e-9, 'never pushed over the limit');
});

test('even footage: brighter, redder or bluer clips are nudged toward the group; shadows deepen on bright footage', () => {
  const plan = craft.matchPlan([{ y: 200, u: 128, v: 128 }, { y: 110, u: 128, v: 128 }, { y: 120, u: 140, v: 150 }, null]);
  assert.ok(plan[0].brightness < 0, 'the bright clip is darkened');
  assert.ok(plan[2].rm < 0 && plan[2].bm < 0, 'the color cast is pulled back');
  assert.equal(plan[3], null);
  assert.ok(Math.abs(plan[0].brightness) <= 0.08 && Math.abs(plan[2].rm) <= 0.05, 'gently');
  assert.deepEqual(craft.matchPlan([{ y: 120, u: 128, v: 128 }, { y: 121, u: 128, v: 128 }]).map(p => p.brightness), [0, 0], 'already even: left alone');
  assert.equal(craft.matchFilter(null), '');
  assert.match(craft.matchFilter({ brightness: -0.05, rm: 0.01, bm: 0 }), /^,eq=brightness=-0\.05,colorbalance=rm=0\.01:bm=0$/);
  assert.deepEqual([60, 150, 200, undefined].map(craft.shadowLevel), [0, 1, 2, 0]);
  // A fade-in from black is skipped, but never so far that a short clip loops back into it mid-scene.
  const short3s = { fps: 4, frames: [5, 10, 40, 120, 130, 130, 130, 128, 130, 130, 130, 130].map(y => ({ y })) };   // 3 s, fading in for 0.75 s
  assert.equal(craft.openingOffset(short3s, 1.5), 0.75, 'room to skip the whole fade');
  assert.equal(craft.openingOffset(short3s, 2.5), 0.25, 'only as far as the clip allows');
  assert.equal(craft.openingOffset(short3s, 3.5), 0, 'shorter than the scene: it loops anyway, so from the start');
  assert.equal(craft.openingOffset({ fps: 4, frames: Array.from({ length: 56 }, (_, i) => ({ y: i < 3 ? 5 : 130 })) }, 20), 0.75, 'a long clip (read to the limit) has room');
  // A clip dark all through isn't "fading in".
  const fading = { fps: 4, frames: [5, 10, 40, 120, 130, 130, 130, 128].map(y => ({ y })) };
  assert.equal(craft.fadeInEnd(fading), 0.75);
  assert.equal(craft.fadeInEnd({ fps: 4, frames: [8, 9, 10, 9].map(y => ({ y })) }), 0);
  assert.equal(craft.fadeInEnd({ fps: 4, frames: [120, 125].map(y => ({ y })) }), 0);
});

test('measured with FFmpeg: a clip’s look and fade-in, a track’s beat (remembered), and loudness', { skip: noFfmpeg, timeout: 120000 }, async () => {
  const dir = tmp();
  ff(['-f', 'lavfi', '-i', 'color=c=white:s=720x1280:d=4,format=yuv420p', '-vf', 'fade=t=in:st=0:d=0.8', '-r', '30', path.join(dir, 'fade.mp4')]);
  const look = await craft.clipLook(path.join(dir, 'fade.mp4'));
  assert.equal(look.frames.length, 16);
  assert.ok(craft.fadeInEnd(look) > 0.2 && craft.fadeInEnd(look) <= 1, String(craft.fadeInEnd(look)));
  assert.ok(craft.lookOver(look, 1, 2).y > 200 && craft.lookOver(look, 1, 2).cap > 200);
  ff(['-f', 'lavfi', '-i', "aevalsrc='0.8*sin(2*PI*880*t)*exp(-40*mod(t-0.23,0.5))*gte(t,0.23)':s=44100:d=20", path.join(dir, 'beat.mp3')]);
  const beat = await craft.musicBeats(path.join(dir, 'beat.mp3'));
  assert.ok(beat && Math.abs(beat.period - 0.5) < 0.011 && Math.abs(beat.phase - 0.23) < 0.03, JSON.stringify(beat));
  const paths = await import('../lib/paths.js');
  const saved = paths.readJSON(path.join(paths.DIRS.data, 'beats.json'), {});
  assert.equal(Object.keys(saved).length, 1, 'remembered per track');
  ff(['-f', 'lavfi', '-i', 'anoisesrc=a=0.3:d=12', path.join(dir, 'noise.mp3')]);
  assert.equal(await craft.musicBeats(path.join(dir, 'noise.mp3')), null);
  const loud = await craft.measureLoudness(path.join(dir, 'beat.mp3'));
  assert.ok(loud && Number.isFinite(loud.I) && loud.I < 0);
  // The second pass: an exact gain when the peaks allow, a limiter on the peaks when they don't, the one-pass
  // leveler without a measurement (or a limiter).
  assert.equal(craft.levelFilter({ I: -24, TP: -14, LRA: 6, thresh: -34, offset: 0 }), 'volume=10dB');
  assert.match(craft.levelFilter({ I: -20, TP: -3, LRA: 6, thresh: -30, offset: 0 }), /^volume=6dB,alimiter=limit=0\.79\d*:/);
  assert.match(craft.levelFilter({ I: -20, TP: -3, LRA: 6, thresh: -30, offset: 0 }, { limiter: false }), /linear=true/);
  assert.equal(craft.levelFilter(null), 'loudnorm=I=-14:TP=-1.5:LRA=11');
  assert.equal(typeof await craft.limiterAvailable(), 'boolean');
  // Peaky sound that needs the limiter still lands on the target: the loudness the limiter takes is put back.
  ff(['-f', 'lavfi', '-i', "aevalsrc='0.08*sin(2*PI*220*t)+0.9*sin(2*PI*660*t)*exp(-25*mod(t,0.5))':s=48000:d=12", '-c:a', 'pcm_f32le', path.join(dir, 'peaky.wav')]);
  const plan = await craft.levelPlan(path.join(dir, 'peaky.wav'), dir);
  assert.ok(plan.measured);
  if (await craft.limiterAvailable()) assert.match(plan.filter, /alimiter/);
  ff(['-i', path.join(dir, 'peaky.wav'), '-af', plan.filter, '-c:a', 'aac', path.join(dir, 'peaky.m4a')]);
  const pj = JSON.parse(spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path.join(dir, 'peaky.m4a'), '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.match(/\{[^{}]*"input_i"[^{}]*\}/)[0]);
  assert.ok(Math.abs(Number(pj.input_i) + 14) <= 1, `peaky loudness ${pj.input_i}`);
  assert.ok(Number(pj.input_tp) <= -1.0, `peaky true peak ${pj.input_tp}`);
  assert.ok(!fs.existsSync(path.join(dir, 'level-check.wav')), 'its working file is cleaned up');
  ff(['-f', 'lavfi', '-i', 'anullsrc=d=3', path.join(dir, 'silent.wav')]);
  assert.equal(await craft.measureLoudness(path.join(dir, 'silent.wav')), null, 'silence: leveled in one pass instead');
});

test('safe zones: every frame of the captions is checked against Instagram’s buttons and post text', { skip: noFfmpeg, timeout: 60000 }, async () => {
  const dir = tmp();
  const head = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Text,Poppins SemiBold,126,&H00ECF2F5,&HFF000000,&H80000000,&HFF000000,0,0,0,0,100,100,0.5,0,1,1.6,0,2,60,60,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const ev = (a, b, tags, t) => `Dialogue: 1,0:00:0${a}.00,0:00:0${b}.00,Text,,0,0,0,,{${tags}}${t}\n`;
  fs.writeFileSync(path.join(dir, 'c.ass'), head
    + ev(0, 1, '\\an2\\pos(540,1350)', 'Fits nicely\\Nin the middle')
    + ev(1, 2, '\\an2\\pos(900,1300)', 'Under the buttons')
    + ev(2, 3, '\\an2\\pos(540,1800)', 'Under the post')
    + ev(3, 4, '\\an8\\pos(540,60)', 'Header'));
  const groups = [0, 1, 2, 3].map(i => ({ label: `s${i}`, from: i, to: i + 1 }));
  const r = await craft.checkSafeZones({ assPath: path.join(dir, 'c.ass'), fontDir: path.resolve('assets/fonts'), seconds: 4, groups });
  assert.equal(r.frames, 120, 'every frame, 30 a second');
  assert.equal(r.problems.s0, undefined, 'the centered caption is clear');
  assert.ok(r.problems.s1.includes('right'));
  assert.ok(r.problems.s2.includes('bottom'));
  assert.ok(r.problems.s3.includes('top'));
  assert.ok(craft.ZONE_WORDS.right && craft.ZONE_WORDS.bottom);
});

test('a finished video: leveled to Instagram, captions kept clear, no black first frame, and it loops cleanly', { skip: noFfmpeg, timeout: 300000 }, async () => {
  const dir = tmp();
  // Scene 1's clip fades in from black (as stock often does); scene 2's is very bright.
  ff(['-f', 'lavfi', '-i', 'color=c=#6b8fb5:s=720x1280:d=4,format=yuv420p', '-vf', 'fade=t=in:st=0:d=0.75', '-r', '30', path.join(dir, 'a.mp4')]);
  ff(['-f', 'lavfi', '-i', 'color=c=#f4f4f4:s=720x1280:d=4,format=yuv420p', '-r', '30', path.join(dir, 'b.mp4')]);
  const voice = [1.4, 1.2].map((d, i) => { const f = path.join(dir, `v${i}.mp3`); ff(['-f', 'lavfi', '-i', `sine=frequency=${220 + 60 * i}:duration=${d}`, '-ac', '1', '-b:a', '64k', f]); return { file: f, duration: d }; });
  ff(['-f', 'lavfi', '-i', "aevalsrc='0.5*sin(2*PI*660*t)*exp(-30*mod(t-0.1,0.5))':s=44100:d=20", path.join(dir, 'm.mp3')]);
  const cfg = { output: { minSeconds: 1.5, mode: 'voiceover' }, look: { name: 'Jacqueline Montgomery-Richardson the Third', title: 'Licensed Agent', location: 'Austin, TX', endCta: `Let's talk`, disclaimer: 'Licensed in Texas. Not affiliated with or endorsed by any government agency.' } };
  const scenes = [{ text: 'Social Security survivor benefits may help', say: 'a', accent: 'survivor' }, { text: 'WWWWWWWWWWWW', say: 'b' }];
  const out = await render.renderVideo({ scenes, clips: [path.join(dir, 'a.mp4'), path.join(dir, 'b.mp4')], cfg, outFile: path.join(dir, 'out.mp4'), workDir: dir, voice, music: path.join(dir, 'm.mp3'), log: () => {} });
  assert.ok(out.safe && out.safe.frames > 100, JSON.stringify(out.safe));
  assert.deepEqual(out.safe.left, [], 'nothing left in Instagram’s zones: ' + JSON.stringify(out.safe));
  assert.ok(out.safe.fixed.includes('scene 2'), 'the too-wide caption was made smaller: ' + JSON.stringify(out.safe));
  assert.ok(out.finish.loop && out.finish.loud && out.finish.opened === 1, JSON.stringify(out.finish));
  assert.equal(out.finish.shadow[1], 2, 'the bright scene gets the strongest shadow');
  assert.ok(out.sceneSeconds.every((d, i) => d >= voice[i].duration + 0.2 - 1 / 60), 'no spoken line is cut short');
  assert.ok(out.sceneSeconds.every(d => Math.abs(d * 30 - Math.round(d * 30)) < 1e-6), 'scenes are whole frames, so cuts land where they’re meant to: ' + out.sceneSeconds);
  // The picture and the sound start together (no B-frame delay at the start).
  const starts = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=start_time', '-of', 'csv=p=0', out.file], { encoding: 'utf8' }).stdout.trim().split('\n').map(Number);
  assert.deepEqual(starts, [0, 0]);
  // The safe-zone check sees every word as white (a dark accent color can't hide from it).
  const check = fs.readFileSync(path.join(dir, 'captions-check.ass'), 'utf8'), real = fs.readFileSync(path.join(dir, 'captions.ass'), 'utf8');
  const accent = real.match(/\\i1\\1c(&H00[0-9A-F]{6}&)/)[1];
  assert.notEqual(accent, '&H00ECF2F5&');
  assert.ok(!check.includes(`\\1c${accent}`) && check.includes('\\i1\\1c&H00ECF2F5&'), 'the accent word is white in the check copy');
  // Loudness: Instagram's level, peaks kept under it.
  const m = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', out.file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.match(/\{[^{}]*"input_i"[^{}]*\}/);
  const j = JSON.parse(m[0]);
  assert.ok(Math.abs(Number(j.input_i) + 14) <= 1, `loudness ${j.input_i}`);
  assert.ok(Number(j.input_tp) <= -1.0, `true peak ${j.input_tp}`);
  // The first frame isn't black (the fade-in was skipped), and the last frame is back on the first.
  const frame = at => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...(at === 'last' ? ['-sseof', '-0.04'] : ['-ss', String(at)]), '-i', out.file, '-frames:v', '1', '-vf', 'scale=54:96,format=gray', '-f', 'rawvideo', '-']); return r.stdout; };
  const first = frame(0), last = frame('last');
  const avg = b => b.reduce((a, x) => a + x, 0) / b.length;
  assert.ok(avg(first) > 60, `first frame brightness ${avg(first)}`);
  const diff = first.reduce((a, x, i) => a + Math.abs(x - last[i]), 0) / first.length;
  assert.ok(diff < 12, `the last frame is close to the first (difference ${diff})`);
});

test('the process runner hands frames over as they come, and stops on a reader’s error', { skip: noFfmpeg }, async () => {
  const { runProc } = await import('../lib/proc.js');
  let bytes = 0;
  const r = await runProc('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=64x64:r=10:d=2', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { onData: d => { bytes += d.length; } });
  assert.equal(r.code, 0);
  assert.equal(bytes, 64 * 64 * 20);
  assert.equal(r.stdout, '', 'nothing kept');
  await assert.rejects(runProc('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=64x64:r=10:d=30', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { onData: () => { throw new Error('bad frame'); } }), /bad frame/);
});
