// admin.js — account tasks from the terminal.
//   node admin.js create-admin you@example.com          first admin (prints a one-time password)
//   node admin.js invite agent@example.com "Jane Doe Insurance" [--comp] [--ws <workspaceId>]
//   node admin.js reset someone@example.com             prints a password reset link
//   node admin.js list                                  workspaces, members and plans
//   node admin.js comp <workspaceId> on|off             no-charge workspace on or off
//   node admin.js delete-workspace <workspaceId> --yes  remove a workspace, its videos and its logins
//   node admin.js reset-2fa someone@example.com         turn off two-factor login (lost phone); they set it up again
//   node admin.js backup-now                            back up data/ now (and upload it off-site, if set up)
//   node admin.js restore-test [file]                   check a backup restores: the newest off-site one, or a local file
//   node admin.js pre-update-backup <file.tar.gz>       a checked backup (update.sh runs this before updating)
//   node admin.js models [--no-check]                   each AI job's models, retired ones and shutdown dates
//   node admin.js inspect [--dry-run]                   the nightly inspection, now: fixes what's safe, lists the rest
//   node admin.js decrypt-backup <file.enc> <out.tar.gz>  decrypt an off-site backup with BACKUP_KEY
//   node admin.js storage status | migrate [--dry-run] | rollback   JSON files ↔ SQLite (stop the server first)
//   node admin.js golden <workspaceId> [--label name] [--count 12]   write the golden set (fixed video ideas) with today's prompts and models
//   node admin.js golden-compare <a.json> <b.json>       side-by-side page of two golden runs
//   node admin.js reference [--accept]                  render the reference video now and compare (--accept: it's the new reference)
//   node admin.js clock                                 compare the server's clock with an outside source
//   node admin.js engine                                the Engine bay in the terminal: line, services, targets
//   node admin.js calendar                              the expiry calendar: Node, Meta's API, AI models, cards, certificate
//   node admin.js changes                               the numbered data changes: which ran, when, and what they did
//   node admin.js rotate-key [--reseal]                 a new encryption key; everything sealed again (--reseal: only that)
import fs from 'fs';
import path from 'path';
import * as store from './lib/store.js';
import { isMember, membershipsOf } from './lib/roles.js';
import * as auth from './lib/auth.js';
import { PUBLIC_URL, DIRS, removeTree } from './lib/paths.js';
import { access } from './lib/billing.js';
import { monthUsage } from './lib/usage.js';
import { record } from './lib/audit.js';
import { backup, offsiteJobs } from './lib/scheduler.js';
import * as offsite from './lib/offsite.js';
import * as storage from './lib/storage.js';

const [cmd, ...args] = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args.splice(i, 2)[1] : (args.splice(i, 1), true)) : null; };
const base = PUBLIC_URL || 'https://YOUR-SITE';
const die = msg => { console.error(msg); process.exit(1); };

store.migrateLegacy();

