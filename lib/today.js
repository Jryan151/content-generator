// lib/today.js — the greeting on open, the week ahead and milestones, in one small read
// (GET /api/today). The portal shows the greeting once a day; everything here is quiet when there's
// nothing worth saying.
import { localTime } from './paths.js';
import * as store from './store.js';
import * as memory from './memory.js';
import * as mindset from './mindset.js';
import { weekAhead } from '../mixer-core.js';
import { principleFor, BOOKS, dayKey, weekOf } from '../mindset-core.js';
import * as chauffeur from './chauffeur.js';
import * as signoff from './signoff.js';
import * as queue from './queue.js';
import { list as readClients } from './clients.js';
import { list as readDesk } from './desk.js';

// Each milestone is reached once. `n`: how far along the agent is, for the check.
const posted = vs => vs.filter(v => v.status === 'posted').length;
const messages = vs => vs.reduce((a, v) => a + (v.results?.messages || 0), 0);
export const MILESTONES = [
  // Only for the real first video (v15): with more than two made already, it's old news, set aside quietly;
  // and it shows once, not every time the page opens.
  { id: 'first_video', test: vs => vs.length >= 1, until: vs => vs.length <= 2, once: true, title: 'Your first video is made', text: 'Watch it with sound. Approving it is the first step to posting.' },
  { id: 'first_approved', test: vs => vs.some(v => v.approval?.at), title: 'First video approved', text: 'That’s one ready to go out. Posting a few a week is what brings people to you.' },
  { id: 'first_post', test: vs => posted(vs) >= 1, title: 'You posted your first video', text: 'Add its views and messages in a few days. They teach the system what works for you.' },
  { id: 'first_message', test: vs => messages(vs) >= 1, title: 'A video brought you a message', text: 'Someone reached out because of something you made. That’s the whole point.' },
  { id: 'posts_10', test: vs => posted(vs) >= 10, title: '10 videos posted', text: 'Showing up is most of it. Your topics and openings are learning from every one.' },
  { id: 'posts_25', test: vs => posted(vs) >= 25, title: '25 videos posted', text: 'Most agents never get this far. Look at your results in Grow to see your best topics.' },
  { id: 'messages_10', test: vs => messages(vs) >= 10, title: '10 messages from your videos', text: 'Ten conversations started by your videos.' },
  { id: 'posts_50', test: vs => posted(vs) >= 50, title: '50 videos posted', text: 'Fifty times you showed up for families in your town.' },
  { id: 'posts_100', test: vs => posted(vs) >= 100, title: '100 videos posted', text: 'A hundred. That’s a body of work.' },
];

// The next milestone to show: reached and not yet seen. The first time this runs for a workspace, every
// milestone already reached is marked seen quietly, so an upgrade doesn't bring a pile of old news.
// (Every year counts: the archive as small stand-ins, so this never reads years of records.)
export function nextMilestone(wsId, videos = [...store.readVideos(wsId), ...store.archiveStubs(wsId)]) {
  const m = memory.read(wsId), reached = MILESTONES.filter(x => x.test(videos));
  if (!m.milestones.started) {
    const at = new Date().toISOString();
    memory.update(wsId, cur => ({ ...cur, milestones: { started: at, seen: { ...cur.milestones.seen, ...Object.fromEntries(reached.map(x => [x.id, at])) } } }));
    return null;
  }
  const late = reached.filter(r => r.until && !r.until(videos) && !m.milestones.seen[r.id]);
  if (late.length) { const at = new Date().toISOString(); memory.update(wsId, cur => ({ ...cur, milestones: { ...cur.milestones, seen: { ...cur.milestones.seen, ...Object.fromEntries(late.map(r => [r.id, at])) } } })); }
  const x = reached.find(r => !m.milestones.seen[r.id] && !late.includes(r));
  if (x?.once) seeMilestone(wsId, x.id);
  return x ? { id: x.id, title: x.title, text: x.text } : null;
}
export function seeMilestone(wsId, id) {
  if (!MILESTONES.some(x => x.id === id)) return false;
  memory.update(wsId, cur => ({ ...cur, milestones: { ...cur.milestones, seen: { ...cur.milestones.seen, [id]: new Date().toISOString() } } }));
  return true;
}

