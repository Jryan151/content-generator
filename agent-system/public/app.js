// Agent Reels screens. Every number comes from the engine in src/ reading one
// activity log. The work happens on Today, as one chain:
//   who to call → what happened (one tap) → what's next (set for you).
// "Mine" keeps your log on this device (src/store.js); "Demo" runs a
// fictional leader through the same engine.
import { state, setMode, setDemoAs, onMode, onSystem } from './state.js';
import { buildActivities, TZ, DEMO } from './seed/sample.js';
import { DEMO_TEAM, DEMO_LEADS, DEMO_PRODUCER_LEADS, DEMO_RECRUITS, DEMO_PLAYBOOK_READY, DEMO_LEVELS, demoQualityActivities, DEMO_LESSONS, DEMO_LESSON_TRIED } from './seed/demo-pipeline.js';
import { placeOnLadder, routineFor, isUnlocked } from './src/career.js';
import { todoFor } from './src/routines.js';
import { totalsFor, bucketKey } from './src/timeframes.js';
import { RECRUIT_STAGES } from './src/ladder.js';
import { quality, CHECKPOINTS } from './src/quality.js';
import { LEAD_STAGES, moveLead, nextRecruitStage, moveRecruit, addRecruit, dropRecruit, daysInStage } from './src/pipeline.js';
import { applyCheckins, checkinRow, ownProduction, ownPremium, daysOff, dayOffRow, leaderView } from './src/attention.js';
import { dayStatus, todayLayout, MORE } from './src/today.js';
import { payPicture } from './src/pay.js';
import * as sync from './sync.js';
import { CALL_OUTCOMES, MEETING_OUTCOMES, KITCHEN_CHECK, CARE_CALLS, CARE_OUTCOMES, logCall, logMeeting, logCareCall, approvePolicy, markPaymentMissed, graceDaysLeft, queueFor, needsYouNow, addDays, addWorkdays, isWorkday, dayText } from './src/calls.js';
import { migrate, readBackup, writeBackup, backupAge } from './src/store.js';

const $ = (id) => document.getElementById(id);
const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
const pct = (n) => (n === null ? '—' : Math.round(n * 100) + '%');
const dayLong = (k) => new Date(k + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
const dayShort = (k) => new Date(k + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const clock = (hhmm, ampm = false) => { const [hr, m] = hhmm.split(':').map(Number); return `${((hr + 11) % 12) + 1}:${String(m).padStart(2, '0')}${ampm ? (hr < 12 ? ' AM' : ' PM') : ''}`; };
const uid = () => Math.random().toString(36).slice(2, 10);
const stageLabel = (id) => LEAD_STAGES.find((s) => s.id === id)?.label ?? id;

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));

// ── Data for each mode ──────────────────────────────────────────────
const STORE_KEY = 'agent-reels-mine-v2';
const OLD_KEYS = ['agent-reels-mine-v1'];
const ME = 'me';
const localTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || TZ; } catch (e) { return TZ; } })();

let storageOk = true;
function loadMine() {
  try {
    const now = localStorage.getItem(STORE_KEY);
    if (now) return migrate(JSON.parse(now));
    for (const k of OLD_KEYS) { const old = localStorage.getItem(k); if (old) return migrate(JSON.parse(old)); }
  } catch (e) { storageOk = false; }
  return migrate(null);
}
let mine = loadMine();
let booted = false; // renders wait until we know whether this phone is signed in
function saveMine() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(mine)); storageOk = true; } catch (e) { storageOk = false; }
}

let demo = null;
function demoData() {
  demo ??= {
    activities: buildActivities(),
    quality: demoQualityActivities(),
    leads: DEMO_LEADS.filter((l) => l.agent_id === DEMO.leaderId).map((l) => ({ ...l })),
    recruits: DEMO_RECRUITS.map((r) => ({ ...r })),
    names: [],
    profile: { licensed: true },
    // The producer demo: Devon, one of Morgan's agents, with his own clients and no team.
    producer: { leads: DEMO_PRODUCER_LEADS.map((l) => ({ ...l })), recruits: [], names: [], profile: { licensed: true } },
    tapMinute: 0,
  };
  return demo;
}

