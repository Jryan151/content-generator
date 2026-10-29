// server.js — runs the product: logins, each agent's workspace, the job queue and the portal.
// Start:  pm2 start server.js --name generator      (nginx handles HTTPS in front of it)
// Listens on 127.0.0.1 only.
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import { ROOT, DIRS, PUBLIC_URL, PRODUCT_NAME, monthKey, storageEngine, localTime, onDamage } from './lib/paths.js';
import * as store from './lib/store.js';
import * as auth from './lib/auth.js';
import * as allowance from './lib/allowance.js';
import * as usage from './lib/usage.js';
import * as queue from './lib/queue.js';
import { startScheduler, maintenanceState, saveMaintenance, KEEP, freeGB, diskGate } from './lib/scheduler.js';
import * as alerts from './lib/alerts.js';
import * as ig from './lib/instagram.js';
import * as fb from './lib/facebook.js';
import * as secrets from './lib/secrets.js';
import * as mc from './mindset-core.js';
import * as trackLinks from './lib/links.js';
import * as data from './lib/data.js';
import * as twofa from './lib/twofa.js';
import * as audit from './lib/audit.js';
import * as offsite from './lib/offsite.js';
import * as monitor from './lib/monitor.js';
import * as ai from './lib/ai.js';
import { currentSignal } from './lib/proc.js';
import { onShapeProblem } from './lib/shapes.js';
import * as breaker from './lib/breaker.js';
import * as insights from './lib/insights.js';
import * as library from './lib/library.js';
import * as studio from './lib/studio.js';
import * as memory from './lib/memory.js';
import * as roles from './lib/roles.js';
import * as push from './lib/push.js';
import * as signoff from './lib/signoff.js';
import * as replies from './lib/replies.js';
import * as gauges from './lib/gauges.js';
import * as targets from './lib/targets.js';
import * as changes from './lib/changes.js';
import * as platforms from './lib/platforms.js';
import { engineBay, jobTimeline } from './lib/engine.js';
import { logoColors } from './lib/logocolors.js';
import { markRunning } from './lib/storage.js';
// Is the website process running (its pid file names a live process)?
import { answersFrom, draftConfig, personalize, stampFacts, confirmedCount } from './lib/onboarding.js';
import { buildPrompt } from './lib/prompts.js';
import { migrate, whyNoVideos, FORMATS, boostsFrom, tasteFrom, AI_VOICE_NOTE, DEFAULT_CONFIG, winnersFrom, rejectionSummary, needsResults, roll, applySuggestionTo, usableRoutes, insightStatus, checkInsightText, styleCalibration, gaps, runningLow, bestPostingHour, weekdayIn, studioPicks, studioChecks, suggestAccent, nicheOf, okBookingUrl, shortReason, hiddenNote, beatPlan, lineProblems, localDates, weekdayOfDate } from './mixer-core.js';
// The routes, by area (routes/*.js): mounted at the end of this file, once everything they use exists.
import mount_public from './routes/public.js';
import mount_account from './routes/account.js';
import mount_setup from './routes/setup.js';
import mount_scripts from './routes/scripts.js';
import mount_mindset from './routes/mindset.js';
import mount_content from './routes/content.js';
import mount_studio from './routes/studio.js';
import mount_videos from './routes/videos.js';
import mount_brand from './routes/brand.js';
import mount_social from './routes/social.js';
import mount_admin from './routes/admin.js';
import mount_people from './routes/people.js';
import mount_signoff from './routes/signoff.js';
import mount_replies from './routes/replies.js';

export const VERSION = '16.0.0';
const SECURE = PUBLIC_URL.startsWith('https://');
const TESTS_PER_DAY = Number(process.env.SCRIPT_TESTS_PER_DAY || 30);
const MAX_PER_REQUEST = 3;
export const CHECKLIST = [
  ['watched', 'I watched the whole video, with sound'],
  ['footage', 'The footage fits and is respectful'],
  ['facts', 'Every claim is true for the products I sell'],
  ['rules', 'It follows my carriers’ and my state’s advertising rules'],
];
// Shown next to the Approve button and kept on every approval record. The app checks scripts for
// compliance; it doesn't make them compliant. The agent signs off, and carriers or states may review too.
export const APPROVAL_NOTE = 'You stay responsible for final approval of this video and for any review your carriers or state require.';
// Each reason points at the part of the system that missed, so patterns show what to fix.
export const REJECT_REASONS = ['Weak opening', 'Wrong footage', 'Wrong music', 'Too salesy', 'Not accurate', 'Not my voice', 'Other'];

/* ---------------- Helpers ---------------- */
class HttpError extends Error { constructor(code, msg, data = {}) { super(msg); this.code = code; this.data = data; } }
const bad = (code, msg, data) => { throw new HttpError(code, msg, data); };
// Errors written for people pass through; anything that reads like the inside of the code (a file
// path, "Cannot read properties…", a system error code) becomes one plain sentence. The real text is
// in the server log (and a video's log).
const TECHNICAL = /ENOENT|EACCES|EPERM|EISDIR|EMFILE|Cannot read|Cannot set|undefined|is not a function|is not defined|is not iterable|Unexpected token|SyntaxError|TypeError|RangeError|SQLITE|\/(root|home|tmp|var|usr)\/|\.(js|mjs):\d|exit code|exit \d+|spawn|ffmpeg|ffprobe|Invalid data found|moov atom|stack/i;
export const plainError = msg => (!msg || TECHNICAL.test(String(msg)) ? 'Something went wrong on our side. Try again in a moment; if it keeps happening, tell your admin.' : String(msg));
const permanent = msg => Object.assign(new Error(msg), { permanent: true });
// A failure the agent already sees and can fix themselves (no plan, paused): no alert to the admin.
const quiet = msg => Object.assign(new Error(msg), { permanent: true, quiet: true });
// Spend guard (lib/usage.js): over its monthly AI cap, a workspace starts nothing that calls the AI.
const SPEND_TEXT = 'This month’s AI budget for your workspace is used up, so new videos, test scripts and the coach are paused until next month. Your admin can raise it.';
const overCap = ws => usage.spend(ws).over;
const spendGate = ws => { if (overCap(ws)) bad(402, SPEND_TEXT, { spend: true }); };
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const nowIso = () => new Date().toISOString();

