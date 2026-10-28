// lib/email.js — transactional email: invites, password resets, trial ending soon, failed payment,
// and a weekly "videos ready for review" reminder. Sent through Postmark or Resend over their HTTP
// APIs (no SDK). With no key set, nothing is sent and the app keeps today's copy-the-link flow.
//
//   .env: EMAIL_PROVIDER=postmark | resend
//         EMAIL_API_KEY=…                (Postmark: a Server API token. Resend: an API key.)
//         EMAIL_FROM=Agent Reels <hello@yourdomain.com>   (a sender your provider has verified)
//         EMAIL_REPLY_TO=you@yourdomain.com             (optional)
import { PRODUCT_NAME, PUBLIC_URL } from './paths.js';
import * as store from './store.js';
import { membership } from './roles.js';
import { notify } from './alerts.js';
import * as outbox from './outbox.js';

const env = process.env;
const BASES = { postmark: 'https://api.postmarkapp.com', resend: 'https://api.resend.com' };
const DAY = 86400000;
export const TRIAL_NOTICE_DAYS = 3;

export function emailConfig() {
  const provider = String(env.EMAIL_PROVIDER || '').trim().toLowerCase();
  const key = String(env.EMAIL_API_KEY || '').trim();
  const from = String(env.EMAIL_FROM || '').trim();
  return { on: !!BASES[provider] && !!key && /@/.test(from), provider, key, from, replyTo: String(env.EMAIL_REPLY_TO || '').trim() };
}
export const emailOn = () => emailConfig().on;

/* ---------------- Sending ---------------- */
// One email to one address, through the outbox (lib/outbox.js): sent now if the provider answers;
// otherwise kept and sent again until it goes (up to 3 days). `key`: a one-time key, so the same
// email is never sent twice (a reminder, say). Returns { id, sent } when it went out, { queued } when
// it's waiting; throws with the provider's message when it's refused for good.
export async function send({ to, subject, text, html }, { key = '', ws = '' } = {}) {
  const c = emailConfig();
  if (!c.on) throw new Error('Email isn’t set up on this server.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to || ''))) throw new Error('That email address doesn’t look right.');
  const r = await outbox.deliver('email', { to, subject, text, html }, { key, ws });
  return r.sent ? { ...(r.result || {}), sent: true } : r.duplicate ? { duplicate: true, sent: true } : { queued: true, why: r.why };
}
outbox.register('email', msg => sendNow(msg));
// The provider call itself (with one more try after a dropped connection or an outage).
export async function sendNow({ to, subject, text, html }) {
  const c = emailConfig();
  if (!c.on) throw Object.assign(new Error('Email isn’t set up on this server.'), { permanent: true });
  const base = String(env.EMAIL_API_BASE || BASES[c.provider]).replace(/\/$/, '');
  const req = c.provider === 'postmark'
    ? { url: `${base}/email`, headers: { 'X-Postmark-Server-Token': c.key, Accept: 'application/json' }, body: { From: c.from, To: to, Subject: subject, TextBody: text, HtmlBody: html, MessageStream: 'outbound', ...(c.replyTo ? { ReplyTo: c.replyTo } : {}) } }
    : { url: `${base}/emails`, headers: { Authorization: `Bearer ${c.key}` }, body: { from: c.from, to: [to], subject, text, html, ...(c.replyTo ? { reply_to: c.replyTo } : {}) } };
  // One more try after a dropped connection, a rate limit or a provider outage; never after a
  // refusal (bad address, unverified sender), which wouldn't change.
  for (let i = 0; ; i++) {
    let res, data;
    try {
      res = await fetch(req.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...req.headers }, body: JSON.stringify(req.body), signal: AbortSignal.timeout(15000) });
      data = await res.json().catch(() => ({}));
    } catch (e) {
      if (i < 1) { await new Promise(r => setTimeout(r, Number(process.env.RETRY_BASE_MS) || 2000)); continue; }
      throw Object.assign(new Error(`Email (${c.provider}): couldn’t reach the provider (${e.name === 'TimeoutError' ? 'no answer in time' : e.message}).`), { retry: true, unknown: true });
    }
    if (res.ok && !(c.provider === 'postmark' && data.ErrorCode)) return { id: data.MessageID || data.id || '' };
    if (i < 1 && (res.status === 429 || res.status >= 500)) { await new Promise(r => setTimeout(r, Number(process.env.RETRY_BASE_MS) || 2000)); continue; }
    const outage = res.status === 429 || res.status >= 500;
    throw Object.assign(new Error(`Email (${c.provider}): ${data.Message || data.message || data.error?.message || res.status}`), { status: res.status, retry: outage, permanent: !outage });
  }
}

