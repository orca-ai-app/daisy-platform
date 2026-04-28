#!/usr/bin/env bash
#
# apply-migrations.sh
#
# Idempotent runner for supabase/migrations/*.sql against the remote Supabase
# project via the Management API. Mirrors the Orca apply-desktop-migrations.sh
# pattern: a schema_migrations table records which files have been applied,
# so re-running is a no-op when nothing has changed.
#
# Usage:
#   PROJECT_REF=... PERSONAL_ACCESS_TOKEN=... ./scripts/apply-migrations.sh
#
# If the env vars are missing, the script tries to read them from
# ../docs/credentials.md (relative to the daisy-platform repo root).
#
# Requires: bash 4+, curl, jq.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="${REPO_ROOT}/supabase/migrations"
CREDENTIALS_FILE="${REPO_ROOT}/../docs/credentials.md"

# ---------------------------------------------------------------------------
# Resolve credentials
# ---------------------------------------------------------------------------

read_credential() {
  local key="$1"
  if [[ -f "$CREDENTIALS_FILE" ]]; then
    # Lines look like:  KEY="value"   or   KEY: "value"
    grep -E "^${key}[[:space:]]*[:=]" "$CREDENTIALS_FILE" \
      | head -n1 \
      | sed -E "s/^${key}[[:space:]]*[:=][[:space:]]*\"?([^\"]*)\"?.*$/\1/"
  fi
}

PROJECT_REF="${PROJECT_REF:-$(read_credential PROJECT_REF || true)}"
PERSONAL_ACCESS_TOKEN="${PERSONAL_ACCESS_TOKEN:-$(read_credential PERSONAL_ACCESS_TOKEN || true)}"

if [[ -z "${PROJECT_REF:-}" ]]; then
  echo "ERROR: PROJECT_REF not set and not found in $CREDENTIALS_FILE" >&2
  exit 1
fi
if [[ -z "${PERSONAL_ACCESS_TOKEN:-}" ]]; then
  echo "ERROR: PERSONAL_ACCESS_TOKEN not set and not found in $CREDENTIALS_FILE" >&2
  exit 1
fi

API_URL="https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

run_sql() {
  # Send a SQL query to the Management API; print raw JSON response.
  local query="$1"
  local payload
  payload=$(jq -nc --arg q "$query" '{query: $q}')
  curl -sS -X POST "$API_URL" \
    -H "Authorization: Bearer ${PERSONAL_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$payload"
}

run_sql_file() {
  # Send the contents of a SQL file as a single statement batch.
  local file="$1"
  local sql
  sql=$(cat "$file")
  local payload
  payload=$(jq -nc --arg q "$sql" '{query: $q}')
  curl -sS -X POST "$API_URL" \
    -H "Authorization: Bearer ${PERSONAL_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$payload"
}

ensure_schema_migrations_table() {
  local resp
  resp=$(run_sql "
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ DEFAULT NOW()
    );
  ")
  if echo "$resp" | jq -e '.message? // .error?' >/dev/null 2>&1; then
    echo "ERROR creating schema_migrations table: $resp" >&2
    exit 1
  fi
}

is_applied() {
  local filename="$1"
  local resp
  resp=$(run_sql "SELECT 1 FROM schema_migrations WHERE filename = '${filename}' LIMIT 1;")
  # Response is a JSON array. Empty array = not applied.
  if echo "$resp" | jq -e 'length > 0' >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

mark_applied() {
  local filename="$1"
  run_sql "INSERT INTO schema_migrations (filename) VALUES ('${filename}') ON CONFLICT (filename) DO NOTHING;" >/dev/null
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "ERROR: migrations dir not found: $MIGRATIONS_DIR" >&2
  exit 1
fi

echo "Project ref:       $PROJECT_REF"
echo "Migrations source: $MIGRATIONS_DIR"
echo

ensure_schema_migrations_table

applied_count=0
skipped_count=0

# Sorted by filename — names are 0-padded so lexical sort = correct order.
shopt -s nullglob
for file in $(printf '%s\n' "$MIGRATIONS_DIR"/*.sql | sort); do
  filename=$(basename "$file")

  if is_applied "$filename"; then
    echo "skip:  $filename (already applied)"
    skipped_count=$((skipped_count + 1))
    continue
  fi

  echo "apply: $filename"
  resp=$(run_sql_file "$file")

  # Errors come back as {"message": "..."} or with an "error" field. Success is
  # an array (possibly empty for DDL).
  if echo "$resp" | jq -e 'type == "object" and (has("message") or has("error"))' >/dev/null 2>&1; then
    echo "       FAILED:" >&2
    echo "$resp" | jq . >&2
    exit 1
  fi

  mark_applied "$filename"
  applied_count=$((applied_count + 1))
done

echo
echo "Applied: $applied_count  Skipped: $skipped_count"
