/* eslint-disable no-console */
// scripts/seed-territory-areas.ts
//
// Reads docs/franchisee-territory-postcodes.csv and:
//   1. Upserts one da_territory_areas row per (territory_number) for every
//      franchisee-owned area, keyed by `number`. Sets name, franchisee_id
//      (joined on the CSV's franchisee_uuid), dfa_pg_url, and status='active'.
//      Unowned areas (not in the CSV) are left untouched and keep their
//      default status='vacant'.
//   2. For every postcode prefix in the CSV's `postcodes` column
//      (comma-separated), updates the matching da_territories row by
//      `postcode_prefix` to point at the area via territory_area_id.
//   3. Backfills da_franchisees.business_name. For each franchisee, joins
//      their area names:
//        - 1 area  -> "Daisy First Aid {area}"
//        - 2 areas -> "Daisy First Aid {a} & {b}"
//        - 3+      -> "Daisy First Aid {a}, {b} & {c, ...}"
//
// Idempotent: safe to re-run. Upserts on (number) and updates da_territories
// by exact postcode_prefix; business_name is overwritten on every run.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     npx tsx scripts/seed-territory-areas.ts
//
// Uses the service-role key so it bypasses RLS. Do NOT ship the key in
// CI/CD; load it from a secret store.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var. ' +
      'Both are required so the script can bypass RLS.',
  );
  process.exit(1);
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = resolve(SCRIPT_DIR, '..', '..', 'docs', 'franchisee-territory-postcodes.csv');

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

interface CsvRow {
  franchisee_number: string;
  franchisee_name: string;
  franchisee_uuid: string;
  franchisee_email: string;
  territory_number: number;
  territory_name: string;
  postcode_count: number;
  postcodes: string[];
  dfa_pg_url: string;
}

/**
 * CSV parser that handles double-quoted fields containing commas AND embedded
 * newlines (a couple of rows in the source CSV have a literal \n inside a
 * quoted email field). Tokenises the whole document in one pass so quote
 * state survives row boundaries. No escaped-quote ("") support — not needed
 * for this file.
 */
function parseCsv(text: string): CsvRow[] {
  const records = tokeniseCsv(text);
  if (records.length === 0) return [];

  const header = records[0];
  const rows: CsvRow[] = [];
  for (let i = 1; i < records.length; i += 1) {
    const fields = records[i];
    if (fields.length < header.length) continue;
    const record: Record<string, string> = {};
    header.forEach((key, idx) => {
      record[key] = fields[idx] ?? '';
    });

    rows.push({
      franchisee_number: record.franchisee_number.trim(),
      franchisee_name: record.franchisee_name.trim(),
      franchisee_uuid: record.franchisee_uuid.trim(),
      franchisee_email: record.franchisee_email
        .replace(/[\r\n]+/g, '')
        .trim()
        .toLowerCase(),
      territory_number: Number.parseInt(record.territory_number, 10),
      territory_name: record.territory_name.trim(),
      postcode_count: Number.parseInt(record.postcode_count, 10),
      postcodes: record.postcodes
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0),
      dfa_pg_url: record.dfa_pg_url.trim(),
    });
  }
  return rows;
}

function tokeniseCsv(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(current);
      current = '';
      if (row.length > 1 || row[0].length > 0) records.push(row);
      row = [];
      continue;
    }
    current += ch;
  }
  if (current.length > 0 || row.length > 0) {
    row.push(current);
    if (row.length > 1 || row[0].length > 0) records.push(row);
  }
  return records;
}

function formatBusinessName(areaNames: string[]): string {
  const cleaned = areaNames.map((n) => n.trim()).filter((n) => n.length > 0);
  if (cleaned.length === 0) return '';
  if (cleaned.length === 1) return `Daisy First Aid ${cleaned[0]}`;
  if (cleaned.length === 2) return `Daisy First Aid ${cleaned[0]} & ${cleaned[1]}`;
  const head = cleaned.slice(0, -1).join(', ');
  const tail = cleaned[cleaned.length - 1];
  return `Daisy First Aid ${head} & ${tail}`;
}

