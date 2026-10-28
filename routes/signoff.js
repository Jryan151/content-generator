// routes/signoff.js — the compliance reviewer's page (v15 Phase 9, lib/signoff.js): what's waiting for
// their sign-off, and their decision. The agent turns sign-off on and invites the reviewer under People
// (routes/people.js).
import * as store from '../lib/store.js';
import * as roles from '../lib/roles.js';
import * as push from '../lib/push.js';
import * as signoff from '../lib/signoff.js';

export default function mount(ctx) {
const { bad, clip, route } = ctx;
const ownersOf = wsId => store.listAccounts().filter(a => !a.disabled && roles.membership(a, wsId)?.role === 'owner').map(a => a.id);

route('GET', '/api/signoff', 'ws', ({ wsId }) => signoff.listFor(wsId));
route('POST', '/api/signoff/:id', 'ws', ({ wsId, params, body, me }) => {
  let v;
  try { v = signoff.decide(wsId, params.id, { ok: body.ok === true, note: clip(body.note, 600), version: body.version, by: me.account.id, byName: me.account.name || me.account.email }); }
  catch (e) { bad(e.status || 400, e.message); }
  // The agent hears either way: signed off (it can post now), or sent back (it's in Review with the note).
  const cfg = store.loadConfig(wsId), topic = clip(v.meta?.painPoint || v.scenes?.[0]?.text || 'A video', 80);
  const ok = v.signoff.status === 'ok';
  push.send(wsId, ok
    ? { title: 'Signed off', body: `${me.account.name || 'Your reviewer'} signed off “${topic}”. It can post now.`, url: '/#/review', tag: `signoff-${v.id}` }
    : { title: 'Sent back by your reviewer', body: `${me.account.name || 'Your reviewer'}: ${clip(v.signoff.note, 120)}`, url: '/#/review', tag: `signoff-${v.id}` },
  { tz: cfg.profile?.timezone || 'America/Denver', daysOff: cfg.profile?.daysOff || [], accountIds: ownersOf(wsId) }).catch(() => {});
  return { ...signoff.listFor(wsId), decided: { id: v.id, status: v.signoff.status } };
});
}
