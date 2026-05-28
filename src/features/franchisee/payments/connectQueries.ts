/**
 * TanStack Query hooks for Stripe Connect onboarding (Wave 8A).
 *
 * Read:  anon client + RLS — the signed-in franchisee's own da_franchisees row.
 *        No client-side franchisee_id filter needed; RLS scopes the single row.
 * Write: POST to create-connect-account / create-account-link Edge Functions
 *        (service_role server-side, franchisee resolved from JWT).
 *
 * Key factory: paymentKeys from ./queryKeys (frozen contract).
 * Types:       ConnectStatus, toConnectStatus from ./types (frozen contract).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type {
  ConnectStatus,
  CreateConnectAccountResponse,
  CreateAccountLinkResponse,
} from './types';
import { toConnectStatus } from './types';
import { paymentKeys } from './queryKeys';

const STALE_TIME = 30_000; // 30 s — status can change after a Stripe redirect

// ---------------------------------------------------------------------------
// Shared Edge Function caller
// ---------------------------------------------------------------------------

async function callPaymentEdgeFunction<TResult>(path: string): Promise<TResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error('You must be signed in to manage payments.');
  }

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    // No body required — caller is identified by JWT
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // body wasn't JSON
    }
    throw new Error(message);
  }

  return (await response.json()) as TResult;
}

// ---------------------------------------------------------------------------
// useConnectStatus — reads the signed-in franchisee's da_franchisees row and
// maps it through toConnectStatus. RLS scopes the result to the caller's row.
// ---------------------------------------------------------------------------

export function useConnectStatus() {
  return useQuery<ConnectStatus>({
    queryKey: paymentKeys.connectStatus(),
    staleTime: STALE_TIME,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('da_franchisees')
        .select('stripe_account_id, stripe_connected')
        .maybeSingle();

      if (error) throw error;
      return toConnectStatus(
        data as { stripe_account_id: string | null; stripe_connected: boolean } | null,
      );
    },
  });
}

// ---------------------------------------------------------------------------
// useCreateConnectAccount — creates a Standard connected account (if needed)
// and returns the account id + a hosted Account Link onboarding URL.
// The caller should window.location.assign(res.url) on success.
// ---------------------------------------------------------------------------

export function useCreateConnectAccount() {
  const queryClient = useQueryClient();
  return useMutation<CreateConnectAccountResponse, Error>({
    mutationFn: () =>
      callPaymentEdgeFunction<CreateConnectAccountResponse>('create-connect-account'),
    onSuccess: () => {
      // Invalidate connect status so it refetches when the franchisee returns
      // from Stripe's hosted onboarding via the Account Link return_url.
      void queryClient.invalidateQueries({ queryKey: paymentKeys.connectStatus() });
    },
  });
}

// ---------------------------------------------------------------------------
// useCreateAccountLink — re-issues a fresh account_onboarding Account Link
// for an existing connected account. Used when the link has expired
// (franchisee returned via ?refresh) or they want to resume onboarding.
// ---------------------------------------------------------------------------

export function useCreateAccountLink() {
  return useMutation<CreateAccountLinkResponse, Error>({
    mutationFn: () => callPaymentEdgeFunction<CreateAccountLinkResponse>('create-account-link'),
  });
}
