// Compares the weekly roll-up from SQL (CSV: bucket,dials,apps,premium) with
// the JavaScript roll-up on the same sample. Any difference = one of them is wrong.
import { readFileSync } from 'node:fs';
import { rollup } from '../../src/timeframes.js';
import { buildActivities, TZ } from '../../seed/sample.js';

const sql = readFileSync(process.argv[2], 'utf8').trim().split('\n').map((line) => {
  const [bucket, dials, apps, premium] = line.split(',');
  return { key: `W:${bucket}`, dials: +dials, appsWritten: +apps, premiumWritten: +premium };
});
const js = rollup(buildActivities(), { tf: '1W', tz: TZ }).map((r) => ({
  key: r.key, dials: r.totals.dials, appsWritten: r.totals.appsWritten, premiumWritten: r.totals.premiumWritten,
}));

const problems = [];
if (sql.length !== js.length) problems.push(`week count: sql ${sql.length} vs js ${js.length}`);
for (const j of js) {
  const s = sql.find((x) => x.key === j.key);
  if (!s) { problems.push(`missing in sql: ${j.key}`); continue; }
  for (const m of ['dials', 'appsWritten', 'premiumWritten']) {
    if (s[m] !== j[m]) problems.push(`${j.key} ${m}: sql ${s[m]} vs js ${j[m]}`);
  }
}
if (problems.length) {
  console.error('SQL and JS roll-ups disagree:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`SQL and JS roll-ups match across ${js.length} weeks`);
