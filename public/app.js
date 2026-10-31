// app.js — the portal. One page with hash routes:
//   #/login  #/invite/<token>  #/reset/<token>  #/setup
//   #/review  #/create  #/content  #/communicate  #/brand  #/settings  #/guide  #/admin  #/account
// It imports the same engine as the server (mixer-core.js), so previews and checks match exactly.
// The prompt text itself is built only on the server (lib/prompts.js); admins can preview it in Setup → Look.
import {
  DEFAULT_CONFIG, LEVELS, LIMITS, VOICES, FONTS, FORMATS, PLATFORM_GUARDRAILS, GOV_TERMS,
  uid, migrate, roll, analyze, countMixes, beatPlan, estimateSeconds, insightStatus, usableRoutes,
  checkInsightText, checkStoryText, roleText, cityOf, whyNoVideos, applySuggestionTo, factNotes, ACCENT_COLORS, accentHex, sayProblems, AI_VOICE_NOTE, STRUCTURES, shotList, studioPicks, studioChecks, studioFormatFor, structureFits, validateHook, suggestAccent, okBookingUrl, PLATFORMS, nicheOf, SHOT_TYPES, FOOTAGE_MIX,
} from './mixer-core.js';
import { STYLES, STYLE_KEYS, normStyle, styleLabel, PRINCIPLES, SALES, DRILL, WORKSHOP_KINDS, RUBRIC } from './comms-core.js';
import { BOOKS, SKILLS, PERSUASION, AUTO_HABITS } from './mindset-core.js';
// The screens (public/screens/*.js).
import { drawSessions, drawTwofa, loadSessions, viewAccount, viewLink, viewLogin, viewTerms, viewTwofaLogin, viewTwofaRequired } from './screens/account.js';
import { drawSetup, viewSetup } from './screens/setup.js';
import { drawReview, focusKey, haptic2, loadIg, loadVideos, loadWeekly, player, sub, viewReview } from './screens/review.js';
import { drawCreate, footageHTML, loadOverview, testHTML, viewCreate } from './screens/create.js';
import { drawStudio, loadStudioList, pollStudio, stBrief, stPicks, stRefreshChecks, stSave, stSetScene, stSpell, viewStudio } from './screens/studio.js';
import { addTopic, contentActions, drawContent, onTopicInput, restory, viewContent } from './screens/content.js';
import { drawMindset, habitRows, haptic, loadMind, mindForm, mindSave, viewMindset } from './screens/mindset.js';
import { drawBrand, loadLibrary, uploadClip, viewBrand } from './screens/brand.js';
import { drawMemory, drawSettings, loadMemory, loadPromptPreview, promptHTML, promptText, viewSettings } from './screens/settings.js';
import { drawCommunicate, drillPanel, loadCalibration, shuffled, viewCommunicate, workshopPanel, wsItems } from './screens/communicate.js';
import { drawTeam, viewTeam } from './screens/team.js';
import { viewGuide } from './screens/guide.js';
import { drawSignoff, signoffActions, soBackForm, viewSignoff } from './screens/signoff.js';
import { repliesActions, repliesForm } from './screens/replies.js';
import { drawGrow, viewGrow } from './screens/grow.js';
import { canSetup, drawStep, firstStep, stepView, viewStep } from './screens/steps.js';
import { drawAdmin, loadAudit, loadEngine, viewAdmin } from './screens/admin.js';
import { applyStudio, applySuggestion, describe, drawCoach, lines, loadCoachNotes, makeVideos, openCoach, redraw, saveCoachMsgs, sendCoach, setCoachMode } from './screens/coach.js';

/* ================= Basics ================= */
// This portal's version. The server says its own on every answer (X-App-Version); when they differ (a
// tab left open across an update), the portal refreshes itself at the next calm moment, keeping what
// was being typed. Kept equal to server.js VERSION (the checks make sure).
const APP_VERSION = '16.0.0';
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
// Times written the way people say them, always in the agent's time zone (v15): "this morning at 9:05",
// "yesterday at 4pm", "Tuesday at 9am", "Oct 3 at 2:30pm"; dates as "today", "yesterday", "Tuesday", "Oct 3".
const tzOf = () => S.me?.workspace?.timezone || S.cfg?.profile?.timezone || undefined;
function partsIn(t, tz) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'long' }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, h: Number(p.hour), m: Number(p.minute), weekday: p.weekday, year: Number(p.year) };
  } catch { const d = new Date(t); return { date: d.toISOString().slice(0, 10), h: d.getHours(), m: d.getMinutes(), weekday: d.toLocaleDateString('en-US', { weekday: 'long' }), year: d.getFullYear() }; }
}
const clockSaid = (h, m) => `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
const daysApart = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
function daySaid(t, tz = tzOf()) {
  const p = partsIn(t, tz), now = partsIn(Date.now(), tz), d = daysApart(now.date, p.date);
  if (d === 0) return 'today';
  if (d === -1) return 'yesterday';
  if (d === 1) return 'tomorrow';
  if (Math.abs(d) < 7) return d < 0 ? `last ${p.weekday}` : p.weekday;
  return new Date(`${p.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(p.year !== now.year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
}
function when(iso) {
  const t = Date.parse(iso || '');
  if (!iso || !Number.isFinite(t)) return '';
  const tz = tzOf(), p = partsIn(t, tz), c = clockSaid(p.h, p.m), d = daySaid(t, tz);
  if (d === 'today') return p.h < 12 ? `this morning at ${c}` : p.h < 17 ? `this afternoon at ${c}` : `this evening at ${c}`;
  return `${d} at ${c}`;
}
const day = iso => { const t = Date.parse(iso || ''); return iso && Number.isFinite(t) ? daySaid(t) : ''; };
const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;
// "just now", "5 minutes ago", "yesterday", "3 days ago", then the date.
const ago = iso => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!iso || !Number.isFinite(s)) return '';
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hour${Math.round(s / 3600) === 1 ? '' : 's'} ago`;
  if (s < 2 * 86400) return 'yesterday';
  if (s < 14 * 86400) return `${Math.round(s / 86400)} days ago`;
  return day(iso);
};
const S = {
  me: null, product: document.title, view: '',
  cfg: null, saved: '', versions: [],
  videos: [], stats: null, fixing: [], overview: null, admin: null,
  setup: null, open: {}, fix: null, picks: null, test: null, shareFiles: {}, timers: [],
  suggestedLinks: {}, rewrites: {}, weekly: null, weeklyAsked: false,
};
const short = t => (t.length > 34 ? t.slice(0, 33) + '…' : t);

// Reduced motion: the phone's setting also stops smooth scrolling done from code.
if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
  const plain = o => (o && typeof o === 'object' && o.behavior === 'smooth' ? { ...o, behavior: 'auto' } : o);
  const into = Element.prototype.scrollIntoView, to = window.scrollTo.bind(window);
  Element.prototype.scrollIntoView = function (o) { return into.call(this, plain(o)); };
  window.scrollTo = (a, b) => (typeof a === 'object' ? to(plain(a)) : to(a, b));
}

// `action`: a button on the toast (Undo), with its `act` and `key`, shown for `ms`.
function toast(msg, { action = '', act = '', key = '', ms = 2600 } = {}) {
  const t = document.getElementById('toast');
  if (action) t.innerHTML = `<span>${esc(msg)}</span><button class="toast-btn" data-act="${esc(act)}" data-key="${esc(key)}">${esc(action)}</button>`;
  else t.textContent = msg;
  t.classList.toggle('has-action', !!action);
  // Above whatever already sits at the bottom (the ready cards, the Coach button, the save bar), never on it.
  const lift = Math.max(0, ...['ready', 'savebar'].map(id => document.getElementById(id)).concat(document.querySelector('.coach-fab'))
    .filter(el => el && !el.hidden && el.getClientRects().length && el.offsetHeight).map(el => innerHeight - el.getBoundingClientRect().top + 10));
  t.style.bottom = lift > 84 ? `${Math.round(lift)}px` : '';
  t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show', 'has-action'), ms);
}
function status(el, msg, kind = '') { if (el) { el.textContent = msg; el.className = 'status' + (kind ? ' ' + kind : ''); } }

// Can't reach the server (offline, or it's restarting): a calm banner instead of errors, reads are tried
// again by themselves, and the banner goes when the server answers. Changes that didn't go through say so.
const OUTAGE_STATUS = [502, 503, 504];
const SERVER_TROUBLE = 'Something went wrong on our side. Try again in a moment.';
const NO_CONNECTION = 'That didn’t go through: the server can’t be reached. Try again in a moment.';
// For the few calls that send files or get audio straight from fetch (not through api()).
const fetchError = e => (e instanceof TypeError ? new Error(NO_CONNECTION) : e);
function outage(on) {
  let b = document.getElementById('outage');
  if (!on) { if (b) { b.remove(); toast('Back online'); } return; }
  if (b) return;
  b = Object.assign(document.createElement('div'), { id: 'outage', className: 'outage', role: 'status' });
  b.innerHTML = `<span>${navigator.onLine === false ? 'You’re offline.' : 'Can’t reach the server right now.'} What’s on screen stays here; we’ll keep trying.</span><button class="btn sm" data-act="outage-retry">Try now</button>`;
  document.body.prepend(b);
}
window.addEventListener('offline', () => outage(true));
window.addEventListener('online', () => { if (document.getElementById('outage')) api('/api/me').then(() => { outage(false); flushOffline(); }).catch(() => {}); else flushOffline(); });
// One-time keys: every change carries an Idempotency-Key. The same change sent again while the first is
// still on its way (a double tap) reuses its key, so the server does it once. Once it has an answer,
// the same change again is a new change (a save, an undo, the same save again all count). A decision
// saved offline keeps its own key.
const inFlight = new Map();
/* ----- Staying in step with the server ----- */
// A newer server: refresh at the next calm moment (moving to another screen, coming back to the tab,
// or a minute with nothing being typed or sent), never in the middle of a change. What's typed in the
// open screen is kept for the reload (this tab only) and put back.
let updateTo = '';
function noteServerVersion(v) {
  if (!v || v === APP_VERSION || updateTo) return;
  updateTo = v;
  const b = Object.assign(document.createElement('div'), { id: 'updating', className: 'outage', role: 'status' });
  b.innerHTML = `<span>A new version of the app is ready. It loads when you’re between steps; what you’ve typed is kept.</span><button class="btn sm" data-act="update-now">Load it now</button>`;
  document.body.prepend(b);
  const idle = setInterval(() => { if (calm()) { clearInterval(idle); refreshForUpdate(); } }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && calm()) refreshForUpdate(); });
}
const calm = () => !inFlight.size && !soft.size && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
const DRAFT_KEY = 'reload-draft';
function keepDraft() {
  try {
    const fields = [...document.querySelectorAll('#main input[name], #main textarea[name], #main select[name]')].filter(f => f.type !== 'password' && f.type !== 'file' && f.value).map(f => [f.closest('form')?.dataset.form || '', f.name, f.type === 'checkbox' ? (f.checked ? '1' : '') : f.value]);
    if (fields.length) sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ hash: location.hash, fields, at: Date.now() }));
  } catch { /* storage off: nothing kept */ }
}
// At most one automatic reload per new version (a portal that still doesn't match after reloading, say
// an old copy kept somewhere, shows the banner instead of reloading again and again).
function reloadOnce() {
  let done = '';
  try { done = sessionStorage.getItem('reloaded-for') || ''; } catch { /* storage off */ }
  if (done === updateTo) return false;
  try { sessionStorage.setItem('reloaded-for', updateTo); } catch { /* fine */ }
  keepDraft();
  location.reload();
  return true;
}
function refreshForUpdate() { if (calm()) reloadOnce(); }
// After the reload: puts back what was being typed (once, on the same screen, within 10 minutes).
function restoreDraft() {
  let d = null;
  try { d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch { d = null; }
  if (!d || d.hash !== location.hash || Date.now() - d.at > 600000) return;
  let put = 0;
  for (const [form, name, value] of d.fields) {
    const f = document.querySelector(`#main ${form ? `form[data-form="${CSS.escape(form)}"] ` : ''}[name="${CSS.escape(name)}"]`);
    if (!f || f.value) continue;
    if (f.type === 'checkbox') f.checked = value === '1'; else f.value = value;
    f.dispatchEvent(new Event('input', { bubbles: true }));
    put++;
  }
  try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* fine */ }
  if (put) toast('Updated. What you were typing is back.');
}
const newKey = () => (window.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`);
async function api(path, opts = {}) {
  const { method = 'GET', body } = opts;
  if (method === 'GET' || opts.key) return apiOnce(path, opts);
  const sig = `${method} ${path} ${body === undefined ? '' : JSON.stringify(body)}`;
  const busy = inFlight.get(sig);
  if (busy) return apiOnce(path, { ...opts, key: busy });
  const key = newKey();
  inFlight.set(sig, key);
  try { return await apiOnce(path, { ...opts, key }); } finally { inFlight.delete(sig); }
}
async function apiOnce(path, { method = 'GET', body, key = '', keepalive = false } = {}) {
  let res;
  const once = method === 'GET' ? '' : key;
  for (let i = 0; ; i++) {
    try {
      // The workspace this page was loaded for: the server refuses to act on another one.
      const wsHead = path !== '/api/me' ? wsHeaders() : {};
      res = await fetch(path, { method, credentials: 'same-origin', ...(keepalive ? { keepalive: true } : {}), headers: { ...wsHead, ...(once ? { 'Idempotency-Key': once } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
      noteServerVersion(res.headers.get('x-app-version'));
      // A 502/503/504 from the app itself carries its own message; one from the proxy (the app is down) doesn't.
      const down = OUTAGE_STATUS.includes(res.status) && !(await res.clone().json().catch(() => ({}))).error;
      if (down) { outage(true); if (method === 'GET' && i < 2 && navigator.onLine !== false) { await new Promise(r => setTimeout(r, 1500 * 3 ** i)); continue; } }
      else { if (document.getElementById('outage')) outage(false); if (!flushing && readQueue().length && path !== '/api/me') setTimeout(flushOffline, 0); }
      break;
    } catch (e) {
      outage(true);
      if (method === 'GET' && i < 2 && navigator.onLine !== false) { await new Promise(r => setTimeout(r, 1500 * 3 ** i)); continue; }
      throw Object.assign(new Error(method === 'GET' ? 'Can’t reach the server right now. Try again in a moment.' : 'That didn’t go through: the server can’t be reached. Nothing was changed; try again in a moment.'), { offline: true });
    }
  }
  if (document.getElementById('outage') && OUTAGE_STATUS.includes(res.status)) throw Object.assign(new Error('The server is busy or restarting. Try again in a moment.'), { offline: true, status: res.status });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && path !== '/api/login' && path !== '/api/account/password') {
    if (S.me?.account) S.prevAccount = S.me.account.id;
    S.me = { ...(S.me || {}), account: null };
    clearOffline();   // nothing personal stays on the device once the session is gone
    if (!/^#\/(invite|reset)/.test(location.hash)) go('login');
    throw new Error(data.error || 'Please log in.');
  }
  if (res.status === 403 && data.terms && S.me?.account && !S.me.termsRequired) { S.me.termsRequired = true; setTimeout(render, 0); }
  if (res.status === 409 && data.wsChanged) switchedBanner();
  if (res.status === 403 && data.twofaSetup && S.me?.account && !S.me.twofaSetupRequired) { S.me.twofaSetupRequired = true; setTimeout(render, 0); }
  if (!res.ok) throw Object.assign(new Error(data.error || SERVER_TROUBLE), { data, status: res.status });
  return data;
}

async function copy(text, what = 'Text') {
  try { await navigator.clipboard.writeText(text); toast(`${what} copied`); }
  catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast(`${what} copied`); } catch { toast('Select the text and copy it'); }
    ta.remove();
  }
}

/* ================= Router ================= */
const go = (view, arg = '') => {
  const h = '#/' + view + (arg ? '/' + arg : '');
  if (location.hash !== h) location.hash = h; else render();
};
function parse() {
  const h = location.hash.replace(/^#\/?/, '');
  const [p, q = ''] = h.split('?');
  const [view = '', ...rest] = p.split('/');
  return { view, arg: rest.join('/'), q: new URLSearchParams(q) };
}
// Moving to another screen is the calm moment a waiting update loads (the new screen opens on the new version).
window.addEventListener('hashchange', () => { if (updateTo && !inFlight.size && reloadOnce()) return; render(); });
window.addEventListener('beforeunload', e => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });

function stopTimers() { S.timers.forEach(clearTimeout); S.timers = []; }
const later = (fn, ms) => S.timers.push(setTimeout(fn, ms));

// The workspace this page was loaded for. It only changes with a reload, so a switch in another tab
// can't quietly move this one (the server refuses requests for any other workspace).
let pageWs = '';
async function refreshMe() {
  try {
    const r = await api('/api/me');
    if (pageWs && r.workspace?.id && r.workspace.id !== pageWs && r.account?.id === S.me?.account?.id) { switchedBanner(); return; }
    S.me = r; S.product = S.me.product || S.product;
    if (!pageWs && S.me.workspace?.id) pageWs = S.me.workspace.id;
  } catch {}
}
const wsParam = () => (pageWs ? `?ws=${encodeURIComponent(pageWs)}` : '');
const wsHeaders = () => (pageWs ? { 'X-Workspace': pageWs } : {});
function switchedBanner() { if (!document.getElementById('wsChanged')) document.body.insertAdjacentHTML('afterbegin', '<div class="outage" id="wsChanged" role="status"><span>You switched workspaces in another tab.</span><button class="btn sm" data-act="page-reload">Reload</button></div>'); }

async function render() {
  stopTimers();
  const { view, arg, q } = parse();
  if (view === 'invite' || view === 'reset') return viewLink(view, arg);
  if (!S.me?.account) return S.ticket ? viewTwofaLogin() : viewLogin();
  // Two-factor login required (admins by default) and not set up yet: nothing else until it is.
  if (S.me.twofaSetupRequired) return page('twofa', viewTwofaRequired);
  const acc = S.me.account, ws = S.me.workspace, admin = acc.role === 'admin';
  if (view === 'account') return page('account', viewAccount);
  // An agent on a leader's team (Agent Reels) has nothing else here.
  if (S.me.role === 'teammate') { location.replace('/agent-system/'); return; }
  if (view === 'guide') return page('guide', viewGuide);
  if (admin && view === 'admin') return page('admin', viewAdmin);
  if (!ws) return admin ? go('admin') : page('account', viewAccount);
  if (!ws.onboarded && !can('setup')) return page('setup', () => { main.innerHTML = `<div class="head"><h1>${esc(ws.name)}</h1><p class="lede">This workspace is still being set up by the agent. Once they finish, it’ll be ready for you here.</p></div>`; });
  if (!ws.onboarded) return view === 'setup' ? page('setup', viewSetup) : go('setup');
  // New or updated terms: accepted once before going on (setup has its own checkbox).
  if (S.me.termsRequired) return page('terms', viewTerms);
  // Daily stops (Review, Create, Grow) and Setup's steps. Content, Brand and Settings open as full pages.
  const views = { studio: viewStudio, review: viewReview, create: viewCreate, grow: viewGrow, content: viewContent, communicate: viewCommunicate, mindset: viewMindset, brand: viewBrand, settings: viewSettings, team: viewTeam, signoff: viewSignoff, profile: viewStep, library: viewStep, voice: viewStep, look: viewStep, autopilot: viewStep };
  if (view === 'setup') return firstStep() ? go(firstStep()) : go('');
  // Only the pages this person can use (lib/roles.js).
  if (!views[view] || !canSee(view)) return go(homeView());
  return page(view, views[view], { arg, q });
}

// What this person can do here (from the server, lib/roles.js), and which pages that opens.
const can = cap => (S.me?.caps || []).includes(cap);
const PAGE_CAPS = { review: ['view'], create: ['make'], studio: ['make'], grow: ['results', 'coach', 'replies', 'mindset'], content: ['settings'], communicate: ['coach', 'replies'], mindset: ['mindset'], brand: ['settings', 'connect'], settings: ['settings'], team: ['people'], signoff: ['signoff'],
  profile: ['settings'], library: ['settings'], voice: ['settings'], look: ['settings'], autopilot: ['settings', 'connect'] };
const canSee = view => !PAGE_CAPS[view] || PAGE_CAPS[view].some(can);
// Where someone lands: the agent on Review, a reviewer on Sign-off.
const homeView = () => (S.me.role === 'reviewer' ? 'signoff' : canSee('review') ? 'review' : firstStep() || 'guide');
// Which stop in the top bar a page belongs to.
const NAV_OF = { review: 'review', create: 'create', studio: 'create', grow: 'grow', communicate: 'grow', mindset: 'grow', signoff: 'signoff', admin: 'admin', profile: 'setup', library: 'setup', voice: 'setup', look: 'setup', autopilot: 'setup', team: 'setup', content: 'setup', brand: 'setup', settings: 'setup' };
function shell(view) {
  const me = S.me, ws = me.workspace, admin = me.account.role === 'admin';
  const tabs = [];
  if (ws?.onboarded) tabs.push(...[['review', 'Review', ws.pending], ['create', 'Create'], ['grow', 'Grow'], ['signoff', 'Sign-off']].filter(([k]) => canSee(k)));
  if (ws?.onboarded && canSetup()) tabs.push([firstStep(), 'Setup', 0, 'setup']);
  if (ws && !ws.onboarded) tabs.push(['setup', 'Setup']);
  if (admin) tabs.push(['admin', 'Admin', me.alerts || 0]);
  const here = NAV_OF[view] || view;
  // Account and the guide: under the initial in the corner.
  const menu = [['account', 'Account'], ['guide', 'Guide']];
  const initial = String(me.account.name || me.account.email || '?').trim().charAt(0).toUpperCase();
  const others = (me.workspaces || []).filter(w => !w.current);
  return `<header class="top"><div class="top-row"><div class="brand"><img src="/icon.svg" alt=""><b>${esc(S.product)}</b>${ws ? (others.length ? `<select class="ctl sm ws-switch" data-ws-switch aria-label="Workspace">${(me.workspaces || []).map(w => `<option value="${esc(w.id)}"${w.current ? ' selected' : ''}>${esc(w.name)}${w.role === 'assistant' ? ' (assistant)' : ''}</option>`).join('')}</select>` : `<span>${esc(ws.name)}</span>`) : ''}</div>
      <div class="me-menu"><button class="me-btn" data-act="menu" aria-expanded="false" aria-controls="mePop" aria-label="Account and guide"${['account', 'guide'].includes(view) ? ' aria-current="page"' : ''}>${esc(initial)}</button>
        <div class="me-pop" id="mePop" hidden><p class="small muted">${esc(me.account.name || me.account.email)}</p>${menu.map(([k, l]) => `<a href="#/${k}"${k === view ? ' aria-current="page"' : ''}>${esc(l)}</a>`).join('')}<button class="danger" data-act="logout">Log out</button></div></div></div>
    ${me.acting ? `<div class="acting"><span>You’re working in <b>${esc(ws.name)}</b>’s workspace.</span><button class="btn sm" data-act="leave-ws">Back to Admin</button></div>` : ''}
    <nav class="nav" aria-label="Sections">${can('teamlead') ? '<a href="/agent-system/#team" data-team-link>Team</a>' : ''}${tabs.map(([k, label, n, key = k]) => `<a href="#/${k}"${key === here ? ' aria-current="page"' : ''}>${label}${n ? `<span class="badge">${n}</span>` : ''}</a>`).join('')}</nav></header>
    ${(me.notices || []).length ? `<div class="notices" role="status">${me.notices.map(n => `<div class="note small">${esc(n.text)}</div>`).join('')}</div>` : ''}
    <main id="main"></main><div class="savebar" id="savebar" hidden></div>
    ${ws?.onboarded && can('coach') ? '<button class="coach-fab" data-act="coach-open" aria-label="Open the coach"><span aria-hidden="true">✦</span> Coach</button>' : ''}`;
}

let main = null;
const VIEW_NAMES = { grow: 'your results', profile: 'your profile', library: 'your topics', voice: 'your voice and rules', look: 'your look', autopilot: 'Autopilot', team: 'your team', signoff: 'what’s waiting', rules: 'the render rules', review: 'your videos', create: 'Create', studio: 'your draft', content: 'your content', communicate: 'Communicate', mindset: 'Mindset', brand: 'your brand', settings: 'your settings', guide: 'the guide', admin: 'the admin view', account: 'your account', setup: 'setup' };
let pageGen = 0;
async function page(view, fn, ctx = {}) {
  const gen = ++pageGen;
  S.view = view;
  app.innerHTML = shell(view);
  main = document.getElementById('main');
  main.innerHTML = `<p class="empty"><span class="spin"></span> Loading ${esc(VIEW_NAMES[view] || 'the page')}…</p>`;
  try { await fn(ctx); } catch (e) { main.innerHTML = `<div class="note err stack"><span>Couldn’t load ${esc(VIEW_NAMES[view] || 'this page')}. ${esc(e.message)}</span><div class="row"><button class="btn sm" data-act="page-retry">Try again</button></div></div>`; }
  if (gen !== pageGen) return;   // another page opened meanwhile: it finishes the job
  restoreDraft();   // after an update's reload: what was being typed here
  saveBar();
  if (SETTINGS_VIEWS[view] && S.cfg && !dirty()) { const d = draftOffer(); if (d) main.insertAdjacentHTML('afterbegin', d); }
  if (S.coach?.open) drawCoach();   // what the coach is looking at follows the page
  // The current tab, Setup step and Grow tab stay in view on a phone (their strips scroll sideways).
  document.querySelectorAll('.nav [aria-current], .steps [aria-current="step"], .subnav [aria-current]').forEach(cur => cur.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
}

/* ================= Browser storage, the grid, "ready" cards ================= */
// Browser storage is only a convenience: everything works without it.
const local = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* fine without */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* fine without */ } },
};
const wsKey = k => `${k}:${S.me?.workspace?.id || ''}:${S.me?.account?.id || ''}`;
// The grid (Review): how the profile will look once the ready videos go out. Instagram crops reels to
// 3:4 on the grid, so the tiles do too.
function gridPanel() {
  const at = v => Date.parse(v.autopost?.at || v.fbpost?.at || '') || 0;
  const up = S.videos.filter(v => v.status === 'approved' && v.coverUrl).sort((a, b) => (at(a) ? 1 : 0) - (at(b) ? 1 : 0) || at(b) - at(a));
  const done = S.videos.filter(v => v.status === 'posted' && v.coverUrl).sort((a, b) => Date.parse(b.posted?.at || 0) - Date.parse(a.posted?.at || 0));
  const tiles = [...up, ...done].slice(0, 12);
  if (tiles.length < 3 || !up.length) return '';
  return `<section class="panel"><details${S.gridOpen ? ' open' : ''} data-grid><summary>Preview your grid</summary>
    <p class="small muted">How your profile looks once the ${plural(up.length, 'ready video')} go${up.length === 1 ? 'es' : ''} out, newest first. The grid crops reels to 3:4, so keep faces and words near the middle.</p>
    <div class="grid3">${tiles.map(v => `<figure class="tile${v.status === 'approved' ? ' next' : ''}"><img src="${esc(v.coverUrl)}" alt="${esc(v.scenes?.[0]?.text || '')}" loading="lazy">${v.status === 'approved' ? `<figcaption>${at(v) ? esc(when(v.autopost?.at || v.fbpost?.at)) : 'Next'}</figcaption>` : ''}</figure>`).join('')}</div></details></section>`;
}

// While videos are being made, a quiet check every 10 seconds; each one that finishes shows a card with
// its cover and opening line, on whatever page is open.
let watching = false;
async function watchJobs() {
  if (watching || !S.me?.workspace?.onboarded || !can('view')) return;
  watching = true;
  const seen = S.readySeen || (S.readySeen = new Set());
  let since = new Date(Date.now() - 120000).toISOString(), first = true, fails = 0, wait = 0;
  const who = S.me.account?.id + '|' + S.me.workspace.id;
  try {
    for (;;) {
      if (wait) await new Promise(r => setTimeout(r, wait));
      wait = 10000;
      // Stops when the person or workspace changes, or the session ends.
      if (!S.me?.account || !S.me.workspace || S.me.account.id + '|' + S.me.workspace.id !== who) break;
      let r;
      try { r = await api(`/api/jobs/finished?since=${encodeURIComponent(since)}`); fails = 0; }
      catch (e) { if (e.status === 401 || e.status === 403 || ++fails > 5) break; continue; }
      since = r.now;
      const fresh = r.done.filter(j => !seen.has(j.id));
      fresh.forEach(j => { seen.add(j.id); if (!first) readyCard(j); });
      if (fresh.length && !first) { refreshMe().then(badgeFromMe); if (S.view === 'review') loadVideos().then(() => drawReview()).catch(() => {}); }
      first = false;
      if (!r.active) break;
    }
  } finally { watching = false; }
}
function readyCard(j) {
  let box = document.getElementById('ready');
  if (!box) { box = Object.assign(document.createElement('div'), { id: 'ready', className: 'ready' }); box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  if ([...box.children].some(c => c.dataset.ready === String(j.id))) return;   // one card per video
  const ok = j.status === 'done' && j.videoId;
  box.insertAdjacentHTML('beforeend', `<div class="ready-card${ok ? '' : ' bad'}" data-ready="${esc(j.id)}">${ok && j.coverUrl ? `<img src="${esc(j.coverUrl)}" alt="">` : ''}
    <div class="stack" style="gap:2px;flex:1;min-width:0"><b class="small">${ok ? (j.kind === 'fix' ? 'Your fixed video is ready' : 'A new video is ready') : 'A video didn’t finish'}</b><span class="small muted clamp">${esc(ok ? j.hook : j.error)}</span></div>
    ${ok ? `<a class="btn sm primary" href="#/review" data-act="ready-close" data-id="${esc(j.id)}">Review</a>` : `<button class="btn sm" data-act="job-again" data-id="${esc(j.id)}" data-kind="${esc(j.kind)}" data-topic="${esc(j.topic || '')}" data-draft="${esc(j.draftId || '')}">${j.kind === 'fix' ? 'Open Review' : j.kind === 'studio' ? 'Open the draft' : 'Make it again'}</button>`}<button class="x" data-act="ready-close" data-id="${esc(j.id)}" aria-label="Close">×</button></div>`);
  [...box.children].slice(0, -3).forEach(c => c.remove());
}
const badgeFromMe = () => { const b = document.querySelector('.nav a[href="#/review"]'); if (b) b.innerHTML = 'Review' + (S.me?.workspace?.pending ? `<span class="badge">${S.me.workspace.pending}</span>` : ''); };

// After a login: someone else than before gets a fresh page (nothing of theirs stays in memory);
// the same person picks up where they were.
function freshAfterLogin() {
  // Back in a different workspace than this page was loaded for (the session ended): start fresh there.
  if (pageWs && S.me?.workspace?.id && S.me.workspace.id !== pageWs) { location.hash = '#/'; location.reload(); return true; }
  let join = ''; try { join = sessionStorage.getItem('joinToken') || ''; } catch { /* none */ }
  if (join) { try { sessionStorage.removeItem('joinToken'); } catch { /* fine */ } location.hash = `#/invite/${join}`; location.reload(); return true; }
  if (S.prevAccount && S.prevAccount !== S.me?.account?.id) { location.hash = '#/'; location.reload(); return true; }
  pushCheck(); watchJobs();
  return false;
}

