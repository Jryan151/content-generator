#!/usr/bin/env bash
# update.sh — update the app safely: back up, check the new version, try it on a copy of your data,
# switch, and make sure the site answers. If anything fails, the previous version is put back.
# Your data (data/, videos/, backups/, .env, .app-key) is never touched.
#
#   bash update.sh /root/update-v15.zip   zip install
#   bash update.sh                        git install: pull the newest version
#   bash update.sh v12.1.0                git install: switch to that tag or commit
#   bash update.sh --no-pull              you already unzipped or changed the files yourself
#   bash update.sh --use-releases         once: move to side-by-side releases (SETUP.md section AO)
#   bash update.sh --rollback             side-by-side releases: back to the version before (instant)
#
# With side-by-side releases each version lives in releases/<version>/ and `current` points at the live
# one. A new version is unpacked next to it, its files checked against its build sheet, its checks run,
# and it's started on a spare port against a copy of your data (its data changes run there first). Only
# then does `current` switch, in one step; going back is the same switch the other way.
#
# Settings for testing (leave alone on a real server): PM2, APP_NAME, HEALTH_URL, HEALTH_TRIES, TEST_CMD,
# REHEARSE (0: skip the try-out on a copy), REHEARSAL_PORT, ALLOW_NO_BUILD_SHEET.
set -euo pipefail
cd "$(dirname "$0")"
APP_DIR="$(pwd -P)"   # the real folder (/root/generator may be a link to /srv/generator)
# If the app runs as its own user (SETUP.md section U), run the update as that user too: files stay
# theirs, and pm2 restarts their copy of the app. A zip in /root is copied somewhere they can read.
OWNER="$(stat -c %U "$APP_DIR/data" 2>/dev/null || echo root)"
if [ "$(id -u)" = 0 ] && [ "$OWNER" != root ] && [ -z "${UPDATE_AS_OWNER:-}" ]; then
  args=("$@")
  if [ -n "${1:-}" ] && [ -f "$1" ]; then tmpzip="/tmp/update-$$.zip"; cp "$1" "$tmpzip"; chown "$OWNER" "$tmpzip"; args=("$tmpzip" "${@:2}"); fi
  home="$(getent passwd "$OWNER" | cut -d: -f6)"
  cd /
  exec runuser -u "$OWNER" -- env HOME="$home" UPDATE_AS_OWNER=1 PATH="$PATH" bash "$APP_DIR/update.sh" "${args[@]}"
fi
PM2="${PM2:-pm2}"
APP_NAME="${APP_NAME:-generator}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT:-3100}/api/health}"
TEST_CMD="${TEST_CMD:-npm test --silent}"
HEALTH_TRIES="${HEALTH_TRIES:-20}"
REHEARSAL_PORT="${REHEARSAL_PORT:-3199}"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARG="${1:-}"
# What never belongs to the code: the update never changes or restores these.
KEEP=(./data ./videos ./backups ./fonts ./music ./prompts ./node_modules ./.env ./.app-key ./.app-key.old ./.git ./releases ./current ./Poppins-Bold.ttf)
excludes() { for k in "${KEEP[@]}"; do printf -- '--exclude=%s\n' "$k"; done; }

say() { echo "$*"; }
fail() { echo; echo "UPDATE STOPPED: $*"; exit 1; }
WORKER_APP="$APP_NAME-worker"
has_worker() { "$PM2" jlist 2>/dev/null | grep -q "\"name\":\"$WORKER_APP\""; }
restart_all() { "$PM2" restart "$APP_NAME" --update-env >/dev/null; if has_worker; then "$PM2" restart "$WORKER_APP" --update-env >/dev/null; fi; }
up() { local code; code="$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 3 "$HEALTH_URL" || true)"; [ "$code" = 200 ] || [ "$code" = 503 ]; }
answers() { for _ in $(seq 1 "$HEALTH_TRIES"); do if up; then return 0; fi; sleep 1; done; return 1; }
RELEASES=0; [ -d releases ] && [ -L current ] && RELEASES=1