/** Everything a screen needs for the current mode. */
function ctx() {
  if (state.mode === 'demo') {
    const d = demoData();
    const p = state.demoAs === 'producer' ? d.producer : null;
    return {
      demo: true, demoAs: p ? 'producer' : 'leader',
      me: p ? DEMO.producerId : DEMO.leaderId, myName: p ? DEMO.producerName : DEMO.leaderName,
      tz: TZ, dayKey: DEMO.activityTo, now: '15:00',
      activities: d.activities, qualityActs: d.quality, profile: (p || d).profile,
      leads: (p || d).leads, recruits: (p || d).recruits, names: (p || d).names,
      team: p ? [] : DEMO_TEAM, playbookReady: p ? false : DEMO_PLAYBOOK_READY,
      at: () => new Date(Date.UTC(2026, 9, 30, 22, d.tapMinute++ % 59)).toISOString(),
      save: () => {},
    };
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: localTz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
  const hh = parts.hour === '24' ? '00' : parts.hour;
  const realDay = `${parts.year}-${parts.month}-${parts.day}`;
  // Between midnight and 4 AM, taps can belong to yesterday: she said so with one tap (ui.lateDay).
  const lateHour = Number(hh) < 4;
  const late = lateHour && ui.lateDay === true;
  const sinceMidnight = (Number(hh) * 60 + Number(parts.minute) + 1) * 60_000;
  return {
    demo: false, me: ME, myName: sync.account.me?.name || state.setup?.name || 'You', tz: localTz,
    dayKey: late ? addDays(realDay, -1) : realDay, now: late ? '23:59' : `${hh}:${parts.minute}`,
    late, lateAsk: lateHour && ui.lateDay === undefined,
    activities: mine.activities, qualityActs: mine.activities, profile: mine.profile,
    leads: mine.leads, recruits: mine.recruits, names: mine.names, team: [], playbookReady: false,
    teamStages: sync.account.role === 'leader' ? sync.teamNow()?.stages ?? null : null,
    at: late ? () => new Date(Date.now() - sinceMidnight + (ui.lateTick++ % 59) * 1000).toISOString() : () => new Date().toISOString(),
    save: (before) => (sync.account.on ? sync.noteChange(before || []) : saveMine()),
  };
}

const sys = () => state.system;
// The leader's targets are hers; the producer demo has none of its own.
const planNow = () => (sys()?.targetsReady && !(state.mode === 'demo' && state.demoAs === 'producer') ? sys().plan : null);
const place = (c) => placeOnLadder({ person: { id: c.me, name: c.myName, licensed: c.profile.licensed ?? true }, team: c.team, activities: c.activities, dayKey: c.dayKey, tz: c.tz, playbookReady: c.playbookReady, teamStages: c.teamStages ?? null });

// ── Every change goes through here, so it can be undone for 10 seconds ──
let undo = null;
function act(c, message, change) {
  const snap = {
    mode: state.mode, demoAs: state.demoAs, acts: c.activities.length, quality: c.demo ? demoData().quality.length : null,
    leads: JSON.parse(JSON.stringify(c.leads)), recruits: JSON.parse(JSON.stringify(c.recruits)),
    names: JSON.parse(JSON.stringify(c.names)), profile: { ...c.profile },
  };
  try {
    const rows = change() || [];
    c.activities.push(...rows);
    if (c.demo) demoData().quality.push(...rows.filter((r) => ['app_written', 'policy_issued', 'chargeback'].includes(r.type)));
  } catch (e) { toast(e.message, null, true); return false; }
  c.save(snap.leads);
  clearTimeout(undo?.timer);
  undo = { snap, timer: setTimeout(() => { undo = null; hideToast(); }, 10_000) };
  toast(message, () => {
    const s = undo?.snap; if (!s || s.mode !== state.mode || s.demoAs !== state.demoAs) return;
    const cc = ctx();
    const before = JSON.parse(JSON.stringify(cc.leads));
    if (!cc.demo) sync.noteTruncate(s.acts);
    cc.activities.length = s.acts;
    if (cc.demo) demoData().quality.length = s.quality;
    cc.leads.splice(0, cc.leads.length, ...s.leads);
    cc.recruits.splice(0, cc.recruits.length, ...s.recruits);
    cc.names.splice(0, cc.names.length, ...s.names);
    for (const k of Object.keys(cc.profile)) if (!(k in s.profile)) delete cc.profile[k];
    Object.assign(cc.profile, s.profile);
    cc.save(before); clearTimeout(undo.timer); undo = null;
    toast('Undone. Nothing was logged.'); renderAll();
  });
  renderAll();
  return true;
}

function toast(message, onUndo = null, isError = false) {
  const t = $('toast');
  fill(t, h('span', {}, message), onUndo ? h('button', { type: 'button', class: 'undo', onclick: onUndo }, 'Undo') : null);
  t.className = isError ? 'toast err-toast' : 'toast';
  t.hidden = false;
  if (!onUndo) { clearTimeout(t._timer); t._timer = setTimeout(hideToast, isError ? 6000 : 3000); }
}
function hideToast() { $('toast').hidden = true; }

// ── Small building blocks ───────────────────────────────────────────
const ui = { open: null, skip: new Set(), priority: null, lateDay: undefined, lateTick: 0, keepGoing: false, weekendCalls: false }; // which card has its extra step open; people skipped this session
const head = (kicker, title) => h('div', {}, h('div', { class: 'kicker' }, kicker), h('h2', {}, title));
const focusCard = (kicker, text, sub) => h('div', { class: 'card focus' }, h('div', { class: 'kicker' }, kicker), h('div', { class: 'big' }, text), sub ? h('div', { class: 'muted' }, sub) : null);

function replies(list, onPick, disabled = () => false) {
  return h('div', { class: 'replies' }, list.map((o) => h('button', {
    type: 'button', class: `reply r-${o.id}`, disabled: disabled(o) || null, onclick: () => onPick(o.id),
  }, h('b', {}, o.label), h('span', {}, o.hint))));
}

// Her day in one line: the one number she controls (calls), and her next meeting if one is coming.
function dayLine(c, goal, later = []) {
  const t = totalsFor(c.activities, { tf: '1D', key: c.dayKey, tz: c.tz, agentIds: [c.me] });
  const m = later[0];
  return h('div', { class: 'card dayline' },
    h('div', {}, h('span', { class: 'big-num' }, goal ? `${t.dials} of ${goal}` : String(t.dials)), h('span', { class: 'muted' }, ' calls today')),
    m ? h('div', { class: 'muted' }, `Next meeting: ${m.meetingAt ? `${clock(m.meetingAt, true)}, ` : ''}${m.name}${later.length > 1 ? ` (${later.length} today)` : ''}`) : null);
}

// The one thing before the next call: a save, a meeting to log, or a welcome / first-payment call.
function needCard(c, item) {
  return item.kind === 'meeting' ? meetingCard(c, item.lead) : careCard(c, item.lead, item.kind);
}
// What's waiting behind it, named in one quiet line.
function afterThis(rest) {
  if (!rest.length) return null;
  const n = (k) => rest.filter((x) => x.kind === k).length;
  const say = (count, one, many) => (count ? (count === 1 ? one : `${count} ${many}`) : null);
  const parts = [
    say(n('save'), 'a missed payment', 'missed payments'),
    say(n('meeting'), 'a meeting to log', 'meetings to log'),
    say(n('welcome') + n('pre_draft'), 'a call to a new customer', 'calls to new customers'),
  ].filter(Boolean);
  return h('p', { class: 'muted after-this' }, `After this: ${parts.join(', ')}.`);
}

function dayBlocks(c, L, plan, own = null) {
  const r = routineFor(L.stage);
  // Production first: recruiting waits while her own calls are down. Someone who logs at night is
  // judged on yesterday's finished day, not on zero calls this morning.
  const hold = !!own?.down;
  const opts = { ...r, plan, activities: c.activities, agentId: c.me, tz: c.tz, times: sys()?.times || {}, content: false, hold };
  const keep = (x) => !['1M', '1Q', '1Y'].includes(x.tf); // monthly and longer views are parked
  const items = todoFor(c.dayKey, { ...opts, now: c.now }).filter(keep);
  const hidden = hold && todoFor(c.dayKey, { ...opts, hold: false }).filter(keep).length > items.length;
  return h('details', { class: 'card day' },
    h('summary', {}, h('b', {}, 'My schedule'), h('span', { class: 'muted' }, `${items.length} blocks`)),
    items.length
      ? h('ul', { class: 'blocks' }, items.map((x) => h('li', { class: x.done ? 'done-row' : '' },
          h('span', { class: 't' }, clock(x.at)), h('span', { class: 'title' }, x.title),
          x.goal != null ? h('span', { class: 'prog' }, `${x.progress ?? 0}/${x.goal}`) : h('span'))))
      : h('p', { class: 'muted' }, 'No blocks today. Weekends are off the routine.'),
    hidden ? h('p', { class: 'muted' }, 'Recruiting waits while your own calls are low. Your calls come first.') : null);
}

function backupNudge(c) {
  if (c.demo) return null;
  if (sync.account.on) return null; // saved to the team: the note above the screens says how saving is going
  const age = backupAge(mine);
  if (!storageOk) return h('a', { class: 'card warn', href: '#setup' }, h('b', {}, 'This browser isn’t saving your log'), h('span', { class: 'muted' }, 'Private mode or blocked storage. Copy a backup now so nothing is lost.'));
  if (age === null || age < 7) return null;
  return h('a', { class: 'card warn', href: '#setup' }, h('b', {}, 'Back up your log'), h('span', { class: 'muted' }, mine.lastBackupAt ? `Last backup ${age} days ago.` : `Never backed up. ${age} days of logging live only on this device.`));
}

// Signed in: how saving to the team is going. Lives above the screens, so it can change without redrawing them.
function accountNotice() {
  const a = sync.account;
  if (!a.on && a.status !== 'error') return null;
  if (a.importable) {
    const n = a.importable;
    return h('div', { class: 'card warn' },
      h('b', {}, `This phone has ${n.acts} log entries and ${n.leads} people from before you signed in`),
      h('span', { class: 'muted' }, 'Move them into your account, so they’re saved and count toward your progress? You can only do this once.'),
      h('div', { class: 'inline' },
        h('button', { type: 'button', class: 'go', onclick: () => sync.importLocal(localMine).then(() => { mine = sync.current(); toast('Moved. Everything is saved to your account now.'); renderAll(); }, (e) => toast(e.message, null, true)) }, 'Move them'),
        h('button', { type: 'button', class: 'link', onclick: () => { sync.skipImport(); renderAll(); } }, 'Start fresh')));
  }
  if (a.lost) {
    return h('div', { class: 'card warn' },
      h('b', {}, `${a.lost} change${a.lost === 1 ? '' : 's'} from this phone couldn’t be kept`),
      h('span', { class: 'muted' }, 'Your log was saved from another phone or computer first, so this one now shows that copy. Check your last few taps.'),
      h('button', { type: 'button', class: 'mini', onclick: () => { a.lost = 0; drawAccountNote(); } }, 'Got it'));
  }
  if (a.status === 'error') {
    return h('div', { class: 'card warn' }, h('b', {}, 'Not saving to your team'), h('span', { class: 'muted' }, a.error),
      a.on ? h('button', { type: 'button', class: 'mini', onclick: () => sync.flush() }, 'Try again') : h('a', { class: 'mini', href: '#setup' }, 'Sign in'));
  }
  if (a.status === 'offline') {
    const n = sync.pending();
    return h('p', { class: 'muted' }, `No signal. ${n} change${n === 1 ? ' is' : 's are'} kept on this phone and save when you’re back online.`);
  }
  return null;
}
function drawAccountNote() {
  const box = $('acct-note');
  if (box) fill(box, state.mode === 'demo' ? null : accountNotice());
}

// ── Today ───────────────────────────────────────────────────────────
/** Replace a person's fields with the engine's version (fields it removed are removed). */
function replaceLead(lead, next) {
  for (const k of Object.keys(lead)) if (!(k in next)) delete lead[k];
  Object.assign(lead, next);
}

function renderToday() {
  const c = ctx();
  const screen = $('screen-today');
  const top = head(`${dayLong(c.dayKey).toUpperCase()} · ${clock(c.now, true)}`, 'Today');

  // First visit: one question decides where you start.
  if (c.profile.licensed === null) {
    fill(screen, top, h('div', { class: 'card focus' },
      h('div', { class: 'kicker' }, 'ONE QUESTION TO START'),
      h('div', { class: 'big' }, 'Are you licensed to sell life insurance yet?'),
      h('div', { class: 'replies two' },
        h('button', { type: 'button', class: 'reply', onclick: () => act(c, 'Studying first. Your calls open when you pass.', () => { c.profile.licensed = false; }) }, h('b', {}, 'Not yet'), h('span', {}, 'Start with the exam')),
        h('button', { type: 'button', class: 'reply', onclick: () => act(c, 'Starting with calls.', () => { c.profile.licensed = true; }) }, h('b', {}, 'Yes'), h('span', {}, 'Start making calls')))));
    return;
  }

  const L = place(c);
  if (L.stage === 'licensing') return renderStudyDay(c, L, top);

  const plan = planNow();
  const urgent = teamView(c)?.top || null;
  const q = queueFor(c.leads.filter((l) => l.agent_id === c.me), c.dayKey, { weekendCalls: ui.weekendCalls });
  const calls = q.calls.filter((l) => !ui.skip.has(l.id));
  const pi = calls.findIndex((l) => l.id === ui.priority);
  if (pi > 0) calls.unshift(...calls.splice(pi, 1));
  const next = calls[0];
  const allSkipped = !next && q.calls.length > 0;

  // A full day: her real target once it exists, otherwise the number she set herself. Never a guess.
  const goal = plan?.daily?.dials ?? c.profile.dayCalls ?? null;
  const t = totalsFor(c.activities, { tf: '1D', key: c.dayKey, tz: c.tz, agentIds: [c.me] });
  const status = dayStatus({ goal, dials: t.dials, now: c.now, stopAt: c.profile.stopAt, workday: isWorkday(c.dayKey), keepGoing: ui.keepGoing, late: c.late, meetingsLeft: q.meetings.length });
  // One thing before the next call, however many are waiting: the rest are named under it.
  const need = needsYouNow(q, { today: c.dayKey, now: c.now });
  const nowCards = need.first ? [needCard(c, need.first), afterThis(need.rest)] : [];
  const own = ownProduction(c.activities, { me: c.me, dayKey: c.dayKey, tz: c.tz });
  const offToday = !c.demo && isWorkday(c.dayKey) && daysOff(c.activities.filter((a) => a.agent_id === c.me), c.tz).has(c.dayKey) && !ui.keepGoing;
  if (offToday) {
    fill(screen, top, lateCard(c),
      nowCards,
      h('section', { class: 'card call empty' }, h('div', { class: 'kicker' }, 'DAY OFF'),
        h('div', { class: 'who-big quiet' }, 'You’re off today'),
        h('div', { class: 'muted' }, 'It won’t count against your calls. Tomorrow’s list is set.'),
        h('button', { type: 'button', class: 'link', onclick: () => { ui.keepGoing = true; renderToday(); } }, 'Work anyway')));
    return;
  }
  const weekendQuiet = q.weekend && !next && !q.saves.length && !q.meetings.length;

  // Each slot does one job (src/today.js says which show, in which order).
  const notice = lateCard(c) || backupNudge(c);
  // The team slot is for a leader's one team thing, or her own calls being low. An agent's
  // "focus" lives on Progress: repeating it here every morning was noise.
  const lesson = !isLeaderView(c) && isWorkday(c.dayKey) ? nextLesson(c) : null;
  const team = own.down ? ownDownCard(c, own)
    : urgent ? needsYouCard(c, urgent)
    : lesson ? lessonCard(c, lesson) : null;
  const SLOT = {
    notice: () => notice,
    now: () => nowCards,
    next: () => status.callsDone ? callsDoneCard(c, t, q.meetings)
      : weekendQuiet ? weekendCard(q) : next ? callCard(c, next, calls.length) : allSkipped
        ? h('section', { class: 'card call empty' }, h('div', { class: 'kicker' }, 'CALL NEXT'), h('div', { class: 'who-big quiet' }, `You skipped all ${q.calls.length}`), h('button', { type: 'button', class: 'go', onclick: () => { ui.skip.clear(); renderToday(); } }, 'Start the list again'))
        : emptyQueue(c, goal, t.dials),
    team: () => team,
    day: () => [dayLine(c, goal, need.later), goal || c.demo ? null : fullDayCard(c), plan?.daily?.dials && !c.demo ? goalNote(c, plan.daily.dials) : null],
    done: () => doneCard(c, { t, goal, byCalls: status.by === 'calls', next }),
  };
  const layout = todayLayout({ notice: !!notice, now: nowCards.length > 0, team: !!team, done: status.done });
  fill(screen, top, layout.slots.map((id) => SLOT[id]()), moreCard(c, L, plan, own, { canTakeOff: !status.done && t.dials === 0 && isWorkday(c.dayKey) && !c.late }));
}

// While her own calls are down, this takes the team slot: her selling comes first.
function ownDownCard(c, own) {
  const n = own.unmarkedZeroDays.length;
  return h('div', { class: 'card focus' }, h('div', { class: 'kicker' }, 'YOUR CALLS ARE LOW'),
    h('div', { class: 'big' }, `About ${own.recentPerDay} calls a day the last 2 weeks, down from ${own.priorPerDay}.`),
    h('div', { class: 'muted' }, 'Your own calls come first until they’re back. Team work can wait a few days.'),
    n ? h('button', { type: 'button', class: 'mini', onclick: () => act(c, `Marked ${n} day${n === 1 ? '' : 's'} off. They no longer count against your calls.`, () => own.unmarkedZeroDays.map((day) => dayOffRow({ me: c.me, day, at: c.at() }))) }, `I was off ${n === 1 ? 'that day' : `those ${n} days`} (holiday, sick)`) : null);
}

// Everything that isn't one of Today's five jobs, folded away.
function moreCard(c, L, plan, own, { canTakeOff }) {
  const items = {
    quickCall: () => quickCall(c),
    addPeople: () => addPeople(c),
    lessons: () => { const n = lessonsFor(c).length; return n && !isLeaderView(c) ? h('button', { type: 'button', class: 'card quick', onclick: () => openLessonList(c) }, h('b', {}, `All lessons (${n})`), h('span', { class: 'muted' }, 'Watch or read any of them again')) : null; },
    sendDay: () => sendMyDay(c),
    dayOff: () => canTakeOff && !c.demo ? h('button', { type: 'button', class: 'card quick', onclick: () => act(c, 'Marked today off. It won’t count against your calls.', () => [dayOffRow({ me: c.me, day: c.dayKey, at: c.at() })]) }, h('b', {}, 'Taking today off'), h('span', { class: 'muted' }, 'It won’t count against your calls')) : null,
    schedule: () => dayBlocks(c, L, plan, own),
  };
  return h('details', { class: 'more', open: ui.moreOpen || null, ontoggle: (e) => { ui.moreOpen = e.target.open; } },
    h('summary', {}, 'More'),
    MORE.map((id) => items[id]()));
}

function lateCard(c) {
  if (c.demo) return null;
  if (c.lateAsk) {
    const y = dayShort(addDays(c.dayKey, -1));
    return h('section', { class: 'card warn' },
      h('b', {}, 'It’s after midnight. Logging yesterday’s calls?'),
      h('span', { class: 'muted' }, `Yes puts what you tap now on ${y}, so your day adds up right.`),
      h('div', { class: 'inline' },
        h('button', { type: 'button', class: 'go', onclick: () => { ui.lateDay = true; renderAll(); } }, `Yes, ${y}`),
        h('button', { type: 'button', class: 'link', onclick: () => { ui.lateDay = false; renderAll(); } }, 'No, today')));
  }
  if (c.late) {
    return h('div', { class: 'card warn' },
      h('b', {}, `Logging for ${dayLong(c.dayKey)}`),
      h('button', { type: 'button', class: 'link', onclick: () => { ui.lateDay = false; renderAll(); } }, 'Switch to today'));
  }
  return null;
}

function doneCard(c, { t, goal, byCalls, next }) {
  return h('section', { class: 'card focus done' },
    h('div', { class: 'kicker' }, 'DONE FOR TODAY'),
    h('div', { class: 'big' }, byCalls ? `${t.dials} calls. That’s a full day.` : `It’s past ${clock(c.profile.stopAt, true)}. Your workday is over.`),
    h('div', { class: 'muted' }, byCalls ? 'Go be with your people. Everything else waits for tomorrow.' : `${t.dials}${goal ? ` of ${goal}` : ''} calls today. Whatever’s left moves to tomorrow.`),
    payLine(payNow(c), { blankOk: false }),
    next ? h('div', {}, h('b', {}, 'Tomorrow starts with: '), next.name) : null,
    h('button', { type: 'button', class: 'link', onclick: () => { ui.keepGoing = true; renderToday(); } }, 'Keep working anyway'));
}

// Her calls are done, but meetings are still ahead: the day isn't over, the selling part is next.
function callsDoneCard(c, t, meetings) {
  const m = meetings[0];
  const when = m.meetingOn && m.meetingOn < c.dayKey ? `from ${dayShort(m.meetingOn)}, still needs what happened` : m.meetingAt ? `at ${clock(m.meetingAt, true)}` : 'today';
  return h('section', { class: 'card focus' },
    h('div', { class: 'kicker' }, 'CALLS DONE'),
    h('div', { class: 'big' }, `${t.dials} calls. Your meetings are next.`),
    h('div', { class: 'muted' }, `${m.name} ${when}${meetings.length > 1 ? `, then ${meetings.length - 1} more` : ''}. Your day is done once each one is logged above.`),
    h('button', { type: 'button', class: 'link', onclick: () => { ui.keepGoing = true; renderToday(); } }, 'Keep calling until then'));
}

function weekendCard(q) {
  return h('section', { class: 'card call empty' },
    h('div', { class: 'kicker' }, 'WEEKEND'),
    h('div', { class: 'who-big quiet' }, 'Nothing is due today'),
    h('div', { class: 'muted' }, q.waiting ? `${q.waiting} call${q.waiting === 1 ? '' : 's'} wait for Monday.` : 'Monday’s list is set.'),
    q.waiting ? h('button', { type: 'button', class: 'link', onclick: () => { ui.weekendCalls = true; renderToday(); } }, 'Make calls anyway') : null);
}

function fullDayCard(c) {
  return h('section', { class: 'card' },
    h('b', {}, 'What’s a full day for you?'),
    h('p', { class: 'muted' }, 'Set it once. When you get there, Today tells you you’re done.'),
    h('div', { class: 'inline' },
      h('input', { id: 'day-calls', type: 'number', inputmode: 'numeric', min: '1', max: '500', placeholder: 'Calls', 'aria-label': 'Calls in a full day' }),
      h('input', { id: 'day-stop', type: 'time', step: '900', 'aria-label': 'Workday ends (optional)' })),
    h('span', { class: 'muted' }, 'Calls in a full day, and when your workday ends (optional).'),
    h('button', { type: 'button', class: 'go', onclick: () => {
      const n = Number($('day-calls').value), stop = $('day-stop').value;
      if (!(n >= 1 && n <= 500)) { toast('Enter how many calls make a full day.', null, true); return; }
      act(c, `Saved: ${n} calls is a full day${stop ? `, ending ${clock(stop, true)}` : ''}.`, () => { c.profile.dayCalls = Math.round(n); if (stop) c.profile.stopAt = stop; else delete c.profile.stopAt; });
    } }, 'Save'));
}

// When her real targets set the full day, say what it is and, when it moves, why. Never a silent change.
function goalNote(c, calls) {
  const seen = c.profile.goalSeen;
  if (seen && seen.calls === calls) return null;
  const rates = sys()?.rates || {};
  const pct = (x) => `${Math.round(x * 100)}%`;
  const NAMES = { closeRate: 'close rate (applications per meeting)', bookingRate: 'booking rate (meetings per conversation)', contactRate: 'contact rate (conversations per call)' };
  const moved = seen?.rates ? Object.keys(NAMES).filter((k) => rates[k] && seen.rates[k]).map((k) => ({ k, d: rates[k] - seen.rates[k] })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0] : null;
  const why = !seen ? 'From your earnings goal and your own numbers.'
    : `It was ${seen.calls}.${moved && Math.abs(moved.d) >= 0.01 ? ` Your ${NAMES[moved.k]} went from ${pct(seen.rates[moved.k])} to ${pct(rates[moved.k])}, so the same goal takes ${calls > seen.calls ? 'more' : 'fewer'} calls.` : ''}`;
  return h('section', { class: 'card' },
    h('div', { class: 'kicker' }, 'YOUR FULL DAY'),
    h('b', {}, `${calls} calls is a full day${seen && seen.calls !== calls ? ' now' : ''}`),
    why ? h('p', { class: 'muted' }, why) : null,
    c.profile.stopAt ? null : h('div', { class: 'inline' }, h('span', { class: 'muted' }, 'Workday ends'), h('input', { id: 'goal-stop', type: 'time', step: '900', 'aria-label': 'Workday ends (optional)' })),
    h('button', { type: 'button', class: 'mini', onclick: () => {
      const v = $('goal-stop')?.value;
      act(c, v ? `Got it. Your workday ends at ${clock(v, true)}.` : 'Got it.', () => { c.profile.goalSeen = { calls, rates: { closeRate: rates.closeRate, bookingRate: rates.bookingRate, contactRate: rates.contactRate } }; if (v) c.profile.stopAt = v; });
    } }, 'Got it'));
}

// Her own sales next to what her team paid her, net of lapses (src/pay.js). Blank until contract levels are in.
function payNow(c) {
  return teamView(c)?.pay ?? null; // demo: worked out here; signed-in leader: sent by the team's site (leaderView)
}

function payLine(p, { blankOk = true } = {}) {
  if (!p) return null;
  if (!p.ready) return blankOk ? h('div', { class: 'muted' }, `Your pay next to your team’s shows once contract levels are in${p.waitingOn?.length ? ` (missing: ${p.waitingOn.join(', ')})` : ''}.`) : null;
  const lost = p.own.clawback + p.team.clawback;
  return h('div', {}, h('b', {}, `Last ${p.days} days: `), `your sales paid you ${usd(p.own.net)}, your team paid you ${usd(p.team.net)}.`,
    lost ? h('span', { class: 'muted' }, ` After ${usd(lost)} taken back for customers who stopped paying.`) : null);
}

function needsYouCard(c, p) {
  return h('section', { class: 'card focus' },
    h('div', { class: 'kicker' }, 'ONE TEAM THING'),
    h('div', { class: 'big' }, p.action),
    h('div', { class: 'muted' }, `${p.name}: ${p.reason}`),
    h('div', { class: 'inline' },
      h('button', { type: 'button', class: 'mini', onclick: () => talkedTo(c, p) }, `I talked to ${p.name.replace(/\.$/, '')}`),
      h('a', { class: 'link', href: '#team' }, 'My people')));
}

function talkedTo(c, p) {
  act(c, `Checked in with ${p.name.replace(/\.$/, '')}. They rest for 3 workdays; if nothing changes, they come back.`, () => [checkinRow({ me: c.me, personId: p.id, at: c.at() })]);
}

// The extra step some outcomes need: a day and time, or the premium and the kitchen-table check.
function outcomeStep(c, lead, outcome, onDone) {
  const id = (k) => `${k}-${lead.id}`;
  const back = h('button', { type: 'button', class: 'link', onclick: () => { ui.open = null; renderToday(); } }, 'Back');
  if (outcome === 'booked' || outcome === 'callback') {
    const isMeeting = outcome === 'booked';
    return h('div', { class: 'stepper' },
      h('label', { for: id('day') }, isMeeting ? `Meeting with ${lead.name}` : `Call ${lead.name} back`),
      h('div', { class: 'inline' },
        h('input', { id: id('day'), type: 'date', min: c.dayKey, value: addDays(c.dayKey, 1), 'aria-label': 'Day' }),
        h('input', { id: id('time'), type: 'time', step: '900', 'aria-label': 'Time (optional)' })),
      h('span', { class: 'muted' }, 'Time is optional.'),
      h('button', { type: 'button', class: 'go', onclick: () => onDone({ [isMeeting ? 'meetingOn' : 'callbackOn']: $(id('day')).value, [isMeeting ? 'meetingAt' : 'callbackAt']: $(id('time')).value || null }) }, isMeeting ? 'Book it' : 'Set the call-back'),
      back);
  }
  // applied: premium plus the four kitchen-table checks
  return h('div', { class: 'stepper' },
    h('label', { for: id('prem') }, 'What they’ll pay a year'),
    h('span', { class: 'money-in' }, h('span', {}, '$'), h('input', { id: id('prem'), type: 'number', inputmode: 'numeric', min: '1', placeholder: '720' })),
    h('fieldset', { class: 'checks' },
      h('legend', {}, 'Before you send it, check all four:'),
      KITCHEN_CHECK.map((k) => h('label', { class: 'check' }, h('input', { type: 'checkbox', id: id(`k-${k.id}`), 'data-check': k.id }), h('span', {}, k.label)))),
    h('button', { type: 'button', class: 'go', onclick: () => {
      const premium = Number($(id('prem')).value);
      const checks = Object.fromEntries(KITCHEN_CHECK.map((k) => [k.id, $(id(`k-${k.id}`)).checked]));
      onDone({ premium, checks });
    } }, 'Send the application'),
    back);
}

const NEXT_TEXT = {
  no_answer: 'Back in your list soon.', talked: 'Follow up in 2 days.', not_interested: 'Closed out.', bad_number: 'Removed from your calls.',
};

function callCard(c, lead, count) {
  const status = lead.stage === 'new'
    ? (lead.tries ? `New · no answer ${lead.tries === 1 ? 'once' : `${lead.tries} times`}` : 'New · never called')
    : `${stageLabel(lead.stage)} · ${lead.callbackAt && lead.nextOn === c.dayKey ? `call back at ${clock(lead.callbackAt, true)}` : `follow-up due ${lead.nextOn && lead.nextOn < c.dayKey ? `since ${dayShort(lead.nextOn)}` : 'today'}`}`;
  const step = ['booked', 'callback', 'applied'].find((o) => ui.open === `${o}:${lead.id}`);
  const save = (outcome, extra = {}) => {
    const msg = {
      booked: () => `Meeting booked with ${lead.name} for ${dayShort(extra.meetingOn)}${extra.meetingAt ? ` at ${clock(extra.meetingAt, true)}` : ''}.`,
      callback: () => `Call ${lead.name} back ${dayShort(extra.callbackOn)}${extra.callbackAt ? ` at ${clock(extra.callbackAt, true)}` : ''}.`,
      applied: () => `${lead.name}: application sent. Mark the insurer’s answer in Clients.`,
    }[outcome]?.() ?? `${lead.name}: ${CALL_OUTCOMES.find((o) => o.id === outcome).label.toLowerCase()}. ${NEXT_TEXT[outcome] ?? ''}`;
    const was = ui.open; ui.open = null;
    if (!act(c, msg, () => { const r = logCall(lead, outcome, { agentId: c.me, at: c.at(), today: c.dayKey, ...extra }); replaceLead(lead, r.lead); return r.rows; })) { ui.open = was; }
  };
  const pick = (outcome) => {
    if (['booked', 'callback', 'applied'].includes(outcome)) { ui.open = `${outcome}:${lead.id}`; return renderToday(); }
    save(outcome);
  };
  return h('section', { class: 'card call', 'aria-label': `Call ${lead.name}` },
    h('div', { class: 'row' }, h('div', { class: 'kicker' }, 'CALL NEXT'), h('span', { class: 'muted' }, `${count} to call today`)),
    h('div', { class: 'who-big' }, lead.name),
    h('div', { class: 'muted' }, status),
    h('div', { class: 'ask' }, step ? CALL_OUTCOMES.find((o) => o.id === step).label : 'After the call, tap what happened:'),
    step ? outcomeStep(c, lead, step, (extra) => save(step, extra))
      : [replies(CALL_OUTCOMES.filter((o) => !o.minor), pick),
         h('div', { class: 'row' },
           count > 1 ? h('button', { type: 'button', class: 'link', onclick: () => { ui.skip.add(lead.id); renderToday(); } }, 'Skip for now') : h('span'),
           h('button', { type: 'button', class: 'link quiet-link', onclick: () => save('bad_number') }, 'Wrong or bad number'))]);
}

function meetingCard(c, lead) {
  const open = ui.open === `applied:${lead.id}`;
  const missed = lead.meetingOn && lead.meetingOn < c.dayKey;
  const kicker = missed ? `MEETING ON ${dayShort(lead.meetingOn).toUpperCase()} · NOT LOGGED YET`
    : lead.meetingAt ? `MEETING · ${clock(lead.meetingAt, true)}` : 'MEETING TODAY';
  const done = (outcome, extra = {}) => {
    const msg = { applied: `${lead.name}: application sent. Mark the insurer’s answer in Clients.`, no_sale: `${lead.name}: met, no sale yet. Follow up ${dayShort(addDays(c.dayKey, 3))}.`, no_show: `${lead.name}: no-show. They’re back on tomorrow’s calls.` }[outcome];
    const was = ui.open; ui.open = null;
    if (!act(c, msg, () => { const r = logMeeting(lead, outcome, { at: c.at(), today: c.dayKey, ...extra }); replaceLead(lead, r.lead); return r.rows; })) { ui.open = was; }
  };
  return h('section', { class: 'card call meeting', 'aria-label': `Meeting with ${lead.name}` },
    h('div', { class: 'kicker' }, kicker),
    h('div', { class: 'who-big' }, lead.name),
    h('div', { class: 'ask' }, open ? 'Application sent' : missed ? 'What happened at that meeting?' : 'After the meeting, tap what happened:'),
    open ? outcomeStep(c, lead, 'applied', (extra) => done('applied', extra))
      : replies(MEETING_OUTCOMES, (o) => { if (o === 'applied') { ui.open = `applied:${lead.id}`; renderToday(); } else done(o); }));
}

// Calls that protect an approved policy: welcome, before the first draft, and the save.
function careCard(c, lead, kind) {
  const spec = CARE_CALLS[kind];
  const left = kind === 'save' ? graceDaysLeft(lead, c.dayKey) : null;
  const sub = kind === 'save'
    ? (left === null ? 'Check the insurer’s letter for the last day to fix it.' : left >= 0 ? `${left} day${left === 1 ? '' : 's'} left to fix it before the policy ends` : 'The last day to fix it has passed. Call the insurer too.')
    : kind === 'pre_draft' && lead.draftOn ? `First payment comes out ${dayShort(lead.draftOn)}` : `Approved ${lead.approvedOn ? dayShort(lead.approvedOn) : ''}`.trim();
  const pick = (outcome) => {
    const msg = { reached: `${lead.name}: ${spec.label.toLowerCase()} done.`, no_answer: `${lead.name}: no answer. Back tomorrow.`, payment_problem: `${lead.name}: payment problem. A save call is now at the top of Today.`, fixed: `${lead.name}: payment fixed. Policy saved.`, canceling: `${lead.name}: policy lost.` }[outcome];
    act(c, msg, () => { const r = logCareCall(lead, kind, outcome, { at: c.at(), today: c.dayKey }); replaceLead(lead, r.lead); return r.rows; });
  };
  return h('section', { class: `card call ${kind === 'save' ? 'save' : 'care'}`, 'aria-label': `${spec.label}: ${lead.name}` },
    h('div', { class: 'row' }, h('div', { class: 'kicker' }, spec.label.toUpperCase()), lead.premium ? h('span', { class: 'muted' }, `${usd(lead.premium)} a year`) : null),
    h('div', { class: 'who-big' }, lead.name),
    h('div', { class: kind === 'save' && left !== null && left <= 7 ? 'countdown' : 'muted' }, sub),
    h('div', { class: 'muted' }, spec.why),
    replies(spec.outcomes.map((id) => ({ id, ...CARE_OUTCOMES[id] })), pick));
}

function emptyQueue(c, goal = null, dials = 0) {
  const later = c.leads.filter((l) => l.agent_id === c.me && ['new', 'contacted', 'appointment'].includes(l.stage) && (l.nextOn || l.meetingOn))
    .map((l) => ({ l, on: l.stage === 'appointment' ? l.meetingOn : l.nextOn })).sort((a, b) => a.on.localeCompare(b.on))[0];
  if (later) return h('section', { class: 'card call empty' },
    h('div', { class: 'kicker' }, 'CALL NEXT'),
    h('div', { class: 'who-big quiet' }, 'All caught up for today'),
    h('div', { class: 'muted' }, `Next up: ${later.l.name}, ${later.l.stage === 'appointment' ? 'meeting' : 'call'} on ${dayShort(later.on)}.${goal && dials < goal ? ` ${goal - dials} more call${goal - dials === 1 ? '' : 's'} makes a full day: add people below.` : ''}`));
  return h('section', { class: 'card call empty' },
    h('div', { class: 'kicker' }, 'CALL NEXT'),
    h('div', { class: 'who-big quiet' }, 'No one on your list'),
    h('div', { class: 'muted' }, 'Add the people you’re going to call below. Each one shows up here, one at a time.'));
}

function quickCall(c) {
  const open = ui.open === 'quick';
  if (!open) return h('button', { type: 'button', class: 'card quick', onclick: () => { ui.open = 'quick'; renderToday(); } },
    h('b', {}, 'Called someone new?'), h('span', { class: 'muted' }, 'Log it in one tap'));
  const nameId = 'quick-name';
  const pick = (outcome) => {
    const name = $(nameId).value.trim();
    const needsStep = ['booked', 'callback', 'applied'].includes(outcome);
    if (needsStep && !name) { toast('Add their name first, so it has someone to belong to.', null, true); return; }
    if (needsStep) {
      const id = uid();
      ui.open = `${outcome}:${id}`; ui.priority = id;
      act(c, `${name} added. Finish the details on their card.`, () => { c.leads.unshift({ id, agent_id: c.me, name, stage: 'new', premium: null }); });
      return;
    }
    let lead = null;
    act(c, name ? `${name}: ${CALL_OUTCOMES.find((o) => o.id === outcome).label.toLowerCase()}.` : 'Call logged.', () => {
      if (name) { lead = { id: uid(), agent_id: c.me, name, stage: 'new', premium: null }; c.leads.unshift(lead); }
      ui.open = null;
      const r = logCall(lead, outcome, { agentId: c.me, at: c.at(), today: c.dayKey });
      if (lead) replaceLead(lead, r.lead);
      return r.rows;
    });
  };
  return h('section', { class: 'card' },
    h('div', { class: 'row' }, h('b', {}, 'Quick call'), h('button', { type: 'button', class: 'link', onclick: () => { ui.open = null; renderToday(); } }, 'Close')),
    h('label', { class: 'muted', for: nameId }, 'Their name (optional unless you booked or sold)'),
    h('input', { id: nameId, class: 'text-in', type: 'text', autocomplete: 'off', placeholder: 'Leave blank if you don’t have it' }),
    replies(CALL_OUTCOMES.filter((o) => !o.minor), pick));
}

// The day, as a text for the upline: works today, with no shared database.
function sendMyDay(c) {
  const open = ui.open === 'sendday';
  if (!open) return h('button', { type: 'button', class: 'card quick', onclick: () => { ui.open = 'sendday'; renderToday(); } },
    h('b', {}, 'Text my day to my upline'), h('span', { class: 'muted' }, 'A ready-to-send text'));
  const t = totalsFor(c.activities, { tf: '1D', key: c.dayKey, tz: c.tz, agentIds: [c.me] });
  const text = dayText(t, { name: c.demo ? c.myName : (state.setup?.name || null), dayKey: c.dayKey });
  return h('section', { class: 'card' },
    h('div', { class: 'row' }, h('b', {}, 'Your day, ready to send'), h('button', { type: 'button', class: 'link', onclick: () => { ui.open = null; renderToday(); } }, 'Close')),
    h('pre', { id: 'day-text', class: 'day-text' }, text),
    h('div', { class: 'inline' },
      h('button', { type: 'button', class: 'go', onclick: () => {
        const fallback = () => { const r = document.createRange(); r.selectNodeContents($('day-text')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Copying is blocked here. The text is selected: copy it.'); };
        try { navigator.clipboard.writeText(text).then(() => toast('Copied. Paste it into your text to your upline.'), fallback); } catch (e) { fallback(); }
      } }, 'Copy text'),
      h('a', { class: 'mini as-btn', href: `sms:?&body=${encodeURIComponent(text)}` }, 'Open Messages')));
}

function addPeople(c) {
  const id = 'paste-names';
  return h('details', { class: 'card add' },
    h('summary', {}, h('b', {}, 'Add people to call'), h('span', { class: 'muted' }, 'Paste a list, one name per line')),
    h('textarea', { id, rows: '4', placeholder: 'Sam Ortiz\nDana Lee\nChris P.' }),
    h('button', { type: 'button', class: 'go', onclick: () => {
      const names = $(id).value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 500);
      if (!names.length) { toast('Type or paste at least one name.', null, true); return; }
      act(c, `Added ${names.length} ${names.length === 1 ? 'person' : 'people'} to your calls.`, () => {
        c.leads.push(...names.map((name) => ({ id: uid(), agent_id: c.me, name, stage: 'new', premium: null })));
      });
    } }, 'Add to my calls'));
}



// ── Today, before you're licensed ───────────────────────────────────
function renderStudyDay(c, L, top) {
  const week = totalsFor(c.activities, { tf: '1W', key: weekKey(c.dayKey), tz: c.tz, agentIds: [c.me] });
  const today = totalsFor(c.activities, { tf: '1D', key: c.dayKey, tz: c.tz, agentIds: [c.me] });
  const scores = c.activities.filter((a) => a.agent_id === c.me && a.type === 'practice_test').slice(-5).map((a) => Number(a.value));
  const scoreOpen = ui.open === 'score', passOpen = ui.open === 'pass', examOpen = ui.open === 'exam';
  const examOn = c.activities.filter((a) => a.agent_id === c.me && a.type === 'exam_booked' && a.meta?.exam_on).at(-1)?.meta.exam_on ?? null;
  const scoreId = 'score-in';
  fill($('screen-today'), top,
    backupNudge(c),
    h('section', { class: 'card call' },
      h('div', { class: 'kicker' }, 'STUDY TODAY'),
      h('div', { class: 'who-big' }, today.studySessions ? 'Nice. Another session?' : 'One study session'),
      h('div', { class: 'muted' }, 'Study one topic, then answer practice questions on it. About 30 minutes.'),
      h('div', { class: 'ask' }, 'When you finish, tap:'),
      h('div', { class: 'replies two' },
        h('button', { type: 'button', class: 'reply r-talked', onclick: () => act(c, 'Study session logged.', () => [{ agent_id: c.me, type: 'study_session', value: 30, occurred_at: c.at() }]) }, h('b', {}, 'I studied 30 min'), h('span', {}, 'Logs one session')),
        h('button', { type: 'button', class: 'reply', onclick: () => { ui.open = scoreOpen ? null : 'score'; renderToday(); } }, h('b', {}, 'I took a practice test'), h('span', {}, 'Log your score'))),
      scoreOpen ? h('div', { class: 'stepper' },
        h('label', { for: scoreId }, 'Your score, out of 100'),
        h('div', { class: 'inline' },
          h('input', { id: scoreId, type: 'number', inputmode: 'numeric', min: '0', max: '100', placeholder: '78' }),
          h('button', { type: 'button', class: 'go', onclick: () => {
            const v = Number($(scoreId).value);
            if (!($(scoreId).value !== '' && v >= 0 && v <= 100)) { toast('Enter a score from 0 to 100.', null, true); return; }
            ui.open = null;
            act(c, `Practice test logged: ${v}.`, () => [{ agent_id: c.me, type: 'practice_test', value: v, occurred_at: c.at() }]);
          } }, 'Save'))) : null),
    h('div', { class: 'stats four' },
      h('div', { class: 'stat' }, h('b', {}, week.studySessions), h('span', {}, 'sessions this week')),
      h('div', { class: 'stat' }, h('b', {}, week.studyMinutes), h('span', {}, 'minutes this week')),
      h('div', { class: 'stat' }, h('b', {}, scores.length ? scores.at(-1) : '—'), h('span', {}, 'last practice score')),
      h('div', { class: 'stat' }, h('b', {}, scores.length > 1 ? scores.join(' · ') : '—'), h('span', {}, 'recent scores'))),
    examOn && examOn >= c.dayKey ? focusCard('YOUR EXAM', dayLong(examOn), 'Keep taking practice tests until then.') : focusCard('YOUR FOCUS · LICENSING', L.nextAction),
    examOpen
      ? h('section', { class: 'card stepper' }, h('label', { for: 'exam-day' }, 'When is your exam?'),
          h('input', { id: 'exam-day', type: 'date', min: c.dayKey }),
          h('div', { class: 'inline' },
            h('button', { type: 'button', class: 'go', onclick: () => {
              const d = $('exam-day').value;
              if (!d) { toast('Pick the exam day.', null, true); return; }
              ui.open = null;
              act(c, `Exam booked for ${dayShort(d)}.`, () => [{ agent_id: c.me, type: 'exam_booked', occurred_at: c.at(), meta: { exam_on: d } }]);
            } }, 'Save'),
            h('button', { type: 'button', class: 'link', onclick: () => { ui.open = null; renderToday(); } }, 'Back')))
      : h('button', { type: 'button', class: 'card quick', onclick: () => { ui.open = 'exam'; renderToday(); } }, h('b', {}, examOn ? 'I moved my exam date' : 'I booked my exam'), h('span', { class: 'muted' }, 'Your leader sees you’re on track')),
    passOpen
      ? h('section', { class: 'card' }, h('b', {}, 'You passed the state licensing exam?'),
          h('div', { class: 'muted' }, 'Your calls and your client list open up.'),
          h('div', { class: 'inline' },
            h('button', { type: 'button', class: 'go', onclick: () => { ui.open = null; act(c, 'Congratulations. You’re licensed: calls are open.', () => { c.profile.licensed = true; return [{ agent_id: c.me, type: 'license_passed', occurred_at: c.at() }]; }); } }, 'Yes, I passed'),
            h('button', { type: 'button', class: 'link', onclick: () => { ui.open = null; renderToday(); } }, 'Not yet')))
      : h('button', { type: 'button', class: 'card quick', onclick: () => { ui.open = 'pass'; renderToday(); } }, h('b', {}, 'I passed my exam'), h('span', { class: 'muted' }, 'Opens your calls and clients')),
    dayBlocks(c, L, null));
}

function weekKey(dayKey) {
  const d = new Date(`${dayKey}T00:00:00Z`);
  return `W:${addDays(dayKey, -((d.getUTCDay() + 6) % 7))}`;
}

// ── Pipeline ────────────────────────────────────────────────────────

function clientCard(c, lead) {
  const step = ui.open && ui.open.endsWith(`:${lead.id}`) ? ui.open.split(':')[0] : null;
  const id = (k) => `${k}-${lead.id}`;
  const run = (msg, fn) => { const was = ui.open; ui.open = null; if (!act(c, msg, fn)) { ui.open = was; } };
  const move = (to, label) => run(`${lead.name}: ${label}.`, () => { const r = moveLead(lead, to, { at: c.at() }); replaceLead(lead, r.lead); return r.rows; });
  const open = (k) => { ui.open = `${k}:${lead.id}`; renderPipeline(); };
  const back = h('button', { type: 'button', class: 'link', onclick: () => { ui.open = null; renderPipeline(); } }, 'Back');
  let actions = [];
  if (step === 'approve') {
    actions = [h('div', { class: 'stepper' },
      h('label', { for: id('draft') }, 'Day their first payment comes out'),
      h('input', { id: id('draft'), type: 'date', min: c.dayKey }),
      h('span', { class: 'muted' }, 'A welcome call tomorrow, and a call 3 days before that payment, go on Today by themselves.'),
      h('button', { type: 'button', class: 'go', onclick: () => run(`${lead.name}: approved. Welcome call queued for tomorrow.`, () => { const r = approvePolicy(lead, { at: c.at(), today: c.dayKey, draftOn: $(id('draft')).value }); replaceLead(lead, r.lead); return r.rows; }) }, 'Save'),
      back)];
  } else if (step === 'missed') {
    actions = [h('div', { class: 'stepper' },
      h('label', { for: id('grace') }, 'Last day to fix it before the policy ends (it’s on the insurer’s letter)'),
      h('input', { id: id('grace'), type: 'date' }),
      h('span', { class: 'muted' }, 'Leave it blank if you don’t know yet. A save call goes to the top of Today.'),
      h('button', { type: 'button', class: 'go', onclick: () => run(`${lead.name}: payment missed. A save call is at the top of Today.`, () => { const r = markPaymentMissed(lead, { at: c.at(), today: c.dayKey, graceEndsOn: $(id('grace')).value || null }); replaceLead(lead, r.lead); return r.rows; }) }, 'Start the save'),
      back)];
  } else {
    if (lead.stage === 'application') actions.push(h('button', { type: 'button', class: 'mini', onclick: () => open('approve') }, 'Insurer approved'));
    if (lead.stage === 'issued') actions.push(h('button', { type: 'button', class: 'mini quiet', onclick: () => open('missed') }, 'Payment missed'));
    if (lead.stage === 'lapse_risk') actions.push(h('button', { type: 'button', class: 'mini', onclick: () => move('issued', 'payment back on') }, 'Paid'));
    if (['application', 'issued', 'lapse_risk'].includes(lead.stage)) actions.push(h('button', { type: 'button', class: 'mini quiet', onclick: () => move('lost', lead.stage === 'application' ? 'insurer said no' : 'stopped paying, policy ended') }, lead.stage === 'application' ? 'Insurer said no' : 'Stopped paying'));
  }
  const left = lead.stage === 'lapse_risk' ? graceDaysLeft(lead, c.dayKey) : null;
  const when = lead.stage === 'appointment' && lead.meetingOn ? `Meeting ${dayShort(lead.meetingOn)}${lead.meetingAt ? ` at ${clock(lead.meetingAt, true)}` : ''}`
    : ['new', 'contacted'].includes(lead.stage) ? (lead.nextOn ? `Call ${lead.nextOn <= c.dayKey ? 'today' : dayShort(lead.nextOn)}${lead.callbackAt ? ` at ${clock(lead.callbackAt, true)}` : ''}` : 'In today’s calls')
    : lead.stage === 'issued' && lead.draftOn ? (lead.draftOn >= c.dayKey ? `First payment ${dayShort(lead.draftOn)}` : 'Paying')
    : lead.stage === 'lapse_risk' ? (left === null ? 'Call to save it' : `${left} day${left === 1 ? '' : 's'} left to fix it`)
    : lead.stage === 'lost' && lead.lostReason === 'bad_number' ? 'Bad number' : null;
  return h('div', { class: 'item' },
    h('div', { class: 'who' }, h('b', {}, lead.name), h('div', { class: 'muted' }, [lead.premium ? `${usd(lead.premium)} a year` : null, when].filter(Boolean).join(' · '))),
    actions.length ? h('div', { class: 'acts' }, actions) : null);
}

function renderPipeline() {
  const c = ctx();
  const L = place(c);
  const screen = $('screen-pipeline');
  const top = head('AFTER THE SALE', 'Clients');
  if (!isUnlocked(L.stage, 'Clients')) {
    fill(screen, top, h('div', { class: 'card locked' }, h('b', {}, 'Opens when you pass your exam'),
      h('p', { class: 'muted' }, 'Once you start selling, this shows whose application is with the insurer and who’s paying.')));
    return;
  }
  // Only what Today can't do: the insurer's answer, and whether they keep paying. People to call
  // and meetings are on Today; showing them here too was the same list twice.
  const mineLeads = c.leads.filter((l) => l.agent_id === c.me);
  const GROUPS = [
    { id: 'lapse_risk', title: 'Missed a payment' },
    { id: 'application', title: 'Waiting on the insurer' },
    { id: 'issued', title: 'Paying' },
  ];
  const groups = GROUPS.map((g) => ({ ...g, list: mineLeads.filter((l) => l.stage === g.id) })).filter((g) => g.list.length);
  const lost = mineLeads.filter((l) => l.stage === 'lost' && l.premium);
  fill(screen, top,
    groups.length ? groups.map(({ title, list }) => h('div', { class: 'card' },
      h('div', { class: 'stage-h' }, h('span', {}, title), h('span', { class: 'count' }, list.length)),
      list.map((l) => clientCard(c, l))))
      : h('div', { class: 'card locked' }, h('b', {}, 'No one here yet'), h('p', { class: 'muted' }, 'When you send an application, the person shows up here until the insurer answers. Then you’ll see who’s paying.'), h('a', { class: 'go as-link', href: '#today' }, 'Go to Today')),
    lost.length ? h('details', { class: 'more' }, h('summary', {}, `Ended (${lost.length})`), h('div', { class: 'card' }, lost.map((l) => clientCard(c, l)))) : null);
}

// ── Recruits: one queue, like calls ─────────────────────────────────
// The recruit who needs the next step most comes first; everyone else waits behind it.
function recruitsSection(c, L) {
  if (!(L && isUnlocked(L.stage, 'Recruits')) && !(c.demo && c.demoAs === 'leader') && sync.account.role !== 'leader') return null;
  const onSite = sync.account.role === 'leader';
  // Signed in as a leader: once someone starts licensing they join My people and log for themselves.
  const open = c.recruits.filter((r) => r.stage !== 'dropped' && r.stage !== 'producing' && (!onSite || ['prospect', 'interviewed'].includes(r.stage)));
  const queue = open.map((r) => ({ r, ...daysInStage(r, c.dayKey) })).sort((a, b) => (b.stuck - a.stuck) || ((b.days ?? 0) - (a.days ?? 0)));
  const first = queue[0]?.r;
  const rest = queue.slice(1).map((x) => x.r);
  const dropped = c.recruits.filter((r) => r.stage === 'dropped');
  const stepOf = (r) => RECRUIT_STAGES.find((x) => x.id === r.stage);
  const card = (rec) => {
    const next = nextRecruitStage(rec.stage);
    const label = next && RECRUIT_STAGES.find((x) => x.id === next).label;
    const { days, stuck } = daysInStage(rec, c.dayKey);
    const dropping = ui.open === `drop-${rec.id}`;
    return h('section', { class: 'card' },
      h('div', { class: 'kicker' }, 'NEXT RECRUIT'),
      h('div', { class: 'who-big' }, rec.name),
      h('div', { class: stuck ? 'err' : 'muted' }, `${stepOf(rec)?.label ?? ''}${days !== null ? ` for ${days} day${days === 1 ? '' : 's'}` : ''}. Next: ${stepOf(rec)?.next ?? 'keep going'}.`),
      h('div', { class: 'inline' },
        onSite && next === 'licensing'
          ? h('button', { type: 'button', class: 'mini', onclick: () => { ui.inviteFor = { id: rec.id, name: rec.name }; renderTeam(); } }, 'Invite to your team')
          : next ? h('button', { type: 'button', class: 'mini', onclick: () => act(c, `${rec.name}: ${label.toLowerCase()}.`, () => { const m = moveRecruit(rec, next, { builderId: c.me, at: c.at() }); Object.assign(rec, m.recruit); return m.rows; }) }, `Done: ${label.toLowerCase()}`) : null,
        h('button', { type: 'button', class: dropping ? 'mini danger' : 'mini quiet', onclick: () => {
          if (!dropping) { ui.open = `drop-${rec.id}`; renderTeam(); return; }
          ui.open = null;
          act(c, `${rec.name} is off your list. Their history is kept.`, () => { const m = dropRecruit(rec, { builderId: c.me, at: c.at() }); Object.assign(rec, m.recruit); return m.rows; });
        } }, dropping ? 'Tap again to confirm' : 'Not moving forward')));
  };
  return [
    h('h3', { class: 'section-h' }, 'Recruits'),
    first ? card(first) : h('p', { class: 'muted' }, 'No recruits right now.'),
    h('details', { class: 'card' }, h('summary', {}, h('b', {}, 'Add a recruit'), rest.length ? h('span', { class: 'muted' }, ` · ${rest.length} more waiting`) : null),
      addForm('add-recruit', 'Their name', 'Add', (name) => act(c, `${name} added to your recruits.`, () => { const r = addRecruit({ id: uid(), name }, { builderId: c.me, at: c.at() }); c.recruits.unshift(r.recruit); return r.rows; })),
      rest.map((rec) => h('div', { class: 'item' }, h('div', { class: 'who' }, h('b', {}, rec.name), h('span', { class: 'muted' }, stepOf(rec)?.label ?? '')))),
      c.names.length ? h('div', { class: 'muted' }, `Names you saved before: ${c.names.map((n) => n.name).join(', ')}`) : null,
      dropped.length ? h('div', { class: 'muted' }, `Not moving forward: ${dropped.map((r) => r.name).join(', ')}`) : null),
  ];
}

function addForm(id, placeholder, buttonLabel, onAdd) {
  const input = h('input', { id, class: 'text-in', type: 'text', placeholder, 'aria-label': placeholder, autocomplete: 'off' });
  const go = () => { const v = input.value.trim(); if (v) onAdd(v); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  return h('div', { class: 'inline' }, input, h('button', { type: 'button', class: 'mini', onclick: go }, buttonLabel));
}

// ── Progress ────────────────────────────────────────────────────────
function stillPaying(c) {
  const q = quality({ activities: c.qualityActs, agentIds: [c.me], dayKey: c.dayKey });
  const m = CHECKPOINTS.find((k) => q.activeAt[k].eligible);
  return h('p', { class: 'muted' }, m
    ? `Of your customers from ${m}+ months ago, ${q.activeAt[m].active} of ${q.activeAt[m].eligible} are still paying.`
    : 'Once a customer has had their policy 3 months, you’ll see how many are still paying.');
}

function selfRating(c) {
  const month = c.dayKey.slice(0, 7);
  const said = c.activities.filter((a) => a.agent_id === c.me && a.type === 'self_rating' && bucketKey(a.occurred_at, '1M', c.tz) === month).at(-1);
  return h('div', { class: 'card' },
    h('b', {}, 'This month: do you feel more like a producer or a builder?'),
    said ? h('p', { class: 'muted' }, `You said ${said.value} out of 10. Ask again next month.`)
      : [h('div', { class: 'scale' }, Array.from({ length: 10 }, (_, i) => h('button', { type: 'button', class: 'mini', 'aria-label': `${i + 1} out of 10`, onclick: () => act(c, `Saved: ${i + 1} out of 10.`, () => [{ agent_id: c.me, type: 'self_rating', value: i + 1, occurred_at: c.at() }]) }, String(i + 1)))),
         h('div', { class: 'row muted' }, h('span', {}, '1 = producer'), h('span', {}, '10 = builder'))]);
}

function renderLadder() {
  const c = ctx();
  if (c.profile.licensed === null) { fill($('screen-ladder'), head('WHERE YOU’RE GOING', 'Progress'), h('div', { class: 'card locked' }, h('b', {}, 'Answer one question on Today first'), h('a', { class: 'go as-link', href: '#today' }, 'Go to Today'))); return; }
  const L = place(c);
  const t = teamView(c);
  const screen = $('screen-ladder');
  // A leader: is she building? An agent: the one thing to the next stage.
  if (t && (c.demo || sync.account.role === 'leader')) {
    const b = t.builder;
    const mine = ownPremium(c.activities, { me: c.me, dayKey: c.dayKey });
    const p = payNow(c);
    // One question (what did I make?), one number, one step. The rest is folded under Details.
    fill(screen, head('YOUR MONEY', 'Progress'),
      h('div', { class: 'card focus' },
        p?.ready ? [h('div', { class: 'big' }, `You made ${usd(p.own.net + p.team.net)} in the last 30 days`), h('div', { class: 'muted' }, moneyParts(p))]
          : [h('div', { class: 'big' }, 'What you make shows here'), payLine(p)]),
      h('div', { class: 'card' }, h('div', { class: 'kicker' }, 'YOUR ONE STEP THIS MONTH'),
        h('b', {}, t.trainer?.action ?? L.nextAction)),
      h('details', { class: 'more' }, h('summary', {}, 'Details'),
        b ? h('div', { class: 'card' }, h('table', { class: 'reqs' }, h('tbody', {},
          h('tr', {}, h('td', {}, 'Agents with a sale most weeks'), h('td', { class: 'n2' }, String(b.steady.now))),
          h('tr', {}, h('td', {}, 'Agents you trained to that'), h('td', { class: 'n2' }, String(b.developed.now))),
          h('tr', {}, h('td', {}, 'Applications sent this month: your team'), h('td', { class: 'n2' }, usd(b.teamPremium.now))),
          h('tr', {}, h('td', {}, 'Applications sent this month: you'), h('td', { class: 'n2' }, usd(mine.now))))),
          h('p', { class: 'muted' }, 'An application pays only once the insurer approves it and the customer keeps paying.'),
          stillPaying(c)) : null,
        selfRating(c)));
    return;
  }
  // An agent: where you are, and how far to the next step. Said once.
  const next = L.gate?.requirements?.find((r) => !r.met);
  fill(screen, head('WHERE YOU’RE GOING', 'Progress'),
    focusCard(`NEXT: ${L.focus.replace(/\.$/, '').toUpperCase()}`,
      next ? `${next.label[0].toUpperCase()}${next.label.slice(1)}: ${next.have}${next.need === '—' ? '' : ` of ${next.need}`}` : L.nextAction),
    // "Still paying" means nothing before a first policy, so it waits until there is one.
    c.activities.some((a) => a.agent_id === c.me && a.type === 'policy_issued') ? h('div', { class: 'card' }, stillPaying(c)) : null);
}

// The money in plain words: what you made, split into yours and your team's, and what a cancel took back.
function moneyParts(p) {
  const team = p.team.clawback
    ? `${usd(p.team.net)} from your team (${usd(p.team.paid)}, minus ${usd(p.team.clawback)} back when a customer stopped paying)`
    : `${usd(p.team.net)} from your team`;
  const own = p.own.clawback
    ? `${usd(p.own.net)} from your own sales (${usd(p.own.paid)}, minus ${usd(p.own.clawback)} back when a customer stopped paying)`
    : `${usd(p.own.net)} from your own sales`;
  return `${own}. ${team}.`;
}

// ── Team ────────────────────────────────────────────────────────────
// One ranking (src/attention.js) feeds Today's "Needs you first" and this screen.
// Demo: worked out here from the made-up team. Signed-in leader: worked out on the
// team's site from each agent's own log; only activity comes back, never clients.
let demoTeam = null;
const teamState = { loading: false, error: '', at: 0 };
function buildDemoTeam(c) {
  const d = demoData();
  const sales = new Set(['policy_issued', 'chargeback']);
  const rows = [...d.activities, ...d.quality.filter((r) => sales.has(r.type))];
  const members = DEMO_TEAM.map((a) => ({ ...a, licensed: true, activities: rows.filter((r) => r.agent_id === a.id) }));
  const mine = d.quality.filter((r) => r.agent_id === c.me);
  return { ...leaderView({ members, me: c.me, mine, levels: DEMO_LEVELS, dayKey: c.dayKey, now: c.now, tz: c.tz }), invites: [] };
}

function teamView(c) {
  let raw = null;
  if (c.demo) raw = c.demoAs === 'producer' ? null : (demoTeam ??= buildDemoTeam(c));
  else if (sync.account.role === 'leader') {
    if (!teamState.error && Date.now() - teamState.at > 60_000) refreshTeam();
    raw = sync.teamNow();
  }
  // Her check-ins live in her own log, so a tap rests someone right away, on this phone.
  return raw && applyCheckins(raw, c.activities, { dayKey: c.dayKey, tz: c.tz });
}
function refreshTeam(force = false) {
  if (teamState.loading) return;
  teamState.loading = true;
  sync.loadTeam(localTz, { force }).then(
    () => { teamState.loading = false; teamState.error = ''; teamState.at = Date.now(); renderAll(); },
    (e) => { teamState.loading = false; teamState.error = e.message || 'Couldn’t load your team.'; teamState.at = Date.now(); renderAll(); });
}

const LEVEL = { urgent: ['red', 'CALL TODAY'], watch: ['amber', 'CHECK IN'], ok: ['green', 'FINE'] };
function personCard(c, p, real) {
  const [color, word] = p.restingUntil ? ['grey', 'CHECKED IN'] : LEVEL[p.level];
  const confirming = ui.open === `remove-${p.id}`;
  const ok = p.level === 'ok';
  return h('div', { class: 'card person' },
    h('div', { class: 'row' }, h('b', {}, p.name), h('span', { class: `pill ${color}` }, word)),
    ok ? h('div', { class: 'muted' }, p.steady ? 'Selling every week.' : p.reason) : h('div', {}, h('b', {}, `${p.reason}. `), p.action),
    p.restingUntil ? h('div', { class: 'muted' }, `You checked in ${dayShort(p.checkedInOn)}. Back here ${dayShort(p.restingUntil)} if nothing changes.`)
      : !ok ? h('button', { type: 'button', class: 'mini', onclick: () => talkedTo(c, p) }, 'I talked to them') : null,
    real && confirming ? h('button', { type: 'button', class: 'mini danger', onclick: () => {
      ui.open = null;
      sync.removeFromTeam(p.id).then(() => { toast(`${p.name} is off your team. Their sales stay in your history.`); refreshTeam(true); }, (e) => toast(e.message, null, true));
    } }, `Tap again: take ${p.name} off (their history stays)`)
      : real ? h('button', { type: 'button', class: 'link quiet-link', onclick: () => { ui.open = `remove-${p.id}`; renderTeam(); } }, 'Take off team') : null);
}





function inviteCard(t) {
  const input = h('input', { id: 'invite-email', class: 'text-in', type: 'email', placeholder: 'Their email', 'aria-label': 'Their email', autocomplete: 'off' });
  const go = () => {
    const email = input.value.trim(); if (!email) return;
    sync.invite(email).then((d) => {
      ui.invite = { email, link: d.link };
      const r = ui.inviteFor && mine.recruits.find((x) => x.id === ui.inviteFor.id);
      ui.inviteFor = null;
      if (r) act(ctx(), `${r.name} invited. They’re on Team once they join.`, () => { const m = moveRecruit(r, 'licensing', { builderId: ME, at: new Date().toISOString() }); Object.assign(r, m.recruit); return m.rows; });
      else renderTeam();
    }, (e) => toast(e.message, null, true));
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const out = ui.invite;
  const text = out && `Join my team on Agent Reels. Open this link and make your login with ${out.email}: ${out.link}`;
  return h('div', { class: 'card' },
    h('b', {}, ui.inviteFor ? `Invite ${ui.inviteFor.name}` : 'Add an agent or recruit'),
    h('p', { class: 'muted' }, 'Type their email and get a link. Text it to them. They make a login with that email and land on your team. The link works once.'),
    h('div', { class: 'inline' }, input, h('button', { type: 'button', class: 'mini', onclick: go }, 'Get link')),
    out ? h('div', { class: 'stepper' },
      h('label', {}, `Link for ${out.email}`),
      h('input', { class: 'text-in', readonly: true, value: out.link, onfocus: (e) => e.target.select() }),
      h('div', { class: 'inline' },
        h('button', { type: 'button', class: 'go', onclick: () => {
          try { navigator.clipboard.writeText(text).then(() => toast('Copied. Paste it in a text to them.'), () => toast('Copying is blocked here. Press and hold the link to copy it.', null, true)); } catch (e) { toast('Press and hold the link to copy it.', null, true); }
        } }, 'Copy message'),
        h('a', { class: 'mini', href: `sms:?&body=${encodeURIComponent(text)}` }, 'Open Messages'))) : null,
    t?.invites?.length ? h('div', {},
      h('div', { class: 'muted' }, 'Haven’t joined yet'),
      t.invites.map((i) => h('div', { class: 'item' }, h('div', { class: 'who' }, h('b', {}, i.email), h('span', { class: 'muted' }, `Sent ${dayShort(i.at.slice(0, 10))}`)),
        h('button', { type: 'button', class: 'link', onclick: () => sync.revokeInvite(i.email).then(() => { if (ui.invite?.email === i.email) ui.invite = null; toast('Invite taken back. That link no longer works.'); renderTeam(); }, (e) => toast(e.message, null, true)) }, 'Take back')))) : null);
}

function drawTeam(c, screen, top, t, L, { real = false } = {}) {
  const need = t.counts.urgent + t.counts.watch;
  fill(screen, top,
    h('p', { class: 'lead' }, need === 0 ? 'Everyone is fine today.' : `${need} ${need === 1 ? 'person could' : 'people could'} use you. Everyone else is fine.`),
    t.people.map((p) => personCard(c, p, real)),
    recruitsSection(c, L),
    lessonsSection(c),
    real ? inviteCard(t) : null,
    real && t.archived?.length ? h('details', { class: 'card' }, h('summary', {}, h('b', {}, 'Off the team'), h('span', { class: 'muted' }, ` ${t.archived.length}`)),
      h('p', { class: 'muted' }, 'Their sales stay in your history. Invite them again and their log comes back.'),
      t.archived.map((a) => h('div', { class: 'item' }, h('div', { class: 'who' }, h('b', {}, a.name), h('span', { class: 'muted' }, `Left ${dayShort(a.at.slice(0, 10))}`))))) : null);
}

function renderTeam() {
  const c = ctx();
  const screen = $('screen-team');
  const top = head('WHO COULD USE YOU', 'My people');
  const L = c.profile.licensed === null ? null : place(c);
  if (c.demo && c.demoAs === 'leader') { drawTeam(c, screen, top, teamView(c), L); return; }
  if (sync.account.role === 'leader') {
    const t = teamView(c);
    if (!t) {
      fill(screen, top, teamState.error
        ? h('div', { class: 'card' }, h('b', {}, 'Your team didn’t load'), h('p', { class: 'err' }, teamState.error), h('button', { type: 'button', class: 'go', onclick: () => { teamState.error = ''; refreshTeam(true); renderTeam(); } }, 'Try again'))
        : h('p', { class: 'muted' }, 'Loading your team…'));
      return;
    }
    if (!t.people.length) {
      fill(screen, top, h('div', { class: 'card focus' }, h('div', { class: 'kicker' }, 'START HERE'), h('div', { class: 'big' }, 'Nobody is on your team yet'),
        h('div', { class: 'muted' }, 'Invite your agents below. Once they log on their own phones, this shows who could use you.')), recruitsSection(c, L), lessonsSection(c), inviteCard(t));
      return;
    }
    drawTeam(c, screen, top, t, L, { real: true });
    return;
  }
  // No team on the site yet: her recruits, and how agents join.
  fill(screen, top,
    L ? recruitsSection(c, L) : null,
    h('p', { class: 'muted' }, sync.account.site
      ? 'Sign in under the gear (top right) to invite your agents. Their days show up here.'
      : 'Your agents show up here once you use Agent Reels on your team’s site and invite them. Switch to Demo to see a full team.'));
}

// ── Lessons: the team's guide (the server's lib/lessons.js) ─────────
// The leader teaches once, on video; agents learn it any time: one lesson a day on Today, all of them
// under More. Each lesson has four layers, so every kind of learner gets theirs: the point, what to do,
// her video, and the exact words.
const STEP_LABEL = { basics: 'The basics', open: 'Opening the call', need: 'Finding the need', qualify: 'Health and budget', options: 'Showing options', close: 'Closing' };
const isLeaderView = (c) => (c.demo ? c.demoAs === 'leader' : sync.account.role === 'leader');
const minutes = (s) => (s ? `${Math.max(1, Math.round(s / 60))} min` : '');
let lessonPoll = null;
function lessonData(c) {
  if (c.demo) return { role: c.demoAs === 'leader' ? 'leader' : 'agent', lessons: DEMO_LESSONS.map((l) => ({ ...l, status: 'ready', published: true, tried: DEMO_LESSON_TRIED[l.id] ?? 0, teamSize: 3 })) };
  if (!sync.account.on) return { role: null, lessons: [] };
  const d = sync.lessonsNow();
  if (!d) { sync.loadLessons().then(() => renderAll(), () => {}); return null; }
  if (d.lessons.some((l) => l.status === 'processing') && !lessonPoll) {
    lessonPoll = setTimeout(() => { lessonPoll = null; sync.loadLessons({ force: true }).then(() => { if (!sheet) renderAll(); }, () => {}); }, 5000);
  }
  return d;
}
/** The course as an agent sees it: published lessons, in order. */
const lessonsFor = (c) => (lessonData(c)?.lessons || []).filter((l) => l.published !== false && (l.status ?? 'ready') === 'ready');
const triedOn = (c) => new Map(c.activities.filter((a) => a.agent_id === c.me && a.type === 'lesson_tried' && a.meta?.lesson_id).map((a) => [a.meta.lesson_id, a.occurred_at]));
/** One a day: the next lesson not tried yet, unless one was tried today already. */
function nextLesson(c) {
  const tried = triedOn(c);
  if ([...tried.values()].some((at) => bucketKey(at, '1D', c.tz) === c.dayKey)) return null;
  return lessonsFor(c).find((l) => !tried.has(l.id)) || null;
}
function lessonCard(c, l) {
  return h('section', { class: 'card lesson' },
    h('div', { class: 'kicker' }, `TODAY’S LESSON${l.step ? ` · ${STEP_LABEL[l.step].toUpperCase()}` : ''}`),
    h('div', { class: 'big' }, l.title),
    h('div', { class: 'muted' }, l.point),
    h('div', { class: 'inline' },
      h('button', { type: 'button', class: 'go', onclick: () => openLesson(c, l) }, l.hasVideo ? `Watch it (${minutes(l.seconds)})` : 'Open the lesson'),
      h('button', { type: 'button', class: 'mini', onclick: () => triedIt(c, l) }, 'I tried it')));
}
function triedIt(c, l) {
  closeSheet();
  act(c, `Nice: “${l.title}” is done. Your next lesson comes tomorrow.`, () => [{ agent_id: c.me, type: 'lesson_tried', occurred_at: c.at(), meta: { lesson_id: l.id } }]);
}

// A lesson opens over the screen, and closes back to where you were.
let sheet = null;
function closeSheet() { sheet?.remove(); sheet = null; document.body.classList.remove('sheet-open'); }
function openSheet(label, ...kids) {
  closeSheet();
  sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label, onclick: (e) => { if (e.target === sheet) closeSheet(); } },
    h('div', { class: 'sheet-in' }, h('div', { class: 'row' }, h('span'), h('button', { type: 'button', class: 'link', onclick: closeSheet }, 'Close')), ...kids));
  document.body.append(sheet);
  document.body.classList.add('sheet-open');
  sheet.querySelector('.sheet-in').focus?.();
}
addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet) closeSheet(); });