// Someone sent here from the team page (Agent Reels) while signed out goes back there once signed in.
// Recruits always land there anyway (render); this brings a leader back to her team instead of Review.
function afterLoginGo() {
  let back = '';
  try { back = sessionStorage.getItem('afterLogin') || ''; sessionStorage.removeItem('afterLogin'); } catch { /* no storage: the usual home */ }
  if (back === 'team' && can('team')) { location.replace('/agent-system/'); return; }
  go('');
}

/* ================= Can't do it right now ================= */
// Buttons that need the AI or a video from this month's allowance are turned off, with the reason,
// when they can't work (budget used up, no plan, all videos made), instead of failing on tap.
const AI_ACTS = ['rewrite', 'test', 'st-hooks', 'st-fill', 'st-ideas', 'st-foot', 'st-hear', 'mind-advice', 'coach-starter', 'comms-starter', 'ws-run', 'weekly-refresh', 'aud-style', 'drill-next'];
const MAKE_ACTS = ['make', 'make-topic', 'next-make', 'plan-make', 'st-render', 'job-again'];
const AI_FORMS = ['footage', 'mind-lens', 'coach', 'coach-reply'];
// Controls that change the workspace's settings: off (with the reason) for people who can't.
const SETTINGS_ACTS = ['keep-ready', 'auto-plan', 'aud-style-set', 'ws-use', 'weekly-apply', 'save-search'];
function cantNow(make) {
  const w = S.me?.workspace;
  if (!w || S.me.account?.role === 'admin' && !S.me.acting) return '';
  if (w.access && !w.access.allowed) return w.access.reason || 'Your plan isn’t active.';
  if (w.spend?.over) return 'This month’s AI budget is used up, so this is paused until next month. Your admin can raise it.';
  if (make && w.limit && w.used >= w.limit) return `You’ve made all ${w.limit} videos this month. More on the 1st.`;
  return '';
}
function markBlocked() {
  if (!main || !S.me?.workspace?.onboarded) return;
  const ai = cantNow(false), mk = cantNow(true);
  let shown = false;
  document.querySelectorAll('[data-act], form[data-form]').forEach(el => {
    const isForm = el.tagName === 'FORM', act = isForm ? el.dataset.form : el.dataset.act;
    const kind = isForm ? (AI_FORMS.includes(act) ? 'ai' : '') : AI_ACTS.includes(act) ? 'ai' : MAKE_ACTS.includes(act) && !(act === 'job-again' && el.dataset.kind !== 'video') ? 'make' : SETTINGS_ACTS.includes(act) && !can('settings') ? 'settings' : '';
    if (!kind) return;
    const why = kind === 'make' ? mk : kind === 'settings' ? 'Only the agent can change this.' : ai;
    const btn = isForm ? el.querySelector('button:not([type="button"])') : el;
    if (!btn) return;
    if (why) { shown = true; if (!btn.disabled) { btn.disabled = true; btn.dataset.blocked = '1'; btn.title = why; } }
    else if (btn.dataset.blocked) { btn.disabled = false; delete btn.dataset.blocked; btn.removeAttribute('title'); }
  });
  const note = document.getElementById('blockedNote');
  if (shown && !note && !main.querySelector('.note.err')) main.insertAdjacentHTML('afterbegin', `<div class="note warn small" id="blockedNote">${esc(mk || ai)}</div>`);
  if (!shown && note) note.remove();
}
let blockQueued = false;
new MutationObserver(() => { if (blockQueued) return; blockQueued = true; requestAnimationFrame(() => { blockQueued = false; markBlocked(); }); }).observe(document.body, { childList: true, subtree: true });

/* ================= Teleprompter ================= */
// For filming yourself saying the script: big text that scrolls at your pace. Space starts and pauses,
// ↑/↓ change the speed, Esc closes. Mirror flips it for a teleprompter glass. The screen stays on.
function teleprompter(lines, title = '') {
  document.getElementById('prompter')?.remove();
  let speed = Number(local.get('prompter.speed')) || 40, size = Number(local.get('prompter.size')) || 40, mirror = local.get('prompter.mirror') === '1', run = false, last = 0, lock = null;
  const el = Object.assign(document.createElement('div'), { id: 'prompter', className: 'prompter' });
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Teleprompter');
  el.innerHTML = `<div class="prompter-bar"><button class="btn sm" data-p="close">Close</button><b class="small">${esc(title)}</b>
      <span class="row"><button class="btn sm" data-p="slower" aria-label="Slower">−</button><span class="small mono" data-p-speed></span><button class="btn sm" data-p="faster" aria-label="Faster">+</button>
      <button class="btn sm" data-p="smaller" aria-label="Smaller text">A−</button><button class="btn sm" data-p="bigger" aria-label="Bigger text">A+</button>
      <button class="btn sm" data-p="mirror" aria-pressed="${mirror}">Mirror</button><button class="btn sm primary" data-p="go">Start</button></span></div>
    <div class="prompter-text"><div class="prompter-pad"></div>${lines.map(l => `<p>${esc(l)}</p>`).join('')}<div class="prompter-pad"></div></div>`;
  document.body.append(el);
  const box = el.querySelector('.prompter-text');
  const paint = () => {
    box.style.fontSize = size + 'px'; box.style.transform = mirror ? 'scaleX(-1)' : '';
    el.querySelector('[data-p-speed]').textContent = speed;
    el.querySelector('[data-p="go"]').textContent = run ? 'Pause' : 'Start';
    el.querySelector('[data-p="mirror"]').setAttribute('aria-pressed', mirror);
    local.set('prompter.speed', speed); local.set('prompter.size', size); local.set('prompter.mirror', mirror ? '1' : '0');
  };
  const step = t => { if (!run) return; if (last) box.scrollTop += speed * (t - last) / 1000; last = t; if (box.scrollTop + box.clientHeight >= box.scrollHeight - 1) { run = false; paint(); return; } requestAnimationFrame(step); };
  const toggle = async () => { run = !run; last = 0; paint(); if (run) { requestAnimationFrame(step); try { lock = await navigator.wakeLock?.request('screen'); } catch { lock = null; } } else { lock?.release?.().catch(() => {}); } };
  const close = () => { run = false; lock?.release?.().catch(() => {}); document.removeEventListener('keydown', key, true); el.remove(); };
  const key = e => {
    e.stopPropagation();   // nothing under the teleprompter reacts to keys while it's open
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === ' ') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); speed = Math.min(200, speed + 5); paint(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); speed = Math.max(5, speed - 5); paint(); }
  };
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-p]'); if (!b) { if (e.target.closest('.prompter-text')) toggle(); return; }
    const k = b.dataset.p;
    if (k === 'close') close(); else if (k === 'go') toggle(); else if (k === 'mirror') { mirror = !mirror; paint(); }
    else if (k === 'faster') speed = Math.min(200, speed + 5); else if (k === 'slower') speed = Math.max(5, speed - 5);
    else if (k === 'bigger') size = Math.min(96, size + 6); else if (k === 'smaller') size = Math.max(20, size - 6);
    paint();
  });
  document.addEventListener('keydown', key, true);
  paint();
}

