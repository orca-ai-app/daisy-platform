/**
 * HQ Course-Instance queries + mutations.
 *
 * - useCourseInstances(filters): paginated SELECT with template +
 *   franchisee joins, plus filters for status, franchisee, date range
 *   and search by venue_postcode/venue_name.
 * - useCourseInstance(id): single row with template, franchisee,
 *   ticket types and bookings count for the detail page.
 * - useUpdateCourseInstance / useCancelCourseInstance: TanStack
 *   mutations that POST to the matching Edge Functions.
 *
 * Reference: docs/PRD-technical.md §4.5 (da_course_instances), §4.6
 * (da_ticket_types), §4.4 (da_course_templates), §4.9 (da_bookings).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const TABLE_MISSING_CODES = new Set(['42P01', 'PGRST205']);
function isTableMissing(code: string | null | undefined): boolean {
  return TABLE_MISSING_CODES.has(code ?? '');
}

export type CourseInstanceStatus = 'scheduled' | 'completed' | 'cancelled';
export type DateRangePreset =
  | 'all'
  | 'next-30-days'
  | 'this-month'
  | 'last-month'
  | 'past'
  | 'custom';

export interface CourseInstancesFilters {
  search?: string;
  status?: CourseInstanceStatus | 'all';
  franchiseeId?: string | 'all';
  dateRange?: DateRangePreset;
  fromDate?: string; // YYYY-MM-DD inclusive
  toDate?: string; // YYYY-MM-DD inclusive
  page?: number;
  pageSize?: number;
}

export interface CourseInstanceListRow {
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
  visibility: 'public' | 'private';
  template_id: string;
  template_name: string;
  franchisee_id: string;
  franchisee_number: string;
  franchisee_name: string;
}

export interface CourseInstancesResult {
  rows: CourseInstanceListRow[];
  totalCount: number;
}

function resolveDateRange(
  preset: DateRangePreset,
  fromDate?: string,
  toDate?: string,
): { fromIso: string; toIso: string } | null {
  const now = new Date();
  if (preset === 'all') return null;
  if (preset === 'next-30-days') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 31);
    return { fromIso: start.toISOString().slice(0, 10), toIso: end.toISOString().slice(0, 10) };
  }
  if (preset === 'this-month') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { fromIso: start.toISOString().slice(0, 10), toIso: end.toISOString().slice(0, 10) };
  }
  if (preset === 'last-month') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { fromIso: start.toISOString().slice(0, 10), toIso: end.toISOString().slice(0, 10) };
  }
  if (preset === 'past') {
    // Anything strictly before today.
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    // Use a very early sentinel for the lower bound.
    return { fromIso: '1970-01-01', toIso: end.toISOString().slice(0, 10) };
  }
  if (preset === 'custom' && fromDate && toDate) {
    // Inclusive on both ends; bump end by one day for `<` comparison.
    const end = new Date(`${toDate}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    return { fromIso: fromDate, toIso: end.toISOString().slice(0, 10) };
  }
  return null;
}

export function useCourseInstances(filters: CourseInstancesFilters = {}) {
  const {
    search = '',
    status = 'all',
    franchiseeId = 'all',
    dateRange = 'all',
    fromDate,
    toDate,
    page = 0,
    pageSize = 20,
  } = filters;

  const query = useQuery<CourseInstancesResult>({
    queryKey: [
      'hq',
      'course-instances',
      { search, status, franchiseeId, dateRange, fromDate, toDate, page, pageSize },
    ],
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
           visibility,
           template_id,
           template:da_course_templates ( id, name ),
           franchisee:da_franchisees ( id, number, name )`,
          { count: 'exact' },
        )
        .order('event_date', { ascending: false });

      if (status !== 'all') qb = qb.eq('status', status);
      if (franchiseeId !== 'all') qb = qb.eq('franchisee_id', franchiseeId);

      const range = resolveDateRange(dateRange, fromDate, toDate);
      if (range) {
        qb = qb.gte('event_date', range.fromIso).lt('event_date', range.toIso);
      }

      const trimmed = search.trim();
      if (trimmed.length > 0) {
        const escaped = trimmed.replace(/[%,()]/g, '');
        qb = qb.or(`venue_postcode.ilike.%${escaped}%,venue_name.ilike.%${escaped}%`);
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
        event_date: string;
        start_time: string;
        end_time: string;
        status: CourseInstanceStatus;
        venue_name: string | null;
        venue_postcode: string;
        capacity: number;
        spots_remaining: number;
        price_pence: number;
        visibility: 'public' | 'private';
        template_id: string;
        template: { id: string; name: string } | null;
        franchisee: { id: string; number: string; name: string } | null;
      };

      const rows: CourseInstanceListRow[] = ((data ?? []) as unknown as Joined[]).map((row) => ({
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
        visibility: row.visibility,
        template_id: row.template_id,
        template_name: row.template?.name ?? '—',
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
    error: query.error as Error | null,
  };
}

export interface CourseInstanceDetail {
  id: string;
  created_at: string;
  updated_at: string;
  event_date: string;
  start_time: string;
  end_time: string;
  status: CourseInstanceStatus;
  visibility: 'public' | 'private';
  capacity: number;
  spots_remaining: number;
  price_pence: number;
  venue_name: string | null;
  venue_address: string | null;
  venue_postcode: string;
  lat: number | null;
  lng: number | null;
  bespoke_details: string | null;
  cancellation_reason: string | null;
  out_of_territory: boolean;
  out_of_territory_warning: string | null;
  template_id: string;
  template: { id: string; name: string; slug: string } | null;
  franchisee_id: string;
  franchisee: {
    id: string;
    number: string;
    name: string;
    email: string;
  } | null;
  ticket_types: Array<{
    id: string;
    name: string;
    price_pence: number;
    seats_consumed: number;
    max_available: number | null;
    sort_order: number | null;
  }>;
  bookings_count: number;
}

export function useCourseInstance(id: string | undefined) {
  return useQuery<CourseInstanceDetail | null>({
    enabled: !!id,
    queryKey: ['hq', 'course-instance', id],
    queryFn: async () => {
      if (!id) return null;

      const { data, error } = await supabase
        .from('da_course_instances')
        .select(
          `id,
           created_at,
           updated_at,
           event_date,
           start_time,
           end_time,
           status,
           visibility,
           capacity,
           spots_remaining,
           price_pence,
           venue_name,
           venue_address,
           venue_postcode,
           lat,
           lng,
           bespoke_details,
           cancellation_reason,
           out_of_territory,
           out_of_territory_warning,
           template_id,
           template:da_course_templates ( id, name, slug ),
           franchisee_id,
           franchisee:da_franchisees ( id, number, name, email ),
           ticket_types:da_ticket_types ( id, name, price_pence, seats_consumed, max_available, sort_order )`,
        )
        .eq('id', id)
        .maybeSingle();

      if (error) {
        if (isTableMissing(error.code)) return null;
        throw error;
      }
      if (!data) return null;

      // Bookings count fetched separately so we can pass count exact
      // without polluting the join.
      const bookings = await supabase
        .from('da_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('course_instance_id', id);
      const bookings_count = bookings.error ? 0 : (bookings.count ?? 0);

      const row = data as unknown as Omit<
        CourseInstanceDetail,
        'bookings_count' | 'ticket_types'
      > & {
        ticket_types: CourseInstanceDetail['ticket_types'] | null;
      };

      return {
        ...row,
        ticket_types: (row.ticket_types ?? [])
          .slice()
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
        bookings_count,
      } as CourseInstanceDetail;
    },
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface CourseInstanceUpdate {
  event_date?: string;
  start_time?: string;
  end_time?: string;
  venue_name?: string | null;
  venue_address?: string | null;
  venue_postcode?: string;
  capacity?: number;
  price_pence?: number;
}

interface UpdateArgs {
  id: string;
  fields: CourseInstanceUpdate;
}

async function callUpdateCourseInstance({ id, fields }: UpdateArgs) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('You must be signed in to edit course instances.');

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-course-instance`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ id, fields }),
  });
  if (!res.ok) {
    let message = `Update failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // body wasn't JSON — keep generic message.
    }
    throw new Error(message);
  }
  return (await res.json()) as Record<string, unknown>;
}

export function useUpdateCourseInstance(): UseMutationResult<
  Record<string, unknown>,
  Error,
  UpdateArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: callUpdateCourseInstance,
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['hq', 'course-instances'] });
      void queryClient.invalidateQueries({ queryKey: ['hq', 'course-instance', variables.id] });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

interface CancelArgs {
  id: string;
  fields: { cancellation_reason: string };
}

interface CancelResponse {
  instance: Record<string, unknown>;
  bookings_affected: number;
  already_cancelled?: boolean;
}

async function callCancelCourseInstance({ id, fields }: CancelArgs): Promise<CancelResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('You must be signed in to cancel course instances.');

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cancel-course-instance`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ id, fields }),
  });
  if (!res.ok) {
    let message = `Cancel failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // body wasn't JSON — keep generic message.
    }
    throw new Error(message);
  }
  return (await res.json()) as CancelResponse;
}

export function useCancelCourseInstance(): UseMutationResult<CancelResponse, Error, CancelArgs> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: callCancelCourseInstance,
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['hq', 'course-instances'] });
      void queryClient.invalidateQueries({ queryKey: ['hq', 'course-instance', variables.id] });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Helper for Bookings-affected dialog: a quick count without loading the
// full instance detail.
// ---------------------------------------------------------------------------

export function useCourseInstanceBookingsCount(id: string | undefined) {
  return useQuery<number>({
    enabled: !!id,
    queryKey: ['hq', 'course-instance', id, 'bookings-count'],
    queryFn: async () => {
      if (!id) return 0;
      const { count, error } = await supabase
        .from('da_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('course_instance_id', id);
      if (error) {
        if (isTableMissing(error.code)) return 0;
        throw error;
      }
      return count ?? 0;
    },
  });
}

// Used by the franchisee-filter dropdown.
export function useFranchiseeOptions() {
  return useQuery<Array<{ id: string; number: string; name: string }>>({
    queryKey: ['hq', 'franchisee-options'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_franchisees')
        .select('id, number, name')
        .order('number', { ascending: true });
      if (error) {
        if (isTableMissing(error.code)) return [];
        throw error;
      }
      return data ?? [];
    },
  });
}

/**
 * Map a course instance status to a StatusPill variant. Per Wave 4B:
 *   scheduled → active   (green — healthy)
 *   completed → paid     (green — closed-out happy path)
 *   cancelled → terminated (red — terminal)
 */
export function courseInstanceStatusVariant(
  s: CourseInstanceStatus,
): 'active' | 'paid' | 'terminated' {
  if (s === 'cancelled') return 'terminated';
  if (s === 'completed') return 'paid';
  return 'active';
}