// Security headers on every response. HSTS only when the site is on https (nginx may add it too).
const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  ...(SECURE ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://cdn.pixabay.com https://images.pexels.com; media-src 'self' blob: https://cdn.pixabay.com https://videos.pexels.com https://player.vimeo.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

// Every answer says which version of the server sent it, so a portal tab left open across an update
// knows to refresh (public/app.js APP_VERSION).
function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-App-Version': VERSION, ...BASE_HEADERS, ...headers });
  res.end(JSON.stringify(body));
}
function readRaw(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readBody(req) {
  const raw = await readRaw(req);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString('utf8')); } catch { bad(400, 'Body is not valid JSON'); }
}
const clientIp = req => req.headers['x-forwarded-for']?.split(',').pop().trim() || req.socket.remoteAddress;
const baseUrl = req => PUBLIC_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === new URL(baseUrl(req)).host; } catch { return false; }
}
const sha256File = file => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});
const slug = s => String(s || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'video';

// Files stream with Range support so phones can scrub and play videos.
function streamFile(req, res, file, type, disposition = '') {
  fs.stat(file, (err, st) => {
    if (err) return send(res, 404, { error: 'File not found' });
    const head = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', ...BASE_HEADERS, ...(disposition ? { 'Content-Disposition': disposition } : {}) };
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
      const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      if (start > end || start < 0) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { ...head, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}` });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...head, 'Content-Length': st.size });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    }
  });
}

/* ---------------- Who is asking ---------------- */
function who(req) {
  const s = auth.getSession(auth.sessionToken(auth.parseCookies(req.headers.cookie), SECURE));
  if (!s) return null;
  const account = store.getAccount(s.accountId);
  if (!account || account.disabled) return null;
  // Admins work in the workspace they opened. Everyone else in the one they switched to (if they still
  // belong to it), else their own.
  const mine = roles.membershipsOf(account);
  const wsId = account.role === 'admin' ? (s.ws && store.getWorkspace(s.ws) ? s.ws : null)
    : (s.ws && mine.some(m => m.ws === s.ws) && store.getWorkspace(s.ws) ? s.ws : mine.find(m => m.ws === account.workspaceId && store.getWorkspace(m.ws))?.ws || mine.find(m => store.getWorkspace(m.ws))?.ws || null);
  return { session: s, account, wsId };
}
const touched = new Map();
function touch(wsId) {
  if (Date.now() - (touched.get(wsId) || 0) < 3600000) return;
  touched.set(wsId, Date.now());
  store.updateWorkspace(wsId, { lastActiveAt: nowIso() });
}

/* ---------------- Workspace views ---------------- */
const usedThisMonth = wsId => usage.monthUsage(wsId).videos + queue.waiting(wsId).filter(j => j.kind === 'video' || (j.kind === 'studio' && !j.opts?.replace)).length;
// `caps`: what the viewer may do; deletion requests and data receipts are only for the agent.
function wsSummary(wsId, caps = null) {
  const ws = store.getWorkspace(wsId);
  if (!ws) return null;
  const out = wsSummaryAll(ws, wsId);
  if (!caps) return out;
  return { ...out, ...(caps.includes('data') ? {} : { deletionRequest: null, lastExport: null }) };
}
function wsSummaryAll(ws, wsId) {
  const access = allowance.access(ws);
  return {
    id: ws.id, name: ws.name, onboarded: ws.onboarded, suspended: ws.suspended, logo: store.hasLogo(wsId),
    timezone: store.loadConfig(wsId).profile?.timezone || 'America/Denver',   // (v15: the portal writes times in the agent's zone)
    access, used: usedThisMonth(wsId), limit: access.limit,
    pending: store.videoCounts(wsId).pending,
    deletionRequest: ws.deletionRequest ? { at: ws.deletionRequest.at, byName: ws.deletionRequest.byName } : null,
    lastExport: ws.lastExport || null,
    spend: (({ pct, warn, over }) => ({ pct, warn, over }))(usage.spend(ws)),   // percent of the AI cap, no dollar amounts
    // v15: approved videos wait for the compliance reviewer before they post.
    signoff: { required: signoff.required(ws), reviewer: signoff.reviewersOf(wsId).map(a => a.name || a.email)[0] || '' },
  };
}
const jobView = j => ({
  id: j.id, kind: j.kind, status: j.status, source: j.source, createdAt: j.createdAt, startedAt: j.startedAt, endedAt: j.endedAt,
  error: j.error ? plainError(j.error) : j.error, attempts: j.attempts, videoId: j.result?.videoId || j.opts?.videoId || null, draftId: j.opts?.draftId || null,
  topic: j.opts?.force?.painId || null,
  log: ['running', 'failed'].includes(j.status) ? j.log.slice(-15).map(l => (TECHNICAL.test(l) ? 'Something went wrong in this step; it’s in the server log.' : l)) : [],
  position: j.status === 'queued' ? queue.position(j) : undefined,
  waitUntil: j.status === 'queued' && j.notBefore ? j.notBefore : undefined, waitReason: j.status === 'queued' ? j.waitReason || '' : undefined,
  phase: j.status === 'running' ? phaseOf(j.log) : null,
});
// Where a running job really is: the last "[2/4] Finding footage…" step it logged, and whether it's
// on a second try. Shown instead of a spinner that says nothing.
export function phaseOf(log = []) {
  let at = -1, m = null;
  log.forEach((l, i) => { const x = /^\[(\d+)\/(\d+)\] (.+)$/.exec(l); if (x) { at = i; m = x; } });
  const retry = log.some(l => l === 'Trying once more…');
  if (!m) return { step: 0, of: 0, label: log.some(l => l.startsWith('Rendering')) ? 'Rendering…' : 'Getting started…', retry };
  return { step: Number(m[1]), of: Number(m[2]), label: m[3], retry, note: log.slice(at + 1).filter(l => /didn’t|couldn’t|failed|again|another/i.test(l)).slice(-1)[0] || '' };
}
// How long this workspace's videos usually take (median of the last 10, in seconds), for "usually about".
export function typicalSeconds(jobs = []) {
  const d = jobs.filter(j => j.status === 'done' && j.kind !== 'fix' && j.startedAt && j.endedAt).slice(-10).map(j => (Date.parse(j.endedAt) - Date.parse(j.startedAt)) / 1000).filter(x => x > 0).sort((a, b) => a - b);
  return d.length >= 3 ? Math.round(d[Math.floor(d.length / 2)]) : null;
}
const videoView = v => ({
  ...v,
  clips: (v.clips || []).map(c => ({ query: c.query, checked: c.checked, score: c.score ?? null, reason: c.reason || '', spares: (c.alts || []).length })),
  media: v.fileDeleted || !v.file ? null : `/media/${v.file}`,
  coverUrl: v.cover && !v.fileDeleted ? `/media/${v.cover}` : null,
  trackUrl: trackLinks.urlFor(v.link),
  clicks: v.clicks ? { total: v.clicks.total || 0, last: v.clicks.last || '' } : { total: 0, last: '' },
});
function stats(vids) {
  const month = monthKey();
  const posted = vids.filter(v => v.status === 'posted');
  const group = (keyOf, labelOf) => {
    const m = new Map();
    for (const v of posted) {
      const k = keyOf(v); if (!k) continue;
      const g = m.get(k) || { key: k, label: labelOf(v, k), posted: 0, reported: 0, views: 0, messages: 0, clicks: 0 };
      g.posted++; g.clicks += v.clicks?.total || 0;
      if (v.results) { g.reported++; g.views += v.results.views || 0; g.messages += v.results.messages || 0; }
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.messages - a.messages || b.views - a.views || b.posted - a.posted);
  };
  return {
    month: {
      made: vids.filter(v => (v.createdAt || '').startsWith(month)).length,
      approved: vids.filter(v => (v.approval?.at || '').startsWith(month)).length,
      posted: posted.filter(v => (v.posted?.at || '').startsWith(month)).length,
    },
    totals: { posted: posted.length, views: posted.reduce((a, v) => a + (v.results?.views || 0), 0), messages: posted.reduce((a, v) => a + (v.results?.messages || 0), 0), clicks: vids.reduce((a, v) => a + (v.clicks?.total || 0), 0), clicksMonth: trackLinks.clicksSince(vids, month + '-01'), bookings: vids.reduce((a, v) => a + (v.bookings?.total || 0), 0) },
    topics: group(v => v.meta?.painId, v => v.meta?.painPoint || 'Unknown topic'),
    rejections: rejectionSummary(vids),
    needResults: needsResults(vids).map(v => v.id),
    formats: group(v => v.meta?.format, (v, k) => FORMATS[k]?.label || k),
  };
}

/* ---------------- Queue ---------------- */
// Every way of starting videos goes through here: plan, limits and setup are checked once.
export function enqueueVideos(wsId, n, source = 'manual', by = '', force = {}) {
  const ws = store.getWorkspace(wsId);
  const a = allowance.access(ws);
  if (!a.allowed) bad(402, a.reason);
  spendGate(ws);
  if (!ws.onboarded) bad(409, 'Finish setup first.');
  const why = whyNoVideos(store.loadConfig(wsId));
  if (why) bad(409, why.msg);
  const left = a.limit - usedThisMonth(wsId);
  if (left <= 0) bad(402, `You’ve used all ${a.limit} videos for this month.`);
  const jobs = [];
  for (let i = 0; i < Math.min(n, left); i++) {
    try { jobs.push(queue.enqueue({ ws: wsId, kind: 'video', opts: { force }, by, source })); }
    catch (e) { if (!jobs.length) bad(429, e.message); break; }
  }
  return jobs;
}
// "Your video is ready", with its opening line and cover. Overnight videos stay quiet (they're waiting in
// Review in the morning), and quiet hours apply.
export async function notifyReady(job, result, { now = new Date() } = {}) {
  if (job.source === 'overnight' || !result?.videoId) return null;
  const v = store.getVideo(job.ws, result.videoId);
  if (!v || !push.list(job.ws).length) return null;
  const cfg = store.loadConfig(job.ws);
  return push.send(job.ws, {
    title: job.kind === 'fix' ? 'Your fixed video is ready' : 'A new video is ready to review',
    // Tapping it opens that exact video (#/review/<id>); the video itself is fetched ahead by sw.js.
    body: String(v.scenes?.[0]?.text || '').slice(0, 140), url: `/#/review/${v.id}`, tag: `video-${v.id}`,
    ...(v.cover ? { image: `/media/${v.cover}` } : {}), ...(v.file && !v.fileDeleted ? { media: `/media/${v.file}` } : {}),
  }, { tz: cfg.profile?.timezone || 'America/Denver', now, daysOff: cfg.profile?.daysOff || [], accountIds: ownersOf(job.ws) });   // the agent approves, so it's for them
}
export async function runJob(job, log) {
  const ws = store.getWorkspace(job.ws);
  if (!ws) throw quiet('This workspace no longer exists.');
  const a = allowance.access(ws);
  if (!a.allowed) throw quiet(a.reason);
  if (overCap(ws)) throw quiet(SPEND_TEXT);   // you were already alerted when the cap was reached
  const { makeVideo, fixVideo } = await import('./pipeline.js');
  if (job.kind === 'studio') {
    const d = studio.get(job.ws, job.opts.draftId);
    if (!d) throw quiet('That Studio draft was deleted.');
    if (!ws.onboarded) throw quiet('Finish setup first.');
    // The brief and scenes as they were when Render was tapped (and checked), not as edited since.
    const built = job.opts.scenes ? { ...d, brief: job.opts.brief, scenes: job.opts.scenes, notes: job.opts.notes || [] } : d;
    try {
      const v = await makeVideo({ ws: job.ws, studio: built, source: 'studio', log, checkpoint: jobDir(job), limp: true, replace: job.opts.replace || '', by: job.by || '' });
      studio.save(job.ws, d.id, { status: 'done', videoId: v.id, error: '' });
      return { videoId: v.id };
    } catch (e) {
      // A failure that will be tried again keeps the draft locked; only the last one frees it. A try the
      // watchdog gave up on leaves the draft alone (the next try, or the job's status, decides it).
      const last = e.permanent || (job.attempts >= queue.MAX_ATTEMPTS && !(queue.isOutage(e) && (job.waits || 0) < queue.MAX_OUTAGE_WAITS));
      if (last && !currentSignal()?.aborted) studio.save(job.ws, d.id, { status: 'draft', error: plainError(e.message) });
      throw e;
    }
  }
  if (job.kind === 'fix') {
    const v = await fixVideo({ ws: job.ws, videoId: job.opts.videoId, edits: job.opts.edits || [], swaps: job.opts.swaps || [], picks: job.opts.picks || {}, by: job.by, log });
    return { videoId: v.id };
  }
  const v = await makeVideo({ ws: job.ws, force: job.opts.force || {}, source: job.source, log, checkpoint: jobDir(job), limp: true });
  return { videoId: v.id };
}
// Where a job keeps its finished stages between tries (pipeline.js makeVideo).
export const jobDir = job => path.join(DIRS.work, `job-${job.id}`);
// Being fixed, or a new version of it is being made from its Studio draft (v15): either way, wait for it.
const fixing = (wsId, vid) => queue.waiting(wsId).some(j => (j.kind === 'fix' && j.opts.videoId === vid) || (j.kind === 'studio' && j.opts.replace === vid));

/* ---------------- Routes ---------------- */
const routes = [];
// opts.raw: the route reads the request body itself (file uploads) instead of it being parsed as JSON.
const route = (method, pattern, level, fn, opts = {}) => routes.push({ method, pattern, level, fn, raw: !!opts.raw, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[\\w.-]+)') + '$') });
const ipLimit = auth.limiter({ max: 30, windowMs: 15 * 60000 });
const emailLimit = auth.limiter({ max: 8, windowMs: 15 * 60000 });
const draftLimit = auth.limiter({ max: 10, windowMs: 60 * 60000 });
const linkError = 'This link has expired or was already used. Ask for a new one.';
// Two-factor: after the password, a short-lived ticket (in memory, 5 minutes, 5 tries) stands in
// for the account until the code is checked.
const tickets = new Map();
const twofaLimit = auth.limiter({ max: 8, windowMs: 15 * 60000 });
function newTicket(accountId) {
  const now = Date.now();
  for (const [k, v] of tickets) if (v.exp < now) tickets.delete(k);
  const ticket = auth.newToken();
  tickets.set(ticket, { accountId, exp: now + 5 * 60000, tries: 0 });
  return ticket;
}
// A new login: the session cookie, remembering the device. Admin sessions are shorter (ADMIN_SESSION_DAYS).
function startSession(req, res, acc, how = 'password') {
  audit.record({ action: 'login.ok', who: acc, ws: acc.workspaceId || '', detail: how, ip: clientIp(req) });
  const days = acc.role === 'admin' ? auth.ADMIN_SESSION_DAYS() : auth.SESSION_DAYS;
  const token = auth.createSession(acc.id, { days, ua: req.headers['user-agent'], ip: clientIp(req) });
  res.setHeader('Set-Cookie', auth.sessionCookie(token, SECURE, days));
  // Remembers the device and rough network, so Account can list where this login is used.
  const device = auth.deviceName(req.headers['user-agent']), ip = clientIp(req), seen = deviceKey(device, ip);
  const known = Array.isArray(acc.knownDevices) ? acc.knownDevices : [];
  store.updateAccount(acc.id, { lastLoginAt: nowIso(), knownDevices: [seen, ...known.filter(k => k !== seen)].slice(0, 20) });
  return token;
}
// Device + rough network (IPv4 /16, IPv6 /48), so a phone moving between cell towers isn't "new".
function deviceKey(device, ip) {
  const v = String(ip || '').replace(/^::ffff:/, '');
  const net = v.includes(':') ? v.split(':').slice(0, 3).join(':') : v.split('.').slice(0, 2).join('.');
  return crypto.createHash('sha256').update(`${device}|${net}`).digest('hex').slice(0, 16);
}
// An invite into a workspace that has since been deleted.
const orphanInvite = t => t.kind === 'invite' && t.role !== 'admin' && !!t.workspaceId && !store.getWorkspace(t.workspaceId);
const validTz = tz => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return 'America/Denver'; } };

