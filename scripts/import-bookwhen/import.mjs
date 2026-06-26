#!/usr/bin/env node
// scripts/import-bookwhen/import.mjs
//
// One-off BookWhen → Daisy import (PRD §18). SKELETON: the COLUMN_MAP and
// matching logic are finalised once the real BookWhen CSV format is known
// (docs/M3-client-questions-jenni.md). Dry-run by default; pass --commit to write.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node import.mjs bookwhen.csv [--commit]
//
// No external deps — a tiny CSV parser is inlined so this runs with plain Node.

import { readFileSync } from 'node:fs';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'; // or: npm i @supabase/supabase-js

const [, , csvPath, ...flags] = process.argv;
const COMMIT = flags.includes('--commit');

if (!csvPath) {
  console.error('Usage: node import.mjs <bookwhen.csv> [--commit]');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}

// --- TODO: confirm against the real BookWhen export headers --------------------
// Map BookWhen CSV column headers → the fields we need. Adjust once Jenni sends
// the export (the headers below are a best guess from BookWhen's typical export).
const COLUMN_MAP = {
  customer_name: 'Attendee name',
  customer_email: 'Email', // may be absent — handle name-only
  customer_phone: 'Phone',
  course_title: 'Event title',
  event_date: 'Event date', // parse to YYYY-MM-DD
  quantity: 'Tickets',
  amount_paid: 'Amount paid', // parse to pence
};

// --- minimal CSV parser (handles quoted fields + commas) -----------------------
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch === '\r') { /* skip */ }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function toPence(str) {
  const n = Number(String(str ?? '').replace(/[£,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

async function main() {
  const raw = readFileSync(csvPath, 'utf8');
  const rows = parseCsv(raw).filter((r) => r.some((c) => c.trim() !== ''));
  if (rows.length < 2) {
    console.error('CSV has no data rows.');
    process.exit(1);
  }
  const header = rows[0].map((h) => h.trim());
  const idx = (name) => header.indexOf(name);

  const report = { rows: rows.length - 1, parsed: 0, missingEmail: 0, unmatchedCourse: 0 };
  const records = [];
  for (const r of rows.slice(1)) {
    const get = (key) => {
      const col = idx(COLUMN_MAP[key]);
      return col >= 0 ? (r[col] ?? '').trim() : '';
    };
    const email = get('customer_email').toLowerCase();
    if (!email) report.missingEmail++;
    records.push({
      name: get('customer_name'),
      email,
      phone: get('customer_phone') || null,
      course_title: get('course_title'),
      event_date: get('event_date'), // TODO: normalise to YYYY-MM-DD
      quantity: Number(get('quantity')) || 1,
      amount_pence: toPence(get('amount_paid')),
    });
    report.parsed++;
  }

  console.log('--- BookWhen import (%s) ---', COMMIT ? 'COMMIT' : 'DRY RUN');
  console.table(report);
  console.log('First 3 parsed records:', records.slice(0, 3));

  if (!COMMIT) {
    console.log('\nDry run only — nothing written. Re-run with --commit once the mapping looks right.');
    return;
  }

  // --- TODO (commit path): finalise once mapping is confirmed -----------------
  // const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  // for (const rec of records) {
  //   1. upsert da_customers by email (name-only if no email)
  //   2. match da_course_instances by template name + event_date (+ venue)
  //   3. insert da_bookings: payment_status='paid',
  //      booking_status = eventInPast ? 'attended' : 'confirmed'
  //      NO da_email_sequences for historical bookings
  // }
  void createClient;
  console.error('Commit path not yet wired — confirm COLUMN_MAP + course matching with the real CSV first.');
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
