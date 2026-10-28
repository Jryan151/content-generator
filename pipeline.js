// pipeline.js — the master bus. Runs the stages in order for one workspace:
//   script → (voice) → footage → render → cover → preflight checks → save for review
// fixVideo() re-renders one video after a caption edit or a clip swap, without a new script.
import fs from 'fs';
import path from 'path';
import { DIRS, newId, readJSON, writeJSON } from './lib/paths.js';
import { checkStopped, currentSignal, currentJob } from './lib/proc.js';
import { step as flightStep } from './lib/flight.js';
import { crashPoint } from './lib/faults.js';
import { isServiceFailure } from './lib/breaker.js';
import crypto from 'crypto';
import * as store from './lib/store.js';
import { meter as makeMeter, count } from './lib/usage.js';
import { generateScript, packScript, writePost, makeAsk } from './stages/script.js';
import { speakScenes, speakVoice, takeMode } from './stages/voice.js';
import { findClips, swapClip, clipFile, downloadClip } from './stages/broll.js';
import { lens } from './lib/lens.js';
import * as library from './lib/library.js';
import * as memory from './lib/memory.js';
import { rankClips, thumbnailOf } from './stages/vision.js';
import { renderVideo, makeCover, inspectVideo } from './stages/render.js';
import { ZONE_WORDS } from './stages/craft.js';
import { ensureFont } from './stages/fonts.js';
import { validateScript, validatePost, insightStatus, boostsFrom, winnersFrom, studioPicks, studioChecks, applyAutoFixes, SHOT_TYPES, tasteFrom, AI_VOICE_NOTE, RULES } from './mixer-core.js';
// The locked compliance rules this version checks every script against, recorded on each video (and each
// fix), so its receipt lists what was actually checked.
const LOCKED = Object.keys(RULES).filter(k => RULES[k].locked);

export const MAX_FIXES = 5;
const permanent = msg => Object.assign(new Error(msg), { permanent: true });
const assetsDir = (ws, id) => path.join(DIRS.assets, ws, id);

// `skip`: tracks the agent turned down (a video rejected for its music), never picked again for them.
export function pickMusic(log, skip = []) {
  const all = fs.readdirSync(DIRS.music).filter(n => /\.(mp3|m4a|wav|aac|ogg)$/i.test(n));
  const tracks = all.filter(n => !skip.includes(n));
  if (!tracks.length) { log(all.length ? 'Music is on, but you’ve turned down every track in the music folder. Rendering without music.' : 'Music is on, but the music folder is empty. Rendering without music.'); return null; }
  const t = tracks[Math.floor(Math.random() * tracks.length)];
  log('Music: ' + t);
  return path.join(DIRS.music, t);
}

// The scene's `shot` (from the shot plan) and `manual` (a search the agent typed) shape what counts as a fit.
export const clipChecker = (cfg, visual, meter) => (cfg.output.clipCheck === 'off' ? null
  : (hits, scene) => rankClips({ clips: hits.map(h => ({ image: thumbnailOf(h) })), caption: scene.text, see: scene.see || '', keyword: scene.keyword, visual, place: cfg.look?.location, meter, shot: SHOT_TYPES[scene.shot] || null, manual: !!scene.manual }));

