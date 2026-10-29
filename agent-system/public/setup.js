// Leader Setup page. It runs the real engine (src/setup.js) — no copied math,
// no starter numbers. "My setup" shows targets only once they can be real;
// "Demo" runs the same engine on a fictional leader's logged activity.
import { buildSystem, emptyLeaderSetup, premiumForIncome } from './src/setup.js';
import { PATHS } from './src/paths.js';
import { buildActivities, TZ, DEMO } from './seed/sample.js';
import { state, setMode, onMode, setSystem } from './state.js';

const $ = (id) => document.getElementById(id);
const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
const day = (k) => new Date(k + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const pct = (n) => (Math.round(n * 1000) / 10).toLocaleString('en-US') + '%';
const KEY = 'leader-setup-v5';

let S = emptyLeaderSetup();
try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d && d.version === S.version) S = { ...S, ...d }; } catch (e) {}
const DEMO_S = { ...emptyLeaderSetup(), name: DEMO.leaderName, hasAgents: true, start: 'standard', yearlyIncome: 120000 };
let demoS = { ...DEMO_S };
let demoActs = null; // built once, on first use

const cur = () => (state.mode === 'demo' ? demoS : S);
const missing = (s) => [s.hasAgents === null && 'question 1', !s.start && 'start of day', !(s.yearlyIncome > 0) && 'earnings goal'].filter(Boolean);

function systemFor(s) {
  if (state.mode !== 'demo') return buildSystem({ leader: s });
  demoActs ??= buildActivities();
  return buildSystem({ leader: s, contractPercent: DEMO.contractPercent, activities: demoActs, agentIds: [DEMO.leaderId], tz: TZ });
}

function li(text) { const el = document.createElement('li'); el.textContent = text; return el; }

function render() {
  const s = cur();
  $('result-eyebrow').textContent = state.mode === 'demo' ? `DEMO · ${DEMO.leaderName.toUpperCase()}'S LEADER ROUTINE` : 'YOUR LEADER ROUTINE';
  document.querySelectorAll('[data-k]').forEach((b) => {
    const v = b.dataset.v === 'true' ? true : b.dataset.v === 'false' ? false : b.dataset.v;
    b.setAttribute('aria-pressed', String(s[b.dataset.k] === v));
  });
  if (document.activeElement !== $('goal')) $('goal').value = s.yearlyIncome || '';

  const sys = systemFor(s);
  if (s.hasAgents === null) { $('rp').textContent = 'Answer question 1'; $('motto').textContent = ''; }
  else { const p = PATHS[sys.path]; $('rp').textContent = `${p.name} routine`; $('motto').textContent = `${p.motto} ${p.day} Your stage is on the Ladder; once you log activity, it picks your routine.`; }

  const after = $('after'); after.replaceChildren();
  if (sys.targetsReady) {
    const { plan, rates, measuredFrom: m } = sys;
    $('dials').textContent = plan.daily.dials;
    $('convos').textContent = plan.daily.conversations;
    $('appts').textContent = plan.weekly.appts;
    $('numbers').hidden = false;
    const head = document.createElement('div'); head.className = 'sub'; head.textContent = 'WHERE EVERY NUMBER COMES FROM';
    const facts = document.createElement('ul'); facts.className = 'facts';
    facts.append(
      li(`Earn ${usd(sys.yearlyIncome)} ÷ ${sys.contractPercent}% contract level = ${usd(sys.yearlyPremium)} in premium a year.`),
      li(`Average premium ${usd(rates.avgPremium)}: ${usd(m.premiumWritten)} over ${m.appsWritten} applications.`),
      li(`Close rate ${pct(rates.closeRate)}: ${m.appsWritten} applications from ${m.apptsSet} appointments.`),
      li(`Booking rate ${pct(rates.bookingRate)}: ${m.apptsSet} appointments from ${m.conversations} conversations.`),
      li(`Contact rate ${pct(rates.contactRate)}: ${m.conversations} conversations from ${m.dials} dials.`),
      li(`Measured over ${m.daysLogged} days of logged activity; months use 21 workdays.`),
    );
    after.append(head, facts);
  } else {
    $('numbers').hidden = true;
    const head = document.createElement('div'); head.className = 'sub'; head.textContent = 'YOUR DAILY NUMBERS APPEAR WHEN THESE ARE IN';
    const list = document.createElement('ul'); list.className = 'wait';
    const items = [
      ...(s.yearlyIncome > 0 ? [] : ['Your earnings goal (question 3)']),
      ...sys.waitingOn.you.filter((w) => /contract level/.test(w)).map(() => 'Your contract level, set for you from your contract'),
      // Before any activity, one line; once she's logging, each step shows its own count.
      ...(sys.measuredFrom.daysLogged === 0 ? sys.waitingOn.learning.slice(0, 1) : sys.waitingOn.learning),
    ];
    items.forEach((t) => list.append(li(t)));
    const note = document.createElement('p'); note.style.margin = '8px 0 0'; note.style.fontSize = '13.5px';
    note.textContent = 'Until then you run the routine and log what you do. Nothing is estimated.';
    after.append(head, list, note);
  }

  const left = missing(s);
  $('actions').hidden = state.mode === 'demo';
  $('send').disabled = left.length > 0;
  $('status').textContent = state.mode === 'demo' ? 'Demo answers are not saved or sent.' : left.length ? `Still to answer: ${left.join(', ')}.` : 'Done. Send your answers to set up your system.';
  $('out').textContent = JSON.stringify(S, null, 2);
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  setSystem(s, sys);
}

document.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => {
  const s = cur();
  const v = b.dataset.v === 'true' ? true : b.dataset.v === 'false' ? false : b.dataset.v;
  s[b.dataset.k] = s[b.dataset.k] === v ? null : v;
  render();
}));
$('goal').addEventListener('input', (e) => {
  const v = e.target.value.trim();
  const n = v === '' ? null : Number(v);
  cur().yearlyIncome = n > 0 ? n : null;
  $('goal-err').textContent = v !== '' && !(n > 0) ? 'Enter a dollar amount above 0.' : '';
  render();
});
onMode(() => { $('goal').value = cur().yearlyIncome || ''; $('goal-err').textContent = ''; render(); });

$('send').addEventListener('click', () => {
  const text = JSON.stringify(S, null, 2) + '\n';
  const done = () => { $('status').textContent = 'Copied. Paste it into a text or email to send it over.'; };
  const fallback = () => {
    $('out').hidden = false;
    const r = document.createRange(); r.selectNodeContents($('out')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    $('status').textContent = 'Copying is blocked here. Your answers are selected below: copy and send them.';
  };
  try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
});

void premiumForIncome; // the engine converts earnings; imported so the page fails loudly if it ever goes missing
render();