/* ---------------- Helpers the routes share with the rest of the server ---------------- */
/* ---------------- Terms of service and privacy policy ---------------- */
// On when TERMS_URL and PRIVACY_URL are both set. Agents accept TERMS_VERSION once, at invite-accept
// or in setup; changing TERMS_VERSION asks everyone again. Admins run the service, so they're never asked.
const goodUrl = u => (/^https?:\/\/[^\s"<>]+$/i.test(String(u || '').trim()) ? String(u).trim() : '');
export function terms() {
  const termsUrl = goodUrl(process.env.TERMS_URL), privacyUrl = goodUrl(process.env.PRIVACY_URL);
  return { on: !!(termsUrl && privacyUrl), version: clip(process.env.TERMS_VERSION || '1', 40) || '1', termsUrl, privacyUrl };
}
export const needsTerms = acc => { const t = terms(); return t.on && !!acc && acc.role !== 'admin' && acc.termsVersion !== t.version; };
const termsStamp = () => ({ termsVersion: terms().version, acceptedAt: nowIso() });
const TERMS_TEXT = 'Please read and accept the Terms of Service and Privacy Policy to continue.';
// Routes an agent can still use before accepting new terms: finishing setup (which has its own checkbox),
// and downloading their data or asking for it to be deleted (someone who won't accept can still leave).
const TERMS_FREE = /^\/api\/(setup|data)(\/|$)/;

// One plain line per thing that's paused or down right now, for the people it affects (no error codes,
// no service names they don't know): the portal shows them under the tabs.
export function noticesFor(ws, caps = []) {
  if (!ws) return [];
  const out = [], open = new Set(breaker.status().filter(b => b.open).map(b => b.id));
  const add = (id, text) => out.push({ id, text });
  if (open.has('openai') && !(ai.ladder('writer').some(r => r.provider !== 'openai' && !open.has(r.provider)))) add('ai', 'New videos are slower right now: the writing service isn’t answering. Videos in line wait and finish by themselves.');
  else if (open.has('pixabay') && (open.has('pexels') || !process.env.PEXELS_API_KEY)) add('footage', 'New videos are slower right now: the stock footage sites aren’t answering. Videos in line wait and finish by themselves.');
  if (caps.includes('post')) {
    if (open.has('instagram') && ig.account(ws.id).connected) add('instagram', 'Instagram isn’t answering right now. Scheduled posts go out by themselves when it’s back.');
    if (open.has('facebook') && fb.account(ws.id).connected) add('facebook', 'Facebook isn’t answering right now. Scheduled posts go out by themselves when it’s back.');
  }
  return out;
}

// The coach: answers questions about content and prompts, with suggestions the user can apply.
// Every coach call (questions, rewrites, replies, check-ins) counts toward one daily limit.
const coachLimit = auth.limiter({ max: Number(process.env.COACH_PER_DAY || 60), windowMs: 24 * 3600000 });
function coachGate(wsId, ws) {
  const a = allowance.access(ws);
  if (!a.allowed) bad(402, a.reason);
  spendGate(ws);
  if (coachLimit.blocked(wsId)) bad(429, 'That’s a lot of coaching for one day. The coach is back tomorrow.');
  coachLimit.fail(wsId);
}
const coach = () => import('./lib/coach.js');
// The config to coach on: unsaved edits from the portal if sent (facts re-stamped), else the saved one.
const workingConfig = (wsId, body, me) => (body.config ? stampFacts(store.loadConfig(wsId), migrate(body.config), me.account.id) : store.loadConfig(wsId));

/* ----- Mindset: the agent working on themselves, and the parts that shape their videos ----- */
const mindset = () => import('./lib/mindset.js');
const todayFor = cfg => mc.dayKey(Date.now(), cfg.profile?.timezone || 'America/Denver');
// A draft's picks, with the agent's recent videos so the "too close to a recent opening" check runs (not
// counting the draft's own video: a new version isn't too close to the one it replaces).
const draftPicks = (wsId, cfg, d) => ({ ...studioPicks(cfg, d.brief), recent: store.readRecent(wsId).filter(r => !d.videoId || r.videoId !== d.videoId) });
// The draft's config: the workspace's, sized to the draft's scene count.
const draftCfg = (cfg, d) => ({ ...cfg, output: { ...cfg.output, scenes: d.scenes.length || studioPicks(cfg, d.brief).scenes } });
/* ----- Videos ----- */
const getV = (wsId, id) => store.getVideo(wsId, id) || bad(404, 'Video not found.');
/* ----- People: the compliance reviewer's invites ----- */
// Pending invites, one per email (the newest), for people who aren't in the workspace yet.
function pendingInvites(wsId, role = 'reviewer') {
  const live = auth.listLinks().filter(t => t.kind === 'invite' && t.wsRole === role && t.workspaceId === wsId && !t.usedAt && t.expiresAt > Date.now())
    .filter(t => !roles.isMember(store.findAccountByEmail(t.email), wsId)).sort((a, b) => b.createdAt - a.createdAt);
  return live.filter((t, i) => live.findIndex(x => x.email === t.email) === i);
}
// Room for one more reviewer (an invite already out for this email doesn't count twice)?
const reviewerRoom = (wsId, email = '') => signoff.reviewersOf(wsId).length + pendingInvites(wsId).filter(t => t.email !== store.normEmail(email)).length < signoff.MAX_REVIEWERS;
const ownersOf = wsId => store.listAccounts().filter(a => !a.disabled && roles.membership(a, wsId)?.role === 'owner').map(a => a.id);

/* ---------------- Capabilities: what each workspace route needs ---------------- */
// Reading is `view` unless listed; every change must be listed (a test checks none is missing). A list
// means any one of those will do (a reviewer turning on notifications).
const ROUTE_CAPS = {
  'GET /api/data/export': 'data', 'POST /api/data/delete-request': 'data', 'DELETE /api/data/delete-request': 'data',
  'PUT /api/config': 'settings', 'GET /api/history/:name': 'settings', 'POST /api/prompt-preview': 'settings',
  'GET /api/setup': 'setup', 'POST /api/setup/draft': 'setup', 'POST /api/setup/finish': 'setup',
  'POST /api/script': 'make', 'POST /api/footage-test': 'make', 'POST /api/coach/rewrite': 'make',
  'POST /api/coach': 'coach', 'POST /api/comms/workshop': 'coach', 'POST /api/coach/try': 'coach', 'GET /api/coach/notes': 'coach', 'POST /api/coach/notes': 'coach', 'DELETE /api/coach/notes/:id': 'coach', 'POST /api/coach/weekly': 'coach',
  'POST /api/coach/plan/skip': 'make', 'POST /api/coach/plan': 'make',
  'POST /api/coach/reply': 'replies', 'GET /api/comms/calibration': 'replies',
  'GET /api/mindset': 'mindset', 'PUT /api/mindset': 'mindset', 'POST /api/mindset/check': 'mindset', 'POST /api/mindset/principle': 'mindset', 'POST /api/mindset/practice': 'mindset', 'DELETE /api/mindset/practice/:id': 'mindset', 'POST /api/mindset/audit': 'mindset', 'POST /api/mindset/audit/advice': 'mindset', 'POST /api/mindset/reflection': 'mindset', 'POST /api/mindset/lens': 'mindset',
  'GET /api/studio': 'make', 'GET /api/studio/:id': 'make', 'POST /api/studio': 'make', 'PUT /api/studio/:id': 'make', 'DELETE /api/studio/:id': 'make', 'POST /api/studio/:id/hooks': 'make', 'POST /api/studio/:id/fill': 'make', 'POST /api/studio/:id/rewrite': 'make', 'POST /api/studio/:id/ideas': 'make', 'POST /api/studio/:id/footage': 'make', 'POST /api/studio/:id/voice': 'make', 'POST /api/studio/:id/render': 'make', 'POST /api/spell': 'make',
  'POST /api/jobs': 'make', 'DELETE /api/jobs/:id': 'make', 'POST /api/videos/:id/fix': 'make', 'POST /api/videos/:id/clips': 'make', 'POST /api/videos/:id/cover': 'make',
  'POST /api/videos/:id/approve': 'approve', 'POST /api/videos/:id/reject': 'approve', 'POST /api/videos/:id/reopen': 'approve', 'DELETE /api/videos/:id': 'approve',
  'POST /api/videos/:id/posted': 'post', 'POST /api/videos/:id/autopost': 'post', 'DELETE /api/videos/:id/autopost': 'post', 'POST /api/videos/:id/facebook': 'post', 'DELETE /api/videos/:id/facebook': 'post', 'GET /api/videos/:id/facebook-text': 'post',
  'POST /api/videos/:id/results': 'results', 'GET /api/records.csv': 'data', 'GET /api/records.html': 'data', 'POST /api/videos/:id/message': 'results',
  'POST /api/memory/forget': 'settings',
  'POST /api/push/subscribe': ['view', 'signoff'], 'POST /api/push/unsubscribe': ['view', 'signoff'], 'POST /api/push/test': ['view', 'signoff'], 'GET /api/push': ['view', 'signoff'],
  'POST /api/brand/logo': 'settings', 'DELETE /api/brand/logo': 'settings', 'GET /api/brand/logo-colors': 'settings',
  'POST /api/library': 'settings', 'POST /api/library/:id': 'settings', 'DELETE /api/library/:id': 'settings',
  'POST /api/instagram/connect': 'connect', 'DELETE /api/instagram': 'connect', 'POST /api/facebook/connect': 'connect', 'POST /api/facebook/page': 'connect', 'DELETE /api/facebook': 'connect',
  'GET /api/replies': 'replies', 'POST /api/replies/rules': 'replies', 'POST /api/replies/rules/:id/approve': 'approve', 'DELETE /api/replies/rules/:id': 'replies', 'POST /api/replies/on': 'approve', 'POST /api/replies/try': 'replies',
  'GET /api/people': 'people', 'POST /api/people/signoff': 'people', 'POST /api/people/invite': 'people', 'DELETE /api/people/:id': 'people', 'POST /api/people/invites/revoke': 'people',
  // The compliance reviewer's page (v15): theirs alone.
  'GET /api/signoff': 'signoff', 'POST /api/signoff/:id': 'signoff',
};
export const capFor = r => ROUTE_CAPS[`${r.method} ${r.pattern}`] || (r.method === 'GET' ? 'view' : null);
export const deadCaps = () => Object.keys(ROUTE_CAPS).filter(k => !routes.some(r => `${r.method} ${r.pattern}` === k));
export const unlistedRoutes = () => routes.filter(r => r.level === 'ws' && r.method !== 'GET' && !ROUTE_CAPS[`${r.method} ${r.pattern}`]).map(r => `${r.method} ${r.pattern}`);
const CAP_DENIED = {
  settings: () => 'Only the agent can change this.',
  approve: () => 'Only the agent can approve, reject or delete videos. You can fix a scene and leave it for them.',
  post: () => 'Posting is up to the agent. They can let you post under Your team.',
  mindset: () => 'Mindset is the agent’s own page.',
  data: () => 'Only the agent can download or delete the workspace’s data.',
  people: () => 'Only the agent can invite or remove people.',
  connect: () => 'Only the agent can connect Instagram and Facebook.',
};

/* ---------------- Audit log: what gets recorded after a route succeeds ---------------- */
// A string is the action; a function returns { action, target, detail, ws } (or null to skip).
// Logins, failed logins and 2FA are recorded where they happen (see startSession and the login routes).
const emailOf = id => store.getAccount(id)?.email || id;
const AUDIT = {
  'POST /api/logout': c => (c.me ? { action: 'logout', ws: c.me.account.workspaceId || '' } : null),
  'POST /api/terms/accept': () => (terms().on ? { action: 'terms.accepted', detail: `version ${terms().version}` } : null),
  'POST /api/account/password': 'password.changed',
  'POST /api/2fa/enable': 'twofa.on', 'POST /api/2fa/disable': 'twofa.off', 'POST /api/2fa/backup-codes': 'twofa.codes',
  'POST /api/account/sessions/logout-others': 'session.others',
  'DELETE /api/account/sessions/:id': c => ({ action: 'session.ended', target: c.params.id }),
  'GET /api/data/export': 'data.exported',
  'POST /api/data/delete-request': c => ({ action: 'deletion.requested', detail: clip(c.body.note, 200) }),
  'DELETE /api/data/delete-request': 'deletion.canceled',
  'PUT /api/config': 'settings.saved',
  'POST /api/setup/finish': c => ({ action: 'setup.finished', detail: c.body.acceptTerms ? `accepted terms version ${terms().version}` : '' }),
  'POST /api/videos/:id/approve': c => ({ action: 'video.approved', target: c.params.id }),
  'POST /api/videos/:id/reject': c => ({ action: 'video.rejected', target: c.params.id, detail: REJECT_REASONS.includes(c.body.reason) ? c.body.reason : 'Other' }),
  'POST /api/videos/:id/reopen': c => ({ action: 'video.reopened', target: c.params.id }),
  'POST /api/videos/:id/posted': c => ({ action: 'video.posted', target: c.params.id, detail: clip(c.body.url, 200) }),
  'DELETE /api/videos/:id': c => ({ action: 'video.deleted', target: c.params.id }),
  'GET /api/records.csv': { action: 'records.exported', detail: 'spreadsheet (CSV)' },
  'GET /api/records.html': { action: 'records.exported', detail: 'HTML' },
  'GET /api/videos/:id/receipt.html': c => ({ action: 'records.exported', target: c.params.id, detail: 'receipt' }),
  'POST /api/videos/:id/cover': c => ({ action: 'video.cover', target: c.params.id }),
  'DELETE /api/instagram': 'instagram.disconnected',
  'DELETE /api/facebook': 'facebook.disconnected',
  'POST /api/facebook/page': 'facebook.connected',
  'POST /api/admin/invite': (c, out) => ({ action: 'invite.created', target: store.normEmail(c.body.email), ws: out?.workspaceId || '', detail: c.body.role === 'admin' ? 'admin' : '' }),
  'POST /api/admin/reset': c => ({ action: 'reset.created', target: emailOf(c.body.accountId) }),
  'POST /api/admin/accounts/:id': c => ({ action: c.body.disabled ? 'account.disabled' : 'account.enabled', target: emailOf(c.params.id), ws: store.getAccount(c.params.id)?.workspaceId || '' }),
  'POST /api/admin/accounts/:id/reset-2fa': c => ({ action: 'twofa.reset', target: emailOf(c.params.id), ws: store.getAccount(c.params.id)?.workspaceId || '' }),
  'POST /api/admin/open': c => (c.body.workspaceId ? { action: 'admin.open', ws: c.body.workspaceId } : { action: 'admin.leave', ws: c.me.wsId || '' }),
  'POST /api/admin/workspaces/:id': c => ({ action: 'workspace.changed', ws: c.params.id, detail: Object.entries(c.body).filter(([k]) => ['name', 'suspended', 'videosPerMonth', 'aiCostUsd'].includes(k)).map(([k, v]) => `${k}: ${clip(v, 60)}`).join(', ') }),
  'POST /api/admin/workspaces/:id/delete': (c, out) => ({ action: 'workspace.deleted', ws: c.params.id, target: out?.deleted?.name || '', detail: `${out?.deleted?.logins ?? 0} login(s), ${out?.deleted?.videos ?? 0} video record(s)` }),
  'DELETE /api/admin/workspaces/:id/delete-request': c => ({ action: 'deletion.declined', ws: c.params.id }),
  'POST /api/videos/:id/fix': c => ({ action: 'video.fixed', target: c.params.id }),
  'POST /api/people/invite': c => ({ action: 'people.invited', target: store.normEmail(c.body.email), detail: 'reviewer' }),
  'DELETE /api/people/:id': c => ({ action: 'people.removed', target: emailOf(c.params.id) }),
  'POST /api/people/invites/revoke': c => ({ action: 'people.uninvited', target: store.normEmail(c.body.email) }),
  'POST /api/signoff/:id': c => ({ action: c.body.ok === true ? 'video.signedoff' : 'video.sentback', target: c.params.id, detail: clip(c.body.note, 120) }),
  'POST /api/people/signoff': c => ({ action: c.body.on ? 'signoff.on' : 'signoff.off' }),
  'POST /api/replies/rules': c => ({ action: 'replies.saved', detail: clip(c.body.keyword, 20) }),
  'POST /api/replies/rules/:id/approve': c => ({ action: 'replies.approved', target: c.params.id }),
  'POST /api/replies/on': c => ({ action: c.body.on ? 'replies.on' : 'replies.off' }),
  'POST /api/workspaces/switch': c => ({ action: 'workspace.switched', ws: clip(c.body.workspaceId, 40) }),
};

/* ---------------- Dispatch ---------------- */
// What someone who must set up two-factor login can still reach before they have.
const TWOFA_FREE = /^\/api\/(2fa|logout|account\/sessions|account\/password)(\/|$)/;
async function api(req, res, url) {
  const r = routes.find(x => (x.method === req.method || (req.method === 'HEAD' && x.method === 'GET')) && x.re.test(url.pathname));
  if (!r) bad(404, 'Unknown API route');
  if (!['GET', 'HEAD'].includes(req.method)) {
    if (!sameOrigin(req)) bad(403, 'Blocked: this request came from another site.');
    if (!r.raw && req.method !== 'DELETE' && !/^application\/json\b/.test(req.headers['content-type'] || '')) bad(415, 'Send JSON.');
  }
  const body = !r.raw && ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
  const ctx = { req, res, url, body, params: url.pathname.match(r.re).groups || {}, me: who(req) };
  if (r.level !== 'public') {
    if (!ctx.me) bad(401, 'Please log in.');
    if (twofa.needsSetup(ctx.me.account) && !TWOFA_FREE.test(url.pathname)) bad(403, 'Set up two-factor login to continue.', { twofaSetup: true });
    if (r.level === 'admin' && ctx.me.account.role !== 'admin') bad(403, 'Admins only.');
    if (r.level === 'ws') {
      if (!ctx.me.wsId) bad(409, ctx.me.account.role === 'admin' ? 'Open a workspace from Admin first.' : 'Your account has no workspace.');
      if (needsTerms(ctx.me.account) && !TERMS_FREE.test(url.pathname)) bad(403, TERMS_TEXT, { terms: true });
      ctx.wsId = ctx.me.wsId; ctx.ws = store.getWorkspace(ctx.wsId);
      // A page loaded for one workspace never acts on another (after a switch in another tab).
      const want = req.headers['x-workspace'] || url.searchParams.get('ws');
      if (want && want !== ctx.wsId) bad(409, 'You switched workspaces in another tab. Reload this page to keep going.', { wsChanged: true });
      // What this person may do here (lib/roles.js); every workspace route names what it needs.
      ctx.caps = roles.capsFor(ctx.me.account, ctx.ws);
      const need = capFor(r);
      const needs = [].concat(need);
      if (!needs.some(n => ctx.caps.includes(n))) bad(403, CAP_DENIED[needs[0]]?.(ctx) || 'You don’t have access to this in this workspace.', { cap: needs[0] });
      touch(ctx.wsId);
    }
  }
  // One-time keys: the portal sends an Idempotency-Key with every change. The same key again (a double
  // tap, or a resend on a weak signal) gets the first answer instead of doing it twice.
  const once = onceKey(req, r, ctx, url);
  if (once) {
    let hit = ONCE.get(once);
    if (hit && Date.now() - hit.at > ONCE_MS) { ONCE.delete(once); hit = null; }
    if (hit) {
      const v = await hit.p;
      if (v.error) throw v.error;
      if (!res.headersSent) { res.setHeader('Idempotent-Replay', 'true'); send(res, 200, v.out); }
      return;
    }
  }
  let settle = null;
  if (once) { pruneOnce(); ONCE.set(once, { at: Date.now(), p: new Promise(resolve => { settle = resolve; }) }); }
  let out;
  try { out = await r.fn(ctx); }
  catch (e) {
    // A refusal is the answer to repeat; a "try again" (busy, an outage, a crash) isn't kept.
    if (settle) { settle({ error: e }); if (!(e instanceof HttpError) || e.code === 429 || e.code >= 500) ONCE.delete(once); }
    throw e;
  }
  settle?.({ out: out === undefined ? { ok: true } : out });
  const spec = AUDIT[`${r.method} ${r.pattern}`];
  if (spec) {
    const e = typeof spec === 'function' ? spec(ctx, out) : typeof spec === 'string' ? { action: spec } : spec;
    if (e) audit.record({ who: ctx.me?.account || null, ws: ctx.wsId || ctx.me?.wsId || '', ip: clientIp(req), ...e });
  }
  if (out !== undefined && !res.headersSent) send(res, 200, out);
}

// One-time keys (Idempotency-Key): remembered for 10 minutes per person and route. Not for file uploads
// (raw routes) or logins, whose own checks cover a second try.
const ONCE = new Map(), ONCE_MS = 10 * 60000;
function onceKey(req, r, ctx, url) {
  const k = req.headers['idempotency-key'];
  if (!k || ['GET', 'HEAD'].includes(req.method) || r.raw || !/^[\w-]{8,100}$/.test(String(k))) return '';
  if (/^\/api\/(login|logout|twofa\/verify)\b/.test(url.pathname)) return '';
  return `${ctx.me?.account?.id || clientIp(req)}|${req.method}|${url.pathname}|${k}`;
}
function pruneOnce(now = Date.now()) {
  if (ONCE.size < 200) return;
  for (const [k, v] of ONCE) if (now - v.at > ONCE_MS) ONCE.delete(k);
}

// Finished videos and covers, only for the workspace that owns them.
function media(req, res, url) {
  const me = who(req);
  if (!me) bad(401, 'Please log in.');
  if (!me.wsId) bad(404, 'Not found');
  let name = '';
  try { name = decodeURIComponent(url.pathname.slice(7)); } catch { bad(404, 'Not found'); }
  if (!/^(video|cover)_[\w-]+\.(mp4|jpg)$/.test(name)) bad(404, 'Not found');
  streamFile(req, res, store.videoPath(me.wsId, name), name.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg');
}

const STATIC = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/index.html': ['public/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  // The portal's screens (public/screens/*.js), loaded by app.js.
  '/screens/account.js': ['public/screens/account.js', 'text/javascript; charset=utf-8'],
  '/screens/admin.js': ['public/screens/admin.js', 'text/javascript; charset=utf-8'],
  '/screens/brand.js': ['public/screens/brand.js', 'text/javascript; charset=utf-8'],
  '/screens/coach.js': ['public/screens/coach.js', 'text/javascript; charset=utf-8'],
  '/screens/communicate.js': ['public/screens/communicate.js', 'text/javascript; charset=utf-8'],
  '/screens/content.js': ['public/screens/content.js', 'text/javascript; charset=utf-8'],
  '/screens/create.js': ['public/screens/create.js', 'text/javascript; charset=utf-8'],
  '/screens/signoff.js': ['public/screens/signoff.js', 'text/javascript; charset=utf-8'],
  '/screens/replies.js': ['public/screens/replies.js', 'text/javascript; charset=utf-8'],
  '/screens/grow.js': ['public/screens/grow.js', 'text/javascript; charset=utf-8'],
  '/screens/guide.js': ['public/screens/guide.js', 'text/javascript; charset=utf-8'],
  '/screens/steps.js': ['public/screens/steps.js', 'text/javascript; charset=utf-8'],
  '/screens/mindset.js': ['public/screens/mindset.js', 'text/javascript; charset=utf-8'],
  '/screens/review.js': ['public/screens/review.js', 'text/javascript; charset=utf-8'],
  '/screens/settings.js': ['public/screens/settings.js', 'text/javascript; charset=utf-8'],
  '/screens/setup.js': ['public/screens/setup.js', 'text/javascript; charset=utf-8'],
  '/screens/studio.js': ['public/screens/studio.js', 'text/javascript; charset=utf-8'],
  '/screens/team.js': ['public/screens/team.js', 'text/javascript; charset=utf-8'],
  '/mixer-core.js': ['mixer-core.js', 'text/javascript; charset=utf-8'],
  '/comms-core.js': ['comms-core.js', 'text/javascript; charset=utf-8'],
  '/mindset-core.js': ['mindset-core.js', 'text/javascript; charset=utf-8'],
  // The niche rules mixer-core.js imports (labels and checks only; prompts stay in lib/prompts.js).
  '/niches/index.js': ['niches/index.js', 'text/javascript; charset=utf-8'],
  '/niches/life-insurance.js': ['niches/life-insurance.js', 'text/javascript; charset=utf-8'],
  '/manifest.webmanifest': ['public/manifest.webmanifest', 'application/manifest+json'],
  '/icon.svg': ['public/icon.svg', 'image/svg+xml'],
  '/icon-192.png': ['public/icon-192.png', 'image/png'],
  '/icon-512.png': ['public/icon-512.png', 'image/png'],
  '/apple-touch-icon.png': ['public/icon-192.png', 'image/png'],
  // Public: how to get your data deleted (the "data deletion instructions URL" for Meta's App Review).
  '/data-deletion': ['public/data-deletion.html', 'text/html; charset=utf-8'],
  '/data-deletion.html': ['public/data-deletion.html', 'text/html; charset=utf-8'],
  // The service worker that shows "your video is ready" notifications.
  '/sw.js': ['public/sw.js', 'text/javascript; charset=utf-8'],
  // Agent System (agent-system/): the producer-to-builder system, shown here so it can be seen on this domain.
  // The page runs the real engine in the browser, so its modules are served as they are (no copied math).
  // test/agent-system-static.test.js fails if the page imports a file that isn't listed here.
  '/agent-system/': ['agent-system/public/index.html', 'text/html; charset=utf-8'],
  '/agent-system/setup.js': ['agent-system/public/setup.js', 'text/javascript; charset=utf-8'],
  '/agent-system/app.js': ['agent-system/public/app.js', 'text/javascript; charset=utf-8'],
  '/agent-system/state.js': ['agent-system/public/state.js', 'text/javascript; charset=utf-8'],
  '/agent-system/src/setup.js': ['agent-system/src/setup.js', 'text/javascript; charset=utf-8'],
  '/agent-system/src/routines.js': ['agent-system/src/routines.js', 'text/javascript; charset=utf-8'],
  '/agent-system/src/paths.js': ['agent-system/src/paths.js', 'text/javascript; charset=utf-8'],
  '/agent-system/src/ladder.js': ['agent-system/src/ladder.js', 'text/javascript; charset=utf-8'],
  '/agent-system/src/career.js': ['agent-system/src/career.js', 'text/javascript; charset=utf-8'],
  '/agent-system/src/quality.js': ['agent-system/src/quality.js', 'text/javascript; charset=utf-8'],
  '/agent-system/src/pipeline.js': ['agent-system/src/pipeline.js', 'text/javascript; charset=utf-8'],
  '/agent-system/src/calls.js': ['agent-system/src/calls.js', 'text/javascript; charset=utf-8'],
  '/agent-system/src/store.js': ['agent-system/src/store.js', 'text/javascript; charset=utf-8'],
  '/agent-system/src/timeframes.js': ['agent-system/src/timeframes.js', 'text/javascript; charset=utf-8'],
  '/agent-system/src/metrics.js': ['agent-system/src/metrics.js', 'text/javascript; charset=utf-8'],
  '/agent-system/src/parked/commissions.js': ['agent-system/src/parked/commissions.js', 'text/javascript; charset=utf-8'],
  '/agent-system/seed/sample.js': ['agent-system/seed/sample.js', 'text/javascript; charset=utf-8'],
  '/agent-system/seed/demo-pipeline.js': ['agent-system/seed/demo-pipeline.js', 'text/javascript; charset=utf-8'],
};
// Where people write to about their data: SUPPORT_EMAIL.
export const supportEmail = () => [process.env.SUPPORT_EMAIL].map(x => String(x || '').trim()).find(x => /^[^\s@<>"'&]+@[^\s@<>"'&]+\.[^\s@<>"'&]+$/.test(x)) || '';
function serveStatic(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: 'Method not allowed' });
  const hit = STATIC[url.pathname];
  if (!hit) return send(res, 404, { error: 'Not found' });
  fs.readFile(path.join(ROOT, hit[0]), (err, data) => {
    if (err) return send(res, 404, { error: 'Not found' });
    const html = hit[1].startsWith('text/html'), text = /html|javascript|manifest/.test(hit[1]);
    let out = text ? data.toString('utf8').replaceAll('{{PRODUCT}}', PRODUCT_NAME.replace(/[<>&"]/g, '')) : data;
    if (html) {
      const c = supportEmail();
      out = out.replaceAll('{{CONTACT}}', c ? `email <a href="mailto:${c}">${c}</a>` : 'contact the person who set up your account').replaceAll('{{BACKUP_DAYS}}', String(KEEP.backups)).replaceAll('{{AUDIT_MONTHS}}', String(audit.keepMonths())).replaceAll('{{BASE}}', PUBLIC_URL.replace(/[<>"'&\s]/g, ''));
    }
    if (text) out = Buffer.from(out);
    // (v15) Checked, not downloaded again, when the browser already has this copy (ETag); compressed for
    // the trip when the browser takes it (the portal is about a third of the size).
    const etag = `"${crypto.createHash('sha1').update(out).digest('base64url').slice(0, 22)}"`;
    const head = { 'Content-Type': hit[1], 'Cache-Control': 'no-cache', ETag: etag, Vary: 'Accept-Encoding', ...BASE_HEADERS, ...(html ? { 'Content-Security-Policy': CSP } : {}) };
    if (String(req.headers['if-none-match'] || '').split(/\s*,\s*/).includes(etag)) { res.writeHead(304, head); return res.end(); }
    if (text && out.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
      let gz = gzipped.get(etag);
      if (!gz) { gz = zlib.gzipSync(out, { level: 9 }); if (gzipped.size >= 80) gzipped.delete(gzipped.keys().next().value); gzipped.set(etag, gz); }
      res.writeHead(200, { ...head, 'Content-Encoding': 'gzip', 'Content-Length': gz.length });
      return res.end(req.method === 'HEAD' ? undefined : gz);
    }
    res.writeHead(200, { ...head, 'Content-Length': out.length });
    res.end(req.method === 'HEAD' ? undefined : out);
  });
}
const gzipped = new Map();   // the compressed copy of each version of each file (a few dozen at most)

// Signed, expiring links Instagram uses to download a video or its cover. No login, by design.
function pub(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: 'Method not allowed' });
  const [, , ws, name] = url.pathname.split('/');
  const file = ig.checkSigned(ws, name, url.searchParams.get('e'), url.searchParams.get('s'));
  if (!file) return send(res, 403, { error: 'This link expired or isn’t valid.' });
  streamFile(req, res, file, name.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg');
}

// A video's tracking link: count the click, then on to the agent's booking page. No login, by design.
function trackClick(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: 'Method not allowed' });
  const code = url.pathname.split('/')[2] || '';
  const r = trackLinks.resolve(code), w = r ? store.getWorkspace(r.ws) : null, cfg = w && !w.suspended && store.getVideo(r.ws, r.v) ? store.loadConfig(r.ws) : null;
  const to = cfg && okBookingUrl(cfg.look?.bookingUrl) ? cfg.look.bookingUrl : '';
  if (!to) return send(res, 404, { error: 'This link isn’t active.' });
  if (req.method === 'GET') trackLinks.tally(code, { ip: clientIp(req), ua: req.headers['user-agent'] || '' });
  res.writeHead(302, { ...BASE_HEADERS, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex', Location: to });
  res.end();
}

// Instagram's webhook (v15, lib/replies.js): Meta checks the address once (the verify token), then sends
// comments and messages, signed with the app secret. Answered at once; replies go out just after.
async function instagramHook(req, res, url) {
  if (req.method === 'GET') {
    const q = url.searchParams, want = process.env.INSTAGRAM_WEBHOOK_TOKEN || '';
    if (q.get('hub.mode') === 'subscribe' && want && q.get('hub.verify_token') === want) { res.writeHead(200, { 'Content-Type': 'text/plain', ...BASE_HEADERS }); return res.end(String(q.get('hub.challenge') || '').slice(0, 200)); }
    return send(res, 403, { error: 'Not verified' });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  let raw;
  try { raw = (await readRaw(req, 256000)).toString('utf8'); } catch { return send(res, 413, { error: 'Too large' }); }
  if (!replies.verify(raw, req.headers['x-hub-signature-256'])) return send(res, 401, { error: 'Signature didn’t match' });
  let body;
  try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'Send JSON' }); }
  send(res, 200, { ok: true });
  for (const ev of replies.events(body)) {
    const w = replies.wsForIg(ev.igId);
    if (!w) continue;
    try { await replies.handle(w, ev, { notice: replyNotice }); } catch (e) { console.error('[replies]', e.message); }
  }
}
function replyNotice(wsId, person, rule, video) {
  const cfg = store.loadConfig(wsId), ids = ownersOf(wsId);
  if (!person || !ids.length || !push.list(wsId).length) return;
  push.send(wsId, { title: `Someone asked for ${rule.keyword}`, body: `${person.name} ${rule.where === 'dm' ? 'messaged' : 'commented'} “${rule.keyword}”${video ? ' on a video' : ''}. Your reply went to them.`, url: '/#/replies', tag: `reply-${rule.id}` }, { tz: cfg.profile?.timezone || 'America/Denver', accountIds: ids }).catch(e => console.error('[push]', e.message));
}

export const isDiskFull = e => e?.code === 'ENOSPC' || e?.diskFull || /SQLITE_FULL|database or disk is full|no space left on device/i.test(String(e?.message || ''));
let diskFullAt = 0;
function diskFullAlert(e, now = Date.now()) {
  console.error('[disk] full:', e.message);
  if (now - diskFullAt < 30 * 60000) return;   // once every 30 minutes, however many saves are refused
  diskFullAt = now;
  try {
    alerts.notify({ level: 'error', kind: 'server', title: 'The disk is full: changes can’t be saved',
      text: 'Saves are being refused for lack of disk space. Agents see “out of disk space, nothing was changed”.',
      did: 'Refused the change without touching the saved copy, and paused new videos (they start again by themselves once there’s room).',
      run: 'df -h / && du -sh /root/generator/videos /root/generator/backups' });
  } catch { /* the log has it */ }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      // The Agent System page loads its scripts relative to /agent-system/, so the bare path gets the slash.
      if (url.pathname === '/agent-system') { res.writeHead(301, { Location: '/agent-system/', ...BASE_HEADERS }); return res.end(); }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (url.pathname.startsWith('/media/')) return media(req, res, url);
      if (url.pathname.startsWith('/pub/')) return pub(req, res, url);
      if (url.pathname.startsWith('/r/')) return trackClick(req, res, url);
      if (url.pathname === '/hooks/instagram') return await instagramHook(req, res, url);
      return serveStatic(req, res, url);
    } catch (e) {
      // The disk is full: nothing was changed (saves are all or nothing); the agent is told plainly.
      if (isDiskFull(e)) { diskFullAlert(e); if (!res.headersSent) return send(res, 507, { error: 'The server is out of disk space, so this couldn’t be saved. Nothing was changed. Your admin has been told; try again in a little while.' }); return res.end(); }
      if (!(e instanceof HttpError)) { console.error(e); monitor.noteError(e, `${req.method} ${url.pathname}`); }
      if (!res.headersSent) send(res, e.code && e.code >= 400 && e.code < 600 ? e.code : e.damaged || e.status === 503 ? 503 : 500, { error: e instanceof HttpError ? e.message : plainError(e.message), ...(e.data || {}) });
      else res.end();
    }
  });
}

