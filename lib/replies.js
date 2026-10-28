// lib/replies.js — keyword replies on Instagram (v15 Phase 9).
//
// A video says "Comment PLAN and I'll send you the checklist" (or "Message me PLAN"). When someone
// comments or messages that word, the app sends them the reply the agent wrote, in a private message:
// right away, day or night. The agent approves each reply's wording once (an assistant can draft one;
// it waits for the agent), and the wording is held to the same rules as any reply to a client: no
// prices, promises, government wording or never-use words, and no links but the video's own page or the
// booking link ({link}). The person shows up on the Desk as a new lead, tied to the video they
// commented on, and the agent's phone hears about it.
//
// Instagram's limits are kept: one private reply per comment (within 7 days), a message only in reply
// to theirs (within 24 hours), and this app's own: each person hears from a keyword once a day, and an
// account sends at most MAX_PER_DAY a day.
//
// Needs the Instagram connection to allow messages (INSTAGRAM_REPLIES=1 asks for them when connecting)
// and Meta's webhook set up (SETUP.md section AS). workspaces/<ws>/replies.json: { on, rules: [...] };
// replies-log.json: the last 300 sends and refusals.
import crypto from 'crypto';
import path from 'path';
import { readJSON, updateJSON } from './paths.js';
import * as store from './store.js';
import * as clients from './clients.js';
import * as links from './links.js';
import * as ig from './instagram.js';
import { isOn } from './switches.js';
import { replyProblems } from './coach.js';
import * as billing from './billing.js';

export const MAX_RULES = 10, MAX_PER_DAY = 100, MAX_TEXT = 900, KEEP_FREE = 200;
export const PLACES = { both: 'Comments and messages', comment: 'Comments on my videos', dm: 'Messages to me' };
const file = ws => path.join(store.wsDir(ws), 'replies.json');
const logFile = ws => path.join(store.wsDir(ws), 'replies-log.json');
// What was sent, kept apart from the log so the limits hold however busy it gets: the sends of the last
// day, and who heard from which keyword (a day) and which comments were answered (a week).
const countFile = ws => path.join(store.wsDir(ws), 'replies-count.json');
const err = (status, message) => Object.assign(new Error(message), { status });
const t = (v, n) => String(v ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, n);
const iso = (now = Date.now()) => new Date(now).toISOString();

export const state = ws => readJSON(file(ws), { on: false, rules: [] });
export const log = ws => readJSON(logFile(ws), []);
// On this server: the Meta app asks for messages, and the webhook can be checked.
export const serverReady = () => ig.repliesOn() && !!process.env.INSTAGRAM_WEBHOOK_TOKEN;

