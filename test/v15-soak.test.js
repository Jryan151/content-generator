// v15 Phase 4: the five-year soak. Made-up data as if the app had run for five years: agents each with
// about four videos a week (approved, posted, rejected, with their scenes, clips and records), clients,
// alerts and a long line history. Then every screen an agent and an admin open, and every nightly job,
// is timed against a budget.
//   npm test:       8 agents (a quick version, same budgets per agent screen)
//   npm run test:full (or SOAK_AGENTS=50): 50 agents
// The budgets are generous on purpose (a slow test machine must not fail them); what they catch is a
// change that makes a screen or a nightly job grow badly with years of data.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { tempEnv, client } from './helpers.js';

tempEnv();
const AGENTS = Number(process.env.SOAK_AGENTS) || (process.env.FULL_TEST ? 50 : 8);
const YEARS = 5, PER_WEEK = 4;
const paths = await import('../lib/paths.js');
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const { starterStory } = await import('../templates.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });
test.after(() => server.close());
const port = server.address().port;

const DAY = 86400000, now = Date.now();
const iso = t => new Date(t).toISOString();
const pick = (arr, i) => arr[i % arr.length];
const PAINS = ['Funeral costs', 'Leaving debt behind', 'Covering the mortgage', 'Final wishes', 'Family peace of mind'];
function videoAt(i, t) {
  const status = i % 11 === 0 ? 'rejected' : i % 3 === 0 ? 'approved' : 'posted';
  const scenes = Array.from({ length: 6 }, (_, k) => ({ say: `Line ${k + 1} of video ${i}, said the way a person would say it.`, text: `Line ${k + 1} of video ${i}`, accent: 'video', keyword: pick(['older couple kitchen', 'family dinner', 'man on porch'], k) }));
  return {
    id: `v${String(i).padStart(6, '0')}`, status, createdAt: iso(t), updatedAt: iso(t + 3600000), file: `video_v${i}.mp4`, cover: `cover_v${i}.jpg`, mode: 'voiceover', duration: 28.4,
    fileDeleted: now - t > 90 * DAY, source: pick(['overnight', 'manual', 'plan'], i),
    meta: { painPoint: pick(PAINS, i), insightId: `ins${i % 9}`, format: pick(['myth', 'story', 'question'], i), principles: ['liking'], music: 'calm.mp3' },
    scenes, clips: scenes.map((_, k) => ({ id: 1000 + ((i * 7 + k) % 4000), query: 'family', checked: true, score: 4, reason: 'fits', vertical: true, alts: [] })),
    post: `Video ${i}: ${pick(PAINS, i)}. Plan ahead while you can. #lifeinsurance #planning`,
    preflight: [{ id: 'facts', ok: true, label: 'Facts confirmed' }, { id: 'length', ok: true, label: 'Length' }],
    version: 1, fixes: 0, cost: 0.042,
    approval: status === 'rejected' ? null : { at: iso(t + 7200000), by: 'acc1', byName: 'Agent', checklist: ['I checked the facts', 'It follows my rules'], sha256: 'ab'.repeat(32), file: `video_v${i}.mp4` },
    rejection: status === 'rejected' ? { at: iso(t + 7200000), reason: 'Not my style' } : null,
    posted: status === 'posted' ? { at: iso(t + DAY), by: 'instagram', url: `https://www.instagram.com/reel/m${i}/`, auto: true } : null,
    ...(status === 'posted' ? { results: { views: 400 + (i % 900), likes: 20, messages: i % 4 } } : {}),
  };
}

let agentWs = null;
test(`five years of data for ${AGENTS} agents`, { timeout: 600000 }, async t => {
  const t0 = Date.now();
  let total = 0;
  for (let a = 0; a < AGENTS; a++) {
    const ws = store.createWorkspace({ name: `Soak Agent ${a + 1}`, comped: true });
    store.updateWorkspace(ws.id, { onboarded: true, createdAt: iso(now - YEARS * 365 * DAY) });
    const cfg = store.loadConfig(ws.id);
    cfg.story = { ...cfg.story, ...starterStory(['final_expense']) };
    cfg.story.insights.forEach(x => { x.confirmed = true; x.confirmedAt = iso(now - 30 * DAY); });
    cfg.schedule = { ...(cfg.schedule || {}), keepReady: 3, autopost: { on: true, days: [1, 3, 5], time: '09:00', platforms: ['instagram'] } };
    store.saveConfig(ws.id, cfg);
    const n = YEARS * 52 * PER_WEEK;
    const vids = [];
    for (let i = 0; i < n; i++) vids.push(videoAt(i, now - (n - i) * (7 * DAY / PER_WEEK)));
    vids.reverse();   // newest first, as the app keeps them
    paths.writeJSON(path.join(store.wsDir(ws.id), 'videos.json'), vids);
    paths.writeJSON(path.join(store.wsDir(ws.id), 'clients.json'), Array.from({ length: 250 }, (_, k) => ({ id: `c${k}`, name: `Client ${k}`, createdAt: iso(now - k * 5 * DAY), stage: pick(['lead', 'booked', 'client'], k), next: '', last: '' })));
    total += n;
    if (a === 0) { agentWs = ws; store.createAccount({ email: 'soak@example.com', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('soakpass1234') }); }
  }
  store.createAccount({ email: 'soakadmin@example.com', role: 'admin', hash: await auth.hashPassword('soakpass1234') });
  t.diagnostic(`made ${total} videos in ${Math.round((Date.now() - t0) / 1000)}s`);
  assert.equal(store.readVideos(agentWs.id).length, YEARS * 52 * PER_WEEK);
});

const time = async fn => { const t = process.hrtime.bigint(); const out = await fn(); return { ms: Number(process.hrtime.bigint() - t) / 1e6, out }; };
const report = [];
// Budgets in milliseconds: agent screens don't depend on how many agents there are; admin screens and
// nightly jobs get time per agent.
const AGENT_SCREEN = 1000, PER_AGENT = { overview: 100, engine: 60 }, NIGHTLY_PER_AGENT = 400;

test('every agent screen opens within its budget with five years of data', { timeout: 300000 }, async () => {
  const c = client(port);
  assert.equal((await c.post('/api/login', { email: 'soak@example.com', password: 'soakpass1234' })).status, 200);
  for (const p of ['/api/me', '/api/today', '/api/overview', '/api/videos', '/api/clients', '/api/recap', '/api/desk', '/api/mindset', '/api/records.csv']) {
    await c.get(p);   // warm (first read parses the file)
    const { ms, out } = await time(() => c.get(p));
    report.push([p, Math.round(ms), AGENT_SCREEN]);
    assert.ok(out.status < 500, `${p}: ${out.status}`);
    assert.ok(ms < AGENT_SCREEN, `${p} took ${Math.round(ms)} ms (budget ${AGENT_SCREEN})`);
  }
});

test('admin screens stay within their budgets across every agent', { timeout: 300000 }, async () => {
  const c = client(port);
  assert.equal((await c.post('/api/login', { email: 'soakadmin@example.com', password: 'soakpass1234' })).status, 200);
  for (const [p, k] of [['/api/admin/overview', 'overview'], ['/api/admin/engine', 'engine']]) {
    await c.get(p);
    const budget = 1000 + PER_AGENT[k] * AGENTS;
    const { ms, out } = await time(() => c.get(p));
    report.push([p, Math.round(ms), budget]);
    assert.equal(out.status, 200, p);
    assert.ok(ms < budget, `${p} took ${Math.round(ms)} ms (budget ${budget})`);
  }
});

test('every nightly job stays within its budget', { timeout: 900000 }, async () => {
  const { cleanup, keepReady, backup } = await import('../lib/scheduler.js');
  const targets = await import('../lib/targets.js');
  const ig = await import('../lib/instagram.js');
  const budget = 3000 + NIGHTLY_PER_AGENT * AGENTS;
  const jobs = {
    'cleanup': () => cleanup(),
    'overnight top-up': () => keepReady(() => [], new Date()),
    'targets': () => targets.measure(),
    'posting tick': () => ig.tick(),
    'proactive jobs': () => S.proactiveJobs(new Date(), () => {}),
    'backup': () => backup(new Date(), { out: path.join(process.env.BACKUP_DIR, 'soak.tar.gz') }),
  };
  for (const [name, fn] of Object.entries(jobs)) {
    const { ms } = await time(fn);
    report.push([name, Math.round(ms), budget]);
    assert.ok(ms < budget, `${name} took ${Math.round(ms)} ms (budget ${budget})`);
  }
});

test('the soak report', t => {
  const w = Math.max(...report.map(r => r[0].length));
  for (const [k, ms, b] of report) t.diagnostic(`${k.padEnd(w)}  ${String(ms).padStart(6)} ms  (budget ${b})`);
  if (process.env.SOAK_REPORT) console.log(report.map(([k, ms, b]) => `${k}\t${ms}\t${b}`).join('\n'));
  assert.ok(report.length >= 15);
});
