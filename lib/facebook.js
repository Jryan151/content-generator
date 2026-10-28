// lib/facebook.js — cross-posting approved videos to the agent's Facebook Page as Reels (optional;
// off until a Meta app with Facebook Login is set up). Works like Instagram auto-posting: the agent
// connects once (Brand → Facebook), then any approved video can post now or at a set time, and the
// posting plan can post to Facebook, Instagram or both. Only approved videos are ever posted.
// Facebook downloads the video from the same signed, expiring link on this server that Instagram
// uses, so PUBLIC_URL must be public https. The Facebook post text carries the video's tracking link
// (links in Facebook posts can be tapped; on Instagram they can't).
//
//   .env: FACEBOOK_APP_ID, FACEBOOK_APP_SECRET   (Meta app → Facebook Login for Business)
//         FACEBOOK_API_VERSION (default v25.0), TOKEN_KEY (optional, encrypts stored tokens)
import crypto from 'crypto';
import path from 'path';
import { DIRS, readJSON, writeJSON, updateJSON, removeJSON } from './paths.js';
import * as store from './store.js';
import { notify } from './alerts.js';
import * as breaker from './breaker.js';
import { crashPoint } from './faults.js';
import * as secrets from './secrets.js';
import { signedUrl, publicOk } from './instagram.js';
import * as links from './links.js';
import * as signoff from './signoff.js';
import { withTrackingLink, okBookingUrl } from '../mixer-core.js';

const env = process.env;
const VERSION = () => env.FACEBOOK_API_VERSION || 'v25.0';
const AUTH = () => (env.FACEBOOK_AUTH_BASE || 'https://www.facebook.com').replace(/\/$/, '');
const GRAPH = () => (env.FACEBOOK_GRAPH_BASE || 'https://graph.facebook.com').replace(/\/$/, '');
const UPLOAD = () => (env.FACEBOOK_UPLOAD_BASE || 'https://rupload.facebook.com').replace(/\/$/, '');
const BASE = () => String(env.PUBLIC_URL || '').replace(/\/$/, '');
export const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'];
const STATES = path.join(DIRS.data, 'facebook-states.json');
const DAY = 86400000;
const MAX_PER_DAY = 10;               // this app's own cap per Page (Facebook allows 30 Reels a day)
const PROCESS_LIMIT_MS = 30 * 60000;  // give up if Facebook hasn't published it by then
const CHOOSE_MS = 30 * 60000;         // how long the "which Page?" choice waits

export const fbOn = () => !!(env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET);
export const redirectUri = () => `${BASE()}/api/facebook/callback`;

/* ---------------- Tokens at rest (AES-256-GCM, key outside data/) ---------------- */
// The app's versioned key (lib/secrets.js); tokens sealed before v15 (a key from the app secret) still open.
const legacyKey = () => crypto.createHash('sha256').update('agent-reels:facebook:' + (env.TOKEN_KEY || env.FACEBOOK_APP_SECRET || 'unset')).digest();
export const seal = text => secrets.seal(text, 'facebook');
export const unseal = sealed => secrets.unseal(sealed, 'facebook', { legacy: [legacyKey()] });

/* ---------------- The connected Page ---------------- */
const accFile = ws => path.join(store.wsDir(ws), 'facebook.json');
const readAcc = ws => readJSON(accFile(ws), null);
export function account(ws, now = Date.now()) {
  const a = readAcc(ws);
  if (!a) return { connected: false };
  if (!a.pageId) return { connected: false, choose: a.chooseExp > now ? (a.choose || []).map(p => ({ id: p.id, name: p.name })) : [] };
  return { connected: true, pageId: a.pageId, pageName: a.pageName, connectedAt: a.connectedAt, problem: a.problem || '' };
}
export function disconnect(ws) { removeJSON(accFile(ws)); }