/* ---------------- Proactive jobs (every 10 minutes, each acts once a day or once a week) ---------------- */
// Monday auto-plan: for agents who turned it on (Create → Overnight), between 6 and 10am their time,
// write the weekly check-in and make its videos, unless they skipped this week. Same checks as the
// agent's own button (plan, monthly limit, AI cap).
// Weeks are named by the date of their Monday in the agent's own time zone (not UTC), so a plan runs
// once per local Monday wherever the agent is.
const AUTO_PLAN_HOURS = [6, 10];
const DAY_MS = 86400000;
// The local date of the next Monday whose plan hasn't run: today if it's Monday morning and it hasn't
// run yet, otherwise the coming Monday.
export function nextPlanMonday(wsId, cfg, now = new Date()) {
  const ws = store.getWorkspace(wsId), tz = cfg.profile?.timezone || 'America/Denver';
  const { date, hour } = localTime(tz, now);
  if (weekdayIn(tz, now.getTime()) === 1 && hour < AUTO_PLAN_HOURS[1] && ws?.autoPlanWeek !== date) return date;
  // (By the calendar: adding 24 hours would skip a day when the clocks change.)
  return localDates(tz, now.getTime(), 8).slice(1).find(d => weekdayOfDate(d) === 1) || date;
}
export function autoPlanState(wsId, cfg, now = new Date()) {
  if (!cfg.schedule?.autoPlan) return { on: false };
  const ws = store.getWorkspace(wsId);
  const today = localTime(cfg.profile?.timezone || 'America/Denver', now).date;
  // A skip only shows while that Monday is still ahead (or today, before it runs).
  const skipped = ws?.autoPlanSkip && ws.autoPlanSkip >= today && ws.autoPlanSkip !== ws.autoPlanWeek ? ws.autoPlanSkip : '';
  return { on: true, skipped, lastWeek: ws?.autoPlanWeek || '' };
}
// Running low, as the agent sees it (today doesn't count once today's plan post has gone out).
export const lowFor = (wsId, cfg, vids) => runningLow(cfg, signoff.asPlanned(store.getWorkspace(wsId), vids), Date.now(), 3, { postedToday: store.getWorkspace(wsId)?.autopostDay === localTime(cfg.profile?.timezone || 'America/Denver').date });
export async function proactiveJobs(now = new Date(), log = console.log) {
  const { weekKey, weeklyCheckin } = await coach();
  const out = { plans: [] };
  for (const ws of store.listWorkspaces()) { try {
    // Switched off (overnight or making videos): skipped without using up this week's plan, so it
    // still runs if it's back on within the Monday morning.
    if (!ws.onboarded || ws.suspended) continue;
    const cfg = store.loadConfig(ws.id), tz = cfg.profile?.timezone || 'America/Denver', { date, hour } = localTime(tz, now);
    // 1. The Monday plan: once per local Monday (`date` names the week).
    // (The coach writes the plan: with it switched off, the plan waits.)
    if (cfg.schedule?.autoPlan && weekdayIn(tz, now.getTime()) === 1 && hour >= AUTO_PLAN_HOURS[0] && hour < AUTO_PLAN_HOURS[1] && ws.autoPlanWeek !== date) {
      store.updateWorkspace(ws.id, { autoPlanWeek: date });
      const existing = store.readWeekly(ws.id);
      const left = allowance.access(ws).limit - usedThisMonth(ws.id);
      if (ws.autoPlanSkip === date) { store.updateWorkspace(ws.id, { autoPlanSkip: '' }); out.plans.push({ ws: ws.id, skipped: true }); }
      // The agent already made this week's plan videos (or a check-in was queued in the last few days).
      else if (existing?.week === weekKey(now) && existing.queuedAt && now - Date.parse(existing.queuedAt) < 4 * DAY_MS) out.plans.push({ ws: ws.id, alreadyQueued: true });
      // Nothing is spent on a check-in when no video could be made from it anyway.
      else if (!allowance.access(ws).allowed || overCap(ws) || whyNoVideos(cfg) || left <= 0 || queue.waiting(ws.id).length >= 6 || coachLimit.blocked(ws.id)) out.plans.push({ ws: ws.id, blocked: true });
      else {
        try {
          coachLimit.fail(ws.id);
          const w = existing?.week === weekKey(now) && !existing.queuedAt ? existing : store.saveWeekly(ws.id, await weeklyCheckin({ product: PRODUCT_NAME, cfg, videos: store.readVideos(ws.id), recent: store.readRecent(ws.id), notes: store.readNotes(ws.id), meter: usage.meter(ws.id) }));
          const jobs = [];
          let why = '';
          for (const x of w.plan || []) { try { jobs.push(...enqueueVideos(ws.id, 1, 'plan', 'auto', { painId: x.painId, format: x.format })); } catch (e) { why = e.message; break; } }
          if (jobs.length) store.saveWeekly(ws.id, { ...w, queuedAt: now.toISOString(), auto: true });
          out.plans.push({ ws: ws.id, queued: jobs.length, ...(jobs.length ? {} : { error: why || 'the plan had no videos' }) });
        } catch (e) {
          // OpenAI not answering on Monday morning: the plan is tried again at the next check instead of skipped for the week.
          if (queue.isOutage(e)) store.updateWorkspace(ws.id, { autoPlanWeek: ws.autoPlanWeek || '' });
          out.plans.push({ ws: ws.id, error: e.message });
        }
      }
    }
  } catch (e) { store.skipWorkspace(ws, e, 'proactive'); } }
  out.plans.filter(p => p.queued || p.error).forEach(p => log(`[plan] ${p.ws}: ${p.error || `queued ${p.queued}`}`));
  return out;
}

