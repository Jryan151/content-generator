// generate.js — make a video or a test script from the terminal.
//   node generate.js                      one video for the only workspace
//   node generate.js --ws <workspaceId>   pick the workspace (see: node admin.js list)
//   node generate.js --script             only write and check a script (no video, cheap)
// The portal's queue is the normal way to make videos; this is for testing.
import * as store from './lib/store.js';
import { meter } from './lib/usage.js';

const args = process.argv.slice(2);
const scriptOnly = args.includes('--script');
const wsArg = args.includes('--ws') ? args[args.indexOf('--ws') + 1] : null;

try {
  store.migrateLegacy();
  const all = store.listWorkspaces();
  const ws = wsArg ? store.getWorkspace(wsArg) : all.length === 1 ? all[0] : null;
  if (!ws) throw new Error(all.length ? 'Pick a workspace with --ws <id>. Run: node admin.js list' : 'No workspaces yet. Invite an agent first: node admin.js invite …');
  if (scriptOnly) {
    const { generateScript } = await import('./stages/script.js');
    const m = meter(ws.id);
    const r = await generateScript({ cfg: store.loadConfig(ws.id), recent: store.readRecent(ws.id), meter: m });
    console.log('\nAudience:', r.meta.audience, '\nInsight:', r.meta.insight, '\n');
    r.scenes.forEach((s, i) => console.log(`${i + 1}. ${s.say ? s.say + '\n   on screen: ' : ''}${s.text}${s.accent ? `  (accent: ${s.accent})` : ''}   [${s.keyword}]`));
    if (r.post) console.log('\nInstagram post:\n' + r.post);
    console.log(`\nAI cost about $${m.total.toFixed(3)}`);
  } else {
    const { makeVideo } = await import('./pipeline.js');
    const rec = await makeVideo({ ws: ws.id, source: 'terminal' });
    console.log(`\nDone: ${rec.file}. Review it in the portal.`);
  }
} catch (e) {
  console.error('\nFailed:', e.message || e);
  process.exit(1);
}
