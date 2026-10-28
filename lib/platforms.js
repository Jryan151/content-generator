// lib/platforms.js — the posting platforms, on their standard mount (lib/plugins.js). The posting plan,
// the minute tick and Admin go through this list, so a new platform (phase 9: TikTok, YouTube Shorts)
// is one more module registered here.
import { register, list, get } from './plugins.js';
import * as ig from './instagram.js';
import * as fb from './facebook.js';

register('platform', {
  id: 'instagram', label: 'Instagram',
  on: () => ig.igOn(), account: ws => ig.account(ws),
  schedulePost: (...a) => ig.schedulePost(...a), cancelPost: (...a) => ig.cancelPost(...a), tick: now => ig.tick(now),
  stateOf: v => v?.autopost?.status || '',
});
register('platform', {
  id: 'facebook', label: 'Facebook',
  on: () => fb.fbOn(), account: ws => fb.account(ws),
  schedulePost: (...a) => fb.schedulePost(...a), cancelPost: (...a) => fb.cancelPost(...a), tick: now => fb.tick(now),
  stateOf: v => v?.fbpost?.status || '',
});

export const platforms = () => list('platform');
export const platform = id => get('platform', id);
// Each set-up platform's minute tick, one after the other (one failing doesn't stop the rest).
export async function tickAll(now = Date.now()) {
  const out = {};
  for (const p of platforms()) { if (!p.on()) continue; try { out[p.id] = await p.tick(now); } catch (e) { console.error(`[${p.id}]`, e.message); out[p.id] = { error: e.message }; } }
  return out;
}