let processHooked = false;

// What both the site and a separate worker need: alerts for damaged files and failing workspaces.
function hookAlerts() {
  // A damaged data file (lib/paths.js): repaired from its last good copy if there is one; you're told either way.
  onDamage(info => alerts.notify({ level: 'error', kind: 'server', title: info.restored ? 'A damaged data file was repaired' : 'A data file is damaged and couldn’t be repaired', text: `${info.file} couldn’t be read.`, did: info.restored ? `Restored it from ${info.restored}, and kept the damaged copy in data/${info.kept}.` : `Wrote nothing over it (no good copy was found), and kept the damaged copy in data/${info.kept}.`, run: info.restored ? '' : 'Restore it from a backup: SETUP.md section AK.' }));
  // One workspace failing in a loop over all of them (posting, overnight jobs) counts toward the error alert.
  store.onWorkspaceError((e, where) => monitor.noteError(e, where));
  // A record saved with the wrong shape (lib/shapes.js): saved anyway, and you're told once a day.
  onShapeProblem((p, where) => alerts.notify({ level: 'warning', kind: 'server', title: 'A record was saved with an unexpected shape', text: `${where}: ${p}. This is a bug.`, did: 'Saved it anyway (nothing the agent did was lost); you’re told once a day.', run: 'Send this alert and pm2 logs generator --lines 200 for a fix.' }));
  // Errors nothing else caught still count toward the "server is throwing errors" alert.
  if (!processHooked) {
    processHooked = true;
    process.on('unhandledRejection', e => { console.error('[unhandled]', e); monitor.noteError(e, 'background task'); });
  }
}

