// v15 Phase 8: tailored to the agent. Part one: the simple Studio start (a format that takes turns,
// each series' next part), plan video limits that match what's sold.
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
cfg0.story = { ...cfg0.story, ...starterStory(['final_expense']) };
cfg0.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); i.source = 'Carrier guide'; });
store.saveConfig(ws.id, cfg0);
store.updateWorkspace(ws.id, { onboarded: true });
store.createAccount({ email: 'tailor@example.com', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('tailorpass12') });
const c = client(port);
await c.post('/api/login', { email: 'tailor@example.com', password: 'tailorpass12' });
const cfg = () => store.loadConfig(ws.id);
const pain = () => M.usableRoutes(cfg()).pains[0];

test('plan video limits match what’s sold: Starter 30, Pro 60 unless .env says otherwise', async () => {
  const billing = await import('../lib/billing.js');
  Object.assign(process.env, { STRIPE_PRICE_STARTER: 'price_s', STRIPE_PRICE_PRO: 'price_p' });
  try {
    assert.deepEqual(billing.planList().map(p => [p.id, p.videos]), [['starter', 30], ['pro', 60]]);
    process.env.PLAN_PRO_VIDEOS = '45';
    assert.equal(billing.planList().find(p => p.id === 'pro').videos, 45);
  } finally { ['STRIPE_PRICE_STARTER', 'STRIPE_PRICE_PRO', 'PLAN_PRO_VIDEOS'].forEach(k => delete process.env[k]); }
});

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

/* ---------------- 8b: the chauffeur who knows you ---------------- */
const crypto = await import('crypto');
const path = (await import('path')).default;
const paths = await import('../lib/paths.js');
const queue = await import('../lib/queue.js');
const desk = await import('../lib/desk.js');
const push = await import('../lib/push.js');
const ch = await import('../lib/chauffeur.js');
const { keepReady } = await import('../lib/scheduler.js');
const { today } = await import('../lib/today.js');
const TZ = 'America/Denver';
const at = (date, hm) => new Date(ch.instantAt(date, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)), TZ)).toISOString();
const mkWs = name => {
  const w = store.createWorkspace({ name, comped: true });
  const c = store.loadConfig(w.id);
  c.story = { ...c.story, ...starterStory(['final_expense']) };
  c.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); i.source = 'Carrier guide'; });
  c.profile = { ...c.profile, timezone: TZ };
  store.saveConfig(w.id, c);
  store.updateWorkspace(w.id, { onboarded: true, limits: { assistantSeats: 1 } });
  return w;
};
const vid = (w, id, extra = {}) => store.addVideo(w.id, { id, status: 'pending', file: `video_${id}.mp4`, createdAt: new Date().toISOString(), scenes: [{ text: `Video ${id}`, keyword: 'family' }], meta: { painPoint: 'Funeral costs' }, post: 'p', preflight: [], ...extra });

test('the agent’s clock: a local time on a local date, through the days the clocks change', () => {
  for (const [date, m] of [['2026-10-19', 9 * 60], ['2026-11-01', 9 * 60], ['2026-11-01', 90], ['2027-03-14', 12 * 60]]) {
    const c = ch.clockOf(TZ, ch.instantAt(date, m, TZ));
    assert.deepEqual([c.date, c.minutes], [date, m], `${date} ${m}`);
  }
  const gap = ch.clockOf(TZ, ch.instantAt('2027-03-14', 150, TZ));   // 2:30am doesn't happen that day
  assert.equal(gap.date, '2027-03-14'); assert.ok(gap.minutes >= 150);
  assert.equal(ch.clockLabel(7 * 60 + 45), '7:45am'); assert.equal(ch.clockLabel(12 * 60), '12pm'); assert.equal(ch.clockLabel(0), '12am');
});

test('when she usually reviews: learned from her decisions; the morning’s videos are ready just before', () => {
  const now = Date.parse(at('2026-10-19', '12:00'));
  const day = k => new Date(now - k * 86400000).toISOString().slice(0, 10);
  // Six mornings of reviewing around 7:40–9, one evening outlier.
  const times = [[1, '07:40'], [2, '07:55'], [3, '08:20'], [4, '07:35'], [5, '08:50'], [6, '07:50'], [7, '21:15']];
  const videos = times.map(([k, hm], n) => ({ id: 'h' + n, approval: { at: at(day(k), hm) } }));
  const habit = ch.reviewHabit(videos, TZ, now);
  assert.ok(habit, 'a clear habit'); assert.equal(habit.minutes, 7 * 60 + 30); assert.equal(habit.label, '7:30am'); assert.equal(habit.n, 6);
  // Decided offline counts when it was decided; rejections count too.
  assert.ok(ch.reviewHabit([...videos.slice(0, 4), { rejection: { at: at(day(8), '07:45') } }], TZ, now));
  const w = ch.readyWindow(habit, 2);
  assert.deepEqual([w.start, w.readyBy, w.learned], [7 * 60 + 30 - 45 - 90, 7 * 60 + 30 - 45, true]);
  assert.equal(w.readyLabel, '6:45am'); assert.equal(w.usual, '7:30am');
  assert.ok(ch.inWindow(6 * 60, w) && !ch.inWindow(3 * 60, w) && !ch.inWindow(7 * 60, w));
  // Too few, too spread out, or too early to start after midnight: the usual 1–6am.
  assert.equal(ch.reviewHabit(videos.slice(0, 4), TZ, now), null);
  assert.equal(ch.reviewHabit(times.map(([k], n) => ({ approval: { at: at(day(k), `${String(2 + n * 3).padStart(2, '0')}:00`) } })), TZ, now), null);
  assert.deepEqual(ch.readyWindow({ minutes: 90, label: '1:30am' }, 3), ch.DEFAULT_WINDOW);
  // A late-night reviewer, either side of midnight: one habit, from its early edge (11:30pm).
  const late = [[1, '23:40'], [2, '00:15'], [3, '23:35'], [4, '00:40'], [5, '23:50'], [6, '00:05']].map(([k, hm], n) => ({ approval: { at: at(day(k), hm) } }));
  const lh = ch.reviewHabit(late, TZ, now);
  assert.ok(lh, 'a habit across midnight'); assert.equal(lh.n, 6); assert.equal(lh.label, '11:30pm');
  assert.equal(ch.readyWindow(lh, 2).readyLabel, '10:45pm');
  // An evening reviewer gets hers in the afternoon.
  const eve = ch.readyWindow({ minutes: 19 * 60, label: '7pm' }, 5);
  assert.deepEqual([eve.readyBy, eve.start], [19 * 60 - 45, 19 * 60 - 45 - 90]);
});