// The agent(s) who own a workspace (not disabled; assistants don't get its account email). Failures
// alert the admin; they never throw.
const membersOf = wsId => store.listAccounts().filter(a => !a.disabled && membership(a, wsId)?.role === 'owner');
// `key`: a one-time key for this message (each person's copy gets its own from it).
export async function emailWorkspace(wsId, msg, { only = () => true, key = '' } = {}) {
  if (!emailOn()) return 0;
  let sent = 0;
  for (const a of membersOf(wsId).filter(only)) {
    try { await send({ to: a.email, ...msg }, { key: key ? `${key}:${a.id}` : '', ws: wsId }); sent++; }
    catch (e) { notify({ level: 'warning', kind: 'email', title: 'An email didn’t send', text: `${msg.subject} → ${a.email}: ${e.message}`, did: 'Stopped trying this one: the email service refused it (not an outage, so retrying wouldn’t help).', run: 'Check the address, and the sender settings in .env (EMAIL_FROM, EMAIL_API_KEY).', ws: wsId, workspaceName: store.getWorkspace(wsId)?.name }); }
  }
  return sent;
}

/* ---------------- The emails ---------------- */
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const appUrl = (hash = '', base = PUBLIC_URL) => (base ? `${String(base).replace(/\/$/, '')}/${hash ? `#/${hash}` : ''}` : '');
// Plain text and a simple HTML version of the same message: a few paragraphs and at most one button.
function compose(subject, paras, button = null) {
  const text = [...paras, ...(button?.url ? [`${button.label}: ${button.url}`] : [])].join('\n\n') + `\n\n— ${PRODUCT_NAME}`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f3ef;font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1b1d22">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">
${paras.map(p => `<p style="margin:0 0 14px">${escHtml(p)}</p>`).join('\n')}
${button?.url ? `<p style="margin:20px 0"><a href="${escHtml(button.url)}" style="display:inline-block;background:#b56d0c;color:#1b1408;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:9px">${escHtml(button.label)}</a></p><p style="margin:0;font-size:13px;color:#5c616b">Or copy this link: ${escHtml(button.url)}</p>` : ''}
<p style="margin:20px 0 0;font-size:13px;color:#5c616b">${escHtml(PRODUCT_NAME)}</p></div></body></html>`;
  return { subject, text, html };
}

export const inviteEmail = ({ link, workspace = '', days = 7 }) => compose(
  `You’re invited to ${PRODUCT_NAME}`,
  [`You’ve been invited to ${PRODUCT_NAME}${workspace ? ` for ${workspace}` : ''}: short, compliance-checked Instagram Reels for your insurance business.`,
    `Set a password to get started. Setup takes about five minutes. This link works once and expires in ${days} days.`],
  { label: 'Accept your invite', url: link });

export const resetEmail = ({ link, days = 7 }) => compose(
  `Reset your ${PRODUCT_NAME} password`,
  ['Here’s the link to choose a new password.', `It works once and expires in ${days} days. If you didn’t ask for this, you can ignore this email; your password hasn’t changed.`],
  { label: 'Choose a new password', url: link });

export const trialEndingEmail = ({ endsAt, base = PUBLIC_URL }) => compose(
  `Your ${PRODUCT_NAME} free trial ends soon`,
  [`Your free trial ends on ${new Date(endsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.`,
    'If you keep your plan, nothing changes and your videos keep coming. To change or cancel your plan, open Billing before then.'],
  { label: 'Open Billing', url: appUrl('billing', base) });

export const paymentFailedEmail = ({ base = PUBLIC_URL } = {}) => compose(
  `Your ${PRODUCT_NAME} payment didn’t go through`,
  ['We couldn’t charge your card for your plan. The payment will be retried automatically.',
    'To keep making videos without a gap, update your card in Billing → Manage billing.'],
  { label: 'Update your card', url: appUrl('billing', base) });

export const reviewEmail = ({ count, base = PUBLIC_URL }) => compose(
  `${count} video${count === 1 ? ' is' : 's are'} ready for your review`,
  [`You have ${count} video${count === 1 ? '' : 's'} waiting in Review. Watch each one with sound, then approve the ones you’re happy to post.`,
    'You can turn off this weekly email under Account.'],
  { label: 'Open Review', url: appUrl('review', base) });

// A login from a new device or network. If it wasn't them, they can act right away.
export const newLoginEmail = ({ device = 'Unknown device', ip = '', at = new Date(), timezone = 'America/Denver', base = PUBLIC_URL } = {}) => compose(
  `New login to your ${PRODUCT_NAME} account`,
  [`Your account was just used to log in from ${device}${ip ? ` (IP address ${ip})` : ''} on ${new Date(at).toLocaleString('en-US', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' })}.`,
    'If this was you, there’s nothing to do.',
    'If it wasn’t, change your password now, log out the other devices under Account → Where you’re logged in, and turn on two-factor login. Then tell your admin.'],
  { label: 'Open Account', url: appUrl('account', base) });

// An agent invited someone to help them (an assistant seat).
export const assistantInviteEmail = ({ link, workspace = '', by = '', days = 7 }) => compose(
  `${by || 'An agent'} invited you to help with their videos`,
  [`${by || 'An agent'} added you as an assistant in ${workspace ? `${workspace} on ` : ''}${PRODUCT_NAME}: you can prepare and fix their videos, draft replies, and keep their follow-ups and client care on track. The agent approves every video before it goes out.`,
    `Set a password to get started. You’ll also set up two-factor login (a code from an app on your phone). This link works once and expires in ${days} days.`],
  { label: 'Accept the invite', url: link });
export const assistantAddedEmail = ({ workspace = '', by = '', base = PUBLIC_URL }) => compose(
  `You can now help ${by || 'another agent'}`,
  [`${by || 'An agent'} added you as an assistant in ${workspace || 'their workspace'}. Log in as usual and pick it from the workspace menu at the top.`],
  { label: 'Open the app', url: appUrl('', base) });

// A compliance reviewer invited (v15): they sign off the agent's videos before they post.
export const reviewerInviteEmail = ({ link, workspace = '', by = '', days = 7 }) => compose(
  `${by || 'An agent'} asked you to review their videos before they post`,
  [`${by || 'An agent'} added you as their compliance reviewer in ${workspace ? `${workspace} on ` : ''}${PRODUCT_NAME}. Each video they approve waits for you: you watch it, read the script and post text, and sign it off or send it back with a note. Nothing posts until you have.`,
    `Set a password to get started. You’ll also set up two-factor login (a code from an app on your phone), since your sign-off is part of the agent’s compliance record. This link works once and expires in ${days} days.`],
  { label: 'Accept the invite', url: link });
export const signoffEmail = ({ count, agent = '', base = PUBLIC_URL }) => compose(
  `${count} video${count === 1 ? '' : 's'} from ${agent || 'your agent'} ${count === 1 ? 'is' : 'are'} waiting for your sign-off`,
  [`${agent || 'The agent'} approved ${count === 1 ? 'a video' : `${count} videos`} that ${count === 1 ? 'waits' : 'wait'} for you before posting. Watch ${count === 1 ? 'it' : 'each one'}, then sign off or send ${count === 1 ? 'it' : 'them'} back with a note.`],
  { label: 'Open Sign-off', url: appUrl('signoff', base) });

// A data download: what it held, when and where from. If it wasn't them, they can act.
export const exportEmail = ({ at = new Date(), device = 'Unknown device', counts = {}, timezone = 'America/Denver', base = PUBLIC_URL } = {}) => compose(
  `Your ${PRODUCT_NAME} data was downloaded`,
  [`A copy of your workspace’s data was downloaded from ${device} on ${new Date(at).toLocaleString('en-US', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' })}.`,
    `It held ${counts.videos ?? 0} videos, ${counts.approvalRecords ?? 0} approval records, ${counts.facts ?? 0} facts, ${counts.clients ?? 0} client notes and ${counts.settingsVersions ?? 0} saved versions of your settings.`,
    'If this was you, there’s nothing to do. If it wasn’t, change your password and log out your other devices under Account.'],
  { label: 'Open Account', url: appUrl('account', base) });

// Request access (landing page): confirms we got it. Invite only, so no promise of a date.
export const accessRequestEmail = ({ name = '' } = {}) => compose(
  `We got your request for ${PRODUCT_NAME}`,
  [`Thanks${name ? `, ${name}` : ''}. We got your request for access to ${PRODUCT_NAME}.`,
    'We add agents a few at a time so everyone gets set up properly. We’ll email you an invite link when your spot is ready, or reach out with any questions first.',
    'If you didn’t ask for this, you can ignore this email.']);

// Data deletion: confirming the request was received, and that it was carried out.
export const deletionRequestedEmail = ({ workspace = '' } = {}) => compose(
  `We got your request to delete your ${PRODUCT_NAME} data`,
  [`You asked us to delete ${workspace ? `the ${workspace} workspace` : 'your workspace'} and everything in it: logins, settings, videos and approval records.`,
    'Nothing is deleted until we confirm it, and we’ll email you when it’s done. If you change your mind first, open Account in the app and cancel the request.',
    'Download a copy of your data from Account before then if you’d like to keep it.']);
export const deletedEmail = ({ workspace = '', backupDays = 14 } = {}) => compose(
  `Your ${PRODUCT_NAME} data was deleted`,
  [`${workspace ? `The ${workspace} workspace` : 'Your workspace'} and its logins, settings, videos and approval records were deleted from ${PRODUCT_NAME}.`,
    `Our nightly backups still hold a copy until they’re replaced, within ${backupDays} days. Videos you already posted stay on Instagram; delete them there if you want them gone.`]);

/* ---------------- Scheduled emails ---------------- */
// Trial ending: once per subscription, about three days before the trial ends. Called by the Stripe
// webhook (customer.subscription.trial_will_end) and by the scheduler as a backstop.
export async function sendTrialEnding(wsId, now = Date.now()) {
  const ws = store.getWorkspace(wsId), b = ws?.billing || {};
  const endsAt = b.trialEnd || b.periodEnd;
  if (!emailOn() || !ws || b.status !== 'trialing' || !endsAt || b.trialEmailFor === (b.subscriptionId || endsAt)) return 0;
  const left = Date.parse(endsAt) - now;
  if (!(left > 0 && left <= (TRIAL_NOTICE_DAYS + 0.5) * DAY)) return 0;
  store.updateWorkspace(wsId, { billing: { trialEmailFor: b.subscriptionId || endsAt } });
  return emailWorkspace(wsId, trialEndingEmail({ endsAt }), { key: `trial-ending:${wsId}:${b.subscriptionId || endsAt}` });
}
export async function trialReminders(now = Date.now()) {
  const out = [];
  for (const ws of store.listWorkspaces()) { try { const n = await sendTrialEnding(ws.id, now); if (n) out.push({ ws: ws.id, sent: n }); } catch (e) { store.skipWorkspace(ws, e, 'trial-email'); } }
  return out;
}

// Weekly review reminder: Monday from 8am in the agent's time zone, when videos are waiting.
function localWeek(tz, d) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), hour: Number(p.hour) };
  } catch { return { date: d.toISOString().slice(0, 10), weekday: d.getUTCDay(), hour: d.getUTCHours() }; }
}
export async function reviewReminders(now = new Date()) {
  const out = [];
  if (!emailOn()) return out;
  for (const ws of store.listWorkspaces()) { try {
    if (!ws.onboarded || ws.suspended) continue;
    const cfg = store.loadConfig(ws.id), c = localWeek(cfg.profile?.timezone || 'America/Denver', now);
    // Monday, or the first day of the week that isn't a day off.
    const off = cfg.profile?.daysOff || [], first = [1, 2, 3, 4, 5, 6, 0].find(d => !off.includes(d)) ?? 1;
    if (c.weekday !== first || c.hour < 8 || ws.reviewEmailDay === c.date) continue;
    store.updateWorkspace(ws.id, { reviewEmailDay: c.date });
    const count = store.readVideos(ws.id).filter(v => v.status === 'pending').length;
    if (!count) continue;
    const sent = await emailWorkspace(ws.id, reviewEmail({ count }), { only: a => a.weeklyEmail !== false, key: `review:${ws.id}:${c.date}` });
    if (sent) out.push({ ws: ws.id, count, sent });
  } catch (e) { store.skipWorkspace(ws, e, 'review-email'); } }
  return out;
}