# A zip's paths are checked before it's unpacked anywhere.
check_zip() {
  command -v unzip >/dev/null || fail "unzip isn't installed: apt install -y unzip"
  ZIPLIST="$(mktemp)"
  unzip -Z1 "$1" | grep -v '/$' > "$ZIPLIST" || fail "that zip can't be read."
  if grep -Eq '(^|/)\.\.(/|$)|^/' "$ZIPLIST"; then fail "that zip has unsafe paths in it."; fi
  if grep -Eq '^(\./)?(data|videos|backups|node_modules|releases|current|\.git)(/|$)|^(\./)?\.(env|app-key|app-key\.old)$' "$ZIPLIST"; then fail "that zip would overwrite your data or keys, so it wasn't used."; fi
}
# The build sheet (BUILD.json): every file of the release matches its SHA-256.
# Returns 1 (having said why) when it doesn't match; the caller cleans up and stops.
check_sheet() {
  local dir="$1"
  if [ -f "$dir/BUILD.json" ]; then
    [ -f "$dir/tools/build-sheet.mjs" ] || { echo "The release has a build sheet but no tool to check it."; return 1; }
    node "$dir/tools/build-sheet.mjs" verify "$dir" || { echo "The release doesn't match its build sheet (above): a damaged download, or files changed by hand. Download it again."; return 1; }
  elif [ -z "${ALLOW_NO_BUILD_SHEET:-}" ]; then
    echo "That zip has no build sheet (BUILD.json), so it isn't a checked release. (ALLOW_NO_BUILD_SHEET=1 uses it anyway.)"; return 1
  fi
}
# The try-out: the new code started on a spare port against a copy of the data (from the backup just
# made), with nothing sent out (no posting, emails or overnight work). Its data changes run on the copy.
TRYOUT_PID="" TRYOUT_DIR=""
# However the script ends (an error, Ctrl-C, a dropped SSH session), the try-out server is stopped and
# its copy removed.
cleanup_tryout() { if [ -n "$TRYOUT_PID" ]; then kill "$TRYOUT_PID" 2>/dev/null || true; wait "$TRYOUT_PID" 2>/dev/null || true; TRYOUT_PID=""; fi; if [ -n "$TRYOUT_DIR" ]; then rm -rf "$TRYOUT_DIR"; TRYOUT_DIR=""; fi; }
trap cleanup_tryout EXIT INT TERM HUP
rehearse() {
  local code="$1"
  [ "${REHEARSE:-1}" = 0 ] && return 0
  [ -f "$code/server.js" ] || return 0
  if [ ! -f "${BACKUP:-}" ]; then say "   (No backup to try the new version on, so the try-out is skipped.)"; return 0; fi
  say "   Trying the new version on a copy of your data…"
  local tmp; tmp="$(mktemp -d)"; TRYOUT_DIR="$tmp"
  mkdir -p "$tmp/data" "$tmp/videos" "$tmp/backups" "$tmp/fonts" "$tmp/music"
  tar -xzf "$BACKUP" -C "$tmp/data" 2>/dev/null || { cleanup_tryout; say "   (Couldn't unpack the backup for the try-out, so it's skipped.)"; return 0; }
  [ -f "$tmp/data/app-snapshot.db" ] && mv "$tmp/data/app-snapshot.db" "$tmp/data/app.db"
  # The key goes where the app looks for it: next to its data folder (the live one may not be here).
  local keydir; keydir="$(cd "$code" && node --input-type=module -e "import path from 'path'; const p = await import('./lib/paths.js'); console.log(path.dirname(p.DIRS.data));" 2>/dev/null || echo "$APP_DIR")"
  for k in .app-key .app-key.old; do [ -f "$keydir/$k" ] && cp -p "$keydir/$k" "$tmp/$k"; done
  local log="$tmp/server.log" ok=0 body=""
  # Something else already answering on the spare port would pass for the new version: refuse that.
  if curl -s --noproxy '*' --max-time 2 -o /dev/null "http://127.0.0.1:$REHEARSAL_PORT/" 2>/dev/null; then cleanup_tryout; say "   Port $REHEARSAL_PORT is already in use (REHEARSAL_PORT picks another)."; return 1; fi
  # (exec: the process started is the server itself, so stopping it really stops it. Its own fonts and
  # music folders: the live ones are never touched.)
  ( cd "$code" && exec env -u ALERT_WEBHOOK_URL REHEARSAL=1 DATA_DIR="$tmp/data" VIDEOS_DIR="$tmp/videos" BACKUP_DIR="$tmp/backups" FONT_DIR="$tmp/fonts" MUSIC_DIR="$tmp/music" PORT="$REHEARSAL_PORT" HOST=127.0.0.1 node server.js >"$log" 2>&1 ) &
  TRYOUT_PID=$!
  local pid=$TRYOUT_PID
  for _ in $(seq 1 120); do
    body="$(curl -s --noproxy '*' --max-time 3 "http://127.0.0.1:$REHEARSAL_PORT/api/health" || true)"
    # (It answers at once, then runs its data changes: done when it no longer says "starting".)
    if [ -n "$body" ] && ! echo "$body" | grep -q '"starting":true'; then ok=1; break; fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  local tail_log; tail_log="$(tail -20 "$log" 2>/dev/null || true)"
  cleanup_tryout
  if [ "$ok" != 1 ]; then echo "$tail_log"; return 1; fi
  if echo "$body" | grep -q '"changes":false'; then echo "$tail_log"; say "   Its data changes failed on the copy (above)."; return 1; fi
  if echo "$body" | grep -q '"keys":false'; then say "   It couldn't read the data with this server's key. (If APP_KEY is set only in pm2, put it in .env too.)"; return 1; fi
  say "   It started and changed the copy cleanly."
}
backup_first() {
  say "1/5 Backing up data…"
  mkdir -p backups
  # A consistent copy (with SQLite, a safe snapshot of the database, not the live file), unpacked and
  # checked. If it can't be made, nothing is changed: an update never runs without a good backup.
  BACKUP="backups/pre-update-$STAMP.tar.gz"
  if [ -n "${SKIP_BACKUP:-}" ]; then
    say "   (skipped: SKIP_BACKUP is set)"
  elif grep -q "pre-update-backup" "${1:-.}/admin.js" 2>/dev/null; then
    node "${1:-.}/admin.js" pre-update-backup "$BACKUP" || fail "the backup before the update didn't work (see above), so nothing was changed. Free some disk space (df -h /) and try again."
  else
    # Versions before 15 don't have the checked backup: a plain copy, which must at least succeed.
    # (tar exits 1 when a file changed while it read it, which happens on a live server; the copy is still good.)
    rc=0; tar -czf "$BACKUP" --exclude=./cache --exclude=./work --exclude=./assets -C data . || rc=$?
    [ "$rc" -le 1 ] || fail "the backup before the update didn't work, so nothing was changed."
  fi
}
# Version 15 makes the database the standard (SETUP.md section T). A server still on JSON files is moved
# once, with the app stopped so nothing is written during the move. If the move fails, nothing is lost
# and the app keeps running on files. STAY_ON_JSON=1 skips it.
storage_move() {
  local code="$1"
  if grep -q "storage auto" "$code/admin.js" 2>/dev/null && (cd "$code" && node admin.js storage auto --check >/dev/null 2>&1); then
    say "   Moving your data into the database (once; it's checked document by document)…"
    "$PM2" stop "$APP_NAME" >/dev/null 2>&1 || true
    (cd "$code" && node admin.js storage auto) || say "   The move didn't work (see above). Nothing was lost; the app stays on JSON files."
  fi
}

