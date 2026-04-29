import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

// ----- Wave 4A: create + update mutations -----------------------------------

/**
 * Input shape for `useCreateFranchisee`. Mirrors the Edge Function contract
 * locked in the build plan: flat fields, no nested {id, fields} envelope.
 */
export interface CreateFranchiseeInput {
  number: string;
  name: string;
  email: string;
  fee_tier: 100 | 120;
  billing_date: number;
  phone?: string | null;
  notes?: string | null;
  is_hq?: boolean;
}

/**
 * The shape returned by the `create-franchisee` Edge Function.
 * `magic_link` is null only if Supabase's admin generate_link API failed
 * after the franchisee was already created (a system activity logs that
 * case so HQ can re-issue the link manually).
 */
export interface CreateFranchiseeResult {
  franchisee: Franchisee;
  auth_user_id: string;
  magic_link: string | null;
}

async function callCreateFranchisee(input: CreateFranchiseeInput): Promise<CreateFranchiseeResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error('You must be signed in to onboard a franchisee.');
  }

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-franchisee`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    let message = `Create failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // body wasn't JSON
    }
    throw new Error(message);
  }

  return (await response.json()) as CreateFranchiseeResult;
}

export function useCreateFranchisee() {
  const queryClient = useQueryClient();
  return useMutation<CreateFranchiseeResult, Error, CreateFranchiseeInput>({
    mutationFn: callCreateFranchisee,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hq', 'franchisees'] });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
      void queryClient.invalidateQueries({ queryKey: ['hq', 'attention'] });
    },
  });
}

/**
 * Editable subset for `useUpdateFranchisee`. Stripe / GoCardless / number /
 * auth_user_id are NOT editable through this surface.
 */
export interface FranchiseeUpdateFields {
  name?: string;
  email?: string;
  phone?: string | null;
  fee_tier?: 100 | 120;
  billing_date?: number;
  status?: FranchiseeStatus;
  notes?: string | null;
  vat_registered?: boolean;
  is_hq?: boolean;
}

export interface UpdateFranchiseeInput {
  id: string;
  fields: FranchiseeUpdateFields;
}

async function callUpdateFranchisee(input: UpdateFranchiseeInput): Promise<Franchisee> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error('You must be signed in to edit a franchisee.');
  }

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-franchisee`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    let message = `Update failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // body wasn't JSON
    }
    throw new Error(message);
  }

  return (await response.json()) as Franchisee;
}

export function useUpdateFranchisee() {
  const queryClient = useQueryClient();
  return useMutation<Franchisee, Error, UpdateFranchiseeInput>({
    mutationFn: callUpdateFranchisee,
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ['hq', 'franchisees'] });
      void queryClient.invalidateQueries({ queryKey: ['hq', 'franchisee', updated.id] });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

/**
 * Reads the current franchisee numbers and returns the next zero-padded
 * 4-digit string. Used by the New franchisee form to pre-fill a sensible
 * default while still allowing override.
 */
export function useNextFranchiseeNumber() {
  return useQuery<string>({
    queryKey: ['hq', 'franchisees', 'next-number'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_franchisees')
        .select('number')
        .order('number', { ascending: false })
        .limit(1);
      if (error) throw error;
      const top = data?.[0]?.number ?? '0000';
      const asInt = Number.parseInt(top, 10);
      const next = (Number.isFinite(asInt) ? asInt : 0) + 1;
      return next.toString().padStart(4, '0');
    },
    // Refresh on focus so two HQ tabs don't both pre-fill the same number.
    staleTime: 0,
  });
}
