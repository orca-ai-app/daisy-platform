/**
 * HQ Reports queries — read-only network revenue aggregates.
 *
 * Revenue is gross (sum of `total_price_pence` for bookings whose
 * `payment_status` is `paid` or `manual` and whose `booking_status`
 * isn't `cancelled`). The HQ fee calculation lives in Wave 4 billing.
 *
 * Months are bucketed by `da_course_instances.event_date` (the
 * "when did this course run" date, in Europe/London), not by
 * `da_bookings.created_at`. Reasoning: the chart should show when
 * revenue was *earned* on the network, not when the order was placed.
 *
 * References: docs/PRD-technical.md §4.5, §4.9, §7.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const TABLE_MISSING_CODES = new Set(['42P01', 'PGRST205']);

function isTableMissing(code: string | null | undefined): boolean {
  return TABLE_MISSING_CODES.has(code ?? '');
}

export type RevenuePeriod = 'last-6-months' | 'this-year' | 'custom';

export interface MonthRevenuePoint {
  /** Short label for X axis, e.g. "Apr". */
  month: string;
  /** Full label for tooltip, e.g. "Apr 2026". */
  monthFull: string;
  /** ISO date of the first day of the month (UTC midnight). */
  monthStart: string;
  /** Number of qualifying bookings (paid + manual, not cancelled). */
  bookingCount: number;
  /** Revenue in pence. */
  revenuePence: number;
}

const SHORT_MONTH = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  timeZone: 'Europe/London',
});
const FULL_MONTH = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/London',
});

/**
 * Build the list of N month-buckets ending with the current month.
 * Months are anchored to UTC start-of-month.
 */
function lastNMonths(n: number): MonthRevenuePoint[] {
  const out: MonthRevenuePoint[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({
      month: SHORT_MONTH.format(start),
      monthFull: FULL_MONTH.format(start),
      monthStart: start.toISOString(),
      bookingCount: 0,
      revenuePence: 0,
    });
  }
  return out;
}

/**
 * Months for "this year" — Jan to current month inclusive.
 */
function thisYearMonths(): MonthRevenuePoint[] {
  const now = new Date();
  const months: MonthRevenuePoint[] = [];
  for (let i = 0; i <= now.getUTCMonth(); i += 1) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), i, 1));
    months.push({
      month: SHORT_MONTH.format(start),
      monthFull: FULL_MONTH.format(start),
      monthStart: start.toISOString(),
      bookingCount: 0,
      revenuePence: 0,
    });
  }
  return months;
}

interface RevenueQueryWindow {
  fromIso: string;
  /** Exclusive upper bound. */
  toIso: string;
  buckets: MonthRevenuePoint[];
}

