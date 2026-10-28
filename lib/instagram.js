// lib/instagram.js — automatic posting to Instagram (optional; off until a Meta app is set up).
//
// Uses the Instagram API with Instagram Login. The agent connects their professional Instagram
// account once (Brand → Instagram). After that, an approved video can post now or at a time they
// pick, and a posting plan can post one approved video on chosen days at a chosen time.
// Only approved videos are ever posted. Instagram downloads the video from a link on this server
// that is signed and expires, so PUBLIC_URL must be public https.
//
//   .env: INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET   (Meta app → Instagram → API setup with Instagram login)
//         INSTAGRAM_API_VERSION (default v25.0), TOKEN_KEY (optional, encrypts stored tokens)
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { DIRS, readJSON, writeJSON, updateJSON, removeJSON } from './paths.js';
import * as store from './store.js';
import { notify } from './alerts.js';
import * as breaker from './breaker.js';
import { crashPoint } from './faults.js';
import * as secrets from './secrets.js';
import * as signoff from './signoff.js';

const env = process.env;
const VERSION = () => env.INSTAGRAM_API_VERSION || 'v25.0';
const AUTH = () => (env.INSTAGRAM_AUTH_BASE || 'https://www.instagram.com').replace(/\/$/, '');
const OAUTH = () => (env.INSTAGRAM_OAUTH_BASE || 'https://api.instagram.com').replace(/\/$/, '');
const GRAPH = () => (env.INSTAGRAM_GRAPH_BASE || 'https://graph.instagram.com').replace(/\/$/, '');
const BASE = () => String(env.PUBLIC_URL || '').replace(/\/$/, '');
export const SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'];
export const INSIGHTS_SCOPE = 'instagram_business_manage_insights';
// Automatic results (views, reach…) need one more permission; on when INSTAGRAM_INSIGHTS=1.
export const insightsOn = () => igOn() && env.INSTAGRAM_INSIGHTS === '1';
// Keyword replies (v15, lib/replies.js) need messages and comments; on when INSTAGRAM_REPLIES=1.
export const REPLY_SCOPES = ['instagram_business_manage_messages', 'instagram_business_manage_comments'];
export const repliesOn = () => igOn() && env.INSTAGRAM_REPLIES === '1';
const scopes = () => [...SCOPES, ...(insightsOn() ? [INSIGHTS_SCOPE] : []), ...(repliesOn() ? REPLY_SCOPES : [])];
const STATES = path.join(DIRS.data, 'instagram-states.json');
const DAY = 86400000;
const MAX_PER_DAY = 10;               // this app's own cap per account (Instagram allows 50)
const PROCESS_LIMIT_MS = 20 * 60000;  // give up if Instagram hasn't finished processing by then

export const igOn = () => !!(env.INSTAGRAM_APP_ID && env.INSTAGRAM_APP_SECRET);
export const publicOk = () => BASE().startsWith('https://') || (env.INSTAGRAM_ALLOW_HTTP === '1' && !!BASE());
export const redirectUri = () => `${BASE()}/api/instagram/callback`;

/* ---------------- Tokens at rest: AES-256-GCM with a key that isn't in data/ (or its backups) ---------------- */
// Sealed with the app's versioned key (lib/secrets.js), so changing the Meta app secret no longer makes
// every token unreadable. Tokens sealed before v15 (with a key made from the app secret) still open.
const legacyKey = () => crypto.createHash('sha256').update('agent-reels:instagram:' + (env.TOKEN_KEY || env.INSTAGRAM_APP_SECRET || env.FACEBOOK_APP_SECRET || 'unset')).digest();
export const seal = text => secrets.seal(text, 'instagram');
export const unseal = sealed => secrets.unseal(sealed, 'instagram', { legacy: [legacyKey()] });

