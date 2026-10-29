// Agent Reels screens. Every number comes from the engine in src/ reading one
// activity log. The work happens on Today, as one chain:
//   who to call → what happened (one tap) → what's next (set for you).
// "Mine" keeps your log on this device (src/store.js); "Demo" runs a
// fictional leader through the same engine.
import { state, setMode, onMode, onSystem } from './state.js';
import { buildActivities, TZ, DEMO } from './seed/sample.js';
import { DEMO_TEAM, DEMO_LEADS, DEMO_RECRUITS, DEMO_PLAYBOOK_READY, demoQualityActivities } from './seed/demo-pipeline.js';
import { placeOnLadder, routineFor, isUnlocked, STAGES, FOCUS_TOP } from './src/career.js';
import { todoFor } from './src/routines.js';
import { totalsFor, whereItBroke } from './src/timeframes.js';
import { duplication, RECRUIT_STAGES } from './src/ladder.js';
import { quality, showRate, CHECKPOINTS } from './src/quality.js';
import { LEAD_STAGES, moveLead, nextRecruitStage, moveRecruit, addRecruit, dropRecruit, daysInStage } from './src/pipeline.js';
import { teamSummary, applyCheckins, checkinRow, ownProduction, ownPremium, logsAtNight } from './src/attention.js';
import * as sync from './sync.js';
import { CALL_OUTCOMES, MEETING_OUTCOMES, KITCHEN_CHECK, CARE_CALLS, CARE_OUTCOMES, logCall, logMeeting, logCareCall, approvePolicy, markPaymentMissed, graceDaysLeft, queueFor, addDays, addWorkdays, isWorkday, dayText } from './src/calls.js';
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
    tapMinute: 0,
  };
  return demo;
}

