// Agent Reels screens: Today, Pipeline, Ladder, Team.
// Every number here comes from the engine in src/ reading the activity log.
// "Mine" logs to this phone only until the shared database is connected;
// "Demo" runs the same engine on a fictional leader's data.
import { state, setMode, onMode, onSystem } from './state.js';
import { buildActivities, TZ, DEMO } from './seed/sample.js';
import { DEMO_TEAM, DEMO_LEADS, DEMO_RECRUITS, DEMO_PLAYBOOK_READY, demoQualityActivities } from './seed/demo-pipeline.js';
import { placeOnLadder, routineFor, isUnlocked, STAGES, FOCUS_TOP } from './src/career.js';
import { todoFor } from './src/routines.js';
import { totalsFor, whereItBroke } from './src/timeframes.js';
import { redList, actionsFor, PATHS } from './src/paths.js';
import { duplication, RECRUIT_STAGES } from './src/ladder.js';
import { quality, CHECKPOINTS } from './src/quality.js';
import { LEAD_STAGES, nextLeadStage, moveLead, nextRecruitStage, moveRecruit, addRecruit } from './src/pipeline.js';

const $ = (id) => document.getElementById(id);
const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
const pct = (n) => (n === null ? '—' : Math.round(n * 100) + '%');
const day = (k) => new Date(k + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
const clock = (hhmm, ampm = false) => { const [h, m] = hhmm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${ampm ? (h < 12 ? ' AM' : ' PM') : ''}`; };
const uid = () => Math.random().toString(36).slice(2, 10);
/** Replace a screen's contents; nested lists of elements are flattened. */
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));

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

// ── Data for each mode ──────────────────────────────────────────────
const STORE_KEY = 'agent-reels-mine-v1';
const ME = 'me';
const localTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || TZ; } catch (e) { return TZ; } })();

function loadMine() {
  const empty = { activities: [], leads: [], recruits: [], names: [] };
  try { return { ...empty, ...(JSON.parse(localStorage.getItem(STORE_KEY) || 'null') || {}) }; } catch (e) { return empty; }
}
let mine = loadMine();
const saveMine = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(mine)); } catch (e) {} };

let demo = null;
function demoData() {
  demo ??= {
    activities: buildActivities(),
    quality: demoQualityActivities(),
    leads: DEMO_LEADS.filter((l) => l.agent_id === DEMO.leaderId).map((l) => ({ ...l })),
    recruits: DEMO_RECRUITS.map((r) => ({ ...r })),
    names: [],
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
      activities: d.activities, qualityActs: d.quality,
      leads: d.leads, recruits: d.recruits, names: d.names, team: DEMO_TEAM, playbookReady: DEMO_PLAYBOOK_READY,
      at: () => new Date(Date.UTC(2026, 9, 30, 22, d.tapMinute++ % 59)).toISOString(),
      save: () => {},
    };
  }
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: localTz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map((p) => [p.type, p.value]));
  return {
    demo: false, me: ME, myName: state.setup?.name || 'You', tz: localTz,
    dayKey: `${parts.year}-${parts.month}-${parts.day}`, now: `${parts.hour}:${parts.minute}`,
    activities: mine.activities, qualityActs: mine.activities,
    leads: mine.leads, recruits: mine.recruits, names: mine.names, team: [], playbookReady: false,
    at: () => new Date().toISOString(),
    save: saveMine,
  };
}

const sys = () => state.system;
const planNow = () => (sys()?.targetsReady ? sys().plan : null);
const place = (c) => placeOnLadder({ person: { id: c.me, name: c.myName }, team: c.team, activities: c.activities, dayKey: c.dayKey, tz: c.tz, playbookReady: c.playbookReady });

function log(c, rows) {
  c.activities.push(...rows);
  if (c.demo) demoData().quality.push(...rows.filter((r) => ['app_written', 'policy_issued', 'chargeback'].includes(r.type)));
  c.save();
}

// ── Today ───────────────────────────────────────────────────────────
const TAPS = [
  { type: 'dial', key: 'dials', label: 'Dial' },
  { type: 'conversation', key: 'conversations', label: 'Conversation' },
  { type: 'followup_done', key: 'followups', label: 'Follow-up' },
  { type: 'appt_set', key: 'apptsSet', label: 'Appointment set' },
];

function renderToday() {
  const c = ctx();
  const L = place(c);
  const r = routineFor(L.stage);
  const plan = planNow();
  const opts = { ...r, plan, activities: c.activities, agentId: c.me, tz: c.tz, times: sys()?.times || {}, content: false };
  const keep = (x) => !['1M', '1Q', '1Y'].includes(x.tf); // monthly and longer views are parked
  const items = todoFor(c.dayKey, { ...opts, now: c.now }).filter(keep);
  const all = todoFor(c.dayKey, opts).filter(keep);
  const hidden = all.length > items.length;
  const done = totalsFor(c.activities, { tf: '1D', key: c.dayKey, tz: c.tz, agentIds: [c.me] });
  // One next action: the most urgent rule that names a person, else the ladder's next step.
  const urgent = r.role === 'builder' && c.team.length
    ? actionsFor({ path: r.path, dayKey: c.dayKey, now: c.now, selfId: c.me, team: c.team, plan, activities: c.activities, tz: c.tz })[0]
    : null;

  const taps = [...TAPS];
  if (isUnlocked(L.stage, 'Recruiting')) taps.push({ type: 'recruit_step', key: 'recruitSteps', label: 'Recruiting step' });
  else if (isUnlocked(L.stage, 'Names list')) taps.push({ type: 'names_conversation', key: 'namesConversations', label: 'Names-list talk' });

  const screen = $('screen-today');
  fill(screen, 
    h('div', {}, h('div', { class: 'kicker' }, `${day(c.dayKey).toUpperCase()} · ${clock(c.now, true)}`), h('h2', {}, 'Today')),
    h('div', { class: 'card focus' },
      h('div', { class: 'kicker' }, `YOUR NEXT ACTION · ${L.name.toUpperCase()}`),
      h('div', { class: 'big' }, urgent ? urgent.text : L.nextAction),
      L.slipped ? h('div', { class: 'muted' }, 'Building waits until your own sales are steady again.') : null),
    h('div', { class: 'card' },
      h('div', { class: 'row' }, h('b', {}, 'Log what you just did'), h('span', { class: 'muted' }, 'One tap each')),
      h('div', { class: 'log' }, taps.map((t) => h('button', {
        type: 'button', 'aria-label': `Log one ${t.label.toLowerCase()}`,
        onclick: () => { log(c, [{ agent_id: c.me, type: t.type, occurred_at: c.at() }]); renderAll(); },
      }, h('b', {}, done[t.key] ?? 0), h('span', {}, t.label))))),
    h('div', { class: 'card' },
      h('div', { class: 'row' }, h('b', {}, 'Your day'), plan ? null : h('span', { class: 'pill grey' }, 'NO TARGETS YET')),
      items.length
        ? h('ul', { class: 'blocks' }, items.map((x) => h('li', { class: x.done ? 'done-row' : '' },
            h('span', { class: 't' }, clock(x.at)),
            h('span', { class: 'title' }, x.title),
            x.goal != null ? h('span', { class: 'prog' }, `${x.progress ?? 0}/${x.goal}`) : h('span'))))
        : h('p', { class: 'muted' }, 'No blocks today. Weekends are off the routine.'),
      hidden ? h('p', { class: 'muted' }, 'Your recruiting step is hidden today: dials are under 70% of the goal. Production comes first.') : null,
      plan ? null : h('p', { class: 'muted' }, 'Daily numbers show up once your contract level and 10 days of your own logging are in. Until then, run the blocks and log every action.')),
  );
}

// ── Pipeline ────────────────────────────────────────────────────────
let pipeTab = 'clients';
const drafts = {}; // premium typed on a card, kept across re-renders

function clientCard(c, lead) {
  const next = nextLeadStage(lead.stage);
  const move = (to, premium) => {
    try {
      const r = moveLead(lead, to, { at: c.at(), premium });
      Object.assign(lead, r.lead); log(c, r.rows); delete drafts[lead.id]; delete drafts[lead.id + ':err']; renderAll();
    } catch (e) { drafts[lead.id + ':err'] = `${e.message}. Enter it, then tap Submit.`; renderPipeline(); }
  };
  const label = LEAD_STAGES.find((s) => s.id === next)?.label;
  const acts = [];
  if (next === 'application') {
    acts.push(h('input', {
      class: 'prem', type: 'number', inputmode: 'numeric', min: '1', placeholder: 'Annual $', id: `prem-${lead.id}`,
      'aria-label': `Annual premium for ${lead.name}`, value: drafts[lead.id] ?? '',
      oninput: (e) => { drafts[lead.id] = e.target.value; },
    }));
    acts.push(h('button', { type: 'button', class: 'mini', onclick: () => move('application', Number(drafts[lead.id])) }, 'Submit'));
  } else if (next) {
    acts.push(h('button', { type: 'button', class: 'mini', onclick: () => move(next) }, `→ ${label}`));
  }
  if (lead.stage === 'issued') acts.push(h('button', { type: 'button', class: 'mini quiet', onclick: () => move('lapse_risk') }, 'Payment missed'));
  if (lead.stage === 'lapse_risk') acts.push(h('button', { type: 'button', class: 'mini', onclick: () => move('issued') }, 'Paid'));
  if (lead.stage !== 'lost') acts.push(h('button', { type: 'button', class: 'mini quiet', onclick: () => move('lost') }, 'Lost'));
  return h('div', { class: 'item' },
    h('div', { class: 'who' }, h('b', {}, lead.name), lead.premium ? h('div', { class: 'muted' }, `${usd(lead.premium)} a year`) : null,
      drafts[lead.id + ':err'] ? h('div', { class: 'err' }, drafts[lead.id + ':err']) : null),
    h('div', { class: 'acts inline' }, acts));
}

function addForm(id, placeholder, buttonLabel, onAdd) {
  const input = h('input', { id, type: 'text', placeholder, 'aria-label': placeholder, autocomplete: 'off' });
  const go = () => { const v = input.value.trim(); if (v) onAdd(v); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  return h('div', { class: 'inline' }, input, h('button', { type: 'button', class: 'mini', onclick: go }, buttonLabel));
}

function renderPipeline() {
  const c = ctx();
  const L = place(c);
  const screen = $('screen-pipeline');
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Pipeline' },
    ['clients', 'recruits'].map((t) => h('button', { type: 'button', 'aria-pressed': String(pipeTab === t), onclick: () => { pipeTab = t; renderPipeline(); } }, t === 'clients' ? 'Clients' : 'Recruits')));
  const head = h('div', {}, h('div', { class: 'kicker' }, 'MOVE A CARD AND IT’S LOGGED'), h('h2', {}, 'Pipeline'));

  if (pipeTab === 'clients') {
    const groups = LEAD_STAGES.map((s) => ({ s, list: c.leads.filter((l) => l.stage === s.id) })).filter((g) => g.list.length);
    fill(screen, head, seg,
      h('div', { class: 'card' }, h('b', {}, 'Add a client'),
        addForm('add-client', 'Client name', 'Add', (name) => { c.leads.unshift({ id: uid(), agent_id: c.me, name, stage: 'new', premium: null }); c.save(); renderAll(); })),
      groups.length ? groups.map(({ s, list }) => h('div', { class: 'card' },
        h('div', { class: 'stage-h' }, h('span', {}, s.label), h('span', { class: 'count' }, list.length)),
        list.map((l) => clientCard(c, l))))
        : h('p', { class: 'muted' }, 'No clients yet. Add the first one above.'));
    return;
  }

  // Recruits: the full pipeline opens at Coach; Producers keep a names list.
  if (!isUnlocked(L.stage, 'Recruiting pipeline')) {
    const namesOpen = isUnlocked(L.stage, 'Names list');
    fill(screen, head, seg,
      h('div', { class: 'card locked' },
        h('b', {}, namesOpen ? 'Your names list' : 'Recruiting opens at Producer'),
        h('p', { class: 'muted' }, namesOpen
          ? 'The full recruiting pipeline opens at Coach. For now, keep a list of people you’d want on your team, and log a talk when you have one.'
          : `You’re at ${L.name}. ${L.focus} You build only once you have selling worth copying.`),
        namesOpen ? addForm('add-name', 'Name', 'Add', (name) => { c.names.unshift({ id: uid(), name }); c.save(); renderPipeline(); }) : null,
        namesOpen ? c.names.map((n) => h('div', { class: 'item' }, h('div', { class: 'who' }, h('b', {}, n.name)),
          h('button', { type: 'button', class: 'mini', onclick: () => { log(c, [{ agent_id: c.me, type: 'names_conversation', occurred_at: c.at(), meta: { name_id: n.id } }]); renderAll(); } }, 'Talked today'))) : null));
    return;
  }
  const groups = RECRUIT_STAGES.map((s) => ({ s, list: c.recruits.filter((r) => r.stage === s.id) })).filter((g) => g.list.length);
  fill(screen, head, seg,
    h('div', { class: 'card' }, h('b', {}, 'Add a recruit'),
      addForm('add-recruit', 'Recruit name', 'Add', (name) => { const r = addRecruit({ id: uid(), name }, { builderId: c.me, at: c.at() }); c.recruits.unshift(r.recruit); log(c, r.rows); renderAll(); })),
    groups.length ? groups.map(({ s, list }) => h('div', { class: 'card' },
      h('div', { class: 'stage-h' }, h('span', {}, s.label), h('span', { class: 'count' }, list.length)),
      h('div', { class: 'muted' }, `Next: ${s.next}`),
      list.map((rec) => {
        const next = nextRecruitStage(rec.stage);
        return h('div', { class: 'item' }, h('div', { class: 'who' }, h('b', {}, rec.name)),
          next ? h('button', { type: 'button', class: 'mini', onclick: () => { const m = moveRecruit(rec, next, { builderId: c.me, at: c.at() }); Object.assign(rec, m.recruit); log(c, m.rows); renderAll(); } },
            `→ ${RECRUIT_STAGES.find((x) => x.id === next).label}`) : null);
      })))
      : h('p', { class: 'muted' }, 'No recruits yet.'));
}

// ── Ladder ──────────────────────────────────────────────────────────
function qualityCard(q, title) {
  return h('div', { class: 'card' },
    h('div', { class: 'row' }, h('b', {}, title), h('span', { class: 'muted' }, 'Only business that sticks counts')),
    h('div', { class: 'stats four' },
      h('div', { class: 'stat' }, h('b', {}, q.placed), h('span', {}, `placed of ${q.submitted} submitted`)),
      ...CHECKPOINTS.map((m) => h('div', { class: 'stat' }, h('b', {}, pct(q.activeAt[m].rate)),
        h('span', {}, q.activeAt[m].eligible ? `active at ${m} mo (${q.activeAt[m].active} of ${q.activeAt[m].eligible})` : `active at ${m} mo · needs data`)))),
    q.needsData.length ? h('ul', { class: 'needs' }, q.needsData.map((n) => h('li', {}, n))) : null);
}

function renderLadder() {
  const c = ctx();
  const L = place(c);
  const shown = STAGES.slice(0, STAGES.findIndex((s) => s.id === FOCUS_TOP) + 1);
  const at = shown.findIndex((s) => s.id === L.stage);
  const q = quality({ activities: c.qualityActs, agentIds: [c.me], dayKey: c.dayKey });
  fill($('screen-ladder'), 
    h('div', {}, h('div', { class: 'kicker' }, 'PRODUCER TO BUILDER'), h('h2', {}, `You’re at ${L.name}`)),
    h('ol', { class: 'ladder', 'aria-label': 'Career stages' }, shown.map((s, i) => h('li', { class: i < at ? 'past' : i === at ? 'now' : '', 'aria-current': i === at ? 'step' : null }, s.name))),
    h('div', { class: 'card focus' },
      h('div', { class: 'kicker' }, 'YOUR FOCUS'),
      h('div', { class: 'big' }, L.focus),
      h('div', { class: 'muted' }, L.why)),
    L.gate ? h('div', { class: 'card' },
      h('div', { class: 'row' }, h('b', {}, L.gate.parked ? 'Finish line for now' : `To reach ${L.gate.to}`), L.gate.parked ? h('span', { class: 'pill grey' }, 'NEXT STAGE PARKED') : null),
      h('table', { class: 'reqs' }, h('tbody', {}, L.gate.requirements.map((r) => h('tr', {},
        h('td', {}, r.label), h('td', { class: 'n2' }, `${r.have} / ${r.need}`), h('td', { class: 'n2' }, h('span', { class: `pill ${r.met ? 'green' : 'grey'}` }, r.met ? 'MET' : 'NOT YET')))))),
      h('div', {}, h('b', {}, 'Next: '), L.nextAction))
      : null,
    qualityCard(q, 'Your business'),
  );
}

// ── Team ────────────────────────────────────────────────────────────
function renderTeam() {
  const c = ctx();
  const L = place(c);
  const screen = $('screen-team');
  const head = h('div', {}, h('div', { class: 'kicker' }, 'WHO NEEDS YOU TODAY'), h('h2', {}, 'Team'));
  if (!isUnlocked(L.stage, 'Team')) {
    fill(screen, head, h('div', { class: 'card locked' }, h('b', {}, 'Team opens at Coach'),
      h('p', { class: 'muted' }, `You’re at ${L.name}. ${L.nextAction}`)));
    return;
  }
  if (!c.team.length) {
    fill(screen, head, h('div', { class: 'card locked' }, h('b', {}, 'No agents connected yet'),
      h('p', { class: 'muted' }, 'Your agents show up here once they log in to their own Today screen. That needs the shared database, which is the next build step. Switch to Demo to see a full team.')));
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
    const status = !red ? h('span', { class: 'pill grey' }, 'NEEDS TARGETS') : r ? h('span', { class: 'pill red' }, `RED · ${r.appts}/${r.pace} APPTS`) : h('span', { class: 'pill green' }, 'ON PACE');
    return { a, p, r, q, status };
  }).sort((x, y) => Number(!!y.r) - Number(!!x.r));

  fill(screen, head,
    broke.down && broke.agent ? h('div', { class: 'card focus' },
      h('div', { class: 'kicker' }, 'WHERE THIS MONTH BROKE'),
      h('div', { class: 'big' }, `Check in with ${names[broke.agent.agent_id] ?? 'this agent'} first`),
      h('div', { class: 'muted' }, `Premium written ${usd(broke.trail[0].current)} this month vs ${usd(broke.trail[0].previous)} last month. In the weakest week, ${names[broke.agent.agent_id]} made ${broke.agent.perDayInWeakBucket} dials a day against a usual ${broke.agent.usualPerDay}.`)) : null,
    h('div', { class: 'card' },
      h('b', {}, 'Is the team duplicating?'),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', {}, `${dup.producingAgents}/${c.team.length}`), h('span', {}, 'agents with a sale in 30 days')),
        h('div', { class: 'stat' }, h('b', {}, dup.daysToFirstSale ?? '—'), h('span', {}, 'median days to first sale')),
        h('div', { class: 'stat' }, h('b', {}, pct(teamQ.placeRate)), h('span', {}, 'of their submitted business placed')))),
    members.map(({ a, p, q, status }) => h('div', { class: 'card' },
      h('div', { class: 'row' }, h('b', {}, a.name), status),
      h('div', { class: 'muted' }, `${p.name} · ${q.placed} placed, ${q.lapsed} lapsed`),
      h('div', {}, p.nextAction))),
  );
}

// ── Shell: tabs, mode, demo note ────────────────────────────────────
const TABS = ['today', 'pipeline', 'ladder', 'team', 'setup'];
const RENDER = { today: renderToday, pipeline: renderPipeline, ladder: renderLadder, team: renderTeam, setup: () => {} };
function currentTab() { const t = (location.hash || '').slice(1); return TABS.includes(t) ? t : 'today'; }

function renderAll() {
  const tab = currentTab();
  for (const t of TABS) $(`screen-${t}`).hidden = t !== tab;
  document.querySelectorAll('[data-tab]').forEach((a) => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  $('mode-mine').setAttribute('aria-pressed', String(state.mode === 'mine'));
  $('mode-demo').setAttribute('aria-pressed', String(state.mode === 'demo'));
  const note = $('demo-note');
  note.hidden = state.mode !== 'demo';
  note.textContent = `Demo: ${DEMO.leaderName} is a made-up leader at 3:00 PM on Friday, Oct 30, with two months of logged activity, a team of three and an ${DEMO.contractPercent}% contract level. Same engine as the real system. Taps here aren’t saved.`;
  if (state.mode === 'mine' && tab !== 'setup') {
    note.hidden = false;
    note.textContent = 'Your taps are saved on this phone only until the shared database is connected.';
  }
  try { RENDER[tab](); } catch (e) { fill($(`screen-${tab}`), h('p', { class: 'err' }, `This screen hit an error: ${e.message}`)); }
}

$('mode-mine').addEventListener('click', () => setMode('mine'));
$('mode-demo').addEventListener('click', () => setMode('demo'));
onMode(renderAll);
onSystem(() => { if (currentTab() !== 'setup') renderAll(); });
addEventListener('hashchange', () => { renderAll(); scrollTo(0, 0); });
renderAll();
void PATHS;