// Facebook's breaker is counted per posting tick, not per call: one Page with a problem of its own
// never pauses posting for everyone. During a tick, every answer (or no answer) is noted here.
let tickHealth = null;
async function call(method, url, params = {}, headers = {}) {
  try { const out = await callOnce(method, url, params, headers); if (tickHealth) tickHealth.worked++; return out; }
  catch (e) { if (tickHealth && breaker.isServiceFailure(e)) { tickHealth.down++; tickHealth.last = e; } else if (tickHealth && e.status) tickHealth.worked++; throw e; }
}
async function callOnce(method, url, params, headers) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  let res;
  try {
    res = await fetch(method === 'GET' ? `${url}?${qs}` : url, {
      method, signal: AbortSignal.timeout(60000),
      headers: { ...(method === 'GET' ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }), ...headers },
      ...(method === 'GET' ? {} : { body: qs.toString() }),
    });
  } catch (e) { throw Object.assign(new Error(`Facebook didn’t answer (${e.name === 'TimeoutError' ? 'no answer in time' : e.cause?.code || e.message}).`), { retry: true, unknown: true }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = data.error || {};
    throw Object.assign(new Error(`Facebook: ${e.error_user_msg || e.message || res.status}`), { status: res.status, code: e.code, retry: res.status >= 500 || res.status === 429 });
  }
  return data;
}
const graph = part => `${GRAPH()}/${VERSION()}/${String(part).replace(/^\//, '')}`;

export function connectUrl(ws, accountId) {
  if (!fbOn()) throw new Error('Facebook posting isn’t set up on this server.');
  if (!publicOk()) throw new Error('Facebook posting needs PUBLIC_URL to be your public https address.');
  const state = crypto.randomBytes(24).toString('base64url'), now = Date.now();
  updateJSON(STATES, [], list => [...list.filter(x => x.exp > now), { hash: crypto.createHash('sha256').update(state).digest('hex'), ws, accountId, exp: now + 15 * 60000 }]);
  const q = new URLSearchParams({ client_id: env.FACEBOOK_APP_ID, redirect_uri: redirectUri(), response_type: 'code', scope: SCOPES.join(','), state });
  return `${AUTH()}/${VERSION()}/dialog/oauth?${q}`;
}

// Back from Facebook: check the state (single use, 15 minutes), get a long-lived token, list the Pages
// the agent can post to. One Page connects straight away; several are offered to pick from.
export async function finishConnect({ state, code, accountId = null }, now = Date.now()) {
  const hash = crypto.createHash('sha256').update(String(state || '')).digest('hex');
  let st = null;
  updateJSON(STATES, [], list => { st = list.find(x => x.hash === hash && x.exp > now) || null; return list.filter(x => x.hash !== hash); });
  if (!st || !store.getWorkspace(st.ws)) throw new Error('This connection link expired. Start again from Setup → Autopilot.');
  // Only the person who started the connection can finish it (a link sent to someone else won't connect their Page here).
  if (accountId !== null && accountId !== st.accountId) throw new Error('Log in to the app in this browser first, then connect again from Setup → Autopilot.');
  const short = await call('GET', graph('oauth/access_token'), { client_id: env.FACEBOOK_APP_ID, client_secret: env.FACEBOOK_APP_SECRET, redirect_uri: redirectUri(), code: String(code || '') });
  const long = await call('GET', graph('oauth/access_token'), { grant_type: 'fb_exchange_token', client_id: env.FACEBOOK_APP_ID, client_secret: env.FACEBOOK_APP_SECRET, fb_exchange_token: short.access_token });
  const r = await call('GET', graph('me/accounts'), { fields: 'id,name,access_token,tasks', limit: 50, access_token: long.access_token });
  // Pages where the agent can post (tasks lists what their role allows; older apps don't send it).
  const pages = (r.data || []).filter(p => p.id && p.access_token && (!Array.isArray(p.tasks) || p.tasks.includes('CREATE_CONTENT')));
  if (!pages.length) throw new Error('No Facebook Page you can post to was shared. Connect again and pick your business Page.');
  const base = { connectedAt: new Date(now).toISOString(), connectedBy: st.accountId, problem: '' };
  if (pages.length === 1) {
    writeJSON(accFile(st.ws), { ...base, pageId: String(pages[0].id), pageName: String(pages[0].name || '').slice(0, 100), token: seal(pages[0].access_token) });
    return { ws: st.ws, pageName: pages[0].name || '', choose: false };
  }
  writeJSON(accFile(st.ws), { ...base, chooseExp: now + CHOOSE_MS, choose: pages.slice(0, 20).map(p => ({ id: String(p.id), name: String(p.name || '').slice(0, 100), token: seal(p.access_token) })) });
  return { ws: st.ws, pageName: '', choose: true };
}
export function pickPage(ws, pageId, accountId = null, now = Date.now()) {
  const a = readAcc(ws);
  const p = a && !a.pageId && a.chooseExp > now && (accountId === null || accountId === a.connectedBy) && (a.choose || []).find(x => x.id === String(pageId));
  if (!p) throw Object.assign(new Error('That choice expired. Connect Facebook again.'), { status: 409 });
  writeJSON(accFile(ws), { connectedAt: a.connectedAt, connectedBy: a.connectedBy, problem: '', pageId: p.id, pageName: p.name, token: p.token });
  return account(ws);
}

