// public/screens/replies.js — Keyword replies on Instagram (v15 Phase 9, lib/replies.js): a word in a
// comment or message ("PLAN") gets the reply the agent wrote, in a private message. Shown in Setup → Autopilot.
import { S, api, can, esc, toast, when } from '../app.js';

async function loadReplies() {
  if (!can('replies')) return;
  try { S.replies = await api('/api/replies'); S.replies.failed = false; } catch (e) { S.replies = { failed: true, error: e.message, rules: [], log: [] }; }
}
const isAgent = () => S.me?.role === 'owner' || S.me?.account?.role === 'admin';
function ruleForm(r = {}) {
  const P = S.replies.places;
  return `<form class="stack box" data-form="reply-rule"${r.id ? ` data-id="${esc(r.id)}"` : ''}>
    <div class="fields"><label class="field"><span>Keyword</span><input class="ctl" name="keyword" maxlength="20" required value="${esc(r.keyword || '')}" placeholder="PLAN" autocapitalize="characters"><small>One word. Say it in the video: “Comment PLAN and I’ll send it to you.”</small></label>
      <label class="field"><span>Answer it in</span><select class="ctl" name="where">${Object.entries(P).map(([k, l]) => `<option value="${k}"${(r.where || 'both') === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label></div>
    <label class="field"><span>The reply</span><textarea class="ctl" name="text" rows="4" maxlength="900" required placeholder="Hi {name}! Here’s the checklist I mentioned: {link} Any questions, just ask. – Dana">${esc(r.text || '')}</textarea>
      <small>{name} becomes their first name; {link} becomes your booking link. Held to your rules: no prices, promises or government wording.</small></label>
    <div class="row"><button class="btn primary">${isAgent() ? (r.id ? 'Save and approve' : 'Add and approve') : 'Save for the agent to approve'}</button><button class="btn ghost" type="button" data-act="reply-cancel">Cancel</button><span class="status" data-st></span></div></form>`;
}
function repliesPanel() {
  const R = S.replies;
  if (!can('replies') || !R) return '';
  if (R.failed) return `<section class="panel" id="repliesPanel"><h2>Keyword replies</h2><p class="small muted">${esc(R.error || 'Couldn’t load them.')} <button class="btn sm ghost" data-act="page-retry">Try again</button></p></section>`;
  const rd = R.ready, approved = R.rules.filter(r => r.status === 'approved');
  const status = !rd.server ? '<div class="note small">Keyword replies aren’t set up on this server yet. Your admin turns them on (SETUP.md, section AS). You can write and approve your replies now.</div>'
    : !rd.connected ? '<div class="note small">Connect Instagram above first.</div>'
    : !rd.allowed ? '<div class="note warn small">Your Instagram connection was made before replies were possible. Connect Instagram again above and allow messages.</div>' : '';
  return `<section class="panel" id="repliesPanel"><div class="row between"><div class="head"><h2><span class="dot"></span>Keyword replies</h2><p>When someone comments or messages a word you name in a video, they get your reply in a private message, right away, and your phone hears about it.</p></div>
      ${isAgent() ? `<button class="btn sm${R.on ? ' ghost' : ' primary'}" data-act="replies-on" data-v="${R.on ? '0' : '1'}" ${!R.on && !approved.length ? 'disabled title="Approve a reply first"' : ''}>${R.on ? 'Turn off' : 'Turn on'}</button>` : `<span class="pill${R.on ? ' ok' : ''}">${R.on ? 'On' : 'Off'}</span>`}</div>
    ${status}
    ${R.rules.length ? `<div class="stack" style="gap:8px">${R.rules.map(r => S.replyEdit === r.id ? ruleForm(r) : `<div class="box" style="gap:6px"><div class="row between"><b>${esc(r.keyword)}</b><span class="small muted">${esc(R.places[r.where])}${r.sent ? ` · sent ${r.sent}×${r.lastAt ? `, last ${esc(when(r.lastAt))}` : ''}` : ''}</span></div>
        <p class="small" style="margin:0;white-space:pre-wrap">${esc(r.text)}</p>
        <div class="row">${r.status === 'approved' ? `<span class="pill ok">Approved${r.approvedByName ? ` by ${esc(r.approvedByName)}` : ''}</span>` : `<span class="pill warn">Waiting for the agent</span>${isAgent() ? `<button class="btn sm primary" data-act="reply-approve" data-id="${esc(r.id)}">Approve</button>` : ''}`}
          <button class="btn sm ghost" data-act="reply-edit" data-id="${esc(r.id)}">Edit</button>${isAgent() || r.status !== 'approved' ? `<button class="btn sm ghost danger" data-act="reply-del" data-id="${esc(r.id)}">Remove</button>` : ''}</div></div>`).join('')}</div>` : ''}
    ${S.replyEdit === 'new' ? ruleForm() : R.rules.length < R.max ? '<div class="row"><button class="btn sm" data-act="reply-new">Add a keyword</button></div>' : ''}
    ${R.rules.length ? `<form class="row" data-form="reply-try"><input class="ctl sm" name="text" placeholder="Try a comment: “PLAN please!”" style="flex:1 1 220px" aria-label="Try a comment"><select class="ctl sm" name="where" aria-label="Where"><option value="comment">Comment</option><option value="dm">Message</option></select><button class="btn sm">Try it</button></form>${S.replyTry ? `<p class="small${S.replyTry.rule ? '' : ' muted'}" style="margin:0">${S.replyTry.rule ? `<b>${esc(S.replyTry.rule.keyword)}</b> would send: “${esc(S.replyTry.text)}”` : 'No reply for that one.'}</p>` : ''}` : ''}
    ${R.log.length ? `<details><summary class="small">What was sent (${R.log.length})</summary><ul class="list small">${R.log.map(x => `<li><i>${x.ok ? '✓' : '·'}</i><span>${esc(x.who || 'Someone')} · ${esc(x.keyword)} · ${x.where === 'dm' ? 'message' : 'comment'} · ${esc(when(x.at))}${x.ok ? '' : ` <span class="muted">(not sent: ${esc(x.why)})</span>`}</span></li>`).join('')}</ul></details>` : ''}
    <p class="small muted" style="margin:0">Each person gets a keyword’s reply once a day, a comment gets one private reply, and at most ${R.perDay} go out a day.</p></section>`;
}
const repliesActions = {
  'reply-new'() { S.replyEdit = 'new'; redraw(); document.querySelector('[data-form="reply-rule"] input')?.focus(); },
  'reply-edit'(el) { S.replyEdit = el.dataset.id; redraw(); },
  'reply-cancel'() { S.replyEdit = null; redraw(); },
  async 'reply-approve'(el) { el.disabled = true; try { S.replies = { ...(await api(`/api/replies/rules/${el.dataset.id}/approve`, { method: 'POST', body: {} })), failed: false }; redraw(); toast('Approved'); } catch (e) { el.disabled = false; toast(e.message); } },
  async 'reply-del'(el) { try { S.replies = { ...(await api(`/api/replies/rules/${el.dataset.id}`, { method: 'DELETE' })), failed: false }; redraw(); toast('Removed'); } catch (e) { toast(e.message); } },
  async 'replies-on'(el) { el.disabled = true; try { S.replies = { ...(await api('/api/replies/on', { method: 'POST', body: { on: el.dataset.v === '1' } })), failed: false }; redraw(); toast(el.dataset.v === '1' ? 'Keyword replies are on' : 'Keyword replies are off'); } catch (e) { el.disabled = false; toast(e.message); } },
};
async function repliesForm(kind, f, data) {
  if (kind === 'reply-rule') {
    S.replies = { ...(await api('/api/replies/rules', { method: 'POST', body: { id: f.dataset.id || '', keyword: data.keyword, where: data.where, text: data.text } })), failed: false };
    S.replyEdit = null; redraw(); toast(isAgent() ? 'Saved and approved' : 'Saved. The agent approves it before it’s used.'); return true;
  }
  if (kind === 'reply-try') { S.replyTry = await api('/api/replies/try', { method: 'POST', body: { text: data.text, where: data.where } }); redraw(); return true; }
  return false;
}
function redraw() { const box = document.getElementById('repliesPanel'); if (box) box.outerHTML = repliesPanel(); }

export { loadReplies, repliesActions, repliesForm, repliesPanel };
