// Usage: for i in 1..9: node tools/renee-six-months.mjs "$PWD" $i new > out/res-new-$i.json (and an older copy with "old"),
// then: node tools/renee-summary.mjs out
import fs from 'fs';
const dir = process.argv[2];
for (const v of ['old', 'new']) {
  const runs = fs.readdirSync(dir).filter((f) => f.startsWith(`res-${v}-`)).map((f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')));
  const rng = (xs) => `${Math.min(...xs)}–${Math.max(...xs)}`;
  const col = (k, i) => runs.map((r) => r.summary[k][i]);
  const last = (r) => r.ladder[Object.keys(r.ladder).at(-1)];
  const first = (r) => r.ladder[Object.keys(r.ladder)[0]];
  console.log(`\n== ${v.toUpperCase()} (${runs.length} runs)`);
  console.log('Opens Team, Nov → Apr (% of workdays):', `${rng(col('opened', 0))} → ${rng(col('opened', 5))}`);
  console.log('Longest stuck top card (workdays):', rng(runs.map((r) => r.stuckMax)), '| days stuck > 3:', rng(runs.map((r) => r.stuckDays)));
  console.log('Noon false alarms on the night logger:', rng(runs.map((r) => r.noonFalseAlarms)));
  console.log('Priya flagged:', runs.filter((r) => r.priyaFlaggedOn).length, '/', runs.length, '| Priya quit:', runs.filter((r) => r.priyaQuit).length);
  console.log('History rows deleted by "Take off team":', rng(runs.map((r) => r.deletedRows)), '| removals:', runs.map((r) => r.removed.map((x) => x[0]).join('+') || '-').join(', '));
  console.log('Her calls/day Nov → Apr:', `${rng(col('callsPerDay', 0))} → ${rng(col('callsPerDay', 5))}`);
  console.log('"Done" shown (workdays of ~130):', rng(runs.map((r) => r.doneDays)));
  console.log('Family evenings/week (modeled), Apr:', rng(col('familyPerWeek', 5)), '| avg over 6 months:', rng(runs.map((r) => Math.round(r.summary.familyPerWeek.reduce((a, b) => a + b, 0) / 6 * 10) / 10)));
  console.log('Ladder month 1 → month 6:', runs.map((r) => `${first(r).stage}→${last(r).stage}`).join(', '));
  if (v === 'new') console.log('Developed to Producer, month 1 → 6:', runs.map((r) => `${first(r).developed}→${last(r).developed}`).join(', '));
  const tests = runs.map((r) => {
    const L = last(r);
    return { teamOver: L.teamPrem > L.herPrem, recruitProducer: L.anaStage === 'producer', heldOwn: r.summary.callsPerDay[5] >= 0.8 * r.summary.callsPerDay[0], family2: r.summary.familyPerWeek[5] >= 2 };
  });
  for (const k of ['teamOver', 'recruitProducer', 'heldOwn', 'family2']) console.log(`  ${k}: ${tests.filter((t) => t[k]).length}/${runs.length}`);
  console.log('  all four:', tests.filter((t) => t.teamOver && t.recruitProducer && t.heldOwn && t.family2).length, '/', runs.length);
}