/* ---------------- The rules ---------------- */
// A keyword is one word (letters and numbers), matched whole and without caring about capitals.
export const cleanKeyword = k => String(k || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 20).toUpperCase();
// Anything that looks like a link, with or without https:// (bit.ly/x, example.com/page).
const LINK_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|ly|co|us|me|info|biz|app|link|site|xyz|gl|to|page|online)\b(?:\/\S*)?/gi;
// The booking link itself (same site, same page or below), which may be written out.
function isBooking(u, booking) {
  try {
    const a = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`), b = new URL(booking);
    const path = b.pathname.replace(/\/$/, '');
    return a.hostname.toLowerCase() === b.hostname.toLowerCase() && (!path || a.pathname === path || a.pathname.startsWith(`${path}/`));
  } catch { return false; }
}
// What's wrong with a reply's wording (empty when it's fine). Links: only {link} or the booking link.
export function problems(text, cfg) {
  const out = [], s = String(text || '');
  if (!s.trim()) return ['Write the reply.'];
  if (Buffer.byteLength(s) > MAX_TEXT) out.push(`Keep it under ${MAX_TEXT} characters.`);
  const booking = cfg.look?.bookingUrl || '';
  if ((s.replace(/\{link\}/g, '').match(LINK_RE) || []).some(u => !booking || !isBooking(u.replace(/[.,!?)]+$/, ''), booking))) out.push('Use {link} for a link: it becomes the video’s page, or your booking link.');
  const found = replyProblems(s.replace(/\{(name|link)\}/g, ''), cfg);
  const WHY = { 'price or percentage': 'Leave prices and percentages out.', 'government wording': 'Leave out government program wording.', promise: 'Leave out promises about coverage or approval.', 'banned word': 'It uses a word on your never-use list.' };
  for (const f of found) out.push(WHY[f] || 'Change the wording.');
  return [...new Set(out)];
}
// Saved by the agent: approved as written. Saved by an assistant: a draft, waiting for the agent.
export function saveRule(ws, { id, keyword, where, text }, { by, byName, approve = false }) {
  const cfg = store.loadConfig(ws), kw = cleanKeyword(keyword), body = t(text, 2000).replace(/\r/g, '');
  if (!kw || kw.length < 2) throw err(400, 'The keyword is one word, at least 2 letters (like PLAN).');
  if (!Object.hasOwn(PLACES, where)) throw err(400, 'Where should it answer?');
  const p = problems(body, cfg);
  if (p.length) throw err(400, p.join(' '));
  let out = null;
  updateJSON(file(ws), { on: false, rules: [] }, s => {
    const rules = s.rules || [];
    if (rules.some(r => r.keyword === kw && r.id !== id)) throw err(409, `There’s already a reply for ${kw}.`);
    const old = id ? rules.find(r => r.id === id) : null;
    if (id && !old) throw err(404, 'Reply not found.');
    if (!old && rules.length >= MAX_RULES) throw err(409, `That’s ${MAX_RULES} keywords, the most for now.`);
    const same = old && old.text === body && old.keyword === kw && old.where === where && old.status === 'approved';   // anything changed: approved again
    out = { ...(old || { id: crypto.randomBytes(5).toString('hex'), createdAt: iso(), createdBy: by, sent: 0 }), keyword: kw, where, text: body,
      status: approve || same ? 'approved' : 'draft', ...(approve && !same ? { approvedBy: by, approvedByName: byName, approvedAt: iso() } : {}), updatedAt: iso() };
    return { ...s, rules: old ? rules.map(r => (r.id === id ? out : r)) : [...rules, out] };
  });
  return out;
}
export function approveRule(ws, id, { by, byName }) {
  let out = null;
  updateJSON(file(ws), { on: false, rules: [] }, s => ({ ...s, rules: (s.rules || []).map(r => (r.id === id ? (out = { ...r, status: 'approved', approvedBy: by, approvedByName: byName, approvedAt: iso() }) : r)) }));
  if (!out) throw err(404, 'Reply not found.');
  const p = problems(out.text, store.loadConfig(ws));   // the rules may have changed since it was written
  if (p.length) { updateJSON(file(ws), { on: false, rules: [] }, s => ({ ...s, rules: s.rules.map(r => (r.id === id ? { ...r, status: 'draft' } : r)) })); throw err(400, p.join(' ')); }
  return out;
}
export function removeRule(ws, id, { draftsOnly = false } = {}) {
  let gone = false;
  updateJSON(file(ws), { on: false, rules: [] }, s => ({ ...s, rules: (s.rules || []).filter(r => { const hit = r.id === id && (!draftsOnly || r.status === 'draft'); if (hit) gone = true; return !hit; }) }));
  return gone;
}
export function setOn(ws, on) { updateJSON(file(ws), { on: false, rules: [] }, s => ({ ...s, on: !!on })); return state(ws); }

/* ---------------- Matching and the reply itself ---------------- */
// The rule a comment or message calls for: its keyword appears as a whole word (in a short message).
export function match(ws, text, where) {
  const s = state(ws), words = String(text || '').slice(0, 300).toUpperCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length || words.length > 25) return null;
  return (s.rules || []).find(r => r.status === 'approved' && (r.where === 'both' || r.where === where) && words.includes(r.keyword)) || null;
}
// The words sent: {name} → their first name (or "there"), {link} → the video's page, or the booking link.
export function fill(text, { name = '', link = '' } = {}) {
  const first = String(name || '').trim().split(/\s+/)[0].replace(/[^\p{L}'’-]/gu, '').slice(0, 30);
  return String(text).replace(/\{name\}/g, first || 'there').replace(/\s*\{link\}/g, link ? ` ${link}` : '').replace(/[ \t]+\n/g, '\n').trim();
}

/* ---------------- What Instagram sends (the webhook) ---------------- */
// The app secret signs each call: X-Hub-Signature-256: sha256=<hmac of the body>.
export function verify(raw, header) {
  const secret = process.env.INSTAGRAM_APP_SECRET || '';
  if (!secret || !header) return false;
  const want = Buffer.from(`sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`), got = Buffer.from(String(header));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
// The events in a webhook body: [{ igId, where, from, username, text, commentId, mediaId, mid }].
export function events(body) {
  const out = [];
  if (body?.object !== 'instagram') return out;
  for (const e of Array.isArray(body.entry) ? body.entry.slice(0, 50) : []) {
    const igId = String(e.id || '');
    for (const m of Array.isArray(e.messaging) ? e.messaging.slice(0, 50) : []) {
      if (!m?.message || m.message.is_echo || m.message.is_deleted) continue;
      out.push({ igId, where: 'dm', from: String(m.sender?.id || ''), username: '', text: t(m.message.text, 1000), mid: String(m.message.mid || '') });
    }
    for (const c of Array.isArray(e.changes) ? e.changes.slice(0, 50) : []) {
      if (c?.field !== 'comments' || !c.value) continue;
      const v = c.value;
      out.push({ igId, where: 'comment', from: String(v.from?.id || ''), username: t(v.from?.username, 40), text: t(v.text, 1000), commentId: String(v.id || ''), mediaId: String(v.media?.id || '') });
    }
  }
  return out;
}
// Which workspace an Instagram account belongs to (the connected account's id).
export function wsForIg(igId) {
  if (!igId) return null;
  return store.listWorkspaces().find(w => ig.userIdOf(w.id) === igId) || null;
}

const DAY = 86400000;
const addLog = (ws, entry) => updateJSON(logFile(ws), [], l => [entry, ...l].slice(0, 300));
// Refusals are logged once a day per person and keyword, so a busy post doesn't fill the log.
const refuse = (ws, entry, now) => { const key = `${entry.from}:${entry.ruleId}:${entry.why}`; let fresh = false; updateJSON(countFile(ws), {}, c => { const r = { ...(c.refused || {}) }; if (!r[key] || now - r[key] > DAY) { r[key] = now; fresh = true; } return { ...c, refused: prune(r, now, DAY) }; }); if (fresh) addLog(ws, entry); return entry; };
const prune = (m, now, ms) => Object.fromEntries(Object.entries(m || {}).filter(([, at]) => now - at < ms).slice(-5000));
const tidy = (c, now) => ({ sends: (c.sends || []).filter(at => now - at < DAY), heard: prune(c.heard, now, DAY), comments: prune(c.comments, now, 7 * DAY) });
const counts = (ws, now) => tidy(readJSON(countFile(ws), {}), now);
// One at a time per person and keyword (two webhook calls at once can't both send).
const inFlight = new Set();

// One comment or message: the reply sent (or why not), the lead on the Desk. `send(igId, recipient, text)`
// is the Instagram call (passed in by tests). Returns the log entry, or null when nothing applies.
export async function handle(w, ev, { now = Date.now(), send = sendMessage, notice = null } = {}) {
  const s = state(w.id);
  if (!s.on || w.suspended || !isOn('replies', w) || !billing.access(w).allowed) return null;   // (and not after the plan ends)
  if (!ev.from || ev.from === ev.igId) return null;   // the agent's own comment or message
  const rule = match(w.id, ev.text, ev.where);
  if (!rule) return null;
  const video = ev.mediaId ? store.readVideos(w.id).find(v => v.autopost?.mediaId === ev.mediaId) : null;
  const entry = { at: iso(now), ruleId: rule.id, keyword: rule.keyword, where: ev.where, who: ev.username ? `@${ev.username}` : '', from: ev.from, videoId: video?.id || '', ok: false, why: '', commentId: ev.commentId || '' };
  const lock = `${w.id}:${ev.from}:${rule.id}`;
  if (inFlight.has(lock)) return null;
  inFlight.add(lock);
  try { return await answer(w, ev, rule, video, entry, { now, send, notice }); } finally { inFlight.delete(lock); }
}
async function answer(w, ev, rule, video, entry, { now, send, notice }) {
  // Once per comment; each person hears from a keyword once a day; the account's daily cap.
  const c = counts(w.id, now);
  if (ev.commentId && c.comments[ev.commentId]) return null;
  if (c.heard[`${ev.from}:${rule.id}`]) { entry.why = 'Already answered today'; return refuse(w.id, entry, now); }
  if (c.sends.length >= MAX_PER_DAY) { entry.why = `The ${MAX_PER_DAY}-a-day limit`; return refuse(w.id, entry, now); }
  // The wording is checked again as it's sent: rules added since it was approved still hold.
  const cfg0 = store.loadConfig(w.id), wrong = problems(rule.text, cfg0);
  if (wrong.length) {
    updateJSON(file(w.id), { on: false, rules: [] }, x => ({ ...x, rules: (x.rules || []).map(r => (r.id === rule.id ? { ...r, status: 'draft' } : r)) }));
    entry.why = `Its wording needs approving again: ${wrong[0]}`; return refuse(w.id, entry, now);
  }
  // Their name, for {name} and the Desk (Instagram may not share it; then their handle or "there").
  let profile = {};
  try { profile = await ig.graphGet(w.id, ev.from, { fields: 'name,username' }); } catch { /* not shared */ }
  const name = t(profile.name, 80), username = ev.username || t(profile.username, 40);
  entry.who = username ? `@${username}` : name;
  const cfg = cfg0, link = video ? links.urlFor(links.codeFor(w.id, video.id)) : cfg.look?.bookingUrl || '';
  const text = fill(rule.text, { name, link });
  try {
    await send(w.id, ev.commentId ? { comment_id: ev.commentId } : { id: ev.from }, text);
    entry.ok = true;
  } catch (e) { entry.why = String(e.message || 'Instagram refused it').slice(0, 160); }
  addLog(w.id, entry);
  if (entry.ok) {
    updateJSON(countFile(w.id), {}, x => { const k = tidy(x, now); return { ...x, sends: [...k.sends, now], heard: { ...k.heard, [`${ev.from}:${rule.id}`]: now }, comments: ev.commentId ? { ...k.comments, [ev.commentId]: now } : k.comments }; });
    updateJSON(file(w.id), { on: false, rules: [] }, x => ({ ...x, rules: (x.rules || []).map(r => (r.id === rule.id ? { ...r, sent: (r.sent || 0) + 1, lastAt: iso(now) } : r)) }));
    const c = leadFor(w.id, { igsid: ev.from, name: name || (username ? `@${username}` : 'Instagram follower'), keyword: rule.keyword, where: ev.where, video });
    if (notice) notice(w.id, c, rule, video);
  }
  return entry;
}
// The person, on the Desk: new as a lead, or a note added if they're already there.
function leadFor(ws, { igsid, name, keyword, where, video }) {
  const said = `${where === 'comment' ? 'Commented' : 'Messaged'} “${keyword}”${video ? ' on a video' : ''}; the automatic reply was sent.`;
  const all = clients.list(ws), known = all.find(c => c.igsid === igsid);
  if (known) return clients.save(ws, known.id, { notes: t(`${known.notes ? `${known.notes}\n` : ''}${said}`, 1000), ...(!known.videoId && video ? { videoId: video.id } : {}) });
  if (all.length >= clients.MAX_CLIENTS - KEEP_FREE) return null;   // the last places are the agent's own (the reply still went)
  try { return clients.add(ws, { name, igsid, stage: 'lead', source: `Instagram: “${keyword}”`, notes: said, videoId: video?.id || '' }); }
  catch { return null; }   // a full list: the reply still went
}
// The Instagram call: a private reply to a comment, or a message back.
export async function sendMessage(ws, recipient, text) {
  return ig.sendMessage(ws, recipient, text);
}