# The thin starters left in the app folder by --use-releases: they run whatever `current` points at, so
# pm2, `node admin.js …` and your habits stay the same.
write_starters() {
  cat > server.js <<'JS'
// Starts the live release (releases/<version>, through the `current` link: SETUP.md section AO).
const { main } = await import('./current/server.js');
main();
JS
  cat > worker.js <<'JS'
// Starts the live release's video worker (SETUP.md sections AL and AO).
await import('./current/worker.js');
JS
  cat > admin.js <<'JS'
// Runs the live release's admin commands (SETUP.md section AO).
await import('./current/admin.js');
JS
  printf '{ "name": "agent-reels", "private": true, "type": "module", "description": "Side-by-side releases: the code is in releases/, the live one is current/ (SETUP.md section AO)." }\n' > package.json
}
# A release folder name: digits, letters, dots, dashes and underscores only (never a path).
valid_version() { if ! printf '%s' "$1" | grep -Eq '^[0-9A-Za-z._-]{1,40}$' || [ "$1" = . ] || [ "$1" = .. ]; then echo "UPDATE STOPPED: the release's version (\"$1\") isn't a plain version number."; return 1; fi; }
switch_to() {   # switch_to <release dir name>: one rename, so `current` is never missing
  ln -sfn "releases/$1" current.new && mv -Tf current.new current
}