/** Everything a screen needs for the current mode. */
function ctx() {
  if (state.mode === 'demo') {
    const d = demoData();
    return {
      demo: true, me: DEMO.leaderId, myName: DEMO.leaderName, tz: TZ, dayKey: DEMO.activityTo, now: '15:00',
      activities: d.activities, qualityActs: d.quality, profile: d.profile,
      leads: d.leads, recruits: d.recruits, names: d.names, team: DEMO_TEAM, playbookReady: DEMO_PLAYBOOK_READY,
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
const planNow = () => (sys()?.targetsReady ? sys().plan : null);
const place = (c) => placeOnLadder({ person: { id: c.me, name: c.myName, licensed: c.profile.licensed ?? true }, team: c.team, activities: c.activities, dayKey: c.dayKey, tz: c.tz, playbookReady: c.playbookReady, teamStages: c.teamStages ?? null });

// ── Every change goes through here, so it can be undone for 10 seconds ──
let undo = null;
function act(c, message, change) {
  const snap = {
    mode: state.mode, acts: c.activities.length, quality: c.demo ? demoData().quality.length : null,
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
    const s = undo?.snap; if (!s || s.mode !== state.mode) return;
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

function meter(c, plan, goal = null) {
  const t = totalsFor(c.activities, { tf: '1D', key: c.dayKey, tz: c.tz, agentIds: [c.me] });
  const cell = (n, goal, label) => h('div', { class: 'stat' }, h('b', {}, goal ? `${n}/${goal}` : n), h('span', {}, label));
  return h('div', { class: 'stats four' },
    cell(t.dials, plan?.daily?.dials ?? goal, 'calls'),
    cell(t.conversations, plan?.daily?.conversations, 'talked'),
    cell(t.apptsSet, null, 'meetings booked'),
    cell(t.followups, plan?.daily?.followups, 'follow-ups'));
}

function dayBlocks(c, L, plan, own = null) {
  const r = routineFor(L.stage);
  // Production first: recruiting waits while her own calls are down. Someone who logs at night is
  // judged on yesterday's finished day, not on zero calls this morning.
  let hold = own?.down ? true : null;
  if (hold === null && plan?.daily?.dials && logsAtNight(c.activities.filter((a) => a.agent_id === c.me), { dayKey: c.dayKey, tz: c.tz })) {
    let y = addDays(c.dayKey, -1); while (!isWorkday(y)) y = addDays(y, -1);
    hold = totalsFor(c.activities, { tf: '1D', key: y, tz: c.tz, agentIds: [c.me] }).dials < plan.daily.dials * 0.7;
  }
  const opts = { ...r, plan, activities: c.activities, agentId: c.me, tz: c.tz, times: sys()?.times || {}, content: false, hold };
  const keep = (x) => !['1M', '1Q', '1Y'].includes(x.tf); // monthly and longer views are parked
  const items = todoFor(c.dayKey, { ...opts, now: c.now }).filter(keep);
  const hidden = todoFor(c.dayKey, { ...opts, hold: false }).filter(keep).length > items.length;
  return h('details', { class: 'card day' },
    h('summary', {}, h('b', {}, 'Your day, block by block'), h('span', { class: 'muted' }, `${items.length} blocks`)),
    items.length
      ? h('ul', { class: 'blocks' }, items.map((x) => h('li', { class: x.done ? 'done-row' : '' },
          h('span', { class: 't' }, clock(x.at)), h('span', { class: 'title' }, x.title),
          x.goal != null ? h('span', { class: 'prog' }, `${x.progress ?? 0}/${x.goal}`) : h('span'))))
      : h('p', { class: 'muted' }, 'No blocks today. Weekends are off the routine.'),
    hidden ? h('p', { class: 'muted' }, own?.down ? 'Your recruiting step is hidden while your own calls are down. Production comes first.' : 'Your recruiting step is hidden today: calls are under 70% of the goal. Production comes first.') : null);
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
      h('span', { class: 'muted' }, 'Move them into your account, so they’re saved and count toward your ladder? You can only do this once.'),
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
        h('button', { type: 'button', class: 'reply', onclick: () => act(c, 'Starting at Licensing. Study comes first.', () => { c.profile.licensed = false; }) }, h('b', {}, 'Not yet'), h('span', {}, 'Start with the exam')),
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
  const byCalls = !!goal && t.dials >= goal;
  const byTime = !!c.profile.stopAt && c.now >= c.profile.stopAt && isWorkday(c.dayKey);
  const done = (byCalls || byTime) && !ui.keepGoing && !c.late;
  const own = ownProduction(c.activities, { me: c.me, dayKey: c.dayKey, tz: c.tz });
  const weekendQuiet = q.weekend && !next && !q.saves.length && !q.meetings.length;

  fill(screen, top,
    lateCard(c),
    backupNudge(c),
    q.saves.map((l) => careCard(c, l, 'save')),
    q.meetings.map((m) => meetingCard(c, m)),
    done ? doneCard(c, { t, goal, byCalls, next, urgent }) : [
      q.care.map(({ lead, kind }) => careCard(c, lead, kind)),
      weekendQuiet ? weekendCard(q) : next ? callCard(c, next, calls.length) : allSkipped
        ? h('section', { class: 'card call empty' }, h('div', { class: 'kicker' }, 'CALL NEXT'), h('div', { class: 'who-big quiet' }, `You skipped all ${q.calls.length}`), h('button', { type: 'button', class: 'go', onclick: () => { ui.skip.clear(); renderToday(); } }, 'Start the list again'))
        : emptyQueue(c, goal, t.dials),
    ],
    quickCall(c),
    meter(c, plan, goal),
    goal || c.demo ? null : fullDayCard(c),
    sendMyDay(c),
    done ? null : [
      own.down ? focusCard('YOUR OWN CALLS ARE DOWN', `${own.recentPerDay} calls a day the last 2 weeks, ${own.priorPerDay} before.`, 'Production first: your calls come before team work until they’re back. Recruiting steps wait.') : null,
      urgent ? needsYouCard(c, urgent) : own.down ? null : focusCard(`YOUR FOCUS · ${L.name.toUpperCase()}`, L.nextAction),
      own.down ? null : recruitingTap(c, L),
      addPeople(c),
      dayBlocks(c, L, plan, own)],
  );
}

// After midnight: one tap says whether these taps belong to yesterday.
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

function doneCard(c, { t, goal, byCalls, next, urgent }) {
  return h('section', { class: 'card focus done' },
    h('div', { class: 'kicker' }, 'DONE FOR TODAY'),
    h('div', { class: 'big' }, byCalls ? `${t.dials} calls. That’s a full day.` : `It’s past ${clock(c.profile.stopAt, true)}. Your workday is over.`),
    h('div', { class: 'muted' }, byCalls ? 'Go be with your people. Everything else waits for tomorrow.' : `${t.dials}${goal ? ` of ${goal}` : ''} calls today. Whatever’s left moves to tomorrow.`),
    next ? h('div', {}, h('b', {}, 'Tomorrow starts with: '), next.name) : null,
    urgent ? h('div', {}, h('b', {}, 'First thing tomorrow: '), urgent.action) : null,
    h('button', { type: 'button', class: 'link', onclick: () => { ui.keepGoing = true; renderToday(); } }, 'Keep working anyway'));
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

function needsYouCard(c, p) {
  return h('section', { class: 'card focus' },
    h('div', { class: 'kicker' }, 'NEEDS YOU FIRST'),
    h('div', { class: 'big' }, p.action),
    h('div', { class: 'muted' }, `${p.name}: ${p.reason}`),
    h('div', { class: 'inline' },
      h('button', { type: 'button', class: 'mini', onclick: () => talkedTo(c, p) }, 'I talked to them'),
      h('a', { class: 'link', href: '#team' }, 'Open Team')));
}
function talkedTo(c, p) {
  act(c, `Checked in with ${p.name}. They rest for 3 workdays; if nothing changes, they come back.`, () => [checkinRow({ me: c.me, personId: p.id, at: c.at() })]);
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
    h('label', { for: id('prem') }, 'Yearly premium on the application'),
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
      applied: () => `${lead.name}: application sent. Mark the insurer’s answer in Pipeline.`,
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
  const done = (outcome, extra = {}) => {
    const msg = { applied: `${lead.name}: application sent. Mark the insurer’s answer in Pipeline.`, no_sale: `${lead.name}: met, no sale yet. Follow up ${dayShort(addDays(c.dayKey, 3))}.`, no_show: `${lead.name}: no-show. They’re back on tomorrow’s calls.` }[outcome];
    const was = ui.open; ui.open = null;
    if (!act(c, msg, () => { const r = logMeeting(lead, outcome, { at: c.at(), today: c.dayKey, ...extra }); replaceLead(lead, r.lead); return r.rows; })) { ui.open = was; }
  };
  return h('section', { class: 'card call meeting', 'aria-label': `Meeting with ${lead.name}` },
    h('div', { class: 'kicker' }, lead.meetingAt ? `MEETING TODAY · ${clock(lead.meetingAt, true)}` : 'MEETING TODAY'),
    h('div', { class: 'who-big' }, lead.name),
    h('div', { class: 'ask' }, open ? 'Application sent' : 'After the meeting, tap what happened:'),
    open ? outcomeStep(c, lead, 'applied', (extra) => done('applied', extra))
      : replies(MEETING_OUTCOMES, (o) => { if (o === 'applied') { ui.open = `applied:${lead.id}`; renderToday(); } else done(o); }));
}

// Calls that protect an approved policy: welcome, before the first draft, and the save.
function careCard(c, lead, kind) {
  const spec = CARE_CALLS[kind];
  const left = kind === 'save' ? graceDaysLeft(lead, c.dayKey) : null;
  const sub = kind === 'save'
    ? (left === null ? 'Grace period end not entered. Check the carrier’s notice.' : left >= 0 ? `${left} day${left === 1 ? '' : 's'} left in the grace period` : 'The grace period has ended. Call the carrier too.')
    : kind === 'pre_draft' && lead.draftOn ? `First payment drafts ${dayShort(lead.draftOn)}` : `Approved ${lead.approvedOn ? dayShort(lead.approvedOn) : ''}`.trim();
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
    h('b', {}, 'Called someone not on your list?'), h('span', { class: 'muted' }, 'Log it in one tap'));
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
    h('b', {}, 'Send my day to my upline'), h('span', { class: 'muted' }, 'A ready-to-send text'));
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

function recruitingTap(c, L) {
  const recruiting = isUnlocked(L.stage, 'Recruiting');
  if (!recruiting && !isUnlocked(L.stage, 'Names list')) return null;
  const type = recruiting ? 'recruit_step' : 'names_conversation';
  const done = totalsFor(c.activities, { tf: '1D', key: c.dayKey, tz: c.tz, agentIds: [c.me] })[recruiting ? 'recruitSteps' : 'namesConversations'];
  return h('button', { type: 'button', class: 'card quick', onclick: () => act(c, recruiting ? 'Recruiting step logged.' : 'Names-list talk logged.', () => [{ agent_id: c.me, type, occurred_at: c.at() }]) },
    h('b', {}, recruiting ? 'Did a recruiting step' : 'Talked with someone on your names list'),
    h('span', { class: 'muted' }, `${done} today · one a day keeps building moving`));
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
      h('div', { class: 'muted' }, 'A video lesson, then practice questions on it. About 30 minutes.'),
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
          h('div', { class: 'muted' }, 'This moves you to Starting: calls and your Pipeline open up.'),
          h('div', { class: 'inline' },
            h('button', { type: 'button', class: 'go', onclick: () => { ui.open = null; act(c, 'Congratulations. You’re licensed: calls are open.', () => { c.profile.licensed = true; return [{ agent_id: c.me, type: 'license_passed', occurred_at: c.at() }]; }); } }, 'Yes, I passed'),
            h('button', { type: 'button', class: 'link', onclick: () => { ui.open = null; renderToday(); } }, 'Not yet')))
      : h('button', { type: 'button', class: 'card quick', onclick: () => { ui.open = 'pass'; renderToday(); } }, h('b', {}, 'I passed my exam'), h('span', { class: 'muted' }, 'Opens calls and your Pipeline')),
    dayBlocks(c, L, null));
}

function weekKey(dayKey) {
  const d = new Date(`${dayKey}T00:00:00Z`);
  return `W:${addDays(dayKey, -((d.getUTCDay() + 6) % 7))}`;
}

// ── Pipeline ────────────────────────────────────────────────────────
let pipeTab = 'clients';

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
      h('label', { for: id('draft') }, 'Date of the first payment draft'),
      h('input', { id: id('draft'), type: 'date', min: c.dayKey }),
      h('span', { class: 'muted' }, 'A welcome call tomorrow and a call 3 days before the draft go on Today by themselves.'),
      h('button', { type: 'button', class: 'go', onclick: () => run(`${lead.name}: approved. Welcome call queued for tomorrow.`, () => { const r = approvePolicy(lead, { at: c.at(), today: c.dayKey, draftOn: $(id('draft')).value }); replaceLead(lead, r.lead); return r.rows; }) }, 'Save'),
      back)];
  } else if (step === 'missed') {
    actions = [h('div', { class: 'stepper' },
      h('label', { for: id('grace') }, 'When does the grace period end? (from the carrier’s notice)'),
      h('input', { id: id('grace'), type: 'date' }),
      h('span', { class: 'muted' }, 'Leave it blank if you don’t know yet. A save call goes to the top of Today.'),
      h('button', { type: 'button', class: 'go', onclick: () => run(`${lead.name}: payment missed. A save call is at the top of Today.`, () => { const r = markPaymentMissed(lead, { at: c.at(), today: c.dayKey, graceEndsOn: $(id('grace')).value || null }); replaceLead(lead, r.lead); return r.rows; }) }, 'Start the save'),
      back)];
  } else {
    if (lead.stage === 'application') actions.push(h('button', { type: 'button', class: 'mini', onclick: () => open('approve') }, 'Insurer approved'));
    if (lead.stage === 'issued') actions.push(h('button', { type: 'button', class: 'mini quiet', onclick: () => open('missed') }, 'Payment missed'));
    if (lead.stage === 'lapse_risk') actions.push(h('button', { type: 'button', class: 'mini', onclick: () => move('issued', 'payment back on') }, 'Paid'));
    if (['application', 'issued', 'lapse_risk'].includes(lead.stage)) actions.push(h('button', { type: 'button', class: 'mini quiet', onclick: () => move('lost', lead.stage === 'application' ? 'declined' : 'policy lapsed') }, lead.stage === 'application' ? 'Declined' : 'Lapsed'));
  }
  const left = lead.stage === 'lapse_risk' ? graceDaysLeft(lead, c.dayKey) : null;
  const when = lead.stage === 'appointment' && lead.meetingOn ? `Meeting ${dayShort(lead.meetingOn)}${lead.meetingAt ? ` at ${clock(lead.meetingAt, true)}` : ''}`
    : ['new', 'contacted'].includes(lead.stage) ? (lead.nextOn ? `Call ${lead.nextOn <= c.dayKey ? 'today' : dayShort(lead.nextOn)}${lead.callbackAt ? ` at ${clock(lead.callbackAt, true)}` : ''}` : 'In today’s calls')
    : lead.stage === 'issued' && lead.draftOn ? `Drafts ${dayShort(lead.draftOn)}`
    : lead.stage === 'lapse_risk' ? (left === null ? 'Save call due' : `${left} day${left === 1 ? '' : 's'} of grace left`)
    : lead.stage === 'lost' && lead.lostReason === 'bad_number' ? 'Bad number' : null;
  return h('div', { class: 'item' },
    h('div', { class: 'who' }, h('b', {}, lead.name), h('div', { class: 'muted' }, [lead.premium ? `${usd(lead.premium)} a year` : null, when].filter(Boolean).join(' · '))),
    actions.length ? h('div', { class: 'acts' }, actions) : null);
}

