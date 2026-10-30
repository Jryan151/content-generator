// Renee, week by week, Nov 2 2026 – Apr 30 2027, on the CURRENT Agent Reels engine.
// ENGINE (real): queueFor, logCall, logMeeting, approvePolicy, markPaymentMissed, logCareCall,
//   teamSummary, applyCheckins, ownProduction, builderMeasure, ownPremium, placeOnLadder,
//   buildSystem, expectedPayments (parked commission tracker: real math, not on any screen).
// APP RULE (copied from public/app.js renderToday): done = goal reached, goal = plan.daily.dials ?? her own dayCalls;
//   when done, Today hides "Needs you first" and the recruiting tap until tomorrow.
// MODEL (mine): Renee's feelings and choices, agents' behavior, scripted life events. Every rule is below.
// Usage: node weekly2.mjs <seed> <yearly goal> <out.json|-> <repo dir> <old|new>
const REPO = process.argv[5] || new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const MODE = process.argv[6] || 'new';
const NEW = MODE === 'new';
const R = REPO + '/src/';
const K = await import(R + 'calls.js');
const A = await import(R + 'attention.js');
const { placeOnLadder } = await import(R + 'career.js');
const { buildSystem } = await import(R + 'setup.js');
const { totalsFor } = await import(R + 'timeframes.js');
const { moveLead } = await import(R + 'pipeline.js');
const { expectedPayments } = await import(R + 'parked/commissions.js');
const PAY = NEW ? await import(R + 'pay.js') : null;

const TZ = 'America/Phoenix';
let s = Number(process.argv[2] || 11) >>> 0;
const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const chance = (p) => rnd() < p;
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const iso = (d, hm) => new Date(`${d}T${hm}:00-07:00`).toISOString();
const add = K.addDays;
const dow = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
const isWork = (d) => ![0, 6].includes(dow(d));
const clamp = (x) => Math.max(1, Math.min(10, Math.round(x)));
const CHECKS = { affordable: true, draft_date: true, bank_checked: true, wants_it: true };
const ME = 'renee';
const START = '2026-11-02', END = '2027-04-30', CONTRACT_ON = '2026-12-01';
const HOLIDAYS = new Set(['2026-11-26', '2026-11-27', '2026-12-24', '2026-12-25', '2027-01-01']);
const SICK = ['2027-02-08', '2027-02-12'];                 // scripted: flu week
const BAD_MONTH = '2027-01';                               // scripted: lead batch goes bad, her close rate drops
const FAMILY = { '2026-12-10': 'daughter’s school play, 6 PM', '2027-03-18': 'son’s first playoff game, 5:30 PM', '2027-04-22': 'anniversary dinner, 6:30 PM' };
const CONTRACT = { renee: 100, agents: 70 };               // levels you'd enter; advance 75% (STARTER_COMP)