// Automatic checks shown on the review card. The agent still watches the video before approving.
export function preflight({ cfg, meta, scenes, clips, out, post, inspect, logo, now = Date.now() }) {
  const items = [];
  const add = (ok, label) => items.push({ ok, label });
  add(true, 'Script passed every compliance check');
  // Made while a service was down (limp mode, lib/breaker.js): it says so, so the agent can decide.
  if (meta.limp?.includes('voice')) add(false, 'The voice service wasn’t answering, so this video was made with captions only. Make it again later if you want the voiceover.');
  if (meta.limp?.includes('footage')) add(false, 'The stock footage sites weren’t answering, so every scene uses your own clips. Check each one fits its line.');
  // Notes the agent rendered past in Studio (or a fix): shown again here, before approving.
  if (meta.notes?.length) add(false, `You rendered past ${meta.notes.length === 1 ? 'a note' : `${meta.notes.length} notes`}: ${meta.notes.slice(0, 4).join(' ')}${meta.notes.length > 4 ? ' …' : ''}`);
  // The persuasion lens flagged pressure (urgency, scarcity, a testimonial): worth a careful look.
  if (meta.pressure?.length) add(false, `The persuasion check felt some pressure here (${(meta.pressureWords?.length ? meta.pressureWords : meta.pressure).join('; ')}). Read it as a client would before approving.`);
  // Every fact the video teaches must still be confirmed.
  const ids = (meta.facts?.length ? meta.facts.map(f => f.id) : [meta.insightId]).filter(Boolean);
  const facts = ids.map(id => cfg.story.insights.find(i => i.id === id));
  const allOk = facts.length && facts.every(f => f && insightStatus(f, now) === 'confirmed');
  if (meta.noFact && !ids.length) add(true, 'Teaches no specific fact (your choice in Studio): checked for prices, numbers, promises and the other compliance rules, with no fact to match');
  else add(allOk, allOk ? `Uses ${facts.length > 1 ? `${facts.length} facts` : 'a fact'} you confirmed${facts[0]?.source ? ` (source: ${facts[0].source})` : ''}` : 'A fact in this video is no longer confirmed. Check it in Content before posting.');
  const unchecked = clips.map((c, i) => (c.checked || c.chosen ? null : i + 1)).filter(Boolean);
  const picked = clips.map((c, i) => (c.chosen ? i + 1 : null)).filter(Boolean);
  const pickedScored = clips.filter(c => c.chosen && c.checked).length;
  if (picked.length) add(true, `You chose the footage in scene${picked.length > 1 ? 's' : ''} ${picked.join(', ')}${pickedScored === picked.length ? ' (the clip check scored it too)' : ' in Studio (not checked by AI)'}`);
  if (cfg.output.clipCheck === 'off') add(false, 'AI clip check is off. Look closely at the footage in every scene.');
  else {
    const weak = clips.map((c, i) => (c.checked && c.score && c.score < 3 ? `scene ${i + 1} (${c.score}/5${c.reason ? ': ' + c.reason : ''})` : null)).filter(Boolean);
    add(!unchecked.length && !weak.length, unchecked.length ? `Footage in scene${unchecked.length > 1 ? 's' : ''} ${unchecked.join(', ')} wasn’t checked by AI. Look closely.`
      : weak.length ? `Weak footage match in ${weak.join(', ')}. Use Fix a scene to swap it.` : picked.length === clips.length ? 'Every scene uses footage you chose' : picked.length ? 'AI checked the footage in the other scenes' : 'AI checked the footage in every scene');
  }
  const long = (out.lines || []).map((n, i) => (n > 3 ? i + 1 : null)).filter(Boolean);
  add(!long.length, long.length ? `Caption${long.length > 1 ? 's' : ''} in scene ${long.join(', ')} run${long.length > 1 ? '' : 's'} over 3 lines` : 'Every caption fits in 3 lines or fewer');
  add(out.duration <= 60, `${Math.round(out.duration)} seconds long${out.duration > 60 ? ' (over a minute)' : ''}`);
  // Instagram's own screen (its buttons, the post text): every frame of the captions was checked against it.
  if (out.safe === null) add(false, 'The safe-zone check couldn’t run. Check the captions stay clear of Instagram’s buttons and post text.');
  else if (out.safe) {
    const left = out.safe.left || [], fixed = out.safe.fixed || [];
    // A scene's caption is fixed with Fix a scene; the end card's words come from Brand.
    const say = l => (l.where === 'the end card' ? `The end card would sit ${l.zones.map(z => ZONE_WORDS[z] || z).join(' and ')}. Shorten your name, title or call to action in Brand`
      : `The caption in ${l.where} would sit ${l.zones.map(z => ZONE_WORDS[z] || z).join(' and ')}. Shorten it with Fix a scene`);
    add(!left.length, left.length ? `${left.map(say).join('. ')}.`
      : `Captions stay clear of Instagram’s buttons and post text (every frame checked)${fixed.length ? `; ${fixed.join(' and ')} made a little smaller to fit` : ''}`);
  }
  if (inspect !== undefined) {
    // Where a problem is, in scene numbers, so it can be fixed with Fix a scene.
    const starts = []; let t = 0; (out.sceneSeconds || []).forEach(d => { starts.push(t); t += d; });
    const where = sec => { if (!starts.length) return `at ${sec.toFixed(1)}s`; let k = 0; starts.forEach((st, i) => { if (sec >= st - 0.05) k = i; }); return sec >= t ? 'on the end card' : `in scene ${k + 1}`; };
    const list = arr => [...new Set(arr.map(([a]) => where(a)))].join(', ');
    if (!inspect) add(false, 'The final video check couldn’t run. Watch the whole video closely.');
    else {
      const issues = [];
      if (inspect.black.length) issues.push(`a black screen ${list(inspect.black)}`);
      if (inspect.frozen.length) issues.push(`a frozen picture ${list(inspect.frozen)}`);
      if (inspect.silent.length) issues.push(`a long silence ${list(inspect.silent)}`);
      add(!issues.length, issues.length ? `Final check found ${issues.join(' and ')}. Use Fix a scene to swap that clip.` : 'Final check: no black, frozen or silent stretches');
    }
  }
  // The finishing touches that were made (stages/craft.js), so the agent knows what's been done.
  const done = out.finish ? [out.finish.matched ? 'clips evened out in brightness and color' : '', out.finish.beat ? 'cuts on the music’s beat' : '', out.finish.loop ? 'loops smoothly back to the start' : '', out.finish.loud ? 'sound leveled for Instagram' : ''].filter(Boolean) : [];
  if (done.length) add(true, `Finished: ${done.join(', ')}`);
  add(!!post, post ? 'Post text is ready and passed the same checks' : 'No post text passed the checks. Write your own before posting.');
  if ((cfg.look?.endCard || 'on') === 'on') add(!!cfg.look?.name, cfg.look?.name ? 'End card shows your name' : 'End card has no name. Add it in Brand.');
  if ((cfg.look?.endCard || 'on') === 'on' && cfg.look?.logo === 'on' && logo !== undefined) add(!!logo, logo ? 'End card shows your logo' : 'Logo is on, but no logo is uploaded. Add one in Brand.');
  return items;
}

// Overnight videos write one draft (OVERNIGHT_DRAFTS, default 1): nobody is waiting on them, and it
// halves their AI cost. Videos made by hand keep the agent's Drafts setting.
export const overnightDrafts = () => Math.max(1, Math.min(3, Math.round(Number(process.env.OVERNIGHT_DRAFTS) || 1)));