function windowForPeriod(
  period: RevenuePeriod,
  fromDate?: string,
  toDate?: string,
): RevenueQueryWindow {
  if (period === 'this-year') {
    const buckets = thisYearMonths();
    const start = new Date(buckets[0].monthStart);
    const now = new Date();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { fromIso: start.toISOString(), toIso: end.toISOString(), buckets };
  }
  if (period === 'custom' && fromDate && toDate) {
    const start = new Date(`${fromDate}T00:00:00Z`);
    const end = new Date(`${toDate}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    // Build month buckets between start and end (inclusive of start month).
    const buckets: MonthRevenuePoint[] = [];
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    while (cursor < end) {
      buckets.push({
        month: SHORT_MONTH.format(cursor),
        monthFull: FULL_MONTH.format(cursor),
        monthStart: cursor.toISOString(),
        bookingCount: 0,
        revenuePence: 0,
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return { fromIso: start.toISOString(), toIso: end.toISOString(), buckets };
  }
  // Default: last 6 months including current.
  const buckets = lastNMonths(6);
  const start = new Date(buckets[0].monthStart);
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { fromIso: start.toISOString(), toIso: end.toISOString(), buckets };
}

/** Pick the bucket whose monthStart is the same UTC year+month as `eventDate`. */
function bucketIndexFor(buckets: MonthRevenuePoint[], eventDate: string): number {
  // event_date arrives as YYYY-MM-DD; treat it as UTC for bucketing.
  const d = new Date(`${eventDate}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return buckets.findIndex((b) => {
    const bd = new Date(b.monthStart);
    return bd.getUTCFullYear() === y && bd.getUTCMonth() === m;
  });
}

interface QualifyingBooking {
  total_price_pence: number;
  franchisee_id: string;
  course_instance: { event_date: string | null } | null;
  franchisee: { id: string; number: string; name: string } | null;
}

/**
 * Fetch all qualifying bookings for a window — the list-of-rows path.
 * We keep this client-side because Postgrest can't aggregate across a
 * join. With an HQ-scoped RLS policy and the tight `payment_status`
 * filter the row volume stays small (hundreds, not millions) for M1.
 */
async function fetchQualifyingBookings(window: RevenueQueryWindow): Promise<QualifyingBooking[]> {
  const { data, error } = await supabase
    .from('da_bookings')
    .select(
      `total_price_pence,
       franchisee_id,
       course_instance:da_course_instances ( event_date ),
       franchisee:da_franchisees ( id, number, name )`,
    )
    .in('payment_status', ['paid', 'manual'])
    .neq('booking_status', 'cancelled');

  if (error) {
    if (isTableMissing(error.code)) return [];
    throw error;
  }

  // Filter by event_date inside the window (we can't filter on a joined
  // column at the database level via Postgrest, so we filter client-side).
  const fromMs = new Date(window.fromIso).getTime();
  const toMs = new Date(window.toIso).getTime();

  return ((data ?? []) as unknown as QualifyingBooking[]).filter((row) => {
    const ev = row.course_instance?.event_date;
    if (!ev) return false;
    const evMs = new Date(`${ev}T00:00:00Z`).getTime();
    return evMs >= fromMs && evMs < toMs;
  });
}

export interface NetworkRevenueResult {
  buckets: MonthRevenuePoint[];
  totalPence: number;
  totalBookings: number;
}

export function useNetworkRevenueByMonth(
  period: RevenuePeriod = 'last-6-months',
  fromDate?: string,
  toDate?: string,
) {
  return useQuery<NetworkRevenueResult>({
    queryKey: ['hq', 'reports', 'network-revenue', { period, fromDate, toDate }],
    queryFn: async () => {
      const window = windowForPeriod(period, fromDate, toDate);
      const rows = await fetchQualifyingBookings(window);

      const buckets = window.buckets.map((b) => ({ ...b }));
      let totalPence = 0;
      let totalBookings = 0;

      for (const row of rows) {
        const ev = row.course_instance?.event_date;
        if (!ev) continue;
        const idx = bucketIndexFor(buckets, ev);
        if (idx === -1) continue;
        buckets[idx].revenuePence += row.total_price_pence;
        buckets[idx].bookingCount += 1;
        totalPence += row.total_price_pence;
        totalBookings += 1;
      }

      return { buckets, totalPence, totalBookings };
    },
  });
}

export interface FranchiseeRevenueRow {
  franchisee_id: string;
  number: string;
  name: string;
  bookingCount: number;
  revenuePence: number;
  /** 0–100, share of the network total. */
  pctOfNetwork: number;
}

export interface FranchiseeRevenueResult {
  rows: FranchiseeRevenueRow[];
  totalPence: number;
}

export function usePerFranchiseeRevenue(
  period: RevenuePeriod = 'last-6-months',
  fromDate?: string,
  toDate?: string,
) {
  return useQuery<FranchiseeRevenueResult>({
    queryKey: ['hq', 'reports', 'franchisee-revenue', { period, fromDate, toDate }],
    queryFn: async () => {
      const window = windowForPeriod(period, fromDate, toDate);
      const rows = await fetchQualifyingBookings(window);

      const byFranchisee = new Map<string, FranchiseeRevenueRow>();
      let totalPence = 0;

      for (const row of rows) {
        const fid = row.franchisee?.id ?? row.franchisee_id;
        if (!fid) continue;
        const existing = byFranchisee.get(fid);
        if (existing) {
          existing.revenuePence += row.total_price_pence;
          existing.bookingCount += 1;
        } else {
          byFranchisee.set(fid, {
            franchisee_id: fid,
            number: row.franchisee?.number ?? '',
            name: row.franchisee?.name ?? '',
            bookingCount: 1,
            revenuePence: row.total_price_pence,
            pctOfNetwork: 0,
          });
        }
        totalPence += row.total_price_pence;
      }

      const result = Array.from(byFranchisee.values()).map((r) => ({
        ...r,
        pctOfNetwork: totalPence > 0 ? Math.round((r.revenuePence / totalPence) * 100) : 0,
      }));
      result.sort((a, b) => b.revenuePence - a.revenuePence);

      return { rows: result, totalPence };
    },
  });
}
