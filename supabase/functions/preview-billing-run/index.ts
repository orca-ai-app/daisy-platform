// supabase/functions/preview-billing-run/index.ts
//
// POST { id: null, fields: { franchisee_id?: string|null, billing_period_start: string, billing_period_end: string } }
//   -> single FranchiseePreview if franchisee_id is set,
//   -> array of FranchiseePreview if franchisee_id is null/omitted (all active franchisees).
//
// Reference:
//   - docs/PRD-technical.md §4.13 (da_billing_runs + territory_breakdown shape)
//   - docs/PRD-technical.md §7 (fee calculation engine — authoritative source)
//   - docs/M1-build-plan.md §6 Wave 4 Agent 4C
//
// Behaviour:
//   - Requires Authorization: Bearer <jwt>. The JWT's `sub` claim is matched
//     against da_franchisees.auth_user_id; only rows with `is_hq = TRUE` may
//     proceed. Non-HQ users get 403.
//   - This is a *preview* — the function does NOT insert a da_billing_runs row.
//     Insertion happens in Phase 2 when run-billing executes for real.
//   - For each target franchisee: load their territories, sum bookings revenue
//     per territory across the period, apply MAX(base_fee, 10% of revenue), and
//     return the structured breakdown.
//   - Pro-rata: if franchisee.created_at falls within the period, scale the
//     base_fee by (days_active / days_in_period) per PRD §7.3 — and stamp the
//     row's logic with a `_pro_rata` suffix so the export shows it.
//   - Returns 401 for missing/invalid auth, 403 for non-HQ, 400 for bad input,
//     200 with the calculated structure on success.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestFields {
  franchisee_id?: string | null;
  billing_period_start?: string;
  billing_period_end?: string;
}

interface RequestBody {
  id?: string | null;
  fields?: RequestFields;
}

interface TerritoryBreakdownRow {
  territory_id: string;
  postcode_prefix: string;
  territory_name: string;
  base_fee_pence: number;
  revenue_pence: number;
  percentage_fee_pence: number;
  fee_charged_pence: number;
  logic:
    | 'base_fee_wins'
    | 'percentage_wins'
    | 'base_fee_wins_pro_rata'
    | 'percentage_wins_pro_rata';
}

