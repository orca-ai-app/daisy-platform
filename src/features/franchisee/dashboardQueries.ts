/**
 * TanStack Query hooks for the franchisee portal dashboard (Wave 6B).
 *
 * RLS rules: the anon client is already scoped to the signed-in franchisee —
 * we MUST NOT add .eq('franchisee_id', …) filters. RLS does that.
 *
 * Money: integer pence. Dates: Intl.DateTimeFormat / date-fns in components;
 * raw ISO strings stay raw in this layer.
 *
 * Key factory: franchiseeKeys from ./queryKeys (frozen contract).
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { franchiseeKeys } from './queryKeys';

const STALE_TIME = 5 * 60_000;

/** Postgrest error codes that indicate a table doesn't exist yet. */
const TABLE_MISSING_CODES = new Set(['42P01', 'PGRST205']);

function isTableMissing(code: string | null | undefined): boolean {
  return TABLE_MISSING_CODES.has(code ?? '');
}

// ---------------------------------------------------------------------------
// Date helpers — UTC boundaries to avoid local-timezone drift in query ranges.
// ---------------------------------------------------------------------------

interface DateRange {
  startIso: string;
  endIso: string;
}

/** ISO date range for the current calendar month (UTC). */
function currentMonthRange(): DateRange {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** ISO date range for the next N days starting from now. */
function nextDaysRange(days: number): DateRange {
  const now = new Date();
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return { startIso: now.toISOString(), endIso: future.toISOString() };
}

// ---------------------------------------------------------------------------
// Dashboard stats aggregate
// ---------------------------------------------------------------------------

export interface FranchiseeDashboardStats {
  /** Count of scheduled course instances in the next 30 days. */
  upcomingCourses: number;
  /** Count of bookings created in the current calendar month (MTD). */
  bookingsMtd: number;
  /** Total revenue for bookings created MTD, in pence. */
  revenueMtd: number;
  /** Sum of spots_remaining on scheduled course instances in the next 30 days. */
  outstandingCapacity: number;
}

async function fetchDashboardStats(): Promise<FranchiseeDashboardStats> {
  const mtd = currentMonthRange();
  const next30 = nextDaysRange(30);

  // RLS restricts all four queries to rows belonging to the signed-in franchisee.
  const [bookingsRes, coursesRes] = await Promise.all([
    // Bookings MTD — no franchisee_id filter; RLS handles scoping.
    supabase
      .from('da_bookings')
      .select('total_price_pence')
      .gte('created_at', mtd.startIso)
      .lt('created_at', mtd.endIso),

    // Scheduled course instances in the next 30 days.
    supabase
      .from('da_course_instances')
      .select('spots_remaining')
      .eq('status', 'scheduled')
      .gte('event_date', next30.startIso)
      .lt('event_date', next30.endIso),
  ]);

  if (bookingsRes.error && !isTableMissing(bookingsRes.error.code)) {
    throw bookingsRes.error;
  }
  if (coursesRes.error && !isTableMissing(coursesRes.error.code)) {
    throw coursesRes.error;
  }

  const bookings = bookingsRes.data ?? [];
  const courses = coursesRes.data ?? [];

  const bookingsMtd = bookings.length;
  const revenueMtd = bookings.reduce((acc, row) => acc + (row.total_price_pence ?? 0), 0);
  const upcomingCourses = courses.length;
  const outstandingCapacity = courses.reduce((acc, row) => acc + (row.spots_remaining ?? 0), 0);

  return { upcomingCourses, bookingsMtd, revenueMtd, outstandingCapacity };
}

export function useFranchiseeDashboard() {
  return useQuery<FranchiseeDashboardStats>({
    queryKey: franchiseeKeys.dashboardStats(),
    staleTime: STALE_TIME,
    retry: 1,
    queryFn: fetchDashboardStats,
  });
}

// ---------------------------------------------------------------------------
// Recent bookings (last 5 for the signed-in franchisee)
// ---------------------------------------------------------------------------

export interface RecentBookingRow {
  id: string;
  booking_reference: string;
  total_price_pence: number;
  booking_status: string;
  payment_status: string;
  created_at: string;
  customer_name: string;
  course_template_name: string | null;
  event_date: string | null;
}

type RecentBookingJoined = {
  id: string;
  booking_reference: string;
  total_price_pence: number;
  booking_status: string;
  payment_status: string;
  created_at: string;
  customer: { first_name: string; last_name: string } | null;
  course_instance: {
    event_date: string | null;
    template: { name: string } | null;
  } | null;
};

export function useRecentBookings(limit = 5) {
  return useQuery<RecentBookingRow[]>({
    queryKey: [...franchiseeKeys.bookings(), 'recent', limit] as const,
    staleTime: STALE_TIME,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_bookings')
        .select(
          `id,
           booking_reference,
           total_price_pence,
           booking_status,
           payment_status,
           created_at,
           customer:da_customers ( first_name, last_name ),
           course_instance:da_course_instances (
             event_date,
             template:da_course_templates ( name )
           )`,
        )
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        if (isTableMissing(error.code)) return [];
        throw error;
      }

      return ((data ?? []) as unknown as RecentBookingJoined[]).map((row) => ({
        id: row.id,
        booking_reference: row.booking_reference,
        total_price_pence: row.total_price_pence,
        booking_status: row.booking_status,
        payment_status: row.payment_status,
        created_at: row.created_at,
        customer_name: row.customer
          ? `${row.customer.first_name} ${row.customer.last_name}`
          : 'Unknown',
        course_template_name: row.course_instance?.template?.name ?? null,
        event_date: row.course_instance?.event_date ?? null,
      }));
    },
  });
}

// ---------------------------------------------------------------------------
// Coming up this week — own course instances in the next 7 days
// ---------------------------------------------------------------------------

export interface UpcomingCourseRow {
  id: string;
  event_date: string;
  spots_total: number;
  spots_remaining: number;
  status: string;
  template_name: string | null;
  venue_name: string | null;
}

type UpcomingCourseJoined = {
  id: string;
  event_date: string;
  capacity: number;
  spots_remaining: number;
  status: string;
  venue_name: string | null;
  template: { name: string } | null;
};

export function useUpcomingCourses(days = 7) {
  const range = nextDaysRange(days);
  return useQuery<UpcomingCourseRow[]>({
    queryKey: [...franchiseeKeys.courses(), 'upcoming', days] as const,
    staleTime: STALE_TIME,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_course_instances')
        .select(
          `id,
           event_date,
           capacity,
           spots_remaining,
           status,
           venue_name,
           template:da_course_templates ( name )`,
        )
        .eq('status', 'scheduled')
        .gte('event_date', range.startIso)
        .lt('event_date', range.endIso)
        .order('event_date', { ascending: true });

      if (error) {
        if (isTableMissing(error.code)) return [];
        throw error;
      }

      return ((data ?? []) as unknown as UpcomingCourseJoined[]).map((row) => ({
        id: row.id,
        event_date: row.event_date,
        spots_total: row.capacity,
        spots_remaining: row.spots_remaining,
        status: row.status,
        template_name: row.template?.name ?? null,
        venue_name: row.venue_name ?? null,
      }));
    },
  });
}
