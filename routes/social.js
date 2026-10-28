// routes/social.js — Instagram; Facebook Page (cross-posting Reels).
// Split out of server.js by area (v15). server.js mounts it, passing in the helpers these routes share
// with the rest of the server; the capability each route needs is still listed in one place
// (server.js ROUTE_CAPS). The code below is as it was in server.js (not re-indented, so its text and
// templates are unchanged).
import * as store from '../lib/store.js';
import * as ig from '../lib/instagram.js';
import * as fb from '../lib/facebook.js';
import * as audit from '../lib/audit.js';
import * as insights from '../lib/insights.js';
import { bestPostingHour } from '../mixer-core.js';

export default function mount(ctx) {
const { BASE_HEADERS, api, bad, clientIp, clip, nowIso, route, who } = ctx;
/* ----- Instagram ----- */
route('GET', '/api/instagram', 'ws', ({ wsId }) => ({ enabled: ig.igOn(), ready: ig.publicOk(), insights: ig.insightsOn(), account: ig.account(wsId), bestHour: bestPostingHour(store.readVideos(wsId), store.loadConfig(wsId).profile?.timezone) }));
route('POST', '/api/instagram/connect', 'ws', ({ wsId, me }) => {
  try { return { url: ig.connectUrl(wsId, me.account.id) }; } catch (e) { bad(400, e.message); }
});
route('DELETE', '/api/instagram', 'ws', ({ wsId }) => { ig.disconnect(wsId); return { account: ig.account(wsId) }; });
// Instagram sends the browser back here. The state says which workspace it was for.
route('GET', '/api/instagram/callback', 'public', async ({ req, res, url, me }) => {
  const q = url.searchParams, back = (msg, ok = false) => {
    res.writeHead(302, { Location: `/#/autopilot?ig=${ok ? 'connected' : 'error'}${msg ? `&msg=${encodeURIComponent(msg)}` : ''}`, 'Cache-Control': 'no-store', ...BASE_HEADERS });
    res.end();
  };
  if (q.get('error')) return back(q.get('error_reason') === 'user_denied' ? 'You canceled the connection.' : 'Instagram didn’t connect. Try again.');
  try {
    const r = await ig.finishConnect({ state: q.get('state'), code: q.get('code'), accountId: me?.account?.id || '' });
    audit.record({ action: 'instagram.connected', who: me?.account || null, ws: r.ws, detail: r.username ? `@${r.username}` : '', ip: clientIp(req) });
    // (v15) Keyword replies: Instagram is asked to send this account's comments and messages here.
    if (ig.canReply(r.ws)) ig.subscribeReplies(r.ws).catch(e => console.error('[instagram] replies subscription:', e.message));
    back(r.username ? `@${r.username}` : '', true);
  }
  catch (e) { back(clip(e.message, 200)); }
});

/* ----- Facebook Page (cross-posting Reels) ----- */
route('GET', '/api/facebook', 'ws', ({ wsId }) => ({ enabled: fb.fbOn(), ready: ig.publicOk(), account: fb.account(wsId) }));
route('POST', '/api/facebook/connect', 'ws', ({ wsId, me }) => {
  try { return { url: fb.connectUrl(wsId, me.account.id) }; } catch (e) { bad(400, e.message); }
});
route('POST', '/api/facebook/page', 'ws', ({ wsId, body, me }) => {
  try { return { account: fb.pickPage(wsId, clip(body.pageId, 40), me.account.id) }; } catch (e) { bad(e.status || 400, e.message); }
});
route('DELETE', '/api/facebook', 'ws', ({ wsId }) => {
  fb.disconnect(wsId);
  // Nothing scheduled for a Page that's gone stays waiting.
  for (const v of store.readVideos(wsId).filter(x => ['scheduled', 'processing'].includes(x.fbpost?.status))) {
    store.updateVideo(wsId, v.id, { fbpost: v.fbpost.status === 'scheduled' ? null : { ...v.fbpost, status: 'failed', error: 'Facebook was disconnected while this was posting. Check your Page to see if it went out.', failedAt: nowIso() } });
  }
  return { account: fb.account(wsId) };
});
route('GET', '/api/facebook/callback', 'public', async ({ req, res, url, me }) => {
  const q = url.searchParams, back = (msg, ok = false, choose = false) => {
    res.writeHead(302, { Location: `/#/autopilot?fb=${choose ? 'choose' : ok ? 'connected' : 'error'}${msg ? `&msg=${encodeURIComponent(msg)}` : ''}`, 'Cache-Control': 'no-store', ...BASE_HEADERS });
    res.end();
  };
  if (q.get('error')) return back(q.get('error_reason') === 'user_denied' ? 'You canceled the connection.' : 'Facebook didn’t connect. Try again.');
  try {
    const r = await fb.finishConnect({ state: q.get('state'), code: q.get('code'), accountId: me?.account?.id || '' });
    audit.record({ action: 'facebook.connected', who: me?.account || null, ws: r.ws, detail: r.pageName || (r.choose ? 'choosing a Page' : ''), ip: clientIp(req) });
    back(r.pageName, true, r.choose);
  }
  catch (e) { back(clip(e.message, 200)); }
});
}