/* ================= Soft close: delete and reject with a 10-second Undo ================= */
// The item goes at once, with Undo on the toast. Nothing is sent until the Undo has had its time, or
// the page is closed or hidden, when what's waiting goes straight away (so a decision is never lost).
// Loaders skip what's waiting (softGone), so a refresh in the meantime doesn't bring it back.
// `hide()`: takes it off the screen now. `run({ keepalive })`: does it. `after()`: puts the screen back
// in step (after Undo, after it's done, or if it failed).
const soft = new Map();
const softMs = () => { try { return Number(sessionStorage.getItem('soft-ms')) || 10000; } catch { return 10000; } };   // (shorter only in the browser tests)
const softGone = key => soft.has(key);
function softly(key, { label, hide, run, after }) {
  if (soft.has(key)) return;
  soft.set(key, { run, after, t: setTimeout(() => softCommit(key), softMs()) });
  hide();
  toast(label, { action: 'Undo', act: 'soft-undo', key, ms: softMs() });
}
// `how`: '' (its time is up), 'hidden' (the page went out of sight: sent now, and the screen catches up
// when it's back), 'closing' (the page is going away: sent, nothing more to do here).
async function softCommit(key, how = '') {
  const s = soft.get(key);
  if (!s || s.going) return;
  s.going = true; clearTimeout(s.t);
  try { await s.run({ keepalive: !!how }); } catch (e) { if (how !== 'closing') toast(e.message); }
  soft.delete(key);
  if (how !== 'closing') await Promise.resolve(s.after()).catch(() => {});
}
// Everything waiting, sent now (before logging out, say). Resolves when it's done.
const softNow = () => Promise.all([...soft.keys()].map(k => softCommit(k, 'hidden')));
function softUndo(key) {
  const s = soft.get(key);
  if (!s || s.going) return;
  clearTimeout(s.t); soft.delete(key);
  toast('Undone');
  Promise.resolve(s.after()).catch(() => {});
}
const softFlush = how => {
  if (!soft.size) return;
  for (const k of [...soft.keys()]) softCommit(k, how);
  document.getElementById('toast')?.classList.remove('show', 'has-action');   // its Undo has gone with it
};
addEventListener('pagehide', () => softFlush('closing'));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') softFlush('hidden'); });

/* ================= Preloading the next video ================= */
// While the agent watches one video, the next one waiting for review is fetched into the device's
// preload cache (sw.js plays it from there, byte ranges and all), so it starts the moment it's opened.
// At most PRELOAD_MAX are kept; nothing is fetched on a data saver or a slow connection. Without the
// service worker in charge yet, the next player is simply told to load ahead.
const PRELOAD = 'preload-v1', PRELOAD_MAX = 3;
const thrifty = () => { const c = navigator.connection; return !!(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))); };
const preloading = new Map();   // url → the fetch already under way (a pause and play doesn't fetch it twice)
function preloadMedia(url) {
  if (!url || thrifty() || !offlineOK() || !navigator.serviceWorker.controller) return Promise.resolve(false);
  if (!preloading.has(url)) preloading.set(url, (async () => {
    try {
      const cache = await caches.open(PRELOAD);
      if (await cache.match(url)) return true;
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok || Number(res.headers.get('content-length') || 0) > 60e6) return false;
      await cache.put(url, res);
      // The oldest go once the new one is in (never the one just kept).
      const keys = (await cache.keys()).filter(k => new URL(k.url).pathname !== url);
      for (const k of keys.slice(0, Math.max(0, keys.length - PRELOAD_MAX + 1))) await cache.delete(k);
      return true;
    } catch { return false; } finally { preloading.delete(url); }
  })());
  return preloading.get(url);
}
// Only what's still waiting for review stays preloaded.
async function prunePreload(keep) {
  if (!('caches' in window)) return;
  try { const cache = await caches.open(PRELOAD); for (const k of await cache.keys()) if (!keep.has(new URL(k.url).pathname)) await cache.delete(k); } catch { /* nothing kept */ }
}
function preloadAfter(video) {
  const players = [...document.querySelectorAll('#main video.player')], at = players.indexOf(video);
  const pending = S.videos.filter(v => v.status === 'pending' && v.media && !softGone(`video:${v.id}`));
  const cur = pending.findIndex(v => video.currentSrc?.endsWith(v.media) || video.getAttribute('src') === v.media);
  const next = cur >= 0 ? pending[cur + 1] : null;
  if (next) preloadMedia(next.media).then(ok => { if (!ok && players[at + 1]) players[at + 1].preload = 'auto'; });
}
document.addEventListener('play', e => { if (e.target.matches?.('#main video.player')) preloadAfter(e.target); }, true);

/* ================= Offline review ================= */
// "Save for offline" keeps the videos waiting for review on this device (and the lists the page
// needs), so they can be watched and decided on with no connection. Decisions made offline wait here
// and go out by themselves when the connection is back; the server checks each one as usual.
const offlineOK = () => 'serviceWorker' in navigator && 'caches' in window;
const OFFLINE_DATA = ['/api/me', '/api/videos', '/api/config'];
async function saveOffline() {
  await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const media = await caches.open('media-v1'), data = await caches.open('offline-v1');
  const pending = S.videos.filter(v => v.status === 'pending' && v.media);
  const keep = new Set(pending.flatMap(v => [v.media, v.coverUrl].filter(Boolean)));
  for (const k of await media.keys()) if (!keep.has(new URL(k.url).pathname)) await media.delete(k);
  for (const u of keep) if (!(await media.match(u))) await media.add(u);
  for (const u of OFFLINE_DATA) { const r = await fetch(u, { credentials: 'same-origin' }); if (r.ok) await data.put(u, r); }
  local.set(wsKey('offlineAt'), new Date().toISOString());
  return pending.length;
}
async function clearOffline() { try { await Promise.all(['media-v1', 'offline-v1', PRELOAD].map(n => caches.delete(n))); } catch { /* nothing kept */ } }
const offlineQueueKey = () => wsKey('offlineQueue');
const readQueue = () => { try { return JSON.parse(local.get(offlineQueueKey()) || '[]'); } catch { return []; } };
// A video decided online (or the page reloaded) drops any offline decision for it that's still waiting.
const unqueue = id => { const q = readQueue().filter(x => x.id !== id); if (q.length) local.set(offlineQueueKey(), JSON.stringify(q)); else local.del(offlineQueueKey()); };
// Decisions still waiting to be sent show as made, so the list matches what the agent did.
function overlayQueue() {
  for (const x of readQueue()) {
    const v = S.videos.find(y => y.id === x.id);
    if (!v || v.status !== 'pending') { if (v) unqueue(x.id); continue; }
    v.status = x.kind === 'reject' ? 'rejected' : 'approved'; v.offlineQueued = true;
    if (x.kind === 'reject') v.rejection = { reason: x.body.reason, note: x.body.note };
  }
}
function queueOffline(item) {
  const q = readQueue().filter(x => x.id !== item.id);
  local.set(offlineQueueKey(), JSON.stringify([...q, { ...item, at: new Date().toISOString() }]));
}
let flushing = false;
async function flushOffline() {
  const q = readQueue();
  if (!q.length || flushing || !S.me?.account) return;
  flushing = true;
  const left = [];
  let sent = 0;
  for (const x of q) {
    try { await api(x.path, { method: 'POST', body: x.body, key: x.key }); sent++; }
    catch (e) { if (e.offline) left.push(x); else toast(`${x.label} for one video didn’t go through: ${e.message}`); }
  }
  if (left.length) local.set(offlineQueueKey(), JSON.stringify(left)); else local.del(offlineQueueKey());
  flushing = false;
  if (sent) { toast(`Sent ${plural(sent, 'decision')} you made offline.`); if (S.view === 'review') { await loadVideos().catch(() => {}); drawReview(); } }
}
// A decision that couldn't reach the server: kept, and shown as done here until it's sent.
function decideOffline(id, kind, body) {
  const v0 = S.videos.find(x => x.id === id);
  queueOffline({ id, kind, key: newKey(), path: `/api/videos/${id}/${kind}`, body: { ...body, offline: true, version: v0?.version || 1, decidedAt: new Date().toISOString() }, label: kind === 'approve' ? 'Approval' : 'Rejection' });
  const v = S.videos.find(x => x.id === id);
  if (v) { v.status = kind === 'approve' ? 'approved' : 'rejected'; v.offlineQueued = true; if (kind === 'reject') v.rejection = { reason: body.reason, note: body.note }; }
  S.open = {}; drawReview(); haptic2(20);
  toast('Saved here. It’ll be sent when you’re back online.');
}

/* ================= Notifications on this device (Web Push) ================= */
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const keyBytes = k => { const s = atob(k.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((k.length + 3) % 4)); return Uint8Array.from(s, c => c.charCodeAt(0)); };
async function loadPush() {
  if (!S.me?.workspace) return;
  if (!pushSupported()) S.push = { state: 'unsupported' };
  else if (Notification.permission === 'denied') S.push = { state: 'blocked' };
  else {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/'), sub = reg && await reg.pushManager.getSubscription();
      const r = await api('/api/push' + (sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : ''));
      const on = !!sub && r.here === true && Notification.permission === 'granted';
      S.push = { state: !r.own ? 'notyours' : on ? 'on' : 'off', key: r.publicKey, devices: r.devices, problem: r.devices.some(d => d.problem) };
    } catch (e) { S.push = { state: 'error', error: e.message }; }
  }
  const box = document.getElementById('pushPanel');
  if (box) box.innerHTML = pushInner();
}
// A browser only gets notifications for whoever is logged in on it: one left on from someone else's
// login is turned off here (their other devices keep theirs).
async function pushCheck() {
  try {
    if (!S.me?.workspace || !pushSupported() || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.getRegistration('/'), sub = reg && await reg.pushManager.getSubscription();
    if (!sub) return;
    const r = await api(`/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`);
    if (r.own && r.here === false) await sub.unsubscribe();
  } catch { /* nothing to do */ }
}
function pushInner() {
  const p = S.push || { state: 'loading' };
  const head = '<h2>Notifications</h2>';
  if (p.state === 'loading') return `${head}<p class="small muted"><span class="spin"></span> Checking this browser…</p>`;
  if (p.state === 'unsupported') return `${head}<p class="small" style="margin:0">This browser can’t show notifications from the app. On an iPhone or iPad, add the app to your Home Screen first (Share, then Add to Home Screen), open it from there, and turn them on here.</p>`;
  if (p.state === 'blocked') return `${head}<p class="small" style="margin:0">Notifications are blocked for this site in your browser settings. Allow them there, then come back.</p>`;
  if (p.state === 'notyours') return `${head}<p class="small muted" style="margin:0">Notifications are for the people in this workspace, on their own logins.</p>`;
  if (p.state === 'error') return `${head}<p class="small muted" style="margin:0">Couldn’t check notifications right now. <button class="btn sm ghost" data-act="push-retry">Try again</button></p>`;
  return `${head}<p class="small" style="margin:0">${p.state === 'on' ? 'On for this device. ' : ''}A ping on this device when a video is ready to review, with its opening line. Never between 9pm and 7am, and not for videos made overnight (they’re in your morning greeting).</p>
    <div class="row">${p.state === 'on' ? '<button class="btn sm" data-act="push-test">Send a test</button><button class="btn sm ghost" data-act="push-off">Turn off on this device</button>' : '<button class="btn sm primary" data-act="push-on">Turn on for this device</button>'}</div>${p.devices?.length ? `<p class="small muted" style="margin:0">On for you on: ${p.devices.map(d => `${esc(d.device)} (since ${esc(day(d.at))})`).join(', ')}</p>` : ''}
    ${p.problem ? '<div class="note warn small">A push service turned down a message for one of your devices. Turn notifications off and on again on that device.</div>' : ''}`;
}
// Logging out stops this browser's notifications for this account.
async function pushOffHere() {
  try {
    if (!pushSupported()) return;
    const reg = await navigator.serviceWorker.getRegistration('/'), sub = reg && await reg.pushManager.getSubscription();
    if (!sub) return;
    await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  } catch { /* logging out still works */ }
}

/* ================= Never lose an edit: undo and a local copy of unsaved changes ================= */
// Every change to Content, Brand or Settings can be undone (the Undo button, or Ctrl/⌘+Z outside a text
// box), and unsaved changes are kept in this browser, so a closed tab or a dead battery doesn't lose
// them. They're offered back the next time the page opens. Typing in one field counts as one step.
const UNDO_MAX = 40;
let lastSnap = '', lastField = null, lastAt = 0;
const draftKey = () => wsKey('cfgDraft');
const sigOf = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };
function trackEdit() {
  if (!S.cfg) return;
  const now = JSON.stringify(S.cfg);
  if (!lastSnap) { lastSnap = S.saved || now; }
  if (now === lastSnap) return;
  // Back to exactly what's saved (or saved elsewhere): nothing to undo or keep.
  if (!dirty()) { lastSnap = now; S.undo = []; clearTimeout(trackEdit.t); local.del(draftKey()); return; }
  // Typing in the same text box within a moment is one step; anything else (a toggle, a button) is its own.
  const el = document.activeElement, typing = el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'file'].includes(el.type)));
  const field = typing ? el : null;
  const sameTyping = field && field === lastField && Date.now() - lastAt < 1500 && (S.undo || []).length;
  if (!sameTyping) { (S.undo ||= []).push(lastSnap); if (S.undo.length > UNDO_MAX) S.undo.shift(); }
  lastSnap = now; lastField = field; lastAt = Date.now();
  if (SETTINGS_VIEWS[S.view]) S.editView = S.view;   // where these changes were made, for the reminder elsewhere
  clearTimeout(trackEdit.t);
  trackEdit.t = setTimeout(() => { if (dirty()) local.set(draftKey(), JSON.stringify({ base: sigOf(S.saved), at: new Date().toISOString(), cfg: S.cfg })); else local.del(draftKey()); }, 600);
}
function resetEdits() { S.undo = []; lastSnap = S.saved || ''; lastField = null; clearTimeout(trackEdit.t); }
function undoEdit() {
  if (!S.undo?.length) return false;
  S.cfg = JSON.parse(S.undo.pop()); lastSnap = JSON.stringify(S.cfg); lastField = null;
  if (!dirty()) local.del(draftKey());
  saveBar(); redraw(); toast('Undone');
  return true;
}
// A copy of unsaved changes from before, offered on top of the saved settings. It's moved aside under
// its own key, so new edits can't overwrite it, and stays until it's restored or thrown away.
const oldDraftKey = () => wsKey('cfgDraftOld');
function readDraft(key) { try { return JSON.parse(local.get(key) || 'null'); } catch { return null; } }
function draftOffer() {
  let d = readDraft(oldDraftKey());
  if (!d) { d = readDraft(draftKey()); if (d) { local.set(oldDraftKey(), JSON.stringify(d)); local.del(draftKey()); } }
  if (!d?.cfg || JSON.stringify(migrate(d.cfg)) === S.saved) { local.del(oldDraftKey()); return ''; }
  const changed = d.base !== sigOf(S.saved);
  return `<div class="note" id="draftNote"><b>You have unsaved changes from ${esc(when(d.at))}.</b> ${changed ? 'Your settings were saved somewhere else since then, so restoring replaces those changes. ' : ''}<span class="row" style="margin-top:6px"><button class="btn sm primary" data-act="draft-restore">Restore them</button><button class="btn sm ghost" data-act="draft-drop">Throw them away</button></span></div>`;
}

