// lib/proc.js — every outside program (FFmpeg, ffprobe, tar) runs through here, on a leash:
//   - a time limit: a polite stop (SIGTERM), then a hard stop (SIGKILL) a few seconds later;
//   - capped output, so a chatty program can't fill memory;
//   - the off switch of the job it belongs to: when the queue's watchdog stops a stuck job, every
//     program that job started is stopped too.
//
// The job a piece of work belongs to travels with it (AsyncLocalStorage), so nothing in between has to
// pass it along: lib/queue.js runs each job inside jobContext.run({ signal, progress }), and anything
// that job starts here, or fetches with jobSignal(), stops when it's stopped.
import { spawn } from 'child_process';
import { AsyncLocalStorage } from 'async_hooks';
import { service as flightService } from './flight.js';

export const jobContext = new AsyncLocalStorage();
export const currentJob = () => jobContext.getStore() || null;
export const currentSignal = () => jobContext.getStore()?.signal || null;
// Notes that the current job is still doing something (the watchdog's "still alive" sign).
export const progress = () => { try { jobContext.getStore()?.progress?.(); } catch { /* never let a note break the work */ } };

const GRACE_MS = () => Math.max(50, Number(process.env.PROC_GRACE_MS) || 5000);
const running = new Set();
export const runningCount = () => running.size;
// Stops every program still running (on shutdown). Returns how many were stopped.
export function stopAll() {
  let n = 0;
  for (const p of running) { try { p.kill('SIGKILL'); n++; } catch { /* already gone */ } }
  return n;
}

// The error for work stopped by its job's off switch. `stuck`/`reason` come from the signal's reason.
export function stoppedError(signal) {
  const r = signal?.reason;
  if (r instanceof Error) return r;
  return Object.assign(new Error(typeof r === 'string' && r ? r : 'The job was stopped.'), { code: 'aborted', aborted: true });
}
// Throws if the current job has been stopped: called before anything is saved, so work that carried on
// after the watchdog gave up on it can never write a second copy of a video.
export function checkStopped() {
  const s = currentSignal();
  if (s?.aborted) throw stoppedError(s);
}

// A signal for a fetch: its own time limit, plus the current job's off switch (if any).
export function jobSignal(timeoutMs) {
  const t = AbortSignal.timeout(timeoutMs), s = currentSignal();
  return s ? AbortSignal.any([t, s]) : t;
}

const nameOf = bin => String(bin).split('/').pop() || 'A program';
const secs = ms => (ms >= 60000 ? `${Math.round(ms / 60000)} minute${Math.round(ms / 60000) === 1 ? '' : 's'}` : `${Math.round(ms / 1000)} seconds`);

// Runs a program. Resolves { code, stdout, stderr } whatever the exit code (callers decide what a
// failure means); rejects only when it couldn't start, ran out of time, or its job was stopped.
//   timeoutMs   the time limit (default 2 minutes)
//   maxOutput   bytes of stdout kept (the start) and of stderr kept (the end), each
//   binary      stdout as a Buffer instead of text
//   signal      an off switch (default: the current job's)
//   onData      stdout handed over as it comes (a Buffer per chunk) and not kept: for frames read one
//               at a time, however long the video
export function runProc(bin, args, { timeoutMs = 120000, maxOutput = 256 * 1024, binary = false, signal = currentSignal(), onData = null } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(stoppedError(signal));
    let p;
    try { p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return reject(e); }
    running.add(p);
    const t0 = Date.now();
    const out = []; let outLen = 0, err = '', why = '', hard = null, readerError = null;
    const stop = reason => {
      if (why) return;
      why = reason;
      try { p.kill('SIGTERM'); } catch { /* gone */ }
      hard = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* gone */ } }, GRACE_MS());
      hard.unref?.();
    };
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    timer.unref?.();
    const onAbort = () => stop('aborted');
    signal?.addEventListener('abort', onAbort, { once: true });
    p.stdout.on('data', d => { if (onData) { if (!readerError) try { onData(d); } catch (e) { readerError = e; stop('reader'); } } else if (outLen < maxOutput) { out.push(d); outLen += d.length; } progress(); });
    p.stderr.on('data', d => { err += d; if (err.length > maxOutput * 2) err = err.slice(-maxOutput); progress(); });
    const done = () => { clearTimeout(timer); clearTimeout(hard); running.delete(p); signal?.removeEventListener('abort', onAbort); };
    p.on('error', e => { done(); reject(e); });
    p.on('close', (code, sig) => {
      done();
      flightService(nameOf(bin), { ms: Date.now() - t0, ok: code === 0 && !why });   // the job's flight recorder
      if (err.length > maxOutput) err = err.slice(-maxOutput);
      if (why === 'timeout') return reject(Object.assign(new Error(`${nameOf(bin)} took longer than ${secs(timeoutMs)} and was stopped.`), { code: 'timeout', timedOut: true, stderr: err }));
      if (why === 'aborted') return reject(stoppedError(signal));
      if (readerError) return reject(readerError);
      const buf = Buffer.concat(out).subarray(0, maxOutput);
      resolve({ code, signal: sig, stdout: binary ? buf : buf.toString('utf8'), stderr: err });
    });
  });
}

// The last few meaningful lines of a program's error output, for a message.
export const tail = (text, lines = 6) => String(text || '').split('\n').map(l => l.trim()).filter(Boolean).slice(-lines).join(' ');
