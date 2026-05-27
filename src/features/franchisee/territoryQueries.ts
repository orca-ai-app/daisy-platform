/**
 * Territory queries for the franchisee portal (/franchisee/territories).
 *
 * useOwnTerritories()
 * -------------------
 * Fetches every territory the signed-in franchisee owns. RLS on da_territories
 * (policy "franchisee_own": `franchisee_id = get_current_franchisee_id()`)
 * scopes the result automatically — no client-side franchisee_id filter is
 * applied here.
 *
 * This-month course count + revenue are computed client-side:
 *
 * 1. Fetch own territories (RLS-scoped; small set — typically 1-5 rows).
 * 2. Fetch da_course_instances for this calendar month, scoped by the
 *    franchisee's territory IDs, joined to da_bookings for total_price_pence.
 *    PostgREST's nested embed returns bookings inline, so we sum them without
 *    a second round-trip.
 * 3. Group the aggregate by territory_id in JavaScript and merge back onto
 *    the territory rows.
 *
 * "This month" means the local UK calendar month:
 *   start = midnight on the 1st of the current month in Europe/London
 *   end   = start + 1 month (exclusive)
 * These boundaries are converted to UTC ISO strings before the query so the
 * comparison works correctly against the TIMESTAMPTZ `created_at` column.
 *
 * Only non-cancelled bookings with payment_status 'paid' | 'manual' contribute
 * to revenue, matching the same revenue definition used in the HQ billing page.
 *
 * Reference: docs/M2-build-plan.md §Wave 6C; frozen contract in queryKeys.ts.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { franchiseeKeys } from './queryKeys';
import type { Territory, TerritoryStatus } from '@/types/franchisee';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

export interface OwnTerritoryRow extends Territory {
  /** Number of course instances (any status except cancelled) scheduled this
   *  calendar month for this territory. */
  courses_this_month: number;
  /** Sum of total_price_pence for paid/manual bookings on course instances in
   *  this territory this calendar month. Integer pence. */
  revenue_this_month_pence: number;
}

// ---------------------------------------------------------------------------
// Month boundary helpers
// ---------------------------------------------------------------------------

/**
 * Return ISO-8601 strings for the first millisecond of this calendar month
 * and the first millisecond of next month, in Europe/London time.
 *
 * We use Intl.DateTimeFormat parts to resolve the UK wall-clock year/month
 * before constructing the UTC boundary timestamps.
 */
function thisMonthBoundsUTC(): { from: string; to: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const year = parseInt(get('year'), 10);
  const month = parseInt(get('month'), 10); // 1-12

  // Start of this month in London = midnight on the 1st.
  // Date.UTC gives us that instant in UTC.
  const fromMs = Date.UTC(year, month - 1, 1, 0, 0, 0, 0);

  // Europe/London is UTC+0 in winter, UTC+1 in summer. Constructing midnight
  // via Date.UTC(year, month - 1, 1) gives UTC midnight, which is either
  // 00:00 or 01:00 London time. That one-hour drift only matters for bookings
  // placed in the very first hour of the 1st — an edge case accepted as
  // negligible for a monthly summary.
  const toMs = Date.UTC(year, month, 1, 0, 0, 0, 0); // first ms of next month

  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Internal DB shapes
// ---------------------------------------------------------------------------

interface RawBooking {
  id: string;
  total_price_pence: number;
  payment_status: string;
  booking_status: string;
}

interface RawCourseInstance {
  id: string;
  territory_id: string | null;
  status: string;
  bookings: RawBooking[];
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

const PAID_STATUSES = new Set(['paid', 'manual']);

async function fetchOwnTerritories(): Promise<OwnTerritoryRow[]> {
  // Step 1 — territories (RLS-scoped).
  const { data: territoryData, error: territoryError } = await supabase
    .from('da_territories')
    .select('id, franchisee_id, postcode_prefix, name, status, lat, lng, created_at, updated_at')
    .order('postcode_prefix', { ascending: true });

  if (territoryError) {
    throw new Error(`useOwnTerritories (territories): ${territoryError.message}`);
  }

  const territories = (territoryData ?? []) as Territory[];

  if (territories.length === 0) {
    return [];
  }

  const territoryIds = territories.map((t) => t.id);
  const { from, to } = thisMonthBoundsUTC();

  // Step 2 — course instances for this month in these territories, with
  // bookings nested inline. RLS on da_course_instances and da_bookings both
  // scope to the current franchisee, so no explicit filter is needed on
  // franchisee_id — only the territory_id and date range are applied.
  const { data: instanceData, error: instanceError } = await supabase
    .from('da_course_instances')
    .select(
      `id,
       territory_id,
       status,
       bookings:da_bookings ( id, total_price_pence, payment_status, booking_status )`,
    )
    .in('territory_id', territoryIds)
    .neq('status', 'cancelled')
    .gte('created_at', from)
    .lt('created_at', to);

  if (instanceError) {
    throw new Error(`useOwnTerritories (instances): ${instanceError.message}`);
  }

  const instances = (instanceData ?? []) as unknown as RawCourseInstance[];

  // Step 3 — aggregate by territory_id.
  const courseCounts = new Map<string, number>();
  const revenueMap = new Map<string, number>();

  for (const instance of instances) {
    const tid = instance.territory_id;
    if (!tid) continue;

    courseCounts.set(tid, (courseCounts.get(tid) ?? 0) + 1);

    const instanceRevenue = instance.bookings.reduce((sum, b) => {
      if (b.booking_status !== 'cancelled' && PAID_STATUSES.has(b.payment_status)) {
        return sum + b.total_price_pence;
      }
      return sum;
    }, 0);

    revenueMap.set(tid, (revenueMap.get(tid) ?? 0) + instanceRevenue);
  }

  // Step 4 — merge aggregates back onto territory rows.
  return territories.map((t) => ({
    ...t,
    status: t.status as TerritoryStatus,
    courses_this_month: courseCounts.get(t.id) ?? 0,
    revenue_this_month_pence: revenueMap.get(t.id) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Public hook
// ---------------------------------------------------------------------------

export function useOwnTerritories(): UseQueryResult<OwnTerritoryRow[], Error> {
  return useQuery({
    queryKey: franchiseeKeys.territories(),
    queryFn: fetchOwnTerritories,
  });
}
