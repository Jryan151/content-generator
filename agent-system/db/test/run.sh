#!/usr/bin/env bash
# Spin up a throwaway Postgres, load the schema, and run every database check,
# then compare the SQL roll-up with the JavaScript roll-up on the sample month.
# Usage: bash db/test/run.sh   (needs Postgres 14+ binaries; run from the repo root)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$(mktemp -d)"
PORT="${PGTEST_PORT:-54329}"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then RUN_AS=(runuser -u postgres --); chown postgres "$WORK"; fi

cleanup() { "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

"${RUN_AS[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres --auth=trust >/dev/null
"${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" start >/dev/null

PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -c 'create database agent_system;' >/dev/null
"${PSQL[@]}" -d agent_system -f "$ROOT/db/test/supabase_stubs.sql"
"${PSQL[@]}" -d agent_system -f "$ROOT/db/schema.sql"
echo "schema loaded"
"${PSQL[@]}" -d agent_system -f "$ROOT/db/test/checks.sql"

# Same numbers from SQL and from JS? Load the sample month into a fresh database.
"${PSQL[@]}" -c 'create database consistency;' >/dev/null
"${PSQL[@]}" -d consistency -f "$ROOT/db/test/supabase_stubs.sql"
"${PSQL[@]}" -d consistency -f "$ROOT/db/schema.sql"
node "$ROOT/db/test/sample-to-sql.js" > "$WORK/sample.sql"
"${PSQL[@]}" -d consistency -f "$WORK/sample.sql"
"${PSQL[@]}" -d consistency -At -F, -c \
  "select bucket, sum(dials), sum(apps_written), sum(premium_written) from rollup('1W','2026-09-01','2026-11-02') group by 1 order by 1" \
  > "$WORK/sql-weeks.csv"
node "$ROOT/db/test/compare.js" "$WORK/sql-weeks.csv"