// ── People (MODEL) ──
const P = {
  keisha: { name: 'Keisha', startedOn: '2026-06-01', licensed: true, dials: [14, 20], show: 0.8, close: 0.5, hm: '10:00' },
  jordan: { name: 'Jordan', startedOn: '2026-07-06', licensed: true, dials: [6, 16], show: 0.35, close: 0.45, hm: '10:00', lapse: 0.1 },
  priya: { name: 'Priya', startedOn: '2026-10-19', licensed: true, dials: [0, 3], show: 0.7, close: 0.3, hm: '11:00' },
  dante: { name: 'Dante', startedOn: '2026-06-15', licensed: true, dials: [12, 18], show: 0.8, close: 0.5, hm: '21:00' },
  troy: { name: 'Troy', startedOn: '2026-07-20', licensed: true, dials: [10, 16], show: 0.75, close: 0.45, hm: '10:00', silentFrom: '2026-11-04' },
  ana: { name: 'Ana', startedOn: '2026-10-19', licensed: false, studying: true, hm: '18:00', score: 74, diligent: true },
  ben: { name: 'Ben', startedOn: '2026-10-05', licensed: false, studying: true, hm: '20:00', score: 61, diligent: false },
};
const rows = { [ME]: [] }; for (const id in P) rows[id] = [];
const log = (id, d, hm, type, extra = {}) => rows[id].push({ agent_id: id, type, occurred_at: iso(d, hm), ...extra });
let seq = 0;
const policies = [];  // for expectedPayments: { id, agentId, client, annualPremium, issuedOn }
function agentDay(id, d) {
  const p = P[id];
  const n = between(...p.dials) + (p.boost || 0);
  for (let i = 0; i < n; i++) log(id, d, p.hm, 'dial');
  const conv = Math.round(n * 0.22); for (let i = 0; i < conv; i++) log(id, d, p.hm, 'conversation');
  const set = Math.round(conv * 0.3); for (let i = 0; i < set; i++) log(id, d, p.hm, 'appt_set', { meta: { meeting_on: d } });
  for (let i = 0; i < set; i++) if (chance(Math.min(0.9, p.show + (p.showBoost || 0)))) {
    log(id, d, p.hm === '21:00' ? '21:00' : '15:00', 'appt_held');
    if (chance(p.close)) { const lid = `${id}-${seq++}`, prem = between(520, 820); log(id, d, p.hm === '21:00' ? '21:00' : '15:30', 'app_written', { lead_id: lid, value: prem }); (p.pending ||= []).push({ lid, d, prem }); }
  }
}
// History: 8 weeks
const settle = (id, d) => { const p = P[id]; p.pending = (p.pending || []).filter((x) => { if (add(x.d, 4) <= d) { if (chance(0.88)) { log(id, d, '11:00', 'policy_issued', { lead_id: x.lid, value: x.prem }); (p.placed ||= []).push(x); if (d >= START) policies.push({ id: x.lid, agentId: id, client: x.lid, annualPremium: x.prem, issuedOn: d }); } return false; } return true; }); };
for (let d = '2026-09-07'; d <= '2026-10-30'; d = add(d, 1)) if (isWork(d)) {
  for (const id of ['keisha', 'jordan', 'dante', 'troy']) { agentDay(id, d); settle(id, d); }
  if (d >= '2026-10-19') { agentDay('priya', d); log('ana', d, '18:00', 'study_session', { value: 30 }); }
  if (d >= '2026-10-05' && chance(0.3)) log('ben', d, '20:00', 'study_session', { value: 30 });
}
log('ana', '2026-10-28', '18:30', 'practice_test', { value: 74 }); log('ben', '2026-10-22', '20:30', 'practice_test', { value: 61 });
// Renee's history (real call chain not needed for the past: summary rows)
for (let d = '2026-09-07'; d <= '2026-10-30'; d = add(d, 1)) if (isWork(d)) { for (let k = 0; k < 46; k++) log(ME, d, '09:30', 'dial'); for (let k = 0; k < 17; k++) log(ME, d, '09:30', 'conversation'); for (let k = 0; k < 2; k++) log(ME, d, '09:30', 'appt_set'); if (chance(0.85)) log(ME, d, '18:00', 'appt_held'); if (chance(0.8)) log(ME, d, '18:00', 'appt_held'); const na = chance(0.25) ? 2 : 1; for (let k = 0; k < na; k++) log(ME, d, '18:30', 'app_written', { lead_id: `h${seq++}`, value: between(600, 900) }); }

// ── Renee's book (ENGINE call chain) ──
let leads = [];
const newLeads = (n) => { for (let i = 0; i < n; i++) leads.push({ id: `L${seq++}`, agent_id: ME, name: `Client ${seq}`, stage: 'new', premium: null }); };
newLeads(200);
const apply = (r, lead) => { if (lead) { for (const k of Object.keys(lead)) if (!(k in r.lead)) delete lead[k]; Object.assign(lead, r.lead); } rows[ME].push(...r.rows); };

// ── Feelings (MODEL) ──
const F = { energy: 5, guilt: 7, trust: 4, fear: 6, identity: 2, app: 6 };
const B = { trust: 0, identity: 0, fear: 0, guilt: 0 };
const PAYS = [];
const profile = { dayCalls: null };
let system = null;
const off = new Set(); const archived = [];
const W = [];   // weekly records
let week = null;
const monthMoney = {}; // month -> { ownAdvance, overrideExpected, clawback }
const newWeek = (d) => ({ start: d, calls: 0, apps: 0, prem: 0, teamApps: 0, teamPrem: 0, done: 0, doneHidTeam: 0, nightLog: 0, keepWorking: 0, family: 0, familyMissed: [], familyMade: [], checkins: [], teamSkipped: [], cards: [], ownDown: 0, events: [], weekendWaiting: 0, why: {} , workdays: 0, actsOnTeam: 0 });

const quitEvents = {};
let anaFirstSale = null, anaSteadyOn = null, jordanQuit = false, priyaQuit = false, priyaCoached = 0, troyCheckins = 0;
let lastOverride = null;

