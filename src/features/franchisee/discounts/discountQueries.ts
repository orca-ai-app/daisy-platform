/**
 * TanStack Query hooks for the franchisee discount-code surface (Wave 9B).
 *
 * Read:  anon client + RLS policy `franchisee_own` (migration 010). No
 *        client-side franchisee_id filter is needed — RLS scopes the rows.
 * Write: POST to create-discount-code / update-discount-code Edge Functions
 *        (service_role server-side, franchisee_id stamped from JWT).
 *
 * Key factory: franchiseeKeys from ../queryKeys (frozen contract).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { franchiseeKeys } from '../queryKeys';
import type { DiscountCode, CreateDiscountCodePayload, UpdateDiscountCodePayload } from './types';

const STALE_TIME = 2 * 60_000;

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Returns all discount codes owned by the signed-in franchisee.
 * RLS on da_discount_codes filters to rows where franchisee_id matches the
 * caller — no client-side .eq() filter required.
 */
export function useOwnDiscountCodes() {
  return useQuery<DiscountCode[]>({
    queryKey: franchiseeKeys.discounts(),
    staleTime: STALE_TIME,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_discount_codes')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as DiscountCode[];
    },
  });
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

async function callEdgeFunction<TResult>(path: string, payload: unknown): Promise<TResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error('You must be signed in to manage discount codes.');
  }

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
    if (requestId) (err as Error & { request_id?: string }).request_id = requestId;
    throw err;
  }

  return (await response.json()) as TResult;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export function useCreateDiscountCode() {
  const queryClient = useQueryClient();
  return useMutation<DiscountCode, Error, CreateDiscountCodePayload>({
    mutationFn: (payload) => callEdgeFunction<DiscountCode>('create-discount-code', payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: franchiseeKeys.discounts() });
    },
  });
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export function useUpdateDiscountCode() {
  const queryClient = useQueryClient();
  return useMutation<DiscountCode, Error, UpdateDiscountCodePayload>({
    mutationFn: (payload) => callEdgeFunction<DiscountCode>('update-discount-code', payload),
    onSuccess: (updated) => {
      // Punch the updated row into the list cache immediately so the
      // table reflects the change before the invalidation refetch lands.
      queryClient.setQueryData<DiscountCode[]>(franchiseeKeys.discounts(), (prev) =>
        prev ? prev.map((c) => (c.id === updated.id ? updated : c)) : [updated],
      );
      void queryClient.invalidateQueries({ queryKey: franchiseeKeys.discounts() });
      void queryClient.invalidateQueries({ queryKey: franchiseeKeys.discount(updated.id) });
    },
  });
}
