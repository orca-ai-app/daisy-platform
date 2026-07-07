/**
 * TanStack Query hooks for the private-clients feature (Wave 9C).
 *
 * All reads are RLS-scoped — the franchisee_own policy on da_private_clients
 * ensures the anon client only returns rows owned by the signed-in franchisee.
 * Writes go through Edge Functions (create-private-client, update-private-client)
 * which use the service_role client to bypass RLS and stamp franchisee_id
 * server-side from the caller's JWT.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { franchiseeKeys } from '@/features/franchisee/queryKeys';
import type {
  PrivateClient,
  CreatePrivateClientPayload,
  UpdatePrivateClientPayload,
} from './types';

// ---------------------------------------------------------------------------
// Read hooks
// ---------------------------------------------------------------------------

/**
 * useOwnPrivateClients — fetches all private clients belonging to the
 * signed-in franchisee, ordered alphabetically by company name.
 *
 * Used as the data source for both the clients directory and the
 * <PrivateClientSelect> dropdown on the course-create wizard.
 */
export function useOwnPrivateClients() {
  return useQuery<PrivateClient[]>({
    queryKey: franchiseeKeys.clients(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_private_clients')
        .select('*')
        .order('company_name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PrivateClient[];
    },
  });
}

/**
 * useClientRecentBookings — recent bookings for a single private client,
 * joined to the course instance and template name.
 *
 * The Wave 8 webhook stamps private_client_id on da_bookings when the client
 * is linked to a course instance. This query surfaces those bookings in a
 * "recent bookings" panel on the client detail row / drawer.
 *
 * RLS: da_bookings.franchisee_own scopes to the caller's bookings — no
 * additional filter needed.
 */

interface ClientBookingRow {
  id: string;
  booking_reference: string;
  created_at: string;
  total_price_pence: number;
  payment_status: string;
  booking_status: string;
  course_event_date: string | null;
  course_template_name: string | null;
}

export function useClientRecentBookings(clientId: string | undefined, limit = 10) {
  return useQuery<ClientBookingRow[]>({
    enabled: !!clientId,
    queryKey: [...franchiseeKeys.client(clientId ?? ''), 'recent-bookings', limit],
    queryFn: async () => {
      if (!clientId) return [];
      const { data, error } = await supabase
        .from('da_bookings')
        .select(
          `id,
           booking_reference,
           created_at,
           total_price_pence,
           payment_status,
           booking_status,
           course_instance:da_course_instances (
             event_date,
             template:da_course_templates ( name )
           )`,
        )
        .eq('private_client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;

      type Joined = {
        id: string;
        booking_reference: string;
        created_at: string;
        total_price_pence: number;
        payment_status: string;
        booking_status: string;
        course_instance: {
          event_date: string | null;
          template: { name: string } | null;
        } | null;
      };

      return ((data ?? []) as unknown as Joined[]).map((row) => ({
        id: row.id,
        booking_reference: row.booking_reference,
        created_at: row.created_at,
        total_price_pence: row.total_price_pence,
        payment_status: row.payment_status,
        booking_status: row.booking_status,
        course_event_date: row.course_instance?.event_date ?? null,
        course_template_name: row.course_instance?.template?.name ?? null,
      }));
    },
  });
}

// ---------------------------------------------------------------------------
// Edge Function callers
// ---------------------------------------------------------------------------

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
    let requestId: string | undefined;
    try {
      const body = (await response.json()) as { error?: string; request_id?: string };
      if (body.error) message = body.error;
      if (typeof body.request_id === 'string') requestId = body.request_id;
    } catch {
      // body wasn't JSON
    }
    const err = new Error(message);
    // Preserve the status so callers can detect 409 uniqueness collisions.
    (err as Error & { status: number; request_id?: string }).status = response.status;
    if (requestId) (err as Error & { request_id?: string }).request_id = requestId;
    throw err;
  }

  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Write mutations
// ---------------------------------------------------------------------------

export function useCreatePrivateClient() {
  const queryClient = useQueryClient();
  return useMutation<PrivateClient, Error, CreatePrivateClientPayload>({
    mutationFn: (payload) => callEdgeFunction<PrivateClient>('create-private-client', payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: franchiseeKeys.clients() });
    },
  });
}

export function useUpdatePrivateClient() {
  const queryClient = useQueryClient();
  return useMutation<PrivateClient, Error, UpdatePrivateClientPayload>({
    mutationFn: (payload) => callEdgeFunction<PrivateClient>('update-private-client', payload),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: franchiseeKeys.clients() });
      void queryClient.invalidateQueries({ queryKey: franchiseeKeys.client(updated.id) });
    },
  });
}
