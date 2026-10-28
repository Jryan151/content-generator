// public/screens/signoff.js — Sign-off (v15 Phase 9): the compliance reviewer's page. What the agent
// approved that waits for them, oldest first: the video, its script and spoken lines, the post text, the
// checks it passed. Sign off, or send it back with a note. Below, their recent decisions.
import { S, api, esc, main, toast, when } from '../app.js';

async function viewSignoff() {
  main.innerHTML = '<div class="head"><h1>Sign-off</h1></div><p class="small muted"><span class="spin"></span> Loading…</p>';
  try { S.signoff = await api('/api/signoff'); S.signoff.failed = false; } catch (e) { S.signoff = { failed: true, error: e.message, waiting: [], recent: [] }; }
  drawSignoff();
}
const scriptHTML = v => `<ol class="script small">${v.scenes.map(s => `<li>${esc(s.text)}${s.say && s.say !== s.text ? `<br><span class="muted">Said: ${esc(s.say)}</span>` : ''}</li>`).join('')}</ol>`;
function waitingCard(v) {
  const back = S.soBack === v.id;
  return `<article class="vid" data-so="${esc(v.id)}">${v.media ? `<video class="player" src="${esc(v.media)}"${v.cover ? ` poster="${esc(v.cover)}"` : ''} controls playsinline preload="metadata"></video>` : '<div class="player" style="display:grid;place-items:center;color:#aaa;font-size:13px;padding:12px;text-align:center">Video file removed</div>'}
  <div class="info">
    <div class="row"><span class="pill warn">Waiting for you</span><span class="small muted">${v.approval ? `Approved by ${esc(v.approval.byName)} · ${esc(when(v.approval.at))}` : ''}${v.version > 1 ? ` · version ${v.version}` : ''}</span></div>
    ${v.topic ? `<b>${esc(v.topic)}</b>` : ''}
    ${v.signoff?.status === 'back' ? `<div class="note small">You sent an earlier version back: “${esc(v.signoff.note)}”</div>` : ''}
    <div class="box"><h3>Script</h3>${scriptHTML(v)}</div>
    <div class="box"><h3>Post text</h3>${v.post ? `<p class="post">${esc(v.post)}</p>` : '<p class="small muted">No post text.</p>'}${S.signoff.disclaimer ? `<p class="small muted" style="margin:0">End card disclaimer: ${esc(S.signoff.disclaimer)}</p>` : ''}</div>
    ${v.checks.length ? `<details class="box"><summary class="small">Checks it passed (${v.checks.length})</summary><ul class="list small">${v.checks.map(c => `<li><i>${c.ok ? '✓' : '!'}</i><span>${esc(c.label)}</span></li>`).join('')}</ul>${v.notes.length ? `<p class="small muted">Style notes the agent saw: ${esc(v.notes.join(' · '))}</p>` : ''}</details>` : ''}
    ${back ? `<form class="stack" data-form="so-back" data-id="${esc(v.id)}" data-version="${v.version}"><label class="field"><span>What needs to change?</span><textarea class="ctl" name="note" rows="3" maxlength="600" required placeholder="e.g. Scene 3 needs the carrier’s name, and the post text should say “see if you qualify”."></textarea></label>
      <div class="row"><button class="btn primary">Send it back</button><button class="btn ghost" type="button" data-act="so-back-cancel">Cancel</button></div></form>`
    : `<div class="row"><button class="btn primary" data-act="so-ok" data-id="${esc(v.id)}" data-version="${v.version}">Sign off</button><button class="btn" data-act="so-back" data-id="${esc(v.id)}">Send back with a note</button></div>`}
  </div></article>`;
}
function drawSignoff() {
  const D = S.signoff;
  if (D.failed) { main.innerHTML = `<div class="head"><h1>Sign-off</h1></div><div class="note warn">${esc(D.error || 'Couldn’t load what’s waiting.')} <button class="btn sm ghost" data-act="page-retry">Try again</button></div>`; return; }
  main.innerHTML = `<div class="head"><h1>Sign-off</h1><p class="lede">${esc(D.agent)}’s approved videos wait for you before they post. Watch each one with sound, read the script and post text, then sign it off or send it back with a note.</p></div>
    ${!D.on ? '<div class="note small">Sign-off is turned off in this workspace right now, so videos post without waiting.</div>' : ''}
    ${D.waiting.length ? `<div class="feed">${D.waiting.map(waitingCard).join('')}</div>` : '<p class="empty">Nothing is waiting for you. You’ll get a notification (and an email) when something is.</p>'}
    <section class="panel"><h2>Your recent decisions</h2>${D.recent.length ? `<ul class="list small">${D.recent.map(v => `<li><i>${v.signoff.status === 'ok' ? '✓' : '↩'}</i><span><b>${esc(v.topic || v.scenes[0]?.text || 'A video')}</b> · ${v.signoff.status === 'ok' ? 'signed off' : 'sent back'} ${esc(when(v.signoff.at))}${v.signoff.note ? ` <span class="muted">(“${esc(v.signoff.note)}”)</span>` : ''}${v.status === 'posted' ? ' · posted' : ''}</span></li>`).join('')}</ul>` : '<p class="empty">None yet.</p>'}</section>`;
}
const signoffActions = {
  async 'so-ok'(el) {
    el.disabled = true;
    try { S.signoff = { ...(await api(`/api/signoff/${el.dataset.id}`, { method: 'POST', body: { ok: true, version: Number(el.dataset.version) } })), failed: false }; drawSignoff(); toast('Signed off. The agent can post it now.'); }
    catch (e) { el.disabled = false; toast(e.message); }
  },
  'so-back'(el) { S.soBack = el.dataset.id; drawSignoff(); document.querySelector(`[data-form="so-back"] textarea`)?.focus(); },
  'so-back-cancel'() { S.soBack = null; drawSignoff(); },
};
async function soBackForm(f, data) {
  S.signoff = { ...(await api(`/api/signoff/${f.dataset.id}`, { method: 'POST', body: { ok: false, note: data.note, version: Number(f.dataset.version) } })), failed: false };
  S.soBack = null; drawSignoff(); toast('Sent back to the agent with your note.');
}

export { drawSignoff, signoffActions, soBackForm, viewSignoff };