function lessonVideo(c, l) {
  if (l.hasVideo && !c.demo) return h('video', { class: 'lesson-video', src: `/api/reels/lessons/${l.id}/video`, poster: `/api/reels/lessons/${l.id}/thumb`, controls: true, playsinline: true, preload: 'metadata' });
  return c.demo ? h('p', { class: 'muted' }, 'On your team’s site, the leader’s video plays here.') : null;
}
function lessonLayers(c, l) {
  return [
    h('div', { class: 'kicker' }, l.step ? STEP_LABEL[l.step].toUpperCase() : 'LESSON'),
    h('h2', {}, l.title),
    lessonVideo(c, l),
    h('div', { class: 'layer' }, h('div', { class: 'kicker' }, 'THE POINT'), h('p', {}, l.point)),
    h('div', { class: 'layer' }, h('div', { class: 'kicker' }, 'DO THIS'), h('ol', { class: 'do-this' }, l.doThis.map((x) => h('li', {}, x)))),
    l.transcript ? h('details', { class: 'layer' }, h('summary', {}, h('b', {}, 'Read every word'), h('span', { class: 'muted' }, ' the transcript')), h('p', { class: 'transcript' }, l.transcript)) : null,
  ];
}
function openLesson(c, l) {
  const at = triedOn(c).get(l.id);
  openSheet(l.title, lessonLayers(c, l),
    isLeaderView(c) ? null : at ? h('p', { class: 'muted' }, `You tried this ${dayShort(bucketKey(at, '1D', c.tz))}.`)
      : h('button', { type: 'button', class: 'go', onclick: () => triedIt(c, l) }, 'I tried it'));
}
function openLessonList(c) {
  const tried = triedOn(c);
  openSheet('All lessons', h('h2', {}, 'All lessons'),
    lessonsFor(c).map((l) => h('button', { type: 'button', class: 'card quick', onclick: () => openLesson(c, l) },
      h('b', {}, `${tried.has(l.id) ? '✓ ' : ''}${l.title}`), h('span', { class: 'muted' }, [l.step ? STEP_LABEL[l.step] : null, minutes(l.seconds)].filter(Boolean).join(' · ')))));
}

