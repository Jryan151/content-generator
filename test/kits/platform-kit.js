// test/kits/platform-kit.js — what every posting platform (lib/plugins.js "platform") must do, run by
// test/v15-plugins.test.js for each one. A new platform passes this before it's added.
//
// `harness` (from the platform's own test): { env: {…} to switch it on with a stand-in API,
// connect(ws) to give a workspace a working connection, published() → how many posts the stand-in
// received }. The kit checks the shape, the "off" behaviour, and a real post going out exactly once.
import assert from 'node:assert/strict';
import { problemsOf } from '../../lib/plugins.js';

export async function platformKit(t, part, harness, { store }) {
  await t.test(`${part.id}: fits the platform mount`, () => assert.deepEqual(problemsOf('platform', part), []));
  await t.test(`${part.id}: switched off, it does nothing and says so`, async () => {
    const keep = { ...process.env };
    for (const k of Object.keys(harness.env)) delete process.env[k];
    try {
      assert.equal(part.on(), false);
      assert.deepEqual(await part.tick(), []);
    } finally { Object.assign(process.env, keep); }
  });
  await t.test(`${part.id}: a fresh workspace isn't connected; nothing scheduled, nothing to cancel`, () => {
    const ws = store.createWorkspace({ name: `Kit ${part.id} fresh`, comped: true });
    assert.equal(!!part.account(ws.id).connected, false);
    assert.equal(part.stateOf({}), '');
    store.addVideo(ws.id, { id: 'k0', status: 'approved', file: 'video_k0.mp4', createdAt: new Date().toISOString(), approval: { at: new Date().toISOString() } });
    assert.equal(part.cancelPost(ws.id, 'k0'), false);
  });
  await t.test(`${part.id}: an approved video posts exactly once, and only an approved one`, async () => {
    Object.assign(process.env, harness.env);
    try {
      assert.equal(part.on(), true);
      const ws = store.createWorkspace({ name: `Kit ${part.id}`, comped: true });
      harness.connect(ws);
      assert.equal(part.account(ws.id).connected, true);
      store.addVideo(ws.id, { id: 'kp', status: 'pending', file: 'video_kp.mp4', post: 'Kit post', createdAt: new Date().toISOString() });
      assert.throws(() => part.schedulePost(ws.id, 'kp', 'now', 'kit'), 'a video not approved isn’t posted');
      store.updateVideo(ws.id, 'kp', { status: 'approved', approval: { at: new Date().toISOString() } });
      part.schedulePost(ws.id, 'kp', 'now', 'kit');
      assert.equal(part.stateOf(store.getVideo(ws.id, 'kp')), 'scheduled');
      const before = harness.published();
      for (let i = 0; i < 6 && part.stateOf(store.getVideo(ws.id, 'kp')) !== 'posted'; i++) await part.tick();
      assert.equal(part.stateOf(store.getVideo(ws.id, 'kp')), 'posted');
      for (let i = 0; i < 3; i++) await part.tick();
      assert.equal(harness.published() - before, 1, 'exactly once');
      assert.throws(() => part.schedulePost(ws.id, 'kp', 'now', 'kit'), 'already posted: not again');
    } finally { for (const k of Object.keys(harness.env)) delete process.env[k]; }
  });
}
