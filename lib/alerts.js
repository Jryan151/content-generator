// lib/alerts.js — tells you (the admin) when something needs a person: a video that failed for
// good, a failed payment, a failed backup, low disk, an Instagram post that didn't go out.
// Kept in data/alerts.json (newest 200) and shown in Admin. With ALERT_WEBHOOK_URL set, each one
// is also sent there: ntfy.sh (free phone push), Slack, Discord, or any URL that takes a POST.
//
// Each warning and error reads like a service manual (v15): what happened (`text`), what the app already
// did about it (`did`), and the one thing left for you (`run`: a command to paste, or a step; '' when
// nothing is left). The checks make sure every warning and error in the code has a `did`.
import path from 'path';
import { DIRS, PRODUCT_NAME, readJSON, updateJSON, randomId } from './paths.js';

const FILE = path.join(DIRS.data, 'alerts.json');
const KEEP = 200;
const QUIET_MS = 60 * 60000;   // the same alert isn't repeated within an hour
const sentHere = new Map();     // alert → when this process sent it (repeats, even when alerts.json can't be saved)
export const _resetSent = () => sentHere.clear();

export const listAlerts = () => readJSON(FILE, []);
export const unreadCount = () => listAlerts().filter(a => !a.readAt).length;
export function markAllRead() {
  const at = new Date().toISOString();
  updateJSON(FILE, [], list => list.map(a => (a.readAt ? a : { ...a, readAt: at })));
}

// ntfy wants plain text; Slack and Discord want their own JSON; anything else gets the full record.
export function webhookFormat(url, override = process.env.ALERT_WEBHOOK_FORMAT) {
  const f = String(override || '').toLowerCase();
  if (['text', 'json', 'slack', 'discord'].includes(f)) return f;
  if (/ntfy\./i.test(url)) return 'text';
  if (/discord(app)?\.com\/api\/webhooks/i.test(url)) return 'discord';
  if (/hooks\.slack\.com/i.test(url)) return 'slack';
  return 'json';
}
const ascii = s => String(s).replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[·–—]/g, '-').replace(/[^\x20-\x7E]/g, '');

export async function sendWebhook(a, url = process.env.ALERT_WEBHOOK_URL) {
  if (!url) return false;
  const fmt = webhookFormat(url);
  const title = `${PRODUCT_NAME}: ${a.title}${a.workspaceName ? ` (${a.workspaceName})` : ''}`;
  let headers = { 'Content-Type': 'application/json' }, body;
  const full = manualText(a);
  if (fmt === 'text') {
    headers = { 'Content-Type': 'text/plain; charset=utf-8', Title: ascii(title), Priority: a.level === 'error' ? 'high' : 'default', Tags: a.level === 'error' ? 'warning' : 'information_source' };
    body = full;
  } else if (fmt === 'slack') body = JSON.stringify({ text: `*${title}*\n${full}` });
  else if (fmt === 'discord') body = JSON.stringify({ content: `**${title}**\n${full}`.slice(0, 1900) });
  else body = JSON.stringify({ product: PRODUCT_NAME, title: a.title, text: a.text, did: a.did || '', run: a.run || '', full, level: a.level, kind: a.kind, workspace: a.ws, workspaceName: a.workspaceName, at: a.at });
  const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`The alert address answered ${res.status}.`);
  return true;
}

// level: 'error' (needs you) | 'warning' (worth a look) | 'info'. kind groups alerts for the list.
// Returns the alert, or null when the same one went out within the hour.
// The whole alert as one text: what happened, what was done, what's left (phone pushes, chat, email).
export const manualText = a => [a.text, a.did ? `Already done: ${a.did}` : '', a.did || a.run ? `Left for you: ${a.run || 'nothing.'}` : ''].filter(Boolean).join('\n');
const clean = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
export function notify({ level = 'error', kind = 'other', title, text = '', did = '', run = '', ws = '', workspaceName = '' }, now = Date.now()) {
  const t = String(title || '').slice(0, 120), body = clean(text, 600);
  if (!t) return null;
  // A repeat within the hour is skipped. An alert that couldn't be saved (a full disk) is remembered
  // here instead, so its repeats don't flood your phone either.
  const key = `${t}\n${body}\n${ws}`;
  for (const [k, at] of sentHere) if (now - at >= QUIET_MS) sentHere.delete(k);
  if (sentHere.has(key)) return null;
  let earlier = [];
  try { earlier = listAlerts(); } catch { /* unreadable: the memory above still holds */ }
  if (earlier.find(a => a.title === t && a.text === body && a.ws === ws && now - Date.parse(a.at) < QUIET_MS)) return null;
  const a = { id: randomId('al', 5), at: new Date(now).toISOString(), level, kind, title: t, text: body, did: clean(did, 300), run: clean(run, 300), ws, workspaceName: String(workspaceName || '').slice(0, 80), readAt: '' };
  // An alert that can't be saved (a full disk, say) still goes to your phone and the log: it may be
  // the one that matters most.
  let saved = true;
  try { updateJSON(FILE, [], list => [a, ...list].slice(0, KEEP)); } catch (e) { saved = false; sentHere.set(key, now); console.error(`[alert] not saved (${e.message})`); }
  if (process.env.NODE_ENV !== 'test' || !saved) console.log(`[alert] ${level}: ${t}${workspaceName ? ` (${workspaceName})` : ''}: ${manualText(a).replace(/\n/g, ' | ')}`);
  if (process.env.ALERT_WEBHOOK_URL) {
    sendWebhook(a).catch(e => { try { updateJSON(FILE, [], list => list.map(x => (x.id === a.id ? { ...x, webhookError: e.message } : x))); } catch { /* nowhere to note it */ } });
  }
  return a;
}
