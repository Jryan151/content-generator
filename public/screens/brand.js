// public/screens/brand.js — Brand.
// Split out of app.js by screen (v15). It uses the portal's shared parts from app.js (which loads it),
// and app.js and the other screens use what it exports. The code is as it was in app.js.
import { ACCENT_COLORS, AI_VOICE_NOTE, FONTS, LEVELS, PLATFORMS, S, SERVER_TROUBLE, VOICES, accentHex, api, app, can, day, esc, fetchError, getPath, go, loadCfg, main, okBookingUrl, page, roleText, short, shotList, softGone, status, toast, when, wsHeaders } from '../app.js';
import { loadIg } from './review.js';
import { describe } from './coach.js';
import { drawStep, stepView } from './steps.js';

/* ================= Brand ================= */
// Booking confirmations (v15): where the booking tool tells us someone booked, so the booking traces back
// to the video. Loaded with the page for whoever can connect accounts.
async function loadBookHook() { if (!can('connect')) return; try { S.bookHook = await api('/api/bookings/hook'); } catch { S.bookHook = null; } }
function bookHookHTML(L) {
  const H = S.bookHook;
  if (!can('connect') || !L.bookingUrl || !H) return '';
  return `<details class="box" id="bookHookBox"${S.bookHookOpen ? ' open' : ''}><summary class="small"><b>Booking confirmations</b> ${H.last ? `<span class="muted">· last one ${esc(when(H.last))}</span>` : '<span class="muted">· see which video each booking came from</span>'}</summary>
    <p class="small" style="margin:0">Your booking link carries each video’s code. Give your booking tool this private address and every booking shows up in Leads as “Appointment booked”, tied to the video that brought it, and counts in that video’s results.</p>
    <div class="row"><input class="ctl sm mono" readonly value="${esc(H.url)}" style="flex:1 1 260px" aria-label="Your booking confirmations address"><button class="btn sm" data-act="copy-text" data-text="${esc(H.url)}">Copy</button></div>
    <ul class="list small"><li><i>·</i><span><b>Calendly:</b> a webhook for “Invitee created” and “Invitee canceled” to this address (Calendly’s paid plans, or through Zapier).</span></li>
      <li><i>·</i><span><b>Cal.com:</b> Settings → Developer → Webhooks: this address, for “Booking created” and “Booking cancelled”. Put your webhook secret below.</span></li>
      <li><i>·</i><span><b>Anything else</b> (Zapier, Make): send JSON with name, email, phone, start and ref (the utm_content from the booking link).</span></li></ul>
    <form class="row" data-form="book-key"><input class="ctl sm" name="key" type="password" autocomplete="off" placeholder="${H.hasKey ? 'A signing key is set (type to replace)' : 'Signing key or webhook secret (optional)'}" style="flex:1 1 220px" aria-label="Signing key"><button class="btn sm">${H.hasKey ? 'Replace key' : 'Save key'}</button>${H.hasKey ? '<button class="btn sm ghost" type="button" data-act="book-key-clear">Remove key</button>' : ''}</form>
    <div class="row"><button class="btn sm ghost" data-act="book-rotate">Make a new address</button><span class="small muted">The old one stops working.</span></div></details>`;
}
async function viewBrand(ctx = {}) {
  await Promise.all([loadCfg(), loadIg(), loadLibrary(), loadLogoColors(), loadBookHook()]);
  socialReturn(ctx.q, 'brand');
  drawBrand();
}
// Back from connecting Instagram or Facebook (?ig= or ?fb=, on Setup → Autopilot; older links on Brand):
// say how it went, then tidy the address so a reload doesn't say it again.
function socialReturn(q, view) {
  if (q?.get('ig')) {
    toast(q.get('ig') === 'connected' ? `Instagram connected${q.get('msg') ? ': ' + q.get('msg') : ''}` : q.get('msg') || 'Instagram didn’t connect. Try again.');
    history.replaceState(null, '', `#/${view}`);
  }
  if (q?.get('fb')) {
    const k = q.get('fb');
    toast(k === 'connected' ? `Facebook connected${q.get('msg') ? ': ' + q.get('msg') : ''}` : k === 'choose' ? 'Pick the Page to post to.' : q.get('msg') || 'Facebook didn’t connect. Try again.');
    history.replaceState(null, '', `#/${view}`);
  }
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function igPanel() {
  if (!S.me.instagram) return '';
  const ig = S.ig, acc = ig?.account;
  const body = !ig ? '<p class="small muted">Couldn’t check Instagram right now. <button class="btn sm ghost" data-act="social-retry">Try again</button></p>'
    : !ig.ready ? '<div class="note warn">Instagram posting isn’t turned on for this site yet. Your admin can set it up.</div>'
    : !acc.connected ? `<ul class="list"><li class="ok"><i>1</i><span>Your Instagram must be a <b>professional account</b> (Business or Creator). Switching is free: Instagram → Settings → Account type and tools.</span></li><li class="ok"><i>2</i><span>Tap Connect, log in to Instagram and allow posting.</span></li></ul>
        <div class="row"><button class="btn primary" data-act="ig-connect">Connect Instagram</button></div>`
    : `<div class="row between"><span>${acc.problem ? '<span class="pill warn">Reconnect</span>' : '<span class="pill ok">Connected</span>'} <b>@${esc(acc.username || 'instagram')}</b></span>
        <span class="row">${acc.problem ? '<button class="btn sm primary" data-act="ig-connect">Reconnect</button>' : ''}<button class="btn sm ghost danger" data-act="ig-disconnect">Disconnect</button></span></div>
        ${acc.problem ? '<div class="note warn small">Instagram stopped accepting posts from this connection (a changed password or removed access does this). Reconnect to keep posting.</div>' : ''}
        ${ig.insights && !acc.problem ? (acc.insights ? '<p class="small muted" style="margin:0">Views, reach, likes, comments, shares and saves are filled in automatically every day for videos you posted in the last 30 days.</p>' : '<div class="note small">Get your results filled in automatically: <button class="btn sm" data-act="ig-connect">Reconnect</button> and allow Instagram to share your post insights.</div>') : ''}
`;
  return `<section class="panel out"><div class="head"><h2><span class="dot"></span>Instagram</h2><p>Post approved videos to Instagram as Reels, with your post text and cover, without opening the app.</p></div>${body}</section>`;
}
// Cross-posting to the agent's Facebook Page.
function fbPanel() {
  if (!S.me.facebook) return '';
  const fb = S.fb, acc = fb?.account;
  const body = !fb ? '<p class="small muted">Couldn’t check Facebook right now. <button class="btn sm ghost" data-act="social-retry">Try again</button></p>'
    : !fb.ready ? '<div class="note warn">Facebook posting isn’t turned on for this site yet. Your admin can set it up.</div>'
    : acc.choose?.length ? `<p class="small" style="margin:0">Which Page should videos post to?</p><div class="stack" style="gap:6px">${acc.choose.map(p => `<button class="btn" data-act="fb-page" data-id="${esc(p.id)}">${esc(p.name || p.id)}</button>`).join('')}</div>`
    : !acc.connected ? `<ul class="list"><li class="ok"><i>1</i><span>You need a <b>Facebook Page</b> for your business (not a personal profile), and to be an admin or editor of it.</span></li><li class="ok"><i>2</i><span>Tap Connect, log in to Facebook and choose your Page.</span></li></ul>
        <div class="row"><button class="btn primary" data-act="fb-connect">Connect Facebook</button></div>`
    : `<div class="row between"><span>${acc.problem ? '<span class="pill warn">Reconnect</span>' : '<span class="pill ok">Connected</span>'} <b>${esc(acc.pageName || 'Your Page')}</b></span>
        <span class="row">${acc.problem ? '<button class="btn sm primary" data-act="fb-connect">Reconnect</button>' : ''}<button class="btn sm ghost danger" data-act="fb-disconnect">Disconnect</button></span></div>
        ${acc.problem ? '<div class="note warn small">Facebook stopped accepting posts from this connection (a changed password or removed access does this). Reconnect to keep posting.</div>' : ''}
        <p class="small muted" style="margin:0">Each Facebook post gets the video’s booking link${S.cfg.look.bookingUrl ? '' : ' once you add your booking link above'}, just above your small print.</p>`;
  return `<section class="panel out"><div class="head"><h2><span class="dot"></span>Facebook Page</h2><p>Post approved videos to your Facebook Page as Reels too, with the same post text.</p></div>${body}</section>`;
}
// The posting plan: which days, what time, and where (Instagram, Facebook or both).
function planPanel() {
  const c = S.cfg, ap = c.schedule.autopost;
  const igOk = S.me.instagram && S.ig?.account?.connected, fbOk = S.me.facebook && S.fb?.account?.connected;
  if (!igOk && !fbOk) return '';
  const places = ap.platforms || ['instagram'];
  const label = { instagram: 'Instagram', facebook: 'Facebook Page' };
  const avail = PLATFORMS.filter(p => (p === 'instagram' ? igOk : fbOk));
  const missing = places.filter(p => !avail.includes(p));
  return `<section class="panel out"><div class="head"><h2><span class="dot"></span>Posting plan</h2><p>On the days and time you pick (your time zone), the oldest approved video that isn’t posted yet goes out. Nothing is posted that you didn’t approve. You can also post or schedule any single video in Review.</p></div>
      <div class="field"><span>Post automatically</span><div class="seg"><button data-act="ap-on" data-v="1" aria-pressed="${ap.on}">On</button><button data-act="ap-on" data-v="0" aria-pressed="${!ap.on}">Off</button></div></div>
      ${ap.on ? `${avail.length > 1 ? `<div class="field"><span>Post to</span><div class="chips">${avail.map(p => `<button class="toggle" data-act="ap-place" data-p="${p}" aria-pressed="${places.includes(p)}">${label[p]}</button>`).join('')}</div></div>` : ''}
        ${missing.length ? `<p class="small warn-text" style="margin:0">${missing.map(p => label[p]).join(' and ')} ${missing.length > 1 ? 'aren’t' : 'isn’t'} connected, so the plan skips ${missing.length > 1 ? 'them' : 'it'}.${!places.some(p => avail.includes(p)) ? ` <button class="btn sm" data-act="ap-place" data-p="${avail[0]}">Post to ${label[avail[0]]}</button>` : ''}</p>` : ''}
        <div class="field"><span>Days</span><div class="chips">${DAYS.map((d, i) => `<button class="toggle" data-act="ap-day" data-d="${i}" aria-pressed="${ap.days.includes(i)}">${d}</button>`).join('')}</div></div>
        <label class="field" style="max-width:220px"><span>Time</span><input class="ctl" type="time" data-bind="schedule.autopost.time" value="${esc(ap.time)}"></label>
        ${bestHourHTML(S.ig?.bestHour, ap.time)}
        ${ap.days.length ? '' : '<p class="small warn-text">Pick at least one day.</p>'}
        ${c.output.mode === 'captions' && places.includes('instagram') ? '<p class="small muted" style="margin:0">Your videos are captions only, and Instagram can’t add a sound to automatic posts, so they go out quiet. Many agents still do this; others switch to Voiceover above or post by hand to add a trending sound.</p>' : ''}` : ''}</section>`;
}
// From Instagram results: the hour this agent's posts do best, once there's enough to tell.
function bestHourHTML(b, time) {
  if (!b) return '';
  const hh = String(b.hour).padStart(2, '0') + ':00', label = new Date(2000, 0, 1, b.hour).toLocaleTimeString([], { hour: 'numeric' });
  if (time === hh) return `<p class="small muted" style="margin:0">✓ ${esc(label)} is when your posts do best (from ${b.total} posts).</p>`;
  return `<div class="note small">Your posts around <b>${esc(label)}</b> get about ${esc(b.lift)}× the views and messages of your average post (${b.n} of ${b.total} posts). <button class="btn sm" data-act="set" data-bind="schedule.autopost.time" data-v="${hh}">Post at ${esc(label)}</button></div>`;
}
const seg = (bind, options, cur) => `<div class="seg">${options.map(([v, l]) => `<button data-act="set" data-bind="${bind}" data-v="${esc(v)}" aria-pressed="${cur === v}">${esc(l)}</button>`).join('')}</div>`;
const onOff = (bind, cur) => seg(bind, [['on', 'On'], ['off', 'Off']], cur);
// Your own clips: uploaded once, mixed into videos with stock footage (lib/library.js).
async function loadLibrary() { const l = await api('/api/library').catch(() => ({ clips: [], max: 40, maxMB: 200, failed: true })); S.lib = { ...l, clips: (l.clips || []).filter(c => !softGone(`clip:${c.id}`)) }; }
function libraryPanel(c) {
  const L0 = S.lib || { clips: [] }, L = { ...L0, clips: (L0.clips || []).filter(x => !softGone(`clip:${x.id}`)) }, mode = c.output.ownClips || 'off';
  return `<section class="panel voice"><div class="head"><h2><span class="dot"></span>Your own clips</h2><p>Short clips of you (at your desk, with a client, around town) mixed in with the stock footage. People trust a face they recognize.</p></div>
    <div class="field"><span>Use my clips</span>${seg('output.ownClips', [['off', 'Off'], ['few', 'A little'], ['many', 'A lot']], mode)}<small>${mode === 'few' ? 'The last scene (your call to action) and the first.' : mode === 'many' ? 'About half the scenes, first and last included.' : 'Videos use stock footage only.'}${!L.clips.length && mode !== 'off' ? ' Upload a clip first.' : ''}</small></div>
    ${L.failed ? '<p class="small muted" style="margin:0">Couldn’t load your clips. <button class="btn sm ghost" data-act="lib-retry">Try again</button></p>' : ''}
    <div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">${L.clips.map(x => `<div class="box" style="gap:6px;padding:8px"><img src="/api/library/${x.id}/thumb" alt="" loading="lazy" style="width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:8px">
      <input class="ctl sm" value="${esc(x.description)}" placeholder="What’s in it?" maxlength="120" data-libdesc="${x.id}" aria-label="Describe this clip">
      ${(x.checks || []).filter(k => !k.ok).map(k => `<span class="small warn-text">${esc(k.label)}</span>`).join('')}
      <div class="row between"><span class="small muted">${x.duration}s${x.vertical ? '' : ' · wide'} · used ${x.uses || 0}×</span><button class="x" data-act="lib-del" data-id="${x.id}" aria-label="Delete this clip">×</button></div></div>`).join('')}</div>
    ${L.clips.length < L.max ? `<label class="btn"><input type="file" accept="video/*" data-libup hidden>Upload a clip</label>` : ''}
    <small class="muted">Vertical, 3–15 seconds, no talking needed (your voiceover or captions carry the words). Up to ${L.max} clips, ${L.maxMB} MB each. Describe each one in a few words (“me at my desk”) so it lands in the right scene.</small><div class="status" data-st="lib"></div>
    ${L.clips.length >= 10 && mode !== 'many' ? `<div class="note ok small">You have ${L.clips.length} clips: enough to use them in about half your scenes. <button class="btn sm" data-act="set" data-bind="output.ownClips" data-v="many">Use them a lot</button></div>` : ''}
    ${shotListHTML(c, L.clips)}</section>`;
}
// What to film, in one sitting. Shots tick themselves off when a clip's description matches.
function shotListHTML(c, clips) {
  const list = shotList(c, clips);
  if (!list.length) return '';
  const done = list.filter(x => x.done).length;
  return `<details${done < list.length && clips.length < 10 ? ' open' : ''}><summary>Shot list · ${done} of ${list.length} filmed</summary>
    <p class="small muted" style="margin:6px 0">Film these in one sitting with your phone held upright: a few seconds each, steady, in good light, no talking. Upload them here and describe each one in a few words. A month of videos can come from one afternoon.</p>
    <ul class="list">${list.map(x => `<li class="${x.done ? 'ok' : ''}"><i>${x.done ? '✓' : '○'}</i><span><b>${esc(x.shot)}</b><br><small class="muted">${esc(x.why)}</small></span></li>`).join('')}</ul></details>`;
}
// Colors from the agent's logo, offered as the highlight color (made light enough to read on video).
async function loadLogoColors() { S.logoColors = S.me.workspace?.logo ? (await api('/api/brand/logo-colors').catch(() => ({ colors: [] }))).colors : []; }
function logoColorsHTML(L) {
  const cs = (S.logoColors || []).filter(h => h !== L.brandColor || L.accentColor !== 'brand');
  if (!cs.length) return '';
  return `<div class="row small"><span class="muted">From your logo:</span>${cs.map(h => `<button class="swatch" data-act="brand-color" data-v="${esc(h)}" style="--sw:${esc(accentHex({ look: { accentColor: 'brand', brandColor: h } }))}" title="${esc(h)}"><i></i>Use</button>`).join('')}<span class="muted">Lightened if needed, so it reads on video.</span></div>`;
}
// Pronunciations for the AI voice: the word stays spelled right in captions; the voice says it your way.
function sayHTML(v) {
  return `<div class="field"><span>Pronunciation</span><small>Names and words the voice gets wrong. Write how it should sound: “Gallup” → “GAL-up”, “IUL” → “eye you ell”.</small>
    <div class="chips">${(v.say || []).map((x, i) => `<span class="chip"><span>${esc(x.word)} → ${esc(x.say)}</span><button class="x" data-act="say-del" data-i="${i}" aria-label="Remove ${esc(x.word)}">×</button></span>`).join('') || '<span class="small muted">None yet.</span>'}</div>
    <form class="add" data-form="say"><input class="ctl sm" name="word" placeholder="Word" maxlength="40" autocomplete="off" aria-label="Word"><input class="ctl sm" name="say" placeholder="Say it like" maxlength="60" autocomplete="off" aria-label="How to say it"><button class="btn sm">Add</button></form></div>`;
}
// Words the agent never uses: the same list as Setup → Voice and rules → Never use, kept where the voice is set.
const NEVER_IDEAS = ['act now', 'don’t wait', 'peace of mind', 'cheap', 'affordable', 'loved ones', 'secure your future', 'game changer'];
function neverHTML(c) {
  const g = c.guardrails.neverUse, ideas = NEVER_IDEAS.filter(x => !g.some(y => y.toLowerCase() === x.toLowerCase()));
  return `<div class="field"><span>Words I never use</span><small>Checked in code on every script, post, rewrite and reply.</small>
    <div class="chips">${g.map((x, i) => `<span class="chip"><span>${esc(x)}</span><button class="x" data-act="rule-del" data-k="neverUse" data-i="${i}" aria-label="Remove ${esc(x)}">×</button></span>`).join('') || '<span class="small muted">None yet.</span>'}</div>
    <form class="add" data-form="rule" data-k="neverUse"><input class="ctl sm" name="rule" placeholder="A word or phrase" maxlength="80" autocomplete="off" aria-label="Add a word you never use"><button class="btn sm">Add</button></form>
    ${neverIdeasHTML(c, ideas)}</div>`;
}
// One-tap additions to Never use: common ad phrases the agent hasn't listed yet.
function neverIdeasHTML(c, ideas = NEVER_IDEAS.filter(x => !c.guardrails.neverUse.some(y => y.toLowerCase() === x.toLowerCase()))) {
  return ideas.length ? `<div class="row small"><span class="muted">Common ones:</span>${ideas.slice(0, 6).map(x => `<button class="btn sm ghost" data-act="never-add" data-v="${esc(x)}">+ ${esc(x)}</button>`).join('')}</div>` : '';
}
async function uploadClip(file) {
  const st = main.querySelector('[data-st="lib"]');
  if (file.size > (S.lib?.maxMB || 200) * 1024 * 1024) return status(st, `That video is over ${S.lib?.maxMB || 200} MB. Trim it on your phone first.`, 'err');
  if (S.uploading) return;
  S.uploading = true;
  const input = main.querySelector('[data-libup]'); if (input) input.disabled = true;
  if (st) st.innerHTML = '<span class="spin"></span> Uploading and preparing your clip… (about 30 seconds)';
  try {
    const res = await fetch('/api/library', { method: 'POST', credentials: 'same-origin', headers: { ...wsHeaders(), 'Content-Type': file.type || 'video/mp4' }, body: file });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || SERVER_TROUBLE);
    S.lib.clips = d.clips; S.uploading = false; drawBrand();
    const added = d.clips[d.clips.length - 1], warn = (added?.checks || []).filter(k => !k.ok);
    toast(warn.length ? `Clip added. ${warn[0].label}` : 'Clip added. Describe it in a few words.');
  } catch (e) { status(main.querySelector('[data-st="lib"]'), fetchError(e).message, 'err'); }
  S.uploading = false;
  const again = main.querySelector('[data-libup]'); if (again) again.disabled = false;
}
// (v15 Phase 10) Each panel on its own, so Setup's steps can show the ones that belong together; the
// Brand page shows them all, as before.
const input = (c, bind, label, ph = '', hint = '') => `<label class="field"><span>${label}</span><input class="ctl" data-bind="${bind}" value="${esc(getPath(c, bind))}" placeholder="${esc(ph)}">${hint ? `<small>${hint}</small>` : ''}</label>`;
function endCardPanel(c = S.cfg) {
  const L = c.look;
  return `<section class="panel voice"><div class="head"><h2><span class="dot"></span>End card</h2><p>The last 2.5 seconds: your name, title, city and call to action over the last shot.</p></div>
      <div class="field"><span>Show the end card</span>${onOff('look.endCard', L.endCard)}</div>
      <div class="field"><span>Logo</span>
        <div class="row">${S.me.workspace?.logo ? `<img class="logo-prev" src="/api/brand/logo?v=${S.logoV || 1}" alt="Your logo">` : '<span class="small muted">No logo yet.</span>'}
          <label class="btn sm"><input type="file" accept="image/png,image/jpeg,image/webp" data-logo hidden>${S.me.workspace?.logo ? 'Replace' : 'Upload a logo'}</label>
          ${S.me.workspace?.logo ? '<button class="btn sm ghost danger" data-act="logo-del">Remove</button>' : ''}</div>
        ${S.me.workspace?.logo ? `<div class="row"><span class="small">Show it on the end card</span>${onOff('look.logo', L.logo)}</div>` : ''}
        <small>A PNG with a transparent background looks best. It sits above your name.</small></div>
      <div class="fields">${input(c, 'look.name', 'Name', 'Jane Smith')}${input(c, 'look.title', 'Title', 'Licensed Agent')}${input(c, 'look.location', 'City', 'Gallup, NM')}${input(c, 'look.endCta', 'Call to action', 'Message me')}${input(c, 'look.handle', 'Instagram handle', '@yourhandle')}${input(c, 'look.disclaimer', 'Small print', 'e.g. license number', 'Optional. Also added as the last line of the post text.')}${input(c, 'look.bookingUrl', 'Booking link', 'https://calendly.com/you', 'Optional. Your scheduling page (https). Each video gets its own short link to it, so you can see which videos bring clicks.')}</div>
      ${L.bookingUrl && !okBookingUrl(L.bookingUrl) ? '<p class="small warn-text" style="margin:0">The booking link must start with https:// and have no spaces. It won’t be saved like this.</p>' : ''}</section>`;
}
function videoPagesPanel(c = S.cfg) {
  const L = c.look;
  return `<section class="panel"><div class="head"><h2><span class="dot"></span>Your video pages</h2><p>Each video’s link opens a small page about the person who tapped it: “You watched: …”, your photo, ${L.bookingUrl ? 'a button to pick a time, ' : ''}and a short form for their first name and number. What they send shows up as a new lead in Leads, tied to that video.</p></div>
      <div class="field"><span>Your photo</span>
        <div class="row">${S.me.workspace?.photo ? `<img class="logo-prev" style="border-radius:50%;width:56px;height:56px;object-fit:cover" src="/api/brand/photo?v=${S.photoV || 1}" alt="Your photo">` : '<span class="small muted">No photo yet.</span>'}
          <label class="btn sm"><input type="file" accept="image/png,image/jpeg,image/webp" data-photo hidden>${S.me.workspace?.photo ? 'Replace' : 'Add your photo'}</label>
          ${S.me.workspace?.photo ? '<button class="btn sm ghost danger" data-act="photo-del">Remove</button>' : ''}</div>
        <small>A friendly head-and-shoulders photo. It’s cropped to a circle.</small></div>
      <div class="field"><span>When someone taps a video’s link</span>${seg('look.landing', [['page', 'Show my page'], ['direct', 'Go straight to my booking page']], L.landing || 'page')}${(L.landing || 'page') === 'direct' && !L.bookingUrl ? '<small class="warn-text">Without a booking link, your page shows instead.</small>' : ''}</div>
      ${bookHookHTML(L)}</section>`;
}
function captionsPanel(c = S.cfg) {
  const L = c.look;
  return `<section class="panel voice"><div class="head"><h2><span class="dot"></span>Captions and footage</h2></div>
      <label class="field"><span>Caption font</span><select class="ctl" data-bind="look.font">${Object.keys(FONTS).map(f => `<option${f === L.font ? ' selected' : ''}>${f}</option>`).join('')}</select></label>
      <div class="field"><span>Captions appear</span>${seg('look.captionStyle', [['line', 'Line by line'], ['words', 'Word by word']], L.captionStyle)}<small>${L.captionStyle === 'words' ? 'Words appear as they’re read, which keeps eyes on the screen. The opening line shows whole so the hook lands at once.' : 'Each caption fades in whole.'}</small></div>
      <div class="field"><span>Highlight color</span><div class="swatches">${Object.entries(ACCENT_COLORS).map(([k, x]) => `<button class="swatch" data-act="set" data-bind="look.accentColor" data-v="${k}" aria-pressed="${L.accentColor === k}" style="--sw:${x.hex}"><i></i>${esc(x.label)}</button>`).join('')}${L.brandColor ? `<button class="swatch" data-act="set" data-bind="look.accentColor" data-v="brand" aria-pressed="${L.accentColor === 'brand'}" style="--sw:${esc(accentHex({ look: { ...L, accentColor: 'brand' } }))}"><i></i>Your logo</button>` : ''}</div>
        ${logoColorsHTML(L)}<small>The highlighted word and the second line of your end card.</small></div>
      <div class="fields"><div class="field"><span>Highlighted word</span>${onOff('look.accent', L.accent)}<small>One word per caption, in italic.</small></div>
        <div class="field"><span>Color grade</span>${onOff('look.grade', L.grade)}<small>Same warm look on every clip.</small></div>
        <div class="field"><span>Slow drift</span>${onOff('look.motion', L.motion)}<small>Gentle movement on each clip.</small></div></div></section>`;
}
// On Setup → Voice and rules the Rules panel right below already has Never use, so it's left out here.
function voicePanel(c = S.cfg, { never = true } = {}) {
  const v = c.voice, voice = c.output.mode === 'voiceover';
  return `<section class="panel voice"><div class="head"><h2><span class="dot"></span>Voice</h2><p>Shapes wording only. It never overrides the rules or the facts.</p></div>
      <div class="field"><span>Video type</span>${seg('output.mode', [['captions', 'Captions only'], ['voiceover', 'Voiceover + captions']], c.output.mode)}</div>
      ${['energy', 'tone'].map(k => { const sp = c.specs[k][v[k]]; return `<div class="field"><span>${k === 'energy' ? 'Energy' : 'Tone'}</span>${seg('voice.' + k, LEVELS.map(l => [l, c.specs[k][l].label]), v[k])}<div class="spec"><span class="muted">${esc(sp.rules)}</span><q>${esc(sp.example)}</q></div></div>`; }).join('')}
      ${voice ? `<div class="fields"><label class="field"><span>Voice</span><select class="ctl" data-bind="voice.ttsVoice">${VOICES.map(x => `<option${x === v.ttsVoice ? ' selected' : ''}>${x}</option>`).join('')}</select></label></div>
        <label class="field"><span>How the voice should sound</span><textarea class="ctl" data-bind="voice.ttsStyle">${esc(v.ttsStyle)}</textarea></label>
        <div class="field"><span>Say it’s an AI voice</span>${onOff('voice.aiNote', v.aiNote)}<small>${v.aiNote === 'off' ? 'Off: the post text doesn’t mention the voice. Some carriers, states and Instagram expect AI voices to be disclosed.' : `On: every voiceover post adds the line “${esc(AI_VOICE_NOTE)}”, above your small print.`}</small></div>` : ''}
      ${voice ? sayHTML(v) : ''}
      ${never ? neverHTML(c) : neverIdeasHTML(c) ? `<div class="field"><span>Words to never use</span><small>Added to Never use in Rules, below.</small>${neverIdeasHTML(c)}</div>` : ''}
      <details><summary>How the AI introduces you (advanced)</summary><label class="field"><span>Your own wording</span><textarea class="ctl" data-bind="voice.role" placeholder="Leave blank to build it from your profile">${esc(v.role)}</textarea><small>Blank is best for most agents. Right now the AI reads: “${esc(roleText(c))}”</small></label></details></section>`;
}
function drawBrand() {
  if (stepView()) return drawStep();   // (v15 Phase 10) on a Setup step, that step is redrawn
  const c = S.cfg;
  // Done for you: the team runs the look and voice; the agent connects their own accounts.
  if (!can('settings')) {
    main.innerHTML = `<div class="head"><h1>Brand</h1><p class="lede">Your Instagram and Facebook.</p></div>
      <div class="note">Your team takes care of how your videos look and sound. ${can('requests') ? '<a href="#/team">Ask for a change</a>.' : ''}</div>
      ${can('connect') ? igPanel() + fbPanel() : ''}`;
    return;
  }
  main.innerHTML = `<div class="head"><h1>Brand</h1><p class="lede">How every video looks and sounds.</p></div>
    ${endCardPanel(c)}
    ${videoPagesPanel(c)}
    ${captionsPanel(c)}
    ${libraryPanel(c)}
    ${voicePanel(c)}
    ${igPanel()}${fbPanel()}${planPanel()}`;
}

export { DAYS, captionsPanel, drawBrand, endCardPanel, fbPanel, igPanel, libraryPanel, loadBookHook, loadLibrary, loadLogoColors, onOff, planPanel, seg, socialReturn, uploadClip, videoPagesPanel, viewBrand, voicePanel };