function renderPipeline() {
  const c = ctx();
  const L = place(c);
  const screen = $('screen-pipeline');
  const top = head('EVERYONE YOU’RE WORKING WITH', 'Pipeline');
  if (!isUnlocked(L.stage, 'Pipeline')) {
    fill(screen, top, h('div', { class: 'card locked' }, h('b', {}, 'Opens when you pass your exam'),
      h('p', { class: 'muted' }, 'This is where the people you call will live: who’s booked, whose application is out, whose policy the insurer approved.')));
    return;
  }
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Pipeline' },
    ['clients', 'recruits'].map((t) => h('button', { type: 'button', 'aria-pressed': String(pipeTab === t), onclick: () => { pipeTab = t; renderPipeline(); } }, t === 'clients' ? 'Clients' : 'Recruits')));

  if (pipeTab === 'clients') {
    const mineLeads = c.leads.filter((l) => l.agent_id === c.me);
    const order = ['lapse_risk', 'appointment', 'application', 'issued', 'contacted', 'new', 'lost'];
    const groups = order.map((id) => ({ id, list: mineLeads.filter((l) => l.stage === id) })).filter((g) => g.list.length);
    fill(screen, top, seg,
      h('p', { class: 'muted' }, 'Calls and meetings are logged on Today. Here you mark what happens after: the insurer’s answer and missed payments.'),
      groups.length ? groups.map(({ id, list }) => h('div', { class: 'card' },
        h('div', { class: 'stage-h' }, h('span', {}, stageLabel(id)), h('span', { class: 'count' }, list.length)),
        list.map((l) => clientCard(c, l))))
        : h('div', { class: 'card locked' }, h('b', {}, 'No one yet'), h('p', { class: 'muted' }, 'Add people to call on Today. They land here as you work them.'), h('a', { class: 'go as-link', href: '#today' }, 'Go to Today')));
    return;
  }

  if (!isUnlocked(L.stage, 'Recruiting pipeline')) {
    const namesOpen = isUnlocked(L.stage, 'Names list');
    fill(screen, top, seg,
      h('div', { class: 'card locked' },
        h('b', {}, namesOpen ? 'Your names list' : 'Recruiting opens at Producer'),
        h('p', { class: 'muted' }, namesOpen
          ? 'The full recruiting pipeline opens at Coach. For now, list people you’d want on your team. Log a talk on Today.'
          : `You’re at ${L.name}. You build only once you have selling worth copying.`),
        namesOpen ? addForm('add-name', 'Name', 'Add', (name) => act(c, `${name} added to your names list.`, () => { c.names.unshift({ id: uid(), name }); })) : null,
        namesOpen ? c.names.map((n) => h('div', { class: 'item' }, h('div', { class: 'who' }, h('b', {}, n.name)))) : null));
    return;
  }
  const groups = RECRUIT_STAGES.map((s) => ({ s, list: c.recruits.filter((r) => r.stage === s.id) })).filter((g) => g.list.length);
  const dropped = c.recruits.filter((r) => r.stage === 'dropped');
  // Signed in as a leader: once someone starts licensing they're on Team (they log themselves),
  // so the list here is only people before they join. No one is tracked in two places.
  const onSite = sync.account.role === 'leader';
  const joined = onSite ? c.recruits.filter((r) => !['prospect', 'interviewed', 'dropped'].includes(r.stage)) : [];
  if (onSite) groups.splice(0, groups.length, ...groups.filter((g) => ['prospect', 'interviewed'].includes(g.s.id)));
  fill(screen, top, seg,
    h('div', { class: 'card' }, h('b', {}, 'Add a recruit'),
      addForm('add-recruit', 'Recruit name', 'Add', (name) => act(c, `${name} added as a recruit.`, () => { const r = addRecruit({ id: uid(), name }, { builderId: c.me, at: c.at() }); c.recruits.unshift(r.recruit); return r.rows; }))),
    groups.length ? groups.map(({ s, list }) => h('div', { class: 'card' },
      h('div', { class: 'stage-h' }, h('span', {}, s.label), h('span', { class: 'count' }, list.length)),
      h('div', { class: 'muted' }, `Next: ${s.next}`),
      list.map((rec) => {
        const next = nextRecruitStage(rec.stage);
        const label = next && RECRUIT_STAGES.find((x) => x.id === next).label;
        const { days, stuck } = daysInStage(rec, c.dayKey);
        const dropping = ui.open === `drop-${rec.id}`;
        return h('div', { class: 'item' },
          h('div', { class: 'who' }, h('b', {}, rec.name),
            days !== null ? h('span', { class: stuck ? 'err' : 'muted' }, `${days} day${days === 1 ? '' : 's'} here${stuck ? ' · stuck: talk to them this week' : ''}`) : null),
          h('div', { class: 'inline' },
            onSite && next === 'licensing'
              ? h('button', { type: 'button', class: 'mini', onclick: () => { ui.inviteFor = { id: rec.id, name: rec.name }; location.hash = 'team'; } }, 'Invite to your team')
              : next ? h('button', { type: 'button', class: 'mini', onclick: () => act(c, `${rec.name}: ${label.toLowerCase()}.`, () => { const m = moveRecruit(rec, next, { builderId: c.me, at: c.at() }); Object.assign(rec, m.recruit); return m.rows; }) }, `→ ${label}`) : null,
            h('button', { type: 'button', class: dropping ? 'mini danger' : 'mini quiet', onclick: () => {
              if (!dropping) { ui.open = `drop-${rec.id}`; renderPipeline(); return; }
              ui.open = null;
              act(c, `${rec.name} moved to “Not moving forward”.`, () => { const m = dropRecruit(rec, { builderId: c.me, at: c.at() }); Object.assign(rec, m.recruit); return m.rows; });
            } }, dropping ? 'Tap again to confirm' : 'Not moving forward')));
      })))
      : h('p', { class: 'muted' }, 'No recruits yet.'),
    joined.length ? h('details', { class: 'card' }, h('summary', {}, h('b', {}, 'Joined your team'), h('span', { class: 'muted' }, ` ${joined.length}`)),
      h('p', { class: 'muted' }, 'They log for themselves now. Follow them on Team.'),
      joined.map((rec) => h('div', { class: 'item' }, h('div', { class: 'who' }, h('b', {}, rec.name))))) : null,
    dropped.length ? h('details', { class: 'card' }, h('summary', {}, h('b', {}, 'Not moving forward'), h('span', { class: 'muted' }, ` ${dropped.length}`)),
      dropped.map((rec) => h('div', { class: 'item' }, h('div', { class: 'who' }, h('b', {}, rec.name), h('span', { class: 'muted' }, `Left at: ${RECRUIT_STAGES.find((x) => x.id === rec.droppedFrom)?.label ?? 'unknown'}`))))) : null);
}