test('overnight videos follow her habit, and wait while she’s away (the last night away still runs)', () => {
  const w = mkWs('Habit');
  const c = store.loadConfig(w.id); c.schedule = { ...c.schedule, keepReady: 2 }; store.saveConfig(w.id, c);
  const base = Date.parse(at('2026-10-19', '12:00'));
  [1, 2, 3, 4, 5, 6].forEach(k => vid(w, 'd' + k, { status: 'approved', approval: { at: at(new Date(base - k * 86400000).toISOString().slice(0, 10), '07:40') } }));
  const asked = [];
  const enqueue = (id, n, source) => { if (id === w.id) asked.push({ n, source }); return Array.from({ length: n }, (_, k) => ({ id: `j${k}` })); };
  keepReady(enqueue, new Date(at('2026-10-20', '03:00')));
  assert.equal(asked.length, 0, '3am is too early for her');
  keepReady(enqueue, new Date(at('2026-10-20', '06:00')));
  assert.deepEqual(asked, [{ n: 2, source: 'overnight' }], 'ready by 6:45, before she reviews around 7:30');
  keepReady(enqueue, new Date(at('2026-10-20', '06:20')));
  assert.equal(asked.length, 1, 'once a day');
  store.updateWorkspace(w.id, { away: { from: '2026-10-21', until: '2026-10-23', since: at('2026-10-20', '20:00') } });
  keepReady(enqueue, new Date(at('2026-10-22', '06:00')));
  assert.equal(asked.length, 1, 'not while she’s away');
  keepReady(enqueue, new Date(at('2026-10-24', '06:00')));
  assert.equal(asked.length, 2, 'the morning she’s back, they’re ready');
});

