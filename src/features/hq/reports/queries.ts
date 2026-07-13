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

export type RevenuePeriod = 'last-6-months' | 'last-12-months' | 'this-year' | 'custom';

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
  /** Previous-year same-month full label, e.g. "Apr 2025". Present only when compare=true. */
  monthFullPrev?: string;
  /** Previous-year revenue in pence. Present only when compare=true. */
  revenuePencePrev?: number;
  /** Previous-year booking count. Present only when compare=true. */
  bookingCountPrev?: number;
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
  if (period === 'last-12-months') {
    const buckets = lastNMonths(12);
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

/**
 * Shift a window back by one year for YoY comparison.
 * Bucket monthStart dates and labels both shift to the prior-year same-month.
 */
function previousYearWindow(w: RevenueQueryWindow): RevenueQueryWindow {
  const from = new Date(w.fromIso);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  const to = new Date(w.toIso);
  to.setUTCFullYear(to.getUTCFullYear() - 1);
  const buckets = w.buckets.map((b) => {
    const d = new Date(b.monthStart);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return {
      month: SHORT_MONTH.format(d),
      monthFull: FULL_MONTH.format(d),
      monthStart: d.toISOString(),
      bookingCount: 0,
      revenuePence: 0,
    };
  });
  return { fromIso: from.toISOString(), toIso: to.toISOString(), buckets };
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
  /** YoY total revenue change (current - previous) in pence; only present when compare=true. */
  deltaPence?: number;
  /** YoY total revenue change as a percentage; only present when compare=true. */
  deltaPct?: number;
  /** Previous-period totals; only present when compare=true. */
  previousTotalPence?: number;
  previousTotalBookings?: number;
}

export function useNetworkRevenueByMonth(
  period: RevenuePeriod = 'last-6-months',
  fromDate?: string,
  toDate?: string,
  compare = false,
) {
  return useQuery<NetworkRevenueResult>({
    queryKey: ['hq', 'reports', 'network-revenue', { period, fromDate, toDate, compare }],
    queryFn: async () => {
      const currentWindow = windowForPeriod(period, fromDate, toDate);
      const prevWindow = compare ? previousYearWindow(currentWindow) : null;

      // Single fetch of all qualifying bookings — already client-side filtered
      // by event_date inside fetchQualifyingBookings against the current
      // window. For compare mode we widen the window to span both periods.
      const fetchWindow: RevenueQueryWindow = prevWindow
        ? {
            fromIso: prevWindow.fromIso,
            toIso: currentWindow.toIso,
            buckets: [],
          }
        : currentWindow;

      const rows = await fetchQualifyingBookings(fetchWindow);

      const buckets = currentWindow.buckets.map((b, idx) => ({
        ...b,
        ...(prevWindow
          ? {
              monthFullPrev: prevWindow.buckets[idx].monthFull,
              revenuePencePrev: 0,
              bookingCountPrev: 0,
            }
          : {}),
      }));

      let totalPence = 0;
      let totalBookings = 0;
      let previousTotalPence = 0;
      let previousTotalBookings = 0;

      for (const row of rows) {
        const ev = row.course_instance?.event_date;
        if (!ev) continue;
        const d = new Date(`${ev}T00:00:00Z`);
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth();

        // Try the current-period buckets first
        const curIdx = buckets.findIndex((b) => {
          const bd = new Date(b.monthStart);
          return bd.getUTCFullYear() === y && bd.getUTCMonth() === m;
        });
        if (curIdx !== -1) {
          buckets[curIdx].revenuePence += row.total_price_pence;
          buckets[curIdx].bookingCount += 1;
          totalPence += row.total_price_pence;
          totalBookings += 1;
          continue;
        }

        // Otherwise try the previous-period buckets (compare mode only)
        if (prevWindow) {
          const prevIdx = prevWindow.buckets.findIndex((b) => {
            const bd = new Date(b.monthStart);
            return bd.getUTCFullYear() === y && bd.getUTCMonth() === m;
          });
          if (prevIdx !== -1) {
            buckets[prevIdx].revenuePencePrev =
              (buckets[prevIdx].revenuePencePrev ?? 0) + row.total_price_pence;
            buckets[prevIdx].bookingCountPrev = (buckets[prevIdx].bookingCountPrev ?? 0) + 1;
            previousTotalPence += row.total_price_pence;
            previousTotalBookings += 1;
          }
        }
      }

      if (!compare) {
        return { buckets, totalPence, totalBookings };
      }

      const deltaPence = totalPence - previousTotalPence;
      const deltaPct =
        previousTotalPence > 0 ? Math.round((deltaPence / previousTotalPence) * 100) : 0;

      return {
        buckets,
        totalPence,
        totalBookings,
        deltaPence,
        deltaPct,
        previousTotalPence,
        previousTotalBookings,
      };
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

// ---------------------------------------------------------------------------
// Merchandise sales (da_product_sales)
// ---------------------------------------------------------------------------

export interface FranchiseeMerchandiseRow {
  franchisee_id: string;
  number: string;
  name: string;
  /** Total quantity of items sold in the period. */
  units: number;
  /** Revenue in pence. */
  revenuePence: number;
}

export interface MerchandiseSalesResult {
  rows: FranchiseeMerchandiseRow[];
  totalUnits: number;
  totalPence: number;
}

interface MerchandiseSaleJoined {
  quantity: number;
  total_pence: number;
  franchisee_id: string;
  franchisee: { id: string; number: string; name: string } | null;
}

/**
 * Network merchandise sales for a period: total units + revenue, and a
 * per-franchisee breakdown sorted by revenue (desc). `sold_at` is a DATE
 * column on da_product_sales itself, so the window filter runs server-side
 * (unlike bookings, which filter on a joined event_date client-side).
 */
export function useMerchandiseSales(
  period: RevenuePeriod = 'last-6-months',
  fromDate?: string,
  toDate?: string,
) {
  return useQuery<MerchandiseSalesResult>({
    queryKey: ['hq', 'reports', 'merchandise-sales', { period, fromDate, toDate }],
    queryFn: async () => {
      const window = windowForPeriod(period, fromDate, toDate);

      const { data, error } = await supabase
        .from('da_product_sales')
        .select(
          `quantity,
           total_pence,
           franchisee_id,
           franchisee:da_franchisees ( id, number, name )`,
        )
        .gte('sold_at', window.fromIso.slice(0, 10))
        .lt('sold_at', window.toIso.slice(0, 10));

      if (error) {
        if (isTableMissing(error.code)) {
          return { rows: [], totalUnits: 0, totalPence: 0 };
        }
        throw error;
      }

      const byFranchisee = new Map<string, FranchiseeMerchandiseRow>();
      let totalUnits = 0;
      let totalPence = 0;

      for (const row of (data ?? []) as unknown as MerchandiseSaleJoined[]) {
        const fid = row.franchisee?.id ?? row.franchisee_id;
        if (!fid) continue;
        const existing = byFranchisee.get(fid);
        if (existing) {
          existing.units += row.quantity;
          existing.revenuePence += row.total_pence;
        } else {
          byFranchisee.set(fid, {
            franchisee_id: fid,
            number: row.franchisee?.number ?? '',
            name: row.franchisee?.name ?? '',
            units: row.quantity,
            revenuePence: row.total_pence,
          });
        }
        totalUnits += row.quantity;
        totalPence += row.total_pence;
      }

      const rows = Array.from(byFranchisee.values());
      rows.sort((a, b) => b.revenuePence - a.revenuePence);

      return { rows, totalUnits, totalPence };
    },
  });
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
