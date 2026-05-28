/**
 * franchisee/bookings — query and mutation hooks (Wave 9A).
 *
 * Reads are RLS-scoped via the anon client — the franchisee_own policy on
 * da_bookings filters to rows whose franchisee_id matches the signed-in
 * user. No client-side franchisee_id filter is applied.
 *
 * Writes go through Edge Functions (mark-booking-paid, add-booking-note,
 * cancel-booking) which use the service_role client and verify ownership
 * server-side from the caller's JWT.
 *
 * DATE NOTE:
 *   course event_date is a Postgres DATE ('YYYY-MM-DD'). We do not pass it
 *   through new Date() — in BST a midnight-UTC Date constructed from that
 *   string can resolve to the previous calendar day. Raw strings are kept
 *   throughout; formatDate() in the components uses Intl.DateTimeFormat with
 *   integer-split parts to avoid drift.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { franchiseeKeys } from '@/features/franchisee/queryKeys';
import type { ActivityRow, BookingStatus, PaymentStatus } from '@/types/franchisee';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const TABLE_MISSING_CODES = new Set(['42P01', 'PGRST205']);

function isTableMissing(code: string | null | undefined): boolean {
  return TABLE_MISSING_CODES.has(code ?? '');
}

async function callEdgeFunction<T>(path: string, payload: unknown): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('You must be signed in to perform this action.');

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // body was not JSON
    }
    const err = new Error(message);
    (err as Error & { status: number }).status = response.status;
    throw err;
  }

  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// List types
// ---------------------------------------------------------------------------

export type DateRangeFilter = 'this-month' | 'last-month' | 'last-30-days' | 'all' | 'custom';

export interface OwnBookingsFilters {
  search?: string;
  paymentStatus?: PaymentStatus | 'all';
  bookingStatus?: BookingStatus | 'all';
  dateRange?: DateRangeFilter;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}

export interface OwnBookingListRow {
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
  ticket_type_name: string | null;
}

// ---------------------------------------------------------------------------
// Detail type
// ---------------------------------------------------------------------------

export interface OwnBookingDetail {
  id: string;
  booking_reference: string;
  total_price_pence: number;
  discount_code: string | null;
  discount_amount_pence: number | null;
  payment_status: PaymentStatus;
  booking_status: BookingStatus;
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
  private_client: {
    id: string;
    company_name: string;
    contact_name: string | null;
    contact_email: string | null;
    contact_phone: string | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Mutation payload types
// ---------------------------------------------------------------------------

export interface MarkBookingPaidPayload {
  booking_id: string;
  payment_reference: string;
  paid_at?: string;
}

export interface AddBookingNotePayload {
  booking_id: string;
  note: string;
}

export interface CancelBookingPayload {
  booking_id: string;
  cancellation_reason: string;
  refund_amount_pence?: number;
}

// ---------------------------------------------------------------------------
// Date range resolver (mirrors HQ queries pattern)
// ---------------------------------------------------------------------------

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
    const start = new Date(`${fromDate}T00:00:00Z`);
    const end = new Date(`${toDate}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    return { fromIso: start.toISOString(), toIso: end.toISOString() };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Read hooks
// ---------------------------------------------------------------------------

/**
 * useOwnBookings — paginated, filterable list of the signed-in franchisee's
 * bookings with joined customer + course template + ticket type data.
 * RLS scopes the query to the caller's franchisee_id automatically.
 */
export function useOwnBookings(filters: OwnBookingsFilters = {}) {
  const {
    search = '',
    paymentStatus = 'all',
    bookingStatus = 'all',
    dateRange = 'all',
    fromDate,
    toDate,
    page = 0,
    pageSize = 20,
  } = filters;

  const query = useQuery<{ rows: OwnBookingListRow[]; totalCount: number }>({
    queryKey: [
      ...franchiseeKeys.bookings(),
      'list',
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
             template:da_course_templates ( name )
           ),
           ticket_type:da_ticket_types ( name )`,
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
          template: { name: string } | null;
        } | null;
        ticket_type: { name: string } | null;
      };

      const rows: OwnBookingListRow[] = ((data ?? []) as unknown as Joined[]).map((row) => ({
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
        ticket_type_name: row.ticket_type?.name ?? null,
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

/**
 * useBookingDetail — single booking with full joins for the detail page.
 * Includes private_client if the booking was linked to one.
 */
export function useBookingDetail(id: string | undefined) {
  return useQuery<OwnBookingDetail | null>({
    enabled: !!id,
    queryKey: franchiseeKeys.booking(id ?? ''),
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
           private_client:da_private_clients ( id, company_name, contact_name, contact_email, contact_phone )`,
        )
        .eq('id', id)
        .maybeSingle();
      if (error) {
        if (isTableMissing(error.code)) return null;
        throw error;
      }
      return data as unknown as OwnBookingDetail | null;
    },
  });
}

/**
 * useBookingActivity — activity log entries scoped to a single booking.
 */
export function useBookingActivity(id: string | undefined, limit = 20) {
  return useQuery<ActivityRow[]>({
    enabled: !!id,
    queryKey: [...franchiseeKeys.booking(id ?? ''), 'activity', limit],
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

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

/**
 * useMarkBookingPaid — sets payment_status to 'manual'.
 * Only succeeds when current payment_status is 'pending' (enforced server-side).
 * Invalidates both the list and the specific detail query on success.
 */
export function useMarkBookingPaid() {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, MarkBookingPaidPayload>({
    mutationFn: (payload) => callEdgeFunction('mark-booking-paid', payload),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: franchiseeKeys.bookings() });
      void queryClient.invalidateQueries({
        queryKey: franchiseeKeys.booking(variables.booking_id),
      });
    },
  });
}

/**
 * useAddBookingNote — appends a timestamped note to da_bookings.notes.
 * The server prefixes the note with [YYYY-MM-DD HH:mm UTC].
 */
export function useAddBookingNote() {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, AddBookingNotePayload>({
    mutationFn: (payload) => callEdgeFunction('add-booking-note', payload),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: franchiseeKeys.booking(variables.booking_id),
      });
    },
  });
}

/**
 * useCancelBooking — sets booking_status to 'cancelled'.
 * refund_amount_pence is a record-only flag; no Stripe refund is triggered.
 * Invalidates both list and detail.
 */
export function useCancelBooking() {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, CancelBookingPayload>({
    mutationFn: (payload) => callEdgeFunction('cancel-booking', payload),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: franchiseeKeys.bookings() });
      void queryClient.invalidateQueries({
        queryKey: franchiseeKeys.booking(variables.booking_id),
      });
    },
  });
}
