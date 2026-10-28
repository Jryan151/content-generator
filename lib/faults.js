// lib/faults.js — the test rig's hooks into the engine (the dyno's sensors and switches).
//
// Two kinds, both dead unless the checks turn them on (NODE_ENV=test, or FAULTS_ALLOWED=1 for a rehearsal
// on a spare server). On a real server they do nothing and cost nothing.
//
//   crashPoint(name)  CRASH_AT=<name>: the process is killed right there (SIGKILL, like pulling the
//                     plug: no clean shutdown, nothing saved). The crash tests restart it and check that
//                     nothing was lost or done twice.
//   fault(name)       FAULTS=<name>[,<name>…]: a fault is injected there (ENOSPC on the next save of a
//                     file, say). `name` may end in :<n> (only the nth time) or :<file part>.
//
// Every crash point is listed in CRASH_POINTS, so the crash tests can check they cover every one.
export const CRASH_POINTS = {
  'make:script': 'after the script is written and saved',
  'make:media': 'after the voice and footage are saved',
  'make:render': 'after the render, before the video is saved',
  'make:saved': 'after the video record is saved, before its saved stages are cleared',
  'fix:render': 'after a scene fix is rendered, before it replaces the video',
  'ig:container': 'after Instagram made the post container, before it was saved',
  'ig:publishing': 'after "publishing" was saved, before Instagram was asked to publish',
  'ig:published': 'after Instagram published it, before "posted" was saved',
  'fb:started': 'after Facebook started the upload, before it was saved',
  'fb:published': 'after Facebook was asked to publish, before it was saved',
};
const allowed = () => process.env.NODE_ENV === 'test' || process.env.FAULTS_ALLOWED === '1';

export function crashPoint(name) {
  if (!allowed() || process.env.CRASH_AT !== name) return;
  // Pulled plug: no handlers run, no buffered writes are flushed by us.
  try { process.stderr.write(`[crash] ${name}\n`); } catch { /* none */ }
  process.kill(process.pid, 'SIGKILL');
}

const counts = new Map();
// Is this fault switched on here? `where`: a detail it can be narrowed to (a file name).
export function fault(name, where = '') {
  if (!allowed() || !process.env.FAULTS) return false;
  const n = (counts.get(name) || 0) + 1;
  counts.set(name, n);
  for (const f of String(process.env.FAULTS).split(',').map(x => x.trim()).filter(Boolean)) {
    const [base, arg = ''] = f.split(/:(.*)/s);
    if (base !== name) continue;
    if (!arg) return true;
    if (/^\d+$/.test(arg)) { if (Number(arg) === n) return true; continue; }
    if (String(where).includes(arg)) return true;
  }
  return false;
}
export const _resetFaults = () => counts.clear();