interface FranchiseePreview {
  franchisee_id: string;
  franchisee_number: string;
  franchisee_name: string;
  fee_tier: number;
  billing_period_start: string;
  billing_period_end: string;
  territory_breakdown: TerritoryBreakdownRow[];
  total_base_fees_pence: number;
  total_percentage_fees_pence: number;
  total_due_pence: number;
  pro_rata_applied: boolean;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function decodeJwtSub(jwt: string): string | null {
  // Verification handled by the Supabase gateway (verify_jwt is on by default).
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = atob(padded);
    const claims = JSON.parse(decoded);
    return typeof claims.sub === 'string' ? claims.sub : null;
  } catch {
    return null;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function daysBetween(startIso: string, endIso: string): number {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  // Inclusive day count, matching PRD §7.3 pro-rata intuition.
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

interface Franchisee {
  id: string;
  number: string;
  name: string;
  fee_tier: number;
  status: string;
  created_at: string;
}

interface Territory {
  id: string;
  franchisee_id: string | null;
  postcode_prefix: string;
  name: string;
}

interface BookingRow {
  total_price_pence: number;
  payment_status: string;
  booking_status: string;
  course_instance: {
    territory_id: string | null;
    event_date: string;
  } | null;
}

async function calculateFranchiseePreview(
  admin: ReturnType<typeof createClient>,
  franchisee: Franchisee,
  periodStart: string,
  periodEnd: string,
): Promise<FranchiseePreview> {
  const territoriesRes = await admin
    .from('da_territories')
    .select('id, franchisee_id, postcode_prefix, name')
    .eq('franchisee_id', franchisee.id)
    .order('postcode_prefix', { ascending: true });

  if (territoriesRes.error) {
    throw new Error(`Failed to load territories: ${territoriesRes.error.message}`);
  }

  const territories = (territoriesRes.data ?? []) as Territory[];

  // Pro-rata: if the franchisee was created mid-period, scale the base fee
  // by (days_active_in_period / days_in_period). PRD §7.3.
  const periodDays = daysBetween(periodStart, periodEnd);
  const createdAt = new Date(franchisee.created_at);
  const periodStartTs = Date.parse(`${periodStart}T00:00:00Z`);
  const periodEndTs = Date.parse(`${periodEnd}T23:59:59Z`);
  let activeDays = periodDays;
  let proRataApplied = false;
  if (createdAt.getTime() > periodStartTs && createdAt.getTime() <= periodEndTs) {
    proRataApplied = true;
    const activeFromTs = createdAt.getTime();
    activeDays = Math.max(1, Math.ceil((periodEndTs - activeFromTs) / 86_400_000));
  }

  const baseFeePoundsPerTerritory = franchisee.fee_tier; // integer pounds
  const baseFeePenceFull = baseFeePoundsPerTerritory * 100;
  const baseFeePencePerTerritory = proRataApplied
    ? Math.floor((baseFeePenceFull * activeDays) / periodDays)
    : baseFeePenceFull;

  const breakdown: TerritoryBreakdownRow[] = [];
  let totalBase = 0;
  let totalPercentage = 0;
  let totalDue = 0;

  if (territories.length === 0) {
    // No territories — nothing to bill. Return an empty breakdown so the
    // caller can render a 'no territories' state.
    return {
      franchisee_id: franchisee.id,
      franchisee_number: franchisee.number,
      franchisee_name: franchisee.name,
      fee_tier: franchisee.fee_tier,
      billing_period_start: periodStart,
      billing_period_end: periodEnd,
      territory_breakdown: [],
      total_base_fees_pence: 0,
      total_percentage_fees_pence: 0,
      total_due_pence: 0,
      pro_rata_applied: proRataApplied,
    };
  }

  for (const territory of territories) {
    // Pull bookings linked to course_instances scheduled in this territory
    // within the period. Filter to PRD §7.1 revenue rules.
    const bookingsRes = await admin
      .from('da_bookings')
      .select(
        `total_price_pence, payment_status, booking_status,
         course_instance:da_course_instances!inner ( territory_id, event_date )`,
      )
      .in('payment_status', ['paid', 'manual'])
      .neq('booking_status', 'cancelled')
      .eq('da_course_instances.territory_id', territory.id)
      .gte('da_course_instances.event_date', periodStart)
      .lte('da_course_instances.event_date', periodEnd);

    if (bookingsRes.error) {
      throw new Error(`Failed to load bookings: ${bookingsRes.error.message}`);
    }

    const rows = (bookingsRes.data ?? []) as unknown as BookingRow[];
    // PostgREST `!inner` join still returns rows where the join match is non-null,
    // but we double-check territory_id here in case schema oddities slip through.
    const revenuePence = rows.reduce((acc, row) => {
      if (!row.course_instance) return acc;
      if (row.course_instance.territory_id !== territory.id) return acc;
      return acc + (row.total_price_pence ?? 0);
    }, 0);

    const percentageFeePence = Math.floor(revenuePence * 0.1);
    const baseWins = baseFeePencePerTerritory >= percentageFeePence;
    const feeCharged = baseWins ? baseFeePencePerTerritory : percentageFeePence;

    let logicTag: TerritoryBreakdownRow['logic'];
    if (baseWins) {
      logicTag = proRataApplied ? 'base_fee_wins_pro_rata' : 'base_fee_wins';
    } else {
      logicTag = proRataApplied ? 'percentage_wins_pro_rata' : 'percentage_wins';
    }

    breakdown.push({
      territory_id: territory.id,
      postcode_prefix: territory.postcode_prefix,
      territory_name: territory.name,
      base_fee_pence: baseFeePencePerTerritory,
      revenue_pence: revenuePence,
      percentage_fee_pence: percentageFeePence,
      fee_charged_pence: feeCharged,
      logic: logicTag,
    });

    totalBase += baseFeePencePerTerritory;
    totalPercentage += percentageFeePence;
    totalDue += feeCharged;
  }

  return {
    franchisee_id: franchisee.id,
    franchisee_number: franchisee.number,
    franchisee_name: franchisee.name,
    fee_tier: franchisee.fee_tier,
    billing_period_start: periodStart,
    billing_period_end: periodEnd,
    territory_breakdown: breakdown,
    total_base_fees_pence: totalBase,
    total_percentage_fees_pence: totalPercentage,
    total_due_pence: totalDue,
    pro_rata_applied: proRataApplied,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return jsonResponse({ error: 'Authorization header required' }, 401);
  }
  const jwt = authHeader.slice('bearer '.length).trim();
  const authUserId = decodeJwtSub(jwt);
  if (!authUserId) {
    return jsonResponse({ error: 'Invalid JWT' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ---------------------------------------------------------------------
  // HQ check
  // ---------------------------------------------------------------------
  const actor = await admin
    .from('da_franchisees')
    .select('id, is_hq, name')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (actor.error) {
    console.error('franchisee lookup failed', actor.error);
    return jsonResponse({ error: 'Failed to verify caller' }, 500);
  }
  if (!actor.data) {
    return jsonResponse({ error: 'Caller is not provisioned' }, 403);
  }
  if (!actor.data.is_hq) {
    return jsonResponse({ error: 'HQ access required' }, 403);
  }

  // ---------------------------------------------------------------------
  // Parse + validate body
  // ---------------------------------------------------------------------
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const fields = body.fields ?? {};
  const periodStart = fields.billing_period_start;
  const periodEnd = fields.billing_period_end;

  if (!periodStart || typeof periodStart !== 'string' || !isIsoDate(periodStart)) {
    return jsonResponse({ error: 'billing_period_start is required (YYYY-MM-DD)' }, 400);
  }
  if (!periodEnd || typeof periodEnd !== 'string' || !isIsoDate(periodEnd)) {
    return jsonResponse({ error: 'billing_period_end is required (YYYY-MM-DD)' }, 400);
  }

  const startTs = Date.parse(`${periodStart}T00:00:00Z`);
  const endTs = Date.parse(`${periodEnd}T00:00:00Z`);
  if (startTs > endTs) {
    return jsonResponse(
      { error: 'billing_period_start must be on or before billing_period_end' },
      400,
    );
  }

  const now = Date.now();
  const twoYearsMs = 2 * 365 * 86_400_000;
  if (Math.abs(startTs - now) > twoYearsMs || Math.abs(endTs - now) > twoYearsMs) {
    return jsonResponse(
      { error: 'Billing period must fall within two years of the current date' },
      400,
    );
  }

  if (fields.franchisee_id != null) {
    if (typeof fields.franchisee_id !== 'string' || !isUuid(fields.franchisee_id)) {
      return jsonResponse({ error: 'franchisee_id must be a uuid or null' }, 400);
    }
  }

  // ---------------------------------------------------------------------
  // Load target franchisees
  // ---------------------------------------------------------------------
  if (fields.franchisee_id) {
    const franchiseeRes = await admin
      .from('da_franchisees')
      .select('id, number, name, fee_tier, status, created_at')
      .eq('id', fields.franchisee_id)
      .maybeSingle();

    if (franchiseeRes.error) {
      console.error('franchisee load failed', franchiseeRes.error);
      return jsonResponse({ error: 'Failed to load franchisee' }, 500);
    }
    if (!franchiseeRes.data) {
      return jsonResponse({ error: 'Franchisee not found' }, 404);
    }

    try {
      const preview = await calculateFranchiseePreview(
        admin,
        franchiseeRes.data as Franchisee,
        periodStart,
        periodEnd,
      );
      return jsonResponse(preview, 200);
    } catch (err) {
      console.error('preview calculation failed', err);
      const message = err instanceof Error ? err.message : 'Calculation failed';
      return jsonResponse({ error: message }, 500);
    }
  }

  const allRes = await admin
    .from('da_franchisees')
    .select('id, number, name, fee_tier, status, created_at')
    .eq('status', 'active')
    .eq('is_hq', false)
    .order('number', { ascending: true });

  if (allRes.error) {
    console.error('franchisees load failed', allRes.error);
    return jsonResponse({ error: 'Failed to load franchisees' }, 500);
  }

  const previews: FranchiseePreview[] = [];
  try {
    for (const f of (allRes.data ?? []) as Franchisee[]) {
      previews.push(await calculateFranchiseePreview(admin, f, periodStart, periodEnd));
    }
  } catch (err) {
    console.error('preview calculation failed', err);
    const message = err instanceof Error ? err.message : 'Calculation failed';
    return jsonResponse({ error: message }, 500);
  }

  return jsonResponse(previews, 200);
});