// The leader's side, on My people: add a lesson from a video, edit it, publish it, see who tried it.
function lessonsSection(c) {
  if (!isLeaderView(c)) return null;
  const d = lessonData(c);
  if (!d) return h('p', { class: 'muted' }, 'Loading your lessons…');
  return h('section', { class: 'card' },
    h('div', { class: 'kicker' }, 'LESSONS FOR YOUR TEAM'),
    h('b', {}, 'Teach it once on video. Your team learns it any time.'),
    h('p', { class: 'muted' }, c.demo ? 'On your own team, you add a lesson here from a video on your phone.'
      : 'Record 2 to 5 minutes on your phone. The words are written out for you, with a first version of the lesson. You check it, then publish.'),
    c.demo ? null : uploadControl(),
    d.lessons.length ? d.lessons.map((l, i) => lessonRow(c, l, i, d.lessons.length)) : h('p', { class: 'muted' }, 'No lessons yet.'));
}
function uploadControl() {
  if (ui.uploading !== undefined) return h('p', { id: 'upload-prog', class: 'muted' }, `Uploading… ${Math.round(ui.uploading * 100)}%. Keep this page open.`);
  const input = h('input', { type: 'file', accept: 'video/*', class: 'file-in', onchange: async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    ui.uploading = 0; renderAll();
    try {
      await sync.uploadLesson(f, { onProgress: (p) => { ui.uploading = p; const el = $('upload-prog'); if (el) el.textContent = `Uploading… ${Math.round(p * 100)}%. Keep this page open.`; } });
      toast('Uploaded. The words and a first version show up here in a few minutes.');
    } catch (err) { toast(err.message, null, true); }
    delete ui.uploading; renderAll();
  } });
  return h('label', { class: 'go as-btn upload-btn' }, input, 'Add a lesson from a video');
}
function lessonRow(c, l, i, n) {
  const sub = l.status === 'processing' ? 'Being prepared: the video, the words, and a first version. A few minutes.'
    : l.status === 'failed' ? l.error
      : [l.step ? STEP_LABEL[l.step] : null, l.published ? `${l.tried} of ${l.teamSize} tried it` : 'Not published: only you can see it'].filter(Boolean).join(' · ');
  return h('div', { class: 'item' },
    h('div', { class: 'who' }, h('b', {}, l.title || 'New lesson'), h('div', { class: l.status === 'failed' ? 'err' : 'muted' }, sub)),
    l.status === 'processing' ? null : h('div', { class: 'acts' },
      h('button', { type: 'button', class: 'mini', onclick: () => (c.demo ? openLesson(c, l) : editLesson(l.id)) }, c.demo ? 'Open' : l.status === 'failed' ? 'Remove' : 'Edit')));
}
function editLesson(id) {
  const all = sync.lessonsNow()?.lessons || [];
  const i = all.findIndex((x) => x.id === id), l = all[i], n = all.length;
  if (!l) return;
  const run = async (fn, msg) => { try { await fn(); toast(msg); closeSheet(); renderAll(); } catch (e) { toast(e.message, null, true); } };
  const del = h('button', { type: 'button', class: 'link quiet-link', onclick: (e) => {
    if (!e.target.dataset.sure) { e.target.dataset.sure = '1'; e.target.textContent = 'Tap again to delete it and its video'; return; }
    run(() => sync.deleteLesson(id), 'Lesson deleted.');
  } }, 'Delete');
  if (l.status === 'failed') { openSheet('Lesson', h('h2', {}, 'This video didn’t work'), h('p', { class: 'err' }, l.error), del); return; }
  const field = (label, el) => h('label', { class: 'field' }, h('span', {}, label), el);
  const doThis = [0, 1, 2].map((k) => h('input', { id: `le-do${k}`, class: 'text-in', type: 'text', maxlength: '140', value: l.doThis[k] || '' }));
  const fields = () => ({
    title: $('le-title').value, point: $('le-point').value, doThis: doThis.map((x) => x.value),
    step: $('le-step').value || null, transcript: $('le-tr').value,
  });
  openSheet(l.title || 'Lesson',
    h('div', { class: 'kicker' }, l.published ? `PUBLISHED · ${l.tried} OF ${l.teamSize} TRIED IT` : 'NOT PUBLISHED · ONLY YOU CAN SEE IT'),
    lessonVideo({ demo: false }, l),
    l.note ? h('p', { class: 'muted' }, l.note) : null,
    field('Title', h('input', { id: 'le-title', class: 'text-in', type: 'text', maxlength: '80', value: l.title })),
    field('The point: the problem and the fix, in 1 or 2 sentences', h('textarea', { id: 'le-point', rows: '3', maxlength: '240' }, l.point)),
    field('Do this: up to 3 things to try on their next calls', doThis),
    field('Part of the call', h('select', { id: 'le-step' }, h('option', { value: '' }, 'Pick one'),
      Object.entries(STEP_LABEL).map(([v, t]) => h('option', { value: v, selected: l.step === v }, t)))),
    h('details', {}, h('summary', {}, h('b', {}, 'The exact words'), h('span', { class: 'muted' }, ' fix any word the transcript got wrong')),
      h('textarea', { id: 'le-tr', rows: '10' }, l.transcript)),
    h('div', { class: 'inline' },
      h('button', { type: 'button', class: 'go', onclick: () => run(() => sync.saveLesson(id, { ...fields(), published: true }), l.published ? 'Saved. Your team sees the change.' : 'Published. It’s in your team’s lessons now.') }, l.published ? 'Save' : 'Save and publish'),
      l.published ? h('button', { type: 'button', class: 'mini', onclick: () => run(() => sync.saveLesson(id, { published: false }), 'Unpublished. Only you can see it now.') }, 'Unpublish')
        : h('button', { type: 'button', class: 'mini', onclick: () => run(() => sync.saveLesson(id, fields()), 'Saved. Only you can see it.') }, 'Save for now')),
    h('div', { class: 'inline' },
      i > 0 ? h('button', { type: 'button', class: 'mini', onclick: () => run(() => sync.moveLesson(id, i - 1), 'Moved earlier in the course.') }, 'Earlier in the course') : null,
      i < n - 1 ? h('button', { type: 'button', class: 'mini', onclick: () => run(() => sync.moveLesson(id, i + 1), 'Moved later in the course.') }, 'Later in the course') : null,
      del));
}