// `studio`: a draft built by hand in Studio ({ brief, scenes }): its script and chosen clips are used
// as they are, after the same checks (run again here, in case a fact was unconfirmed since).
// `checkpoint`: a folder kept between tries of the same job (the queue passes data/work/job-<id>). Each
// stage's result is saved there as it finishes (script, voice, footage, the persuasion read, the
// render), so a retry or a wait for an outage picks up where it stopped: the same video, paid for once.
// Without one (the command line), everything is made fresh in a temporary folder.
// `limp`: may this video be made in limp mode? If the voice service (or both stock sites) has failed this
// video's tries LIMP_AFTER_TRIES times in a row (this try included: about 20 minutes of waiting), it's made
// anyway (captions only, or the agent's own clips) and says so on its review card. Each stage keeps its
// own count, so an outage elsewhere (the writer, say) never sends the voice to captions early.
const LIMP_AFTER_TRIES = () => (Number(process.env.LIMP_AFTER_TRIES) > 0 ? Number(process.env.LIMP_AFTER_TRIES) : 3);
// `replace` (v15, Studio): the video this draft was submitted as before. While it's still waiting for review
// (or rejected), the new render replaces it as its next version, so the agent always sees the latest,
// marked "Updated", with what changed; an approved or posted one is a record and stays (a new video is
// made instead). `by`: who submitted it.
export async function makeVideo({ ws, force = {}, source = 'manual', log = console.log, studio = null, checkpoint = null, limp = false, replace = '', by = '' }) {
  const cfg = store.loadConfig(ws);
  if (studio) cfg.output.scenes = studio.scenes.length;
  if (source === 'overnight') cfg.output.drafts = Math.min(cfg.output.drafts, overnightDrafts());
  const meter = makeMeter(ws);
  const statePath = checkpoint && path.join(checkpoint, 'state.json');
  const state = (statePath && readJSON(statePath, null)) || {};
  const id = state.id || newId();
  const workDir = checkpoint || path.join(DIRS.work, id);
  // (A try the watchdog has given up on writes nothing: the next try owns the folder.)
  const keep = patch => { if (!statePath || currentSignal()?.aborted) return; Object.assign(state, patch, { id, cost: Math.round(((state.costBefore || 0) + meter.total) * 1e5) / 1e5 }); writeJSON(statePath, state); };
  state.costBefore = state.cost || 0;   // what earlier tries already spent
  // A saved script is only used again if it still passes today's checks (a fact may have been
  // unconfirmed, a rule added, or the video type changed since). Otherwise everything is made afresh.
  if (state.script && !savedScriptOk(state, cfg, studio)) {
    log('The settings changed since the last try, so the script is written again.');
    for (const k of ['script', 'voice', 'clips', 'lens', 'render']) delete state[k];
  }
  let stage = 'script';
  let voiceMode = cfg.output.mode === 'voiceover';
  const steps = voiceMode ? 5 : 4;
  const limped = [];
  let step = 0;
  const say = msg => log(`[${++step}/${steps}] ${msg}`);
  fs.mkdirSync(workDir, { recursive: true });
  // This video was already saved by an earlier try that failed after saving: it's done.
  const replaced = replace && state.id ? store.getVideo(ws, replace) : null;
  const already = (state.id && store.getVideo(ws, state.id)) || ((replaced?.versions || []).some(x => x.src === state.id) ? replaced : null);
  if (already) { log('This video was already saved by an earlier try.'); if (checkpoint) fs.rmSync(checkpoint, { recursive: true, force: true }); return already; }
  keep({});
  try {
    // Fonts first: a missing font should stop the run before any AI cost.
    await ensureFont(cfg.look?.font || 'Poppins SemiBold', log);
    flightStep('script');
    say(studio ? 'Checking your script…' : 'Writing the script…');
    const videos = store.readVideos(ws);
    let script = state.script || null, studioNotes = [];
    if (script) log('Using the script from the last try.');
    else if (studio) {
      const picks = { ...studioPicks(cfg, studio.brief), recent: store.readRecent(ws).filter(r => !replace || r.videoId !== replace) };
      if (picks.problems.length) throw permanent(picks.problems.join(' '));
      const scenes0 = studio.scenes.map(s => ({ ...(cfg.output.mode === 'voiceover' ? { say: s.say } : {}), text: s.text, ...(s.accent ? { accent: s.accent } : {}), keyword: s.keyword }));
      const check = studioChecks(scenes0, cfg, picks);
      if (!check.ok) throw permanent('The script no longer passes the checks: ' + check.problems.join(' '));
      // What the app fixes by itself (a highlight picked from the caption, a footage search filled in) is
      // applied; the notes the agent rendered past go on the review card and the compliance receipt.
      const scenes = applyAutoFixes(scenes0, check.findings);
      studioNotes = [...check.soft, ...(studio.notes || [])];   // (spelling notes come with the job)
      let post = await writePost(cfg, picks, scenes, makeAsk(meter), log);
      // A series part says so on the post's first line (only if the result still passes the checks).
      if (post && picks.series) { const tagged = `${picks.series.label} · Part ${picks.series.part} of ${picks.series.of}\n${post}`; if (validatePost(JSON.stringify({ caption: tagged }), cfg, picks).ok) post = tagged; }
      script = packScript(cfg, picks, scenes, { post, source: 'studio' });
      if (studioNotes.length) script.meta.notes = studioNotes;
      if (studio.id) script.meta.draftId = studio.id;   // its Studio draft (for Needs changes, v15)
    } else script = await generateScript({ cfg, recent: store.readRecent(ws), examples: store.readExamples(ws), winners: winnersFrom(videos), force: { ...force, perf: { ...boostsFrom(videos), taste: tasteFrom(videos) } }, turnedDown: memory.read(ws).openings.map(o => o.text), meter, log });
    if (!state.script) keep({ script, mode: cfg.output.mode });
    crashPoint('make:script');
    stage = 'media';
    flightStep('voice and footage');
    script.scenes.forEach((s, i) => log(`  ${i + 1}. ${voiceMode ? s.say + '  →  ' : ''}${s.text}`));

    // The agent's own clips for some scenes (Brand → Your own clips), stock footage for the rest.
    // In Studio only the clips the agent chose are used: their own (own:<id>) or stock (by id).
    const picked = studio ? studio.scenes.map(s => s.clip?.id ?? null) : [];
    const ownPlan = studio
      ? Object.fromEntries(picked.map((id, i) => [i, String(id || '').startsWith('own:') ? library.get(ws, String(id).slice(4)) : null]).filter(([, c]) => c && library.fileOf(ws, c.id)).map(([i, c]) => [i, { ...c, file: library.fileOf(ws, c.id) }]))
      : Object.fromEntries(Object.entries(library.planFor(ws, cfg, script.scenes)).map(([i, c]) => [i, { ...c, file: library.fileOf(ws, c.id) }]));
    const chosen = Object.fromEntries(picked.map((id, i) => [i, id && !String(id).startsWith('own:') ? id : null]).filter(([, id]) => id !== null));
    // The voiceover and the footage only need the script, so they're made at the same time.
    // Both are waited for (even if one fails) so nothing writes into workDir after it's cleaned up.
    // Each is kept as soon as it's done, so if the other fails, the next try only redoes that one.
    const savedVoice = voiceMode && state.voice?.length && state.voice.every(v => fs.existsSync(v.file)) ? state.voice : null;
    const savedClips = state.clips?.length ? await reviveClips(ws, state.clips, log) : null;
    if (voiceMode) say(savedVoice ? 'Using the voiceover from the last try…' : 'Recording the voiceover…');
    say(savedClips ? 'Using the footage from the last try…' : 'Finding footage…');
    // The persuasion lens (Mindset) reads the script alongside: which honest principles it uses.
    const lensRun = state.lens !== undefined ? Promise.resolve(state.lens) : (cfg.mindset?.persuasion !== 'off' ? lens({ text: script.scenes.map(s => (voiceMode ? s.say : s.text)).join('\n'), meter, forScript: true }).catch(e => { if (e.aborted) throw e; return null; }) : Promise.resolve(null)).then(l => (keep({ lens: l }), l));
    lensRun.catch(() => {});   // its failure (a stopped job) is seen where it's awaited
    const [vr, cr] = await Promise.allSettled([
      savedVoice ? Promise.resolve(savedVoice) : voiceMode ? speakVoice(script.scenes, cfg, workDir, log, meter, { style: script.picks.audience?.style }).then(v => (keep({ voice: v }), v)) : Promise.resolve(null),
      savedClips ? Promise.resolve(savedClips) : findClips(script.scenes.map((s, i) => ({ ...s, ...(studio ? { manual: true } : { shot: script.meta.shots?.[i] }) })), { chosen, used: store.readUsedClips(ws), shared: store.clipsUsedElsewhere(ws), visual: script.meta.visual, saved: script.picks.audience?.searches || [], check: clipChecker(cfg, script.meta.visual, meter), log, own: ownPlan }).then(c => (keep({ clips: c }), c)),
    ]);
    let voice = vr.value, clips = cr.value;
    // The post as it goes out with this try (the saved script keeps the original, AI voice note and all,
    // so a later try that does get the voice still discloses it).
    let post = script.post;
    // How many tries in a row each stage's service has been down for (kept in the checkpoint).
    const voiceDown = vr.status === 'rejected' && voiceMode && isServiceFailure(vr.reason);
    const footageDown = cr.status === 'rejected' && isServiceFailure(cr.reason);
    if (voiceDown || footageDown) keep({ voiceFails: voiceDown ? (state.voiceFails || 0) + 1 : vr.status === 'fulfilled' ? 0 : state.voiceFails || 0, footageFails: footageDown ? (state.footageFails || 0) + 1 : cr.status === 'fulfilled' ? 0 : state.footageFails || 0 });
    if (vr.status === 'rejected') {
      if (!(limp && voiceDown && state.voiceFails >= LIMP_AFTER_TRIES())) throw vr.reason;
      log('The voice service still isn’t answering, so this video is made with captions only (it says so on its review card).');
      cfg.output.mode = 'captions'; voiceMode = false; voice = null; limped.push('voice');
      // The post's "AI-generated voice" note no longer applies: there's no voice.
      post = dropAiVoiceNote(post);
    }
    if (cr.status === 'rejected') {
      const all = !studio && limp && footageDown && state.footageFails >= LIMP_AFTER_TRIES() ? library.planAll(ws, script.scenes) : null;
      if (!all) throw cr.reason;
      log('The stock footage sites still aren’t answering, so every scene uses your own clips (it says so on its review card).');
      clips = await findClips(script.scenes, { own: Object.fromEntries(Object.entries(all).map(([i, c]) => [i, { ...c, file: library.fileOf(ws, c.id) }])), log });
      keep({ clips }); limped.push('footage');
    }
    const lensed = await lensRun;
    if (lensed) script.meta.principles = lensed.principles.map(p => p.id), script.meta.pressure = lensed.pressure, script.meta.pressureWords = lensed.pressureWords || [];
    if (voice?.[0]?.rung) script.meta.voiceRung = voice[0].rung;   // a fix re-records with the same voice
    if (limped.length) script.meta.limp = limped; else delete script.meta.limp;   // (from this try only)

    crashPoint('make:media');
    stage = 'render';
    flightStep('render');
    say('Rendering…');
    const music = state.render ? (state.render.music ? path.join(DIRS.music, state.render.music) : null) : cfg.output.music === 'library' ? pickMusic(log, memory.read(ws).music) : null;
    script.meta.music = music ? path.basename(music) : '';
    // The agent's own rules as they were for this video (the compliance receipt prints these).
    script.meta.neverUse = [...(cfg.guardrails?.neverUse || [])];
    if (voiceMode && cfg.voice?.say?.length) script.meta.say = cfg.voice.say.map(x => ({ ...x })); else delete script.meta.say;
    const logo = cfg.look?.logo === 'on' && store.hasLogo(ws) ? store.logoPath(ws) : null;
    const file = `video_${id}.mp4`, cover = `cover_${id}.jpg`;
    const outFile = store.videoPath(ws, file);
    let out = state.render?.out && fs.existsSync(outFile) && fs.statSync(outFile).size > 1000 ? state.render.out : null;
    if (out) log('Using the render from the last try.');
    else {
      out = await renderVideo({ scenes: script.scenes, clips: clips.map(c => c.file), cfg, outFile, workDir, voice, music, logo, log });
      keep({ render: { out, music: music ? path.basename(music) : '' } });
    }
    let coverOk = true;
    await makeCover(outFile, store.videoPath(ws, cover)).catch(e => { if (e.aborted) throw e; coverOk = false; log('Cover image failed: ' + e.message); });
    const inspect = await inspectVideo(outFile, { voice: voiceMode });

    crashPoint('make:render');
    flightStep('save');
    // Nothing is saved by a try the watchdog has already given up on.
    checkStopped();
    // Keep what a later fix needs: the picks (for re-checking edits) and the voice lines.
    // A new version of a Studio video keeps its id (and its folder of what fixes need).
    const target = replace ? store.getVideo(ws, replace) : null;
    const into = target && ['pending', 'rejected'].includes(target.status) && target.clips && !target.legacy ? target : null;
    const recId = into ? into.id : id;
    const adir = assetsDir(ws, recId);
    fs.mkdirSync(adir, { recursive: true });
    const p = script.picks;
    fs.writeFileSync(path.join(adir, 'picks.json'), JSON.stringify({ audience: p.audience, painPoint: p.painPoint, insight: p.insight, insights: p.insights, solution: p.solution, solutions: p.solutions, story: p.story, question: p.question, format: p.format, structure: p.structure || 'classic', bridgeStyle: p.bridgeStyle || '', ctaStyle: p.ctaStyle || '' }));
    if (voice) {
      voice.forEach((v, i) => fs.copyFileSync(v.file, path.join(adir, `voice_${i}.mp3`)));
      fs.writeFileSync(path.join(adir, 'voice.json'), JSON.stringify(voice.map(v => v.words || null)));   // word timings, for fixes
    }

    const rec = {
      id: recId, file, cover: coverOk ? cover : '', status: 'pending', source, ...(by ? { by } : {}),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      duration: out.duration, mode: cfg.output.mode,
      meta: { ...script.meta, locked: LOCKED }, scenes: script.scenes, scores: script.scores, post,
      clips: clips.map(c => ({ id: c.id, query: c.query, checked: c.checked, score: c.score ?? null, reason: c.reason || '', vertical: c.vertical, alts: c.alts })),
      preflight: preflight({ cfg, meta: script.meta, scenes: script.scenes, clips, out, post, inspect, logo }),
      version: 1, fixes: 0, cost: Math.round(((state.costBefore || 0) + meter.total) * 1000) / 1000,
      ...(state.tries > 1 ? { tries: state.tries } : {}),
    };
    let saved = rec;
    if (into) {
      // Who changed what: the scenes that changed (with how they read before) and the checklist done.
      const fields = s => JSON.stringify([s?.text || '', s?.say || '', s?.accent || '', s?.keyword || '']);
      const changed = rec.scenes.map((x, i) => (fields(x) !== fields(into.scenes?.[i]) ? i : -1)).filter(i => i >= 0);
      const byName = by ? (store.getAccount(by)?.name || store.getAccount(by)?.email || '') : '';
      const first = { v: into.version || 1, at: into.createdAt, by: into.by || '', byName: into.by ? (store.getAccount(into.by)?.name || '') : '', src: into.id, changed: [], before: [] };
      const entry = { v: (into.version || 1) + 1, at: new Date().toISOString(), by, byName, src: id, changed, before: changed.map(i => ({ i, text: into.scenes?.[i]?.text || '', say: into.scenes?.[i]?.say || '', accent: into.scenes?.[i]?.accent || '', keyword: into.scenes?.[i]?.keyword || '' })) };
      saved = store.updateVideo(ws, into.id, old => ({
        ...rec, createdAt: old.createdAt, version: entry.v, versions: [...(old.versions?.length ? old.versions : [first]), entry].slice(-20),
        updated: true, approval: null, rejection: null, fixes: old.fixes || 0, fixLog: old.fixLog || [],
        cost: Math.round(((old.cost || 0) + rec.cost) * 1000) / 1000, link: old.link, clicks: old.clicks,
      }));
      store.removeVideoFiles(ws, into);
      log(`Saved as version ${entry.v} of the video in review${changed.length ? ` (scene${changed.length > 1 ? 's' : ''} ${changed.map(i => i + 1).join(', ')} changed)` : ''}.`);
    } else store.addVideo(ws, rec);
    store.addRecent(ws, { ...script.remember, videoId: recId });
    store.addUsedClips(ws, clips.filter(c => !String(c.id).startsWith('own:')).map(c => c.id));
    library.markUsed(ws, clips.filter(c => String(c.id).startsWith('own:')).map(c => String(c.id).slice(4)));
    count(ws, into ? 'fixes' : 'videos');   // a new version is like a fix: it doesn't use up one of the month's videos
    log(`Saved for review. AI cost about $${rec.cost.toFixed(3)}.`);
    crashPoint('make:saved');
    if (checkpoint) fs.rmSync(checkpoint, { recursive: true, force: true });
    return saved;
  } catch (e) {
    // A render that failed may have failed on its footage: the next try finds footage again.
    if (stage === 'render') { delete state.clips; delete state.render; }
    if (statePath) keep({ tries: (state.tries || 1) + (e.permanent ? 0 : 1), lastError: String(e.message || e).slice(0, 300) });
    throw e;
  } finally {
    if (!checkpoint) fs.rmSync(workDir, { recursive: true, force: true });
  }
}