// A video that fails for good, for a reason the agent can't fix, is sent to you as an alert.
function jobFailed(job, e) {
  fs.rmSync(jobDir(job), { recursive: true, force: true });   // no more tries: its saved stages go
  if (e?.quiet) return;
  const ws = store.getWorkspace(job.ws);
  alerts.notify({ level: 'error', kind: 'video', title: job.kind === 'fix' ? 'A scene fix failed' : `A${job.source === 'overnight' ? 'n overnight' : ''} video failed`, text: String(e?.message || job.error || 'Unknown error'), did: e?.permanent ? 'Stopped: it can’t work as things are, so it wasn’t tried again. The agent sees it failed.' : 'Tried it again (and waited out any outage) before giving up; the agent sees it failed.', run: 'If it’s not something the agent can fix, check pm2 logs generator --lines 100.', ws: job.ws, workspaceName: ws?.name });
}
// Makes videos in this process: takes jobs from the line, one at a time.
export function startWorkerHere() {
  const failed = jobFailed;
  // The watchdog stopped a stuck video: it goes back in line by itself; you're told, nothing to do.
  const stuck = (job, e) => {
    const ws = store.getWorkspace(job.ws);
    alerts.notify({ level: 'warning', kind: 'video', title: 'A video got stuck, so it was stopped and put back in line', text: `${e.message} (try ${job.attempts} of ${queue.MAX_ATTEMPTS})`, did: job.attempts < queue.MAX_ATTEMPTS ? 'Stopped it and its programs, and put it back in line: it’s being made again now.' : 'Stopped it and its programs; it was its last try, so it failed.', run: 'Nothing, unless it keeps happening: then pm2 logs generator --lines 100.', ws: job.ws, workspaceName: ws?.name });
  };
  // A finished video also pings the agent's phone or computer (Web Push), if they turned that on.
  // Nothing starts while the disk is nearly full.
  const gate = () => diskGate();
  queue.startWorker(async (job, log) => { const r = await runJob(job, log); notifyReady(job, r).catch(e => console.error('[push]', e.message)); return r; }, { failed, stuck, gate });
}