const part = h => (h < 5 ? 'Hi' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
const DAY = 86400000;
const plural = (n, w, many = w + 's') => `${n} ${n === 1 ? w : many}`;
// When each video was last decided on (approved, rejected or posted), newest first.
const decidedAt = v => Math.max(Date.parse(v.approval?.at || 0) || 0, Date.parse(v.rejection?.at || 0) || 0, Date.parse(v.posted?.at || 0) || 0);
export const isDayOff = (cfg, date) => (cfg.profile?.daysOff || []).includes(new Date(`${date}T12:00:00Z`).getUTCDay());

// Good news, newest and biggest first: a recent video that brought messages, booking-link clicks this
// week, the posting goal met.
export function goodNews(videos, { now = Date.now(), goal = 3, tz = 'America/Denver' } = {}) {
  const out = [];
  const recent = videos.filter(v => v.status === 'posted' && now - Date.parse(v.posted?.at || 0) < 14 * DAY && (v.results?.messages || 0) > 0)
    .sort((a, b) => (b.results.messages - a.results.messages) || Date.parse(b.posted.at) - Date.parse(a.posted.at));
  if (recent[0]) out.push(`Your video “${String(recent[0].scenes?.[0]?.text || recent[0].meta?.painPoint || '').slice(0, 80)}” brought ${plural(recent[0].results.messages, 'message')}.`);
  const clicks = videos.filter(v => v.clicks?.last && now - Date.parse(v.clicks.last) < 7 * DAY).reduce((a, v) => a + Math.min(20, v.clicks.total || 0), 0);
  if (clicks) out.push(`Your booking link got clicks from ${plural(videos.filter(v => v.clicks?.last && now - Date.parse(v.clicks.last) < 7 * DAY).length, 'video')} this week.`);
  const thisWeek = weekOf(dayKey(now, tz));
  const postedWeek = videos.filter(v => v.status === 'posted' && v.posted?.at && weekOf(dayKey(Date.parse(v.posted.at), tz)) === thisWeek).length;
  if (postedWeek >= goal) out.push(`You’ve posted ${postedWeek} this week. Goal met.`);
  return out.slice(0, 2);
}
// Back after a while (10+ days without approving, rejecting or posting anything): a gentle way back in.
export function restartLine(videos, { now = Date.now(), pending = 0 } = {}) {
  if (!videos.length) return '';
  const last = Math.max(0, ...videos.map(decidedAt));
  if (!last || now - last < 10 * DAY) return '';
  return pending ? `Welcome back. No catching up needed: ${plural(pending, 'video')} ${pending === 1 ? 'is' : 'are'} waiting, and one is a fine place to start.` : 'Welcome back. No catching up needed: one new video is a fine place to start.';
}
// The last few decisions were all rejections (3 or more in a row): time to ask what's off, not to make more.
export function rejectionStreak(videos) {
  const decided = videos.filter(v => ['approved', 'posted', 'rejected'].includes(v.status) && decidedAt(v)).sort((a, b) => decidedAt(b) - decidedAt(a));
  let n = 0;
  while (n < decided.length && decided[n].status === 'rejected') n++;
  if (n < 3) return null;
  const reasons = [...new Set(decided.slice(0, n).map(v => v.rejection?.reason).filter(Boolean))];
  return { count: n, since: decided[0].id, reasons };
}
// A month in review: what was made and posted, what it brought, the best video and topic.
export function recap(wsId, month) {
  const videos = store.readVideos(wsId), inMonth = at => String(at || '').slice(0, 7) === month;
  const made = videos.filter(v => inMonth(v.createdAt)), posted = videos.filter(v => v.status === 'posted' && inMonth(v.posted?.at));
  const byTopic = {};
  posted.forEach(v => { const k = v.meta?.painPoint || 'Other'; byTopic[k] = (byTopic[k] || 0) + (v.results?.messages || 0); });
  const topTopic = Object.entries(byTopic).sort((a, b) => b[1] - a[1])[0];
  const best = [...posted].sort((a, b) => ((b.results?.messages || 0) - (a.results?.messages || 0)) || ((b.results?.views || 0) - (a.results?.views || 0)))[0];
  const m = mindset.read(wsId);
  return {
    month, label: new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    made: made.length, approved: videos.filter(v => inMonth(v.approval?.at)).length, posted: posted.length,
    messages: posted.reduce((a, v) => a + (v.results?.messages || 0), 0), clicks: posted.reduce((a, v) => a + (v.clicks?.total || 0), 0),
    views: posted.reduce((a, v) => a + (Number(v.results?.views) || 0), 0),
    topTopic: topTopic && topTopic[1] > 0 ? { label: topTopic[0], messages: topTopic[1] } : null,
    best: best ? { id: best.id, hook: String(best.scenes?.[0]?.text || ''), messages: best.results?.messages || 0, views: best.results?.views ?? null } : null,
    habitDays: new Set(Object.values(m.checks).flat().filter(d => d.startsWith(month))).size,
    reflections: m.reflections.filter(r => r.week.startsWith(month)).length,
  };
}

// `allowance`: { used, limit, spend: { warn, over, pct } } from the workspace summary, for heads-ups.
// `daysOff`: whether the agent's days off apply to this person (not to an assistant); Away mode too.
// `caps`: what this person can do (the weeks-ahead list only shows what's theirs to act on).
export function today(wsId, account, { now = Date.now(), postedToday = false, milestones = true, allowance = null, daysOff = true, caps = [] } = {}) {
  const cfg = store.loadConfig(wsId), videos = store.readVideos(wsId), tz = cfg.profile?.timezone || 'America/Denver';
  const lt = localTime(tz, new Date(now)), m = mindset.read(wsId);
  const first = String(account?.name || cfg.look?.name || '').trim().split(/\s+/)[0] || '';
  const goal = m.habits.find(h => h.auto === 'post')?.target || 3;
  const ws = store.getWorkspace(wsId);
  const week = weekAhead(cfg, signoff.asPlanned(ws, videos), now, { postedToday, goal });   // (v15) waiting for sign-off isn't ready
  const pending = videos.filter(v => v.status === 'pending').length;
  const away = daysOff && chauffeur.awayOn(ws, lt.date);
  const dayOff = daysOff && (isDayOff(cfg, lt.date) || away);
  // One line about the work.
  const line = week.plan
    ? (week.whole ? 'You’re set for the whole week.' : week.through ? `You’re set through ${week.through}.` : week.short ? 'Nothing’s ready for your next posting day yet.' : '')
    : week.ready ? `${plural(week.ready, 'video')} ready to post.` : '';
  // Heads-ups about limits, before they bite (80% and up).
  const heads = [];
  if (allowance?.limit && allowance.used >= Math.ceil(allowance.limit * 0.8)) heads.push(allowance.used >= allowance.limit ? `You’ve used all ${allowance.limit} videos this month. More next month.` : `You’ve used ${allowance.used} of your ${allowance.limit} videos this month.`);
  if (allowance?.spend?.warn && !allowance.spend.over) heads.push(`You’ve used ${allowance.spend.pct}% of this month’s AI budget. At 100%, new videos and the coach pause until next month.`);
  const pr = principleFor(lt.date, m.principles.offsets[lt.date] || 0);
  return {
    date: lt.date, dayOff,
    hello: `${part(lt.hour)}${first ? `, ${first}` : ''}.`,
    good: goodNews(videos, { now, goal, tz }),
    line: dayOff ? '' : line,
    pending: dayOff ? 0 : pending,
    restart: dayOff ? '' : restartLine(videos, { now, pending }),
    heads: dayOff ? [] : heads,
    why: cfg.mindset?.why?.why || '',
    principle: dayOff ? null : { text: pr.text, challenge: pr.challenge, book: BOOKS[pr.book]?.title || '', done: m.principles.done.some(d => d.date === lt.date && d.id === pr.id) },
    streak: rejectionStreak(videos),
    week,
    milestone: milestones ? nextMilestone(wsId) : null,   // all years (milestones count every video)
    ...chauffeurParts(wsId, ws, cfg, videos, { now, own: milestones, away, caps, tz }),
    ...(milestones ? celebrations(wsId, ws, cfg, videos, { now, tz, lt, quiet: dayOff, week }) : {}),
  };
}
// Understated celebrations (v15 Phase 8): a private "year in reels" in the week after the anniversary of
// joining, and a quiet wrap at the end of a day something happened.
function celebrations(wsId, ws, cfg, videos, { now, tz, lt, quiet, week }) {
  const out = {};
  const joined = String(ws?.acceptedAt || ws?.createdAt || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(joined)) {
    const years = Number(lt.date.slice(0, 4)) - Number(joined.slice(0, 4)) - (lt.date.slice(5) < joined.slice(5) ? 1 : 0);
    const anniv = `${Number(joined.slice(0, 4)) + years}${joined.slice(4)}`;
    const since = (Date.parse(`${lt.date}T12:00:00Z`) - Date.parse(`${anniv}T12:00:00Z`)) / DAY;
    if (years >= 1 && since >= 0 && since < 7) out.year = { ...yearInReels(wsId, videos, { years, to: anniv, tz }), today: since === 0 };
  }
  if (!quiet && lt.hour >= 17) {
    const on = t => !!t && dayKey(Date.parse(t), tz) === lt.date;
    const C = clientsOf(wsId), done = deskOf(wsId);
    const w = {
      approved: videos.filter(v => on(v.approval?.at)).length, rejected: videos.filter(v => on(v.rejection?.at)).length,
      posted: videos.filter(v => on(v.posted?.at)).length, leads: C.filter(c => c.stage === 'lead' && on(c.createdAt)).length,
      done: done.filter(h => on(h.doneAt)).length, clicks: videos.reduce((n, v) => n + (v.clicks?.byDay?.[lt.date] || 0), 0),
    };
    const tomorrow = week.days?.[1];
    if (Object.values(w).some(Boolean)) out.wrap = { ...w, date: lt.date, tomorrow: tomorrow?.post ? tomorrow.has || 'nothing' : '' };
  }
  return out;
}
const clientsOf = wsId => { try { return readClients(wsId); } catch { return []; } };
const deskOf = wsId => { try { return readDesk(wsId); } catch { return []; } };
// A year in reels: what the last year made, posted and brought, the best video and topic.
export function yearInReels(wsId, videos, { years, to, tz = 'America/Denver' }) {
  const from = `${Number(to.slice(0, 4)) - 1}${to.slice(4)}`;
  const inYear = t => { if (!t) return false; const d = dayKey(Date.parse(t), tz); return d >= from && d < to; };
  const posted = videos.filter(v => v.status === 'posted' && inYear(v.posted?.at));
  const byTopic = {};
  posted.forEach(v => { const k = v.meta?.painPoint || 'Other'; byTopic[k] = (byTopic[k] || 0) + (v.results?.messages || 0) + (v.leads?.total || 0); });
  const top = Object.entries(byTopic).sort((a, b) => b[1] - a[1])[0];
  const best = [...posted].sort((a, b) => ((b.results?.messages || 0) + (b.leads?.total || 0)) - ((a.results?.messages || 0) + (a.leads?.total || 0)) || (Number(b.results?.views) || 0) - (Number(a.results?.views) || 0))[0];
  const m = mindset.read(wsId);
  return {
    years, from, to,
    made: videos.filter(v => inYear(v.createdAt)).length, approved: videos.filter(v => inYear(v.approval?.at)).length, posted: posted.length,
    messages: posted.reduce((n, v) => n + (v.results?.messages || 0), 0), leads: posted.reduce((n, v) => n + (v.leads?.total || 0), 0),
    clicks: posted.reduce((n, v) => n + (v.clicks?.total || 0), 0), views: posted.reduce((n, v) => n + (Number(v.results?.views) || 0), 0),
    topTopic: top && top[1] > 0 ? top[0] : '', best: best ? String(best.scenes?.[0]?.text || '').slice(0, 120) : '',
    habitDays: new Set(Object.values(m.checks).flat().filter(d => d >= from && d < to)).size,
  };
}
// The chauffeur's parts of the greeting (v15 Phase 8, lib/chauffeur.js): Away mode, the welcome back,
// a busy week's progress, what runs out in the weeks ahead, last night's report, and when tonight's
// videos will be ready.
function chauffeurParts(wsId, ws, cfg, videos, { now, own, away, caps, tz }) {
  const out = {};
  if (away) out.away = { from: ws.away.from, until: ws.away.until, backOn: new Date(Date.parse(`${ws.away.until}T12:00:00Z`) + DAY).toISOString().slice(0, 10), covered: ws.away.covered || 0, postingDays: ws.away.postingDays || 0 };
  if (own) { const w = chauffeur.welcomeBack(wsId, now); if (w) out.welcome = w; }
  if (ws?.busy) {
    const jobs = (ws.busy.jobs || []).map(id => queue.getJob(id)).filter(Boolean);
    out.busy = { since: ws.busy.since, total: (ws.busy.jobs || []).length, made: jobs.filter(j => j.status === 'done').length, waiting: jobs.filter(j => j.status === 'queued' || j.status === 'running').length, notified: !!ws.busy.notified, pending: videos.filter(v => v.status === 'pending').length };
    // Finished while nobody's phone was listening (a job canceled, say): it's ready all the same.
    if (!out.busy.notified && !out.busy.waiting && chauffeur.busyFinished(wsId)) out.busy.notified = true;
  }
  const ahead = chauffeur.ahead(wsId, { now, caps });
  if (ahead.length) out.ahead = ahead;
  if (own) { const v = chauffeur.valet(wsId, { now }); if (v) out.valet = v; }
  if (cfg.schedule?.keepReady) out.overnight = chauffeur.readyWindow(chauffeur.reviewHabit(videos, tz, now), cfg.schedule.keepReady);
  return out;
}
