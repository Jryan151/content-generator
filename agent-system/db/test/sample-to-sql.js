// Prints SQL that loads the sample team and month of activity (seed/sample.js).
import { PEOPLE, buildActivities } from '../../seed/sample.js';

const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const lines = [];
lines.push('insert into auth.users (id) values');
lines.push(PEOPLE.map((p) => `  (${q(p.id)})`).join(',\n') + ';');
lines.push('insert into profiles (id, full_name, role, upline_id) values');
lines.push(PEOPLE.map((p) => `  (${q(p.id)}, ${q(p.name)}, ${q(p.role)}, ${q(p.upline)})`).join(',\n') + ';');
const acts = buildActivities();
for (let i = 0; i < acts.length; i += 500) {
  const chunk = acts.slice(i, i + 500);
  lines.push('insert into activities (agent_id, type, value, occurred_at) values');
  lines.push(chunk.map((a) => `  (${q(a.agent_id)}, ${q(a.type)}, ${a.value ?? 'null'}, ${q(a.occurred_at)})`).join(',\n') + ';');
}
process.stdout.write(lines.join('\n') + '\n');