// Work folders are cleared, except those of videos still in line or being made (they resume from
// them, or a separate worker is using them) and anything from the last hour.
function clearWork(now = Date.now()) {
  fs.mkdirSync(DIRS.work, { recursive: true });
  const keep = new Set(queue.listJobs().filter(j => j.status === 'queued' || j.status === 'running').map(j => path.basename(jobDir(j))));
  for (const n of fs.readdirSync(DIRS.work)) {
    const p = path.join(DIRS.work, n);
    let fresh = false;
    try { fresh = now - fs.statSync(p).mtimeMs < 3600000; } catch { /* gone */ }
    if (!keep.has(n) && !fresh) fs.rmSync(p, { recursive: true, force: true });
  }
}

// Boot: move an old single-agent setup in, resume the queue, start the overnight jobs.
export let startingUp = false;
// The key check (lib/secrets.js): can this server read what it sealed? A server restored without its
// .app-key can't, and would otherwise fail two-factor logins and Meta connections one by one, quietly.
export let keyProblem = '';
function keyCheck() {
  let c;
  try { c = secrets.checkCanary(); } catch (e) { c = { ok: false, error: e.message }; }
  keyProblem = c.ok ? '' : 'The encryption key doesn’t match the data.';
  if (!c.ok) alerts.notify({ level: 'error', kind: 'server', title: 'This server’s encryption key doesn’t match its data',
    text: `It can’t read what it sealed before (key ${c.sealedWith || '?'} sealed it; this server has ${c.keyId || '?'}). Two-factor logins fail, and Instagram and Facebook need connecting again, until it’s fixed. This happens when a server is restored without its .app-key (or APP_KEY).`,
    did: 'Changed nothing: no sealed value was overwritten or thrown away.',
    run: 'Put back the .app-key you kept with your .env (or APP_KEY), then: pm2 restart generator' });
  return c;
}