# ---------------- Moving to side-by-side releases (once) ----------------
if [ "$ARG" = "--use-releases" ]; then
  [ "$RELEASES" = 1 ] && { say "Already using side-by-side releases (current → $(readlink current))."; exit 0; }
  [ -f server.js ] && [ -f package.json ] || fail "this doesn't look like the app folder."
  # Only the app's own files move: the ones its build sheet lists (a version 15 zip install has one).
  # Anything else you keep in this folder stays where it is.
  [ -f BUILD.json ] && [ -f tools/build-sheet.mjs ] || fail "this needs a version 15 install from a zip (it has a build sheet, BUILD.json). Update with a zip first."
  node tools/build-sheet.mjs verify . >/dev/null || fail "the app's files don't match its build sheet (changed by hand?), so they weren't moved: node tools/build-sheet.mjs verify ."
  V="$(node -p "require('./package.json').version")"
  valid_version "$V"
  say "Moving version $V into releases/$V (your data stays where it is)…"
  backup_first .
  FILES="$(mktemp)"
  node -e "const s=require('./BUILD.json'); for (const f of Object.keys(s.files)) console.log(f); console.log('BUILD.json')" > "$FILES"
  SNAP="backups/code-before-releases-$STAMP.tar.gz"
  tar -czf "$SNAP" -T "$FILES" || fail "couldn't save a copy of the current code."
  mkdir -p "releases/$V"
  tar -xzf "$SNAP" -C "releases/$V"
  cp update.sh "releases/$V/update.sh"
  switch_to "$V"
  # The old code files go (they're in releases/$V and in $SNAP); the starters take their place.
  while IFS= read -r f; do [ -n "$f" ] && [ "$f" != update.sh ] && rm -f -- "$f"; done < "$FILES"
  find . -mindepth 1 -type d -empty -not -path './releases*' -not -path './data*' -not -path './videos*' -not -path './backups*' -not -path './fonts*' -not -path './music*' -not -path './prompts*' -delete 2>/dev/null || true
  rm -f "$FILES"
  write_starters
  restart_all
  if ! answers; then
    say "The site didn't come back; putting the old layout back…"
    rm -f server.js worker.js admin.js package.json current
    tar -xzf "$SNAP"; rm -rf releases
    restart_all
    fail "the move to side-by-side releases didn't work; nothing else changed (check: pm2 logs $APP_NAME --lines 50)."
  fi
  "$PM2" save >/dev/null 2>&1 || true
  say "Done. Version $V now runs from releases/$V; next updates go next to it, and bash update.sh --rollback goes back."
  exit 0
