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
import { redList, actionsFor } from './src/paths.js';
import { duplication, RECRUIT_STAGES } from './src/ladder.js';
import { quality, CHECKPOINTS } from './src/quality.js';
import { LEAD_STAGES, moveLead, nextRecruitStage, moveRecruit, addRecruit } from './src/pipeline.js';
import { CALL_OUTCOMES, MEETING_OUTCOMES, logCall, logMeeting, queueFor, addDays } from './src/calls.js';
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
  return {
    demo: false, me: ME, myName: state.setup?.name || 'You', tz: localTz,
    dayKey: `${parts.year}-${parts.month}-${parts.day}`, now: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`,
    activities: mine.activities, qualityActs: mine.activities, profile: mine.profile,
    leads: mine.leads, recruits: mine.recruits, names: mine.names, team: [], playbookReady: false,
    at: () => new Date().toISOString(),
    save: saveMine,
  };
}

const sys = () => state.system;
const planNow = () => (sys()?.targetsReady ? sys().plan : null);
const place = (c) => placeOnLadder({ person: { id: c.me, name: c.myName, licensed: c.profile.licensed ?? true }, team: c.team, activities: c.activities, dayKey: c.dayKey, tz: c.tz, playbookReady: c.playbookReady });

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
  c.save();
  clearTimeout(undo?.timer);
  undo = { snap, timer: setTimeout(() => { undo = null; hideToast(); }, 10_000) };
  toast(message, () => {
    const s = undo?.snap; if (!s || s.mode !== state.mode) return;
    const cc = ctx();
    cc.activities.length = s.acts;
    if (cc.demo) demoData().quality.length = s.quality;
    cc.leads.splice(0, cc.leads.length, ...s.leads);
    cc.recruits.splice(0, cc.recruits.length, ...s.recruits);
    cc.names.splice(0, cc.names.length, ...s.names);
    Object.assign(cc.profile, s.profile);
    cc.save(); clearTimeout(undo.timer); undo = null;
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
const ui = { open: null, skip: new Set(), priority: null }; // which card has its extra step open; people skipped this session
const head = (kicker, title) => h('div', {}, h('div', { class: 'kicker' }, kicker), h('h2', {}, title));
const focusCard = (kicker, text, sub) => h('div', { class: 'card focus' }, h('div', { class: 'kicker' }, kicker), h('div', { class: 'big' }, text), sub ? h('div', { class: 'muted' }, sub) : null);

function replies(list, onPick, disabled = () => false) {
  return h('div', { class: 'replies' }, list.map((o) => h('button', {
    type: 'button', class: `reply r-${o.id}`, disabled: disabled(o) || null, onclick: () => onPick(o.id),
  }, h('b', {}, o.label), h('span', {}, o.hint))));
}

function meter(c, plan) {
  const t = totalsFor(c.activities, { tf: '1D', key: c.dayKey, tz: c.tz, agentIds: [c.me] });
  const cell = (n, goal, label) => h('div', { class: 'stat' }, h('b', {}, goal ? `${n}/${goal}` : n), h('span', {}, label));
  return h('div', { class: 'stats four' },
    cell(t.dials, plan?.daily?.dials, 'calls'),
    cell(t.conversations, plan?.daily?.conversations, 'talked'),
    cell(t.apptsSet, null, 'meetings booked'),
    cell(t.followups, plan?.daily?.followups, 'follow-ups'));
}

function dayBlocks(c, L, plan) {
  const r = routineFor(L.stage);
  const opts = { ...r, plan, activities: c.activities, agentId: c.me, tz: c.tz, times: sys()?.times || {}, content: false };
  const keep = (x) => !['1M', '1Q', '1Y'].includes(x.tf); // monthly and longer views are parked
  const items = todoFor(c.dayKey, { ...opts, now: c.now }).filter(keep);
  const hidden = todoFor(c.dayKey, opts).filter(keep).length > items.length;
  return h('details', { class: 'card day' },
    h('summary', {}, h('b', {}, 'Your day, block by block'), h('span', { class: 'muted' }, `${items.length} blocks`)),
    items.length
      ? h('ul', { class: 'blocks' }, items.map((x) => h('li', { class: x.done ? 'done-row' : '' },
          h('span', { class: 't' }, clock(x.at)), h('span', { class: 'title' }, x.title),
          x.goal != null ? h('span', { class: 'prog' }, `${x.progress ?? 0}/${x.goal}`) : h('span'))))
      : h('p', { class: 'muted' }, 'No blocks today. Weekends are off the routine.'),
    hidden ? h('p', { class: 'muted' }, 'Your recruiting step is hidden today: calls are under 70% of the goal. Production comes first.') : null);
}

function backupNudge(c) {
  if (c.demo) return null;
  const age = backupAge(mine);
  if (!storageOk) return h('a', { class: 'card warn', href: '#setup' }, h('b', {}, 'This browser isn’t saving your log'), h('span', { class: 'muted' }, 'Private mode or blocked storage. Copy a backup now so nothing is lost.'));
  if (age === null || age < 7) return null;
  return h('a', { class: 'card warn', href: '#setup' }, h('b', {}, 'Back up your log'), h('span', { class: 'muted' }, mine.lastBackupAt ? `Last backup ${age} days ago.` : `Never backed up. ${age} days of logging live only on this device.`));
}

// ── Today ───────────────────────────────────────────────────────────
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
  const urgent = routineFor(L.stage).role === 'builder' && c.team.length
    ? actionsFor({ path: routineFor(L.stage).path, dayKey: c.dayKey, now: c.now, selfId: c.me, team: c.team, plan, activities: c.activities, tz: c.tz })[0]
    : null;
  const q = queueFor(c.leads.filter((l) => l.agent_id === c.me), c.dayKey);
  const calls = q.calls.filter((l) => !ui.skip.has(l.id));
  const pi = calls.findIndex((l) => l.id === ui.priority);
  if (pi > 0) calls.unshift(...calls.splice(pi, 1));
  const next = calls[0];
  const allSkipped = !next && q.calls.length > 0;

  fill(screen, top,
    backupNudge(c),
    q.meetings.map((m) => meetingCard(c, m)),
    next ? callCard(c, next, calls.length) : allSkipped
      ? h('section', { class: 'card call empty' }, h('div', { class: 'kicker' }, 'CALL NEXT'), h('div', { class: 'who-big quiet' }, `You skipped all ${q.calls.length}`), h('button', { type: 'button', class: 'go', onclick: () => { ui.skip.clear(); renderToday(); } }, 'Start the list again'))
      : emptyQueue(c),
    quickCall(c),
    meter(c, plan),
    focusCard(urgent ? 'NEEDS YOU TODAY' : `YOUR FOCUS · ${L.name.toUpperCase()}`, urgent ? urgent.text : L.nextAction),
    recruitingTap(c, L),
    addPeople(c),
    dayBlocks(c, L, plan));
}

function callCard(c, lead, count) {
  const status = lead.stage === 'new'
    ? (lead.tries ? `New · no answer ${lead.tries === 1 ? 'once' : `${lead.tries} times`}` : 'New · never called')
    : `${stageLabel(lead.stage)} · follow-up due ${lead.nextOn && lead.nextOn < c.dayKey ? `since ${dayShort(lead.nextOn)}` : 'today'}`;
  const booking = ui.open === `book:${lead.id}`;
  const pick = (outcome) => {
    if (outcome === 'booked') { ui.open = `book:${lead.id}`; return renderToday(); }
    ui.open = null;
    const label = CALL_OUTCOMES.find((o) => o.id === outcome).label;
    act(c, `${lead.name}: ${label.toLowerCase()}. ${outcome === 'no_answer' ? 'Back in your list soon.' : outcome === 'talked' ? `Follow up ${dayShort(addDays(c.dayKey, 2))}.` : 'Closed out.'}`, () => {
      const r = logCall(lead, outcome, { agentId: c.me, at: c.at(), today: c.dayKey });
      Object.assign(lead, r.lead); if (!r.lead.nextOn) delete lead.nextOn;
      return r.rows;
    });
  };
  const dateId = `meet-${lead.id}`;
  return h('section', { class: 'card call', 'aria-label': `Call ${lead.name}` },
    h('div', { class: 'row' }, h('div', { class: 'kicker' }, 'CALL NEXT'), h('span', { class: 'muted' }, `${count} to call today`)),
    h('div', { class: 'who-big' }, lead.name),
    h('div', { class: 'muted' }, status),
    h('div', { class: 'ask' }, 'After the call, tap what happened:'),
    booking
      ? h('div', { class: 'stepper' },
          h('label', { for: dateId }, `Meeting with ${lead.name} on`),
          h('div', { class: 'inline' },
            h('input', { id: dateId, type: 'date', min: c.dayKey, value: addDays(c.dayKey, 1) }),
            h('button', { type: 'button', class: 'go', onclick: () => {
              const meetingOn = $(dateId).value; ui.open = null;
              act(c, `Meeting booked with ${lead.name} for ${meetingOn ? dayShort(meetingOn) : 'that day'}.`, () => {
                const r = logCall(lead, 'booked', { agentId: c.me, at: c.at(), today: c.dayKey, meetingOn });
                Object.assign(lead, r.lead); return r.rows;
              });
            } }, 'Book it')),
          h('button', { type: 'button', class: 'link', onclick: () => { ui.open = null; renderToday(); } }, 'Back'))
      : replies(CALL_OUTCOMES, pick),
    count > 1 && !booking ? h('button', { type: 'button', class: 'link', onclick: () => { ui.skip.add(lead.id); renderToday(); } }, 'Skip for now') : null);
}

function meetingCard(c, lead) {
  const open = ui.open === `apply:${lead.id}`;
  const premId = `prem-${lead.id}`;
  const done = (outcome, premium) => {
    ui.open = null;
    const msg = { applied: `${lead.name}: application sent. Watch for the insurer’s answer in Pipeline.`, no_sale: `${lead.name}: met, no sale yet. Follow up ${dayShort(addDays(c.dayKey, 3))}.`, no_show: `${lead.name}: no-show. They’re back on tomorrow’s calls.` }[outcome];
    act(c, msg, () => { const r = logMeeting(lead, outcome, { at: c.at(), today: c.dayKey, premium }); Object.assign(lead, r.lead); if (!r.lead.meetingOn) delete lead.meetingOn; if (!r.lead.nextOn) delete lead.nextOn; return r.rows; });
  };
  return h('section', { class: 'card call meeting', 'aria-label': `Meeting with ${lead.name}` },
    h('div', { class: 'kicker' }, 'MEETING TODAY'),
    h('div', { class: 'who-big' }, lead.name),
    h('div', { class: 'ask' }, 'After the meeting, tap what happened:'),
    open
      ? h('div', { class: 'stepper' },
          h('label', { for: premId }, 'Yearly premium on the application'),
          h('div', { class: 'inline' },
            h('span', { class: 'money-in' }, h('span', {}, '$'), h('input', { id: premId, type: 'number', inputmode: 'numeric', min: '1', placeholder: '720' })),
            h('button', { type: 'button', class: 'go', onclick: () => {
              const p = Number($(premId).value);
              if (!(p > 0)) { toast('Enter the yearly premium in dollars, then tap Save.', null, true); return; }
              done('applied', p);
            } }, 'Save')),
          h('button', { type: 'button', class: 'link', onclick: () => { ui.open = null; renderToday(); } }, 'Back'))
      : replies(MEETING_OUTCOMES, (o) => { if (o === 'applied') { ui.open = `apply:${lead.id}`; renderToday(); } else done(o); }));
}

function emptyQueue(c) {
  const later = c.leads.filter((l) => l.agent_id === c.me && ['new', 'contacted', 'appointment'].includes(l.stage) && (l.nextOn || l.meetingOn))
    .map((l) => ({ l, on: l.stage === 'appointment' ? l.meetingOn : l.nextOn })).sort((a, b) => a.on.localeCompare(b.on))[0];
  if (later) return h('section', { class: 'card call empty' },
    h('div', { class: 'kicker' }, 'CALL NEXT'),
    h('div', { class: 'who-big quiet' }, 'All caught up for today'),
    h('div', { class: 'muted' }, `Next up: ${later.l.name}, ${later.l.stage === 'appointment' ? 'meeting' : 'call'} on ${dayShort(later.on)}. Add more people below to keep calling today.`));
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
    if (outcome === 'booked' && !name) { toast('Add their name to book a meeting, so it has someone to belong to.', null, true); return; }
    let lead = null;
    if (outcome === 'booked') {
      const id = uid();
      ui.open = `book:${id}`; ui.priority = id;
      act(c, `${name} added. Pick the meeting day.`, () => { c.leads.unshift({ id, agent_id: c.me, name, stage: 'new', premium: null }); });
      return;
    }
    act(c, name ? `${name}: ${CALL_OUTCOMES.find((o) => o.id === outcome).label.toLowerCase()}.` : 'Call logged.', () => {
      if (name) { lead = { id: uid(), agent_id: c.me, name, stage: 'new', premium: null }; c.leads.unshift(lead); }
      ui.open = null;
      const r = logCall(lead, outcome, { agentId: c.me, at: c.at(), today: c.dayKey });
      if (lead) { Object.assign(lead, r.lead); if (!r.lead.nextOn) delete lead.nextOn; }
      return r.rows;
    });
  };
  return h('section', { class: 'card' },
    h('div', { class: 'row' }, h('b', {}, 'Quick call'), h('button', { type: 'button', class: 'link', onclick: () => { ui.open = null; renderToday(); } }, 'Close')),
    h('label', { class: 'muted', for: nameId }, 'Their name (optional)'),
    h('input', { id: nameId, class: 'text-in', type: 'text', autocomplete: 'off', placeholder: 'Leave blank if you don’t have it' }),
    replies(CALL_OUTCOMES, pick));
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
  const scoreOpen = ui.open === 'score', passOpen = ui.open === 'pass';
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
    focusCard('YOUR FOCUS · LICENSING', L.nextAction),
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
  const move = (to, label) => act(c, `${lead.name}: ${label}.`, () => { const r = moveLead(lead, to, { at: c.at() }); Object.assign(lead, r.lead); return r.rows; });
  const acts = [];
  if (lead.stage === 'application') acts.push(h('button', { type: 'button', class: 'mini', onclick: () => move('issued', 'insurer approved') }, 'Insurer approved'));
  if (lead.stage === 'issued') acts.push(h('button', { type: 'button', class: 'mini quiet', onclick: () => move('lapse_risk', 'payment missed') }, 'Payment missed'));
  if (lead.stage === 'lapse_risk') acts.push(h('button', { type: 'button', class: 'mini', onclick: () => move('issued', 'paid again') }, 'Paid'));
  if (!['lost', 'new', 'contacted', 'appointment'].includes(lead.stage)) acts.push(h('button', { type: 'button', class: 'mini quiet', onclick: () => move('lost', lead.stage === 'application' ? 'declined' : 'policy lapsed') }, lead.stage === 'application' ? 'Declined' : 'Lapsed'));
  const when = lead.stage === 'appointment' && lead.meetingOn ? `Meeting ${dayShort(lead.meetingOn)}`
    : ['new', 'contacted'].includes(lead.stage) ? (lead.nextOn ? `Call ${lead.nextOn <= c.dayKey ? 'today' : dayShort(lead.nextOn)}` : 'In today’s calls') : null;
  return h('div', { class: 'item' },
    h('div', { class: 'who' }, h('b', {}, lead.name), h('div', { class: 'muted' }, [lead.premium ? `${usd(lead.premium)} a year` : null, when].filter(Boolean).join(' · '))),
    acts.length ? h('div', { class: 'acts' }, acts) : null);
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
    const order = ['appointment', 'application', 'issued', 'lapse_risk', 'contacted', 'new', 'lost'];
    const groups = order.map((id) => ({ id, list: mineLeads.filter((l) => l.stage === id) })).filter((g) => g.list.length);
    fill(screen, top, seg,
      h('p', { class: 'muted' }, 'Calls and meetings are logged on Today. Here you mark what happens after: the insurer’s answer and payments.'),
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
  fill(screen, top, seg,
    h('div', { class: 'card' }, h('b', {}, 'Add a recruit'),
      addForm('add-recruit', 'Recruit name', 'Add', (name) => act(c, `${name} added as a recruit.`, () => { const r = addRecruit({ id: uid(), name }, { builderId: c.me, at: c.at() }); c.recruits.unshift(r.recruit); return r.rows; }))),
    groups.length ? groups.map(({ s, list }) => h('div', { class: 'card' },
      h('div', { class: 'stage-h' }, h('span', {}, s.label), h('span', { class: 'count' }, list.length)),
      h('div', { class: 'muted' }, `Next: ${s.next}`),
      list.map((rec) => {
        const next = nextRecruitStage(rec.stage);
        const label = next && RECRUIT_STAGES.find((x) => x.id === next).label;
        return h('div', { class: 'item' }, h('div', { class: 'who' }, h('b', {}, rec.name)),
          next ? h('button', { type: 'button', class: 'mini', onclick: () => act(c, `${rec.name}: ${label.toLowerCase()}.`, () => { const m = moveRecruit(rec, next, { builderId: c.me, at: c.at() }); Object.assign(rec, m.recruit); return m.rows; }) }, `→ ${label}`) : null);
      })))
      : h('p', { class: 'muted' }, 'No recruits yet.'));
}

function addForm(id, placeholder, buttonLabel, onAdd) {
  const input = h('input', { id, class: 'text-in', type: 'text', placeholder, 'aria-label': placeholder, autocomplete: 'off' });
  const go = () => { const v = input.value.trim(); if (v) onAdd(v); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  return h('div', { class: 'inline' }, input, h('button', { type: 'button', class: 'mini', onclick: go }, buttonLabel));
}

// ── Ladder ──────────────────────────────────────────────────────────
function qualityCard(q, title) {
  return h('div', { class: 'card' },
    h('div', { class: 'row' }, h('b', {}, title), h('span', { class: 'muted' }, 'Only business that sticks counts')),
    h('div', { class: 'stats four' },
      h('div', { class: 'stat' }, h('b', {}, q.placed), h('span', {}, `approved of ${q.submitted} applications`)),
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
    L.stage === 'licensing' ? null : qualityCard(q, 'Your business'));
}

// ── Team ────────────────────────────────────────────────────────────
function renderTeam() {
  const c = ctx();
  const L = place(c);
  const screen = $('screen-team');
  const top = head('WHO NEEDS YOU TODAY', 'Team');
  if (!isUnlocked(L.stage, 'Team')) { fill(screen, top, h('div', { class: 'card locked' }, h('b', {}, 'Team opens at Coach'), h('p', { class: 'muted' }, `You’re at ${L.name}. ${L.nextAction}`))); return; }
  if (!c.team.length) {
    fill(screen, top, h('div', { class: 'card locked' }, h('b', {}, 'No agents connected yet'),
      h('p', { class: 'muted' }, 'Your agents show up here once they log in on their own phones. That needs the shared database, the next build step. Switch to Demo to see a full team.')));
    return;
  }
  const plan = planNow();
  const red = plan ? redList({ team: c.team, dayKey: c.dayKey, tz: c.tz, plan, activities: c.activities }) : null;
  const dup = duplication({ team: c.team, recruits: c.recruits, activities: c.activities, dayKey: c.dayKey, tz: c.tz });
  const ids = [c.me, ...c.team.map((a) => a.id)];
  const names = Object.fromEntries([[c.me, c.myName], ...c.team.map((a) => [a.id, a.name])]);
  const broke = whereItBroke(c.activities, { tf: '1M', key: c.dayKey.slice(0, 7), tz: c.tz, agentIds: ids });
  const teamQ = quality({ activities: c.qualityActs, agentIds: c.team.map((a) => a.id), dayKey: c.dayKey });
  const members = c.team.map((a) => {
    const p = placeOnLadder({ person: a, activities: c.activities, dayKey: c.dayKey, tz: c.tz });
    const r = red?.find((x) => x.id === a.id);
    const q = quality({ activities: c.qualityActs, agentIds: [a.id], dayKey: c.dayKey });
    const status = !red ? h('span', { class: 'pill grey' }, 'NEEDS TARGETS') : r ? h('span', { class: 'pill red' }, `BEHIND · ${r.appts}/${r.pace} MEETINGS`) : h('span', { class: 'pill green' }, 'ON PACE');
    return { a, p, r, q, status };
  }).sort((x, y) => Number(!!y.r) - Number(!!x.r));
  fill(screen, top,
    broke.down && broke.agent ? focusCard('WHERE THIS MONTH BROKE', `Check in with ${names[broke.agent.agent_id] ?? 'this agent'} first`,
      `Premium written ${usd(broke.trail[0].current)} this month vs ${usd(broke.trail[0].previous)} last month. In the weakest week, ${names[broke.agent.agent_id]} made ${broke.agent.perDayInWeakBucket} calls a day against a usual ${broke.agent.usualPerDay}.`) : null,
    h('div', { class: 'card' }, h('b', {}, 'Is the team duplicating?'),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', {}, `${dup.producingAgents}/${c.team.length}`), h('span', {}, 'agents with a sale in 30 days')),
        h('div', { class: 'stat' }, h('b', {}, dup.daysToFirstSale ?? '—'), h('span', {}, 'median days to first sale')),
        h('div', { class: 'stat' }, h('b', {}, pct(teamQ.placeRate)), h('span', {}, 'of their applications approved')))),
    members.map(({ a, p, q, status }) => h('div', { class: 'card' },
      h('div', { class: 'row' }, h('b', {}, a.name), status),
      h('div', { class: 'muted' }, `${p.name} · ${q.placed} approved, ${q.lapsed} lapsed`),
      h('div', {}, p.nextAction))));
}

// ── Settings: your data (under the gear, with Setup) ────────────────
function renderDataCard() {
  let card = $('data-card');
  if (!card) { card = h('section', { id: 'data-card', class: 'card' }); $('screen-setup').prepend(card); }
  if (state.mode === 'demo') { card.hidden = true; return; }
  card.hidden = false;
  const age = backupAge(mine);
  const confirmOpen = ui.open === 'restore';
  fill(card,
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
    h('div', { class: 'row' }, h('span', { class: 'muted' }, `License: ${mine.profile.licensed === false ? 'not yet' : mine.profile.licensed ? 'yes' : 'not answered'}`),
      h('button', { type: 'button', class: 'link', onclick: () => act(ctx(), 'License answer cleared. Answer it again on Today.', () => { mine.profile.licensed = null; }) }, 'Change')));
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
  const c = ctx();
  const L = c.profile.licensed === null ? null : place(c);
  const teamOpen = !!L && isUnlocked(L.stage, 'Team');
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

$('mode-mine').addEventListener('click', () => { ui.open = null; ui.skip.clear(); setMode('mine'); });
$('mode-demo').addEventListener('click', () => { ui.open = null; ui.skip.clear(); setMode('demo'); });
onMode(renderAll);
onSystem(() => { if (currentTab() !== 'setup') renderAll(); });
addEventListener('hashchange', () => { ui.open = null; renderAll(); scrollTo(0, 0); });
renderAll();
