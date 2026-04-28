import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type {
  ActivityRow,
  Franchisee,
  FranchiseeBookingRow,
  FranchiseeStatus,
  Territory,
} from '@/types/franchisee';

export interface FranchiseeListFilters {
  /** Free-text search across name / number / email. */
  search?: string;
  /** Optional status filter; omit or 'all' for no filter. */
  status?: FranchiseeStatus | 'all';
  /** 0-indexed page. */
  page?: number;
  /** Rows per page (matches DataTable default). */
  pageSize?: number;
}

export interface FranchiseeListResult {
  rows: FranchiseeRow[];
  totalCount: number;
}

/**
 * List-row shape — Franchisee plus a derived territory_count and the
 * timestamp of the most recent activity for the "last action" column.
 */
export interface FranchiseeRow extends Franchisee {
  territory_count: number;
  last_action_at: string | null;
}

/**
 * useFranchisees — paginated, filterable list query.
 *
 * Uses two queries: the main paginated list, then a fan-out of
 * territory counts + last-activity timestamps. The fan-out keeps the
 * page snappy without us having to wait on a Postgres view.
 */
export function useFranchisees(filters: FranchiseeListFilters = {}) {
  const { search = '', status = 'all', page = 0, pageSize = 20 } = filters;

  const query = useQuery<FranchiseeListResult>({
    queryKey: ['hq', 'franchisees', { search, status, page, pageSize }],
    queryFn: async () => {
      let qb = supabase
        .from('da_franchisees')
        .select('*', { count: 'exact' })
        .order('number', { ascending: true });

      if (status !== 'all') {
        qb = qb.eq('status', status);
      }

      const trimmed = search.trim();
      if (trimmed.length > 0) {
        // ilike matches across name / number / email. PostgREST `or`
        // syntax: comma-separated, percent-encoded already.
        const escaped = trimmed.replace(/[%,()]/g, '');
        qb = qb.or(`name.ilike.%${escaped}%,number.ilike.%${escaped}%,email.ilike.%${escaped}%`);
      }

      const from = page * pageSize;
      const to = from + pageSize - 1;
      const { data, count, error } = await qb.range(from, to);
      if (error) throw error;

      const base = (data ?? []) as Franchisee[];

      // Fan out territory counts and last-activity timestamps. We do
      // this client-side to stay read-only and avoid a Postgres view.
      const rows = await Promise.all(
        base.map(async (f) => {
          const [{ count: tc }, latest] = await Promise.all([
            supabase
              .from('da_territories')
              .select('id', { count: 'exact', head: true })
              .eq('franchisee_id', f.id),
            supabase
              .from('da_activities')
              .select('created_at')
              .eq('entity_type', 'franchisee')
              .eq('entity_id', f.id)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
          ]);
          return {
            ...f,
            territory_count: tc ?? 0,
            last_action_at: latest.data?.created_at ?? null,
          } as FranchiseeRow;
        }),
      );

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

export interface FranchiseeDetailResult extends Franchisee {
  territory_count: number;
  recent_bookings_count: number;
}

/**
 * useFranchisee — single row plus computed counts for the detail header.
 */
export function useFranchisee(id: string | undefined) {
  return useQuery<FranchiseeDetailResult | null>({
    enabled: !!id,
    queryKey: ['hq', 'franchisee', id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('da_franchisees')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const base = data as Franchisee;

      const [{ count: territoryCount }, { count: bookingsCount }] = await Promise.all([
        supabase
          .from('da_territories')
          .select('id', { count: 'exact', head: true })
          .eq('franchisee_id', id),
        supabase
          .from('da_bookings')
          .select('id', { count: 'exact', head: true })
          .eq('franchisee_id', id),
      ]);

      return {
        ...base,
        territory_count: territoryCount ?? 0,
        recent_bookings_count: bookingsCount ?? 0,
      };
    },
  });
}

/**
 * useFranchiseeTerritories — territory list for the Territories tab.
 */
export function useFranchiseeTerritories(id: string | undefined) {
  return useQuery<Territory[]>({
    enabled: !!id,
    queryKey: ['hq', 'franchisee', id, 'territories'],
    queryFn: async () => {
      if (!id) return [];
      const { data, error } = await supabase
        .from('da_territories')
        .select('*')
        .eq('franchisee_id', id)
        .order('postcode_prefix', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Territory[];
    },
  });
}

/**
 * useFranchiseeBookings — bookings for one franchisee with the joined
 * customer name and course template name pulled across the FK chain.
 */
export function useFranchiseeBookings(id: string | undefined, limit = 20) {
  return useQuery<FranchiseeBookingRow[]>({
    enabled: !!id,
    queryKey: ['hq', 'franchisee', id, 'bookings', limit],
    queryFn: async () => {
      if (!id) return [];
      const { data, error } = await supabase
        .from('da_bookings')
        .select(
          `id,
           booking_reference,
           total_price_pence,
           payment_status,
           booking_status,
           created_at,
           customer:da_customers ( first_name, last_name ),
           course_instance:da_course_instances (
             event_date,
             template:da_course_templates ( name )
           )`,
        )
        .eq('franchisee_id', id)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;

      type Joined = {
        id: string;
        booking_reference: string;
        total_price_pence: number;
        payment_status: FranchiseeBookingRow['payment_status'];
        booking_status: FranchiseeBookingRow['booking_status'];
        created_at: string;
        customer: { first_name: string; last_name: string } | null;
        course_instance: {
          event_date: string | null;
          template: { name: string } | null;
        } | null;
      };

      return ((data ?? []) as unknown as Joined[]).map((row) => ({
        id: row.id,
        booking_reference: row.booking_reference,
        total_price_pence: row.total_price_pence,
        payment_status: row.payment_status,
        booking_status: row.booking_status,
        created_at: row.created_at,
        customer_name: row.customer ? `${row.customer.first_name} ${row.customer.last_name}` : '—',
        course_template_name: row.course_instance?.template?.name ?? null,
        course_event_date: row.course_instance?.event_date ?? null,
      }));
    },
  });
}

/**
 * useFranchiseeActivity — chronological activity rows scoped to one
 * franchisee. Filters `entity_type='franchisee'` so we get rows about
 * the franchisee themselves, not their bookings/courses.
 */
export function useFranchiseeActivity(franchiseeId: string | undefined, limit = 20) {
  return useQuery<ActivityRow[]>({
    enabled: !!franchiseeId,
    queryKey: ['hq', 'franchisee', franchiseeId, 'activity', limit],
    queryFn: async () => {
      if (!franchiseeId) return [];
      const { data, error } = await supabase
        .from('da_activities')
        .select('*')
        .eq('entity_type', 'franchisee')
        .eq('entity_id', franchiseeId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as ActivityRow[];
    },
  });
}
