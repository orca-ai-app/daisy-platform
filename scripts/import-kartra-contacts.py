#!/usr/bin/env python3
"""
import-kartra-contacts.py

One-off seed of the HQ mini-CRM from a Kartra contacts export into da_customers.
Grows from bookings after that; this just loads the historical base.

GDPR: a contact is emailable ONLY when gdpr_status == 'Accepted' AND
gdpr_communications == 'Yes'. Everyone else is still imported (they're history),
but with marketing_opt_out = true AND an entry in da_email_suppressions, so no
broadcast can ever reach them until they re-consent.

Idempotent: da_customers is keyed on email. Existing rows (e.g. contacts that
already grew from a booking) are NOT overwritten — on-conflict does nothing —
so live booking data is never clobbered by a stale export.

Usage:
  PROJECT_REF=... SERVICE_ROLE_KEY=... \
  python3 import-kartra-contacts.py --csv /path/to/contacts.csv [--dry-run|--load] [--source kartra_2026-09-17]

Credentials fall back to ../docs/credentials.md (PROJECT_REF / SERVICE_ROLE_KEY),
mirroring apply-migrations.sh.
"""
import argparse, csv, json, os, re, sys, urllib.request, urllib.error

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
BATCH = 1000

def read_credential(key, creds_file):
    if not os.path.isfile(creds_file):
        return None
    with open(creds_file) as f:
        for line in f:
            m = re.match(rf'^{key}\s*[:=]\s*"?([^"]*)"?', line)
            if m:
                return m.group(1).strip()
    return None

def norm(s):
    return (s or "").strip()

def post_rows(base_url, service_key, table, rows, on_conflict):
    """Bulk insert via PostgREST, ignoring duplicates (on_conflict DO NOTHING)."""
    url = f"{base_url}/rest/v1/{table}?on_conflict={on_conflict}"
    body = json.dumps(rows).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("apikey", service_key)
    req.add_header("Authorization", f"Bearer {service_key}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "resolution=ignore-duplicates,return=minimal")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, ""
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--load", action="store_true")
    ap.add_argument("--source", default="kartra_2026-09-17")
    args = ap.parse_args()
    if args.load == args.dry_run:
        sys.exit("Pick exactly one of --dry-run or --load")

    here = os.path.dirname(os.path.abspath(__file__))
    creds = os.path.join(here, "..", "..", "docs", "credentials.md")
    ref = os.environ.get("PROJECT_REF") or read_credential("PROJECT_REF", creds)
    key = os.environ.get("SERVICE_ROLE_KEY") or read_credential("SERVICE_ROLE_KEY", creds)
    if not ref or not key:
        sys.exit("PROJECT_REF / SERVICE_ROLE_KEY not set and not found in docs/credentials.md")
    base_url = f"https://{ref}.supabase.co"

    customers, suppressions = [], []
    seen = set()
    stats = {"rows": 0, "skipped_email": 0, "dupe": 0, "eligible": 0, "suppressed": 0}

    with open(args.csv, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            stats["rows"] += 1
            email = norm(row.get("email")).lower()
            if not EMAIL_RE.match(email):
                stats["skipped_email"] += 1
                continue
            if email in seen:
                stats["dupe"] += 1
                continue
            seen.add(email)
            eligible = (norm(row.get("gdpr_status")).lower() == "accepted"
                        and norm(row.get("gdpr_communications")).lower() == "yes")
            cust = {
                "email": email,
                "first_name": norm(row.get("first_name")),
                "last_name": norm(row.get("last_name")),
                "phone": norm(row.get("phone")) or None,
                "postcode": (norm(row.get("zip")) or None),
                "source": args.source,
                "marketing_opt_out": not eligible,
            }
            customers.append(cust)
            if eligible:
                stats["eligible"] += 1
            else:
                stats["suppressed"] += 1
                suppressions.append({"email": email, "source": "manual"})

    print(f"Parsed {stats['rows']:,} rows -> {len(customers):,} unique contacts "
          f"({stats['eligible']:,} emailable, {stats['suppressed']:,} suppressed); "
          f"{stats['skipped_email']:,} bad email, {stats['dupe']:,} dupes skipped.")

    if args.dry_run:
        print("DRY RUN — no writes.")
        return

    # --- load ---
    ins = 0
    for i in range(0, len(customers), BATCH):
        chunk = customers[i:i + BATCH]
        status, err = post_rows(base_url, key, "da_customers", chunk, "email")
        if status not in (200, 201):
            sys.exit(f"da_customers batch {i//BATCH} failed [{status}]: {err[:400]}")
        ins += len(chunk)
        print(f"  da_customers: {ins:,}/{len(customers):,}")
    sup = 0
    for i in range(0, len(suppressions), BATCH):
        chunk = suppressions[i:i + BATCH]
        status, err = post_rows(base_url, key, "da_email_suppressions", chunk, "email")
        if status not in (200, 201):
            sys.exit(f"da_email_suppressions batch {i//BATCH} failed [{status}]: {err[:400]}")
        sup += len(chunk)
        print(f"  da_email_suppressions: {sup:,}/{len(suppressions):,}")
    print("LOAD COMPLETE (existing rows left untouched via on-conflict ignore).")

if __name__ == "__main__":
    main()