/* ---------------- The connected account ---------------- */
const accFile = ws => path.join(store.wsDir(ws), 'instagram.json');
const readAcc = ws => readJSON(accFile(ws), null);
export function account(ws) {
  const a = readAcc(ws);
  if (!a) return { connected: false };
  return { connected: true, username: a.username, connectedAt: a.connectedAt, expiresAt: a.expiresAt, problem: a.problem || '', insights: hasInsights(a), replies: hasReplies(a) };
}
// Did this connection allow reading results? (Connections made before INSTAGRAM_INSIGHTS was on didn't.)
const hasInsights = a => !!a && !a.insightsProblem && String(a.scopes || '').includes(INSIGHTS_SCOPE);
export const canReadInsights = ws => insightsOn() && hasInsights(readAcc(ws));
// Did this connection allow messages and comments (for keyword replies)?
const hasReplies = a => !!a && REPLY_SCOPES.every(s => String(a.scopes || '').includes(s));
export const canReply = ws => repliesOn() && hasReplies(readAcc(ws));
// A message from the agent's account (v15): a private reply to a comment ({ comment_id }) or a message
// back to someone who wrote ({ id }). JSON, with the token in the header.
export async function sendMessage(ws, recipient, text) {
  const a = readAcc(ws), token = a ? unseal(a.token) : null;
  if (!token) throw Object.assign(new Error('Instagram isn’t connected.'), { code: 190 });
  let res;
  try {
    res = await fetch(`${GRAPH()}/${VERSION()}/${a.userId}/messages`, { method: 'POST', signal: AbortSignal.timeout(Number(env.INSTAGRAM_TIMEOUT_MS) || 30000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ recipient, message: { text: String(text).slice(0, 1000) } }) });
  } catch (e) { throw Object.assign(new Error('Instagram didn’t answer.'), { retry: true }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw Object.assign(new Error(`Instagram: ${data.error?.error_user_msg || data.error?.message || res.status}`), { status: res.status, code: data.error?.code });
  return data;
}
// Asks Instagram to tell this server about the account's comments and messages (the webhook).
export async function subscribeReplies(ws) {
  const a = readAcc(ws), token = a ? unseal(a.token) : null;
  if (!token) throw new Error('Instagram isn’t connected.');
  return call('POST', `${GRAPH()}/${VERSION()}/${a.userId}/subscribed_apps`, { subscribed_fields: 'messages,comments', access_token: token });
}
export function markInsightsProblem(ws, why) { updateJSON(accFile(ws), {}, x => ({ ...x, insightsProblem: why })); }
// A read-only Graph call with the workspace's token (for results).
export async function graphGet(ws, part, params = {}) {
  const a = readAcc(ws), token = a ? unseal(a.token) : null;
  if (!token) throw Object.assign(new Error('Instagram isn’t connected.'), { code: 190 });
  return call('GET', `${GRAPH()}/${VERSION()}/${part.replace(/^\//, '')}`, { ...params, access_token: token });
}
export const userIdOf = ws => readAcc(ws)?.userId || '';
export function disconnect(ws) { removeJSON(accFile(ws)); }

// Graph and OAuth calls. Errors carry Meta's message; code 190 means the token needs reconnecting.
// No answer at all (a timeout, a dropped connection) is marked `retry` and `unknown`: for a publish, it
// means the post may or may not have gone out, and the posting tick finds out before doing anything else.
// Instagram's breaker is counted per posting tick, not per call (see tick): one account with a problem
// of its own never pauses posting for everyone.
async function call(method, url, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  let res;
  try {
    res = await fetch(method === 'GET' ? `${url}?${qs}` : url, {
      method, signal: AbortSignal.timeout(Number(env.INSTAGRAM_TIMEOUT_MS) || 30000),
      ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs.toString() }),
    });
  } catch (e) {
    throw Object.assign(new Error(`Instagram didn’t answer (${e.name === 'TimeoutError' ? 'no answer in time' : e.cause?.code || e.message}).`), { retry: true, unknown: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = data.error || {};
    throw Object.assign(new Error(`Instagram: ${e.error_user_msg || e.message || e.error_message || res.status}`), { status: res.status, code: e.code, retry: res.status >= 500 || res.status === 429 });
  }
  return data;
}
const tokenOf = ws => { const a = readAcc(ws); return a ? unseal(a.token) : null; };

export function connectUrl(ws, accountId) {
  if (!igOn()) throw new Error('Instagram posting isn’t set up on this server.');
  if (!publicOk()) throw new Error('Instagram posting needs PUBLIC_URL to be your public https address.');
  const state = crypto.randomBytes(24).toString('base64url'), now = Date.now();
  updateJSON(STATES, [], list => [...list.filter(x => x.exp > now), { hash: crypto.createHash('sha256').update(state).digest('hex'), ws, accountId, exp: now + 15 * 60000 }]);
  const q = new URLSearchParams({ client_id: env.INSTAGRAM_APP_ID, redirect_uri: redirectUri(), response_type: 'code', scope: scopes().join(','), state });
  return `${AUTH()}/oauth/authorize?${q}`;
}

// The redirect back from Instagram: check the state (single use, 15 minutes), swap the code for a
// long-lived token, read the account, store it sealed.
export async function finishConnect({ state, code, accountId = null }) {
  const hash = crypto.createHash('sha256').update(String(state || '')).digest('hex');
  let st = null;
  updateJSON(STATES, [], list => { st = list.find(x => x.hash === hash && x.exp > Date.now()) || null; return list.filter(x => x.hash !== hash); });
  if (!st || !store.getWorkspace(st.ws)) throw new Error('This connection link expired. Start again from Setup → Autopilot.');
  // Only the person who started the connection can finish it (a link sent to someone else won't connect their account here).
  if (accountId !== null && accountId !== st.accountId) throw new Error('Log in to the app in this browser first, then connect again from Setup → Autopilot.');
  const short = await call('POST', `${OAUTH()}/oauth/access_token`, { client_id: env.INSTAGRAM_APP_ID, client_secret: env.INSTAGRAM_APP_SECRET, grant_type: 'authorization_code', redirect_uri: redirectUri(), code: String(code || '').replace(/#_$/, '') });
  const s = Array.isArray(short.data) ? short.data[0] || {} : short;
  const perms = Array.isArray(s.permissions) ? s.permissions.join(',') : String(s.permissions || '');
  if (perms && !perms.includes('instagram_business_content_publish')) throw new Error('Instagram didn’t allow posting. Connect again and allow content publishing.');
  const long = await call('GET', `${GRAPH()}/access_token`, { grant_type: 'ig_exchange_token', client_secret: env.INSTAGRAM_APP_SECRET, access_token: s.access_token });
  const me = await call('GET', `${GRAPH()}/${VERSION()}/me`, { fields: 'user_id,username', access_token: long.access_token });
  const now = Date.now();
  writeJSON(accFile(st.ws), {
    userId: String(me.user_id || s.user_id || me.id), username: me.username || '', token: seal(long.access_token),
    expiresAt: new Date(now + (Number(long.expires_in) || 60 * 86400) * 1000).toISOString(), connectedAt: new Date(now).toISOString(), connectedBy: st.accountId, refreshedAt: new Date(now).toISOString(), problem: '',
    scopes: perms, insightsProblem: '',
  });
  return { ws: st.ws, username: me.username || '' };
}

// Long-lived tokens last about 60 days; refresh any that are more than a day old and due within 20.
export async function refreshDue(now = Date.now()) {
  if (!igOn()) return [];
  const out = [];
  for (const w of store.listWorkspaces()) { try {
    const a = readAcc(w.id);
    if (!a) continue;
    const left = Date.parse(a.expiresAt) - now;
    if (left <= 0) {
      if (a.problem !== 'expired') { updateJSON(accFile(w.id), {}, x => ({ ...x, problem: 'expired' })); notify({ level: 'warning', kind: 'instagram', title: 'Instagram connection expired', text: 'The agent’s Instagram connection ran out.', did: 'Paused auto-posting for this workspace; scheduled posts wait.', run: 'Ask the agent to connect Instagram again in Setup → Autopilot.', ws: w.id, workspaceName: w.name }); }
      continue;
    }
    if (left > 20 * DAY || now - Date.parse(a.refreshedAt || a.connectedAt) < DAY) continue;
    const current = unseal(a.token);
    if (!current && secrets.keyMissing(a.token)) continue;   // the key is missing, not the connection
    try {
      const r = await call('GET', `${GRAPH()}/refresh_access_token`, { grant_type: 'ig_refresh_token', access_token: current });
      updateJSON(accFile(w.id), {}, x => ({ ...x, token: seal(r.access_token), expiresAt: new Date(now + (Number(r.expires_in) || 60 * 86400) * 1000).toISOString(), refreshedAt: new Date(now).toISOString(), problem: '' }));
      out.push({ ws: w.id, ok: true });
    } catch (e) {
      // 190: the token was revoked (password changed, app removed). Retrying won't help; the agent must reconnect.
      if (e.code === 190 && a.problem !== 'reconnect') {
        updateJSON(accFile(w.id), {}, x => ({ ...x, problem: 'reconnect' }));
        notify({ level: 'warning', kind: 'instagram', title: 'Instagram needs to be connected again', text: 'Instagram stopped accepting this connection.', did: 'Paused auto-posting for this workspace; scheduled posts wait.', run: 'Ask the agent to connect Instagram again in Setup → Autopilot.', ws: w.id, workspaceName: w.name });
      }
      out.push({ ws: w.id, ok: false, error: e.message });
    }
  } catch (e) { store.skipWorkspace(w, e, 'instagram-refresh'); } }
  return out;
}

/* ---------------- Signed links Instagram downloads the video from ---------------- */
const NAME_RE = /^(video|cover)_[\w-]+\.(mp4|jpg)$/;
const sig = (ws, file, exp) => crypto.createHmac('sha256', legacyKey()).update(`${ws}/${file}/${exp}`).digest('base64url');
export function signedUrl(ws, file, ttlSec = 3 * 3600, now = Date.now()) {
  const exp = Math.floor(now / 1000) + ttlSec;
  return `${BASE()}/pub/${ws}/${file}?e=${exp}&s=${sig(ws, file, exp)}`;
}
// For the /pub/ route: the file path when the link is genuine and current, else null.
export function checkSigned(ws, file, exp, s, now = Date.now()) {
  if (!store.validWs(ws) || !NAME_RE.test(String(file)) || !/^\d+$/.test(String(exp)) || Number(exp) * 1000 < now) return null;
  const want = Buffer.from(sig(ws, file, exp)), got = Buffer.from(String(s || ''));
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  return store.videoPath(ws, file);
}

/* ---------------- Scheduling and posting ---------------- */
export function schedulePost(ws, videoId, at, by, now = Date.now()) {
  const v = store.getVideo(ws, videoId);
  if (!v) throw Object.assign(new Error('Video not found.'), { status: 404 });
  if (v.autopost?.status === 'posted') throw Object.assign(new Error('This video is already on Instagram.'), { status: 409 });
  if (!(v.status === 'approved' || (v.status === 'posted' && v.fbpost?.status === 'posted'))) throw Object.assign(new Error('Only approved videos can be posted.'), { status: 409 });
  if (v.fileDeleted || !v.file) throw Object.assign(new Error('This video’s file was removed.'), { status: 409 });
  const acc = account(ws);
  if (!acc.connected) throw Object.assign(new Error('Connect Instagram in Setup → Autopilot first.'), { status: 409 });
  if (acc.problem) throw Object.assign(new Error('Instagram needs to be connected again in Setup → Autopilot.'), { status: 409 });
  if (['processing'].includes(v.autopost?.status)) throw Object.assign(new Error('This video is posting right now.'), { status: 409 });
  const when = at === 'now' || !at ? now : Date.parse(at);
  if (!Number.isFinite(when)) throw Object.assign(new Error('Pick a date and time.'), { status: 400 });
  if (when < now - 60000) throw Object.assign(new Error('That time has already passed.'), { status: 400 });
  if (when > now + 60 * DAY) throw Object.assign(new Error('Schedule up to 60 days ahead.'), { status: 400 });
  // Earlier tries are remembered on the video itself (igTried, kept even when a schedule is canceled or
  // the video goes back to review), so before posting again the tick checks none of them went out.
  return store.updateVideo(ws, videoId, { autopost: { status: 'scheduled', at: new Date(when).toISOString(), by, createdAt: new Date(now).toISOString(), attempts: 0 } });
}
export function cancelPost(ws, videoId) {
  const v = store.getVideo(ws, videoId);
  if (!v?.autopost || v.autopost.status !== 'scheduled') return false;
  store.updateVideo(ws, videoId, { autopost: null });
  return true;
}

// Local date, weekday (0 = Sunday) and minutes past midnight in a time zone.
export function localClock(tz, d = new Date()) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), minutes: Number(p.hour) * 60 + Number(p.minute) };
  } catch { return { date: d.toISOString().slice(0, 10), weekday: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
}

const captionOf = v => String(v.post || '').slice(0, 2200);
async function startPost(ws, v, acc, token) {
  const params = { media_type: 'REELS', video_url: signedUrl(ws, v.file), caption: captionOf(v), share_to_feed: 'true', access_token: token };
  if (v.cover && !v.fileDeleted) params.cover_url = signedUrl(ws, v.cover);
  const r = await call('POST', `${GRAPH()}/${VERSION()}/${acc.userId}/media`, params);
  return r.id;
}

/* How a post goes out (each step is saved before it's taken, so a restart or a lost answer never
   leaves the app guessing):
     scheduled  → a container is made (Instagram fetches the video) → processing
     processing → Instagram says FINISHED → step: 'publishing' is saved → media_publish
     publishing → posted, once Instagram confirms it
   A container can only ever be published once, so asking Instagram to publish it again is safe. When an
   answer is lost, the next tick asks Instagram what happened (the container's status, then the
   account's latest posts) before anything is called a failure. "Didn't go out" is only said when
   Instagram says so; when it can't be told either way for half an hour, the video is marked `unsure`
   and the agent is asked to check Instagram before posting it again (and posting again checks first). */
const norm = t => String(t || '').replace(/\s+/g, ' ').trim();
const PUBLISH_LIMIT_MS = 30 * 60000;
async function containerStatus(token, id) {
  return call('GET', `${GRAPH()}/${VERSION()}/${id}`, { fields: 'status_code,status', access_token: token });
}
// Every container ever made for this video (v14-15 kept them on autopost.previous).
const triedIds = (v, ap) => [...new Set([ap?.containerId, ...(ap?.previous || []), ...(v.igTried || []).map(t => t.id)].filter(Boolean))];
// Is this video already on the account? { posted, mediaId, permalink } | { posted: false } | { unknown: true }
export async function findPosted(acc, token, v, ap) {
  let published = false, reachable = false;
  for (const id of triedIds(v, ap)) {
    try { const st = await containerStatus(token, id); reachable = true; if (st.status_code === 'PUBLISHED') { published = true; break; } }
    catch (e) { if (e.code === 190) throw e; }
  }
  const since = Math.min(...[ap?.firstStartedAt, ap?.startedAt, ap?.publishingAt, ap?.createdAt, ...(v.igTried || []).map(t => t.at)].map(t => Date.parse(t || '')).filter(Number.isFinite)) - 10 * 60000;
  try {
    const list = await call('GET', `${GRAPH()}/${VERSION()}/${acc.userId}/media`, { fields: 'id,caption,timestamp,permalink', limit: 25, access_token: token });
    const m = (list.data || []).find(x => norm(x.caption) === norm(captionOf(v)) && (!Number.isFinite(since) || Date.parse(x.timestamp) >= since));
    if (m) return { posted: true, mediaId: m.id, permalink: m.permalink || '' };
    reachable = true;
  } catch (e) { if (e.code === 190) throw e; }
  if (published) return { posted: true, mediaId: '', permalink: '' };
  return reachable ? { posted: false } : { unknown: true };
}

let busy = false;
// Runs every minute: start due posts, check ones Instagram is processing, publish finished ones.
export async function tick(now = Date.now()) {
  if (!igOn() || busy) return [];
  // Instagram isn't answering (its breaker is open): posts wait. Once it has cooled down, this minute's
  // tick is the one trial: it works → closed; it fails → open for longer; nothing due → given back.
  if (!breaker.allow('instagram', now)) return [];
  busy = true;
  const done = [];
  const iso = () => new Date(now).toISOString();
  const health = { worked: 0, down: new Set(), last: null };   // for the breaker, after the loop
  try {
    for (const w of store.listWorkspaces()) { try {
      const acc = readAcc(w.id);
      if (!acc || acc.problem || w.suspended) continue;
      try { const { planNext } = await import('./posting.js'); planNext(w, now); } catch (e) { done.push({ ws: w.id, plan: e.message }); }
      const token = unseal(acc.token);
      // (Sealed with a key this server doesn't have: the key is missing, not the connection. The key
      // check at start has already told you; nothing is marked.)
      if (!token && secrets.keyMissing(acc.token)) continue;
      if (!token) { updateJSON(accFile(w.id), {}, x => ({ ...x, problem: 'reconnect' })); continue; }
      const postedToday = store.readVideos(w.id).filter(v => v.autopost?.postedAt && now - Date.parse(v.autopost.postedAt) < DAY).length;
      for (const v of store.readVideos(w.id).filter(x => ['scheduled', 'processing'].includes(x.autopost?.status))) {
        let ap = v.autopost;
        const save = patch => { ap = { ...ap, ...patch }; store.updateVideo(w.id, v.id, { autopost: ap }); };
        // Certain it didn't go out.
        const fail = msg => {
          save({ status: 'failed', error: msg, failedAt: iso() });
          notify({ level: 'warning', kind: 'instagram', title: 'An Instagram post didn’t go out', text: `${v.meta?.painPoint || 'A video'}: ${msg}`, did: 'Checked it isn’t on the account, marked it not posted, and showed the agent.', run: 'The agent can post it again from Review when they like.', ws: w.id, workspaceName: w.name });
          done.push({ ws: w.id, video: v.id, status: 'failed', error: msg });
        };
        // Can't tell: the agent checks before posting it again.
        const unsure = why => {
          save({ status: 'unsure', error: why, unsureAt: iso() });
          notify({ level: 'warning', kind: 'instagram', title: 'An Instagram post may or may not have gone out', text: `${v.meta?.painPoint || 'A video'}: ${why}`, did: 'Stopped, so it can’t be posted twice, and marked it “unsure” for the agent.', run: 'Look at the Instagram account: if it isn’t there, post it again from the app (which checks first).', ws: w.id, workspaceName: w.name });
          done.push({ ws: w.id, video: v.id, status: 'unsure' });
        };
        const posted = (found, note = '') => {
          const at = iso();
          // Instagram's link is the one shown, even if the video went to Facebook first.
          store.updateVideo(w.id, v.id, { status: 'posted', posted: { at, by: 'instagram', url: found.permalink || '', auto: true }, autopost: { ...ap, status: 'posted', step: '', mediaId: found.mediaId || '', permalink: found.permalink || '', postedAt: at, ...(note ? { note } : {}) } });
          done.push({ ws: w.id, video: v.id, status: 'posted', ...(note ? { note } : {}) });
        };
        const publish = async () => {
          save({ step: 'publishing', publishingAt: ap.publishingAt || iso(), publishTries: (ap.publishTries || 0) + 1 });   // saved first
          crashPoint('ig:publishing');
          let pub;
          try { pub = await call('POST', `${GRAPH()}/${VERSION()}/${acc.userId}/media_publish`, { creation_id: ap.containerId, access_token: token }); }
          catch (e) { if (e.code === 190) throw e; save({ lastError: String(e.message).slice(0, 200) }); done.push({ ws: w.id, video: v.id, status: 'publishing' }); return; }   // the next tick asks Instagram what happened
          crashPoint('ig:published');
          let permalink = '';
          try { permalink = (await call('GET', `${GRAPH()}/${VERSION()}/${pub.id}`, { fields: 'permalink', access_token: token })).permalink || ''; } catch { /* the post is up; the link is a nicety */ }
          posted({ mediaId: pub.id, permalink });
        };
        try {
          // Approved, or already on the agent's Facebook Page (a cross-post). Sent back to review: not posted.
          // (A post already publishing is followed to the end whatever happens: it may be live.)
          if (!(v.status === 'approved' || (v.status === 'posted' && v.fbpost?.status === 'posted')) && ap.step !== 'publishing') {
            if (ap.status === 'scheduled') store.updateVideo(w.id, v.id, { autopost: null });
            else save({ status: 'failed', error: 'It was sent back to review before it posted.', failedAt: iso() });
            continue;
          }
          if (ap.status === 'scheduled') {
            if (Date.parse(ap.at) > now) continue;
            if (postedToday >= MAX_PER_DAY) continue;
            if (signoff.waiting(w, v)) continue;   // (v15) held until the compliance reviewer signs it off
            if (v.fileDeleted || !v.file) { fail('The video file was removed.'); continue; }
            // Tried before? Make sure none of those tries went out before posting again.
            if (triedIds(v, ap).length) {
              const f = await findPosted(acc, token, v, ap);
              if (f.unknown) {
                // Instagram isn't answering: tried again next minute, called off two hours after its time.
                health.down.add(w.id); health.last = new Error('Instagram didn’t answer.');
                if (now - Date.parse(ap.at) > 2 * 3600000) fail('Instagram wasn’t answering for two hours after its time, so it wasn’t posted. Post it again when you like.');
                continue;
              }
              if (f.posted) {
                posted(f, 'It was already on Instagram from an earlier try, so it wasn’t posted again.');
                notify({ level: 'info', kind: 'instagram', title: 'A video was already on Instagram', text: `${v.meta?.painPoint || 'A video'}: an earlier try had gone out, so it wasn’t posted twice.`, ws: w.id, workspaceName: w.name });
                continue;
              }
            }
            const containerId = await startPost(w.id, v, acc, token);
            crashPoint('ig:container');
            health.worked++;
            ap = { ...ap, status: 'processing', step: 'processing', containerId, startedAt: iso(), attempts: 0 };
            store.updateVideo(w.id, v.id, x => ({ autopost: ap, igTried: [...(x.igTried || []), { id: containerId, at: iso() }].slice(-10) }));
            done.push({ ws: w.id, video: v.id, status: 'processing' });
            continue;
          }
          const st = await containerStatus(token, ap.containerId);
          health.worked++;
          if (st.status_code === 'PUBLISHED') { const f = await findPosted(acc, token, v, ap).catch(() => ({ posted: true })); posted(f.posted ? f : { mediaId: '', permalink: '' }); continue; }
          if (['ERROR', 'EXPIRED'].includes(st.status_code)) { fail(`Instagram couldn’t process the video${st.status ? ` (${String(st.status).slice(0, 120)})` : ''}. It wasn’t posted.`); continue; }
          if (st.status_code === 'FINISHED') {
            if (ap.step === 'publishing' && (ap.publishTries || 0) >= 3) { fail(`Instagram wouldn’t publish it${ap.lastError ? ` (${ap.lastError})` : ''}. It wasn’t posted.`); continue; }
            await publish();
            continue;
          }
          // Still IN_PROGRESS.
          if (now - Date.parse(ap.startedAt) > PROCESS_LIMIT_MS) fail('Instagram took too long to process the video. It wasn’t posted. Try again.');
        } catch (e) {
          if (e.code === 190) { updateJSON(accFile(w.id), {}, x => ({ ...x, problem: 'reconnect' })); if (ap.step === 'publishing') unsure('Instagram asked for the account to be connected again while the post was going out.'); else fail('Instagram needs to be connected again in Setup → Autopilot.'); break; }
          const attempts = (ap.attempts || 0) + 1;
          // Instagram itself not answering: the post waits (it isn't charged a try) for up to two hours
          // from its time, then it's called off so it never goes out hours late.
          if (breaker.isServiceFailure(e)) { health.down.add(w.id); health.last = e; }
          else if (typeof e.status === 'number') health.worked++;   // a refusal: Instagram itself is up
          if (breaker.isServiceFailure(e) && !(ap.status === 'processing' && ap.step === 'publishing')) {
            if (ap.status === 'processing' && now - Date.parse(ap.startedAt) > PROCESS_LIMIT_MS) fail('Instagram stopped answering while it processed the video. It wasn’t posted. Try again.');
            else if (ap.status === 'scheduled' && now - Date.parse(ap.at) > 2 * 3600000) fail('Instagram wasn’t answering for two hours after its time, so it wasn’t posted. Post it again when you like.');
            continue;
          }
          if (ap.status === 'processing' && ap.step === 'publishing') {
            // The post may be up. Keep asking for half an hour before handing it to the agent.
            if (now - Date.parse(ap.publishingAt || ap.startedAt) > PUBLISH_LIMIT_MS) unsure('Instagram stopped answering while it was posting.');
            else save({ attempts, lastError: String(e.message).slice(0, 200) });
          } else if (e.retry && attempts < 3) save({ attempts });
          else fail(e.message);
        }
      }
    } catch (e) { store.skipWorkspace(w, e, 'instagram-posting'); } }
  } finally {
    busy = false;
    // Down for everyone with work this minute (and nobody got through): that counts toward the breaker.
    if (health.worked > 0) breaker.success('instagram');
    else if (health.down.size) breaker.failure('instagram', health.last);
    else breaker.release('instagram');
  }
  return done;
}