fi

# ---------------- Going back (side-by-side releases) ----------------
if [ "$ARG" = "--rollback" ]; then
  [ "$RELEASES" = 1 ] || fail "--rollback needs side-by-side releases (bash update.sh --use-releases). For a zip install, update to the earlier zip."
  PREV="$(cat releases/.previous 2>/dev/null || true)"
  [ -n "$PREV" ] && [ -d "releases/$PREV" ] || fail "there's no earlier release to go back to."
  NOW="$(basename "$(readlink current)")"
  say "Going back: $NOW → $PREV…"
  switch_to "$PREV"; echo "$NOW" > releases/.previous
  restart_all
  answers || fail "the earlier version didn't answer either (check: pm2 logs $APP_NAME --lines 50). bash update.sh --rollback switches again."
  "$PM2" save >/dev/null 2>&1 || true
  say "Done. Now running $PREV. (The data changes of $NOW stay: they only ever add, so $PREV reads the data fine.)"
  exit 0
fi

# ---------------- Updating with side-by-side releases ----------------
if [ "$RELEASES" = 1 ]; then
  [ -n "$ARG" ] && [ -f "$ARG" ] || fail "with side-by-side releases, update from a zip: bash update.sh /root/update.zip"
  check_zip "$ARG"
  NOW="$(basename "$(readlink current)")"
  backup_first current
  say "2/5 Unpacking next to the live version…"
  INC="releases/.incoming-$STAMP"
  mkdir -p "$INC"
  unzip -q "$ARG" -d "$INC" || { rm -rf "$INC"; fail "the zip didn't unpack cleanly. Nothing changed."; }
  V="$(cd "$INC" && node -p "require('./package.json').version" 2>/dev/null || true)"
  [ -n "$V" ] || { rm -rf "$INC"; fail "the zip has no package.json version."; }
  valid_version "$V" || { rm -rf "$INC"; exit 1; }
  NEW="$V"; [ -e "releases/$NEW" ] && NEW="$V-$STAMP"
  mv "$INC" "releases/$NEW"
  check_sheet "releases/$NEW" || { rm -rf "releases/$NEW"; fail "the release wasn't used (above). The live version was never touched."; }
  say "3/5 Running checks…"
  if ! (cd "releases/$NEW" && bash -c "$TEST_CMD"); then rm -rf "releases/$NEW"; fail "the checks failed (above). The live version was never touched."; fi
  if ! rehearse "releases/$NEW"; then rm -rf "releases/$NEW"; fail "the new version didn't run cleanly on a copy of your data (above). The live version was never touched."; fi
  storage_move "releases/$NEW"
  say "4/5 Switching $NOW → $NEW…"
  switch_to "$NEW"
  restart_all
  say "5/5 Checking the site answers…"
  if ! answers; then
    switch_to "$NOW"; restart_all
    fail "the new version didn't start; switched back to $NOW (check: pm2 logs $APP_NAME --lines 50)."
  fi
  # Only now: the way back, and the new update.sh.
  echo "$NOW" > releases/.previous
  cp "releases/$NEW/update.sh" update.sh.new && mv -f update.sh.new update.sh
  "$PM2" save >/dev/null 2>&1 || true
  # Kept: the live one, the one before (for --rollback) and one more.
  for old in $(ls -1t releases | grep -v '^\.' | tail -n +4); do
    if [ "$old" != "$NEW" ] && [ "$old" != "$NOW" ]; then rm -rf "releases/$old"; fi
  done
  [ -n "${ZIPLIST:-}" ] && rm -f "$ZIPLIST"
  say "Done. Now running version $V (releases/$NEW). To go back: bash update.sh --rollback"
  exit 0
fi

