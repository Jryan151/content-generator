// v14 Phase 7: the Assistant Desk. Paid assistant seats (Stripe quantity, or given in Admin), invites
// and memberships, "can post" per assistant, two-factor required for assistants, handoffs between the
// assistant and the agent, leads and follow-ups, client care, today's list and the activity feed.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { tempEnv, startStubs, client } from './helpers.js';

tempEnv();
const stubs = await startStubs();
const store = await import('../lib/store.js');
const auth = await import('../lib/auth.js');
const roles = await import('../lib/roles.js');
const twofa = await import('../lib/twofa.js');
const clients = await import('../lib/clients.js');
const { starterStory } = await import('../templates.js');
const S = await import('../server.js');
const server = await S.start({ port: 0, scheduler: false, worker: false });
const port = server.address().port;

// A stand-in Stripe for seats: one subscription whose items change.
const subs = {};
const stripe = http.createServer((req, res) => {
  let raw = ''; req.on('data', d => { raw += d; }); req.on('end', () => {
    const p = new URLSearchParams(raw), url = new URL(req.url, 'http://x');
    const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    let m;
    if (req.method === 'GET' && (m = /\/subscriptions\/(\w+)$/.exec(url.pathname))) return send(200, subs[m[1]]);
    if (req.method === 'GET' && /\/prices\/price_seat$/.test(url.pathname)) return send(200, { id: 'price_seat', unit_amount: 2900, currency: 'usd', recurring: { interval: 'month' } });
    if (req.method === 'POST' && url.pathname.endsWith('/subscription_items')) { const s = subs[p.get('subscription')]; s.items.data.push({ id: 'si_seat', price: { id: p.get('price') }, quantity: Number(p.get('quantity')) }); return send(200, {}); }
    if ((m = /\/subscription_items\/(\w+)$/.exec(url.pathname))) {
      for (const s of Object.values(subs)) {
        const i = s.items.data.findIndex(x => x.id === m[1]);
        if (i < 0) continue;
        if (req.method === 'DELETE') s.items.data.splice(i, 1); else s.items.data[i].quantity = Number(p.get('quantity'));
      }
      return send(200, {});
    }
    send(404, { error: { message: 'nope' } });
  });
});
await new Promise(r => stripe.listen(0, '127.0.0.1', r));
test.after(() => { server.close(); stubs.close(); stripe.close(); });

const ws = store.createWorkspace({ name: 'Desk Agent', comped: true });
const cfg = store.loadConfig(ws.id);
cfg.story = { ...cfg.story, ...starterStory(['final_expense']) };
cfg.story.insights.forEach(i => { i.confirmed = true; i.confirmedAt = new Date().toISOString(); });
store.saveConfig(ws.id, cfg);
store.updateWorkspace(ws.id, { onboarded: true });
const owner = store.createAccount({ email: 'agent@example.com', name: 'Dana Agent', role: 'agent', workspaceId: ws.id, hash: await auth.hashPassword('agentpass123') });
store.createAccount({ email: 'boss@example.com', role: 'admin', hash: await auth.hashPassword('bosspass1234') });
const login = async (email, pass) => { const c = client(port); const r = await c.post('/api/login', { email, password: pass }); assert.equal(r.status, 200, JSON.stringify(r.data)); return c; };
const agent = await login('agent@example.com', 'agentpass123');