/* ---------------- Post text and scheduling ---------------- */
// Facebook's post text: the approved post text, with the video's tracking link (when the agent has a
// booking link) just above their small print.
export function postText(ws, v, cfg = store.loadConfig(ws)) {
  const text = String(v.post || '').trim();
  if (!okBookingUrl(cfg.look?.bookingUrl)) return text;
  const url = links.urlFor(links.codeFor(ws, v.id));
  return url ? withTrackingLink(text, cfg, url) : text;
}

export function schedulePost(ws, videoId, at, by, now = Date.now()) {
  const v = store.getVideo(ws, videoId);
  if (!v) throw Object.assign(new Error('Video not found.'), { status: 404 });
  if (!['approved', 'posted'].includes(v.status)) throw Object.assign(new Error('Only approved videos can be posted.'), { status: 409 });
  if (v.fileDeleted || !v.file) throw Object.assign(new Error('This video’s file was removed.'), { status: 409 });
  const acc = account(ws);
  if (!acc.connected) throw Object.assign(new Error('Connect your Facebook Page in Setup → Autopilot first.'), { status: 409 });
  if (acc.problem) throw Object.assign(new Error('Facebook needs to be connected again in Setup → Autopilot.'), { status: 409 });
  if (v.fbpost?.status === 'processing') throw Object.assign(new Error('This video is posting to Facebook right now.'), { status: 409 });
  if (v.fbpost?.status === 'posted') throw Object.assign(new Error('This video is already on your Facebook Page.'), { status: 409 });
  const when = at === 'now' || !at ? now : Date.parse(at);
  if (!Number.isFinite(when)) throw Object.assign(new Error('Pick a date and time.'), { status: 400 });
  if (when < now - 60000) throw Object.assign(new Error('That time has already passed.'), { status: 400 });
  if (when > now + 60 * DAY) throw Object.assign(new Error('Schedule up to 60 days ahead.'), { status: 400 });
  return store.updateVideo(ws, videoId, { fbpost: { status: 'scheduled', at: new Date(when).toISOString(), by, createdAt: new Date(now).toISOString(), attempts: 0 } });
}
export function cancelPost(ws, videoId) {
  const v = store.getVideo(ws, videoId);
  if (!v?.fbpost || v.fbpost.status !== 'scheduled') return false;
  store.updateVideo(ws, videoId, { fbpost: null });
  return true;
}