for (let d = START; d <= END; d = add(d, 1)) {
  if (dow(d) === 1 || !week) { if (week) W.push(week); week = newWeek(d); }
  const month = d.slice(0, 7);
  if (!isWork(d) || HOLIDAYS.has(d)) {
    if (!isWork(d)) { const q = K.queueFor(leads, d); week.weekendWaiting = Math.max(week.weekendWaiting, q.waiting || 0); if (q.saves.length || q.meetings.length) week.events.push(`Weekend: ${q.saves.length} urgent save(s) shown`); }
    continue;
  }
  week.workdays++;
  const sick = d >= SICK[0] && d <= SICK[1];

  // ── Team (MODEL behavior; rows feed the ENGINE) ──
  for (const [id, p] of Object.entries(P)) {
    if (off.has(id) || p.quit) continue;
    if (p.silentFrom && d >= p.silentFrom) continue;
    if (p.studying) {
      if (p.diligent || chance(0.35)) log(id, d, p.hm, 'study_session', { value: 30 });
      if (chance(0.2)) { p.score = Math.min(92, p.score + (p.diligent ? between(1, 3) : between(0, 2))); log(id, d, p.hm, 'practice_test', { value: p.score }); }
      if (id === 'ana' && !p.examOn && d >= '2026-11-10') { p.examOn = '2026-11-24'; log(id, d, p.hm, 'exam_booked', { meta: { exam_on: p.examOn } }); }
      if (p.examOn === d) {
        const pass = p.score >= 72 ? true : (p.tries || 0) >= 1 && p.score >= 66;
        if (pass) { log(id, d, '16:00', 'license_passed'); p.studying = false; p.licensed = true; p.licensedOn = d; p.dials = id === 'ana' ? [12, 20] : [4, 12]; p.show = 0.75; p.close = id === 'ana' ? 0.35 : 0.3; p.hm = '10:00'; week.events.push(`${p.name} passed the exam`); }
        else { p.tries = (p.tries || 0) + 1; p.examOn = null; week.events.push(`${p.name} failed the exam (practice ${p.score})`); }
      }
      continue;
    }
    if (p.licensedOn && id === 'ana') { const wks = (Date.parse(d) - Date.parse(p.licensedOn)) / 6048e5; p.dials = [Math.min(30, 12 + Math.round(wks * 1.5)), Math.min(34, 20 + Math.round(wks * 1.5))]; p.close = Math.min(0.5, 0.35 + wks * 0.01); }
    if (id === 'priya' && p.coachedUntil && d <= p.coachedUntil) p.dials = [10, 18]; else if (id === 'priya') p.dials = [0, 3];
    agentDay(id, d);
    // approvals after 4 days, lapses
    settle(id, d);
    for (const x of [...(p.placed || [])]) if (chance((p.lapse || 0.03) / 21)) { log(id, d, '10:00', 'chargeback', { lead_id: x.lid, value: x.prem }); p.placed = p.placed.filter((y) => y !== x); (monthMoney[month] ||= {}).clawback = ((monthMoney[month] || {}).clawback || 0) + x.prem * 0.30 * 0.75; week.events.push(`${p.name}: a policy lapsed`); }
  }
  // Scripted investment (MODEL): three evening ride-alongs with Priya after her silence flag.
  if (['2026-11-12', '2026-11-17', '2026-11-19'].includes(d)) { priyaCoached++; P.priya.coachedUntil = '2026-12-18'; week.events.push(`Evening ride-along with Priya #${priyaCoached} (gave up her own 6 PM meeting)`); week.investedEvenings = (week.investedEvenings || 0) + 1; for (const m of K.queueFor(leads, d).meetings.slice(0, 1)) apply(K.logMeeting(m, 'no_show', { at: iso(d, '19:00'), today: d }), m); }
  // Scripted quits (MODEL)
  if (d === '2027-01-22' && !P.priya.quit) { P.priya.quit = true; priyaQuit = true; week.events.push(`Priya quit after ${priyaCoached} ride-alongs ("I can't do the phones")`); quitEvents.priya = d; }
  if (d === '2027-03-05' && !P.jordan.quit) { P.jordan.quit = true; jordanQuit = true; week.events.push('Jordan took a salaried job and quit'); }

  // ── ENGINE: Team ranking at 1 PM ──
  const members = Object.entries(P).filter(([id]) => !off.has(id)).map(([id, p]) => ({ id, name: p.name, startedOn: p.startedOn, licensed: p.licensed ?? true, activities: rows[id].filter((r) => r.occurred_at <= iso(d, '13:00')) }));
  let sum = A.teamSummary({ members, dayKey: d, now: '13:00', tz: TZ, plan: system?.plan || null });
  sum = A.applyCheckins(sum, rows[ME], { dayKey: d, tz: TZ });
  const top = sum.top;
  let own = A.ownProduction(rows[ME], { me: ME, dayKey: d, tz: TZ });
  // NEW (app): the "calls are down" card offers "I was off those days". MODEL: she taps it 8 times in 10.
  if (NEW && own.down && own.unmarkedZeroDays?.length && chance(0.8)) {
    for (const day of own.unmarkedZeroDays) rows[ME].push(A.dayOffRow({ me: ME, day, at: iso(d, '09:00') }));
    week.events.push(`Tapped "I was off" for ${own.unmarkedZeroDays.length} day(s): the "calls are down" card went away`);
    own = A.ownProduction(rows[ME], { me: ME, dayKey: d, tz: TZ });
  }
  if (own.down) week.ownDown++;
  if (top && (dow(d) === 1 || dow(d) === 4)) week.cards.push(`${['', 'Mon', '', '', 'Thu'][dow(d)]}: ${top.name} — ${top.reason}`);

  // ── Her day (MODEL decisions, ENGINE call chain) ──
  if (sick) { week.events.push(dow(d) === 1 ? 'Sick all week (flu): no calls' : null); week.events = week.events.filter(Boolean); }
  const goal = system?.plan?.daily?.dials ?? profile.dayCalls ?? null;
  week.goals = [...(week.goals || []), goal];
  // Week 1: she sets her full day when the card asks (one tap burst): her real habit, 46.
  if (!profile.dayCalls && d >= '2026-11-03') { profile.dayCalls = 46; week.events.push('Set "full day" = 46 calls on Today'); }
  const nightLog = !sick && chance(F.energy <= 4 ? 0.3 : 0.15);
  if (nightLog) week.nightLog++;
  // Team time she gives (MODEL): driven by identity vs money fear; 0 when own calls are "down" (the app says so).
  const wantsTeam = !sick && !own.down && top && chance(Math.max(0.1, Math.min(0.9, 0.35 + 0.06 * (F.identity - F.fear) + 0.03 * F.app)));
  let calls = 0, teamCost = 0;
  // Calls: up to her goal; money fear pushes past it ("Keep working anyway").
  const cap = sick ? 0 : Math.round(between(44, 50) * (F.energy >= 4 ? 1 : 0.85));
  const target = goal ? goal : cap;
  const doneTimeCalls = target; // calls happen 9:00 onward at ~2.6 min each
  const doneAt = (n) => { const m = 9 * 60 + Math.round(n * 2.6); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  let shownDone = false;
  if (!sick) {
    calls = Math.min(cap, target);
    shownDone = !!goal && !nightLog;   // night logging: the app can't know she's done during the day
    if (goal && calls >= goal && F.fear >= 8 && chance(0.6)) { const extra = between(6, 14); calls += extra; week.keepWorking++; week.events.push(`Tapped "Keep working anyway" (+${extra} calls): money fear ${F.fear}`); }
    if (!goal || nightLog) calls = cap;
  }
  // Done hides the team card if she's done before she'd look (1 PM).
  const doneHidesTeam = !NEW && shownDone && calls >= goal && doneAt(goal) < '13:00' && top; // NEW: the Done card keeps one team action
  if (doneHidesTeam) week.doneHidTeam++;
  if (wantsTeam && !(doneHidesTeam && !chance(0.35))) {
    teamCost = 5; week.actsOnTeam++;
    rows[ME].push(A.checkinRow({ me: ME, personId: top.id, at: iso(d, '13:05') }));
    week.checkins.push(top.name);
    // Effects (MODEL)
    const gone = top.id === 'troy' || P[top.id].quit; if (gone) { P[top.id].checks = (P[top.id].checks || 0) + 1; if (P[top.id].checks >= 2) { off.add(top.id); archived.push([P[top.id].name, d]); week.events.push(`Took ${P[top.id].name} off the team (archived, history kept)`); } }
    if (top.id === 'priya' && !P.priya.quit) { P.priya.coachedUntil = P.priya.coachedUntil > add(d, 7) ? P.priya.coachedUntil : add(d, 7); }
    if (top.id === 'ben') { if (!P.ben.examOn && P.ben.studying) { P.ben.examOn = add(d, 21); log('ben', d, '20:00', 'exam_booked', { meta: { exam_on: P.ben.examOn } }); week.events.push(`Ben booked his exam for ${P.ben.examOn} after she sat with his scores`); } }
    if (top.id === 'jordan') P.jordan.showBoost = Math.min(0.35, (P.jordan.showBoost || 0) + 0.05);
    if (top.id === 'ana') P.ana.boost = 3;
  } else if (top && !sick) {
    week.teamSkipped.push(own.down ? `own calls "down" card` : doneHidesTeam ? 'Done card hid it' : `chose her calls (fear ${F.fear} vs identity ${F.identity})`);
  }
  calls = Math.max(0, calls - (sick ? 0 : teamCost));
  // Trainer pairing (ENGINE suggests; MODEL: she asks Keisha once identity ≥ 5)
  if (sum.trainer?.learnerId && F.identity >= 5 && !P[sum.trainer.learnerId]?.trained && chance(0.2)) { P[sum.trainer.learnerId].trained = true; if (P[sum.trainer.learnerId].show !== undefined) P[sum.trainer.learnerId].showBoost = (P[sum.trainer.learnerId].showBoost || 0) + 0.1; week.events.push(`Used the trainer card: ${sum.trainer.action}`); }

  // Her calls through the real chain
  const at = nightLog ? iso(d, '21:05') : iso(d, '10:30');
  if (leads.filter((l) => l.stage === 'new' && !l.nextOn).length < 80) newLeads(60);
  const bad = month === BAD_MONTH;
  for (let i = 0; i < calls; i++) {
    const q = K.queueFor(leads, d); const lead = q.calls[0]; if (!lead) break;
    const r = rnd();
    const o = r < 0.62 ? 'no_answer' : r < 0.76 ? 'talked' : r < (bad ? 0.89 : 0.86) ? 'not_interested' : r < (bad ? 0.92 : 0.90) ? 'booked' : r < 0.94 ? 'callback' : r < (bad ? 0.945 : 0.95) ? 'applied' : 'bad_number';
    const extra = o === 'booked' ? { meetingOn: K.addWorkdays(d, between(1, 3)), meetingAt: '18:00' } : o === 'callback' ? { callbackOn: K.addWorkdays(d, 2), callbackAt: '10:00' } : o === 'applied' ? { premium: between(600, 900), checks: CHECKS } : {};
    apply(K.logCall(lead, o, { agentId: ME, at, today: d, ...extra }), lead);
  }
  // Evening meetings (her income engine). A family event that night competes.
  const fam = FAMILY[d];
  const meetings = K.queueFor(leads, d).meetings;
  if (fam) {
    if (meetings.length && F.fear >= 6) { week.familyMissed.push(`${fam} (had ${meetings.length} 6 PM meeting${meetings.length > 1 ? 's' : ''})`); }
    else { week.familyMade.push(fam); week.family++; for (const m of meetings) { apply(K.logMeeting(m, 'no_show', { at: iso(d, '19:00'), today: d }), m); } }
  }
  for (const m of K.queueFor(leads, d).meetings) {
    if (sick) { apply(K.logMeeting(m, 'no_show', { at: iso(d, '19:00'), today: d }), m); continue; }
    const o = chance(0.12) ? 'no_show' : chance(bad ? 0.3 : 0.5) ? 'applied' : 'no_sale';
    apply(K.logMeeting(m, o, { at: iso(d, '19:00'), today: d, ...(o === 'applied' ? { premium: between(600, 900), checks: CHECKS } : {}) }), m);
  }
  for (const l of leads.filter((l) => l.stage === 'application')) { l.appliedOn ||= d; if (add(l.appliedOn, 4) <= d) { if (chance(0.87)) { apply(K.approvePolicy(l, { at: iso(d, '11:00'), today: d, draftOn: add(d, 10) }), l); policies.push({ id: l.id, agentId: ME, client: l.name, annualPremium: l.premium, issuedOn: d }); } else apply(moveLead(l, 'lost', { at: iso(d, '11:00') }), l); } }
  for (const { lead, kind } of K.queueFor(leads, d).care) apply(K.logCareCall(lead, kind, sick ? 'no_answer' : 'reached', { at: iso(d, '13:00'), today: d }), lead);
  for (const l of leads.filter((l) => l.stage === 'issued' && !Object.keys(l.care || {}).length)) if (chance(0.035 / 21)) apply(K.markPaymentMissed(l, { at: iso(d, '08:00'), today: d, graceEndsOn: add(d, 14) }), l);
  for (const l of K.queueFor(leads, d).saves) { if (sick) continue; const r2 = rnd(); apply(K.logCareCall(l, 'save', r2 < 0.45 ? 'fixed' : r2 < 0.75 ? 'no_answer' : 'canceling', { at: iso(d, '08:30'), today: d }), l); if (r2 >= 0.75) week.events.push('Lost a save on her own book'); }

  // Family evening on an ordinary day (MODEL): likely when Done showed and she didn't keep working.
  if (!fam && !sick) {
    const doneToday = shownDone && calls >= goal - teamCost;
    // NEW (app): an end time she set from the full-day note gives "Done" by time even when the calls run short.
    const byTime = NEW && profile.stopAt && !doneToday;
    const freeEvening = K.queueFor(leads, add(d, 1)).meetings.length === 0;
    if (chance(doneToday && !week.keepWorking ? 0.45 : byTime ? (freeEvening ? 0.35 : 0.15) : 0.08)) week.family++;
    if (doneToday || byTime) week.done++;
  }

  // Tally
  const t = totalsFor(rows[ME], { tf: '1D', key: d, tz: TZ, agentIds: [ME] });
  week.calls += t.dials; week.apps += t.appsWritten; week.prem += t.premiumWritten;
  for (const id in P) { const tt = totalsFor(rows[id], { tf: '1D', key: d, tz: TZ, agentIds: [id] }); week.teamApps += tt.appsWritten; week.teamPrem += tt.premiumWritten; }
  if (!anaFirstSale && rows.ana.some((a) => a.type === 'app_written')) { anaFirstSale = d; week.events.push('Ana’s first sale'); }

  // Nightly: system rebuild (targets from Dec 1 once real)
  system = buildSystem({ leader: { version: 4, hasAgents: true, start: 'standard', yearlyIncome: Number(process.argv[3] || 250000) }, contractPercent: d >= CONTRACT_ON ? CONTRACT.renee : null, activities: rows[ME], agentIds: [ME], tz: TZ });
  if (system.targetsReady && !week.targetNote && !W.some((w) => w.targetNote)) { week.targetNote = true; week.events.push(`Targets replace her 46: ${system.plan.daily.dials} calls is now a "full day"`); week.targetBroke = system.plan.daily.dials > 60; }
  // NEW (app): the full-day note asks when her workday ends. MODEL: she sets 5:30 PM the first time 6 in 10 times, else when the full day jumps.
  if (NEW && system.targetsReady && !profile.stopAt) { const g = system.plan.daily.dials; if (!profile.goalSeen) { profile.goalSeen = g; if (chance(0.6)) { profile.stopAt = '17:30'; week.events.push(`Full-day note: set her workday to end at 5:30 PM`); } } else if (g !== profile.goalSeen && Math.abs(g - profile.goalSeen) >= 3) { profile.goalSeen = g; week.events.push(`Full-day note: "${g} calls now, here is why"; she set a 5:30 PM end time`); profile.stopAt = '17:30'; } }

  // Friday (or last workday): what the Ladder and money show, then feelings.
  let nx = add(d, 1); while (!isWork(nx) || HOLIDAYS.has(nx)) nx = add(nx, 1);
  if (dow(nx) === 1 || nx > END || add(d, 1) > END) {
    const full = members.map((m) => ({ ...m, activities: rows[m.id] }));
    const endSum = A.teamSummary({ members: full, dayKey: d, now: '23:00', tz: TZ, plan: system?.plan || null });
    const L = placeOnLadder({ person: { id: ME, name: 'Renee' }, teamStages: endSum.stages, activities: rows[ME], dayKey: d, tz: TZ, playbookReady: false });
    const LD = placeOnLadder({ person: { id: ME, name: 'Renee' }, teamStages: endSum.stages, activities: rows[ME], dayKey: d, tz: TZ, playbookReady: false, topStage: 'upline' });
    const mine = A.ownPremium(rows[ME], { me: ME, dayKey: d });
    week.ladder = { stage: L.stage, director: LD.gate?.requirements?.map((r) => `${r.label} ${r.have}/${r.need}`).join('; '), steady: endSum.builder.steady.now, developed: endSum.builder.developed.now, team30: endSum.builder.teamPremium.now, mine30: mine.now };
    week.trainer = endSum.trainer?.action || null;
    if (anaFirstSale && !anaSteadyOn && endSum.people.find((p) => p.id === 'ana')?.steady) { anaSteadyOn = d; week.events.push('Ana: a sale in 3 of the last 6 weeks (steady)'); }
    if (endSum.builder.developed.now > 0 && !W.some((w) => w.events.includes('Ladder counts Ana as developed to Producer'))) week.events.push('Ladder counts Ana as developed to Producer');

    // Money (ENGINE math from the parked tracker; clawbacks MODEL)
    const people = { renee: { name: 'Renee', contractPercent: CONTRACT.renee, uplineId: null } };
    for (const id in P) people[id] = { name: P[id].name, contractPercent: CONTRACT.agents, uplineId: 'renee' };
    const wkPolicies = policies.filter((p) => p.issuedOn >= week.start && p.issuedOn <= d);
    const exp = expectedPayments({ me: 'renee', people, policies: wkPolicies });
    week.override = Math.round(exp.items.filter((i) => i.kind === 'override').reduce((a, i) => a + i.amount, 0));
    week.ownAdv = Math.round(exp.items.filter((i) => i.kind === 'advance').reduce((a, i) => a + i.amount, 0));
    (monthMoney[month] ||= {}); monthMoney[month].override = (monthMoney[month].override || 0) + week.override; monthMoney[month].own = (monthMoney[month].own || 0) + week.ownAdv;

    // ── FEELINGS (MODEL). Levels from the last weeks + event bumps that fade. Each has a "why" from this week. ──
    const why = week.why; const prev = { ...F };
    const sickWeek = week.start <= SICK[1] && d >= SICK[0];
    const last = [...W.slice(-3), week];
    const famAvg = last.slice(-2).reduce((a, w) => a + w.family, 0) / Math.min(2, last.length);
    const herP = last.reduce((a, w) => a + w.prem, 0), teamP = last.reduce((a, w) => a + w.teamPrem, 0);
    const share = teamP / Math.max(1, herP + teamP);                      // team's share of premium, last 4 weeks
    const normal = W.length >= 4 ? W.slice(0, 4).reduce((a, w) => a + w.prem, 0) / 4 : 3500;
    const herRatio = (herP / last.length) / normal;
    // NEW (app): her pay next to her team's, net of lapses (src/pay.js, 30 days). MODEL: once she can see it, money fear reads total pay, not her own sales alone.
    let payRatio = null, payNote = null, teamPaidMore = false;
    if (NEW) {
      const levels = { renee: CONTRACT.renee }; for (const id in P) levels[id] = CONTRACT.agents;
      const all = [...rows[ME], ...Object.keys(P).flatMap((id) => rows[id])];
      const pp = PAY.payPicture({ me: ME, activities: all, levels, dayKey: d, tz: TZ, days: 30 });
      if (pp.ready) {
        const tot = pp.own.net + pp.team.net;
        PAYS.push(tot);
        const base = PAYS.slice(0, 4).reduce((a, x) => a + x, 0) / Math.min(4, PAYS.length);
        payRatio = tot / base; teamPaidMore = pp.team.net >= pp.own.net * 0.5;
        payNote = `30-day pay: her sales $${Math.round(pp.own.net)}, team $${Math.round(pp.team.net)}`;
        week.pay = { own: Math.round(pp.own.net), team: Math.round(pp.team.net) };
      }
    }
    B.trust *= 0.75; B.fear *= 0.6; B.guilt *= 0.6; B.identity = 0;   // bumps fade; identity moves only on this week's events
    const ev = (re) => week.events.find((e) => re.test(e));
    if (sickWeek && week.teamApps >= 4) { B.trust += 2; B.identity += 1; }
    if (ev(/quit/)) { B.trust -= 2; B.identity -= 1; B.guilt += 2; }
    if (ev(/Ana’s first sale|steady|developed/)) { B.trust += 1; B.identity += 1; }
    if (ev(/trainer card/)) { B.identity += 1; }
    const ovExp = lastOverride ?? week.override;
    const ovSurprise = week.override > ovExp * 1.3 ? -1.5 : week.override < ovExp * 0.7 ? 1.5 : 0;
    B.fear += ovSurprise;
    F.energy = 6 + 1.5 * (famAvg - 1) - 0.5 * week.keepWorking - (week.calls > 0 && !week.family ? 1 : 0) - (sickWeek ? 4 : 0);
    F.guilt = 4 + 1.3 * (2 - week.family) + 0.4 * week.teamSkipped.length + 2 * week.familyMissed.length - 1.5 * week.familyMade.length + B.guilt;
    F.trust = 2 + 8 * share + B.trust;
    F.fear = 5 + 4 * (1 - (payRatio ?? herRatio)) + (sickWeek ? 3 : 0) + (month === BAD_MONTH ? 1 : 0) + B.fear - 2 * (share - 0.4);
    F.identity = Math.max(1, prev.identity + B.identity + (teamPaidMore ? Number(process.env.TEAMPAID ?? 0.3) : 0) + (week.actsOnTeam >= 3 ? Number(process.env.IDENT_ACTS ?? 0.3) : 0) - (herRatio < 0.75 && !sickWeek ? 0.7 : 0) - (week.ownDown >= 3 ? 0.5 : 0) - (week.calls > 200 && week.actsOnTeam === 0 ? 0.2 : 0));
    F.app = prev.app + (week.done >= 3 ? 0.4 : 0) + (week.familyMade.length ? 1 : 0) + (week.checkins.length ? 0.2 : 0) - (week.ownDown >= 3 ? 0.6 : 0) - (week.doneHidTeam >= 3 ? 0.3 : 0) - (week.targetBroke ? 1.5 : 0) - (week.keepWorking >= 2 ? 0.3 : 0);
    why.energy = sickWeek ? 'flu' : week.family >= 2 ? `${week.family} evenings home` : week.family === 0 ? 'no evenings home this week' : `${week.family} evening home`;
    why.guilt = week.familyMissed.length ? `missed ${week.familyMissed[0].split(' (')[0]}` : week.familyMade.length ? `made ${week.familyMade[0].split(',')[0]}` : ev(/quit/) || (week.teamSkipped.length >= 3 ? `walked past the team card ${week.teamSkipped.length}×` : `${week.family} evening(s) home`);
    why.trust = sickWeek ? `team wrote ${week.teamApps} apps while she was out` : ev(/quit|Ana’s first sale|steady|developed/) || `team ${Math.round(share * 100)}% of premium (4 wks)`;
    why.fear = payNote && !sickWeek ? `${payNote} (${Math.round(payRatio * 100)}% of her normal total)` : sickWeek ? 'zero sales of her own' : ovSurprise < 0 ? `override $${week.override} vs ~$${Math.round(ovExp)} expected` : ovSurprise > 0 ? `override $${week.override}, under ~$${Math.round(ovExp)}` : herRatio < 0.75 ? `her sales ${Math.round(herRatio * 100)}% of normal` : `her sales ${Math.round(herRatio * 100)}% of normal`;
    why.identity = ev(/Ana’s first sale|steady|developed|trainer card/) || (sickWeek ? 'team held while she was out' : ev(/quit/) || (herRatio < 0.75 ? 'own sales slipped: back to the phones' : week.ownDown >= 3 ? 'app: "your own calls are down"' : week.actsOnTeam >= 3 ? `${week.actsOnTeam} team check-ins` : 'her own calls all week'));
    why.app = week.targetBroke ? `"full day" jumped to ${system.plan?.daily?.dials} calls` : week.familyMade.length ? `Done got her to ${week.familyMade[0].split(',')[0]}` : week.ownDown >= 3 ? '"your calls are down" card' : week.doneHidTeam >= 3 ? 'Done hid the team card' : week.done >= 3 ? `Done showed ${week.done}×` : week.checkins.length ? 'check-in cleared a card' : 'no Done, no change';
    lastOverride = lastOverride === null ? week.override : 0.6 * lastOverride + 0.4 * week.override;
    for (const k of Object.keys(F)) F[k] = clamp(F[k]);
    week.F = { ...F };
  }
}
W.push(week);

// ── Output ──
const fmt$ = (n) => '$' + Math.round(n).toLocaleString('en-US');
console.log('wk | start | calls | apps(her) | team apps | team $ | E G T M I A | done/hid/keep | fam | top cards | events');
W.filter((w) => w.workdays).forEach((w, i) => {
  console.log([i + 1, w.start, w.calls, `${w.apps} ${fmt$(w.prem)}`, w.teamApps, fmt$(w.teamPrem), w.F ? Object.values(w.F).join(' ') : '-', `${w.done}/${w.doneHidTeam}/${w.keepWorking}`, w.family, [...new Set(w.cards)].join(' ; '), w.events.join(' | ')].join(' | '));
  console.log(`     why: ${JSON.stringify(w.why)} | skipped team: ${JSON.stringify(w.teamSkipped)} | checkins: ${w.checkins.join(',')} | ladder: ${JSON.stringify(w.ladder)} | override ${fmt$(w.override || 0)} own adv ${fmt$(w.ownAdv || 0)} | trainer: ${w.trainer} | ownDown ${w.ownDown} | weekendWaiting ${w.weekendWaiting} | nightLog ${w.nightLog}`);
});
console.log('\nMONEY by month (override = ENGINE expectedPayments on issued team policies; clawback = MODEL lapses):');
for (const [m, x] of Object.entries(monthMoney)) console.log(`  ${m}: own advances ${fmt$(x.own || 0)} · override expected ${fmt$(x.override || 0)} · clawbacks ${fmt$(x.clawback || 0)} · override net ${fmt$((x.override || 0) - (x.clawback || 0))}`);
console.log('archived:', JSON.stringify(archived));

const ws = W.filter((w) => w.workdays);
const doneDays = ws.reduce((a, w) => a + w.done, 0), hid = ws.reduce((a, w) => a + w.doneHidTeam, 0), acts = ws.reduce((a, w) => a + w.actsOnTeam, 0), skipped = ws.reduce((a, w) => a + w.teamSkipped.length, 0);
const reasons = {}; ws.forEach((w) => w.teamSkipped.forEach((r) => { const k = r.replace(/\(.*\)/, '').trim(); reasons[k] = (reasons[k] || 0) + 1; }));
const last4 = ws.slice(-4), first4 = ws.slice(0, 4);
const sh = (xs) => Math.round(100 * xs.reduce((a, w) => a + w.teamPrem, 0) / xs.reduce((a, w) => a + w.teamPrem + w.prem, 0));
console.log('SUMMARY ' + JSON.stringify({ doneDays, doneHidTeam: hid, teamActions: acts, teamSkipped: skipped, skipReasons: reasons, famPerWeekFirst4: first4.reduce((a, w) => a + w.family, 0) / 4, famPerWeekLast4: last4.reduce((a, w) => a + w.family, 0) / 4, teamShareFirst4: sh(first4), teamShareLast4: sh(last4), callsFirst4: Math.round(first4.reduce((a, w) => a + w.calls, 0) / 4), callsLast4: Math.round(last4.reduce((a, w) => a + w.calls, 0) / 4), identityEnd: ws.at(-1).F.identity, ladderEnd: ws.at(-1).ladder, famMade: ws.flatMap((w) => w.familyMade), famMissed: ws.flatMap((w) => w.familyMissed), keepWorking: ws.reduce((a, w) => a + w.keepWorking, 0), ownDownDays: ws.reduce((a, w) => a + w.ownDown, 0) }));
if (process.argv[4] && process.argv[4] !== '-') { const fs = await import('fs'); fs.writeFileSync(process.argv[4], JSON.stringify({ weeks: W.filter((w) => w.workdays), money: monthMoney, archived })); }
