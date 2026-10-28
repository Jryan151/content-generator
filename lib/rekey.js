// lib/rekey.js — seals every stored secret again with the current key (lib/secrets.js): two-factor
// keys on logins, and each workspace's Instagram and Facebook tokens. Run after `node admin.js
// rotate-key` (it does this itself), and once by the v15 data changes, so tokens sealed the old way
// (with a key made from the Meta app secret) move onto the versioned key.
// A value that can't be opened with any key is left as it is (and counted), never thrown away.
import path from 'path';
import * as store from './store.js';
import { readJSON, updateJSON } from './paths.js';
import * as secrets from './secrets.js';
import * as ig from './instagram.js';
import * as fb from './facebook.js';

export function resealAll() {
  const out = { twofa: 0, instagram: 0, facebook: 0, unreadable: 0, current: 0 };
  const again = (sealed, open, close, kind) => {
    if (!sealed) return sealed;
    if (secrets.isCurrent(sealed)) { out.current++; return sealed; }
    const plain = open(sealed);
    if (plain == null) { out.unreadable++; return sealed; }
    out[kind]++;
    return close(plain);
  };
  for (const a of store.listAccounts()) {
    if (!a.twofa?.secret && !a.twofaPending?.secret) continue;
    const patch = {};
    if (a.twofa?.secret) patch.twofa = { ...a.twofa, secret: again(a.twofa.secret, s => secrets.unseal(s, 'twofa'), p => secrets.seal(p, 'twofa'), 'twofa') };
    if (a.twofaPending?.secret) patch.twofaPending = { ...a.twofaPending, secret: again(a.twofaPending.secret, s => secrets.unseal(s, 'twofa'), p => secrets.seal(p, 'twofa'), 'twofa') };
    store.updateAccount(a.id, patch);
  }
  for (const w of store.listWorkspaces()) {
    const igFile = path.join(store.wsDir(w.id), 'instagram.json');
    if (readJSON(igFile, null)?.token) updateJSON(igFile, {}, x => ({ ...x, token: again(x.token, ig.unseal, ig.seal, 'instagram') }));
    const fbFile = path.join(store.wsDir(w.id), 'facebook.json');
    const f = readJSON(fbFile, null);
    if (f?.token || f?.choose?.length) updateJSON(fbFile, {}, x => ({ ...x, ...(x.token ? { token: again(x.token, fb.unseal, fb.seal, 'facebook') } : {}), ...(x.choose ? { choose: x.choose.map(p => ({ ...p, token: again(p.token, fb.unseal, fb.seal, 'facebook') })) } : {}) }));
  }
  secrets.checkCanary();
  return out;
}