// ── Settings: your data (under the gear, with Setup) ────────────────
function renderDataCard() {
  let card = $('data-card');
  if (!card) { card = h('section', { id: 'data-card', class: 'card' }); $('screen-setup').prepend(card); }
  const a = sync.account;
  $('leader-setup').hidden = (a.on && a.role === 'agent') || (state.mode === 'demo' && state.demoAs === 'producer');   // agents don't set up a leader's system
  if (state.mode === 'demo') { card.hidden = true; return; }
  card.hidden = false;
  const licenseRow = h('div', { class: 'row' }, h('span', { class: 'muted' }, `License: ${mine.profile.licensed === false ? 'not yet' : mine.profile.licensed ? 'yes' : 'not answered'}`),
    h('button', { type: 'button', class: 'link', onclick: () => act(ctx(), 'License answer cleared. Answer it again on Today.', () => { mine.profile.licensed = null; }) }, 'Change'));
  const planCalls = state.system?.targetsReady ? state.system.plan?.daily?.dials : null;
  const dayRow = mine.profile.dayCalls || mine.profile.stopAt || planCalls ? h('div', { class: 'row' },
    h('span', { class: 'muted' }, `Full day: ${planCalls ?? mine.profile.dayCalls ?? '—'} calls${planCalls ? ' (from your targets)' : ''}${mine.profile.stopAt ? ` · ends ${clock(mine.profile.stopAt, true)}` : ''}`),
    h('button', { type: 'button', class: 'link', onclick: () => act(ctx(), 'Cleared. Set your full day again on Today.', () => { delete mine.profile.dayCalls; delete mine.profile.stopAt; delete mine.profile.goalSeen; }) }, 'Change')) : null;
  if (a.on) {
    const n = sync.pending();
    const saving = { saved: n ? 'Saving…' : 'Everything is saved to your account.', saving: 'Saving…', offline: `No signal: ${n} change${n === 1 ? '' : 's'} waiting on this phone.`, error: a.error }[a.status] || '';
    fill(card,
      h('div', { class: 'kicker' }, 'YOUR ACCOUNT'),
      h('b', {}, a.me?.name || a.me?.email || 'Signed in'),
      h('p', { class: 'muted' }, a.role === 'leader' ? `You lead ${a.team?.name}. Invite your people on Team.` : `On ${a.team?.leaderName}’s team. ${a.team?.leaderName} sees your calls, meetings and sales, never your clients’ names.`),
      h('p', { class: a.status === 'error' ? 'err' : 'muted' }, `${mine.activities.length} log entries · ${mine.leads.length} people. ${saving}`),
      licenseRow, dayRow,
      h('button', { type: 'button', class: 'mini quiet', onclick: () => sync.logout() }, 'Log out'));
    return;
  }
  const signIn = a.site ? h('div', { class: 'stepper' },
    h('div', { class: 'kicker' }, 'SIGN IN'),
    h('p', { class: 'muted' }, 'Sign in to save your log to your team instead of only this phone. New agent? Open the invite link your leader sent you.'),
    h('input', { id: 'si-email', class: 'text-in', type: 'email', placeholder: 'Email', 'aria-label': 'Email', autocomplete: 'username' }),
    h('input', { id: 'si-pass', class: 'text-in', type: 'password', placeholder: 'Password', 'aria-label': 'Password', autocomplete: 'current-password',
      onkeydown: (e) => { if (e.key === 'Enter') $('si-go').click(); } }),
    h('button', { id: 'si-go', type: 'button', class: 'go', onclick: () => {
      const email = $('si-email').value.trim(), pass = $('si-pass').value;
      if (!email || !pass) { toast('Enter your email and password.', null, true); return; }
      sync.login(email, pass).catch((e) => toast(e.message, null, true));
    } }, 'Sign in'),
    h('hr')) : null;
  const age = backupAge(mine);
  const confirmOpen = ui.open === 'restore';
  fill(card,
    signIn,
    h('div', { class: 'kicker' }, 'YOUR LOG'),
    h('b', {}, `${mine.activities.length} entries · ${mine.leads.length} people`),
    h('p', { class: 'muted' }, storageOk
      ? `Saved on this device. ${mine.lastBackupAt ? `Last backup ${age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`}.` : 'Never backed up.'} Copy a backup every week and keep it in your notes or email.`
      : 'This browser isn’t saving (private mode or blocked storage). Copy a backup before you close it.'),
    h('div', { class: 'inline' },
      h('button', { type: 'button', class: 'go', onclick: copyBackup }, 'Copy backup'),
      h('button', { type: 'button', class: 'mini quiet', onclick: saveBackupFile }, 'Save as file')),
    h('pre', { id: 'backup-out', hidden: true }),
    h('details', { open: confirmOpen || null },
      h('summary', {}, 'Restore from a backup'),
      confirmOpen ? h('p', { class: 'muted' }, `Ready: ${ui.pending?.summary}.`) : h('textarea', { id: 'restore-in', rows: '3', placeholder: 'Paste the backup text here' }),
      confirmOpen
        ? h('div', {}, h('p', { class: 'err' }, 'This replaces everything on this device with the backup.'),
            h('div', { class: 'inline' }, h('button', { type: 'button', class: 'go danger', onclick: doRestore }, 'Replace with backup'), h('button', { type: 'button', class: 'link', onclick: () => { ui.open = null; renderDataCard(); } }, 'Cancel')))
        : h('button', { type: 'button', class: 'mini', onclick: () => {
            const r = readBackup($('restore-in').value);
            if (!r.ok) { toast(r.error, null, true); return; }
            ui.open = 'restore'; ui.pending = r; renderDataCard(); toast(`Found ${r.summary}.`);
          } }, 'Check backup')),
    licenseRow, dayRow);
}

function markBackedUp() { mine.lastBackupAt = new Date().toISOString(); saveMine(); renderDataCard(); }
function copyBackup() {
  const text = writeBackup(mine);
  const shown = () => { const pre = $('backup-out'); pre.textContent = text; pre.hidden = false; const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
  try {
    navigator.clipboard.writeText(text).then(() => { markBackedUp(); toast('Backup copied. Paste it into your notes or an email to yourself.'); }, () => { shown(); markBackedUp(); toast('Copying is blocked here. The backup is selected below: copy it.'); });
  } catch (e) { shown(); markBackedUp(); toast('The backup is selected below: copy it.'); }
}
function saveBackupFile() {
  try {
    const a = h('a', { href: URL.createObjectURL(new Blob([writeBackup(mine)], { type: 'application/json' })), download: `agent-reels-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
    markBackedUp(); toast('Saved. If no file appeared, use Copy backup instead.');
  } catch (e) { toast('Saving a file isn’t allowed here. Use Copy backup.', null, true); }
}
function doRestore() {
  const r = ui.pending; if (!r?.ok) return;
  mine = r.store; saveMine(); ui.open = null; ui.pending = null;
  toast(`Restored ${r.summary}.`); renderAll();
}

// ── Shell: tabs, gear, mode ─────────────────────────────────────────
const TABS = ['today', 'pipeline', 'ladder', 'team', 'setup'];
const RENDER = { today: renderToday, pipeline: renderPipeline, ladder: renderLadder, team: renderTeam, setup: renderDataCard };
function currentTab() { const t = (location.hash || '').slice(1); return TABS.includes(t) ? t : 'today'; }

function renderAll() {
  if (!booted) return;
  const c = ctx();
  const L = c.profile.licensed === null ? null : place(c);
  const a = sync.account;
  // My people: her team, and her recruits from the day she starts a names list (Producer).
  const teamOpen = c.demo ? !!L && isUnlocked(L.stage, 'Team') : (a.on && a.role === 'leader') || (!!L && isUnlocked(L.stage, 'Recruits'));
  $('mode-demo').closest('.mode').hidden = a.on && a.role === 'agent';
  $('to-content').hidden = !(a.on && a.role === 'leader');   // her content and videos, on the main site
  drawAccountNote();
  let tab = currentTab();
  if (tab === 'team' && !teamOpen) tab = 'today';
  for (const t of TABS) $(`screen-${t}`).hidden = t !== tab;
  document.querySelectorAll('[data-tab]').forEach((a) => {
    a.hidden = a.dataset.tab === 'setup' || (a.dataset.tab === 'team' && !teamOpen);
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  $('tabs').style.gridTemplateColumns = `repeat(${teamOpen ? 4 : 3}, 1fr)`;
  $('gear').setAttribute('aria-current', tab === 'setup' ? 'page' : 'false');
  $('mode-mine').setAttribute('aria-pressed', String(state.mode === 'mine'));
  $('mode-demo').setAttribute('aria-pressed', String(state.mode === 'demo'));
  const note = $('demo-note');
  note.hidden = state.mode !== 'demo';
  $('demo-who').hidden = state.mode !== 'demo';
  $('demo-leader').setAttribute('aria-pressed', String(state.demoAs === 'leader'));
  $('demo-producer').setAttribute('aria-pressed', String(state.demoAs === 'producer'));
  note.textContent = state.demoAs === 'producer'
    ? `Demo: ${DEMO.producerName} is a made-up agent on ${DEMO.leaderName}’s team at 3:00 PM on Friday, Oct 30. This is what an agent selling every week sees. Same engine as the real thing. Nothing here is saved.`
    : `Demo: ${DEMO.leaderName} is a made-up leader at 3:00 PM on Friday, Oct 30, with a team of three. Same engine as the real thing. Nothing here is saved.`;
  try { RENDER[tab](); } catch (e) { fill($(`screen-${tab}`), h('p', { class: 'err' }, `This screen hit an error: ${e.message}`)); }
}

const switchMode = (m) => { ui.open = null; ui.skip.clear(); clearTimeout(undo?.timer); undo = null; hideToast(); setMode(m); };
$('mode-mine').addEventListener('click', () => switchMode('mine'));
$('mode-demo').addEventListener('click', () => switchMode('demo'));
const switchDemo = (who) => { ui.open = null; ui.skip.clear(); clearTimeout(undo?.timer); undo = null; hideToast(); setDemoAs(who); };
$('demo-leader').addEventListener('click', () => switchDemo('leader'));
$('demo-producer').addEventListener('click', () => switchDemo('producer'));
onMode(renderAll);
onSystem(() => { if (currentTab() !== 'setup') renderAll(); });
addEventListener('hashchange', () => { ui.open = null; renderAll(); scrollTo(0, 0); });

// Start: signed in on the team's site, the log comes from the account; otherwise it stays on this phone.
const localMine = mine;
(async () => {
  try {
    const doc = await sync.start({
      local: localMine,
      onChange: (kind) => {
        if (kind === 'replaced') { mine = sync.current(); toast('This phone now has your latest log from your account.'); renderAll(); return; }
        if (kind === 'merged') { mine = sync.current(); renderAll(); return; }
        drawAccountNote();
        if (currentTab() === 'setup') renderDataCard();
      },
    });
    // On the team's site but signed out: everyone signs in on the one sign-in page, then comes back
    // here, so nobody works on a log that only lives on this phone. ?demo keeps the demo open to show people.
    if (!doc && sync.account.signedOut && !new URLSearchParams(location.search).has('demo')) {
      try { sessionStorage.setItem('afterLogin', 'team'); } catch { /* they land on their home page instead */ }
      location.replace('/#/login');
      return;
    }
    if (doc) {
      mine = doc;
      if (sync.account.role === 'agent' && state.mode === 'demo') setMode('mine');
      if (sync.account.role === 'leader') refreshTeam();
    }
  } catch (e) { /* off the site: the log stays on this phone */ }
  booted = true;
  renderAll();
})();
