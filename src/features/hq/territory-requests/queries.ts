/**
 * HQ territory-requests queries.
 *
 * Reads da_territory_requests (HQ RLS: hq_full_access) joined to the requesting
 * franchisee. Status changes go through the update-territory-request Edge
 * Function (HQ-only). Invalidating also refreshes the dashboard Attention list.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type TerritoryRequestStatus = 'new' | 'reviewing' | 'approved' | 'declined';

export const TERRITORY_REQUEST_ACTIONS: Exclude<TerritoryRequestStatus, 'new'>[] = [
  'reviewing',
  'approved',
  'declined',
];

export interface TerritoryRequest {
  id: string;
  area: string;
  note: string | null;
  status: TerritoryRequestStatus;
  created_at: string;
  handled_at: string | null;
  franchisee_name: string;
  franchisee_number: string;
}

export function useTerritoryRequests() {
  return useQuery<TerritoryRequest[]>({
    queryKey: ['hq', 'territory-requests'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_territory_requests')
        .select(
          'id, area, note, status, created_at, handled_at, franchisee:da_franchisees(name, number)',
        )
        .order('created_at', { ascending: false });
      if (error) throw error;

      type Joined = {
        id: string;
        area: string;
        note: string | null;
        status: TerritoryRequestStatus;
        created_at: string;
        handled_at: string | null;
        franchisee: { name: string; number: string } | null;
      };

      return ((data ?? []) as unknown as Joined[]).map((r) => ({
        id: r.id,
        area: r.area,
        note: r.note,
        status: r.status,
        created_at: r.created_at,
        handled_at: r.handled_at,
        franchisee_name: r.franchisee?.name ?? 'Unknown',
        franchisee_number: r.franchisee?.number ?? '',
      }));
    },
  });
}

async function callEdge<T>(path: string, payload: unknown): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('You must be signed in.');
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const b = (await res.json()) as { error?: string };
      if (b.error) message = b.error;
    } catch {
      // not JSON
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function useUpdateTerritoryRequest() {
  const qc = useQueryClient();
  return useMutation<
    unknown,
    Error,
    { id: string; status: Exclude<TerritoryRequestStatus, 'new'> }
  >({
    mutationFn: (payload) => callEdge('update-territory-request', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hq', 'territory-requests'] });
      void qc.invalidateQueries({ queryKey: ['hq', 'attention'] });
    },
  });
}
