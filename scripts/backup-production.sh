#!/usr/bin/env bash
#
# Verified logical backup of the production database.
#   DATABASE_URL=... bash scripts/backup-production.sh
#
# Railway's managed backups are not available on the current plan, so the
# release prerequisite is met with a logical dump that is actually restored and
# verified — see docs/releases/message-delivery-p0-production-backup.md.
#
# `pg_dump` only reads. Nothing here writes to production.
#
# The connection is passed through environment variables and a 0600 .pgpass,
# never as a command-line argument: argv is world-readable in the process list,
# and a URL there would leak the password to every user on the machine.
set -euo pipefail
umask 077

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set." >&2
  exit 1
fi

# Kept outside the repository and outside any synced folder (Desktop,
# Documents, iCloud Drive). A dump must never end up in git or in a cloud sync.
BACKUP_DIR="${NOX_BACKUP_DIR:-$HOME/.local/share/nox-backups}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

PG_BIN="${PG_BIN:-/usr/local/Cellar/postgresql@18/18.4/bin}"
PG_DUMP="$PG_BIN/pg_dump"
[[ -x "$PG_DUMP" ]] || PG_DUMP="$(command -v pg_dump)"

# Split the URL without ever printing it. The server is PostgreSQL 18, so the
# dumper must be 18 or newer — an older pg_dump refuses outright.
eval "$(python3 - <<'PY'
import os, urllib.parse as u
p = u.urlparse(os.environ["DATABASE_URL"])
def q(v): return "'" + str(v or "").replace("'", "'\\''") + "'"
print(f"PGHOST={q(p.hostname)}")
print(f"PGPORT={q(p.port or 5432)}")
print(f"PGUSER={q(u.unquote(p.username or ''))}")
print(f"PGDATABASE={q(p.path.lstrip('/'))}")
print(f"__PGPASS={q(u.unquote(p.password or ''))}")
PY
)"
export PGHOST PGPORT PGUSER PGDATABASE

PGPASSFILE="$(mktemp "${TMPDIR:-/tmp}/.pgpass.XXXXXX")"
chmod 600 "$PGPASSFILE"
export PGPASSFILE
printf '%s:%s:%s:%s:%s\n' "$PGHOST" "$PGPORT" "$PGDATABASE" "$PGUSER" "$__PGPASS" > "$PGPASSFILE"
unset __PGPASS
trap 'rm -f "$PGPASSFILE"' EXIT

STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/nox-production-$STAMP.dump"

echo "dumping to ${OUT##*/} in $BACKUP_DIR"
set +e
"$PG_DUMP" --format=custom --no-owner --no-privileges --file "$OUT" --verbose 2> "$BACKUP_DIR/dump-$STAMP.log"
EXIT_CODE=$?
set -e

chmod 600 "$OUT" 2>/dev/null || true
echo "exit_code=$EXIT_CODE"
if [[ $EXIT_CODE -ne 0 ]]; then
  echo "pg_dump failed; see the log next to the dump." >&2
  exit $EXIT_CODE
fi

SIZE=$(wc -c < "$OUT" | tr -d ' ')
SHA=$(shasum -a 256 "$OUT" | awk '{print $1}')
echo "size_bytes=$SIZE"
echo "sha256=$SHA"
echo "path_basename=${OUT##*/}"
