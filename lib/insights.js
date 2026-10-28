// lib/insights.js — automatic results for posted Reels (on when INSTAGRAM_INSIGHTS=1).
// Once a day, for each video posted in the last 30 days, ask Instagram for its views, reach, likes,
// comments, shares and saves, and store them as the video's results. Messages can't be read from
// Instagram, so they stay one tap away for the agent ("It brought a message"). Results feed the same
// boosts as before: topics and openings that bring messages come up more often.
//
// Needs the instagram_business_manage_insights permission: agents who connected before this was on
// reconnect once in Brand. A video posted by hand is matched by its Instagram link.
import * as store from './store.js';
import * as ig from './instagram.js';
import { notify } from './alerts.js';

const DAY = 86400000;
export const RESULT_DAYS = 30;            // keep refreshing a video's numbers this long after posting
export const METRICS = ['views', 'reach', 'likes', 'comments', 'shares', 'saved'];
const n = x => Math.max(0, Math.round(Number(x) || 0));
// "https://www.instagram.com/reel/ABC123/?igsh=…" → "reel/abc123"
const linkKey = u => { const m = /instagram\.com\/(?:[\w.]+\/)?(reel|p|tv)\/([\w-]+)/i.exec(String(u || '')); return m ? `${m[1].toLowerCase() === 'tv' ? 'reel' : m[1].toLowerCase()}/${m[2].toLowerCase()}` : ''; };
export const _linkKey = linkKey;

// Insights replies list one entry per metric, with the number in values[0].value or total_value.value.
export function parseInsights(data) {
  const out = {};
  for (const x of data?.data || []) if (METRICS.includes(x.name)) out[x.name] = n(x.values?.[0]?.value ?? x.total_value?.value);
  return out;
}

async function mediaIdFor(ws, v, recentMedia) {
  if (v.autopost?.mediaId) return v.autopost.mediaId;
  if (v.results?.auto?.mediaId) return v.results.auto.mediaId;
  const key = linkKey(v.posted?.url);
  if (!key) return null;
  const list = await recentMedia();
  return list.find(m => linkKey(m.permalink) === key)?.id || null;
}

// Refreshes every connected workspace. Returns what changed (for logs and tests).
export async function refreshResults(now = Date.now()) {
  if (!ig.insightsOn()) return [];
  const out = [];
  for (const w of store.listWorkspaces()) { try {
    if (w.suspended || !ig.canReadInsights(w.id)) continue;
    const due = store.readVideos(w.id).filter(v => v.status === 'posted' && v.posted?.at && now - Date.parse(v.posted.at) < RESULT_DAYS * DAY
      && (!v.results?.auto?.at || now - Date.parse(v.results.auto.at) > 20 * 3600000));
    if (!due.length) continue;
    let media = null;
    const recentMedia = async () => (media ||= (await ig.graphGet(w.id, `${ig.userIdOf(w.id)}/media`, { fields: 'id,permalink,timestamp', limit: 50 })).data || []);
    for (const v of due) {
      try {
        const mediaId = await mediaIdFor(w.id, v, recentMedia);
        if (!mediaId) { out.push({ ws: w.id, video: v.id, skipped: 'no Instagram link' }); continue; }
        const got = parseInsights(await ig.graphGet(w.id, `${mediaId}/insights`, { metric: METRICS.join(',') }));
        store.updateVideo(w.id, v.id, x => ({ results: { ...(x.results || {}), ...got, messages: n(x.results?.messages), updatedAt: new Date(now).toISOString(), auto: { at: new Date(now).toISOString(), mediaId } } }));
        out.push({ ws: w.id, video: v.id, ...got });
      } catch (e) {
        // No permission (codes 10, 200) or a revoked token (190): stop for this workspace and say so once.
        if ([10, 190, 200].includes(e.code) || /permission/i.test(e.message)) {
          ig.markInsightsProblem(w.id, e.code === 190 ? 'reconnect' : 'permission');
          notify({ level: 'warning', kind: 'instagram', title: 'Instagram results need a reconnect', text: 'Instagram didn’t allow reading this account’s results.', did: 'Stopped reading results for this account (posting isn’t affected).', run: 'Ask the agent to reconnect in Setup → Autopilot → Instagram and allow results.', ws: w.id, workspaceName: w.name });
          out.push({ ws: w.id, error: e.message });
          break;
        }
        out.push({ ws: w.id, video: v.id, error: e.message });   // one video's hiccup; tried again tomorrow
      }
    }
  } catch (e) { store.skipWorkspace(w, e, 'results'); } }
  return out;
}
