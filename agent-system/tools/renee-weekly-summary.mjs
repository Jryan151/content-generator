// Compare runs of tools/renee-weekly.mjs on two copies of the engine.
//   for k in 1..9: node tools/renee-weekly.mjs $k 250000 out/old-$k.json <old repo> old
//                  node tools/renee-weekly.mjs $k 250000 out/new-$k.json "$PWD" new
//   node tools/renee-weekly-summary.mjs out
// Engine outputs are real; Renee's feelings and choices are modeled (see the top of renee-weekly.mjs).
import fs from 'fs';
const dir = process.argv[2];
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sum = (W, f) => W.reduce((a, w) => a + f(w), 0);
function metrics(W) {
  const last8 = W.slice(-8), her = sum(last8, (w) => w.prem), team = sum(last8, (w) => w.teamPrem);
  return {
    'team check-ins': sum(W, (w) => w.actsOnTeam), 'walked past team card': sum(W, (w) => w.teamSkipped.length),
    'Done hid team card': sum(W, (w) => w.doneHidTeam), '"calls are down" days': sum(W, (w) => w.ownDown), 'Done shown': sum(W, (w) => w.done),
    'family evenings/week, last 8 wks': sum(last8, (w) => w.family) / 8, 'family events missed': sum(W, (w) => w.familyMissed.length),
    'team share of premium, last 8 wks': team / (her + team), 'her premium, 6 months': sum(W, (w) => w.prem),
    'money fear, last 8 wks (model)': mean(last8.map((w) => w.F.fear)), 'energy, last 8 wks (model)': mean(last8.map((w) => w.F.energy)),
    'guilt, last 8 wks (model)': mean(last8.map((w) => w.F.guilt)), 'identity at end (model)': W.at(-1).F.identity,
  };
}
const runs = (v) => fs.readdirSync(dir).filter((f) => f.startsWith(`${v}-`)).map((f) => metrics(JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')).weeks));
const old = runs('old'), neu = runs('new');
const fmt = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(2));
for (const k of Object.keys(old[0] || neu[0])) {
  const cell = (rs) => (rs.length ? `${fmt(median(rs.map((r) => r[k])))} (${fmt(Math.min(...rs.map((r) => r[k])))}–${fmt(Math.max(...rs.map((r) => r[k])))})` : '—');
  console.log(`${k.padEnd(36)} old ${cell(old).padEnd(26)} new ${cell(neu)}`);
}