test('Away mode: what happens is shown first; approved videos cover the posting days; the assistant is told; nothing buzzes for her', async () => {
  const w = mkWs('Away');
  const c = store.loadConfig(w.id); c.schedule = { ...c.schedule, autopost: { ...c.schedule.autopost, on: false, days: [1, 2, 3, 4, 5], time: '09:00' } }; store.saveConfig(w.id, c);
  const agentAcc = store.createAccount({ email: 'away-agent@example.com', name: 'Dana Away', role: 'agent', workspaceId: w.id, hash: await auth.hashPassword('awayagent123') });
  const asst = store.createAccount({ email: 'away-asst@example.com', name: 'Sam Helper', role: 'agent', workspaceId: null, hash: await auth.hashPassword('awayasst1234') });
  store.setMembership(asst.id, w.id, { role: 'assistant' });
  ['a1', 'a2', 'a3'].forEach((id, k) => vid(w, id, { status: 'approved', approval: { at: new Date(Date.now() - (3 - k) * 3600000).toISOString() } }));
  const now = Date.parse(at('2026-10-19', '07:00'));   // a Monday, before the plan's 9:00
  // Nothing to post from: shown as such, nothing scheduled.
  let plan = await ch.coverPlan(w.id, { from: '2026-10-19', until: '2026-10-25', now });
  assert.equal(plan.mode, 'none'); assert.equal(plan.days.length, 5, 'Mon–Fri'); assert.equal(plan.covered, 0); assert.equal(plan.empty, 2, 'two days have nothing approved');
  // Instagram connected: the three approved videos get scheduled at 9:00 her time, oldest first.
  Object.assign(process.env, { INSTAGRAM_APP_ID: 'app', INSTAGRAM_APP_SECRET: 'secret' });
  try {
    paths.writeJSON(path.join(store.wsDir(w.id), 'instagram.json'), { userId: '1', username: 'dana', token: 'x', expiresAt: new Date(now + 50 * 86400000).toISOString(), connectedAt: new Date(now).toISOString() });
    plan = await ch.coverPlan(w.id, { from: '2026-10-19', until: '2026-10-25', now });
    assert.equal(plan.mode, 'schedule'); assert.deepEqual(plan.days.slice(0, 3).map(d => [d.date, d.video.id, d.how]), [['2026-10-19', 'a1', 'will-schedule'], ['2026-10-20', 'a2', 'will-schedule'], ['2026-10-21', 'a3', 'will-schedule']]);
    const r = await ch.startAway(w.id, { until: '2026-10-25', by: agentAcc.id, byName: 'Dana Away', now });
    assert.deepEqual(r.away.scheduled, ['a1', 'a2', 'a3']); assert.equal(r.away.covered, 3); assert.equal(r.away.postingDays, 5);
    const a1 = store.getVideo(w.id, 'a1').autopost;
    assert.equal(a1.status, 'scheduled'); assert.deepEqual([ch.clockOf(TZ, Date.parse(a1.at)).date, ch.clockOf(TZ, Date.parse(a1.at)).minutes], ['2026-10-19', 540]);
    const note = desk.list(w.id).find(h => h.to === asst.id);
    assert.match(note.title, /Dana Away is away until Monday, Oct 26/); assert.match(note.message, /Posting: 3 of 5 posting days covered, 2 with nothing approved/);
    assert.deepEqual(r.away.told, [asst.id]);
  } finally { delete process.env.INSTAGRAM_APP_ID; delete process.env.INSTAGRAM_APP_SECRET; }
  // Away today: her greeting says so (no nudges); a push for her is held, her assistant's still goes.
  const t = today(w.id, agentAcc, { now: Date.parse(at('2026-10-21', '10:00')), caps: ['approve'] });
  assert.equal(t.away.backOn, '2026-10-26'); assert.equal(t.dayOff, true); assert.equal(t.pending, 0);
  const sub = acc => { const ec = crypto.createECDH('prime256v1'); ec.generateKeys(); push.subscribe(w.id, acc.id, { endpoint: `https://fcm.googleapis.com/fcm/send/${acc.id}`, keys: { p256dh: ec.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') } }); };
  sub(agentAcc); sub(asst);
  const hit = [];
  const fetchImpl = async url => { hit.push(url); return { status: 201, ok: true }; };
  const noon = new Date(at('2026-10-21', '12:00'));
  await push.send(w.id, { title: 'x', body: 'y' }, { tz: TZ, now: noon, fetchImpl, accountIds: [agentAcc.id] });
  assert.equal(hit.length, 0, 'nothing for her while she’s away');
  await push.send(w.id, { title: 'x', body: 'y' }, { tz: TZ, now: noon, fetchImpl });
  assert.deepEqual(hit, [`https://fcm.googleapis.com/fcm/send/${asst.id}`], 'her assistant still hears');
  // Back early: a welcome back with what happened; seen once.
  store.updateVideo(w.id, 'a1', { status: 'posted', posted: { at: at('2026-10-19', '09:01') }, autopost: { ...store.getVideo(w.id, 'a1').autopost, status: 'posted', postedAt: at('2026-10-19', '09:01') }, clicks: { total: 4, byDay: { '2026-10-19': 3, '2026-10-30': 1 } } });
  store.updateWorkspace(w.id, { away: { ...store.getWorkspace(w.id).away, endedAt: at('2026-10-22', '08:00') } });
  const wb = ch.welcomeBack(w.id, Date.parse(at('2026-10-22', '09:00')));
  assert.deepEqual([wb.posted, wb.clicks, wb.backEarly, wb.scheduledAhead], [1, 3, true, 2]);
  assert.ok(ch.dismissWelcome(w.id)); assert.equal(store.getWorkspace(w.id).away, null); assert.ok(store.getWorkspace(w.id).awayLast.welcomedAt);
  assert.equal(ch.welcomeBack(w.id), null);
});

test('Away mode over the API: hers alone, checked dates, one at a time', async () => {
  const w = mkWs('Away API');
  store.createAccount({ email: 'awayapi@example.com', name: 'Ann Agent', role: 'agent', workspaceId: w.id, hash: await auth.hashPassword('awayapi12345') });
  const asst = store.createAccount({ email: 'awayapi-asst@example.com', role: 'agent', workspaceId: null, hash: await auth.hashPassword('awayasst1234') });
  store.setMembership(asst.id, w.id, { role: 'assistant' });
  const a = client(port); await a.post('/api/login', { email: 'awayapi@example.com', password: 'awayapi12345' });
  const s = client(port); await s.post('/api/login', { email: 'awayapi-asst@example.com', password: 'awayasst1234' });
  const day = n => ch.clockOf(TZ, Date.now() + n * 86400000).date;
  assert.equal((await s.post('/api/away', { back: day(3) })).status, 403, 'the agent’s own');
  assert.equal((await a.get(`/api/away?back=${day(-1)}`)).status, 400, 'a day gone by');
  assert.equal((await a.get(`/api/away?back=${day(70)}`)).status, 400, 'up to 60 days');
  const pv = await a.get(`/api/away?back=${day(5)}`);
  assert.equal(pv.status, 200); assert.equal(pv.data.preview.mode, 'none'); assert.equal(pv.data.away, null);
  const go = await a.post('/api/away', { back: day(5) });
  assert.equal(go.status, 200, JSON.stringify(go.data)); assert.equal(go.data.away.until, day(4));
  assert.equal((await a.post('/api/away', { back: day(6) })).status, 409, 'already away');
  assert.ok((await a.get('/api/today')).data.away);
  const back = await a.del('/api/away');
  assert.equal(back.status, 200); assert.ok(back.data.welcome, 'the welcome back is waiting');
  assert.ok((await a.get('/api/today')).data.welcome);
  assert.equal((await a.post('/api/away/welcome', {})).status, 200);
  assert.equal((await a.get('/api/today')).data.welcome, undefined);
});

test('busy week: makes what the week needs, holds each “ready” notification, and tells her once', async () => {
  const w = mkWs('Busy');
  const c = store.loadConfig(w.id); c.schedule = { ...c.schedule, autopost: { ...c.schedule.autopost, on: true, days: [0, 1, 2, 3, 4, 5, 6], time: '09:00' } }; store.saveConfig(w.id, c);
  store.createAccount({ email: 'busy@example.com', role: 'agent', workspaceId: w.id, hash: await auth.hashPassword('busypass1234') });
  const b = client(port); await b.post('/api/login', { email: 'busy@example.com', password: 'busypass1234' });
  const r = await b.post('/api/busy-week', {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.need > 0 && r.data.need <= 5); assert.equal(r.data.queued, r.data.need, 'what the week needs, up to 5');
  const jobs = queue.listJobs(w.id).filter(j => j.source === 'busy');
  assert.equal(jobs.length, r.data.queued); assert.deepEqual(store.getWorkspace(w.id).busy.jobs, jobs.map(j => j.id));
  assert.equal((await b.post('/api/busy-week', {})).status, 409, 'one at a time');
  assert.ok(ch.inBusyBatch(store.getWorkspace(w.id), jobs[0].id));
  // The first finishing: nothing sent, the batch isn't done.
  assert.equal(await S.notifyReady(jobs[0], { videoId: 'x' }), null);
  assert.equal(store.getWorkspace(w.id).busy.notified, undefined);
  // The rest end (one made, the others canceled): done once, with how many were made (canceled ones
  // didn't fail).
  jobs.slice(2).forEach(j => queue.cancel(w.id, j.id));
  queue._patch(jobs[0].id, { status: 'done' });
  assert.deepEqual(ch.busyFinished(w.id, { id: jobs[1].id, ok: true }), { made: 2, failed: 0 });
  assert.equal(ch.busyFinished(w.id, { id: jobs[1].id, ok: true }), null, 'once');
  const t = (await b.get('/api/today')).data.busy;
  assert.equal(t.notified, true); assert.equal(t.total, jobs.length);
  assert.equal((await b.del('/api/busy-week')).status, 200);
  assert.equal(store.getWorkspace(w.id).busy, null);
});

test('coming up: what runs out in the weeks ahead, only what’s theirs to act on; quiet when it looks after itself', async () => {
  const w = mkWs('Ahead');
  const now = Date.parse('2026-10-19T18:00:00Z');
  const c = store.loadConfig(w.id);
  c.story.insights[0].confirmedAt = new Date(now - 170 * 86400000).toISOString();   // due in 10 days
  store.saveConfig(w.id, c);
  store.updateWorkspace(w.id, { billing: { status: 'active', card: { brand: 'Visa', last4: '4242', exp: '2026-11' } } });
  paths.writeJSON(path.join(store.wsDir(w.id), 'instagram.json'), { userId: '1', username: 'x', token: 'x', expiresAt: new Date(now + 40 * 86400000).toISOString() });
  let a = ch.ahead(w.id, { now, caps: ['settings', 'billing', 'post'] });
  assert.deepEqual(a.map(x => x.id), ['facts', 'card'], 'Instagram still renews itself, so it isn’t listed');
  assert.equal(a[0].days, 10); assert.equal(a[0].go, 'library'); assert.match(a[1].what, /Visa ending 4242/); assert.equal(a[1].date, '2026-11-30');
  assert.deepEqual(ch.ahead(w.id, { now, caps: ['post'] }).map(x => x.id), [], 'an assistant without billing or settings sees neither');
  paths.writeJSON(path.join(store.wsDir(w.id), 'instagram.json'), { userId: '1', username: 'x', token: 'x', expiresAt: new Date(now + 9 * 86400000).toISOString() });
  a = ch.ahead(w.id, { now, caps: ['post'] });
  assert.equal(a[0].id, 'instagram'); assert.match(a[0].what, /hasn’t renewed itself/);
});

test('the valet’s morning report: what was made overnight, what waited out an outage or tried again, what didn’t finish', () => {
  const w = mkWs('Valet');
  const c = store.loadConfig(w.id); c.schedule = { ...c.schedule, keepReady: 3 }; store.saveConfig(w.id, c);
  const now = Date.parse(at('2026-10-20', '07:30'));
  const mk = (patch, source = 'overnight') => { const j = queue.enqueue({ ws: w.id, kind: 'video', source }); queue._patch(j.id, patch); return j; };
  mk({ status: 'done', endedAt: at('2026-10-20', '02:10'), attempts: 1 });
  mk({ status: 'done', endedAt: at('2026-10-20', '04:10'), attempts: 1, waits: 2 });
  mk({ status: 'done', endedAt: at('2026-10-20', '03:00'), attempts: 2 });
  mk({ status: 'failed', endedAt: at('2026-10-20', '05:00'), attempts: 2, error: 'x' });
  mk({ status: 'done', endedAt: at('2026-10-19', '15:00'), attempts: 1 });   // yesterday afternoon: not last night
  mk({ status: 'done', endedAt: at('2026-10-20', '02:00'), attempts: 1 }, 'manual');   // not an overnight one
  const v = ch.valet(w.id, { now });
  assert.deepEqual([v.made, v.recovered, v.failed], [3, 2, 1]);
  assert.equal(v.text, 'Overnight: 3 videos made. One waited out a service that wasn’t answering, then finished at 4:10am. One needed a second try, and finished. One didn’t finish. Tonight’s run makes up for it.');
  assert.equal(ch.valet(w.id, { now: Date.parse(at('2026-10-22', '07:30')) }), null, 'nothing to report');
});

/* ---------------- 8c: the rear seat (the agent's clients) ---------------- */
const fs = (await import('fs')).default;
const { spawnSync } = await import('child_process');
const links = await import('../lib/links.js');
const landing = await import('../lib/landing.js');
const clientsLib = await import('../lib/clients.js');
const keepsakes = await import('../lib/keepsakes.js');
const { hasFfmpeg } = await import('./helpers.js');
const raw = (p, opts = {}) => fetch(`http://127.0.0.1:${port}${p}`, { redirect: 'manual', ...opts, headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Safari', ...(opts.headers || {}) } });
const form = (code, body, ip = '') => raw(`/r/${code}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(ip ? { 'x-forwarded-for': ip } : {}) }, body: new URLSearchParams(body).toString() });

test('the page behind a video’s link: “You watched”, the agent, Pick a time, a short form that makes a lead tied to the video', async () => {
  const w = mkWs('Landing');
  const c = store.loadConfig(w.id); c.look = { ...c.look, name: 'Dana Agent', title: 'Licensed Agent', location: 'Gallup, NM', bookingUrl: 'https://calendly.com/dana', disclaimer: 'NM License #123' }; store.saveConfig(w.id, c);
  vid(w, 'lp1', { status: 'posted', scenes: [{ text: 'Who pays for your funeral <someday>?', keyword: 'family' }] });
  const code = links.codeFor(w.id, 'lp1');
  let r = await raw(`/r/${code}`);
  const html = await r.text();
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'.*form-action 'self'/);
  assert.match(html, /You watched:<q>Who pays for your funeral &lt;someday&gt;\?<\/q>/, 'escaped');
  assert.match(html, /Dana Agent/); assert.match(html, /Licensed Agent · Gallup, NM/); assert.match(html, /NM License #123/);
  assert.match(html, new RegExp(`href="/r/${code}/book"`)); assert.doesNotMatch(html, /<script/i);
  links.flush(); assert.equal(store.getVideo(w.id, 'lp1').clicks.total, 1, 'the visit counts as a click');
  // Pick a time: counted, then the booking page.
  r = await raw(`/r/${code}/book`);
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), `https://calendly.com/dana?utm_source=agentreels&utm_medium=video&utm_content=${code}`);
  links.flush(); assert.equal(store.getVideo(w.id, 'lp1').clicks.book, 1);
  // The form: a bad contact is refused with what was typed kept; a good one is a lead.
  r = await form(code, { name: 'Maria', contact: 'nope', message: 'Hi' }, '10.0.0.1');
  assert.equal(r.status, 400); const bad = await r.text(); assert.match(bad, /Add a phone number or an email address/); assert.match(bad, /value="Maria"/);
  r = await form(code, { name: 'Maria', contact: '505-555-0142', message: 'Does it cover cremation?' }, '10.0.0.1');
  assert.equal(r.status, 200); assert.match(await r.text(), /Thanks, Maria\./);
  const lead = clientsLib.list(w.id).find(x => x.name === 'Maria');
  assert.deepEqual([lead.stage, lead.phone, lead.videoId, lead.notes], ['lead', '505-555-0142', 'lp1', 'Asked: Does it cover cremation?']);
  assert.match(lead.source, /^Video: “Who pays for your funeral/);
  assert.equal(store.getVideo(w.id, 'lp1').leads.total, 1);
  // Email works too; markup in a name is shown as text.
  r = await form(code, { name: '<b>Al</b>', contact: 'al@example.com' }, '10.0.0.2');
  assert.match(await r.text(), /Thanks, &lt;b&gt;Al&lt;\/b&gt;\./);
  // A bot filling the hidden field is thanked, and nothing is kept.
  const before = clientsLib.list(w.id).length;
  r = await form(code, { name: 'Bot', contact: 'bot@example.com', website: 'http://spam' }, '10.0.0.3');
  assert.equal(r.status, 200); assert.equal(clientsLib.list(w.id).length, before);
  // A few an hour from one address.
  for (let k = 0; k < landing.PER_HOUR - 1; k++) await form(code, { name: `P${k}`, contact: `p${k}@example.com` }, '10.0.0.9');
  assert.equal((await form(code, { name: 'Late', contact: 'late@example.com' }, '10.0.0.9')).status, 200);
  assert.equal((await form(code, { name: 'More', contact: 'more@example.com' }, '10.0.0.9')).status, 429);
  // A lead counts like a message in what the app learns works.
  assert.equal(M.resultValue({ leads: { total: 2 }, clicks: { total: 4 } }), 4);
});

test('the page: straight to booking when Brand says so; without a booking link, just the form; not live, not shown', async () => {
  const w = mkWs('Landing 2');
  vid(w, 'lp2', { status: 'approved' }); vid(w, 'lp3', { status: 'approved' });
  const code = links.codeFor(w.id, 'lp2'), code3 = links.codeFor(w.id, 'lp3');
  let html = await (await raw(`/r/${code}`)).text();
  assert.doesNotMatch(html, /\/book"/, 'no booking link: no Pick a time'); assert.match(html, /Leave your number/);
  assert.equal((await raw(`/r/${code}/book`)).status, 404);
  const c = store.loadConfig(w.id); c.look = { ...c.look, bookingUrl: 'https://calendly.com/x', landing: 'direct' }; store.saveConfig(w.id, c);
  const r = await raw(`/r/${code}`);
  assert.equal(r.status, 302); assert.match(r.headers.get('location'), /^https:\/\/calendly\.com\/x\?utm_source=agentreels&utm_medium=video&utm_content=[a-f0-9]{10}$/);
  store.updateVideo(w.id, 'lp3', { status: 'pending' });
  assert.equal((await raw(`/r/${code3}`)).status, 404, 'back in review: not live');
  assert.equal((await raw('/r/0123456789')).status, 404);
  assert.equal((await raw(`/r/${code}/photo`)).status, 404, 'no photo yet');
  assert.equal((await raw(`/r/${code}/other`)).status, 404);
  assert.equal(M.migrate({ look: { landing: 'weird' } }).look.landing, 'page');
});

test('the agent’s photo: squared and re-encoded; shown on the page; removable', { skip: !hasFfmpeg() && 'FFmpeg not installed' }, async () => {
  const w = mkWs('Photo');
  store.createAccount({ email: 'photo@example.com', role: 'agent', workspaceId: w.id, hash: await auth.hashPassword('photopass123') });
  const a = client(port); await a.post('/api/login', { email: 'photo@example.com', password: 'photopass123' });
  const tmp = path.join(paths.DIRS.work, 'p.png'); fs.mkdirSync(paths.DIRS.work, { recursive: true });
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#c08a5a:s=600x900', '-frames:v', '1', tmp]);
  assert.equal((await a.post('/api/brand/photo', { image: 'data:image/png;base64,AAAA' })).status, 400);
  const r = await a.post('/api/brand/photo', { image: `data:image/png;base64,${fs.readFileSync(tmp).toString('base64')}` });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,codec_name', '-of', 'csv=p=0', landing.photoPath(w.id)], { encoding: 'utf8' }).stdout.trim();
  assert.equal(probe, 'mjpeg,400,400');
  assert.equal((await a.get('/api/me')).data.workspace.photo, true);
  vid(w, 'ph1', { status: 'approved' });
  const code = links.codeFor(w.id, 'ph1');
  assert.match(await (await raw(`/r/${code}`)).text(), new RegExp(`<img src="/r/${code}/photo"`));
  const img = await raw(`/r/${code}/photo`);
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal((await a.del('/api/brand/photo')).status, 200);
  assert.ok(!landing.hasPhoto(w.id));
});

test('client care: a thank-you after booking, a welcome for a new client, notes drafted in the agent’s voice and checked', async () => {
  const w = mkWs('Care');
  const c = store.loadConfig(w.id); c.bank = { ...c.bank, samples: ['Hey friend! So good to hear from you. Talk soon :)'] }; store.saveConfig(w.id, c);
  store.createAccount({ email: 'care@example.com', role: 'agent', workspaceId: w.id, hash: await auth.hashPassword('carepass1234') });
  const a = client(port); await a.post('/api/login', { email: 'care@example.com', password: 'carepass1234' });
  const lead = clientsLib.add(w.id, { name: 'Maria Lopez', stage: 'lead', family: 'Two grandkids' });
  const today = ch.clockOf(TZ, Date.now()).date;
  clientsLib.save(w.id, lead.id, { stage: 'booked' });
  let care = clientsLib.careDue(w.id, today);
  const thanks = care.find(x => x.kind === 'thanks');
  assert.ok(thanks, JSON.stringify(care)); assert.equal(thanks.text, 'Thank Maria Lopez for booking a time');
  const n = await a.post(`/api/clients/${lead.id}/note`, { kind: 'thanks' });
  assert.equal(n.status, 200, JSON.stringify(n.data));
  assert.deepEqual(n.data.notes.map(x => x.label), ['Warm', 'Short'], 'the one with a price is left out');
  assert.match(n.data.notes[0].text, /Hi Maria, thank you/); assert.equal(n.data.voice, true);
  assert.equal((await a.post(`/api/clients/${lead.id}/note`, { kind: 'sales' })).status, 400);
  assert.equal((await a.post('/api/clients/nope/note', { kind: 'thanks' })).status, 404);
  assert.equal((await a.post(`/api/clients/${lead.id}/care`, { key: thanks.key })).status, 200);
  assert.ok(!clientsLib.careDue(w.id, today).some(x => x.kind === 'thanks'), 'done');
  clientsLib.save(w.id, lead.id, { stage: 'client' });
  care = clientsLib.careDue(w.id, today);
  assert.equal(care.find(x => x.kind === 'welcome')?.text, 'Welcome Maria Lopez as a new client');
  // Someone typed in as a client (Mindset's notes, the default stage), or a record from before stageAt,
  // isn't a new client: no welcome.
  const old = clientsLib.add(w.id, { name: 'Joan Long-Time' });
  assert.equal(old.stageAt, '');
  paths.updateJSON(path.join(store.wsDir(w.id), 'clients.json'), [], all => all.map(x => (x.id === old.id ? { ...x, stageAt: undefined } : x)));
  clientsLib.save(w.id, old.id, { notes: 'Likes gardening' });
  assert.ok(!clientsLib.careDue(w.id, today).some(x => x.id === old.id), 'no welcome for a long-time client');
});

test('keepsakes: a private birthday or welcome video for one client, kept apart from her videos, checked words, a monthly limit', async () => {
  const w = mkWs('Keepsakes');
  store.createAccount({ email: 'keep@example.com', role: 'agent', workspaceId: w.id, hash: await auth.hashPassword('keeppass1234') });
  const a = client(port); await a.post('/api/login', { email: 'keep@example.com', password: 'keeppass1234' });
  const cl = clientsLib.add(w.id, { name: 'Maria Lopez', birthday: '10-30' });
  assert.deepEqual(keepsakes.defaultLines('birthday', cl), ['Happy birthday, Maria!', 'Wishing you a year full of good days.', 'Thinking of you today.']);
  // A welcome needs her own clips; the words are checked.
  assert.equal((await a.post('/api/keepsakes', { kind: 'welcome', clientId: cl.id })).status, 409);
  assert.equal((await a.post('/api/keepsakes', { kind: 'birthday', clientId: cl.id, lines: ['Happy birthday!', 'Plans from $9 a month'] })).status, 400);
  assert.equal((await a.post('/api/keepsakes', { kind: 'birthday', clientId: cl.id, lines: ['Just one'] })).status, 400);
  const r = await a.post('/api/keepsakes', { kind: 'birthday', clientId: cl.id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const k = r.data.keepsake;
  assert.equal(k.status, 'making'); assert.equal(k.name, 'Maria');
  const job = queue.listJobs(w.id).find(j => j.id === k.jobId);
  assert.equal(job.kind, 'keepsake'); assert.equal(job.opts.id, k.id);
  // Not one of her videos: not in the month's count, Review's "being made", Create's list or the ready cards.
  assert.equal(store.readVideos(w.id).length, 0);
  assert.equal((await a.get('/api/videos')).data.making, 0);
  assert.ok(!(await a.get('/api/overview')).data.jobs.some(j => j.id === job.id));
  const desk = (await a.get('/api/desk')).data;
  assert.equal(desk.keepsakes[0].id, k.id); assert.equal(desk.ownClips, 0);
  // Its file is known to the nightly inspection; deleting cancels the job.
  assert.ok(keepsakes.ids(w.id).includes(k.id));
  assert.equal((await a.del(`/api/keepsakes/${k.id}`)).status, 200);
  assert.equal(queue.getJob(job.id).status, 'canceled'); assert.equal(keepsakes.get(w.id, k.id), null);
  // A monthly limit, which deleting doesn't reset (the one above still counts); old ones go after 60 days;
  // the export lists them.
  for (let n = 0; n < keepsakes.PER_MONTH - 1; n++) keepsakes.create(w.id, { kind: 'birthday', clientId: cl.id, id: `20261017T0000${String(n).padStart(2, '0')}-abcdef` });
  assert.equal((await a.post('/api/keepsakes', { kind: 'birthday', clientId: cl.id })).status, 429);
  keepsakes.save(w.id, keepsakes.list(w.id)[0].id, { createdAt: new Date(Date.now() - 61 * 86400000).toISOString() });
  assert.equal(keepsakes.prune(w.id), 1);
  const { exportWorkspace } = await import('../lib/data.js');
  assert.equal(exportWorkspace(w.id).keepsakes.length, keepsakes.PER_MONTH - 2);
});

test('review fixes: keepsake words held to the reply rules; a deleted client takes their keepsakes; a deleted keepsake stops quietly', async () => {
  const w = mkWs('Keep rules');
  const cf = store.loadConfig(w.id); cf.guardrails = { ...cf.guardrails, neverUse: [...(cf.guardrails?.neverUse || []), 'cheap'] }; store.saveConfig(w.id, cf);
  store.createAccount({ email: 'krules@example.com', role: 'agent', workspaceId: w.id, hash: await auth.hashPassword('krulespass12') });
  const a = client(port); await a.post('/api/login', { email: 'krules@example.com', password: 'krulespass12' });
  const cl = clientsLib.add(w.id, { name: 'Rosa Diaz' });
  for (const [line, why] of [['You will get approved, I make sure of it', /promises/], ['Ask me about Medicaid help', /government/], ['A cheap way to plan ahead', /never-use/], ['It is 100% certain', /prices and percentages/]]) {
    const r = await a.post('/api/keepsakes', { kind: 'birthday', clientId: cl.id, lines: ['Happy birthday, Rosa!', line] });
    assert.equal(r.status, 400, line); assert.match(r.data.error, why, line);
  }
  const k = (await a.post('/api/keepsakes', { kind: 'birthday', clientId: cl.id })).data.keepsake;
  assert.ok(k, 'the default lines pass');
  // The client deleted: the keepsake and its job go too.
  assert.equal((await a.del(`/api/clients/${cl.id}`)).status, 200);
  assert.equal(keepsakes.get(w.id, k.id), null); assert.equal(queue.getJob(k.jobId).status, 'canceled');
  // A keepsake deleted before its job runs: the job stops for good, without an alert.
  const { makeKeepsake } = await import('../pipeline.js');
  await assert.rejects(makeKeepsake({ ws: w.id, id: k.id, log: () => {} }), e => e.permanent && e.quiet);
});

test('review fixes: the page’s form, refreshed, makes one lead; an IPv6 network is one address; a day’s cap and room kept for the agent', async () => {
  const w = mkWs('Landing caps');
  vid(w, 'lc1', { status: 'posted' });
  const code = links.codeFor(w.id, 'lc1');
  // Sent twice (the thank-you page refreshed): thanked twice, one lead.
  for (let k = 0; k < 2; k++) assert.equal((await form(code, { name: 'Ana', contact: '(505) 555-0199' }, '10.1.0.1')).status, 200);
  assert.equal(clientsLib.list(w.id).filter(x => x.name === 'Ana').length, 1);
  // Addresses in one IPv6 network share the hourly limit.
  assert.equal(landing.netOf('2001:db8:1:2::a'), landing.netOf('2001:0db8:0001:0002:ffff::b'));
  for (let k = 0; k < landing.PER_HOUR; k++) assert.equal((await form(code, { name: `V${k}`, contact: `v${k}@example.com` }, `2001:db8:1:2::${k + 1}`)).status, 200);
  assert.equal((await form(code, { name: 'V9', contact: 'v9@example.com' }, '2001:db8:1:2::99')).status, 429);
  // A day's page leads, from everywhere together.
  const p = landing.pageFor(code);
  for (let k = clientsLib.list(w.id).length; k < landing.PER_DAY; k++) landing.addLead(p, { name: `D${k}`, contact: `d${k}@example.com` }, { ip: `10.2.${k}.1` });
  const capped = await form(code, { name: 'Late', contact: 'late@example.com' }, '10.3.0.1');
  assert.equal(capped.status, 429); assert.match(await capped.text(), /can’t take more messages today\. Use Pick a time instead\.|can’t take more messages today\. Send a message instead\./);
  // Near the list's limit, the page leaves the last places for the agent's own entries.
  const w2 = mkWs('Landing full'); vid(w2, 'lf1', { status: 'posted' });
  const many = Array.from({ length: clientsLib.MAX_CLIENTS - landing.KEEP_FREE }, (_, k) => ({ id: `cl${k}`, name: `C${k}`, createdAt: '2026-01-01T00:00:00.000Z', stage: 'client', source: '', email: '', phone: '' }));
  paths.writeJSON(path.join(store.wsDir(w2.id), 'clients.json'), many);
  assert.equal((await form(links.codeFor(w2.id, 'lf1'), { name: 'Al', contact: 'al@example.com' }, '10.4.0.1')).status, 429);
  assert.ok(clientsLib.add(w2.id, { name: 'Her own entry' }), 'the agent can still add people');
});

test('review fixes: canceling a busy week’s last video sends its one notification; a coach suggestion adds one item, the same everywhere', async () => {
  const w = mkWs('Busy cancel');
  const c = store.loadConfig(w.id); c.schedule = { ...c.schedule, autopost: { ...c.schedule.autopost, on: true, days: [0, 1, 2, 3, 4, 5, 6], time: '09:00' } }; store.saveConfig(w.id, c);
  store.createAccount({ email: 'bcancel@example.com', role: 'agent', workspaceId: w.id, hash: await auth.hashPassword('bcancelpass1') });
  const b = client(port); await b.post('/api/login', { email: 'bcancel@example.com', password: 'bcancelpass1' });
  assert.equal((await b.post('/api/busy-week', {})).status, 200);
  const jobs = queue.listJobs(w.id).filter(j => j.source === 'busy');
  assert.ok(jobs.length >= 2);
  jobs.slice(0, -1).forEach(j => queue._patch(j.id, { status: 'done' }));
  assert.equal((await b.del(`/api/jobs/${jobs.at(-1).id}`)).status, 200);
  await new Promise(r => setTimeout(r, 50));
  const busy = store.getWorkspace(w.id).busy;
  assert.ok(busy.notified, 'the batch is finished'); assert.deepEqual([busy.made, busy.failed], [jobs.length - 1, 0]);
  // Applied to what's saved and to what's on screen: one fact, one id.
  const sg = { type: 'add_fact', text: 'Most final expense plans have no medical exam.' };
  const one = M.applySuggestionTo(cfg(), sg), two = M.applySuggestionTo(cfg(), sg);
  assert.equal(one.story.insights[0].id, two.story.insights[0].id);
});

const fullSkip = !process.env.FULL_TEST ? 'renders a video; run with npm run test:full' : !hasFfmpeg() ? 'FFmpeg not installed' : false;
test('end to end: a birthday keepsake is rendered with her end card, ready to share, and never among her videos', { skip: fullSkip, timeout: 600000 }, async () => {
  const w = mkWs('Keepsake render');
  const c = store.loadConfig(w.id); c.look = { ...c.look, name: 'Dana Agent', location: 'Gallup, NM' }; store.saveConfig(w.id, c);
  const cl = clientsLib.add(w.id, { name: 'Maria Lopez' });
  const { newId } = await import('../lib/paths.js');
  const k = keepsakes.create(w.id, { kind: 'birthday', clientId: cl.id, id: newId() });
  const { makeKeepsake } = await import('../pipeline.js');
  const done = await makeKeepsake({ ws: w.id, id: k.id, log: () => {} });
  assert.equal(done.status, 'ready'); assert.ok(fs.existsSync(store.videoPath(w.id, done.file)));
  assert.equal(store.readVideos(w.id).length, 0);
  const { inspect } = await import('../lib/inspect.js').catch(() => ({}));
  if (inspect) { const r = inspect({ fix: true, now: Date.now() + 3 * 86400000 }); assert.ok(fs.existsSync(store.videoPath(w.id, done.file)), 'the inspection leaves it alone'); void r; }
});

/* ---------------- 8d: fitted to the person, and celebrations ---------------- */
test('a year in reels, in the week after the anniversary of joining; private to the agent', async () => {
  const w = mkWs('Year');
  const acc = store.createAccount({ email: 'year@example.com', name: 'Dana', role: 'agent', workspaceId: w.id, hash: await auth.hashPassword('yearpass1234') });
  store.updateWorkspace(w.id, { acceptedAt: '2025-10-15T16:00:00.000Z' });
  vid(w, 'y1', { status: 'posted', createdAt: '2026-03-01T16:00:00.000Z', posted: { at: '2026-03-02T16:00:00.000Z' }, results: { messages: 3, views: 900 }, meta: { painPoint: 'Funeral costs' }, scenes: [{ text: 'Who pays for your funeral?', keyword: 'f' }] });
  vid(w, 'y2', { status: 'posted', createdAt: '2026-05-01T16:00:00.000Z', posted: { at: '2026-05-02T16:00:00.000Z' }, results: { messages: 0, views: 100 }, leads: { total: 1 }, meta: { painPoint: 'Fixed income' } });
  vid(w, 'y0', { status: 'posted', createdAt: '2025-09-01T16:00:00.000Z', posted: { at: '2025-09-02T16:00:00.000Z' }, results: { messages: 9 } });   // before she joined
  const t = today(w.id, acc, { now: Date.parse('2026-10-17T18:00:00Z'), caps: ['approve'] });
  assert.deepEqual([t.year.years, t.year.today, t.year.posted, t.year.messages, t.year.leads, t.year.views, t.year.topTopic], [1, false, 2, 3, 1, 1000, 'Funeral costs']);
  assert.equal(t.year.best, 'Who pays for your funeral?');
  assert.equal(today(w.id, acc, { now: Date.parse('2026-10-15T18:00:00Z') }).year.today, true);
  assert.equal(today(w.id, acc, { now: Date.parse('2026-10-25T18:00:00Z') }).year, undefined, 'a week, then it’s gone');
  assert.equal(today(w.id, acc, { now: Date.parse('2026-10-17T18:00:00Z'), milestones: false }).year, undefined, 'not for her assistant');
});

test('the day’s quiet wrap: from 5pm, only when something happened, with tomorrow’s post', async () => {
  const w = mkWs('Wrap');
  const c = store.loadConfig(w.id); c.schedule = { ...c.schedule, autopost: { ...c.schedule.autopost, on: true, days: [0, 1, 2, 3, 4, 5, 6], time: '09:00' } }; store.saveConfig(w.id, c);
  const acc = store.createAccount({ email: 'wrap@example.com', role: 'agent', workspaceId: w.id, hash: await auth.hashPassword('wrappass1234') });
  const day = '2026-10-19';
  assert.equal(today(w.id, acc, { now: Date.parse(at(day, '18:00')) }).wrap, undefined, 'a quiet day: nothing to wrap');
  vid(w, 'w1', { status: 'approved', approval: { at: at(day, '10:00') } });
  vid(w, 'w2', { status: 'rejected', rejection: { at: at(day, '11:00') } });
  clientsLib.add(w.id, { name: 'New One', stage: 'lead' });
  assert.equal(today(w.id, acc, { now: Date.parse(at(day, '15:00')) }).wrap, undefined, 'not before 5pm');
  const t = today(w.id, acc, { now: Date.parse(at(day, '18:00')) });
  assert.equal(t.wrap.date, day); assert.equal(t.wrap.approved, 1); assert.equal(t.wrap.rejected, 1); assert.equal(t.wrap.tomorrow, 'nothing', 'the one approved goes out today');
});

test('the portal knows the agent’s time zone, to write times the way she says them', async () => {
  const w = mkWs('Zone');
  const c = store.loadConfig(w.id); c.profile = { ...c.profile, timezone: 'America/New_York' }; store.saveConfig(w.id, c);
  store.createAccount({ email: 'zone@example.com', role: 'agent', workspaceId: w.id, hash: await auth.hashPassword('zonepass1234') });
  const z = client(port); await z.post('/api/login', { email: 'zone@example.com', password: 'zonepass1234' });
  assert.equal((await z.get('/api/me')).data.workspace.timezone, 'America/New_York');
});