// A post goes through three calls, each saved as it's done, so a restart or a retry carries on from
// where it stopped instead of starting a second Reel:
//   starting → (start: Facebook makes an empty, unpublished video) → started → (upload: Facebook fetches
//   the file from the signed link) → uploaded → (finish: published with the text) → finished → posted.
// Only "finish" publishes, and it's always for the same saved video id, so nothing goes out twice.
async function advance(ws, v, acc, token, fp, save) {
  let cur = fp;
  if (cur.phase === 'starting') {
    const start = await call('POST', graph(`${acc.pageId}/video_reels`), { upload_phase: 'start', access_token: token });
    if (!start.video_id) throw new Error('Facebook didn’t start the upload.');
    crashPoint('fb:started');
    cur = save({ ...cur, phase: 'started', videoId: String(start.video_id) });
  }
  if (cur.phase === 'started') {
    await call('POST', `${UPLOAD()}/video-upload/${VERSION()}/${encodeURIComponent(cur.videoId)}`, {}, { Authorization: `OAuth ${token}`, file_url: signedUrl(ws, v.file) });
    cur = save({ ...cur, phase: 'uploaded' });
  }
  if (cur.phase === 'uploaded') {
    const text = postText(ws, v).slice(0, 5000);
    // Asked to publish before and cut off before the answer was saved: ask Facebook where it got to
    // first, so it's never asked twice.
    let already = false;
    if (cur.finishing) {
      const st = await call('GET', graph(cur.videoId), { fields: 'status', access_token: token });
      // Only the publishing phase says it was asked ("ready" alone just means processed).
      already = ['complete', 'in_progress'].includes(st.status?.publishing_phase?.status);
    }
    if (!already) {
      cur = save({ ...cur, finishing: new Date().toISOString() });   // saved first
      await call('POST', graph(`${acc.pageId}/video_reels`), { upload_phase: 'finish', video_id: cur.videoId, video_state: 'PUBLISHED', description: text, access_token: token });
      crashPoint('fb:published');
    }
    cur = save({ ...cur, phase: 'finished', text: cur.text || text, finishedAt: new Date().toISOString() });
  }
  return cur;
}
const errorOf = s => [s.uploading_phase, s.processing_phase, s.publishing_phase].find(x => x?.status === 'error');

