// lib/twofa.js — two-factor login: a 6-digit code from an authenticator app after the password.
// Required for admins by default (TWO_FACTOR=admins), optional for agents. TWO_FACTOR=all requires it
// for everyone; TWO_FACTOR=off makes it optional for everyone (not recommended).
//
// On the account: twofa = { secret (encrypted), enabledAt, lastStep, backup: [sha256 of each unused backup code] }
//                 twofaPending = { secret (encrypted), at }  while setting up, for 15 minutes
import * as store from './store.js';
import * as totp from './totp.js';
import { seal, unseal } from './secrets.js';
import { qrSvg } from './qr.js';
import { PRODUCT_NAME } from './paths.js';
import { membershipsOf } from './roles.js';

const PURPOSE = 'twofa';
const PENDING_MS = 15 * 60000;
export const policy = () => (['admins', 'all', 'off'].includes(process.env.TWO_FACTOR) ? process.env.TWO_FACTOR : 'admins');
export const isOn = acc => !!acc?.twofa?.enabledAt;
// Assistants work in someone else's workspace (their clients, their videos), so they're held to the
// admins' standard: two-factor login is required for them too, unless TWO_FACTOR=off. So are compliance
// reviewers (v15): their sign-off is a record the agent may have to show.
export const required = acc => !!acc && (policy() === 'all' || (policy() === 'admins' && (acc.role === 'admin' || membershipsOf(acc).some(m => m.role === 'assistant' || m.role === 'reviewer'))));
export const needsSetup = acc => required(acc) && !isOn(acc);
export const state = acc => ({ on: isOn(acc), required: required(acc), enabledAt: acc?.twofa?.enabledAt || '', backupLeft: acc?.twofa?.backup?.length || 0 });

class TwofaError extends Error { constructor(msg, code = 400) { super(msg); this.status = code; } }

// Step 1: a new key, shown as a QR code and as text. Nothing changes until a code from it is confirmed.
export function begin(acc) {
  const secret = totp.newSecret();
  store.updateAccount(acc.id, { twofaPending: { secret: seal(secret, PURPOSE), at: Date.now() } });
  const otpauth = totp.otpauthUrl({ issuer: PRODUCT_NAME, account: acc.email, secret });
  let qr = '';
  try { qr = qrSvg(otpauth, { scale: 4 }); } catch { /* very long product name or email: the key below still works */ }
  return { secret: secret.replace(/(.{4})/g, '$1 ').trim(), otpauth, qr };
}

// Step 2: the first code from the app turns it on and returns the backup codes (shown once).
export function enable(acc, input, now = Date.now()) {
  const p = acc.twofaPending;
  if (!p || now - p.at > PENDING_MS) throw new TwofaError('Start again: tap Set up two-factor login.');
  const secret = unseal(p.secret, PURPOSE);
  const step = secret ? totp.check(secret, input, { now }) : -1;
  if (step < 0) throw new TwofaError('That code isn’t right. Check the time on your phone is set automatically, and use the newest code.');
  const codes = totp.newBackupCodes();
  store.updateAccount(acc.id, { twofa: { secret: p.secret, enabledAt: new Date(now).toISOString(), lastStep: step, backup: codes.map(totp.hashBackup) }, twofaPending: null });
  return codes;
}

// A code at login (or to confirm a change): an app code, or one unused backup code. Returns
// 'app' | 'backup' | null, and records it so it can't be used again.
export function verify(acc, input, now = Date.now()) {
  const t = acc?.twofa;
  if (!t?.enabledAt) return null;
  const raw = String(input || '').trim();
  if (/^\d{6}$/.test(raw.replace(/\s/g, ''))) {
    const secret = unseal(t.secret, PURPOSE);
    const step = secret ? totp.check(secret, raw, { now, lastStep: t.lastStep ?? -1 }) : -1;
    if (step < 0) return null;
    store.updateAccount(acc.id, { twofa: { ...t, lastStep: step } });
    return 'app';
  }
  const h = totp.hashBackup(raw);
  if (totp.normBackup(raw).length !== 8 || !(t.backup || []).includes(h)) return null;
  store.updateAccount(acc.id, { twofa: { ...t, backup: t.backup.filter(x => x !== h) } });
  return 'backup';
}

export function newBackupCodes(acc) {
  if (!isOn(acc)) throw new TwofaError('Two-factor login isn’t on.');
  const codes = totp.newBackupCodes();
  store.updateAccount(acc.id, { twofa: { ...acc.twofa, backup: codes.map(totp.hashBackup) } });
  return codes;
}
export function disable(acc) {
  if (required(acc)) throw new TwofaError(acc.role === 'admin' ? 'Two-factor login is required for admins.' : 'Two-factor login is required on this server.');
  store.updateAccount(acc.id, { twofa: null, twofaPending: null });
}
// Lost phone and backup codes: an admin (or `node admin.js reset-2fa`) clears it; they set it up again.
export const reset = acc => store.updateAccount(acc.id, { twofa: null, twofaPending: null });
