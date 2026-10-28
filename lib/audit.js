// lib/audit.js — a record of who did what, and when: logins, two-factor changes, admins opening a
// workspace, approvals, exports, deletions, plan and cap changes, terms acceptance.
// One JSON line per event in data/audit/YYYY-MM.jsonl (append-only), kept AUDIT_KEEP_MONTHS (24).
// Admin shows it (and downloads it as CSV); a workspace's own entries go into its data export.
import fs from 'fs';
import path from 'path';
import { DIRS } from './paths.js';

const DIR = path.join(DIRS.data, 'audit');
const monthOf = d => d.toISOString().slice(0, 7);
const KEEP = () => { const n = Number(process.env.AUDIT_KEEP_MONTHS); return Number.isInteger(n) && n > 0 ? n : 24; };
export const keepMonths = KEEP;
const clip = (s, n) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, n);

// Plain words for each action, used by Admin and the CSV.
export const LABELS = {
  'login.ok': 'Logged in', 'login.failed': 'Login failed', 'login.2fa_failed': 'Wrong two-factor code', 'logout': 'Logged out',
  'password.changed': 'Changed password', 'password.reset': 'Reset password with a link', 'password.forgot': 'Asked for a reset link',
  'twofa.on': 'Turned on two-factor login', 'twofa.off': 'Turned off two-factor login', 'twofa.codes': 'Made new backup codes', 'twofa.reset': 'Reset someone’s two-factor login',
  'session.ended': 'Logged out a device', 'session.others': 'Logged out all other devices',
  'invite.created': 'Created an invite', 'invite.accepted': 'Accepted an invite', 'reset.created': 'Created a reset link',
  'account.disabled': 'Disabled an account', 'account.enabled': 'Enabled an account',
  'admin.open': 'Opened a workspace', 'admin.leave': 'Left a workspace', 'workspace.changed': 'Changed workspace settings',
  'terms.accepted': 'Accepted the terms', 'setup.finished': 'Finished setup', 'settings.saved': 'Saved settings',
  'video.approved': 'Approved a video', 'video.rejected': 'Rejected a video', 'video.reopened': 'Sent a video back to review', 'video.posted': 'Marked a video posted', 'video.deleted': 'Deleted a video',
  'records.exported': 'Downloaded approval records', 'data.exported': 'Downloaded all their data',
  'deletion.requested': 'Asked for their data to be deleted', 'deletion.canceled': 'Canceled a deletion request', 'deletion.declined': 'Declined a deletion request', 'workspace.deleted': 'Deleted a workspace',
  'instagram.connected': 'Connected Instagram', 'instagram.disconnected': 'Disconnected Instagram',
  'facts.confirmed': 'Confirmed facts for a done-for-you client', 'admin.batch': 'Made videos for done-for-you clients',
  'away.started': 'Went away (Away mode)', 'away.ended': 'Came back from Away mode', 'busy.started': 'Started a busy week',
  'access.requested': 'Requested access (landing page)', 'access.invited': 'Marked an access request invited', 'access.dismissed': 'Dismissed an access request', 'access.new': 'Reopened an access request',
};

// who: the account doing it ({ id, email, role }) or a label like 'cli' / 'system'.
export function record({ action, who = null, ws = '', target = '', detail = '', ip = '' }, now = new Date()) {
  const e = {
    at: now.toISOString(), action: clip(action, 40),
    by: typeof who === 'string' ? '' : who?.id || '', email: typeof who === 'string' ? who : who?.email || '', role: typeof who === 'string' ? '' : who?.role || '',
    ws: clip(ws, 20), target: clip(target, 120), detail: clip(detail, 300), ip: clip(ip, 64),
  };
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(path.join(DIR, `${monthOf(now)}.jsonl`), JSON.stringify(e) + '\n');
  } catch (err) { console.error('[audit]', err.message); }   // the log never breaks the action itself
  return e;
}

const files = () => (fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(n => /^\d{4}-\d{2}\.jsonl$/.test(n)).sort().reverse() : []);
// Newest first. Filters: ws, by (account id), action prefix ('login', 'video.approved'…).
export function list({ ws = '', by = '', action = '', limit = 200 } = {}) {
  const out = [];
  for (const f of files()) {
    const lines = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').filter(Boolean).reverse();
    for (const l of lines) {
      let e; try { e = JSON.parse(l); } catch { continue; }
      if (ws && e.ws !== ws) continue;
      if (by && e.by !== by) continue;
      if (action && !(e.action === action || e.action.startsWith(action + '.'))) continue;
      out.push(e);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// Removes months older than AUDIT_KEEP_MONTHS. Run by the nightly cleanup.
export function prune(now = new Date()) {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - KEEP() + 1, 1)).toISOString().slice(0, 7);
  let n = 0;
  for (const f of files()) if (f.slice(0, 7) < cutoff) { fs.rmSync(path.join(DIR, f), { force: true }); n++; }
  return n;
}

const csvCell = x => { let t = String(x ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
export function toCsv(entries, wsName = id => id) {
  const head = ['When (UTC)', 'Who', 'Role', 'What', 'Workspace', 'About', 'Details', 'IP'];
  return '﻿' + [head, ...entries.map(e => [e.at, e.email, e.role, LABELS[e.action] || e.action, e.ws ? wsName(e.ws) : '', e.target, e.detail, e.ip])].map(r => r.map(csvCell).join(',')).join('\r\n');
}
