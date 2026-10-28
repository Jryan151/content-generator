// public/screens/today.js — Today (v15 Phase 10): where the agent's day starts. The greeting is above it
// (as on every page). Below: the day's stops (what's waiting in Review, what's ready to post, who to
// follow up with), the day's list from the Desk, the week ahead, what's coming up, the coach's weekly
// check-in, and the month's recap or a nudge when videos keep missing. Each part links to where it's done.
import { S, aheadPanel, api, can, canSee, cantNow, esc, loadCfg, loadRecap, loadToday, main, plural, recapPanel, streakPanel, weekPanel } from '../app.js';
import { loadVideos, loadWeekly, weeklyPanel } from './review.js';

const KIND_ICON = { review: '▶', handoff: '↔', followup: '☎', care: '♥', results: '📈' };
// The daily chain (v15 Phase 10): each daily stop ends with the way to the next one, in the order a day
// goes: see what's waiting, decide on videos, make the next ones, follow up with people, then get better.
const CHAIN = [['today', 'Today'], ['review', 'Review'], ['create', 'Create'], ['leads', 'Leads'], ['grow', 'Grow']];
function chainFoot(view) {
  const list = CHAIN.filter(([k]) => canSee(k)), i = list.findIndex(([k]) => k === view), next = list[i + 1];
  if (i < 0 || !next) return '';
  return `<div class="row chain-next"><a class="btn ghost" href="#/${next[0]}">${view === 'today' ? `Start with ${esc(next[1])}` : `Next stop: ${esc(next[1])}`} →</a></div>`;
}
async function viewToday() {
  await Promise.all([loadToday(true), loadVideos().catch(() => { S.videos = S.videos || []; }), loadCfg().catch(() => {}), can('coach') ? loadWeekly() : null, loadTodayDesk()]);
  await loadRecap();
  drawToday();
  // A new week: write the coach's check-in once, as soon as there's something to look at.
  if (S.weekly && !S.weekly.current && !S.weeklyAsked && S.videos.length && !cantNow(false)) loadWeekly(true, true);
}
// The day's list comes from the Desk; if it can't load, Today says so (it isn't a clear day).
async function loadTodayDesk() { try { S.todayDesk = await api('/api/desk'); S.todayDeskFailed = false; } catch { S.todayDesk = null; S.todayDeskFailed = true; } }
function stop(href, n, one, many, note = '') {
  return `<a class="stop${n ? '' : ' quiet'}" href="${href}"><b>${n}</b><span>${esc(n === 1 ? one : many)}</span>${note ? `<small>${esc(note)}</small>` : ''}</a>`;
}
function drawToday() {
  const t = S.today || {}, vids = S.videos || [], D = S.todayDesk;
  const pending = vids.filter(v => v.status === 'pending').length, ready = vids.filter(v => v.status === 'approved').length;
  const due = (D?.due || []).length, list = D?.list || [], needResults = (S.stats?.needResults || []).length;
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: S.me.workspace?.timezone || undefined });
  main.innerHTML = `<div class="head"><h1>Today</h1><p class="lede">${esc(date)}${t.away ? ' · you’re away' : t.dayOff ? ' · your day off' : ''}</p></div>
    <section class="stops" aria-label="Today’s stops">
      ${stop('#/review', pending, 'video to review', 'videos to review', can('approve') ? '' : 'for the agent')}
      ${stop('#/review', ready, 'ready to post', 'ready to post')}
      ${D?.stages ? stop('#/leads', due, 'follow-up due', 'follow-ups due') : ''}
      ${stop('#/create', S.me.workspace ? Math.max(0, (S.me.workspace.limit || 0) - (S.me.workspace.used || 0)) : 0, 'video left this month', 'videos left this month')}
    </section>
    <section class="panel"><div class="row between"><h2>Your list</h2>${D ? '<a class="small" href="#/leads">Leads →</a>' : ''}</div>${list.length ? `<div class="stack" style="gap:6px">${list.map(x => `<a class="row box today-item" href="#/${esc(x.go)}"><span aria-hidden="true">${KIND_ICON[x.kind] || '•'}</span><span class="small${['followup', 'care'].includes(x.kind) ? ' pii' : ''}" style="flex:1">${esc(x.text)}</span><span class="muted" aria-hidden="true">›</span></a>`).join('')}</div>` : S.todayDeskFailed ? '<p class="empty">Couldn’t load your list just now. <button class="btn sm ghost" data-act="today-retry">Try again</button></p>' : '<p class="empty">Nothing needs you today. 👍</p>'}</section>
    ${streakPanel()}
    ${weekPanel()}
    ${aheadPanel()}
    ${recapPanel()}
    ${can('coach') ? weeklyPanel() : ''}
    ${needResults && can('results') ? `<div class="note warn">${plural(needResults, 'posted video')} ${needResults > 1 ? 'are' : 'is'} ready for results. <a href="#/review">Add views and messages</a>; they decide which topics come up more.</div>` : ''}
    ${chainFoot('today')}`;
}
export { chainFoot, drawToday, viewToday };
