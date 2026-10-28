// worker.js — makes videos in a process of its own, apart from the website (optional; SETUP.md section AL).
//   pm2 start worker.js --name generator-worker      (and WORKER_MODE=separate in .env, then restart the site)
// The website then only puts videos in line; this process (or several, on this server or others that
// share the database) takes them one at a time on a lease. A crash here never takes the website down,
// and a worker that dies loses its lease: its video goes back in line by itself.
// Needs the SQLite storage engine, so the website and workers never overwrite each other's changes.
import { storageEngine } from './lib/paths.js';

if (storageEngine() !== 'sqlite') {
  console.error('worker.js needs the SQLite storage engine (the website and the worker share the line safely only there).\nSwitch first: pm2 stop generator && node admin.js storage migrate && pm2 start generator (SETUP.md section T).');
  process.exit(1);
}
const { startWorkerProcess, shutdown, VERSION } = await import('./server.js');
startWorkerProcess();
setInterval(() => {}, 60000);   // the line's own timers don't keep a process alive; this one does
console.log(`Agent Reels ${VERSION} worker: making videos (process ${process.pid}).`);
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { shutdown(); process.exit(0); });