// The post without the AI voice note line (for a video made with captions only).
export const dropAiVoiceNote = post => (typeof post === 'string' ? post.split('\n').filter(l => l.trim() !== AI_VOICE_NOTE).join('\n').trim() : post);

function savedScriptOk(state, cfg, studio) {
  if (state.mode && state.mode !== cfg.output.mode) return false;
  try {
    const sc = state.script;
    const r = studio ? studioChecks(sc.scenes.map(s => ({ ...s })), cfg, { ...studioPicks(cfg, studio.brief), recent: [] }) : validateScript({ scenes: sc.scenes }, cfg, { ...sc.picks, recent: [] });
    return !!r.ok;
  } catch { return false; }
}

// Footage saved by an earlier try: each clip's file again (the day-long cache may have been cleaned,
// or the agent's own clip deleted). Returns null if any can't be had, so the footage is found afresh.
async function reviveClips(ws, clips, log) {
  const out = [];
  for (const c of clips) {
    if (c.file && fs.existsSync(c.file)) { out.push(c); continue; }
    try {
      const f = String(c.id).startsWith('own:') ? library.fileOf(ws, String(c.id).slice(4)) : await clipFile(c);
      if (!f) return null;
      out.push({ ...c, file: f });
    } catch (e) { if (e.aborted) throw e; log(`The footage from the last try couldn't be fetched again (${e.message}); finding it afresh.`); return null; }
  }
  return out;
}