// Fonts and music checked against their checksums (lib/assets.js).
async function assetCheck() {
  try {
    const { checkAssets } = await import('./lib/assets.js');
    const r = checkAssets();
    if (r.fonts.fixed.length || r.fonts.bad.length) alerts.notify({ level: 'warning', kind: 'server', title: 'A caption font file was damaged', text: `${[...r.fonts.fixed, ...r.fonts.bad].join(', ')} didn’t match the checksum it was released with.`, did: r.fonts.bad.length ? `Put back ${r.fonts.fixed.length} from the release; removed ${r.fonts.bad.join(', ')} (it’s fetched again, checked, before the next video).` : 'Put it back from the release.', run: r.fonts.bad.length ? 'If videos fail on fonts: put the files from assets/fonts/ into fonts/' : '' });
    if (r.music.changed.length) alerts.notify({ level: 'warning', kind: 'server', title: 'A music track changed on disk', text: `${r.music.changed.join(', ')} isn’t the same file it was when it was added (a disk fault or a bad copy).`, did: 'Noted its new checksum, so you’re told once.', run: 'Play it (or copy it into music/ again from your original).' });
    return r;
  } catch (e) { console.error('[assets]', e.message); return null; }
}

// The numbered data changes (lib/changes.js), before anything else touches the data.
async function dataChanges() {
  try {
    const r = await changes.runChanges();
    if (r.failed) alerts.notify({ level: 'error', kind: 'server', title: `Data change ${r.failed.n} didn’t finish`, text: `${r.failed.name}: ${r.failed.error}`,
      did: 'Started anyway on the data as it is; the changes after it wait. Nothing was removed.', run: 'pm2 logs generator --lines 100; to go back to the version before: bash update.sh --rollback' });
    return r;
  } catch (e) { console.error('[changes]', e.message); return null; }
}

export async function start({ port = Number(process.env.PORT || 3100), host = process.env.HOST || '127.0.0.1', scheduler = true, worker = true } = {}) {
  store.migrateLegacy();
  markRunning();   // so `node admin.js storage migrate` won't move data while the server runs
  hookAlerts();
  keyCheck();
  if (process.env.REHEARSAL !== '1') assetCheck();   // (update.sh's try-out leaves the live fonts alone)
  // The site answers at once (so an update's "does it answer?" check never waits on the data changes);
  // the changes then run, and only after them does anything else touch the data: the line, the
  // scheduler, the worker.
  const server = createServer();
  startingUp = true;   // the health check says "starting" until the data changes are done
  await new Promise(resolve => server.listen(port, host, resolve));
  try { await dataChanges(); } finally { startingUp = false; }
  queue.recover({ failed: jobFailed });
  clearWork();
  try { trackLinks.backfill(); } catch (e) { console.error('[links]', e.message); }
  if (worker) startWorkerHere();
  if (queue.loadProblem) alerts.notify({ level: 'error', kind: 'server', title: 'The list of videos being made was damaged', text: 'data/jobs.json couldn’t be read.', did: 'Started the line empty, and kept the damaged copy in data/damaged/.', run: 'Ask agents with videos waiting to start them again (or restore jobs.json from a backup).' });
  if (scheduler) startScheduler((wsId, n, source) => enqueueVideos(wsId, n, source, 'overnight'), console.log, { minute: async () => { await platforms.tickAll(); }, daily: async () => { await ig.refreshDue(); await insights.refreshResults(); await ai.checkModels().catch(e => console.error('[models]', e.message)); try { targets.checkTargets(); } catch (e) { console.error('[targets]', e.message); } }, tick: async () => { monitor.checkBackups(); gauges.noteDisk(freeGB()); await proactiveJobs(); } });
  // The gauges (Engine bay).
  if (process.env.NODE_ENV !== 'test') gauges.start('server');
  if (process.env.NODE_ENV !== 'test') {
    console.log(`${PRODUCT_NAME} ${VERSION} on http://${host}:${server.address().port}`);
    if (!store.listAccounts().some(a => a.role === 'admin')) console.log('No admin yet. Create one with:  node admin.js create-admin you@example.com');
  }
  return server;
}

// A clean stop (pm2 restart or stop, an update): videos being made go back in line without using up a
// try (they resume from their last finished step), their programs are stopped, waiting clicks are saved.
export function shutdown() {
  try { queue.shutdown(); } catch (e) { console.error('[shutdown]', e.message); }
  try { gauges.flush(); } catch { /* best effort */ }
  try { trackLinks.flush(); } catch { /* best effort */ }
}

// Starts the website (node server.js).
// REHEARSAL=1 (update.sh's try-out on a copy of the data): the website only, nothing runs or goes out.
export function main() {
  const rehearsal = process.env.REHEARSAL === '1';
  start(rehearsal ? { scheduler: false, worker: false } : {}).catch(e => { console.error('The server couldn’t start:', e); process.exit(1); });
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { shutdown(); process.exit(0); });
}
/* ---------------- The routes, by area (routes/*.js) ---------------- */
// Mounted last, in the order they were written (the first route that matches a request answers it),
// with the helpers they share with the rest of the server.
const ROUTE_CTX = { isStarting: () => startingUp, APPROVAL_NOTE, BASE_HEADERS, pendingInvites, reviewerRoom, CHECKLIST, HttpError, MAX_PER_REQUEST, REJECT_REASONS, SECURE, TERMS_FREE, TERMS_TEXT, TESTS_PER_DAY, VERSION, api, autoPlanState, bad, baseUrl, clientIp, clip, coach, coachGate, draftCfg, draftLimit, draftPicks, emailLimit, enqueueVideos, fixing, getV, ipLimit, jobView, keyProblem, linkError, lowFor, main, media, mindset, needsTerms, newTicket, nextPlanMonday, noticesFor, nowIso, orphanInvite, overCap, ownersOf, plainError, quiet, route, send, sha256File, slug, spendGate, start, startSession, stats, streamFile, supportEmail, terms, termsStamp, tickets, todayFor, twofaLimit, typicalSeconds, usedThisMonth, validTz, videoView, who, workingConfig, wsSummary };
for (const mount of [mount_public, mount_account, mount_setup, mount_scripts, mount_mindset, mount_content, mount_studio, mount_videos, mount_brand, mount_social, mount_admin, mount_people, mount_signoff, mount_replies]) mount(ROUTE_CTX);

// On restart (pm2 sends SIGINT), main() hands running videos back and writes what's waiting, then exits.
// (Compared as real paths: the app folder, or `current`, may be a link.)
const entryUrl = (() => { try { return pathToFileURL(fs.realpathSync(process.env.pm_exec_path || process.argv[1] || '')).href; } catch { return ''; } })();
if (import.meta.url === entryUrl) main();