function addForm(id, placeholder, buttonLabel, onAdd) {
  const input = h('input', { id, class: 'text-in', type: 'text', placeholder, 'aria-label': placeholder, autocomplete: 'off' });
  const go = () => { const v = input.value.trim(); if (v) onAdd(v); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  return h('div', { class: 'inline' }, input, h('button', { type: 'button', class: 'mini', onclick: go }, buttonLabel));
}

// ── Ladder ──────────────────────────────────────────────────────────
function showCard(sr) {
  return h('div', { class: 'card' },
    h('div', { class: 'row' }, h('b', {}, 'Show rate'), h('span', { class: 'muted' }, 'Last 30 days')),
    h('div', { class: 'row' }, h('span', { class: 'big-num' }, pct(sr.rate)), h('span', { class: 'muted' }, sr.booked ? `${sr.held} of ${sr.booked} past meetings actually happened` : 'Needs data: no past meetings yet')),
    sr.booked >= 3 && sr.rate < 0.6 ? h('div', { class: 'muted' }, 'Lots of no-shows. Confirm each meeting the day before, and book closer to the call.') : null);
}

function qualityCard(q, title) {
  return h('div', { class: 'card' },
    h('div', { class: 'row' }, h('b', {}, title), h('span', { class: 'muted' }, 'Only business that sticks counts')),
    h('div', { class: 'stats four' },
      q.placeRate === null && q.submitted
        ? h('div', { class: 'stat' }, h('b', {}, '—'), h('span', {}, `approvals not tracked yet (${q.submitted} applications)`))
        : h('div', { class: 'stat' }, h('b', {}, q.placed), h('span', {}, `approved of ${q.submitted} applications`)),
      ...CHECKPOINTS.map((m) => h('div', { class: 'stat' }, h('b', {}, pct(q.activeAt[m].rate)),
        h('span', {}, q.activeAt[m].eligible ? `still paying at ${m} mo (${q.activeAt[m].active} of ${q.activeAt[m].eligible})` : `still paying at ${m} mo · needs data`)))),
    q.needsData.length ? h('ul', { class: 'needs' }, q.needsData.map((n) => h('li', {}, n))) : null);
}

function renderLadder() {
  const c = ctx();
  if (c.profile.licensed === null) { fill($('screen-ladder'), head('PRODUCER TO BUILDER', 'Your ladder'), h('div', { class: 'card locked' }, h('b', {}, 'Answer one question on Today first'), h('a', { class: 'go as-link', href: '#today' }, 'Go to Today'))); return; }
  const L = place(c);
  const shown = STAGES.slice(0, STAGES.findIndex((s) => s.id === FOCUS_TOP) + 1);
  const at = shown.findIndex((s) => s.id === L.stage);
  const q = quality({ activities: c.qualityActs, agentIds: [c.me], dayKey: c.dayKey });
  fill($('screen-ladder'),
    head('PRODUCER TO BUILDER', `You’re at ${L.name}`),
    h('ol', { class: 'ladder', 'aria-label': 'Career stages' }, shown.map((s, i) => h('li', { class: i < at ? 'past' : i === at ? 'now' : '', 'aria-current': i === at ? 'step' : null }, s.name))),
    focusCard('YOUR FOCUS', L.focus, L.why),
    L.gate ? h('div', { class: 'card' },
      h('div', { class: 'row' }, h('b', {}, L.gate.parked ? 'Finish line for now' : `To reach ${L.gate.to}`), L.gate.parked ? h('span', { class: 'pill grey' }, 'NEXT STAGE PARKED') : null),
      h('table', { class: 'reqs' }, h('tbody', {}, L.gate.requirements.map((r) => h('tr', {},
        h('td', {}, r.label), h('td', { class: 'n2' }, r.need === '—' ? r.have : `${r.have} / ${r.need}`), h('td', { class: 'n2' }, h('span', { class: `pill ${r.met ? 'green' : 'grey'}` }, r.met ? 'DONE' : 'NOT YET')))))),
      h('div', {}, h('b', {}, 'Next: '), L.nextAction))
      : null,
    c.demo || sync.account.role === 'leader' ? builderCard(c, teamView(c)) : null,
    L.stage === 'licensing' ? null : showCard(showRate({ activities: c.activities, agentIds: [c.me], dayKey: c.dayKey })),
    L.stage === 'licensing' ? null : qualityCard(q, 'Your business'));
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
  const s = teamSummary({ members, dayKey: c.dayKey, now: c.now, tz: c.tz });
  const dup = duplication({ team: DEMO_TEAM, activities: rows, dayKey: c.dayKey, tz: c.tz });
  const ids = DEMO_TEAM.map((a) => a.id);
  const broke = whereItBroke(rows, { tf: '1M', key: c.dayKey.slice(0, 7), tz: c.tz, agentIds: ids });
  const name = (id) => DEMO_TEAM.find((a) => a.id === id)?.name ?? '';
  return {
    ...s, invites: [],
    duplication: { producingAgents: dup.producingAgents, licensedAgents: DEMO_TEAM.length, daysToFirstSale: dup.daysToFirstSale },
    monthBroke: broke.down && broke.agent ? { name: name(broke.agent.agent_id), current: broke.trail[0].current, previous: broke.trail[0].previous, perDay: broke.agent.perDayInWeakBucket, usualPerDay: broke.agent.usualPerDay } : null,
  };
}
/** The leader's ranked team for this mode, or null (not a leader, or still loading). */
function teamView(c) {
  let raw = null;
  if (c.demo) raw = (demoTeam ??= buildDemoTeam(c));
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

const LEVEL = { urgent: ['red', 'NEEDS YOU'], watch: ['amber', 'WATCH'], ok: ['green', 'ON TRACK'] };
function personCard(c, p, real) {
  const [color, word] = p.restingUntil ? ['grey', 'CHECKED IN'] : LEVEL[p.level];
  const confirming = ui.open === `remove-${p.id}`;
  const sr = p.facts?.showRate;
  return h('div', { class: 'card person' },
    h('div', { class: 'row' }, h('b', {}, p.name), h('span', { class: `pill ${color}` }, word)),
    h('div', { class: 'muted' }, [p.stageName, p.stage === 'licensing' ? null : `${p.applications} applications, ${p.placed} approved, ${p.lapsed} lapsed`, sr === null || sr === undefined ? null : `show rate ${pct(sr)}`].filter(Boolean).join(' · ')),
    h('div', {}, h('b', {}, `${p.reason}. `), p.action),
    p.restingUntil ? h('div', { class: 'muted' }, `You checked in ${dayShort(p.checkedInOn)}. Back on your list ${dayShort(p.restingUntil)} if nothing changes.`)
      : p.level !== 'ok' ? h('button', { type: 'button', class: 'mini', onclick: () => talkedTo(c, p) }, 'I talked to them') : null,
    real ? h('div', { class: 'row' }, h('span', { class: 'muted' }, p.joinedOn ? `On your team since ${dayShort(p.joinedOn)}` : ''),
      h('button', { type: 'button', class: confirming ? 'mini danger' : 'link', onclick: () => {
        if (!confirming) { ui.open = `remove-${p.id}`; renderTeam(); return; }
        ui.open = null;
        sync.removeFromTeam(p.id).then(() => { toast(`${p.name} is off your team. Their sales stay in your history.`); refreshTeam(true); }, (e) => toast(e.message, null, true));
      } }, confirming ? `Tap again: take ${p.name} off (their history stays)` : 'Take off team')) : null);
}

function trainerCard(tr) {
  if (!tr) return null;
  return h('div', { class: 'card' },
    h('div', { class: 'kicker' }, 'GROW A TRAINER'),
    h('b', {}, tr.action),
    h('div', { class: 'muted' }, `${tr.trainerName} sells steadily. Teaching someone else is how a Producer becomes a trainer, and it takes work off you.`));
}

/** Is she building? The same three numbers, now and 30 days ago. */
function builderCard(c, t) {
  const b = t?.builder;
  if (!b) return null;
  const mine = ownPremium(c.activities, { me: c.me, dayKey: c.dayKey });
  const move = (x) => (x.now > x.before ? '↑' : x.now < x.before ? '↓' : '·');
  const row = (label, x, fmt = String) => h('tr', {}, h('td', {}, label), h('td', { class: 'n2' }, fmt(x.now)), h('td', { class: 'n2 muted' }, `${move(x)} ${fmt(x.before)} 30 days ago`));
  return h('div', { class: 'card' },
    h('div', { class: 'row' }, h('b', {}, 'Are you building?'), h('span', { class: 'muted' }, 'From your team’s logs')),
    h('table', { class: 'reqs' }, h('tbody', {},
      row('Agents with a sale in 3 of 6 weeks', b.steady),
      row('Agents you developed to Producer', b.developed),
      row('Team premium, last 30 days', b.teamPremium, usd),
      row('Your own premium, last 30 days', mine, usd))),
    h('div', { class: 'muted' }, b.teamPremium.now > mine.now && mine.now >= mine.before * 0.8
      ? 'Your team out-sells you while you hold steady. That’s what building looks like.'
      : 'Building means: more agents selling steadily, one you developed, and team premium passing yours while yours holds.'));
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

function drawTeam(c, screen, top, t, { real = false } = {}) {
  const dup = t.duplication;
  const mb = t.monthBroke;
  fill(screen, top,
    t.top ? focusCard('NEEDS YOU FIRST', t.top.action, `${t.top.name}: ${t.top.reason}`)
      : focusCard('NEEDS YOU FIRST', 'Nobody needs you right now', 'Everyone has logged recently. Keep your own calls going.'),
    t.top ? h('button', { type: 'button', class: 'mini', onclick: () => talkedTo(c, t.top) }, `I talked to ${t.top.name}`) : null,
    h('p', { class: 'muted' }, `${t.counts.urgent} need you now · ${t.counts.watch} to watch · ${t.counts.ok} on track${t.counts.resting ? ` · ${t.counts.resting} checked in` : ''}`),
    t.people.map((p) => personCard(c, p, real)),
    trainerCard(t.trainer),
    mb ? focusCard('WHERE THIS MONTH BROKE', `Check in with ${mb.name || 'this agent'}`,
      `Premium written ${usd(mb.current)} this month vs ${usd(mb.previous)} last month. In the weakest week, ${mb.name} made ${mb.perDay} calls a day against a usual ${mb.usualPerDay}.`) : null,
    dup && dup.licensedAgents ? h('div', { class: 'card' }, h('b', {}, 'Is the team duplicating?'),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', {}, `${dup.producingAgents}/${dup.licensedAgents}`), h('span', {}, 'licensed agents with a sale in 30 days')),
        h('div', { class: 'stat' }, h('b', {}, dup.daysToFirstSale ?? '—'), h('span', {}, dup.daysToFirstSale === null ? 'days to first sale · needs a first sale' : 'median days to first sale')))) : null,
    real ? inviteCard(t) : null,
    real && t.archived?.length ? h('details', { class: 'card' }, h('summary', {}, h('b', {}, 'Off the team'), h('span', { class: 'muted' }, ` ${t.archived.length}`)),
      h('p', { class: 'muted' }, 'Their sales stay in your history. Invite them again and their log comes back.'),
      t.archived.map((a) => h('div', { class: 'item' }, h('div', { class: 'who' }, h('b', {}, a.name), h('span', { class: 'muted' }, `Left ${dayShort(a.at.slice(0, 10))}`))))) : null);
}

function renderTeam() {
  const c = ctx();
  const screen = $('screen-team');
  const top = head('WHO NEEDS YOU TODAY', 'Team');
  if (c.demo) { drawTeam(c, screen, top, teamView(c)); return; }
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
        h('div', { class: 'muted' }, 'Invite your agents and recruits below. Once they log on their own phones, this screen ranks who needs you first.')), inviteCard(t));
      return;
    }
    drawTeam(c, screen, top, t, { real: true });
    return;
  }
  const L = place(c);
  if (!isUnlocked(L.stage, 'Team')) { fill(screen, top, h('div', { class: 'card locked' }, h('b', {}, 'Team opens at Coach'), h('p', { class: 'muted' }, `You’re at ${L.name}. ${L.nextAction}`))); return; }
  fill(screen, top, h('div', { class: 'card locked' }, h('b', {}, 'No agents connected yet'),
    h('p', { class: 'muted' }, sync.account.site
      ? 'Sign in under the gear (top right). Then you can invite your agents, and their logs show up here.'
      : 'Your agents show up here once you use Agent Reels on your team’s site and invite them. Switch to Demo to see a full team.')));
}