// A fix renders with the rules the video was made under: same scene count and video type.
const fixConfig = (base, v) => ({ ...base, output: { ...base.output, scenes: v.scenes.length, mode: v.mode || v.meta?.mode || base.output.mode } });
function applyEdits(scenes, edits) {
  const out = scenes.map(s => ({ ...s })), sayChanged = new Set(), keywordChanged = new Set();
  for (const e of edits) {
    const s = out[e.i];
    if (!s) continue;
    for (const k of ['text', 'accent', 'say', 'keyword']) {
      if (typeof e[k] !== 'string') continue;
      const val = e[k].replace(/\s+/g, ' ').trim();
      if (val === String(s[k] || '')) continue;
      s[k] = val;
      if (k === 'say') sayChanged.add(e.i);
      if (k === 'keyword') keywordChanged.add(e.i);
    }
  }
  return { scenes: out, sayChanged, keywordChanged };
}

// What a video was made from (its audience, worry, facts), kept for fixes and rewrites.
export const readPicks = (ws, videoId) => readJSON(path.join(assetsDir(ws, videoId), 'picks.json'), null);

// Checks an edit before it goes in the queue, so the agent sees problems right away.
// Returns null when the fix can go ahead, otherwise the reason it can't (v15: only what would stop a
// render, the same locked rules as Studio; style and craft are notes).
// `list`: return the problems as an array (for "why was this hidden"), not one sentence.
// `findings`: return every finding (stops, notes and fixes, with their one-tap fixes) for the fix screen.
export function checkFix(ws, videoId, edits = [], { list = false, findings = false } = {}) {
  const v = store.getVideo(ws, videoId);
  if (!v) return 'Video not found.';
  if (!v.clips || v.legacy) return 'This video was made by an older version and can’t be fixed. Make a new one instead.';
  if ((v.fixes || 0) >= MAX_FIXES) return `This video has been fixed ${MAX_FIXES} times. Make a new one instead.`;
  const picks = readJSON(path.join(assetsDir(ws, videoId), 'picks.json'), null);
  if (!picks) return 'The files needed to fix this video were cleaned up. Make a new one instead.';
  const { scenes } = applyEdits(v.scenes, edits);
  // A fixed footage search is the agent's own words, so it isn't held to the written-search rules.
  const check = validateScript({ scenes }, fixConfig(store.loadConfig(ws), v), { ...picks, recent: [], manualFootage: true, person: true });
  if (findings) return check.findings;
  const stops = check.findings.filter(f => f.kind === 'stop').map(f => f.text);
  return !stops.length ? null : list ? stops : 'The edit breaks a rule: ' + stops.join(' ');
}

