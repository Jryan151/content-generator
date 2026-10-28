// test/kits/footage-kit.js — what every stock-footage source (lib/plugins.js "footage") must do.
// `harness`: { env: {…} pointing it at a stand-in API with results for "family" }.
import assert from 'node:assert/strict';
import { problemsOf, list } from '../../lib/plugins.js';

export async function footageKit(t, part, harness) {
  await t.test(`${part.id}: fits the footage mount`, () => assert.deepEqual(problemsOf('footage', part), []));
  await t.test(`${part.id}: its clip ids are its own (no other source claims them)`, () => {
    for (const other of list('footage').filter(s => s.id !== part.id)) for (const id of harness.sampleIds) assert.equal(other.owns(id), false, `${other.id} claims ${id}`);
    for (const id of harness.sampleIds) assert.equal(part.owns(id), true);
  });
  await t.test(`${part.id}: a search returns clips in the common shape, and each can be fetched again by id`, async () => {
    const keep = { ...process.env };
    Object.assign(process.env, harness.env);
    try {
      assert.equal(part.on(), true);
      const hits = await part.search('family', { people: true });
      assert.ok(hits.length >= 1);
      for (const h of hits.slice(0, 3)) {
        assert.ok(h.id !== undefined && part.owns(h.id), `owns ${h.id}`);
        assert.equal(typeof h.tags, 'string');
        assert.match(String(h.videos?.medium?.url || h.videos?.large?.url), /^https?:\/\//);
      }
      const again = await part.byId(hits[0].id);
      assert.equal(String(again?.id), String(hits[0].id));
    } finally { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); }
  });
}