// ── Settings: your data (under the gear, with Setup) ────────────────
function renderDataCard() {
  let card = $('data-card');
  if (!card) { card = h('section', { id: 'data-card', class: 'card' }); $('screen-setup').prepend(card); }
  const a = sync.account;
  $('leader-setup').hidden = a.on && a.role === 'agent';   // agents don't set up a leader's system
  if (state.mode === 'demo') { card.hidden = true; return; }
  card.hidden = false;
  const licenseRow = h('div', { class: 'row' }, h('span', { class: 'muted' }, `License: ${mine.profile.licensed === false ? 'not yet' : mine.profile.licensed ? 'yes' : 'not answered'}`),
    h('button', { type: 'button', class: 'link', onclick: () => act(ctx(), 'License answer cleared. Answer it again on Today.', () => { mine.profile.licensed = null; }) }, 'Change'));
  const dayRow = mine.profile.dayCalls ? h('div', { class: 'row' },
    h('span', { class: 'muted' }, `Full day: ${mine.profile.dayCalls} calls${mine.profile.stopAt ? ` · ends ${clock(mine.profile.stopAt, true)}` : ''}`),
    h('button', { type: 'button', class: 'link', onclick: () => act(ctx(), 'Cleared. Set your full day again on Today.', () => { delete mine.profile.dayCalls; delete mine.profile.stopAt; }) }, 'Change')) : null;
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
  const teamOpen = c.demo ? !!L && isUnlocked(L.stage, 'Team') : a.on ? a.role === 'leader' : !!L && isUnlocked(L.stage, 'Team');
  $('mode-demo').closest('.mode').hidden = a.on && a.role === 'agent';
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
  note.textContent = `Demo: ${DEMO.leaderName} is a made-up leader at 3:00 PM on Friday, Oct 30, with a team of three. Same engine as the real thing. Nothing here is saved.`;
  try { RENDER[tab](); } catch (e) { fill($(`screen-${tab}`), h('p', { class: 'err' }, `This screen hit an error: ${e.message}`)); }
}

const switchMode = (m) => { ui.open = null; ui.skip.clear(); clearTimeout(undo?.timer); undo = null; hideToast(); setMode(m); };
$('mode-mine').addEventListener('click', () => switchMode('mine'));
$('mode-demo').addEventListener('click', () => switchMode('demo'));
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
    if (doc) {
      mine = doc;
      if (sync.account.role === 'agent' && state.mode === 'demo') setMode('mine');
      if (sync.account.role === 'leader') refreshTeam();
    }
  } catch (e) { /* off the site: the log stays on this phone */ }
  booted = true;
  renderAll();
})();