// edits: [{ i, text?, accent?, say?, keyword? }]   swaps: [scene index, …]
// picks: { sceneIndex: { id, query, score, reason } }: clips the agent picked in the clip picker (v15),
// used exactly as picked (no search at render time).
export async function fixVideo({ ws, videoId, edits = [], swaps = [], picks = {}, by = '', log = console.log }) {
  // This fix job already replaced the video (it was cut off after saving, and is running again): done,
  // once the previous version's files are gone. Checked before the fix limits (it would count itself).
  const jobId = currentJob()?.jobId || '';
  const before = jobId ? store.getVideo(ws, videoId) : null;
  const doneHere = before && (before.fixLog || []).find(f => f.job === jobId);
  if (doneHere) {
    store.removeVideoFiles(ws, { file: doneHere.oldFile, cover: doneHere.oldCover });
    log('This fix was already saved by an earlier try.');
    return before;
  }
  const problem = checkFix(ws, videoId, edits);
  if (problem) throw permanent(problem);
  const v = store.getVideo(ws, videoId);
  const adir = assetsDir(ws, videoId);
  const base = store.loadConfig(ws);
  const cfg = fixConfig(base, v);
  const meter = makeMeter(ws);
  const edited = applyEdits(v.scenes, edits), { sayChanged, keywordChanged } = edited;
  // What the app fixes by itself is applied (a highlight picked from the caption); notes travel with it.
  const fixFindings = checkFix(ws, videoId, edits, { findings: true });
  const scenes = Array.isArray(fixFindings) ? applyAutoFixes(edited.scenes, fixFindings) : edited.scenes;
  const fixNotes = Array.isArray(fixFindings) ? fixFindings.filter(f => f.kind === 'warn').map(f => f.text) : [];

  const workDir = path.join(DIRS.work, `${videoId}-fix-${crypto.randomBytes(3).toString('hex')}`);   // its own per try
  fs.mkdirSync(workDir, { recursive: true });
  try {
    let voice = null;
    if (cfg.output.mode === 'voiceover') {
      const style = readJSON(path.join(adir, 'picks.json'), {}).audience?.style;
      const timed = readJSON(path.join(adir, 'voice.json'), []);
      const previous = scenes.map((_, i) => ({ file: path.join(adir, `voice_${i}.mp3`), ...(timed[i] ? { words: timed[i] } : {}) }));
      const have = previous.every(p => fs.existsSync(p.file));
      const { probeDuration } = await import('./stages/voice.js');
      for (const p of previous) if (fs.existsSync(p.file)) p.duration = await probeDuration(p.file);
      if (have && !sayChanged.size) { log('Reusing the voiceover…'); voice = previous; }
      else if (takeMode() === 'single') {
        // One take reads best: a changed line is recorded again with the rest, so the voice still flows.
        log(have ? `Re-recording the voiceover (${sayChanged.size} line${sayChanged.size === 1 ? '' : 's'} changed)…` : 'Recording the voiceover…');
        voice = await speakVoice(scenes, cfg, workDir, log, meter, { style });
      } else {
        const only = have ? [...sayChanged] : null;
        log(only ? `Re-recording ${only.length} line(s)…` : 'Recording the voiceover…');
        voice = await speakScenes(scenes, cfg, workDir, log, meter, { only, previous, style, rung: v.meta?.voiceRung || null });
      }
      voice.forEach((x, i) => { if (x.file !== path.join(adir, `voice_${i}.mp3`)) fs.copyFileSync(x.file, path.join(adir, `voice_${i}.mp3`)); });
      voice = voice.map((x, i) => ({ ...x, file: path.join(adir, `voice_${i}.mp3`) }));
      fs.writeFileSync(path.join(adir, 'voice.json'), JSON.stringify(voice.map(v => v.words || null)));
    }

    flightStep('footage');
    log('Getting footage…');
    const scriptPicks = readJSON(path.join(adir, 'picks.json'), {});
    const visual = v.meta?.visual || scriptPicks.audience?.visual;
    const saved = base.story.audiences.find(a => a.id === (v.meta?.audienceId || scriptPicks.audience?.id))?.searches || [];
    const checker = clipChecker(cfg, visual, meter);
    const used = store.clipsToAvoid(ws);
    const clips = [];
    // What each scene's footage should be: its planned shot, or whatever the agent's own search asks for.
    const sceneFor = i => ({ ...scenes[i], ...(keywordChanged.has(i) || v.meta?.madeIn === 'studio' ? { manual: true } : { shot: v.meta?.shots?.[i] }) });
    for (let i = 0; i < scenes.length; i++) {
      const cur = v.clips[i];
      const picked = picks[i];
      if (picked && String(picked.id) !== String(cur?.id)) {
        log(`Using the clip you picked for scene ${i + 1}…`);
        const file = await downloadClip(picked.id);
        clips.push({ id: picked.id, file, query: picked.query || scenes[i].keyword || '', checked: picked.score != null, score: picked.score ?? null, reason: picked.reason || '', chosen: true, alts: [] });
        used.push(picked.id);
      } else if (swaps.includes(i) || keywordChanged.has(i)) {
        log(`Swapping the clip in scene ${i + 1}…`);
        const c = await swapClip(sceneFor(i), keywordChanged.has(i) ? { ...cur, alts: [] } : cur, { used, visual, saved, check: checker, log });
        clips.push(c); used.push(c.id);
      } else if (String(cur.id).startsWith('own:')) {
        // The agent's own clip; if they've since deleted it, the scene gets stock footage instead.
        const f = library.fileOf(ws, String(cur.id).slice(4));
        if (f) clips.push({ ...cur, file: f });
        else { log(`Scene ${i + 1}'s own clip was deleted; finding stock footage instead…`); const c = await swapClip(sceneFor(i), { ...cur, alts: [] }, { used, visual, saved, check: checker, log }); clips.push(c); used.push(c.id); }
      } else {
        // A clip from the day-long cache that can't be fetched again (its source is down, or it was
        // removed) gets a new one rather than failing the fix.
        let f = null;
        try { f = await clipFile(cur); } catch (e) { log(`Scene ${i + 1}'s clip couldn't be fetched again (${e.message}); finding another…`); }
        if (f) clips.push({ ...cur, file: f });
        else { const c = await swapClip(sceneFor(i), cur, { used, visual, saved, check: checker, log }); clips.push(c); used.push(c.id); }
      }
    }

    flightStep('render');
    log('Rendering…');
    const version = (v.version || 1) + 1;
    const file = `video_${videoId}_v${version}.mp4`, cover = `cover_${videoId}_v${version}.jpg`;
    const outFile = store.videoPath(ws, file);
    // A fix keeps the video's track (unless it's since been turned down or removed).
    const skipMusic = memory.read(ws).music, had = v.meta?.music && !skipMusic.includes(v.meta.music) && fs.existsSync(path.join(DIRS.music, v.meta.music)) ? path.join(DIRS.music, v.meta.music) : null;
    const music = cfg.output.music === 'library' ? had || pickMusic(log, skipMusic) : null;
    const logo = cfg.look?.logo === 'on' && store.hasLogo(ws) ? store.logoPath(ws) : null;
    const out = await renderVideo({ scenes, clips: clips.map(c => c.file), cfg, outFile, workDir, voice, music, logo, log });
    let coverOk = true;
    await makeCover(outFile, store.videoPath(ws, cover)).catch(() => { coverOk = false; });
    const inspect = await inspectVideo(outFile, { voice: cfg.output.mode === 'voiceover' });

    // Changed words get a fresh persuasion read, so the badges and any pressure warning match the new script.
    const reworded = edits.some(e => 'text' in e || 'say' in e);
    const lensed = reworded && base.mindset?.persuasion !== 'off' ? await lens({ text: scenes.map(s => (cfg.output.mode === 'voiceover' ? s.say : s.text)).join('\n'), meter, forScript: true }).catch(() => null) : null;
    const metaFor = old => ({ ...(reworded ? { ...old.meta, principles: lensed ? lensed.principles.map(p => p.id) : [], pressure: lensed ? lensed.pressure : [], pressureWords: lensed ? lensed.pressureWords || [] : [] } : old.meta), music: music ? path.basename(music) : '',
      ...(voice?.find(x => x.rung)?.rung ? { voiceRung: voice.find(x => x.rung).rung } : {}),
      neverUse: [...(base.guardrails?.neverUse || [])], ...(cfg.output.mode === 'voiceover' && base.voice?.say?.length ? { say: base.voice.say.map(x => ({ ...x })) } : {}), notes: fixNotes, locked: LOCKED });
    crashPoint('fix:render');
    flightStep('save');
    checkStopped();   // nothing is saved by a try the watchdog has already given up on
    // The new version is saved first and the old files go after, so a cut-off at any point leaves a
    // record that points at a file that exists.
    const rec = store.updateVideo(ws, videoId, old => ({
      meta: metaFor(old),
      file, cover: coverOk ? cover : '', coverAt: null, version, fixes: (old.fixes || 0) + 1,
      status: 'pending', approval: null, rejection: null, fileDeleted: false,
      scenes, duration: out.duration,
      clips: clips.map(c => ({ id: c.id, query: c.query, checked: c.checked, score: c.score ?? null, reason: c.reason || '', vertical: c.vertical, alts: c.alts, ...(c.chosen ? { chosen: true } : {}) })),
      preflight: preflight({ cfg: base, meta: metaFor(old), scenes, clips, out, post: old.post, inspect, logo }),
      cost: Math.round(((old.cost || 0) + meter.total) * 1000) / 1000,
      fixLog: [...(old.fixLog || []), { at: new Date().toISOString(), by, edits: edits.map(e => e.i), swaps, ...(Object.keys(picks).length ? { picked: Object.keys(picks).map(Number) } : {}), ...(jobId ? { job: jobId, oldFile: v.file || '', oldCover: v.cover || '' } : {}) }],
    }));
    store.removeVideoFiles(ws, v);
    store.addUsedClips(ws, clips.filter((c, i) => c.id !== v.clips[i]?.id).map(c => c.id));
    count(ws, 'fixes');
    log('Fixed. It’s back in review.');
    return rec;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