/* ================= Config editing (shared by Content, Brand, Settings) ================= */
async function loadCfg(force = false) {
  if (S.cfg && !force) return;
  const r = await api('/api/config');
  setCfg(r.config, r.versions);
}
function setCfg(c, versions) { S.cfg = migrate(c); S.saved = JSON.stringify(S.cfg); if (versions) S.versions = versions; resetEdits(); }
const dirty = () => !!S.cfg && JSON.stringify(S.cfg) !== S.saved;
// The pages where settings are edited. Elsewhere (Account, Guide, Review…) there's nothing to save, so
// changes still waiting from one of these pages show as a short reminder of where they are (v15).
const SETTINGS_VIEWS = { content: 'Content', brand: 'Brand', settings: 'Settings', profile: 'Setup → Profile', library: 'Setup → Topics', voice: 'Setup → Voice and rules', look: 'Setup → Look', autopilot: 'Setup → Autopilot' };
function saveBar() {
  const bar = document.getElementById('savebar');
  trackEdit();
  if (!bar) return;
  bar.hidden = !dirty();
  document.body.classList.toggle('has-savebar', dirty());
  if (!dirty()) return dockHeight();
  const here = !!SETTINGS_VIEWS[S.view], from = SETTINGS_VIEWS[S.editView] || '';
  bar.innerHTML = here
    ? `<div><span class="small"><b>Unsaved changes.</b> The next video uses them once saved.</span><div class="row">${S.undo?.length ? '<button class="btn ghost" data-act="undo" title="Ctrl+Z">Undo</button>' : ''}<button class="btn ghost" data-act="discard">Discard</button><button class="btn primary" data-act="save">Save changes</button></div></div>`
    : `<div><span class="small"><b>Unsaved changes${from ? ` in ${from}` : ''}.</b> Nothing on this page needs saving.</span><div class="row">${from ? `<button class="btn ghost" data-act="savebar-go">Go back to them</button>` : ''}<button class="btn ghost" data-act="discard">Discard</button><button class="btn primary" data-act="save">Save them</button></div></div>`;
  dockHeight();
}
// How tall the save bar really is (it wraps to two lines on a phone), so the Coach button and the ready
// cards sit just above it rather than on it.
function dockHeight() {
  const bar = document.getElementById('savebar');
  document.documentElement.style.setProperty('--dock', bar && !bar.hidden ? `${bar.offsetHeight}px` : '0px');
}
window.addEventListener('resize', dockHeight);
// A worry picked in the simple start: the audience and fact follow from it, and the format takes turns.
// surprise: any format that fits, at random, instead of taking turns.
async function stPickWorry(painId, surprise = false) {
  if (!painId) return stBrief({ painId: '', insightIds: [] });
  const recent = (S.studioList?.recentFormats || []).filter(x => x.id !== S.st.d.id).map(x => x.format);
  const brief = { ...S.st.d.brief, painId, audienceId: '', insightIds: [] };
  const fits = Object.keys(FORMATS).filter(k => !FORMATS[k].needs && k !== 'local' && !studioPicks(S.cfg, { ...brief, format: k }).problems.length);
  const format = surprise && fits.length ? fits[Math.floor(Math.random() * fits.length)] : studioFormatFor(S.cfg, brief, recent);
  return stBrief({ painId, audienceId: '', insightIds: [], format });
}
// The save bar rides just above the on-screen keyboard (an iPad's, a phone's), so Discard and Save stay
// in reach, and the box being typed in is never left under the keyboard or the bar, on any screen (v15).
// Only when the keyboard opens or a box gets focus: scrolling the page yourself while typing is left alone.
function keepBarClear(e) {
  const vv = window.visualViewport, bar = document.getElementById('savebar');
  if (!vv) return;
  const covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  if (bar) bar.style.transform = covered > 40 ? `translateY(${-covered}px)` : '';
  // Room below the last box on the page, so even it can scroll up clear of the keyboard.
  document.documentElement.style.setProperty('--kb', covered > 40 ? `${covered}px` : '0px');
  if (e?.type === 'scroll') return;
  const f = document.activeElement;
  if (!f?.closest?.('main')) return;   // the Coach panel, the teleprompter: fixed in place, they handle their own
  if (!f?.matches?.('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), textarea, select, [contenteditable="true"]')) return;
  const r = f.getBoundingClientRect(), bottom = Math.min(vv.offsetTop + vv.height, bar && !bar.hidden ? bar.getBoundingClientRect().top : Infinity);
  // Up just far enough to sit clear of the keyboard (its top never above what's visible).
  if (r.bottom > bottom - 8) window.scrollBy(0, Math.min(r.bottom - (bottom - 16), r.top - (vv.offsetTop + 8)));
}
window.visualViewport?.addEventListener('resize', keepBarClear);
window.visualViewport?.addEventListener('scroll', keepBarClear);
document.addEventListener('focusin', () => setTimeout(keepBarClear, 350));
async function saveCfg() {
  const r = await api('/api/config', { method: 'PUT', body: { config: S.cfg } });
  setCfg(r.config, r.versions);
  local.del(draftKey());
  saveBar();
  toast('Saved');
}
// One change saved by itself (a coach suggestion): made to the saved settings and saved at once, and to
// the page's copy too, so any other edits still waiting stay unsaved, as they were.
async function saveOneChange(change) {
  const clean = !dirty();
  const r = await api('/api/config', { method: 'PUT', body: { config: change(migrate(JSON.parse(S.saved))) } });
  if (clean) setCfg(r.config, r.versions);
  else {
    // The same change goes into what's on screen and every Undo step too, so undoing the other edits
    // comes back to exactly what was saved (`change` must give the same result each time it's applied:
    // a new item keeps one id).
    const also = j => { try { return JSON.stringify(change(migrate(JSON.parse(j)))); } catch { return j; } };
    S.cfg = change(S.cfg); S.saved = JSON.stringify(migrate(r.config)); if (r.versions) S.versions = r.versions;
    S.undo = (S.undo || []).map(also); lastSnap = JSON.stringify(S.cfg);
  }
  saveBar();
}
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; }

