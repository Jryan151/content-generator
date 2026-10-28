// v15 Phase 8: tailored to the agent: the simple Studio start (a format that takes turns, each series'
// next part), plan video limits that match what's sold, and the agent's time zone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempEnv, startStubs, client } from './helpers.js';

tempEnv();
const stubs = await startStubs();
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const studio = await import('../lib/studio.js');
const M = await import('../mixer-core.js');
const { starterStory } = await import('../templates.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });
const port = server.address().port;
test.after(() => { server.close(); stubs.close(); });

const ws = store.createWorkspace({ name: 'Tailored', comped: true });
const cfg0 = store.loadConfig(ws.id);
cfg0.story = { ...cfg0.story, ...starterStory() };
cfg0.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); i.source = 'Carrier guide'; });
store.saveConfig(ws.id, cfg0);
store.updateWorkspace(ws.id, { onboarded: true });
store.createAccount({ email: 'tailor@example.com', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('tailorpass12') });
const c = client(port);
await c.post('/api/login', { email: 'tailor@example.com', password: 'tailorpass12' });
const cfg = () => store.loadConfig(ws.id);
const pain = () => M.usableRoutes(cfg()).pains[0];

test('the simple start: a tapped worry gets a format that fits and takes turns with recent drafts', () => {
  const brief = { painId: pain().id, scenes: 6 };
  const fits = Object.keys(M.FORMATS).filter(k => !M.FORMATS[k].needs && k !== 'local' && !M.studioPicks(cfg(), { ...brief, format: k }).problems.length);
  assert.ok(fits.length >= 3, fits.join());
  const first = M.studioFormatFor(cfg(), brief, []);
  assert.equal(first, fits[0], 'nothing recent: the first that fits');
  // The least recently used comes next; one never used beats one used long ago.
  assert.equal(M.studioFormatFor(cfg(), brief, [fits[0]]), fits[1]);
  assert.equal(M.studioFormatFor(cfg(), brief, [fits[1], fits[0]]), fits[2]);
  const all = [...fits].reverse();   // newest first: fits[last] … fits[0], so fits[0] is the oldest
  assert.equal(M.studioFormatFor(cfg(), brief, all), fits[0]);
  // Never one that needs more than the brief has (two facts, a story, a city).
  for (const k of ['list', 'compare', 'story', 'local']) assert.notEqual(M.studioFormatFor(cfg(), brief, fits), k);
  // The worry's audience and its recommended fact follow from the brief.
  const p = M.studioPicks(cfg(), { ...brief, format: first });
  assert.ok(p.audience && p.painPoint.links.includes(p.audience.id)); assert.equal(p.insights.length, 1); assert.deepEqual(p.problems, []);
});

test('Continue a series: each series says which part comes next, from the drafts already made', async () => {
  const series = M.nicheOf(cfg()).series;
  assert.ok(series.length, 'the niche has series');
  let list = (await c.get('/api/studio')).data;
  assert.ok(list.series.every(x => x.next === 0 && !x.started), 'nothing started yet');
  const s0 = series[0];
  const d = (await c.post('/api/studio', { brief: { seriesId: s0.id, part: 0 } })).data.draft;
  assert.equal(studio.get(ws.id, d.id).brief.seriesId, s0.id);
  list = (await c.get('/api/studio')).data;
  const mine = list.series.find(x => x.id === s0.id);
  assert.equal(mine.started, true); assert.equal(mine.next, 1); assert.equal(mine.parts[1].title, s0.parts[1].title);
  // The last part made: nothing next.
  await c.post('/api/studio', { brief: { seriesId: s0.id, part: s0.parts.length - 1 } });
  assert.equal((await c.get('/api/studio')).data.series.find(x => x.id === s0.id).next, null);
  // Recent drafts carry their format (newest first), for taking turns; a draft with no worry yet doesn't count.
  const blank = (await c.post('/api/studio', { brief: {} })).data.draft;
  const picked = (await c.post('/api/studio', { brief: { painId: pain().id, format: 'myth' } })).data.draft;
  list = (await c.get('/api/studio')).data;
  assert.equal(list.recentFormats[0].id, picked.id); assert.equal(list.recentFormats[0].format, 'myth');
  assert.ok(!list.recentFormats.some(x => x.id === blank.id));
});

/* ---------------- The agent's time zone ---------------- */
const TZ = 'America/Denver';
const mkWs = name => {
  const w = store.createWorkspace({ name, comped: true });
  const c = store.loadConfig(w.id);
  c.story = { ...c.story, ...starterStory() };
  c.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); i.source = 'Carrier guide'; });
  c.profile = { ...c.profile, timezone: TZ };
  store.saveConfig(w.id, c);
  store.updateWorkspace(w.id, { onboarded: true, limits: { assistantSeats: 1 } });
  return w;
};
const vid = (w, id, extra = {}) => store.addVideo(w.id, { id, status: 'pending', file: `video_${id}.mp4`, createdAt: new Date().toISOString(), scenes: [{ text: `Video ${id}`, keyword: 'family' }], meta: { painPoint: 'Funeral costs' }, post: 'p', preflight: [], ...extra });

test('the portal knows the agent’s time zone, to write times the way she says them', async () => {
  const w = mkWs('Zone');
  const c = store.loadConfig(w.id); c.profile = { ...c.profile, timezone: 'America/New_York' }; store.saveConfig(w.id, c);
  store.createAccount({ email: 'zone@example.com', role: 'agent', workspaceId: w.id, hash: await auth.hashPassword('zonepass1234') });
  const z = client(port); await z.post('/api/login', { email: 'zone@example.com', password: 'zonepass1234' });
  assert.equal((await z.get('/api/me')).data.workspace.timezone, 'America/New_York');
});
