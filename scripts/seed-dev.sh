#!/usr/bin/env bash
#
# seed-dev.sh
#
# Applies supabase/seed/seed-dev.sql to the remote Supabase project via the
# Management API. The seed file is idempotent - re-running drops & re-creates
# the seeded data only, preserving the 3 test fixtures (dev@, hq-test-2c@,
# franchisee-test-2c@) and any HQ-app-generated activity rows.
#
# Usage:
#   PROJECT_REF=... PERSONAL_ACCESS_TOKEN=... ./scripts/seed-dev.sh
#   # or simply:
#   ./scripts/seed-dev.sh             # reads creds from ../docs/credentials.md
#
# After the seed, the script prints a count summary so you can verify against
# the Wave 5B target row counts.
#
# Requires: bash 4+, curl, jq.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEED_FILE="${REPO_ROOT}/supabase/seed/seed-dev.sql"
CREDENTIALS_FILE="${REPO_ROOT}/../docs/credentials.md"

# ---------------------------------------------------------------------------
# Resolve credentials (PROJECT_REF + PERSONAL_ACCESS_TOKEN)
# ---------------------------------------------------------------------------

read_credential() {
  local key="$1"
  if [[ -f "$CREDENTIALS_FILE" ]]; then
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
if [[ ! -f "$SEED_FILE" ]]; then
  echo "ERROR: seed file not found at $SEED_FILE" >&2
  exit 1
fi

API_URL="https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

run_sql() {
  local query="$1"
  local payload
  payload=$(jq -nc --arg q "$query" '{query: $q}')
  curl -sS -X POST "$API_URL" \
    -H "Authorization: Bearer ${PERSONAL_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$payload"
}

run_sql_file() {
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

# ---------------------------------------------------------------------------
# Apply seed
# ---------------------------------------------------------------------------

echo "Project ref:  $PROJECT_REF"
echo "Seed file:    $SEED_FILE"
echo
echo "Applying seed..."
RESP=$(run_sql_file "$SEED_FILE")

# Errors come back as {"message": "..."} or with an "error" field. Success is
# an array (possibly empty for DDL/DML).
if echo "$RESP" | jq -e 'type == "object" and (has("message") or has("error"))' >/dev/null 2>&1; then
  echo "FAILED:" >&2
  echo "$RESP" | jq . >&2
  exit 1
fi

echo "Seed applied."
echo
echo "Row counts:"

run_sql "
  SELECT 'da_franchisees' AS table_name, count(*) AS rows FROM da_franchisees
  UNION ALL SELECT 'da_territories', count(*) FROM da_territories
  UNION ALL SELECT 'da_customers', count(*) FROM da_customers
  UNION ALL SELECT 'da_course_instances', count(*) FROM da_course_instances
  UNION ALL SELECT 'da_ticket_types', count(*) FROM da_ticket_types
  UNION ALL SELECT 'da_bookings', count(*) FROM da_bookings
  UNION ALL SELECT 'da_interest_forms', count(*) FROM da_interest_forms
  UNION ALL SELECT 'da_activities', count(*) FROM da_activities
  UNION ALL SELECT 'da_billing_runs', count(*) FROM da_billing_runs
  ORDER BY table_name;
" | jq -r '.[] | "  \(.table_name): \(.rows)"'

echo
echo "KPI hand-check (April 2026 MTD):"
run_sql "
  SELECT
    COUNT(*) AS bookings_mtd,
    COALESCE(SUM(total_price_pence), 0) AS revenue_pence_mtd
  FROM da_bookings
  WHERE created_at >= '2026-04-01' AND created_at < '2026-05-01';
" | jq -r '.[] | "  bookings_mtd: \(.bookings_mtd)  revenue_mtd: £\((.revenue_pence_mtd / 100))"'

run_sql "
  SELECT
    (SELECT COUNT(*) FROM da_franchisees WHERE is_hq = false AND status = 'active') AS active_franchisees,
    (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'active') / NULLIF(COUNT(*), 0))
       FROM da_territories) AS coverage_percent;
" | jq -r '.[] | "  active_franchisees: \(.active_franchisees)  territory_coverage: \(.coverage_percent)%"'

echo
echo "Done."