let busy = false;
// Runs every minute: start due posts, carry on with ones part-way through, check ones Facebook is publishing.
export async function tick(now = Date.now()) {
  if (!fbOn() || busy) return [];
  // Facebook isn't answering (its breaker is open): posts wait. After the cool-down this tick is the trial.
  if (!breaker.allow('facebook', now)) return [];
  busy = true;
  tickHealth = { worked: 0, down: 0, last: null };
  const done = [];
  try {
    const { planNext } = await import('./posting.js');
    for (const w of store.listWorkspaces()) { try {
      const acc = account(w.id);
      if (!acc.connected || acc.problem || w.suspended) continue;
      try { planNext(w, now); } catch (e) { done.push({ ws: w.id, plan: e.message }); }
      const sealedTok = readAcc(w.id).token, token = unseal(sealedTok);
      if (!token && secrets.keyMissing(sealedTok)) continue;   // the key is missing, not the connection
      if (!token) { updateJSON(accFile(w.id), {}, x => ({ ...x, problem: 'reconnect' })); continue; }
      // The daily cap counts posts started in the last 24 hours, including ones still going.
      let started = store.readVideos(w.id).filter(v => v.fbpost?.startedAt && now - Date.parse(v.fbpost.startedAt) < DAY && v.fbpost.status !== 'failed').length;
      for (const v of store.readVideos(w.id).filter(x => ['scheduled', 'processing'].includes(x.fbpost?.status))) {
        let fp = v.fbpost;
        const save = next => { store.updateVideo(w.id, v.id, { fbpost: next }); fp = next; return next; };
        const fail = msg => {
          save({ ...fp, status: 'failed', error: msg, failedAt: new Date(now).toISOString() });
          notify({ level: 'warning', kind: 'facebook', title: 'A Facebook post didn’t go out', text: `${v.meta?.painPoint || 'A video'}: ${msg}`, did: 'Marked it not posted on Facebook and showed the agent.', run: 'The agent can cross-post it again from Review.', ws: w.id, workspaceName: w.name });
          done.push({ ws: w.id, video: v.id, status: 'failed', error: msg });
        };
        try {
          if (fp.status === 'scheduled') {
            // Sent back to review (or rejected) before it started: it doesn't post.
            if (!['approved', 'posted'].includes(v.status)) { store.updateVideo(w.id, v.id, { fbpost: null }); continue; }
            if (Date.parse(fp.at) > now || started >= MAX_PER_DAY) continue;
            if (signoff.waiting(w, v)) continue;   // (v15) held until the compliance reviewer signs it off
            if (v.fileDeleted || !v.file) { fail('The video file was removed.'); continue; }
            started++;
            save({ ...fp, status: 'processing', phase: 'starting', startedAt: new Date(now).toISOString() });
          }
          // Part-way through (this tick, a retry, or after a restart): carry on from the saved step.
          if (fp.phase !== 'finished') {
            if (v.fileDeleted || !v.file) { fail('The video file was removed.'); continue; }
            await advance(w.id, v, acc, token, fp, save);
            done.push({ ws: w.id, video: v.id, status: 'processing' });
            continue;
          }
          const st = await call('GET', graph(fp.videoId), { fields: 'status,permalink_url', access_token: token });
          const s = st.status || {}, err = errorOf(s);
          if (s.publishing_phase?.status === 'complete' || (s.video_status === 'ready' && !s.publishing_phase)) {
            const at = new Date(now).toISOString();
            const url = st.permalink_url ? (/^https:\/\//.test(st.permalink_url) ? st.permalink_url : `https://www.facebook.com${st.permalink_url.startsWith('/') ? '' : '/'}${st.permalink_url}`) : '';
            const fresh = store.getVideo(w.id, v.id);
            store.updateVideo(w.id, v.id, {
              fbpost: { ...fp, status: 'posted', postedAt: at, url },
              ...(fresh?.status === 'approved' ? { status: 'posted', posted: { at, by: 'facebook', url, auto: true } } : {}),
            });
            done.push({ ws: w.id, video: v.id, status: 'posted' });
          } else if (err || s.video_status === 'error') fail(`Facebook couldn’t process the video${err?.error?.message ? ` (${String(err.error.message).slice(0, 120)})` : ''}.`);
          else if (now - Date.parse(fp.finishedAt || fp.startedAt) > PROCESS_LIMIT_MS) fail('Facebook hasn’t finished publishing it after 30 minutes. Check your Page before posting it again: it may still appear.');
        } catch (e) {
          if (e.code === 190) {
            updateJSON(accFile(w.id), {}, x => ({ ...x, problem: 'reconnect' }));
            notify({ level: 'warning', kind: 'facebook', title: 'Facebook needs to be connected again', text: 'Facebook stopped accepting posts from this connection.', did: 'Paused cross-posting for this workspace.', run: 'Ask the agent to connect Facebook again in Setup → Autopilot.', ws: w.id, workspaceName: w.name });
            fail('Facebook needs to be connected again in Setup → Autopilot.'); break;
          }
          const attempts = (fp.attempts || 0) + 1;
          // Facebook not answering: the post waits without using up its tries. Nothing made on Facebook yet:
          // it goes back to waiting for its turn (and is called off two hours after its time). Part-way:
          // it carries on from its step (the 30-minute limit still applies).
          if (breaker.isServiceFailure(e)) {
            if (fp.status === 'scheduled' || fp.phase === 'starting') {
              if (now - Date.parse(fp.at) > 2 * 3600000) fail('Facebook wasn’t answering for two hours after its time, so it wasn’t posted. Post it again when you like.');
              else if (fp.phase === 'starting') { save({ ...fp, status: 'scheduled', phase: undefined, startedAt: undefined }); started = Math.max(0, started - 1); }   // never went out: not counted toward today's cap
            } else if (now - Date.parse(fp.finishedAt || fp.startedAt || 0) > PROCESS_LIMIT_MS) fail('Facebook stopped answering while it posted the video. Check your Page before posting it again: it may still appear.');
            continue;
          }
          if (!e.retry || attempts >= 3) { fail(e.message); continue; }
          // Nothing exists on Facebook yet: start again later. Otherwise carry on from the saved step.
          if (fp.phase === 'starting') { save({ ...fp, status: 'scheduled', phase: undefined, startedAt: undefined, attempts }); started = Math.max(0, started - 1); }
          else save({ ...fp, attempts });
        }
      }
    } catch (e) { store.skipWorkspace(w, e, 'facebook-posting'); } }
  } finally {
    busy = false;
    // Down for everyone with work this minute (and nobody got through): that counts toward the breaker.
    const h = tickHealth; tickHealth = null;
    if (h?.worked) breaker.success('facebook');
    else if (h?.down) breaker.failure('facebook', h.last);
    else breaker.release('facebook');
  }
  return done;
}
