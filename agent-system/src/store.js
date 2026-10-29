// Your own log on one device ("Mine"), built to last months of daily use.
//
//   • Versioned: every saved copy says which version wrote it, and older
//     copies are upgraded on load, so an app update never loses your log.
//   • Checked: a backup is checked before it replaces anything.
//   • Backed up: the app reminds you when your last backup is getting old.

export const STORE_VERSION = 2;
const ARRAYS = ['activities', 'leads', 'recruits', 'names'];

export function emptyStore() {
  return { version: STORE_VERSION, profile: { licensed: null }, activities: [], leads: [], recruits: [], names: [], lastBackupAt: null };
}

/**
 * Bring any saved copy up to the current version. Unknown or damaged parts
 * fall back to empty rather than breaking the app.
 *   v1 (no version field): { activities, leads, recruits, names }
 */
export function migrate(raw) {
  const out = emptyStore();
  if (!raw || typeof raw !== 'object') return out;
  for (const k of ARRAYS) if (Array.isArray(raw[k])) out[k] = raw[k];
  if (raw.profile && typeof raw.profile === 'object') out.profile = { ...out.profile, ...raw.profile };
  if (typeof raw.lastBackupAt === 'string') out.lastBackupAt = raw.lastBackupAt;
  // v1 had no profile. Anyone who already logged sales activity was licensed.
  if (!raw.version && out.activities.some((a) => ['dial', 'app_written'].includes(a?.type))) out.profile.licensed ??= true;
  return out;
}

/**
 * Check a backup someone pasted before it replaces anything.
 * Returns { ok: true, store, summary } or { ok: false, error }.
 */
export function readBackup(text) {
  let raw;
  try { raw = JSON.parse(String(text).trim()); } catch { return { ok: false, error: 'That isn’t a backup. Paste the whole text you copied, from the first { to the last }.' }; }
  if (!raw || raw.app !== 'agent-reels' || !raw.data) return { ok: false, error: 'That text isn’t an Agent Reels backup.' };
  if (raw.data.version > STORE_VERSION) return { ok: false, error: 'That backup is from a newer version of the app. Update the app first.' };
  const store = migrate(raw.data);
  const bad = store.activities.find((a) => !a || typeof a.type !== 'string' || Number.isNaN(Date.parse(a.occurred_at)));
  if (bad) return { ok: false, error: 'That backup is damaged: one of its entries has no type or date.' };
  return { ok: true, store, summary: `${store.activities.length} log entries and ${store.leads.length} people, backed up ${raw.savedAt ? raw.savedAt.slice(0, 10) : 'on an unknown date'}` };
}

/** The text to copy or save as a backup. */
export function writeBackup(store, now = new Date()) {
  return JSON.stringify({ app: 'agent-reels', savedAt: now.toISOString(), data: { ...store, version: STORE_VERSION } });
}

/** Days since the last backup, or since the first entry if never backed up; null when there's nothing to lose. */
export function backupAge(store, now = new Date()) {
  if (!store.activities.length && !store.leads.length) return null;
  const since = store.lastBackupAt || store.activities.map((a) => a.occurred_at).sort()[0];
  if (!since) return null;
  return Math.floor((now - new Date(since)) / 86_400_000);
}