# ---------------- Updating in place (one folder) ----------------
mode=none
if [ -n "$ARG" ] && [ "$ARG" != "--no-pull" ] && [ -f "$ARG" ]; then mode=zip
elif [ "$ARG" != "--no-pull" ] && [ -d .git ]; then mode=git
fi

# A zip is checked (paths, then its build sheet in a scratch folder) before anything else.
ZIPLIST=""
if [ "$mode" = zip ]; then
  check_zip "$ARG"
  STAGE="$(mktemp -d)"
  unzip -q "$ARG" -d "$STAGE" || { rm -rf "$STAGE"; fail "that zip can't be unpacked."; }
  check_sheet "$STAGE" || { rm -rf "$STAGE"; fail "the zip wasn't used (above). Nothing changed."; }
  rm -rf "$STAGE"
fi

backup_first .

# How to put the old code back, decided before anything changes.
PREV="" SNAP=""
if [ "$mode" = git ]; then
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    git status --short --untracked-files=no
    fail "these files were changed on the server by hand. Commit or undo them first (git stash), then run the update again."
  fi
  PREV="$(git rev-parse HEAD)"
elif [ "$mode" = zip ]; then
  SNAP="backups/code-before-$STAMP.tar.gz"
  # shellcheck disable=SC2046
  tar -czf "$SNAP" $(excludes) . || fail "couldn't save a copy of the current code."
fi

rollback() {
  say "Putting the previous version back…"
  if [ "$mode" = git ] && [ -n "$PREV" ]; then
    git reset --hard -q "$PREV"
  elif [ "$mode" = zip ] && [ -n "$SNAP" ]; then
    # Files the zip added that weren't there before go; then the saved copy comes back.
    tar -tzf "$SNAP" | sed 's#^\./##' > "$ZIPLIST.old"
    while IFS= read -r f; do
      [ -n "$f" ] && [ -f "$f" ] && ! grep -Fxq "$f" "$ZIPLIST.old" && rm -f -- "$f"
    done < "$ZIPLIST"
    tar -xzf "$SNAP"
  else
    say "(No automatic rollback for --no-pull: restore your own copy if needed.)"
    return 1
  fi
}

say "2/5 Updating the code…"
rm -f lib.js stages/publish.js          # files from very old versions
rm -rf node_modules package-lock.json    # this app has no packages to install
case "$mode" in
  git)
    if [ -n "$ARG" ]; then git fetch --tags -q && git checkout -q "$ARG" || fail "couldn't switch to $ARG."
    else git pull --ff-only -q || fail "git pull didn't work (see above). Nothing was changed."; fi
    say "   $(git rev-parse --short "$PREV") → $(git rev-parse --short HEAD)";;
  zip) unzip -o -q "$ARG" -d "$APP_DIR" || { rollback; fail "the zip didn't unpack cleanly; the previous version is back."; };;
  none) say "   (using the files as they are)";;
esac

say "3/5 Running checks…"
if ! bash -c "$TEST_CMD"; then
  rollback && say "The previous version is back. The running site was NOT restarted, so nothing changed for your agents."
  fail "the checks failed. Send the output above for help."
fi
if ! rehearse .; then
  rollback && say "The previous version is back. The running site was NOT restarted, so nothing changed for your agents."
  fail "the new version didn't run cleanly on a copy of your data (above)."
fi

storage_move .

say "4/5 Restarting…"
restart_all

say "5/5 Checking the site answers…"
if ! answers; then
  rollback && restart_all && say "Restarted the previous version."
  fail "the new version didn't start (check: pm2 logs $APP_NAME --lines 50)."
fi
"$PM2" save >/dev/null 2>&1 || true
[ -n "$ZIPLIST" ] && rm -f "$ZIPLIST" "$ZIPLIST.old"
say "Done. Now running version $(node -p "require('./package.json').version")."
[ -d releases ] || say "Tip: bash update.sh --use-releases (once) keeps each version side by side, so going back is instant (SETUP.md section AO)."