switch (cmd) {
  case 'create-admin': {
    const email = args[0] || die('Usage: node admin.js create-admin you@example.com');
    if (store.findAccountByEmail(email)) die('That email already has an account. Use: node admin.js reset ' + email);
    const password = auth.randomPassword();
    store.createAccount({ email, name: args[1] || '', role: 'admin', hash: await auth.hashPassword(password) });
    record({ action: 'invite.created', who: 'cli', target: store.normEmail(email), detail: 'admin created from the terminal' });
    console.log(`\nAdmin created: ${store.normEmail(email)}\nPassword: ${password}\n\nLog in at ${base} and change it under Account.`);
    break;
  }
  case 'invite': {
    const ws = flag('--ws'), comp = flag('--comp');
    const email = store.normEmail(args[0] || die('Usage: node admin.js invite agent@example.com "Workspace name" [--comp] [--ws <id>]'));
    if (store.findAccountByEmail(email)) die('That email already has an account.');
    let workspaceId = ws;
    if (workspaceId && !store.getWorkspace(workspaceId)) die('No workspace with id ' + workspaceId);
    if (!workspaceId) workspaceId = store.createWorkspace({ name: args[1] || email, comped: !!comp }).id;
    const token = auth.createLink('invite', { email, role: 'agent', workspaceId }, 'cli');
    record({ action: 'invite.created', who: 'cli', target: email, ws: workspaceId });
    console.log(`\nInvite for ${email} (workspace ${workspaceId}), valid 7 days:\n${base}/#/invite/${token}\n`);
    break;
  }
  case 'reset': {
    const acc = store.findAccountByEmail(args[0] || '') || die('No account with that email.');
    record({ action: 'reset.created', who: 'cli', target: acc.email, ws: acc.workspaceId || '' });
    console.log(`\nReset link for ${acc.email}, valid 7 days:\n${base}/#/reset/${auth.createLink('reset', { accountId: acc.id }, 'cli')}\n`);
    break;
  }
  case 'list': {
    const accounts = store.listAccounts();
    accounts.filter(a => a.role === 'admin').forEach(a => console.log(`admin  ${a.email}${a.disabled ? ' (disabled)' : ''}`));
    for (const ws of store.listWorkspaces()) {
      const a = access(ws), u = monthUsage(ws.id);
      console.log(`\n${ws.id}  ${ws.name}${ws.comped ? '  [comped]' : ''}${ws.suspended ? '  [paused]' : ''}${ws.onboarded ? '' : '  [setup not finished]'}`);
      console.log(`  plan: ${a.plan || ws.billing?.status || 'none'} · this month: ${u.videos}/${a.limit || 0} videos · AI cost ~$${u.cost.toFixed(2)}`);
      accounts.filter(x => isMember(x, ws.id)).forEach(x => console.log(`  member: ${x.email}${x.disabled ? ' (disabled)' : ''}`));
    }
    break;
  }
  case 'comp': {
    const [id, onoff] = args;
    if (!store.getWorkspace(id)) die('No workspace with id ' + id);
    store.updateWorkspace(id, { comped: onoff !== 'off' });
    record({ action: 'workspace.changed', who: 'cli', ws: id, detail: `comped: ${onoff !== 'off'}` });
    console.log(`Workspace ${id} is ${onoff !== 'off' ? 'now comped (no charge)' : 'no longer comped'}.`);
    break;
  }
  case 'delete-workspace': {
    const yes = flag('--yes');
    const ws = store.getWorkspace(args[0]) || die('No workspace with id ' + args[0]);
    // Logins that belong only here go with it; people who also work elsewhere keep theirs.
    const members = store.listAccounts().filter(a => isMember(a, ws.id) && membershipsOf(a).length === 1);
    if (!yes) die(`This permanently removes "${ws.name}", all its videos and records, and ${members.length} login(s). Cancel its Stripe subscription first if it has one.\nTo go ahead: node admin.js delete-workspace ${ws.id} --yes`);
    members.forEach(a => auth.deleteSessionsFor(a.id));
    record({ action: 'workspace.deleted', who: 'cli', ws: ws.id, target: ws.name, detail: `${members.length} login(s)` });
    store.removeAccountsIn(ws.id);
    removeTree(store.wsDir(ws.id));
    store.forgetServerClips(ws.id);
    (await import('./lib/links.js')).forgetWorkspace(ws.id);
    [path.join(DIRS.videos, ws.id), path.join(DIRS.assets, ws.id)].forEach(d => fs.rmSync(d, { recursive: true, force: true }));
    console.log(`Removed "${ws.name}" (${ws.id}) and ${members.length} login(s). Nightly backups keep a copy of its data for up to 14 days.`);
    break;
  }
  case 'reset-2fa': {
    const acc = store.findAccountByEmail(args[0] || '') || die('Usage: node admin.js reset-2fa someone@example.com');
    store.updateAccount(acc.id, { twofa: null, twofaPending: null });
    auth.deleteSessionsFor(acc.id);
    record({ action: 'twofa.reset', who: 'cli', target: acc.email, ws: acc.workspaceId || '' });
    console.log(`Two-factor login is off for ${acc.email}, and they're logged out everywhere.${acc.role === 'admin' ? ' Admins must set it up again at their next login.' : ''}`);
    break;
  }
  case 'backup-now': {
    const f = await backup();
    console.log(`Backed up data/ to ${f}`);
    if (!offsite.offsiteOn()) { console.log(offsite.keyProblem() && process.env.BACKUP_S3_BUCKET ? offsite.keyProblem() : 'Off-site backups aren’t set up (SETUP.md section Q), so it stays on this server only.'); break; }
    const r = await offsiteJobs(f, console.log);
    if (r?.uploadError) die('Off-site upload failed: ' + r.uploadError);
    break;
  }
  case 'pre-update-backup': {
    // Used by update.sh before it changes anything: a consistent archive (a safe copy of the database
    // with SQLite), checked by unpacking it. Exits with an error if either fails, so the update stops.
    const out = path.resolve(args[0] || die('Usage: node admin.js pre-update-backup backups/pre-update-<date>.tar.gz'));
    try {
      await backup(new Date(), { out });
      if (store.listAccounts().length) {
        const r = await offsite.verifyArchive(out);
        console.log(`Backed up and checked: ${path.basename(out)} (${r.accounts} logins, ${r.workspaces} workspaces, ${r.videos} videos).`);
      } else console.log(`Backed up: ${path.basename(out)} (no logins yet, so there was nothing to check).`);
    } catch (e) { fs.rmSync(out, { force: true }); die('The backup before the update failed: ' + e.message); }
    break;
  }
  case 'inspect': {
    // The nightly inspection, now. --dry-run lists what it would fix without fixing it.
    const { inspect } = await import('./lib/inspect.js');
    const r = inspect({ fix: !flag('--dry-run') });
    console.log(`Read ${r.documents} saved documents.`);
    console.log(r.fixed.length ? `\nFixed:\n  ${r.fixed.join('\n  ')}` : '\nNothing needed fixing.');
    console.log(r.problems.length ? `\nNeeds you:\n  ${r.problems.join('\n  ')}` : '\nNothing needs you.');
    break;
  }
  case 'models': {
    // Each AI job's ladder (first choice, then backups) and what's known about every model on it.
    const ai = await import('./lib/ai.js');
    if (!flag('--no-check')) { console.log('Asking each company about its models…'); await ai.checkModels(); }
    for (const j of ai.overview()) {
      console.log(`\n${j.label} (${j.job})`);
      j.rungs.forEach((r, i) => console.log(`  ${i + 1}. ${r.key}${!r.on ? '  [not set up: no key]' : ''}${r.gone ? '  RETIRED' : ''}${r.shutdownDate ? `  shuts down ${r.shutdownDate}` : ''}${r.checkError ? `  (couldn’t check: ${r.checkError})` : ''}`));
    }
    console.log('\nChange a ladder in .env with AI_LADDER_<JOB> (SETUP.md section AK).');
    break;
  }
  case 'restore-test': {
    try {
      const r = args[0] ? await offsite.verifyArchive(path.resolve(args[0])) : await offsite.restoreTest();
      console.log(`Restore test passed: ${r.file}${r.modified ? ` (uploaded ${r.modified})` : ''}
  ${r.accounts} logins (${r.admins} admin), ${r.workspaces} workspaces, ${r.videos} videos (${r.approved} with approval records), ${Math.round(r.bytes / 1024)} KB`);
      if (!r.admins) console.log('  Warning: no admin account in this backup.');
    } catch (e) { die('Restore test FAILED: ' + e.message); }
    break;
  }
  case 'decrypt-backup': {
    const [src, dst] = args;
    if (!src || !dst) die('Usage: node admin.js decrypt-backup backups/data-2026-10-15.tar.gz.enc /root/restore.tar.gz');
    try { await offsite.decryptFile(path.resolve(src), path.resolve(dst)); } catch (e) { die(e.message); }
    console.log(`Decrypted to ${dst}. Unpack it with: mkdir -p /root/restore && tar -xzf ${dst} -C /root/restore`);
    break;
  }
  case 'golden': {
    const label = flag('--label'), count = Number(flag('--count')) || 12;
    const ws = store.getWorkspace(args[0] || '') || die('Usage: node admin.js golden <workspaceId> [--label before] [--count 12]   (workspace ids: node admin.js list)');
    if (!process.env.OPENAI_API_KEY) die('OPENAI_API_KEY is missing from .env.');
    const { runGolden } = await import('./lib/golden.js');
    const { generateScript } = await import('./stages/script.js');
    const { meter } = await import('./lib/usage.js');
    console.log(`Writing the golden set for ${ws.name} (${count} cases, about a cent each)…`);
    const r = await runGolden({ cfg: store.loadConfig(ws.id), generate: generateScript, count: Math.max(1, Math.min(30, count)), label: typeof label === 'string' ? label : '', meter: meter(ws.id) });
    console.log(`\nSaved ${r.file}\nWriter ${r.run.models.writer}, hooks ${r.run.models.hooks}, critic ${r.run.models.critic}. ${r.run.cases.filter(c => c.ok).length}/${r.run.cases.length} passed.\nCompare two runs: node admin.js golden-compare <older.json> ${r.file}`);
    break;
  }
  case 'golden-compare': {
    const [a, b] = args;
    if (!a || !b) die('Usage: node admin.js golden-compare data/golden/<a>.json data/golden/<b>.json');
    const { compareHtml } = await import('./lib/golden.js');
    let A, B;
    try { A = JSON.parse(fs.readFileSync(path.resolve(a), 'utf8')); B = JSON.parse(fs.readFileSync(path.resolve(b), 'utf8')); } catch (e) { die('Couldn’t read those files: ' + e.message); }
    const out = path.resolve(b).replace(/\.json$/, '') + '-compare.html';
    fs.writeFileSync(out, compareHtml(A, B));
    console.log(`Wrote ${out}\nDownload it with your SFTP app and open it in a browser.`);
    break;
  }
  case 'storage': {
    const sub = args[0] || 'status', dry = flag('--dry-run'), force = flag('--force');
    try {
      if (sub === 'status') {
        const s = storage.status();
        console.log(`Storage: ${s.engine === 'sqlite' ? `SQLite (${s.dbFile}, ${Math.round(s.dbBytes / 1024)} KB${s.documents != null ? `, ${s.documents} documents` : ''})` : `JSON files (${s.jsonFiles} documents)`}`);
        if (s.saved.length) console.log(`JSON copies kept from a migration: ${s.saved.join(', ')} (in data/)`);
      } else if (sub === 'migrate') {
        const r = storage.migrate({ dryRun: !!dry, force: !!force });
        if (r.dryRun) console.log(`Dry run: ${r.documents} documents (${Math.round(r.bytes / 1024)} KB) all read correctly. Nothing was changed.
To move to SQLite: pm2 stop generator && node admin.js storage migrate && pm2 start generator`);
        else { record({ action: 'settings.saved', who: 'cli', detail: `storage moved to SQLite (${r.documents} documents)` }); console.log(`Moved ${r.documents} documents into SQLite and checked each one.
The JSON files are kept in ${r.savedTo}.
Start the server: pm2 start generator. To go back: pm2 stop generator && node admin.js storage rollback`); }
      } else if (sub === 'rollback') {
        const r = storage.rollback({ force: !!force });
        record({ action: 'settings.saved', who: 'cli', detail: `storage moved back to JSON files (${r.documents} documents)` });
        console.log(`Wrote ${r.documents} documents back to JSON files and checked each one. The database is kept as ${r.keptDatabase}.
Start the server: pm2 start generator`);
      } else if (sub === 'auto') {
        // update.sh: move a JSON-files server into the database once (v15 makes SQLite the standard).
        // `--check` only says whether it's needed (exit 0 yes, 3 no). STAY_ON_JSON=1 opts out.
        const needed = storage.autoMoveNeeded();
        if (flag('--check')) process.exit(needed ? 0 : 3);
        if (!needed) { console.log('Nothing to move: already on SQLite (or staying on JSON files).'); break; }
        const r = storage.migrate({});
        record({ action: 'settings.saved', who: 'cli', detail: `storage moved to SQLite by the update (${r.documents} documents)` });
        console.log(`Moved ${r.documents} documents into the database and checked each one. The JSON files are kept in ${r.savedTo}. To go back: pm2 stop generator && node admin.js storage rollback`);
      } else die('Usage: node admin.js storage status | migrate [--dry-run] | rollback');
    } catch (e) { die(e.message); }
    break;
  }
  case 'reference': {
    // The nightly reference render, now (lib/reference.js).
    const ref = await import('./lib/reference.js');
    const { saveMaintenance } = await import('./lib/scheduler.js');
    console.log('Rendering the reference video…');
    try {
      const r = await ref.check({ accept: !!flag('--accept') });
      saveMaintenance({ reference: { at: new Date().toISOString(), ...r } });
      if (r.saved) console.log(`Saved as the reference (FFmpeg ${r.ffmpeg || '?'}): data/reference/reference.mp4`);
      else if (r.ok) console.log(`Same as the reference (difference ${r.diff}, limit ${ref.LIMIT()}). FFmpeg ${r.ffmpeg || '?'}.`);
      else { console.log(`Different from the reference: ${r.problems.join('; ')}.\nWatch data/reference/latest.mp4 and reference.mp4; if the new one looks right: node admin.js reference --accept`); process.exitCode = 2; }
    } catch (e) { die('Couldn’t render the reference: ' + e.message); }
    break;
  }
  case 'clock': {
    const clock = await import('./lib/clock.js');
    const r = await clock.check();
    if (r.error) die('Couldn’t check the clock: ' + r.error);
    console.log(`This server is ${Math.abs(r.skewMs)} ms ${r.skewMs > 0 ? 'fast' : 'slow'} (± ${r.plusMinusMs} ms) against ${r.source}.${r.level ? ' Fix it: timedatectl set-ntp true && timedatectl status' : ' That’s fine.'}`);
    break;
  }
  case 'calendar': {
    const ex = await import('./lib/expiry.js');
    const items = await ex.checkExpiry();
    for (const it of items) console.log(`${it.date || '????-??-??'}  ${it.days == null ? '' : `${String(it.days).padStart(4)} days  `}${it.what}${it.level ? `  [${it.level.toUpperCase()}]` : ''}\n            ${it.action}`);
    break;
  }
  case 'changes': {
    const ch = await import('./lib/changes.js');
    const r = ch.record();
    for (const c of ch.CHANGES) { const a = r.applied[c.n]; console.log(`${String(c.n).padStart(3)}. ${c.name}\n     ${a ? `ran ${a.at}${a.result ? `: ${JSON.stringify(a.result).slice(0, 160)}` : ''}` : 'not yet (runs when the server starts)'}`); }
    if (r.failed) console.log(`\nFAILED: ${r.failed.n}. ${r.failed.name}: ${r.failed.error} (${r.failed.at}). The ones after it wait; restart after fixing: pm2 restart generator`);
    break;
  }
  case 'rotate-key': {
    // A new key for two-factor secrets and Instagram/Facebook tokens (lib/secrets.js). The old one is
    // kept (.app-key.old) so nothing it sealed is lost; then everything is sealed again with the new one.
    const secrets = await import('./lib/secrets.js');
    const { resealAll } = await import('./lib/rekey.js');
    if (!flag('--reseal')) {
      const k = secrets.newKey();
      if (k.inEnv) {
        console.log(`Your key is APP_KEY in .env, so change it there:
  1. Add APP_KEY_OLD=<your current APP_KEY> (keep any earlier ones, comma-separated)
  2. Set APP_KEY=${k.value}
  3. pm2 restart generator --update-env
  4. node admin.js rotate-key --reseal`);
        break;
      }
      console.log(`New key ${k.keyId} is in .app-key; the old one is kept in .app-key.old (keep both with your .env backup).`);
    }
    const r = resealAll();
    console.log(`Sealed again: ${r.twofa} two-factor key(s), ${r.instagram} Instagram and ${r.facebook} Facebook token(s)${r.current ? `; ${r.current} already current` : ''}${r.unreadable ? `; ${r.unreadable} couldn’t be opened with any key (left as they were: those logins reset two-factor, those workspaces reconnect)` : ''}.
Restart so the server uses the new key: pm2 restart generator`);
    break;
  }
  case 'engine': {
    const { engineBay } = await import('./lib/engine.js');
    const e = engineBay();
    const L = e.line;
    console.log(`Line: ${L.waiting} waiting, ${L.waitingOutage} waiting out an outage, ${L.held} held, ${L.running.length} running, ${L.failed24h} failed today`);
    console.log(`Last 7 days: ${L.week.done} made, ${L.week.failed} failed · typical ${L.week.total.p50 ?? '?'}s, 95% within ${L.week.total.p95 ?? '?'}s`);
    for (const [k, v] of Object.entries(L.week.steps)) console.log(`  ${k}: typical ${v.p50}s, 95% within ${v.p95}s`);
    console.log('\nServices (24 hours):');
    for (const s of e.services) console.log(`  ${s.label}: ${s.open ? 'NOT ANSWERING (paused)' : 'ok'}${s.day ? ` · ${s.day.ok} answered, ${s.day.failed} failed` : ''}`);
    console.log('\nTargets:');
    for (const t of e.targets) console.log(`  [${t.light.toUpperCase()}] ${t.label}: ${t.value ?? '–'}${t.value != null ? t.unit : ''} (target ${t.goal}) ${t.detail}`);
    console.log(`\nDisk: ${e.disk.freeGB ?? '?'} GB free${e.disk.daysLeft != null ? `, full in about ${e.disk.daysLeft} days` : ''} · Node ${e.build.node} · FFmpeg ${e.build.ffmpeg || '?'} · ${e.build.storage}`);
    break;
  }
  default:
    console.log('Commands: create-admin <email> · invite <email> "<name>" [--comp] [--ws <id>] · reset <email> · reset-2fa <email> · list · comp <workspaceId> on|off · delete-workspace <workspaceId> --yes · storage status|migrate|rollback · backup-now · restore-test [file] · decrypt-backup <file.enc> <out.tar.gz>');
}