async function main(): Promise<void> {
  const csvText = readFileSync(CSV_PATH, 'utf8');
  const rows = parseCsv(csvText);
  console.log(`Parsed ${rows.length} rows from ${CSV_PATH}`);

  // ---------------------------------------------------------------------
  // 1. Upsert da_territory_areas. Each row in the CSV is one (franchisee,
  //    area) pair; we collapse to one row per `territory_number`.
  // ---------------------------------------------------------------------
  const areasByNumber = new Map<
    number,
    { number: number; name: string; franchisee_id: string; dfa_pg_url: string | null }
  >();
  for (const row of rows) {
    if (!Number.isInteger(row.territory_number)) {
      console.warn(`Skipping row with invalid territory_number: ${JSON.stringify(row)}`);
      continue;
    }
    if (!row.franchisee_uuid) {
      console.warn(`Skipping row with missing franchisee_uuid (area ${row.territory_number})`);
      continue;
    }
    areasByNumber.set(row.territory_number, {
      number: row.territory_number,
      name: row.territory_name,
      franchisee_id: row.franchisee_uuid,
      dfa_pg_url: row.dfa_pg_url || null,
    });
  }

  const areaPayload = Array.from(areasByNumber.values()).map((a) => ({
    number: a.number,
    name: a.name,
    franchisee_id: a.franchisee_id,
    dfa_pg_url: a.dfa_pg_url,
    status: 'active' as const,
    updated_at: new Date().toISOString(),
  }));

  const upsertAreas = await admin
    .from('da_territory_areas')
    .upsert(areaPayload, { onConflict: 'number' })
    .select('id, number');

  if (upsertAreas.error) {
    console.error('Failed to upsert da_territory_areas:', upsertAreas.error);
    process.exit(1);
  }

  const areaIdByNumber = new Map<number, string>();
  for (const a of upsertAreas.data ?? []) {
    areaIdByNumber.set(a.number as number, a.id as string);
  }
  console.log(`Upserted ${areaIdByNumber.size} areas`);

  // ---------------------------------------------------------------------
  // 2. Link da_territories.postcode_prefix -> territory_area_id.
  //    Group by area to minimise round trips: one UPDATE per area, using
  //    `in` over the postcode list.
  // ---------------------------------------------------------------------
  const postcodesByArea = new Map<number, Set<string>>();
  for (const row of rows) {
    if (!areaIdByNumber.has(row.territory_number)) continue;
    let bucket = postcodesByArea.get(row.territory_number);
    if (!bucket) {
      bucket = new Set<string>();
      postcodesByArea.set(row.territory_number, bucket);
    }
    for (const p of row.postcodes) bucket.add(p);
  }

  let linkedPostcodes = 0;
  for (const [areaNumber, postcodes] of postcodesByArea) {
    const areaId = areaIdByNumber.get(areaNumber);
    if (!areaId) continue;
    if (postcodes.size === 0) continue;

    const update = await admin
      .from('da_territories')
      .update({ territory_area_id: areaId })
      .in('postcode_prefix', Array.from(postcodes))
      .select('id');

    if (update.error) {
      console.error(`Failed to link postcodes for area ${areaNumber}:`, update.error);
      continue;
    }
    linkedPostcodes += update.data?.length ?? 0;
  }
  console.log(`Linked ${linkedPostcodes} postcodes`);

  // ---------------------------------------------------------------------
  // 3. Backfill da_franchisees.business_name.
  // ---------------------------------------------------------------------
  const areaNamesByFranchisee = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.franchisee_uuid) continue;
    let names = areaNamesByFranchisee.get(row.franchisee_uuid);
    if (!names) {
      names = [];
      areaNamesByFranchisee.set(row.franchisee_uuid, names);
    }
    if (!names.includes(row.territory_name)) {
      names.push(row.territory_name);
    }
  }

  let backfilled = 0;
  for (const [franchiseeId, names] of areaNamesByFranchisee) {
    const businessName = formatBusinessName(names);
    if (!businessName) continue;
    const update = await admin
      .from('da_franchisees')
      .update({
        business_name: businessName,
        updated_at: new Date().toISOString(),
      })
      .eq('id', franchiseeId)
      .select('id');

    if (update.error) {
      console.error(`Failed to backfill business_name for ${franchiseeId}:`, update.error);
      continue;
    }
    if ((update.data?.length ?? 0) > 0) {
      backfilled += 1;
    } else {
      console.warn(
        `Franchisee ${franchiseeId} not found in da_franchisees - skipped business_name backfill`,
      );
    }
  }
  console.log(`Backfilled ${backfilled} business names`);
}

main().catch((err) => {
  console.error('seed-territory-areas failed:', err);
  process.exit(1);
});
