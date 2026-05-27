/**
 * franchisee/courses — list and calendar queries (Wave 7C).
 *
 * Both hooks read via the anon client + RLS. RLS enforces
 * franchisee_id = auth.uid()-derived row ownership, so there is NO
 * client-side franchisee_id filter — the database handles scoping.
 *
 * DATE NOTE:
 *   event_date is a Postgres DATE returned as 'YYYY-MM-DD'. We never
 *   pass it through `new Date(...)` because in BST (UTC+1) a midnight-UTC
 *   Date constructed from that string resolves to the previous calendar
 *   day in Europe/London. The list hook stores raw strings throughout.
 *   The calendar hook groups by the raw 'YYYY-MM-DD' string, which is
 *   already a wall-clock cell key.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { franchiseeKeys } from '@/features/franchisee/queryKeys';
import type { CourseInstanceStatus } from './types';
import type { MonthCalendarCourse } from '@/components/daisy/MonthCalendar';

// ---------------------------------------------------------------------------
// Shared table-missing guard (matches HQ queries pattern)
// ---------------------------------------------------------------------------

const TABLE_MISSING_CODES = new Set(['42P01', 'PGRST205']);
function isTableMissing(code: string | null | undefined): boolean {
  return TABLE_MISSING_CODES.has(code ?? '');
}

// ---------------------------------------------------------------------------
// List query types
// ---------------------------------------------------------------------------

export interface OwnCoursesFilters {
  status?: CourseInstanceStatus | 'all';
  /** 'YYYY-MM-DD' inclusive lower bound. */
  from?: string;
  /** 'YYYY-MM-DD' inclusive upper bound. */
  to?: string;
  page?: number;
  /** Defaults to 20. */
  pageSize?: number;
}

export interface OwnCourseListRow {
  id: string;
  event_date: string;
  start_time: string;
  end_time: string;
  status: CourseInstanceStatus;
  venue_name: string | null;
  venue_postcode: string;
  capacity: number;
  spots_remaining: number;
  price_pence: number;
  template_id: string;
  template_name: string;
}

export interface OwnCoursesResult {
  rows: OwnCourseListRow[];
  totalCount: number;
}

// ---------------------------------------------------------------------------
// useOwnCourses — paginated, filtered list
// ---------------------------------------------------------------------------

/**
 * Paginated list of the signed-in franchisee's own course instances.
 * RLS restricts rows server-side; no client franchisee_id filter needed.
 * Sorted ascending by event_date by default.
 */
export function useOwnCourses(filters: OwnCoursesFilters = {}) {
  const { status = 'all', from, to, page = 0, pageSize = 20 } = filters;

  // Build a stable, serialisable filter object for the cache key.
  const filterKey: Record<string, unknown> = { status, from, to, page, pageSize };

  const query = useQuery<OwnCoursesResult>({
    queryKey: franchiseeKeys.coursesList(filterKey),
    queryFn: async () => {
      let qb = supabase
        .from('da_course_instances')
        .select(
          `id,
           event_date,
           start_time,
           end_time,
           status,
           venue_name,
           venue_postcode,
           capacity,
           spots_remaining,
           price_pence,
           template_id,
           template:da_course_templates ( id, name )`,
          { count: 'exact' },
        )
        // Default sort: upcoming courses first, then past
        .order('event_date', { ascending: true })
        .order('start_time', { ascending: true });

      if (status !== 'all') {
        qb = qb.eq('status', status);
      }

      if (from) {
        qb = qb.gte('event_date', from);
      }
      if (to) {
        // Inclusive upper bound: use lte so 'YYYY-MM-DD' comparison is
        // on the raw DATE string (Postgres handles string-to-date cast).
        qb = qb.lte('event_date', to);
      }

      const rangeFrom = page * pageSize;
      const rangeTo = rangeFrom + pageSize - 1;
      const { data, count, error } = await qb.range(rangeFrom, rangeTo);

      if (error) {
        if (isTableMissing(error.code)) return { rows: [], totalCount: 0 };
        throw error;
      }

      type Joined = Omit<OwnCourseListRow, 'template_name'> & {
        template: { id: string; name: string } | null;
      };

      const rows: OwnCourseListRow[] = ((data ?? []) as unknown as Joined[]).map((row) => ({
        id: row.id,
        event_date: row.event_date,
        start_time: row.start_time,
        end_time: row.end_time,
        status: row.status,
        venue_name: row.venue_name,
        venue_postcode: row.venue_postcode,
        capacity: row.capacity,
        spots_remaining: row.spots_remaining,
        price_pence: row.price_pence,
        template_id: row.template_id,
        template_name: row.template?.name ?? '-',
      }));

      return { rows, totalCount: count ?? 0 };
    },
  });

  return {
    rows: query.data?.rows ?? [],
    totalCount: query.data?.totalCount ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
  };
}

// ---------------------------------------------------------------------------
// useOwnCoursesForMonth — calendar view
// ---------------------------------------------------------------------------

/**
 * Fetches all own course instances for a given calendar month for use in
 * <MonthCalendar />. The month key is 'YYYY-MM' (wall-clock).
 *
 * DATE BUCKETING (BST-safe):
 *   We filter using gte('event_date', 'YYYY-MM-01') and
 *   lt('event_date', next-month 'YYYY-MM-01'). Both bounds are derived from
 *   the year/month integers directly — no Date constructor, no UTC
 *   arithmetic. The returned event_date strings ('YYYY-MM-DD') are used as
 *   calendar cell keys verbatim by <MonthCalendar />.
 */
export function useOwnCoursesForMonth(year: number, month: number) {
  // Pad month to 2 digits for the 'YYYY-MM' key and SQL bounds
  const monthPadded = String(month).padStart(2, '0');
  const monthKey = `${year}-${monthPadded}`;

  // Compute next-month lower bound without using Date arithmetic.
  // month is 1-based (1 = January, 12 = December).
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextMonthPadded = String(nextMonth).padStart(2, '0');

  const fromBound = `${year}-${monthPadded}-01`;
  const toBound = `${nextYear}-${nextMonthPadded}-01`; // exclusive

  const query = useQuery<MonthCalendarCourse[]>({
    queryKey: franchiseeKeys.coursesCalendar(monthKey),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_course_instances')
        .select(
          `id,
           event_date,
           start_time,
           status,
           capacity,
           spots_remaining,
           template_id,
           template:da_course_templates ( id, name )`,
        )
        .gte('event_date', fromBound)
        .lt('event_date', toBound)
        .order('event_date', { ascending: true })
        .order('start_time', { ascending: true });

      if (error) {
        if (isTableMissing(error.code)) return [];
        throw error;
      }

      type Joined = {
        id: string;
        event_date: string;
        start_time: string;
        status: CourseInstanceStatus;
        capacity: number;
        spots_remaining: number;
        template_id: string;
        template: { id: string; name: string } | null;
      };

      return ((data ?? []) as unknown as Joined[]).map((row) => ({
        id: row.id,
        event_date: row.event_date,
        start_time: row.start_time,
        template_name: row.template?.name ?? '-',
        status: row.status,
        spots_remaining: row.spots_remaining,
        capacity: row.capacity,
      }));
    },
  });

  return {
    courses: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}
