// Six months of "Renee" (Nov 2, 2026 – Apr 30, 2027) against one copy of the engine.
//   node six-months.mjs <repo> <seed> <old|new>
// Engine outputs are real. Renee's and her agents' reactions are modeled rules (stated below),
// the same for both copies, so the difference between runs comes from the engine.
const [repo, seedArg, mode] = process.argv.slice(2);
const isNew = mode === 'new';
const A = await import(`${repo}/src/attention.js`);
const C = await import(`${repo}/src/career.js`);
const K = await import(`${repo}/src/calls.js`);

let s = Number(seedArg) >>> 0;
const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const TZ = 'America/Phoenix';
const iso = (d, hm) => new Date(`${d}T${hm}:00-07:00`).toISOString();
const add = (k, n) => { const d = new Date(`${k}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const workday = (k) => ![0, 6].includes(new Date(`${k}T00:00:00Z`).getUTCDay());

const ME = 'renee';
const people = {
  keisha: { name: 'Keisha', startedOn: '2026-06-01', calls: () => between(35, 45), sale: 0.3, hm: '10:00' },
  jordan: { name: 'Jordan', startedOn: '2026-07-01', calls: () => between(10, 35), sale: 0.06, show: 0.3, hm: '10:00' },
  priya: { name: 'Priya', startedOn: '2026-10-19', calls: () => between(0, 3), sale: 0.01, hm: '11:00', quitAfterLowWeeks: 7 },
  dante: { name: 'Dante', startedOn: '2026-07-01', calls: () => between(30, 40), sale: 0.15, hm: '21:00' },
  troy: { name: 'Troy', startedOn: '2026-06-01', calls: () => between(25, 35), sale: 0.12, hm: '10:00', silentFrom: '2026-11-04' },
  ana: { name: 'Ana', startedOn: '2026-10-05', licensed: false, studying: true, examOn: null, passOn: '2026-11-25', hm: '18:00' },
  ben: { name: 'Ben', startedOn: '2026-10-05', licensed: false, studying: true, stalled: true, hm: '19:00' },
};
const rows = Object.fromEntries([ME, ...Object.keys(people)].map((id) => [id, []]));
const log = (id, d, hm, type, n = 1, extra = {}) => { for (let i = 0; i < n; i++) rows[id].push({ agent_id: id, type, occurred_at: iso(d, hm), ...extra }); };
const off = new Set();          // taken off the team
let deletedRows = 0;            // history lost by "Take off team"
const out = { stuckMax: 0, stuckDays: 0, noonFalseAlarms: 0, priyaFlaggedOn: null, priyaQuit: false, openedByMonth: {}, callsByMonth: {}, doneDays: 0, familyByMonth: {}, workdaysByMonth: {}, ladder: {}, checkins: 0, removed: [] };

let streak = 0, prevTop = null, falseRecent = [], lowWeeks = 0, priyaCoached = false, troyCheckins = 0, benNudged = false;
const START = '2026-11-02', END = '2027-04-30';
for (let d = START; d <= END; d = add(d, 1)) {
  if (!workday(d)) continue;
  const month = d.slice(0, 7);
  out.workdaysByMonth[month] = (out.workdaysByMonth[month] || 0) + 1;

  // ── The team's day (modeled) ──
  for (const [id, p] of Object.entries(people)) {
    if (off.has(id) || p.quit) continue;
    if (p.silentFrom && d >= p.silentFrom) continue;
    if (p.studying) {
      log(id, d, p.hm, 'study_session', 1, { value: 30 });
      if (rnd() < 0.3) log(id, d, p.hm, 'practice_test', 1, { value: p.stalled ? between(58, 66) : between(68, 82) });
      if (id === 'ana' && !p.examOn && d >= '2026-11-10') { p.examOn = '2026-11-24'; if (isNew) log(id, d, p.hm, 'exam_booked', 1, { meta: { exam_on: p.examOn } }); }
      if (id === 'ben' && benNudged && !p.examOn && rnd() < 0.2) { p.examOn = add(d, 14); if (isNew) log(id, d, p.hm, 'exam_booked', 1, { meta: { exam_on: p.examOn } }); p.passOn = add(d, 15); }
      if (p.passOn && d >= p.passOn) {
        log(id, d, p.hm, 'license_passed'); p.studying = false; p.licensed = true; p.licensedOn = d;
        // A new agent: slow at first, then steadier every week (Ana is the one Renee can develop).
        p.calls = () => between(15, 30); p.hm = '10:00'; p.sale = 0.03;
      }
      continue;
    }
    if (p.licensedOn) p.sale = Math.min(0.3, 0.03 + 0.004 * Math.floor((Date.parse(d) - Date.parse(p.licensedOn)) / 86_400_000));
    let n = p.calls();
    if (id === 'priya' && priyaCoached) n = between(15, 25);
    log(id, d, p.hm, 'dial', n);
    log(id, d, p.hm, 'conversation', Math.round(n * 0.25));
    if (p.show !== undefined) { log(id, d, p.hm, 'appt_set', 1, { meta: { meeting_on: d } }); if (rnd() < p.show) log(id, d, p.hm, 'appt_held'); }
    if (rnd() < p.sale) { log(id, d, p.hm, 'app_written', 1, { value: between(500, 900) }); if (rnd() < 0.08) log(id, add(d, 1), p.hm, 'chargeback', 1, { value: 600 }); }
  }
  // Priya quits after weeks of almost nothing, unless someone noticed and helped.
  if (!people.priya.quit && !off.has('priya') && !priyaCoached && new Date(`${d}T00:00:00Z`).getUTCDay() === 5) {
    if (++lowWeeks >= people.priya.quitAfterLowWeeks) { people.priya.quit = true; out.priyaQuit = true; }
  }

  // ── Renee opens Team around 1 PM (modeled: less likely after a stuck card or false alarms) ──
  const members = Object.entries(people).filter(([id]) => !off.has(id)).map(([id, p]) => ({ id, name: p.name, startedOn: p.startedOn, licensed: p.licensed ?? true, activities: rows[id].filter((r) => r.occurred_at <= iso(d, '13:00')) }));
  let sum = A.teamSummary({ members, dayKey: d, now: '13:00', tz: TZ, plan: null });
  if (isNew) sum = A.applyCheckins(sum, rows[ME], { dayKey: d, tz: TZ });
  const top = sum.top;
  streak = top && top.id === prevTop ? streak + 1 : top ? 1 : 0; prevTop = top?.id ?? null;
  out.stuckMax = Math.max(out.stuckMax, streak); if (streak > 3) out.stuckDays++;
  const falseToday = sum.people.filter((p) => p.id === 'dante' && /No calls yet today/.test(p.reason)).length;
  out.noonFalseAlarms += falseToday;
  falseRecent = [...falseRecent, falseToday].slice(-5);
  if (!out.priyaFlaggedOn && sum.people.some((p) => p.id === 'priya' && p.level !== 'ok' && /calls in 2 weeks/.test(p.reason))) out.priyaFlaggedOn = d;
  const openP = Math.max(0.1, 0.95 - 0.06 * Math.max(0, streak - 3) - 0.1 * falseRecent.reduce((x, y) => x + y, 0));
  const opened = rnd() < openP;
  out.openedByMonth[month] = (out.openedByMonth[month] || 0) + (opened ? 1 : 0);
  let load = 0;
  // Production first, new copy only: when her own calls are down, she skips team firefighting that day.
  const own = isNew ? A.ownProduction(rows[ME], { me: ME, dayKey: d, tz: TZ }) : { down: false };
  if (opened && top && !own.down) {
    load = top.level === 'urgent' ? 2 : 1;
    if (isNew) { log(ME, d, '13:05', 'checkin', 1, { meta: { person_id: top.id } }); out.checkins++; }
    if (top.id === 'priya') priyaCoached = true;
    if (top.id === 'ben') benNudged = true;
    if (top.id === 'troy') {
      troyCheckins++;
      // New: after two check-ins with no change she takes him off (archived). Old: she removes whoever is stuck 8+ days.
      if (isNew && troyCheckins >= 2) { off.add('troy'); out.removed.push(['troy', d, 'archived']); }
    }
    if (!isNew && streak >= 8 && top.level === 'urgent') { off.add(top.id); deletedRows += rows[top.id].length; out.removed.push([top.id, d, `deleted ${rows[top.id].length} rows`]); }
  }

  // ── Her own calls (modeled) ──
  const capacity = Math.max(20, between(40, 48) - 6 * load);
  const goal = isNew ? 40 : null;               // her own full day, set once on Today
  const calls = goal && capacity >= goal ? goal : capacity;
  const done = !!goal && calls >= goal;
  if (done) out.doneDays++;
  const nightLog = rnd() < 0.2;
  log(ME, d, nightLog ? '21:00' : '10:00', 'dial', calls);
  log(ME, d, nightLog ? '21:00' : '10:00', 'conversation', Math.round(calls * 0.25));
  if (rnd() < 0.35) log(ME, d, '15:00', 'app_written', 1, { value: between(500, 900) });
  out.callsByMonth[month] = (out.callsByMonth[month] || 0) + calls;
  // A family evening: likely when the app tells her she's done, rare when nothing ever does.
  if (rnd() < (done ? 0.6 : 0.12)) out.familyByMonth[month] = (out.familyByMonth[month] || 0) + 1;

  // ── Month end: where the ladder puts her, with Director switched on to check it can't lie ──
  let nx = add(d, 1); while (!workday(nx)) nx = add(nx, 1);
  if (nx.slice(0, 7) !== month || d === END) {
    const endSum = A.teamSummary({ members: members.map((m) => ({ ...m, activities: rows[m.id] })), dayKey: d, now: '23:00', tz: TZ, plan: null });
    const L = C.placeOnLadder({ person: { id: ME, name: 'Renee' }, teamStages: endSum.stages, activities: rows[ME], dayKey: d, tz: TZ, playbookReady: true, topStage: 'upline' });
    const teamPrem = members.reduce((x, m) => x + m.activities.filter((a) => a.type === 'app_written' && a.occurred_at >= iso(add(d, -30), '00:00')).reduce((y, a) => y + a.value, 0), 0);
    const herPrem = rows[ME].filter((a) => a.type === 'app_written' && a.occurred_at >= iso(add(d, -30), '00:00')).reduce((y, a) => y + a.value, 0);
    out.ladder[month] = { stage: L.stage, developed: isNew ? endSum.builder?.developed?.now ?? null : null, anaStage: endSum.people.find((p) => p.id === 'ana')?.stage, teamPrem, herPrem };
  }
}
out.deletedRows = deletedRows;
const months = Object.keys(out.workdaysByMonth);
out.summary = {
  opened: months.map((m) => Math.round((100 * out.openedByMonth[m]) / out.workdaysByMonth[m])),
  callsPerDay: months.map((m) => Math.round(out.callsByMonth[m] / out.workdaysByMonth[m])),
  familyPerWeek: months.map((m) => Math.round(((out.familyByMonth[m] || 0) / out.workdaysByMonth[m]) * 5 * 10) / 10),
};
console.log(JSON.stringify(out));