/* ================= Account: public/screens/account.js ================= */
/* ================= Setup: public/screens/setup.js ================= */
/* ================= Review: public/screens/review.js ================= */
// What stays here from it: it runs as the page loads (the screen file loads before this one runs).
// What helps when videos keep getting rejected for the same reason.
const REJECT_TIPS = {
  'Weak opening': 'Paste a few of your own captions and the real questions you hear in Setup → Voice and rules. New openings learn from them and from openings that brought messages.',
  'Wrong footage': 'Check who each audience shows “In the footage”, and save searches that score 4–5 in Create → Test footage.',
  'Too salesy': 'In Setup → Voice and rules, try a calmer energy or add a rule like “Teach, never pitch”.',
  'Not accurate': 'Re-check the fact this video used in Setup → Topics. Reword it, or untick it until it’s right.',
  'Not my voice': 'Paste 2–3 captions you wrote yourself in Setup → Voice and rules. That changes the wording more than any setting.',
  'Wrong music': 'That track won’t be picked for you again. Setup → Voice and rules → What the app remembers can undo it.',
};
document.addEventListener('keydown', focusKey);
// Swipes move between videos (never approve): a mostly sideways swipe, not starting on the player.
let swipe = null;
document.addEventListener('touchstart', e => { swipe = S.view === 'review' && S.focus && !e.target.closest('video, input, textarea, select, button') && e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null; }, { passive: true });
document.addEventListener('touchend', e => {
  if (!swipe || !S.focus) return;
  const t = e.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
  if (Math.abs(dx) > 70 && Math.abs(dy) < 50 && Date.now() - swipe.t < 700) { actions['focus-go']({ dataset: { d: dx < 0 ? '1' : '-1' } }); haptic2(); }
  swipe = null;
}, { passive: true });
/* ================= Create: public/screens/create.js ================= */
/* ================= Studio: public/screens/studio.js ================= */
// What stays here from it: it runs as the page loads (the screen file loads before this one runs).
S.st = null;   // the open draft: { d, foot: {}, rw: {}, busy: '', saveTimer }
/* ================= Content: public/screens/content.js ================= */
/* ================= Mindset: public/screens/mindset.js ================= */
/* ================= Brand: public/screens/brand.js ================= */
/* ================= Settings: public/screens/settings.js ================= */
/* ================= Communicate: public/screens/communicate.js ================= */
/* ================= Team: public/screens/team.js ================= */
/* ================= Admin: public/screens/admin.js ================= */
// What stays here from it: it runs as the page loads (the screen file loads before this one runs).
// Activity log (audit): who did what, newest first. Filters: workspace and kind.
S.auditF = { ws: '', kind: '', limit: 30 };
/* ================= Events ================= */
const actions = {
  async 'twofa-setup'(el) {
    el.disabled = true;
    try { S.twofa = await api('/api/2fa/setup', { method: 'POST', body: {} }); drawTwofa(); document.querySelector('[data-form="twofa-enable"] input')?.focus(); }
    catch (e) { toast(e.message); el.disabled = false; }
  },
  'twofa-cancel-setup'() { S.twofa = null; drawTwofa(); },
  'twofa-copy'() { copy(S.twofaCodes.join('\n'), 'Backup codes'); },
  async 'twofa-done'() { S.twofaCodes = null; if (S.view === 'twofa') { await refreshMe(); go(''); } else drawTwofa(); },
  'twofa-cancel'(el, e) { e?.preventDefault?.(); S.ticket = null; S.ticketMsg = ''; go('login'); },
  async 'session-end'(el) {
    el.disabled = true;
    try { drawSessions((await api(`/api/account/sessions/${el.dataset.id}`, { method: 'DELETE' })).sessions); toast('Logged out on that device'); }
    catch (e) { toast(e.message); el.disabled = false; }
  },
  async 'sessions-others'(el) {
    el.disabled = true;
    try { drawSessions((await api('/api/account/sessions/logout-others', { method: 'POST', body: {} })).sessions); toast('Logged out everywhere else'); }
    catch (e) { toast(e.message); el.disabled = false; }
  },
  async 'delete-cancel'(el) {
    el.disabled = true;
    try { const r = await api('/api/data/delete-request', { method: 'DELETE' }); S.me.workspace = r.workspace; await viewAccount(); toast('Request canceled. Nothing was deleted.'); }
    catch (e) { toast(e.message); el.disabled = false; }
  },
  // A different person or workspace starts from a fresh page, so nothing from the last one (drafts,
  // coach chats) stays in memory.
  async logout() { await softNow(); try { Object.keys(sessionStorage).filter(k => k.startsWith('coach.')).forEach(k => sessionStorage.removeItem(k)); } catch { /* nothing kept */ } await pushOffHere(); await clearOffline(); local.del(draftKey()); local.del(oldDraftKey()); local.del(wsKey('offlineAt')); await api('/api/logout', { method: 'POST', body: {} }).catch(() => {}); location.hash = '#/login'; location.reload(); },
  async 'leave-ws'() { await api('/api/admin/open', { method: 'POST', body: { workspaceId: null } }); location.hash = '#/admin'; location.reload(); },
  async save() { try { await saveCfg(); if (SETTINGS_VIEWS[S.view] || S.view === 'create') redraw(); } catch (e) { toast(e.message); } },
  discard() { S.cfg = JSON.parse(S.saved); resetEdits(); local.del(draftKey()); saveBar(); redraw(); },
  'savebar-go'() { if (SETTINGS_VIEWS[S.editView]) go(S.editView); },
  undo() { undoEdit(); },
  'draft-restore'() {
    const d = readDraft(oldDraftKey());
    document.getElementById('draftNote')?.remove(); local.del(oldDraftKey());
    if (!d?.cfg) return toast('That copy is gone.');
    S.undo = [...(S.undo || []), JSON.stringify(S.cfg)]; S.cfg = migrate(d.cfg); lastSnap = JSON.stringify(S.cfg);
    saveBar(); redraw(); toast('Restored. Save to keep them.');
  },
  'draft-drop'() { local.del(oldDraftKey()); document.getElementById('draftNote')?.remove(); },
  async 'offline-save'(el) {
    el.disabled = true; el.innerHTML = '<span class="spin"></span> Saving…';
    try { const n = await saveOffline(); toast(n ? `Saved ${plural(n, 'video')}. You can review ${n === 1 ? 'it' : 'them'} with no connection.` : 'Nothing waiting to save.'); }
    catch { toast('This browser couldn’t save the videos. Try again with a good connection.'); }
    drawReview();
  },
  // The download itself is the link; afterwards the receipt shows (and an email goes out).
  async 'export-note'(el, e) {
    e?.preventDefault?.();
    el.classList.add('busy'); const label = el.textContent; el.innerHTML = '<span class="spin"></span> Preparing your data…';
    try {
      const res = await fetch(el.getAttribute('href'), { credentials: 'same-origin', headers: wsHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || SERVER_TROUBLE);
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'my-data.json';
      const url = URL.createObjectURL(await res.blob()), a = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast('Downloaded.');
      await refreshMe(); if (S.view === 'account') return viewAccount();
    } catch (err) { toast(fetchError(err).message); }
    el.classList.remove('busy'); el.textContent = label;
  },
  'page-retry'() { render(); },
  async 'join-accept'(el) {
    el.disabled = true;
    try { await api('/api/link/join', { method: 'POST', body: { token: el.dataset.token } }); try { sessionStorage.removeItem('joinToken'); } catch { /* fine */ } location.hash = '#/'; location.reload(); }
    catch (e) { el.disabled = false; status(document.querySelector('[data-st]'), e.message, 'err'); }
  },
  async 'person-del'(el) {
    if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Tap again to remove'; setTimeout(() => { if (document.contains(el)) { el.dataset.confirm = ''; el.textContent = 'Remove'; } }, 3000); return; }
    try { S.people = { ...S.people, ...(await api(`/api/people/${el.dataset.id}`, { method: 'DELETE' })) }; drawTeam(); toast('Removed'); } catch (e) { toast(e.message); }
  },
  // The initial's menu: Account, Guide, Log out.
  menu(el) { const pop = document.getElementById('mePop'); if (!pop) return; pop.hidden = !pop.hidden; el.setAttribute('aria-expanded', String(!pop.hidden)); if (!pop.hidden) pop.querySelector('a')?.focus(); },
  'copy-text'(el) { copy(el.dataset.text || '', el.dataset.what || 'Address'); },
  async 'signoff-on'(el) {
    el.disabled = true;
    try { S.people = { ...S.people, ...(await api('/api/people/signoff', { method: 'POST', body: { on: el.dataset.v === '1' } })) }; await refreshMe(); drawTeam(); toast(el.dataset.v === '1' ? 'Approved videos now wait for sign-off' : 'Sign-off turned off'); }
    catch (e) { el.disabled = false; toast(e.message); }
  },
  async 'invite-del'(el) { try { S.people = { ...S.people, ...(await api('/api/people/invites/revoke', { method: 'POST', body: { email: el.dataset.email } })) }; drawTeam(); toast('Invite taken back'); } catch (e) { toast(e.message); } },
  'page-reload'() { location.reload(); },
  'engine-retry'() { loadEngine(); },
  'update-now'() { keepDraft(); location.reload(); },
  async 'engine-job'(el) {
    const out = document.querySelector(`[data-tl="${CSS.escape(el.dataset.i)}"]`);
    if (!out) return;
    if (out.innerHTML) { out.innerHTML = ''; return; }
    try {
      const j = await api(`/api/admin/engine/job/${encodeURIComponent(el.dataset.id)}`);
      const T = (j.runs || []).find(r => String(r.attempt) === el.dataset.attempt) || j.timeline;
      out.innerHTML = T ? `<ol class="small mono" style="margin:6px 0;padding-left:18px">${T.events.map(ev => `<li>${(ev.t / 1000).toFixed(1)} s · ${ev.step ? `<b>${esc(ev.step)}</b>` : `${esc(ev.service)}${ev.detail ? ` (${esc(ev.detail)})` : ''} ${(ev.ms / 1000).toFixed(1)} s${ev.ok ? '' : ' <b class="err">failed</b>'}`}</li>`).join('')}</ol>${T.dropped ? `<span class="small muted">…and ${T.dropped} more</span>` : ''}` : '<span class="small muted">No timeline for this one.</span>';
    } catch (e) { out.innerHTML = `<span class="small muted">${esc(e.message)}</span>`; }
  },
  'audit-retry'() { loadAudit(); },
  'coach-retry'() { const m = S.coach.msgs.pop(); const q = m?.retry; if (q && S.coach.msgs[S.coach.msgs.length - 1]?.role === 'user') S.coach.msgs.pop(); if (q) sendCoach(q); else drawCoach(); },
  'coach-notes-retry'() { S.coach.notes = null; S.coach.notesFailed = false; drawCoach(); loadCoachNotes(); },
  async 'social-retry'(el) { el.disabled = true; await loadIg(); drawBrand(); },
  async 'lib-retry'(el) { el.disabled = true; await loadLibrary(); drawBrand(); },
  async 'memory-retry'(el) { el.disabled = true; await loadMemory(); drawMemory(); },
  async 'sessions-retry'() { const box = document.getElementById('sessionsPanel'); if (box) box.innerHTML = '<h2>Where you’re logged in</h2><p class="small muted"><span class="spin"></span> Checking where you’re logged in…</p>'; loadSessions(); },
  'st-save-retry'() { const el = document.getElementById('stSaved'); if (el) el.textContent = 'Saving…'; stSave(0); },
  // A video that didn't finish: make it again (it didn't count toward the month).
  'job-again'(el) {
    const d = el.dataset;
    document.querySelector(`[data-ready="${d.id}"]`)?.remove();
    if (d.kind === 'studio' && d.draft) return go('studio', d.draft);
    if (d.kind === 'fix') return go('review');
    makeVideos(1, d.topic || '');
  },
  async 'outage-retry'(el) { el.disabled = true; try { await api('/api/me'); outage(false); flushOffline(); render(); } catch { el.disabled = false; } },
  'day-off'(el) { const k = +el.dataset.v, d = S.cfg.profile.daysOff || []; S.cfg.profile.daysOff = d.includes(k) ? d.filter(x => x !== k) : [...d, k].sort(); if (S.cfg.profile.daysOff.length > 6) S.cfg.profile.daysOff = d; drawSettings(); saveBar(); },
  nav(el) { location.hash = el.getAttribute('href'); },
  'keys-close'() { local.set(wsKey('keys'), 'done'); drawCreate(); },
  async 'keys-make'(el) { el.disabled = true; await makeVideos(1); drawCreate(); },
  'ready-close'(el) { document.querySelector(`[data-ready="${el.dataset.id}"]`)?.remove(); if (el.tagName === 'A') go('review'); },
  'push-retry'() { S.push = null; loadPush(); },
  async 'push-on'(el) {
    el.disabled = true;
    try {
      if (await Notification.requestPermission() !== 'granted') { toast('Notifications weren’t allowed.'); return loadPush(); }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const old = await reg.pushManager.getSubscription();
      if (old) await old.unsubscribe().catch(() => {});
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(S.push.key) });
      await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
      toast('Notifications are on for this device');
    } catch (e) { toast(e.status ? e.message : 'This browser couldn’t turn notifications on. Try again, or use another browser.'); }
    loadPush();
  },
  async 'push-off'(el) { el.disabled = true; await pushOffHere(); toast('Notifications are off for this device'); loadPush(); },
  async 'push-test'(el) { el.disabled = true; try { await api('/api/push/test', { method: 'POST', body: {} }); toast('Sent. It should show up in a few seconds.'); } catch (e) { toast(e.message); } el.disabled = false; },
  async 'memory-forget'(el) { try { S.memory = await api('/api/memory/forget', { method: 'POST', body: { what: el.dataset.v } }); drawMemory(); toast('Forgotten'); } catch (e) { toast(e.message); } },

  // Setup
  'setup-back'() { S.setup.step--; drawSetup(); window.scrollTo(0, 0); },
  'setup-next'(el) {
    const a = S.setup.answers;
    if (S.setup.step === 1 && !a.name.trim()) return status(main.querySelector('[data-st]'), 'Add your name.', 'err');
    S.setup.step++; drawSetup(); window.scrollTo(0, 0);
  },
  'state-del'(el) { S.setup.answers.states.splice(+el.dataset.i, 1); drawSetup(); },
  keep(el) { S.setup.keepContent = el.dataset.v === '1'; drawSetup(); },
  ans(el) { S.setup.answers[el.dataset.k] = el.dataset.v; drawSetup(); },
  async 'setup-draft'(el) {
    const st = main.querySelector('[data-st]');
    el.disabled = true; el.innerHTML = '<span class="spin"></span> ' + (S.setup.keepContent && S.setup.hasContent ? 'Loading…' : 'Drafting your content… about 20 seconds');
    try {
      const r = await api('/api/setup/draft', { method: 'POST', body: { answers: S.setup.answers, keepContent: S.setup.keepContent && S.setup.hasContent } });
      S.setup.draft = r.config; S.setup.note = r.note; S.setup.step = 4; drawSetup(); window.scrollTo(0, 0);
    } catch (e) { status(st, e.message, 'err'); el.disabled = false; el.textContent = 'Try again'; }
  },
  accept(el) { S.setup.accept = el.checked; },
  async 'setup-finish'(el) {
    const st = main.querySelector('[data-st]');
    if (!S.setup.draft.topics.some(i => i.confirmed && i.fact)) return status(st, 'Check at least one topic.', 'err');
    if (!S.setup.accept) return status(st, 'Tick the box above to finish.', 'err');
    if (S.me.termsRequired && !S.setup.acceptTerms) return status(st, 'Accept the Terms of Service and Privacy Policy to finish.', 'err');
    el.disabled = true;
    try {
      const r = await api('/api/setup/finish', { method: 'POST', body: { config: S.setup.draft, accept: true, acceptTerms: !!S.setup.acceptTerms } });
      setCfg(r.config); S.setup = null; await refreshMe(); local.set(wsKey('keys'), 'open'); go('create');   // (v15: the keys, on Create)
    } catch (e) { status(st, e.message, 'err'); el.disabled = false; }
  },

  // Review
  async 'copy-post'(el) { const v = S.videos.find(x => x.id === el.dataset.id); if (v) copy(v.post, 'Post text'); },
  async approve(el) {
    const id = el.dataset.id, checklist = [...main.querySelectorAll(`[data-chk="${id}"]:checked`)].map(x => x.value);
    el.disabled = true;
    // The version on screen is the one approved: if a newer one arrived meanwhile, it's shown instead.
    const seen = S.videos.find(x => x.id === id);
    try { await api(`/api/videos/${id}/approve`, { method: 'POST', body: { checklist, version: seen?.version || 1, file: seen?.file || '' } }); unqueue(id); haptic2(20); await loadVideos(); drawReview(); toast('Approved. It’s ready to post.'); updateBadge(); }
    catch (e) {
      if (e.offline) return decideOffline(id, 'approve', { checklist });
      if (e.status === 409 && /new version|being fixed/.test(e.message)) { toast(e.message); await loadVideos(); drawReview(); return; }
      status(main.querySelector(`[data-st="${id}"]`), e.message, 'err'); el.disabled = false;
    }
  },
  'reject-open'(el) { S.open = { reject: el.dataset.id, reason: '' }; S.fix = null; drawReview(); },
  'reject-cancel'() { S.open = {}; drawReview(); },
  reason(el) { const note = el.closest('.box').querySelector('[data-reject-note]').value; S.open.reason = el.dataset.v; drawReview(); const n = main.querySelector('[data-reject-note]'); if (n) n.value = note; },
  reject(el) {
    const box = el.closest('.box'), note = box.querySelector('[data-reject-note]').value, never = box.querySelector('[data-reject-never]')?.value || '';
    const id = el.dataset.id, body = { reason: S.open.reason, note, never };
    softly(`video:${id}`, {
      label: 'Rejected',
      hide: () => { S.open = {}; S.videos = S.videos.filter(v => v.id !== id); drawReview(); updateBadge(); },
      run: async o => {
        try {
          const r = await api(`/api/videos/${id}/reject`, { method: 'POST', body, ...o });
          unqueue(id);
          if (r.never && S.cfg && !S.cfg.guardrails.neverUse.some(x => x.toLowerCase() === r.never.toLowerCase())) { const clean = !dirty(); S.cfg.guardrails.neverUse.push(r.never); if (clean) { S.saved = JSON.stringify(S.cfg); resetEdits(); } toast(`“${r.never}” won’t be used again.`); }
        } catch (e) { if (e.offline) return decideOffline(id, 'reject', body); throw e; }
      },
      after: async () => { await loadVideos(); if (S.view === 'review') drawReview(); updateBadge(); },
    });
  },
  async reopen(el) { try { await api(`/api/videos/${el.dataset.id}/reopen`, { method: 'POST', body: {} }); await loadVideos(); drawReview(); updateBadge(); } catch (e) { toast(e.message); } },
  delete(el) {
    const id = el.dataset.id;
    softly(`video:${id}`, {
      label: 'Deleted',
      hide: () => { S.videos = S.videos.filter(v => v.id !== id); drawReview(); updateBadge(); },
      run: o => api(`/api/videos/${id}`, { method: 'DELETE', ...o }),
      after: async () => { await loadVideos(); if (S.view === 'review') drawReview(); updateBadge(); },
    });
  },
  'fix-open'(el) {
    const v = S.videos.find(x => x.id === el.dataset.id);
    S.fix = { id: v.id, edits: v.scenes.map(s => ({ text: s.text || '', accent: s.accent || '', say: s.say || '', keyword: s.keyword || '' })), swaps: new Set(), picker: {}, picks: {} };
    S.open = {}; drawReview();
    main.querySelector(`[data-vid="${v.id}"] .scene-edit`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  },
  'fix-cancel'() { S.fix = null; drawReview(); },
  // The clip picker (v15).
  async 'fix-clips'(el) {
    const i = +el.dataset.i, v = S.videos.find(x => x.id === S.fix?.id);
    if (!v) return;
    const more = el.dataset.more === '1', prev = S.fix.picker[i], keyword = S.fix.edits[i].keyword || v.scenes[i].keyword;
    const seen = more && prev?.clips ? [...(prev.seen || []), ...prev.clips.map(c => c.id)] : [];
    S.fix.picker[i] = { ...(prev || {}), busy: true }; drawReview();
    try { const r = await api(`/api/videos/${v.id}/clips`, { method: 'POST', body: { i, keyword, seen } }); S.fix.picker[i] = { clips: r.clips, keyword: r.keyword, left: r.refreshesLeft, seen }; }
    catch (e) { S.fix.picker[i] = { ...(prev || {}), busy: false, error: e.message, keyword: prev?.keyword || keyword, left: prev?.left ?? 0 }; }
    drawReview();
  },
  'fix-pick'(el) {
    const i = +el.dataset.i, c = S.fix?.picker?.[i]?.clips?.[+el.dataset.k];
    if (!c) return;
    S.fix.picks[i] = { ...c, query: S.fix.picker[i].keyword };
    S.fix.swaps.delete(i);
    drawReview();
  },
  'fix-keep'(el) { const i = +el.dataset.i; delete S.fix.picks[i]; S.fix.swaps.delete(i); drawReview(); },
  async 'fix-send'(el) {
    const v = S.videos.find(x => x.id === el.dataset.id), f = S.fix;
    const edits = v.scenes.map((s, i) => { const e = f.edits[i], out = { i }; ['text', 'accent', 'say', 'keyword'].forEach(k => { if ((e[k] || '') !== (s[k] || '')) out[k] = e[k]; }); return out; }).filter(e => Object.keys(e).length > 1);
    el.disabled = true;
    const picks = Object.fromEntries(Object.entries(f.picks || {}).map(([i, c]) => [i, { id: c.id, query: c.query, score: c.score ?? null, reason: c.reason || '' }]));
    try { await api(`/api/videos/${v.id}/fix`, { method: 'POST', body: { edits, swaps: [...f.swaps], picks } }); S.fix = null; await loadVideos(); drawReview(); toast('Fixing. It’ll be back in a minute or two.'); watchJobs(); }
    catch (e) { if (e.data?.findings?.length) { S.fix.findings = e.data.findings; drawReview(); } status(main.querySelector('[data-st="fix"]'), e.message, 'err'); el.disabled = false; }
  },
  // A one-tap fix for what stopped a fix (v15): the change goes into the form, or a rewrite opens.
  'fix-fixit'(el) {
    const x = S.fix?.findings?.[+el.dataset.k];
    if (!x?.fix) return;
    if (x.fix.edits) { for (const e of x.fix.edits) if (S.fix.edits[e.i] && ['text', 'say', 'accent', 'keyword'].includes(e.field)) S.fix.edits[e.i][e.field] = e.value; S.fix.findings = S.fix.findings.filter(y => y !== x); drawReview(); return; }
    if (Number.isInteger(x.fix.rewrite)) actions.rewrite({ dataset: { id: S.fix.id, i: String(x.fix.rewrite) } });
  },
  async 'save-video'(el) {
    const id = el.dataset.id, url = `/api/videos/${id}/download${wsParam()}`;
    const file = S.shareFiles[id];
    if (file) { try { await navigator.share({ files: [file] }); } catch (e) { if (e.name !== 'AbortError') location.href = url; } return; }
    if (!navigator.canShare) { location.href = url; return; }
    el.disabled = true; el.innerHTML = '<span class="spin"></span> Getting the video…';
    try {
      const blob = await (await fetch(url, { credentials: 'same-origin' })).blob();
      const f = new File([blob], `reel-${id.slice(-6)}.mp4`, { type: 'video/mp4' });
      if (!navigator.canShare({ files: [f] })) { location.href = url; return; }
      S.shareFiles[id] = f; el.disabled = false; el.textContent = 'Tap to save or share';
    } catch { location.href = url; }
  },
  async 'make-topic'(el) {
    const painId = el.dataset.id || document.getElementById('topicSel')?.value || '';
    const format = el.dataset.id ? '' : document.getElementById('formatSel')?.value || '';
    await makeVideos(1, painId, format);
  },

  // Create
  async make(el) { await makeVideos(+el.dataset.n || 1); },
  // Studio
  async 'studio-new'(el) {
    el.disabled = true;
    const series = el.dataset.series ? { seriesId: el.dataset.series, part: Math.max(0, Number(el.dataset.part) || 0) } : {};   // Continue a series
    try { const r = await api('/api/studio', { method: 'POST', body: { brief: { scenes: S.cfg?.output.scenes, ...series } } }); go('studio', r.draft.id); }
    catch (e) { toast(e.message); el.disabled = false; }
  },
  'studio-del'(el) {
    const id = el.dataset.id;
    softly(`draft:${id}`, {
      label: 'Draft deleted',
      hide: () => { if (S.studioList) S.studioList = { ...S.studioList, drafts: S.studioList.drafts.filter(d => d.id !== id) }; drawCreate(); },
      run: o => api('/api/studio/' + id, { method: 'DELETE', ...o }),
      after: async () => { await loadStudioList(); if (S.view === 'create') drawCreate(); },
    });
  },
  async 'st-hooks'() {
    S.st.busy = 'hooks'; drawStudio();
    S.st.hooksError = '';
    try { const r = await api(`/api/studio/${S.st.d.id}/hooks`, { method: 'POST', body: {} }); S.st.d = { ...r.draft, scenes: S.st.d.scenes }; } catch (e) { S.st.hooksError = e.message; }
    S.st.busy = ''; drawStudio();
  },
  'st-usehook'(el) {
    const h = S.st.d.hooks[+el.dataset.k], n = stPicks().scenes;
    if (!h) return;
    if (!S.st.d.scenes.length) S.st.d.scenes = Array.from({ length: n }, () => ({ say: '', text: '', accent: '', keyword: '' }));
    stSetScene(0, { text: h.text, ...(h.say ? { say: h.say } : {}), accent: suggestAccent(h.text, S.cfg) });
    drawStudio();
  },
  async 'st-fill'() {
    clearTimeout(S.st.saveTimer);
    S.st.busy = 'fill'; drawStudio();
    clearTimeout(S.st.saveTimer);   // the fill sends these cards and saves the result
    S.st.fillError = '';
    try { S.st.d = (await api(`/api/studio/${S.st.d.id}/fill`, { method: 'POST', body: { scenes: S.st.d.scenes } })).draft; } catch (e) { S.st.fillError = e.message; }
    S.st.busy = ''; drawStudio();
  },
  'st-move'(el) {
    const i = +el.dataset.i, j = i + +el.dataset.d, sc = S.st.d.scenes;
    if (j < 0 || j >= sc.length) return;
    [sc[i], sc[j]] = [sc[j], sc[i]]; S.st.rw = {}; S.st.foot = {};
    stSave(); drawStudio();
  },
  async 'st-ideas'(el) {
    const i = +el.dataset.i;
    S.st.rw[i] = { busy: true }; drawStudio();
    try { S.st.rw[i] = await api(`/api/studio/${S.st.d.id}/ideas`, { method: 'POST', body: { i, scenes: S.st.d.scenes } }); } catch (e) { S.st.rw[i] = { error: e.message }; }
    drawStudio();
  },
  'st-ideas-close'(el) { delete S.st.rw[+el.dataset.i]; drawStudio(); },
  async 'st-usesearch'(el) {
    const i = +el.dataset.i, x = S.st.rw[i]?.searches?.[+el.dataset.k];
    if (!x) return;
    const cur = { ...S.st.d.scenes[i] };
    if (cur.clip && cur.keyword !== x.keyword) delete cur.clip;
    S.st.d.scenes[i] = { ...cur, keyword: x.keyword }; stSave();
    S.st.foot[i] = { busy: true }; drawStudio();
    try { S.st.foot[i] = await api(`/api/studio/${S.st.d.id}/footage`, { method: 'POST', body: { keyword: x.keyword, caption: S.st.d.scenes[i].text } }); } catch (e) { S.st.foot[i] = { error: e.message }; }
    drawStudio();
  },
  'st-usescenery'(el) { const i = +el.dataset.i, t = S.st.rw[i]?.scenery?.[+el.dataset.k]; if (t) { stSetScene(i, { note: t }); drawStudio(); } },
  'st-note-del'(el) { const i = +el.dataset.i, x = { ...S.st.d.scenes[i] }; delete x.note; S.st.d.scenes[i] = x; stSave(); drawStudio(); },
  'goto-facts'(el, e) { e?.preventDefault?.(); S.contentTab = 'topics'; go(canSee('library') ? 'library' : 'content'); },
  'st-userw'(el) {
    const i = +el.dataset.i, o = S.st.rw[i]?.options?.[+el.dataset.k];
    if (!o) return;
    stSetScene(i, { text: o.text, ...(o.accent ? { accent: o.accent } : {}), ...(o.say ? { say: o.say } : {}) });
    delete S.st.rw[i]; drawStudio();
  },
  async 'st-hear'(el) {
    const i = +el.dataset.i, text = S.st.d.scenes[i]?.say;
    if (!text) return;
    el.disabled = true; el.innerHTML = '<span class="spin"></span> Recording…';
    try {
      const res = await fetch(`/api/studio/${S.st.d.id}/voice`, { method: 'POST', credentials: 'same-origin', headers: { ...wsHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || SERVER_TROUBLE);
      const url = URL.createObjectURL(await res.blob());
      const a = new Audio(url); a.onended = () => URL.revokeObjectURL(url); await a.play();
    } catch (e) { toast(fetchError(e).message); }
    el.disabled = false; el.textContent = '▶ Hear this line';
  },
  async 'st-foot'(el) {
    const i = +el.dataset.i, x = S.st.d.scenes[i];
    S.st.foot[i] = { busy: true }; drawStudio();
    try { S.st.foot[i] = await api(`/api/studio/${S.st.d.id}/footage`, { method: 'POST', body: { keyword: x.keyword, caption: x.text } }); } catch (e) { S.st.foot[i] = { error: e.message }; }
    drawStudio();
  },
  'st-pick'(el) {
    const i = +el.dataset.i, raw = el.dataset.id, id = /^\d+$/.test(raw) ? Number(raw) : raw;
    stSetScene(i, { clip: { id, thumb: el.dataset.thumb || '', query: el.dataset.q || '' } });
    drawStudio();
  },
  // v15: one-tap fixes, notes, and going to a scene.
  async 'st-fix'(el) {
    const f = S.st.findings?.[+el.dataset.n];
    if (!f?.fix) return;
    if (f.fix.edits) { for (const e of f.fix.edits) if (S.st.d.scenes[e.i]) S.st.d.scenes[e.i] = { ...S.st.d.scenes[e.i], [e.field]: e.value }; stSave(); stSpell(0); drawStudio(); return; }
    if (f.fix.action === 'fill') return actions['st-fill']();
    if (f.fix.action === 'facts') return actions['goto-facts'](el);
    if (f.fix.action === 'nofact') return stBrief({ noFact: true, insightIds: [] });
    if (Number.isInteger(f.fix.rewrite)) {
      const i = f.fix.rewrite, why = String(f.text).replace(/^Scene \d+:? ?/, '');
      if (!S.st.d.scenes[i]?.text) return actions['st-fill']();
      S.st.rw[i] = { busy: true }; drawStudio();
      try { S.st.rw[i] = { ...(await api(`/api/studio/${S.st.d.id}/rewrite`, { method: 'POST', body: { i, scenes: S.st.d.scenes, fix: why } })), fixing: why }; } catch (e) { S.st.rw[i] = { error: e.message }; }
      drawStudio(); document.getElementById(`st-scene-${i}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  },
  'st-goto'(el) {
    const card = document.getElementById(`st-scene-${+el.dataset.i}`);
    if (!card) return;
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1400);
    card.querySelector('input, textarea')?.focus({ preventScroll: true });
  },
  'st-notes'() { S.st.showNotes = !S.st.showNotes; stRefreshChecks(); },
  'st-hooks-more'() { S.st.allHooks = !S.st.allHooks; drawStudio(); },
  'st-leave-series'() { stBrief({ seriesId: '', part: 0 }); },
  // The simple start (v15): a worry tapped sets the rest (its audience and recommended fact are picked
  // by the brief; the format takes turns with recent drafts). Surprise me picks a worry too, then gets
  // the openings written. Change, or More options, opens every setting.
  'st-worry'(el) { stPickWorry(el.dataset.id || ''); },
  async 'st-surprise'() {
    const U = usableRoutes(S.cfg), pains = S.st.d.brief.noFact ? S.cfg.story.painPoints : U.pains;
    if (!pains.length) return toast('Check a topic’s fact in Setup → Topics first.');
    const others = pains.filter(x => x.id !== S.st.d.brief.painId), from = others.length ? others : pains;
    await stPickWorry(from[Math.floor(Math.random() * from.length)].id, true);
    if (!stPicks().problems.length && !S.st.d.hooks.length) { document.querySelector('[data-act="st-hooks"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); await actions['st-hooks'](); }
  },
  'st-more'(el) { S.st.more = true; drawStudio(); if (el.dataset.facts) document.querySelector('[data-stfact]')?.closest('.field')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); },
  'st-less'() { S.st.more = false; drawStudio(); },
  'st-nofact-start'() { stBrief({ noFact: !S.st.d.brief.noFact, painId: '', insightIds: [] }); },
  'st-clipclear'(el) { const i = +el.dataset.i, x = { ...S.st.d.scenes[i] }; delete x.clip; S.st.d.scenes[i] = x; stSave(); drawStudio(); },
  async 'st-render'(el) {
    el.disabled = true; clearTimeout(S.st.saveTimer);
    try {
      await api('/api/studio/' + S.st.d.id, { method: 'PUT', body: { scenes: S.st.d.scenes } });
      const r = await api(`/api/studio/${S.st.d.id}/render`, { method: 'POST', body: {} });
      S.st.d = r.draft; toast('Submitted. It’ll be in Review in a few minutes.'); drawStudio(); pollStudio(); watchJobs();
    } catch (e) { toast(e.message); el.disabled = false; }
  },
  async 'next-make'(el) { const g = S.overview.next?.[+el.dataset.k]; if (g?.act.make) await makeVideos(g.act.make.count || 1, g.act.make.painId || '', g.act.make.format || ''); },
  async 'auto-plan'(el) {
    S.cfg.schedule = { ...S.cfg.schedule, autoPlan: el.dataset.v === '1' };
    // Saves at once unless other changes are waiting to be saved (then it joins them).
    const wasDirty = JSON.stringify({ ...JSON.parse(S.saved), schedule: S.cfg.schedule }) !== JSON.stringify(S.cfg);
    if (!wasDirty) { try { await saveCfg(); await loadOverview(); } catch (e) { toast(e.message); } } else saveBar();
    redraw();
  },
  async 'plan-skip'(el) {
    try { const r = await api('/api/coach/plan/skip', { method: 'POST', body: { skip: el.dataset.v === '1' } }); if (S.overview) S.overview.plan = r.plan; S.reviewPlan = r.plan; toast(el.dataset.v === '1' ? 'Next Monday’s plan is skipped' : 'Next Monday’s plan is back on'); redraw(); }
    catch (e) { toast(e.message); }
  },
  async 'cancel-job'(el) { try { await api(`/api/jobs/${el.dataset.id}`, { method: 'DELETE' }); await loadOverview(); drawCreate(); } catch (e) { toast(e.message); } },
  async 'keep-ready'(el) {
    S.cfg.schedule = { ...S.cfg.schedule, keepReady: +el.dataset.v };
    const wasDirty = JSON.stringify({ ...JSON.parse(S.saved), schedule: S.cfg.schedule }) !== JSON.stringify(S.cfg);
    if (!wasDirty) { try { await saveCfg(); } catch (e) { toast(e.message); } } else saveBar();
    drawCreate();
  },
  async test(el) {
    const st = main.querySelector('[data-st="test"]');
    el.disabled = true; status(st, 'Writing a test script… 10 to 30 seconds.');
    const pick = { painId: document.getElementById('topicSel')?.value || '', format: document.getElementById('formatSel')?.value || '' };
    S.pick = pick;
    try { S.test = await api('/api/script', { method: 'POST', body: { ...pick, ...(dirty() ? { config: S.cfg } : {}) } }); status(st, 'Done. Nothing was saved or rendered.', 'ok'); document.getElementById('testOut').innerHTML = testHTML(S.test); }
    catch (e) { status(st, e.message, 'err'); if (e.data?.log) document.getElementById('testOut').innerHTML = `<details><summary class="small">What happened</summary><pre class="log">${esc(e.data.log.join('\n'))}</pre></details>`; }
    // The count of tests left today comes back from the server (other helpers use the same daily count).
    try { const o = await api('/api/overview'); S.overview.testsLeft = o.testsLeft; } catch { S.overview.testsLeft = Math.max(0, (S.overview.testsLeft || 1) - 1); }
    const left = document.querySelector('[data-tests-left]'); if (left) left.textContent = S.overview.testsLeft;
    el.disabled = !S.overview.testsLeft;
  },

  // Content
  'goto-tab'(el, e) { e?.preventDefault?.(); S.contentTab = el.dataset.v; go(!canSee('library') ? 'content' : el.dataset.v === 'voice' ? 'voice' : 'library'); },
  'content-tab'(el) { S.contentTab = el.dataset.v; drawContent(); },
  'all-warnings'() { S.allWarnings = true; drawContent(); },
  // Your voice
  bdel(el) {
    const b = S.cfg.bank, list = el.dataset.list;
    if (list === 'samples') b.samples.splice(+el.dataset.i, 1); else b[list] = b[list].filter(x => x.id !== el.dataset.id);
    drawContent(); saveBar();
  },
  // Coach
  'coach-open'() { openCoach('', null, S.view === 'communicate' ? 'comms' : 'content'); },
  'coach-mode'(el) { setCoachMode(el.dataset.v); S.coach.tab = 'ask'; drawCoach(); },
  'coach-close'() { S.coach.open = false; drawCoach(); },
  'coach-unfocus'() { S.coach.focus = null; drawCoach(); },
  'coach-starter'(el) { sendCoach(el.dataset.q); },
  'coach-tab'(el) { S.coach.tab = el.dataset.v; drawCoach(); },
  async 'coach-try'(el) {
    const sg = S.coach.msgs[+el.dataset.m]?.suggestions?.[+el.dataset.j];
    if (!sg || sg.trying) return;
    sg.trying = true; sg.tryError = ''; drawCoach();
    try { sg.trial = await api('/api/coach/try', { method: 'POST', body: { suggestion: sg, ...(dirty() ? { config: S.cfg } : {}) } }); }
    catch (e) { sg.tryError = e.message; }
    sg.trying = false; saveCoachMsgs(); drawCoach();
  },
  'coach-copy'(el) { const x = S.coach.reply.out?.replies?.[+el.dataset.k]; if (x) copy(x.text, 'Reply'); },
  async 'note-del'(el) { try { S.coach.notes = (await api('/api/coach/notes/' + el.dataset.id, { method: 'DELETE' })).notes; drawCoach(); } catch (e) { toast(e.message); } },
  // Mindset
  'mind-why-edit'() { S.editWhy = true; drawMindset(); },
  'mind-why-cancel'() { S.editWhy = false; drawMindset(); },
  async 'mind-did'() { try { S.mind = await api('/api/mindset/principle', { method: 'POST', body: { act: 'done' } }); drawMindset(); toast('Nice. That’s one more vote for who you’re becoming.'); } catch (e) { toast(e.message); } },
  async 'mind-next'() { try { S.mind = await api('/api/mindset/principle', { method: 'POST', body: { act: 'next' } }); drawMindset(); } catch (e) { toast(e.message); } },
  // In the editor, Done saves what's typed; adding or removing a habit keeps the other rows as typed.
  'mind-habits-edit'() { const f = main.querySelector('[data-form="mind-habits"]'); if (S.editHabits && f) return f.requestSubmit(); S.editHabits = true; drawMindset(); },
  async 'mind-habit-del'(el) { const r = habitRows(); await mindSave({ identity: r.identity, habits: r.habits.filter(h => h.id !== el.dataset.id) }, 'Removed'); },
  async 'mind-habit-add'() { const r = habitRows(); await mindSave({ identity: r.identity, habits: [...r.habits, { text: 'New habit (tap to rename)' }] }, ''); },
  async 'mind-habit-auto'(el) { const r = habitRows(); await mindSave({ identity: r.identity, habits: [...r.habits, { text: AUTO_HABITS[el.dataset.v].label.replace('{n}', 3), auto: el.dataset.v, target: 3 }] }, ''); },
  async 'mind-advice'(el) { el.disabled = true; el.innerHTML = '<span class="spin"></span> Looking…'; try { S.advice = (await api('/api/mindset/audit/advice', { method: 'POST', body: {} })).advice; } catch (e) { toast(e.message); } drawMindset(); },
  async 'mind-practice-del'(el) { try { S.mind = await api('/api/mindset/practice/' + el.dataset.id, { method: 'DELETE' }); drawMindset(); } catch (e) { toast(e.message); } },
  async 'mind-strat-del'(el) { const st = { ...S.mind.mindset.strategy }; st[el.dataset.k] = st[el.dataset.k].filter((_, i) => i !== +el.dataset.i); await mindSave({ strategy: st }, ''); },
  async 'mind-obj-del'(el) { await mindSave({ profile: { objections: S.mind.profile.objections.filter(o => o.id !== el.dataset.id) } }, ''); },
  async 'mind-obj-link'(el) { await mindSave({ profile: { objections: S.mind.profile.objections.map(o => (o.id === el.dataset.id ? { ...o, links: o.links.includes(el.dataset.pid) ? o.links.filter(x => x !== el.dataset.pid) : [...o.links, el.dataset.pid] } : o)) } }, ''); },
  async 'mind-closer-done'(el) { await mindSave({ closer: S.mind.mindset.closer.map(c => (c.id === el.dataset.id ? { ...c, done: new Date().toISOString() } : c)) }, 'Done. On to the next one.'); },
  'mind-past'() { S.pastWeeks = !S.pastWeeks; drawMindset(); },
  async 'save-search'(el) {
    await loadCfg();
    const sg = { type: 'add_search', audienceId: el.dataset.a, text: el.dataset.q.toLowerCase() };
    S.cfg = applySuggestionTo(S.cfg, sg);
    try { await saveCfg(); el.disabled = true; el.textContent = 'Saved ✓'; toast('Saved. New videos for this audience will try it.'); } catch (e) { toast(e.message); }
  },
  'focus-on'() { S.focus = { i: 0 }; S.open = {}; S.fix = null; drawReview(); window.scrollTo(0, 0); },
  'focus-off'() { S.focus = null; drawReview(); },
  'focus-go'(el) { if (!S.focus) return; S.focus.i = (S.focus.i || 0) + Number(el.dataset.d); S.open = {}; S.fix = null; drawReview(); window.scrollTo(0, 0); },
  'prompter-video'(el) { const v = S.videos.find(x => x.id === el.dataset.id); if (v) teleprompter((v.scenes || []).map(x => x.say || x.text), v.meta?.painPoint || ''); },
  'prompter-studio'() { if (S.st) teleprompter(S.st.d.scenes.map(x => x.say || x.text).filter(Boolean), S.st.d.title || ''); },
  'cover-pick'(el) { S.coverPick = el.dataset.id || null; drawReview(); },
  async 'cover-set'(el) {
    const st = main.querySelector(`[data-st="cover-${el.dataset.id}"]`);
    if (S.coverBusy) return;
    S.coverBusy = true; setTimeout(() => { S.coverBusy = false; }, 8000);
    main.querySelectorAll('[data-act="cover-set"]').forEach(b => { b.disabled = true; });
    status(st, 'Making the cover…');
    try { await api(`/api/videos/${el.dataset.id}/cover`, { method: 'POST', body: { t: Number(el.dataset.t) } }); await loadVideos(); S.coverBusy = false; drawReview(); toast('Cover changed'); }
    catch (e) { S.coverBusy = false; status(st, e.message, 'err'); main.querySelectorAll('[data-act="cover-set"]').forEach(b => { b.disabled = false; }); }
  },
  // One step from "it brought a message" to a reply: the coach's Reply tab, with the video as context.
  'reply-from'(el) {
    const v = S.videos.find(x => x.id === el.dataset.id);
    if (!v) return;
    openCoach('', null, 'comms');
    S.coach.tab = 'reply';
    S.coach.reply = { ...S.coach.reply, message: '', out: null, audienceId: v.meta?.audienceId || '', note: `They messaged after my video: “${String(v.scenes?.[0]?.text || v.meta?.painPoint || '').slice(0, 200)}”`.slice(0, 300) };
    drawCoach();
    setTimeout(() => document.querySelector('#coach [name="message"]')?.focus(), 50);
  },
  async 'msg-plus'(el) { if (el.disabled) return; el.disabled = true; try { await api(`/api/videos/${el.dataset.id}/message`, { method: 'POST', body: { delta: 1 } }); await loadVideos(); drawReview(); toast('Counted. Topics that bring messages come up more often.'); } catch (e) { el.disabled = false; toast(e.message); } },
  async 'msg-minus'(el) { try { await api(`/api/videos/${el.dataset.id}/message`, { method: 'POST', body: { delta: -1 } }); await loadVideos(); drawReview(); } catch (e) { toast(e.message); } },
  'lib-del'(el) {
    const id = el.dataset.id;
    softly(`clip:${id}`, {
      label: 'Clip deleted (videos already made keep it)',
      hide: () => { S.lib = { ...S.lib, clips: S.lib.clips.filter(c => c.id !== id) }; drawBrand(); },
      run: o => api(`/api/library/${id}`, { method: 'DELETE', ...o }),
      after: async () => { await loadLibrary(); if (S.view === 'brand' || S.view === 'library') drawBrand(); },
    });
  },
  'soft-undo'(el) { softUndo(el.dataset.key); },
  async rewrite(el) {
    const k = `${el.dataset.id}-${el.dataset.i}`;
    S.rewrites[k] = { busy: true }; drawReview();
    try { S.rewrites[k] = await api('/api/coach/rewrite', { method: 'POST', body: { videoId: el.dataset.id, i: +el.dataset.i } }); }
    catch (e) { S.rewrites[k] = { error: e.message }; }
    drawReview();
  },
  'use-rewrite'(el) {
    const o = S.rewrites[`${S.fix.id}-${el.dataset.i}`]?.options?.[+el.dataset.k];
    if (!o) return;
    Object.assign(S.fix.edits[+el.dataset.i], { text: o.text, accent: o.accent || S.fix.edits[+el.dataset.i].accent, ...(o.say ? { say: o.say } : {}) });
    drawReview();
  },
  async 'weekly-refresh'() { await loadWeekly(true); },
  async 'weekly-apply'() { const sg = S.weekly?.weekly?.change; if (!sg || sg.applied) return; toast(await applySuggestion(sg)); sg.applied = true; drawReview(); },
  async 'plan-make'(el) {
    const plan = S.weekly?.weekly?.plan || [];
    const items = [...main.querySelectorAll('[data-plan]')].filter(x => x.checked).map(x => plan[+x.dataset.plan]).filter(Boolean);
    if (!items.length) return toast('Tick at least one video.');
    el.disabled = true;
    try { const r = await api('/api/coach/plan', { method: 'POST', body: { items } }); S.weekly.weekly.queuedAt = new Date().toISOString(); drawReview(); toast(`${plural(r.jobs.length, 'video')} in line. They show up here when ready.`); }
    catch (e) { toast(e.message); el.disabled = false; }
  },
  'ask-rejections'() { const top = S.stats?.rejections?.[0]; openCoach(top ? `My rejected videos are most often "${top.reason}". What should I change in my setup so that stops?` : 'My last few videos were rejected. What should I change in my setup?'); },
  'ask-coach'(el) { const v = S.videos.find(x => x.id === el.dataset.id); openCoach(`How can this video be better? Be specific about the hook, the scenes and the footage.`, { label: `Video: ${v?.meta?.painPoint || ''}`, data: { videoId: el.dataset.id } }); },
  'ask-coach-test'() { const t = S.test; openCoach('What works and what would make this script stronger? Teach me the why.', { label: 'Your last test script', data: { test: { scenes: t.scenes, hooks: t.hooks, log: t.log } } }); },
  async 'ask-coach-prompt'() {
    try { const b = await loadPromptPreview(); openCoach('Explain this prompt in plain words: what each part does, and what I could change to get better scripts.', { label: 'The prompt shown in Setup → Look', data: { prompt: promptText(b) } }); }
    catch (e) { toast(e.message); }
  },
  async 'show-prompt'(el) {
    el.disabled = true; el.innerHTML = '<span class="spin"></span> Building the prompt…';
    try { await loadPromptPreview(); S.promptOpen = true; const out = document.getElementById('promptOut'); if (out) out.innerHTML = promptHTML(S.promptPreview); }
    catch (e) { toast(e.message); }
    el.disabled = false; el.textContent = 'Show the full prompt';
  },
  'coach-apply-scene'(el) {
    const sg = S.coach.msgs[+el.dataset.m]?.suggestions?.[+el.dataset.j], k = +el.dataset.k;
    if (!sg || sg.applied) return;
    const msg = applyStudio(sg, k);
    if (/^Scene /.test(msg)) { sg.usedScenes = [...new Set([...(sg.usedScenes || []), k])]; if (sg.usedScenes.length === sg.scenes.length) sg.applied = true; saveCoachMsgs(); drawCoach(); }
    toast(msg);
  },
  // Every scene's line at once: the first offered for each scene (v15).
  async 'coach-apply-all'(el) {
    const m = S.coach.msgs[+el.dataset.m];
    // Exactly the lines the server checked together (one per scene), not ones that only work alone.
    const firsts = (m?.suggestions || []).filter(x => x.type === 'studio_scene' && x.together && !x.applied);
    let n = 0, last = '';
    for (const sg of firsts) { last = await applySuggestion(sg); if (!/^Open that Studio draft|^The board has changed/.test(last)) { sg.applied = true; n++; } }
    saveCoachMsgs(); drawCoach(); toast(n ? `Used ${plural(n, 'line')}.` : last);
  },
  async 'coach-apply'(el) {
    const m = S.coach.msgs[+el.dataset.m], sg = m?.suggestions?.[+el.dataset.j];
    if (!sg || sg.applied) return;
    const msg = await applySuggestion(sg);
    // A Studio change refused (another draft open, or the board changed) stays available.
    if (!/^Open that Studio draft|^The board has changed/.test(msg)) sg.applied = true;
    saveCoachMsgs(); drawCoach(); toast(msg);
  },
  async 'load-version'(el) { const name = document.getElementById('versionSel').value; if (el) { el.disabled = true; el.innerHTML = '<span class="spin"></span> Loading…'; } try { const r = await api('/api/history/' + encodeURIComponent(name)); S.cfg = migrate(r.config); drawSettings(); saveBar(); toast('Loaded. Save to use it.'); } catch (e) { toast(e.message); if (el && document.contains(el)) { el.disabled = false; el.textContent = 'Load'; } } },
  reroll() { S.picks = roll(S.cfg); S.promptPreview = null; S.promptOpen = true; drawSettings(); },


  // Admin
  async 'open-ws'(el) { await api('/api/admin/open', { method: 'POST', body: { workspaceId: el.dataset.id } }); location.hash = '#/'; location.reload(); },
  async 'ws-set'(el) { try { await api(`/api/admin/workspaces/${el.dataset.id}`, { method: 'POST', body: { [el.dataset.k]: el.dataset.v === '1' } }); await viewAdmin(); } catch (e) { toast(e.message); } },
  async 'ws-limit'(el) {
    const v = prompt('Most videos a month for this workspace (blank = the default, 200):', '');
    if (v === null) return;
    try { await api(`/api/admin/workspaces/${el.dataset.id}`, { method: 'POST', body: { videosPerMonth: Number(v) || 0 } }); await viewAdmin(); } catch (e) { toast(e.message); }
  },
  async 'ws-cap'(el) {
    const v = prompt(`Monthly AI cost cap for this workspace, in dollars.\nBlank = the default ($${(S.admin.system.aiCap || 0).toFixed(2)}), 0 = no cap. At 80% you get an alert; at 100% new videos, test scripts and the coach pause until next month.`, el.dataset.v || '');
    if (v === null) return;
    try { await api(`/api/admin/workspaces/${el.dataset.id}`, { method: 'POST', body: { aiCostUsd: v.trim() } }); await viewAdmin(); } catch (e) { toast(e.message); }
  },
  async 'reset-link'(el) {
    try { const r = await api('/api/admin/reset', { method: 'POST', body: { accountId: el.dataset.id } }); showLink(el.closest('.panel').querySelector('[data-out]') || el.closest('.panel'), r.link, `Reset link (valid 7 days, single use). Send it to them directly:`); }
    catch (e) { toast(e.message); }
  },
  async 'reset-2fa'(el) {
    if (!confirm(`Turn off two-factor login for ${el.dataset.email}? Only do this after checking it’s really them (for example by phone). They’ll be logged out and set it up again.`)) return;
    try { await api(`/api/admin/accounts/${el.dataset.id}/reset-2fa`, { method: 'POST', body: {} }); toast('Two-factor login reset'); await viewAdmin(); } catch (e) { toast(e.message); }
  },
  async disable(el) { try { await api(`/api/admin/accounts/${el.dataset.id}`, { method: 'POST', body: { disabled: el.dataset.v === '1' } }); await viewAdmin(); } catch (e) { toast(e.message); } },
  async 'copy-link'(el) { copy(el.dataset.link, 'Link'); },
  async 'alerts-read'() { await api('/api/admin/alerts/read', { method: 'POST', body: {} }); S.me.alerts = 0; await viewAdmin(); const a = document.querySelector('.nav a[href="#/admin"]'); if (a) a.textContent = 'Admin'; },
  async 'alerts-test'(el) { el.disabled = true; try { await api('/api/admin/alerts/test', { method: 'POST', body: {} }); toast('Test sent. Check your phone.'); } catch (e) { toast(e.message); } el.disabled = false; },
  'all-alerts'() { S.allAlerts = true; drawAdmin(); loadAudit(); },
  'audit-more'() { S.auditF.limit += 100; loadAudit(); },
  async 'ws-delete'(el) {
    const name = el.dataset.name;
    const typed = prompt(`This deletes “${name}” for good: its logins, settings, videos and approval records. Backups keep a copy until they rotate out.\n\nType the workspace name to confirm:`, '');
    if (typed === null) return;
    try {
      const r = await api(`/api/admin/workspaces/${el.dataset.id}/delete`, { method: 'POST', body: { confirm: typed } });
      toast(`Deleted ${r.deleted.name}`);
      await refreshMe(); await viewAdmin();
    } catch (e) { toast(e.message); }
  },
  async 'ws-keep'(el) {
    if (!confirm('Decline this deletion request? Nothing is deleted, and the request disappears from their Account page. Let them know why.')) return;
    try { await api(`/api/admin/workspaces/${el.dataset.id}/delete-request`, { method: 'DELETE' }); await viewAdmin(); } catch (e) { toast(e.message); }
  },

  // Instagram
  async 'ig-connect'(el) {
    if (dirty()) return toast('Save or discard your changes first.');
    el.disabled = true;
    try { location.href = (await api('/api/instagram/connect', { method: 'POST', body: {} })).url; } catch (e) { toast(e.message); el.disabled = false; }
  },
  async 'ig-disconnect'(el) {
    if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Tap again to disconnect'; setTimeout(() => { el.dataset.confirm = ''; el.textContent = 'Disconnect'; }, 3000); return; }
    S.ig = { ...S.ig, account: (await api('/api/instagram', { method: 'DELETE' })).account };
    drawBrand(); toast('Instagram disconnected. Scheduled posts won’t go out.');
  },
  async 'fb-connect'(el) {
    if (dirty()) return toast('Save or discard your changes first.');
    el.disabled = true;
    try { location.href = (await api('/api/facebook/connect', { method: 'POST', body: {} })).url; } catch (e) { toast(e.message); el.disabled = false; }
  },
  async 'fb-page'(el) {
    try { S.fb = { ...S.fb, account: (await api('/api/facebook/page', { method: 'POST', body: { pageId: el.dataset.id } })).account }; drawBrand(); toast(`Facebook connected: ${S.fb.account.pageName}`); } catch (e) { toast(e.message); }
  },
  async 'fb-disconnect'(el) {
    if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Tap again to disconnect'; setTimeout(() => { el.dataset.confirm = ''; el.textContent = 'Disconnect'; }, 3000); return; }
    S.fb = { ...S.fb, account: (await api('/api/facebook', { method: 'DELETE' })).account };
    drawBrand(); toast('Facebook disconnected. Scheduled Facebook posts won’t go out.');
  },
  async 'fb-now'(el) {
    if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Tap again to post'; setTimeout(() => { el.dataset.confirm = ''; el.textContent = 'Post now'; }, 3000); return; }
    el.disabled = true;
    try { await api(`/api/videos/${el.dataset.id}/facebook`, { method: 'POST', body: { at: 'now' } }); await loadVideos(); drawReview(); toast('Posting to Facebook. It takes a few minutes.'); }
    catch (e) { toast(e.message); el.disabled = false; }
  },
  async 'fb-at'(el) {
    const v = main.querySelector(`[data-fb-at="${el.dataset.id}"]`)?.value;
    if (!v) return toast('Pick a day and time first.');
    try { await api(`/api/videos/${el.dataset.id}/facebook`, { method: 'POST', body: { at: new Date(v).toISOString() } }); await loadVideos(); drawReview(); toast('Scheduled for Facebook'); }
    catch (e) { toast(e.message); }
  },
  async 'fb-cancel'(el) { try { await api(`/api/videos/${el.dataset.id}/facebook`, { method: 'DELETE' }); await loadVideos(); drawReview(); toast('Canceled'); } catch (e) { toast(e.message); } },
  async 'fb-text'(el) {
    try { S.fbText = { ...(S.fbText || {}), [el.dataset.id]: (await api(`/api/videos/${el.dataset.id}/facebook-text`)).text }; drawReview(); } catch (e) { toast(e.message); }
  },
  async 'copy-track'(el) {
    const v = S.videos.find(x => x.id === el.dataset.id);
    try { await navigator.clipboard.writeText(v.trackUrl); toast('Link copied'); } catch { toast(v.trackUrl); }
  },
  'ap-place'(el) {
    const ap = S.cfg.schedule.autopost, p = el.dataset.p, cur = ap.platforms || ['instagram'];
    const next = cur.includes(p) ? cur.filter(x => x !== p) : [...cur, p];
    if (!next.length) return toast('Pick at least one place to post.');
    ap.platforms = next; drawBrand(); saveBar();
  },
  'ap-on'(el) { S.cfg.schedule.autopost.on = el.dataset.v === '1'; drawBrand(); saveBar(); },
  'ap-day'(el) { const ap = S.cfg.schedule.autopost, d = +el.dataset.d; ap.days = ap.days.includes(d) ? ap.days.filter(x => x !== d) : [...ap.days, d].sort(); drawBrand(); saveBar(); },
  async 'ap-now'(el) {
    if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Tap again to post'; setTimeout(() => { el.dataset.confirm = ''; el.textContent = 'Post now'; }, 3000); return; }
    el.disabled = true;
    try { await api(`/api/videos/${el.dataset.id}/autopost`, { method: 'POST', body: { at: 'now' } }); await loadVideos(); drawReview(); toast('Posting. It takes a minute or two.'); }
    catch (e) { toast(e.message); el.disabled = false; }
  },
  async 'ap-at'(el) {
    const v = main.querySelector(`[data-ap-at="${el.dataset.id}"]`)?.value;
    if (!v) return toast('Pick a day and time first.');
    try { await api(`/api/videos/${el.dataset.id}/autopost`, { method: 'POST', body: { at: new Date(v).toISOString() } }); await loadVideos(); drawReview(); toast('Scheduled'); }
    catch (e) { toast(e.message); }
  },
  async 'ap-cancel'(el) { try { await api(`/api/videos/${el.dataset.id}/autopost`, { method: 'DELETE' }); await loadVideos(); drawReview(); toast('Canceled'); } catch (e) { toast(e.message); } },
  async 'logo-del'(el) {
    if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Tap again to remove'; setTimeout(() => { el.dataset.confirm = ''; el.textContent = 'Remove'; }, 3000); return; }
    await api('/api/brand/logo', { method: 'DELETE' });
    S.me.workspace.logo = false;
    if (S.cfg.look.logo === 'on') { S.cfg.look.logo = 'off'; saveBar(); }
    drawBrand(); toast('Logo removed. Save to stop showing it.');
  },

  // Communicate
  'comm-style'(el) { S.comm.open = el.dataset.k; drawCommunicate(); },
  'aud-style'(el) {
    const a = S.cfg.audience, k = el.dataset.k;
    const cur = normStyle(a.style).split('').filter(Boolean);
    let next = cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k];
    if (next.length > 2) next = [next[0], k];   // keep the main style, swap the second
    a.style = next.join('');
    restory(); drawCommunicate(); saveBar();
  },
  'aud-style-set'(el) {
    const a = S.cfg.audience, k = el.dataset.k;
    if (!STYLES[k]) return;
    const second = normStyle(a.style).split('').filter(x => x && x !== k)[0] || '';
    a.style = k + second;
    restory(); drawCommunicate(); saveBar(); toast(`Set to ${styleLabel(a.style)}. Save to use it.`);
  },
  'aud-coach'(el) {
    const a = { ...S.cfg.audience, text: S.cfg.profile.clients || 'my clients' };
    openCoach(`How should my videos speak to “${a.text}”? ${a.style ? `I set them as ${styleLabel(a.style)}. Is that a good guess, and` : 'Which style do they most likely lean, and'} what words, openings and calls to action fit them? Show me examples.`, { label: 'Audience: ' + short(a.text), data: { audienceId: 'aud' } }, 'comms');
  },
  'comms-starter'(el) { openCoach(el.dataset.q, null, 'comms'); },
  'comms-open'() { openCoach('', null, 'comms'); },
  'reply-open'() { openCoach('', null, 'comms'); S.coach.tab = 'reply'; drawCoach(); },
  'ws-kind'(el) { Object.assign(S.workshop, { kind: el.dataset.v, itemId: '', painId: '', text: '', out: null }); swapPanel('workshop', workshopPanel()); },
  'ws-style'(el) { S.workshop.style = el.dataset.v; swapPanel('workshop', workshopPanel()); },
  async 'ws-run'() {
    const W = S.workshop, st = () => main.querySelector('[data-st="ws"]');
    if (!W.text.trim()) return status(st(), 'Write something first, or pick one to start from.', 'err');
    W.busy = true; swapPanel('workshop', workshopPanel());
    try { W.out = await api('/api/comms/workshop', { method: 'POST', body: { kind: W.kind, text: W.text, itemId: W.itemId, audienceId: W.audienceId, painId: W.painId, style: W.style, ...(dirty() ? { config: S.cfg } : {}) } }); }
    catch (e) { W.busy = false; swapPanel('workshop', workshopPanel()); return status(st(), e.message, 'err'); }
    W.busy = false; swapPanel('workshop', workshopPanel());
    document.getElementById('wsOut')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },
  async 'ws-use'(el) {
    const v = S.workshop.out?.versions?.[+el.dataset.i];
    if (!v?.apply || v.applied) return;
    const msg = await applySuggestion(v.apply);
    v.applied = true; swapPanel('workshop', workshopPanel()); toast(msg);
  },
  'ws-copy'(el) { const v = S.workshop.out?.versions?.[+el.dataset.i]; if (v) copy(v.text, 'Text'); },
  'drill-pick'(el) {
    const D = S.drill, q = DRILL[D.order[D.i % D.order.length]];
    if (D.picked) return;
    D.picked = el.dataset.k; D.done++; if (D.picked === q.style) D.right++;
    swapPanel('drill', drillPanel());
  },
  'drill-next'() {
    const D = S.drill;
    D.i++; D.picked = '';
    if (D.i >= D.order.length) { D.order = shuffled(DRILL.length); D.i = 0; }
    swapPanel('drill', drillPanel());
  },
};
const swapPanel = (id, html) => { const el = document.getElementById(id); if (el) el.outerHTML = html; };
// Logos are shrunk in the browser first, so the upload is small and quick.
async function uploadLogo(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast('Use a PNG or JPEG image.');
  const url = URL.createObjectURL(file), input = main.querySelector('[data-logo]');
  if (input) { input.disabled = true; input.closest('label')?.insertAdjacentHTML('afterend', '<span class="small muted" data-logo-busy><span class="spin"></span> Uploading your logo…</span>'); }
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('That image couldn’t be read.')); i.src = url; });
    const draw = (max, type) => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(img.naturalWidth * k)), height: Math.max(1, Math.round(img.naturalHeight * k)) });
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL(type, 0.9);
    };
    let data = draw(600, 'image/png');
    if (data.length > 900000) data = draw(600, 'image/jpeg');
    if (data.length > 900000) data = draw(320, 'image/jpeg');
    const r = await api('/api/brand/logo', { method: 'POST', body: { image: data } });
    S.me.workspace.logo = true; S.logoV = Date.now(); S.logoColors = r.colors || [];
    if (S.cfg.look.logo !== 'on') S.cfg.look.logo = 'on';
    drawBrand(); saveBar(); toast('Logo uploaded. Save to show it on new videos.');
  } catch (e) { toast(e.message); main.querySelector('[data-logo-busy]')?.remove(); if (input) input.disabled = false; }
  finally { URL.revokeObjectURL(url); }
}
function showLink(box, link, label) {
  if (!box) { if (link) copy(link, 'Invite link'); return; }   // (its box not on screen: the link is copied instead)
  const div = document.createElement('div');
  div.className = 'note ok stack';
  div.innerHTML = `<span class="small">${esc(label)}</span><code class="mono small" style="overflow-wrap:anywhere">${esc(link)}</code><div class="row"><button class="btn sm" type="button" data-act="copy-link" data-link="${esc(link)}">Copy link</button></div>`;
  if (box.hasAttribute('data-out') || box.id === 'inviteOut') box.replaceChildren(div); else box.append(div);
}
function updateBadge() {
  const n = S.videos.filter(v => v.status === 'pending').length;
  if (S.me.workspace) S.me.workspace.pending = n;
  const a = document.querySelector('.nav a[href="#/review"]');
  if (a) a.innerHTML = 'Review' + (n ? `<span class="badge">${n}</span>` : '');
}
/* ================= Coach: public/screens/coach.js ================= */
// What stays here from it: it runs as the page loads (the screen file loads before this one runs).
/* ================= Coach ================= */
// Two modes share one panel: 'content' (videos, prompts, settings) and 'comms' (how people take in
// information: DISC styles, behavior, selling). Each keeps its own conversation.
S.coach = { open: false, mode: 'content', msgs: [], focus: null, busy: false, ws: null, loaded: '', tab: 'ask', notes: null, reply: { busy: false, out: null, message: '', note: '' } };
Object.assign(actions, contentActions);
Object.assign(actions, signoffActions);
Object.assign(actions, repliesActions);   // Keyword replies on Instagram (public/screens/replies.js)   // Sign-off, the compliance reviewer's page (public/screens/signoff.js)
// The initial's menu is a disclosure: a tap elsewhere, Tab out of it, or Escape closes it. Escape puts
// focus back on the initial, and is used up there (Review's focus mode doesn't also close).
const closeMenu = (refocus = false) => { const pop = document.getElementById('mePop'); if (!pop || pop.hidden) return false; pop.hidden = true; const b = document.querySelector('.me-btn'); b?.setAttribute('aria-expanded', 'false'); if (refocus) b?.focus(); return true; };
document.addEventListener('click', e => { if (!e.target.closest?.('.me-menu')) closeMenu(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && closeMenu(true)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
document.addEventListener('focusout', e => { const m = e.target.closest?.('.me-menu'); if (m && e.relatedTarget && !m.contains(e.relatedTarget)) closeMenu(); });
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT' && el.type === 'checkbox') return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  Promise.resolve(fn(el, e)).catch(err => toast(err.message));
});

document.addEventListener('change', e => {
  const t = e.target;
  // The weekly plan's ticks survive a redraw (new videos arriving redraw Create).
  if (t.dataset.plan !== undefined) { const at = S.weekly?.weekly?.at || ''; if (S.planOff?.at !== at) S.planOff = { at, off: {} }; S.planOff.off[t.dataset.plan] = !t.checked; return; }
  if (t.dataset.act === 'accept') return actions.accept(t);
  if (t.dataset.wsSwitch !== undefined) { if (dirty() && !confirm('You have unsaved changes. Switch anyway?')) { t.value = S.me.workspace.id; return; } api('/api/workspaces/switch', { method: 'POST', body: { workspaceId: t.value } }).then(() => { location.hash = '#/'; location.reload(); }).catch(e => toast(e.message)); return; }
  if (t.dataset.act === 'accept-terms' && S.setup) { S.setup.acceptTerms = t.checked; return; }
  if (t.dataset.audit) { S.auditF[t.dataset.audit] = t.value; S.auditF.limit = 30; loadAudit(); return; }
  if (t.dataset.mindCheck !== undefined && S.mind) { api('/api/mindset/check', { method: 'POST', body: { habitId: t.dataset.mindCheck, done: t.checked } }).then(r => { S.mind = r; drawMindset(); if (t.checked) haptic(); }).catch(e => { t.checked = !t.checked; toast(`Not saved: ${e.message}`); }); return; }
  if (t.dataset.mindShow !== undefined && S.mind) { mindSave({ profile: { why: { ...S.mind.profile.why, show: t.checked ? 'on' : 'off' } } }, ''); return; }
  if (t.dataset.mindPersuasion !== undefined && S.mind) { mindSave({ profile: { persuasion: t.checked ? 'on' : 'off' } }, ''); return; }
  if (t.dataset.mindTopic !== undefined && S.mind) { mindSave({ profile: { objections: S.mind.profile.objections.map(o => (o.id === t.dataset.mindTopic ? { ...o, topic: t.checked } : o)) } }, t.checked ? 'Now a video topic.' : ''); return; }
  // Studio brief: each change is saved and the board follows it.
  if (t.dataset.stb && S.st) {
    const k = t.dataset.stb, v = t.value, patch = { [k]: k === 'scenes' || k === 'part' ? Number(v) : v };
    if (k === 'seriesId' || k === 'part') { const ser = (S.studioList?.series || []).find(x => x.id === (k === 'seriesId' ? v : S.st.d.brief.seriesId)); const part = k === 'part' ? Number(v) : 0; if (ser) Object.assign(patch, { part, format: ser.parts[part]?.format || S.st.d.brief.format }); }
    S.st.briefNote = '';
    // A new audience keeps the worry when it still fits; otherwise it says why it had to change (v15).
    if (k === 'audienceId') {
      const pain = S.cfg.story.painPoints.find(x => x.id === S.st.d.brief.painId), aud = S.cfg.story.audiences.find(x => x.id === v);
      if (pain && !(pain.links || []).includes(v)) { Object.assign(patch, { painId: '', insightIds: [] }); S.st.briefNote = `No confirmed fact links “${short(pain.text)}” to ${aud ? `“${short(aud.text)}”` : 'that audience'}, so pick one of their worries.`; }
    }
    if (k === 'painId') patch.insightIds = [];
    stBrief(patch); return;
  }
  if (t.dataset.stnofact !== undefined && S.st) { stBrief({ noFact: t.checked, insightIds: [] }); return; }
  if (t.dataset.stfact && S.st) { stBrief({ insightIds: [...document.querySelectorAll('[data-stfact]')].filter(x => x.checked).map(x => x.dataset.stfact) }); return; }
  if (t.dataset.chk) {
    const all = [...main.querySelectorAll(`[data-chk="${t.dataset.chk}"]`)];
    main.querySelector(`[data-act="approve"][data-id="${t.dataset.chk}"]`).disabled = !all.every(x => x.checked);
  }
  if (t.dataset.storyOk && S.cfg) { const it = S.cfg.bank.stories.find(x => x.id === t.dataset.storyOk); it.confirmed = t.checked; t.closest('.item').classList.toggle('confirmed', t.checked); t.closest('.item').classList.toggle('fact', t.checked); saveBar(); }
  if (t.dataset.swap !== undefined && S.fix) { const i = +t.dataset.swap; if (t.checked) { S.fix.swaps.add(i); if (S.fix.picks) delete S.fix.picks[i]; } else S.fix.swaps.delete(i); drawReview(); }
  if (t.dataset.factOk && S.setup?.draft) {
    const i = S.setup.draft.topics.find(x => x.id === t.dataset.factOk);
    i.confirmed = t.checked; i.confirmedAt = '';
    t.closest('.fact').classList.toggle('confirmed', t.checked);
    const n = S.setup.draft.topics.filter(x => x.confirmed && x.fact).length;
    const b = main.querySelector('.panel:last-of-type b'); if (b) b.textContent = `${n} of ${S.setup.draft.topics.length} checked`;
  }
  if (t.dataset.ans && t.tagName === 'SELECT') S.setup.answers[t.dataset.ans] = t.value;
  if (t.dataset.bind && t.tagName === 'SELECT') { setPath(S.cfg, t.dataset.bind, t.value); saveBar(); if (S.view === 'brand' || stepView()) drawBrand(); }
  if (t.dataset.logo !== undefined && t.files?.[0]) uploadLogo(t.files[0]);
  if (t.dataset.libup !== undefined && t.files?.[0]) uploadClip(t.files[0]);
  if (t.dataset.libdesc) api(`/api/library/${t.dataset.libdesc}`, { method: 'POST', body: { description: t.value } }).then(r => { S.lib.clips = r.clips; toast('Saved'); }).catch(err => toast(err.message));
  if (t.dataset.wsf && t.tagName === 'SELECT' && S.workshop) {
    const W = S.workshop, k = t.dataset.wsf;
    W[k] = t.value;
    if (k === 'itemId') {
      const it = wsItems(S.cfg, W.kind).find(x => x.id === t.value);
      W.text = it ? (W.kind === 'question' ? it.question || '' : it.text) : '';
      if (it && ['worry', 'question'].includes(W.kind) && !W.audienceId && it.links?.length) W.audienceId = it.links[0];
      if (it && W.kind === 'audience') W.audienceId = it.id;
      W.out = null;
      swapPanel('workshop', workshopPanel());
    }
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.ans) { S.setup.answers[t.dataset.ans] = t.value; return; }
  if (t.dataset.factText && S.setup?.draft) {
    const i = S.setup.draft.topics.find(x => x.id === t.dataset.factText);
    const changed = i.fact !== t.value;
    i.fact = t.value;
    const problems = checkInsightText(i.fact);
    main.querySelector(`[data-problems="${i.id}"]`).innerHTML = problems.map(p => `<li>${esc(p)}</li>`).join('');
    const box = main.querySelector(`[data-fact-ok="${i.id}"]`);
    box.disabled = problems.length > 0;
    if (changed && problems.length) { box.checked = false; i.confirmed = false; t.closest('.fact').classList.remove('confirmed'); }
    return;
  }
  if (t.dataset.sample !== undefined && S.cfg) { S.cfg.bank.samples[+t.dataset.sample] = t.value; saveBar(); return; }
  if (t.dataset.bankedit && S.cfg) {
    const it = S.cfg.bank[t.dataset.bankedit].find(x => x.id === t.dataset.id);
    it[t.dataset.k] = t.value;
    if (t.dataset.bankedit === 'stories') {
      it.confirmed = false;   // changed wording needs a fresh "this really happened"
      const pr = checkStoryText(it.text);
      main.querySelector(`[data-sproblems="${it.id}"]`).innerHTML = pr.map(x => `<li>${esc(x)}</li>`).join('');
      const box = main.querySelector(`[data-story-ok="${it.id}"]`); if (box) { box.checked = false; box.disabled = pr.length > 0; }
    }
    saveBar(); return;
  }
  if (t.dataset.fix !== undefined && S.fix) { S.fix.edits[+t.dataset.fix][t.dataset.k] = t.value; return; }
  if (t.dataset.sts !== undefined && S.st) { S.st.d.scenes[+t.dataset.sts][t.dataset.k] = t.value; stRefreshChecks(); stSave(); if (t.dataset.k === 'text') stSpell(); const sv = document.getElementById('stSaved'); if (sv) sv.textContent = 'Saving…'; return; }
  if (t.dataset.wsf === 'text' && S.workshop) { S.workshop.text = t.value; return; }
  if (t.dataset.bind && S.cfg && t.tagName !== 'SELECT') { setPath(S.cfg, t.dataset.bind, t.value); restory(); saveBar(); return; }
  if ((t.dataset.topic || t.dataset.topicOk) && S.cfg) onTopicInput(t);
});

document.addEventListener('submit', async e => {
  const f = e.target, kind = f.dataset.form;
  if (!kind) return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(f));
  const st = f.querySelector('[data-st]');
  const btn = f.querySelector('button:not([type="button"])');
  try {
    if (btn) btn.disabled = true;
    if (kind === 'login') {
      const r = await api('/api/login', { method: 'POST', body: { email: data.email, password: data.password } });
      if (r.twofa) { S.ticket = r.ticket; return viewTwofaLogin(); }
      await refreshMe(); registerSw(); if (freshAfterLogin()) return; afterLoginGo(); return;
    }
    if (kind === 'login2fa') {
      const r = await api('/api/login/2fa', { method: 'POST', body: { ticket: S.ticket, code: data.code } });
      S.ticket = null; S.ticketMsg = '';
      await refreshMe(); registerSw();
      if (r.usedBackup) toast(`Backup code used. ${r.backupLeft} left${r.backupLeft <= 3 ? ': make new ones under Account' : ''}.`);
      if (freshAfterLogin()) return; afterLoginGo(); return;
    }
    if (kind === 'link') {
      if (data.password !== data.password2) throw new Error('The two passwords don’t match.');
      const r = await api('/api/link/accept', { method: 'POST', body: { token: f.dataset.token, kind: f.dataset.kind, name: data.name, password: data.password, timezone: f.dataset.tz, acceptTerms: !!data.acceptTerms } });
      if (r.twofa) { S.ticket = r.ticket; S.ticketMsg = 'Password changed. Now enter the code from your authenticator app.'; return go('login'); }
      await refreshMe(); location.hash = '#/'; return;
    }
    if (kind === 'twofa-enable') {
      const r = await api('/api/2fa/enable', { method: 'POST', body: { code: data.code } });
      S.twofa = null; S.twofaCodes = r.backupCodes; S.me.account.twofa = true; S.me.twofaSetupRequired = false; drawTwofa(); return;
    }
    if (kind === 'twofa-newcodes') { const r = await api('/api/2fa/backup-codes', { method: 'POST', body: { code: data.code } }); S.twofaCodes = r.backupCodes; drawTwofa(); return; }
    if (kind === 'twofa-disable') {
      await api('/api/2fa/disable', { method: 'POST', body: { password: data.password, code: data.code } });
      S.me.account.twofa = false; drawTwofa(); toast('Two-factor login is off'); return;
    }
    if (kind === 'terms') {
      await api('/api/terms/accept', { method: 'POST', body: { accept: !!data.accept } });
      await refreshMe(); toast('Thanks. You’re all set.'); go(''); return;
    }
    if (kind === 'delete-request') {
      const r = await api('/api/data/delete-request', { method: 'POST', body: { confirm: !!data.confirm, note: data.note } });
      S.me.workspace = r.workspace; await viewAccount(); toast('Request sent'); return;
    }
    if (kind === 'name') { const r = await api('/api/account', { method: 'POST', body: { name: data.name } }); S.me.account = r.account; toast('Saved'); }
    if (kind === 'password') { await api('/api/account/password', { method: 'POST', body: data }); f.reset(); status(st, 'Password changed.', 'ok'); }
    if (kind === 'state') { const v = String(data.state || '').trim(); if (v && !S.setup.answers.states.includes(v)) S.setup.answers.states.push(v); drawSetup(); main.querySelector('[data-form="state"] input')?.focus(); }
    if (kind === 'pstate') { const v = String(data.state || '').trim(); if (v && !S.cfg.profile.states.includes(v)) S.cfg.profile.states.push(v); drawSettings(); saveBar(); }
    if (kind === 'rule') { const v = String(data.rule || '').trim(); if (v && !S.cfg.guardrails[f.dataset.k].some(x => x.toLowerCase() === v.toLowerCase())) S.cfg.guardrails[f.dataset.k].push(v.slice(0, 80)); redraw(); saveBar(); }
    if (kind === 'say') {
      const word = String(data.word || '').trim(), say = String(data.say || '').trim();
      if (!word || !say) return toast('Add the word and how to say it.');
      const problem = sayProblems(say, S.cfg)[0]; if (problem) return toast(problem);
      S.cfg.voice.say = [...(S.cfg.voice.say || []).filter(x => x.word.toLowerCase() !== word.toLowerCase()), { word: word.slice(0, 40), say: say.slice(0, 60) }];
      drawBrand(); saveBar(); toast('Added. Save to use it on new videos.');
    }
    if (kind === 'sample') { const v = String(data.text || '').trim(); if (v) { S.cfg.bank.samples.push(v.slice(0, 800)); drawContent(); saveBar(); toast('Added. Save to use it.'); } }
    if (kind === 'badd') {
      const v = String(data.text || '').trim(), list = f.dataset.list;
      if (v) { const it = { id: uid(list === 'stories' ? 'st' : 'q'), text: v, links: [], ...(list === 'stories' ? { confirmed: false } : {}) }; S.cfg.bank[list].unshift(it); drawContent(); saveBar(); }
    }
    if (kind === 'coach') { const q = String(data.q || '').trim(); if (q) { f.reset(); await sendCoach(q); } return; }
    if (kind === 'coach-reply') {
      const r = S.coach.reply;
      r.message = String(data.message || ''); r.note = String(data.note || ''); r.audienceId = String(data.audienceId || ''); r.busy = true; r.error = ''; drawCoach();
      try { r.out = await api('/api/coach/reply', { method: 'POST', body: { message: r.message, note: r.note, audienceId: r.audienceId } }); if (r.out.logged) loadCalibration().then(() => { if (S.view === 'communicate') drawCommunicate(); }); }
      catch (err) { r.error = err.message; }
      r.busy = false; drawCoach(); return;
    }
    if (kind === 'coach-note') {
      const text = String(data.text || '').trim();
      if (text) { S.coach.notes = (await api('/api/coach/notes', { method: 'POST', body: { text } })).notes; drawCoach(); }
      return;
    }
    if (kind.startsWith('mind-')) { await mindForm(kind, f, data); return; }
    if (kind === 'so-back') { await soBackForm(f, data); return; }
    if (kind.startsWith('reply-') && await repliesForm(kind, f, data)) return;
    if (kind === 'assistant-invite') {
      const r = await api('/api/people/invite', { method: 'POST', body: { email: data.email, role: 'assistant' } });
      S.people = { ...S.people, ...r }; drawTeam();
      showLink(document.getElementById('assistantOut'), r.link, `Send this invite link to ${data.email} (valid 7 days, single use):`);
      return;
    }
    if (kind === 'reviewer-invite') {
      const r = await api('/api/people/invite', { method: 'POST', body: { email: data.email, role: 'reviewer' } });
      S.people = { ...S.people, ...r }; drawTeam();
      showLink(document.getElementById('reviewerOut'), r.link, `Send this invite link to ${data.email} (valid 7 days, single use):`);
      return;
    }
    if (kind === 'topic-add') { addTopic(data); f.reset(); return; }
    if (kind === 'footage') {
      status(st, 'Searching and scoring… about 10 seconds.');
      S.footage = { ...(await api('/api/footage-test', { method: 'POST', body: data })), keyword: data.keyword, audienceId: data.audienceId };
      document.getElementById('footageOut').innerHTML = footageHTML(S.footage);
      status(st, '');
    }
    if (kind === 'posted') { await api(`/api/videos/${f.dataset.id}/posted`, { method: 'POST', body: { url: data.url } }); await loadVideos(); drawReview(); toast('Marked posted. Add views and messages in a few days.'); }
    if (kind === 'results') { await api(`/api/videos/${f.dataset.id}/results`, { method: 'POST', body: data }); await loadVideos(); drawReview(); toast('Saved'); }
    if (kind === 'invite') {
      const body = { email: data.email, workspaceName: data.workspaceName };
      if (data.workspaceId === '__admin') body.role = 'admin'; else if (data.workspaceId) body.workspaceId = data.workspaceId;
      const r = await api('/api/admin/invite', { method: 'POST', body });
      S.admin = await api('/api/admin/overview'); drawAdmin(); loadAudit();
      showLink(document.getElementById('inviteOut'), r.link, `Invite for ${data.email} (valid 7 days, single use). Send it to them directly:`);
    }
  } catch (err) {
    if (st) status(st, err.message, 'err'); else toast(err.message);
  } finally { if (btn && document.contains(btn)) btn.disabled = false; }
});

/* ================= Start ================= */
// The service worker (sw.js): notifications, preloading and offline review. It takes charge of the page
// as soon as it's active, no reload needed (clients.claim).
function registerSw() { if (offlineOK()) navigator.serviceWorker.register('/sw.js').catch(() => {}); }
(async function boot() {
  await refreshMe();
  if (!S.me) S.me = { account: null };
  render();
  watchJobs();   // picks up videos already being made
  pushCheck();
  if (S.me?.account) registerSw();
  // A tapped notification (sw.js) opens its video here, without reloading the page.
  if (offlineOK()) navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type !== 'open') return;
    try { const u = new URL(e.data.url, location.origin); if (u.origin === location.origin) { e.ports?.[0]?.postMessage('ok'); if (location.hash !== u.hash) location.hash = u.hash; else render(); } } catch { /* not ours */ }
  });
  flushOffline();
})();
// Ctrl/⌘+Z outside a text box undoes the last change to Content, Brand or Settings.
document.addEventListener('keydown', e => {
  if (e.key?.toLowerCase() !== 'z' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
  const t = e.target;
  if (t.closest?.('input, textarea, select, [contenteditable]') || !SETTINGS_VIEWS[S.view] || document.getElementById('prompter')) return;
  if (undoEdit()) e.preventDefault();
});

// What the screens use from here (public/screens/*.js).
export { canSee };
export { softGone, prunePreload, preloadMedia, ACCENT_COLORS, AI_VOICE_NOTE, AUTO_HABITS, BOOKS, DEFAULT_CONFIG, DRILL, FONTS, FOOTAGE_MIX, FORMATS, GOV_TERMS, LEVELS, LIMITS, PERSUASION, PLATFORMS, PRINCIPLES, REJECT_TIPS, RUBRIC, S, SALES, SERVER_TROUBLE, SHOT_TYPES, SKILLS, STRUCTURES, STYLES, STYLE_KEYS, VOICES, WORKSHOP_KINDS, accentHex, actions, ago, analyze, api, app, applySuggestionTo, badgeFromMe, beatPlan, calm, can, cantNow, checkInsightText, checkStoryText, cityOf, copy, countMixes, day, dirty, esc, estimateSeconds, factNotes, fetchError, getPath, go, gridPanel, insightStatus, later, loadCfg, loadPush,   local, main, nicheOf, normStyle, offlineOK, okBookingUrl, outage, overlayQueue, page, pageWs, plural,    pushInner, readQueue,   refreshMe, render, roleText, roll, saveBar, saveCfg, saveOneChange, short, shotList, status, stopTimers,  structureFits, studioChecks, studioFormatFor, studioPicks, styleLabel, suggestAccent, toast, updateBadge, usableRoutes, watchJobs, watching,  when, whyNoVideos, wsHeaders, wsKey, wsParam };
