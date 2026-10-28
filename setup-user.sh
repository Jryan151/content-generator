#!/usr/bin/env bash
# setup-user.sh — run the app as its own user instead of root (once, as root). If anything in the
# app were ever broken into, the attacker would get a user that can only touch the app's own
# folder, not the whole server.
#
#   bash setup-user.sh --dry-run     shows every step, changes nothing
#   bash setup-user.sh               does it (about a minute of downtime)
#
# What it does: creates the user "reels", moves /root/generator to /srv/generator (and leaves a
# link at /root/generator so every command in SETUP.md still works), gives the folder to that user,
# locks down the keys, and moves the pm2 process (and its start-on-boot) to that user.
# Undo: bash setup-user.sh --undo
set -euo pipefail
APP_USER="${APP_USER:-reels}"
FROM="${FROM:-/root/generator}"
TO="${TO:-/srv/generator}"
APP_NAME="${APP_NAME:-generator}"
DRY=0; UNDO=0
for a in "$@"; do case "$a" in --dry-run) DRY=1;; --undo) UNDO=1;; *) echo "Unknown option $a"; exit 1;; esac; done

run() { echo "  \$ $*"; [ "$DRY" = 1 ] || "$@"; }
step() { echo; echo "== $*"; }
[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
command -v pm2 >/dev/null || { echo "pm2 isn't installed."; exit 1; }
PM2="$(command -v pm2)"

if [ "$UNDO" = 1 ]; then
  [ -d "$TO" ] || { echo "Nothing to undo: $TO doesn't exist."; exit 1; }
  step "Stopping the app under $APP_USER"
  run runuser -u "$APP_USER" -- env HOME="/home/$APP_USER" "$PM2" delete "$APP_NAME" || true
  run runuser -u "$APP_USER" -- env HOME="/home/$APP_USER" "$PM2" save --force || true
  run "$PM2" unstartup systemd -u "$APP_USER" --hp "/home/$APP_USER" || true
  step "Moving the app back to $FROM, owned by root"
  [ -L "$FROM" ] && run rm "$FROM"
  run mv "$TO" "$FROM"
  run chown -R root:root "$FROM"
  step "Starting it as root"
  run "$PM2" start "$FROM/server.js" --name "$APP_NAME" --cwd "$FROM"
  run "$PM2" save
  run "$PM2" startup systemd
  echo; echo "Done: the app runs as root from $FROM again."
  exit 0
fi

[ -d "$FROM" ] && [ ! -L "$FROM" ] || { echo "$FROM isn't the app folder (already moved?). Check: ls -la $FROM"; exit 1; }
[ -e "$TO" ] && { echo "$TO already exists. Move it aside first."; exit 1; }

step "1. The user $APP_USER (no password, no login shell)"
if id "$APP_USER" >/dev/null 2>&1; then echo "  (already exists)"; else run useradd --system --create-home --home-dir "/home/$APP_USER" --shell /usr/sbin/nologin "$APP_USER"; fi

step "2. Stop the app under root"
run "$PM2" delete "$APP_NAME" || true
run "$PM2" save --force

step "3. Move $FROM to $TO, and leave a link so /root/generator still works for you"
run mkdir -p "$(dirname "$TO")"
run mv "$FROM" "$TO"
run ln -s "$TO" "$FROM"

step "4. Give the folder to $APP_USER and lock down the keys"
run chown -R "$APP_USER:$APP_USER" "$TO"
run chmod 750 "$TO"
for d in data backups; do [ -d "$TO/$d" ] || [ "$DRY" = 1 ] && run chmod 700 "$TO/$d" || true; done
for f in .env .app-key; do if [ -f "$TO/$f" ] || [ "$DRY" = 1 ]; then run chmod 600 "$TO/$f"; fi; done

step "5. Start the app as $APP_USER, and on every boot"
run runuser -u "$APP_USER" -- env HOME="/home/$APP_USER" "$PM2" start "$TO/server.js" --name "$APP_NAME" --cwd "$TO"
run runuser -u "$APP_USER" -- env HOME="/home/$APP_USER" "$PM2" save
run "$PM2" startup systemd -u "$APP_USER" --hp "/home/$APP_USER"
if [ "$DRY" = 0 ] && [ -z "$("$PM2" jlist 2>/dev/null | tr -d '[] \n')" ]; then run "$PM2" unstartup systemd || true; fi

step "6. Check it answers"
if [ "$DRY" = 0 ]; then
  for _ in $(seq 1 20); do code="$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:${PORT:-3100}/api/health" || true)"; [ "$code" = 200 ] || [ "$code" = 503 ] && break; sleep 1; done
  if [ "$code" = 200 ] || [ "$code" = 503 ]; then echo "  The app is up, running as $APP_USER."; else echo "  The app didn't answer. Check: runuser -u $APP_USER -- env HOME=/home/$APP_USER pm2 logs $APP_NAME   (undo: bash $TO/setup-user.sh --undo)"; exit 1; fi
fi
echo
echo "Done. From now on:"
echo "  - Updates and admin.js commands work as before from /root/generator (they switch to $APP_USER by themselves)."
echo "  - The app's pm2: runuser -u $APP_USER -- env HOME=/home/$APP_USER pm2 status   (or: pm2 logs / restart)"
