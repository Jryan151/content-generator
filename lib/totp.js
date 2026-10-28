// lib/totp.js — time-based one-time codes (RFC 6238: SHA-1, 6 digits, 30 seconds), the kind
// Google Authenticator, 1Password, Authy and Microsoft Authenticator show. Plus one-time backup codes.
import crypto from 'crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function unbase32(s) {
  const clean = String(s).toUpperCase().replace(/[\s=-]/g, ''), out = [];
  let bits = 0, val = 0;
  for (const ch of clean) { const i = B32.indexOf(ch); if (i < 0) throw new Error('Bad key'); val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const STEP = 30;
export const newSecret = () => base32(crypto.randomBytes(20));
export const stepAt = (now = Date.now()) => Math.floor(now / 1000 / STEP);
export function code(secret, step) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
// The step a code matches (within one step either side, for clock drift), or -1. A step at or
// before `lastStep` is refused, so the same code can't be used twice.
export function check(secret, input, { now = Date.now(), lastStep = -1, window = 1 } = {}) {
  const c = String(input || '').replace(/\D/g, '');
  if (c.length !== 6) return -1;
  const s = stepAt(now);
  for (let d = -window; d <= window; d++) {
    const step = s + d;
    if (step <= lastStep) continue;
    if (crypto.timingSafeEqual(Buffer.from(code(secret, step)), Buffer.from(c))) return step;
  }
  return -1;
}
export const otpauthUrl = ({ issuer, account, secret }) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;

/* ---------------- Backup codes: 10 one-time codes like "k7m2-9qxd" ---------------- */
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
export const normBackup = c => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const hashBackup = c => crypto.createHash('sha256').update('backup:' + normBackup(c)).digest('hex');
export function newBackupCodes(n = 10) {
  return Array.from({ length: n }, () => { const s = Array.from(crypto.randomBytes(8), b => ALPHA[b % ALPHA.length]).join(''); return `${s.slice(0, 4)}-${s.slice(4)}`; });
}