test('seats: none to start; given in Admin; an invite needs a free seat and becomes an assistant', async () => {
  let p = (await agent.get('/api/people')).data;
  assert.deepEqual([p.seats.total, p.seats.used], [0, 0]);
  assert.equal(p.seats.managedBy, 'admin');
  assert.equal((await agent.post('/api/people/invite', { email: 'sam@example.com' })).status, 409, 'no seat');
  const boss = await login('boss@example.com', 'bosspass1234');
  await boss.post(`/api/admin/workspaces/${ws.id}`, { assistantSeats: 1 });
  const inv = await agent.post('/api/people/invite', { email: 'sam@example.com', canPost: false });
  assert.equal(inv.status, 200, JSON.stringify(inv.data));
  assert.match(inv.data.link, /#\/invite\//);
  assert.deepEqual([inv.data.seats.used, inv.data.seats.free], [1, 0], 'an invite holds the seat');
  assert.equal((await agent.post('/api/people/invite', { email: 'kim@example.com' })).status, 409);
  // Sending it again replaces the first link and still holds one seat.
  const again = await agent.post('/api/people/invite', { email: 'sam@example.com', canPost: false });
  assert.equal(again.status, 200); assert.equal(again.data.seats.used, 1); assert.equal(again.data.invites.length, 1);
  assert.equal((await client(port).post('/api/link/check', { kind: 'invite', token: inv.data.link.split('/invite/')[1] })).status, 410, 'the old link stops working');
  inv.data.link = again.data.link;
  // Accepting it makes an assistant in this workspace.
  const token = inv.data.link.split('/invite/')[1];
  const pub = client(port);
  assert.equal((await pub.post('/api/link/check', { kind: 'invite', token })).data.role, 'assistant');
  const ok = await pub.post('/api/link/accept', { kind: 'invite', token, name: 'Sam Helper', password: 'sampass12345' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const sam = store.findAccountByEmail('sam@example.com');
  assert.equal(roles.membership(sam, ws.id).role, 'assistant');
  const was = process.env.TWO_FACTOR; process.env.TWO_FACTOR = 'admins';   // the default (tests turn it off)
  try {
    assert.equal(twofa.required(sam), true, 'assistants log in with two-factor');
    assert.equal(twofa.required(store.getAccount(owner.id)), false);
  } finally { process.env.TWO_FACTOR = was; }
  p = (await agent.get('/api/people')).data;
  assert.equal(p.people.find(x => x.email === 'sam@example.com').role, 'assistant');
  assert.deepEqual([p.seats.used, p.invites.length], [1, 0]);
});

test('can post: off by default, the agent turns it on', async () => {
  const sam = store.findAccountByEmail('sam@example.com');
  assert.ok(!roles.capsFor(sam, store.getWorkspace(ws.id)).includes('post'));
  const r = await agent.put(`/api/people/${sam.id}`, { canPost: true });
  assert.equal(r.status, 200);
  assert.ok(roles.capsFor(store.getAccount(sam.id), store.getWorkspace(ws.id)).includes('post'));
  assert.equal((await agent.put('/api/people/nobody', { canPost: true })).status, 404);
});

test('an assistant can’t manage people or seats', async () => {
  const sam = await login('sam@example.com', 'sampass12345');
  assert.equal((await sam.get('/api/people')).status, 403);
  assert.equal((await sam.post('/api/people/invite', { email: 'x@example.com' })).status, 403);
  assert.equal((await sam.post('/api/billing/seats', { seats: 3 })).status, 403);
  assert.equal((await sam.get('/api/records.csv')).status, 403, 'approval records are the agent’s data');
  const people = (await sam.get('/api/desk')).data.people;
  assert.ok(people.every(p => !('email' in p)));
});

test('handoffs: the assistant drafts, the agent finishes; today’s list for each', async () => {
  // Two-factor is required for assistants; tests turn it off to log in simply.
  const sam = await login('sam@example.com', 'sampass12345');
  const h = await sam.post('/api/desk/handoffs', { kind: 'reply', title: 'Reply to Maria', message: 'How much for my mom?', draft: 'Thanks for asking! Every family is different, so let’s talk.' });
  assert.equal(h.status, 200, JSON.stringify(h.data));
  assert.equal((await sam.post('/api/desk/handoffs', { kind: 'note' })).status, 400, 'something to hand off');
  const d = (await agent.get('/api/desk')).data;
  assert.equal(d.handoffs[0].byName, 'Sam Helper'); assert.equal(d.handoffs[0].to, owner.id, 'from an assistant, it’s for the agent');
  assert.equal((await sam.post(`/api/desk/handoffs/${d.handoffs[0].id}/done`, {})).status, 403, 'only the person it’s for finishes it');
  assert.ok(d.list.some(x => x.kind === 'handoff' && /1 handoff for you/.test(x.text)));
  assert.equal((await agent.post(`/api/desk/handoffs/${d.handoffs[0].id}/done`, {})).status, 200);
  assert.equal((await agent.post(`/api/desk/handoffs/${d.handoffs[0].id}/done`, {})).status, 404, 'once');
  // The assistant's today list says who approves.
  store.addVideo(ws.id, { id: 'dv1', status: 'pending', file: 'video_dv1.mp4', createdAt: new Date().toISOString(), meta: {}, scenes: [{ text: 'Hi' }], clips: [] });
  const sl = (await sam.get('/api/desk')).data.list;
  assert.ok(sl.some(x => /waiting for the agent to approve/.test(x.text)));
  assert.ok((await agent.get('/api/desk')).data.list.some(x => /1 video to watch and approve/.test(x.text)));
  // Only the agent sees the activity feed.
  assert.equal((await sam.get('/api/desk/activity')).status, 403);
  const act = (await agent.get('/api/desk/activity')).data.activity;
  assert.ok(act.some(e => e.who === 'Sam Helper' && e.what === 'handed something off'));
});

test('leads and follow-ups; client care from birthdays, anniversaries and quiet months', async () => {
  const sam = await login('sam@example.com', 'sampass12345');
  const today = (await sam.get('/api/desk')).data.today;
  const lead = await sam.post('/api/clients', { name: 'Maria Lopez', stage: 'lead', phone: '555-0100', source: 'the funeral costs video', next: today });
  assert.equal(lead.status, 200, JSON.stringify(lead.data));
  assert.equal(lead.data.client.stage, 'lead');
  let d = (await sam.get('/api/desk')).data;
  assert.equal(d.pipeline.lead, 1); assert.ok(d.due.some(c => c.name === 'Maria Lopez')); assert.ok(d.leads.some(c => c.name === 'Maria Lopez'));
  await sam.put(`/api/clients/${lead.data.client.id}`, { stage: 'booked' });
  assert.equal((await sam.get('/api/desk')).data.pipeline.booked, 1);
  // Care: a birthday in a few days, a policy that turns three, someone quiet for a year.
  const plus = n => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const bd = plus(3).slice(5), since = `${Number(plus(5).slice(0, 4)) - 3}${plus(5).slice(4)}`;
  await agent.post('/api/clients', { name: 'Rosa', birthday: bd, last: plus(-1) });
  await agent.post('/api/clients', { name: 'Ken', since, last: plus(-1) });
  await agent.post('/api/clients', { name: 'Old Friend', last: plus(-400) });
  const care = clients.careDue(ws.id, today, 14);
  assert.ok(care.some(x => x.kind === 'birthday' && x.name === 'Rosa' && x.date === plus(3)));
  assert.ok(care.some(x => x.kind === 'anniversary' && /turns 3/.test(x.text)));
  assert.ok(care.some(x => x.kind === 'quiet' && x.name === 'Old Friend'));
  assert.ok(!care.some(x => x.name === 'Maria Lopez' && x.kind !== 'thanks'), 'leads aren’t in client care (v15: only a thank-you once they book)');
  assert.equal(clients.cleanClient({ name: 'X', birthday: '13-40', stage: 'weird' }).birthday, ''); assert.equal(clients.cleanClient({ name: 'X', stage: 'weird' }).stage, 'client');
  assert.equal(clients.cleanClient({ name: 'X', birthday: '02-30' }).birthday, ''); assert.equal(clients.cleanClient({ name: 'X', birthday: '02-29' }).birthday, '02-29');
  // Done with a care item: it leaves the list and counts as contact; the follow-up date stays.
  const rosa = care.find(x => x.name === 'Rosa');
  const after = await agent.post(`/api/clients/${rosa.id}/care`, { key: rosa.key });
  assert.equal(after.status, 200); assert.ok(!after.data.care.some(x => x.key === rosa.key && x.id === rosa.id));
  assert.equal((await agent.post(`/api/clients/${rosa.id}/care`, { key: 'nonsense' })).status, 400);
  // Leads don't appear in Mindset's relationship notes.
  assert.ok(!(await agent.get('/api/mindset')).data.clients.some(c => c.name === 'Maria Lopez'));
});

test('removing an assistant frees the seat; someone with nowhere else to work loses the login', async () => {
  const sam = store.findAccountByEmail('sam@example.com');
  const r = await agent.del(`/api/people/${sam.id}`);
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.seats.used, r.data.seats.free], [0, 1]);
  assert.equal(store.getAccount(sam.id), null, 'nowhere else to work: the login is removed, so they can be invited again');
  // Someone with a login already (helping another agent) says yes before joining.
  const other = store.createWorkspace({ name: 'Other', comped: true });
  store.updateWorkspace(other.id, { onboarded: true });
  const kim = store.createAccount({ email: 'kim@example.com', role: 'agent', workspaceId: other.id, hash: await auth.hashPassword('kimpass12345') });
  const add = await agent.post('/api/people/invite', { email: 'kim@example.com' });
  assert.ok(add.data.link, 'the same reply as for anyone else');
  assert.equal(roles.membership(store.getAccount(kim.id), ws.id), null, 'not added until they accept');
  const token = add.data.link.split('/invite/')[1];
  assert.equal((await client(port).post('/api/link/check', { kind: 'invite', token })).data.existing, true);
  assert.equal((await agent.post('/api/link/join', { token })).status, 403, 'only the invited email can accept');
  const kc = await login('kim@example.com', 'kimpass12345');
  assert.equal((await kc.post('/api/link/join', { token })).status, 200);
  assert.equal(roles.membership(store.getAccount(kim.id), ws.id).role, 'assistant');
  assert.equal(roles.membership(store.getAccount(kim.id), other.id).role, 'owner', 'still the owner of their own');
  // Seats can't drop below what's in use; lowering them in Admin pauses the newest assistant.
  const boss = await login('boss@example.com', 'bosspass1234');
  await boss.post(`/api/admin/workspaces/${ws.id}`, { assistantSeats: 0 });
  const paused = await kc.get('/api/desk');
  assert.equal(paused.status, 402); assert.match(paused.data.error, /no assistant seat/);
  assert.equal((await agent.get('/api/people')).data.people.find(p => p.email === 'kim@example.com').paused, true);
  await boss.post(`/api/admin/workspaces/${ws.id}`, { assistantSeats: 1 });
  assert.equal((await kc.get('/api/desk')).status, 200, 'back when there’s a seat');
  await agent.del(`/api/people/${kim.id}`);
  assert.equal(store.getAccount(kim.id).disabled, false, 'they keep their own workspace');
  await agent.post('/api/people/invite', { email: 'lee@example.com' });
  const back = await agent.post('/api/people/invites/revoke', { email: 'lee@example.com' });
  assert.equal(back.data.invites.length, 0);
});

test('paid seats are a quantity on the Stripe subscription', async () => {
  Object.assign(process.env, { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_API_BASE: `http://127.0.0.1:${stripe.address().port}/v1`, STRIPE_PRICE_STARTER: 'price_starter', STRIPE_PRICE_SEAT: 'price_seat' });
  try {
    const w2 = store.createWorkspace({ name: 'Paying', comped: false });
    store.updateWorkspace(w2.id, { onboarded: true, billing: { status: 'active', plan: 'starter', subscriptionId: 'sub_9', customerId: 'cus_9' } });
    subs.sub_9 = { id: 'sub_9', object: 'subscription', status: 'active', customer: 'cus_9', items: { data: [{ id: 'si_plan', price: { id: 'price_starter' }, quantity: 1, current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30 }] } };
    store.createAccount({ email: 'payer@example.com', role: 'agent', workspaceId: w2.id, hash: await auth.hashPassword('payerpass123') });
    const c = await login('payer@example.com', 'payerpass123');
    let p = (await c.get('/api/people')).data;
    assert.equal(p.seats.canBuy, true); assert.equal(p.price.amount, 2900);
    const up = await c.post('/api/billing/seats', { seats: 2 });
    assert.equal(up.status, 200, JSON.stringify(up.data));
    assert.equal(up.data.seats.total, 2);
    assert.equal(store.getWorkspace(w2.id).billing.plan, 'starter', 'the plan is still read from its own item');
    assert.equal((await c.post('/api/billing/seats', { seats: 1 })).data.seats.total, 1);
    assert.equal((await c.post('/api/billing/seats', { seats: 0 })).data.seats.total, 0);
    assert.equal(subs.sub_9.items.data.length, 1, 'the seat item is removed at zero');
    // Seats in use can't be dropped.
    await c.post('/api/billing/seats', { seats: 1 });
    await c.post('/api/people/invite', { email: 'helper@example.com' });
    assert.equal((await c.post('/api/billing/seats', { seats: 0 })).status, 409);
    assert.equal((await c.get('/api/people')).data.seats.paid, 1);
    // A comped workspace's seats come from Admin.
    assert.equal((await agent.post('/api/billing/seats', { seats: 2 })).status, 409);
  } finally { ['STRIPE_SECRET_KEY', 'STRIPE_API_BASE', 'STRIPE_PRICE_STARTER', 'STRIPE_PRICE_SEAT'].forEach(k => delete process.env[k]); }
});

test('a handoff for no one in particular can be finished by anyone but its maker; lowered seats pause the newest assistant', async () => {
  const w3 = store.createWorkspace({ name: 'Three', comped: true });
  store.updateWorkspace(w3.id, { onboarded: true, limits: { assistantSeats: 2 } });
  store.createAccount({ email: 'own3@example.com', role: 'agent', workspaceId: w3.id, hash: await auth.hashPassword('own3pass1234') });
  const first = store.createAccount({ email: 'first3@example.com', role: 'agent', workspaceId: null, hash: await auth.hashPassword('first3pass12') });
  const second = store.createAccount({ email: 'second3@example.com', role: 'agent', workspaceId: null, hash: 'x' });
  store.setMembership(first.id, w3.id, { role: 'assistant', since: '2026-01-01T00:00:00.000Z' });
  store.setMembership(second.id, w3.id, { role: 'assistant', since: '2026-02-01T00:00:00.000Z' });
  const o = await login('own3@example.com', 'own3pass1234'), a = await login('first3@example.com', 'first3pass12');
  const h = (await o.post('/api/desk/handoffs', { kind: 'lead', title: 'Call Maria back' })).data.handoffs[0];
  assert.equal(h.to, '', 'the agent named no one');
  assert.equal((await o.post(`/api/desk/handoffs/${h.id}/done`, {})).status, 200, 'the agent can still close it');
  const h2 = (await o.post('/api/desk/handoffs', { kind: 'lead', title: 'Call Ken' })).data.handoffs[0];
  assert.equal((await a.post(`/api/desk/handoffs/${h2.id}/done`, {})).status, 200, 'an assistant picks it up');
  // Seats lowered to one: the newer assistant is paused, the first keeps working.
  store.updateWorkspace(w3.id, { limits: { assistantSeats: 1 } });
  assert.equal(S.hasSeat(store.getAccount(first.id), w3.id), true);
  assert.equal(S.hasSeat(store.getAccount(second.id), w3.id), false);
  assert.equal((await o.post('/api/billing/seats', { seats: 'many' })).status, 400);
  // People names on the Desk never fall back to emails.
  const people = (await a.get('/api/desk')).data.people;
  assert.ok(people.some(p => p.name === 'Assistant') && people.every(p => !/@/.test(p.name)));
});
