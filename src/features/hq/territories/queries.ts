/**
 * Territory queries + mutations for HQ.
 *
 * - useTerritories(): SELECT da_territories joined to da_franchisees(name, number).
 *   Sorted by postcode_prefix.
 * - useFranchiseesForAssignment(): SELECT id, name, number from da_franchisees
 *   WHERE is_hq = false ORDER BY number. Drives the AssignFranchiseeModal dropdown.
 * - useAssignTerritory(): TanStack mutation hook that calls the assign-territory
 *   Edge Function. On success, invalidates the territories query.
 *
 * Reference: docs/PRD-technical.md §4.3, docs/M1-build-plan.md §6 Wave 3 Agent 3A.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export type TerritoryStatus = 'active' | 'vacant' | 'reserved';

export interface TerritoryRow {
  id: string;
  postcode_prefix: string;
  name: string;
  status: TerritoryStatus;
  lat: number | null;
  lng: number | null;
  franchisee_id: string | null;
  franchisee_name: string | null;
  franchisee_number: string | null;
  updated_at: string | null;
}

export interface FranchiseeOption {
  id: string;
  name: string;
  number: string;
}

export const TERRITORIES_QUERY_KEY = ['hq', 'territories'] as const;
export const FRANCHISEE_OPTIONS_QUERY_KEY = ['hq', 'franchisee-options'] as const;

// ---------------------------------------------------------------------------
// useTerritories
// ---------------------------------------------------------------------------

interface JoinedTerritory {
  id: string;
  postcode_prefix: string;
  name: string;
  status: TerritoryStatus;
  lat: number | null;
  lng: number | null;
  franchisee_id: string | null;
  updated_at: string | null;
  franchisee: { name: string; number: string } | null;
}

async function fetchTerritories(): Promise<TerritoryRow[]> {
  const { data, error } = await supabase
    .from('da_territories')
    .select(
      `id,
       postcode_prefix,
       name,
       status,
       lat,
       lng,
       franchisee_id,
       updated_at,
       franchisee:da_franchisees ( name, number )`,
    )
    .order('postcode_prefix', { ascending: true });

  if (error) {
    throw new Error(`useTerritories: ${error.message}`);
  }

  // PostgREST returns the embed as an array OR an object depending on the
  // join shape; we pulled it via the FK so it's a single object (or null).
  return ((data ?? []) as unknown as JoinedTerritory[]).map((row) => ({
    id: row.id,
    postcode_prefix: row.postcode_prefix,
    name: row.name,
    status: row.status,
    lat: row.lat,
    lng: row.lng,
    franchisee_id: row.franchisee_id,
    franchisee_name: row.franchisee?.name ?? null,
    franchisee_number: row.franchisee?.number ?? null,
    updated_at: row.updated_at,
  }));
}

export function useTerritories(): UseQueryResult<TerritoryRow[], Error> {
  return useQuery({
    queryKey: TERRITORIES_QUERY_KEY,
    queryFn: fetchTerritories,
  });
}

// ---------------------------------------------------------------------------
// useFranchiseesForAssignment
// ---------------------------------------------------------------------------

async function fetchFranchiseesForAssignment(): Promise<FranchiseeOption[]> {
  const { data, error } = await supabase
    .from('da_franchisees')
    .select('id, name, number')
    .eq('is_hq', false)
    .order('number', { ascending: true });

  if (error) {
    throw new Error(`useFranchiseesForAssignment: ${error.message}`);
  }
  return (data ?? []) as FranchiseeOption[];
}

export function useFranchiseesForAssignment(): UseQueryResult<FranchiseeOption[], Error> {
  return useQuery({
    queryKey: FRANCHISEE_OPTIONS_QUERY_KEY,
    queryFn: fetchFranchiseesForAssignment,
  });
}

// ---------------------------------------------------------------------------
// useAssignTerritory
// ---------------------------------------------------------------------------

export interface AssignTerritoryArgs {
  territory_id: string;
  franchisee_id: string | null;
  status?: TerritoryStatus;
}

export interface AssignTerritoryResponse {
  id: string;
  postcode_prefix: string;
  name: string;
  status: TerritoryStatus;
  lat: number | null;
  lng: number | null;
  franchisee_id: string | null;
  updated_at: string;
}

async function callAssignTerritory(args: AssignTerritoryArgs): Promise<AssignTerritoryResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error('You must be signed in to assign territories.');
  }

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/assign-territory`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(args),
  });

  if (!response.ok) {
    let message = `Assign failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // body wasn't JSON; keep the generic message.
    }
    throw new Error(message);
  }

  return (await response.json()) as AssignTerritoryResponse;
}

export function useAssignTerritory(): UseMutationResult<
  AssignTerritoryResponse,
  Error,
  AssignTerritoryArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: callAssignTerritory,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TERRITORIES_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
      void queryClient.invalidateQueries({ queryKey: ['hq', 'recent-activity'] });
      void queryClient.invalidateQueries({ queryKey: ['hq', 'network-stats'] });
    },
  });
}
