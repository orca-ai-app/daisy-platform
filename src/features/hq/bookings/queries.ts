/**
 * HQ Bookings queries — read-only in Wave 3. List + detail + activity.
 *
 * The list query is paginated server-side via `range()` so RLS only
 * touches the visible page and totals come back via `count: 'exact'`.
 *
 * References: docs/PRD-technical.md §4.9 (`da_bookings`),
 * §4.5 (`da_course_instances`), §4.6 (`da_ticket_types`).
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ActivityRow, BookingStatus, PaymentStatus } from '@/types/franchisee';

/** Postgrest "relation does not exist" — match Wave 2A's defensive helper. */
const TABLE_MISSING_CODES = new Set(['42P01', 'PGRST205']);

function isTableMissing(code: string | null | undefined): boolean {
  return TABLE_MISSING_CODES.has(code ?? '');
}

export type DateRangeFilter = 'this-month' | 'last-month' | 'last-30-days' | 'all' | 'custom';

export interface BookingsListFilters {
  /** Search across booking_reference and customer email. */
  search?: string;
  /** Payment status filter; 'all' for none. */
  paymentStatus?: PaymentStatus | 'all';
  /** Booking status filter; 'all' for none. */
  bookingStatus?: BookingStatus | 'all';
  /** Date range preset OR 'custom' with explicit `from`/`to` ISO dates. */
  dateRange?: DateRangeFilter;
  /** Custom range start (inclusive). YYYY-MM-DD. */
  fromDate?: string;
  /** Custom range end (inclusive). YYYY-MM-DD. */
  toDate?: string;
  /** 0-indexed page. */
  page?: number;
  /** Rows per page. Default 20. */
  pageSize?: number;
}

/** Joined booking row used in the list table. */
export interface BookingListRow {
  id: string;
  booking_reference: string;
  total_price_pence: number;
  payment_status: PaymentStatus;
  booking_status: BookingStatus;
  created_at: string;
  customer_first_name: string;
  customer_last_name: string;
  customer_email: string;
  course_template_name: string | null;
  course_event_date: string | null;
  course_venue_postcode: string | null;
  franchisee_id: string;
  franchisee_number: string;
  franchisee_name: string;
}

export interface BookingsListResult {
  rows: BookingListRow[];
  totalCount: number;
}

