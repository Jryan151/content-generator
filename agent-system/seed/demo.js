// npm run demo — shows the zoom-in loop on the sample month.
import { whereItBroke, compareToPrevious, childKeys, totalsFor } from '../src/timeframes.js';
import { buildActivities, TZ, TEAM_IDS, PEOPLE } from './sample.js';

const acts = buildActivities();
const name = (id) => PEOPLE.find((p) => p.id === id)?.name ?? id;
const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

const cmp = compareToPrevious(acts, { tf: '1M', key: '2026-10', tz: TZ, agentIds: TEAM_IDS });
console.log(`\nOctober vs September (team)`);
console.log(`  Premium written  ${usd(cmp.current.premiumWritten)}  vs  ${usd(cmp.previous.premiumWritten)}`);
console.log(`  Applications     ${cmp.current.appsWritten}  vs  ${cmp.previous.appsWritten}`);
console.log(`  Dials            ${cmp.current.dials}  vs  ${cmp.previous.dials}`);

console.log(`\nOctober by week (premium written)`);
for (const k of childKeys('2026-10', '1M')) {
  const t = totalsFor(acts, { tf: '1W', key: k, tz: TZ, agentIds: TEAM_IDS, within: { key: '2026-10', tf: '1M' } });
  console.log(`  week of ${k.slice(2)}  ${usd(t.premiumWritten).padStart(7)}   dials ${t.dials}`);
}

const r = whereItBroke(acts, { tf: '1M', key: '2026-10', tz: TZ, agentIds: TEAM_IDS });
console.log(`\nWhere it broke`);
r.trail.forEach((step, i) => console.log(`  ${i + 1}. ${step.note.replace(step.agent_id ?? '\u0000', name(step.agent_id))}`));
console.log(r.agent
  ? `\n→ Fix the agent, not the month: check in with ${name(r.agent.agent_id)}\n`
  : `\n→ Nobody stands out; the whole team slowed down.\n`);

// ── What to do: plan flows down, then today's list ──
import('../src/routines.js').then(({ planDown, ratesFrom, todoFor }) => {
  const rates = ratesFrom(acts, { agentIds: TEAM_IDS });
  const plan = planDown({ yearlyPremium: 96_000, rates });
  console.log(`What to do — a $96,000 yearly goal, using the team's real rates`);
  console.log(`  Month: ${usd(plan.monthly.premium)} → ${plan.monthly.apps} apps → ${plan.monthly.appts} appointments → ${plan.monthly.dials} dials`);
  console.log(`  Week:  ${plan.weekly.appts} appointments`);
  console.log(`  Day:   ${plan.daily.dials} dials, ${plan.daily.conversations} conversations, optional post`);
  console.log(`\nAgent's list for Monday, Oct 26`);
  for (const t of todoFor('2026-10-26', { role: 'agent', plan })) {
    console.log(`  ${t.at}  [${t.tf.padEnd(5)}] ${t.title}`);
  }
  console.log('');
});

// ── The two paths: same team, same moment, different instructions (Director is parked) ──
Promise.all([import('../src/paths.js'), import('../src/routines.js')]).then(([P, R]) => {
  const team = [
    { id: PEOPLE[1].id, name: 'Devon', startedOn: '2026-05-01', coach: 'Devon' },
    { id: PEOPLE[2].id, name: 'Tasha', startedOn: '2026-07-15', coach: 'Devon' },
    { id: PEOPLE[3].id, name: 'Marcus', startedOn: '2026-10-05', coach: 'Devon' },
  ];
  const plan = R.planDown({ yearlyPremium: 96_000 });
  for (const path of ['producer', 'coach']) {
    const meta = P.PATHS[path];
    console.log(`${meta.name.toUpperCase()} — "${meta.motto}"  ${meta.goal}`);
    for (const t of R.todoFor('2026-10-14', { role: 'builder', path, plan })) {
      console.log(`  ${t.at}  ${t.title}`);
    }
    const acts2 = path === 'producer' ? acts.filter((a) => a.agent_id !== PEOPLE[0].id) : acts;
    const out = P.actionsFor({ path, dayKey: '2026-10-14', now: '12:05', selfId: PEOPLE[0].id, team, plan, activities: acts2, tz: TZ });
    console.log(`  At 12:05 the system says:`);
    if (!out.length) console.log('    (nothing — you are on track)');
    for (const a of out) console.log(`    → ${a.text}`);
    console.log('');
  }
});

// ── Career stages: placed by what people have done, not what they want ──
import('../src/career.js').then(({ placeOnLadder }) => {
  const team = [
    { id: PEOPLE[1].id, name: 'Devon', startedOn: '2026-05-01', coaches: true },
    { id: PEOPLE[2].id, name: 'Tasha', startedOn: '2026-07-15' },
    { id: PEOPLE[3].id, name: 'Marcus', startedOn: '2026-09-01' },
  ];
  const newbie = { id: 'new-agent', name: 'New agent' };
  const people = [
    { person: newbie, team: [], acts: [{ agent_id: 'new-agent', type: 'dial', occurred_at: '2026-10-30T17:00:00Z' }] },
    { person: { id: PEOPLE[3].id, name: 'Marcus' }, team: [], acts },
    { person: { id: PEOPLE[0].id, name: 'Morgan' }, team, acts },
  ];
  console.log('Where each person actually is (Nov 2)');
  for (const { person, team: t, acts: a } of people) {
    const r = placeOnLadder({ person, team: t, activities: a, dayKey: '2026-11-02', tz: TZ });
    console.log(`  ${person.name.padEnd(10)} ${r.name.padEnd(9)} focus: ${r.focus}`);
    console.log(`  ${''.padEnd(10)} ${''.padEnd(9)} next:  ${r.nextAction}`);
  }
  console.log('');
});
