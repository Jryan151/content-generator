// test/fixtures/crash-child.mjs — one run of the app for the crash tests (test/v15-crash.test.js).
// The test starts this as its own process, with CRASH_AT set to kill it (SIGKILL) at one step, then
// starts it again without, as if the server came back after a power cut, and checks what's left.
//   CRASH_TASK=ig     Instagram posting ticks (CRASH_TICKS of them, default 4: each step is one tick)
//   CRASH_TASK=fb     Facebook posting ticks
//   CRASH_TASK=line   start the server's video line and run until the job JOB_ID is finished
const task = process.env.CRASH_TASK;
const ticks = Number(process.env.CRASH_TICKS) || 4;
if (task === 'ig') { const ig = await import('../../lib/instagram.js'); for (let i = 0; i < ticks; i++) await ig.tick(); }
else if (task === 'fb') { const fb = await import('../../lib/facebook.js'); for (let i = 0; i < ticks; i++) await fb.tick(); }
else if (task === 'line') {
  const S = await import('../../server.js');
  const queue = await import('../../lib/queue.js');
  const server = await S.start({ port: 0, scheduler: false, worker: true });
  const t0 = Date.now();
  for (;;) {
    const j = queue.getJob(process.env.JOB_ID);
    if (!j || ['done', 'failed', 'canceled'].includes(j.status)) break;
    if (Date.now() - t0 > 240000) { console.error('timed out'); process.exit(3); }
    await new Promise(r => setTimeout(r, 100));
  }
  server.close();
} else { console.error('Unknown CRASH_TASK'); process.exit(2); }
process.exit(0);