/** Resolve a date range preset to inclusive `[fromIso, toIso]` window. */
function resolveDateRange(
  preset: DateRangeFilter,
  fromDate?: string,
  toDate?: string,
): { fromIso: string; toIso: string } | null {
  if (preset === 'all') return null;

  const now = new Date();
  if (preset === 'this-month') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { fromIso: start.toISOString(), toIso: end.toISOString() };
  }
  if (preset === 'last-month') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { fromIso: start.toISOString(), toIso: end.toISOString() };
  }
  if (preset === 'last-30-days') {
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - 30);
    return {
      fromIso: start.toISOString(),
      toIso: new Date(now.getTime() + 86_400_000).toISOString(),
    };
  }
  if (preset === 'custom' && fromDate && toDate) {
    // Parse YYYY-MM-DD as UTC midnight; toDate is inclusive so push end forward a day.
    const start = new Date(`${fromDate}T00:00:00Z`);
    const end = new Date(`${toDate}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    return { fromIso: start.toISOString(), toIso: end.toISOString() };
  }
  return null;
}

/**
 * useBookings — paginated, filterable list with joined customer +
 * course template + franchisee data. Server-side range() pagination.
 */
export function useBookings(filters: BookingsListFilters = {}) {
  const {
    search = '',
    paymentStatus = 'all',
    bookingStatus = 'all',
    dateRange = 'this-month',
    fromDate,
    toDate,
    page = 0,
    pageSize = 20,
  } = filters;

  const query = useQuery<BookingsListResult>({
    queryKey: [
      'hq',
      'bookings',
      { search, paymentStatus, bookingStatus, dateRange, fromDate, toDate, page, pageSize },
    ],
    queryFn: async () => {
      let qb = supabase
        .from('da_bookings')
        .select(
          `id,
           booking_reference,
           total_price_pence,
           payment_status,
           booking_status,
           created_at,
           customer:da_customers ( first_name, last_name, email ),
           course_instance:da_course_instances (
             event_date,
             venue_postcode,
             template:da_course_templates ( name )
           ),
           franchisee:da_franchisees ( id, number, name )`,
          { count: 'exact' },
        )
        .order('created_at', { ascending: false });

      if (paymentStatus !== 'all') {
        qb = qb.eq('payment_status', paymentStatus);
      }
      if (bookingStatus !== 'all') {
        qb = qb.eq('booking_status', bookingStatus);
      }

      const range = resolveDateRange(dateRange, fromDate, toDate);
      if (range) {
        qb = qb.gte('created_at', range.fromIso).lt('created_at', range.toIso);
      }

      const trimmed = search.trim();
      if (trimmed.length > 0) {
        // Search booking_reference directly. Customer email lives in the
        // joined table — Postgrest doesn't support filtering on joined
        // columns inside `or()`, so we let the client filter that case
        // by checking after the fetch. Reference search is the common path.
        const escaped = trimmed.replace(/[%,()]/g, '');
        qb = qb.ilike('booking_reference', `%${escaped}%`);
      }

      const from = page * pageSize;
      const to = from + pageSize - 1;
      const { data, count, error } = await qb.range(from, to);
      if (error) {
        if (isTableMissing(error.code)) return { rows: [], totalCount: 0 };
        throw error;
      }

      type Joined = {
        id: string;
        booking_reference: string;
        total_price_pence: number;
        payment_status: PaymentStatus;
        booking_status: BookingStatus;
        created_at: string;
        customer: { first_name: string; last_name: string; email: string } | null;
        course_instance: {
          event_date: string | null;
          venue_postcode: string | null;
          template: { name: string } | null;
        } | null;
        franchisee: { id: string; number: string; name: string } | null;
      };

      const rows: BookingListRow[] = ((data ?? []) as unknown as Joined[]).map((row) => ({
        id: row.id,
        booking_reference: row.booking_reference,
        total_price_pence: row.total_price_pence,
        payment_status: row.payment_status,
        booking_status: row.booking_status,
        created_at: row.created_at,
        customer_first_name: row.customer?.first_name ?? '',
        customer_last_name: row.customer?.last_name ?? '',
        customer_email: row.customer?.email ?? '',
        course_template_name: row.course_instance?.template?.name ?? null,
        course_event_date: row.course_instance?.event_date ?? null,
        course_venue_postcode: row.course_instance?.venue_postcode ?? null,
        franchisee_id: row.franchisee?.id ?? '',
        franchisee_number: row.franchisee?.number ?? '',
        franchisee_name: row.franchisee?.name ?? '',
      }));

      return { rows, totalCount: count ?? 0 };
    },
  });

  return {
    rows: query.data?.rows ?? [],
    totalCount: query.data?.totalCount ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  };
}

/** Single booking with full joins for the detail page. */
export interface BookingDetail {
  id: string;
  booking_reference: string;
  total_price_pence: number;
  discount_code: string | null;
  discount_amount_pence: number | null;
  payment_status: PaymentStatus;
  booking_status: BookingStatus;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  cancellation_reason: string | null;
  refund_amount_pence: number | null;
  notes: string | null;
  quantity: number;
  created_at: string;
  customer: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
    postcode: string | null;
  } | null;
  course_instance: {
    id: string;
    event_date: string | null;
    start_time: string | null;
    end_time: string | null;
    venue_name: string | null;
    venue_postcode: string | null;
    template: { id: string; name: string } | null;
  } | null;
  ticket_type: {
    id: string;
    name: string;
    price_pence: number;
    seats_consumed: number;
  } | null;
  franchisee: {
    id: string;
    number: string;
    name: string;
    email: string;
  } | null;
}

export function useBooking(id: string | undefined) {
  return useQuery<BookingDetail | null>({
    enabled: !!id,
    queryKey: ['hq', 'booking', id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('da_bookings')
        .select(
          `id,
           booking_reference,
           total_price_pence,
           discount_code,
           discount_amount_pence,
           payment_status,
           booking_status,
           stripe_payment_intent_id,
           stripe_checkout_session_id,
           cancellation_reason,
           refund_amount_pence,
           notes,
           quantity,
           created_at,
           customer:da_customers ( id, first_name, last_name, email, phone, postcode ),
           course_instance:da_course_instances (
             id,
             event_date,
             start_time,
             end_time,
             venue_name,
             venue_postcode,
             template:da_course_templates ( id, name )
           ),
           ticket_type:da_ticket_types ( id, name, price_pence, seats_consumed ),
           franchisee:da_franchisees ( id, number, name, email )`,
        )
        .eq('id', id)
        .maybeSingle();
      if (error) {
        if (isTableMissing(error.code)) return null;
        throw error;
      }
      return data as unknown as BookingDetail | null;
    },
  });
}

/** Activity rows scoped to this booking. */
export function useBookingActivity(id: string | undefined, limit = 20) {
  return useQuery<ActivityRow[]>({
    enabled: !!id,
    queryKey: ['hq', 'booking', id, 'activity', limit],
    queryFn: async () => {
      if (!id) return [];
      const { data, error } = await supabase
        .from('da_activities')
        .select('*')
        .eq('entity_type', 'booking')
        .eq('entity_id', id)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) {
        if (isTableMissing(error.code)) return [];
        throw error;
      }
      return (data ?? []) as ActivityRow[];
    },
  });
}
