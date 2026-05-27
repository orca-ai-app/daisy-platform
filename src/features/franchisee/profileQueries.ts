/**
 * TanStack Query hooks for the franchisee self-service profile page (Wave 6B).
 *
 * Read: anon client + RLS (no franchisee_id filter needed).
 * Write: POST to update-franchisee-self Edge Function (service_role server-side).
 *
 * Key factory: franchiseeKeys from ./queryKeys (frozen contract).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Franchisee } from '@/types/franchisee';
import { franchiseeKeys } from './queryKeys';

const STALE_TIME = 5 * 60_000;

// ---------------------------------------------------------------------------
// Read: own profile row (RLS restricts to the signed-in franchisee's row).
// ---------------------------------------------------------------------------

export function useOwnProfile() {
  return useQuery<Franchisee | null>({
    queryKey: franchiseeKeys.profile(),
    staleTime: STALE_TIME,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.from('da_franchisees').select('*').maybeSingle();

      if (error) throw error;
      return (data as Franchisee | null) ?? null;
    },
  });
}

// ---------------------------------------------------------------------------
// Write: constrained self-update through the update-franchisee-self EF.
// Only name and phone are mutable from this surface — the server enforces
// the same whitelist; this type is a UI-layer hint, not the trust boundary.
// ---------------------------------------------------------------------------

export interface ProfileSelfUpdateFields {
  name?: string;
  phone?: string | null;
}

async function callUpdateFranchiseeSelf(fields: ProfileSelfUpdateFields): Promise<Franchisee> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error('You must be signed in to update your profile.');
  }

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-franchisee-self`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ fields }),
  });

  if (!response.ok) {
    let message = `Save failed (${response.status})`;
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

export function useUpdateOwnProfile() {
  const queryClient = useQueryClient();
  return useMutation<Franchisee, Error, ProfileSelfUpdateFields>({
    mutationFn: callUpdateFranchiseeSelf,
    onSuccess: (updated) => {
      // Update the cached profile row immediately so the form reflects the
      // saved state without a refetch round-trip.
      queryClient.setQueryData<Franchisee | null>(franchiseeKeys.profile(), updated);
      // Invalidate so background refetch brings in the true server state.
      void queryClient.invalidateQueries({ queryKey: franchiseeKeys.profile() });
    },
  });
}
