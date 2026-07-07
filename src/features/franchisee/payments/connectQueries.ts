/**
 * TanStack Query hooks for Stripe Connect (OAuth model).
 *
 * Read:  anon client + RLS — the signed-in franchisee's own da_franchisees row.
 *        No client-side franchisee_id filter needed; RLS scopes the single row.
 * Write: POST to stripe-oauth-start / stripe-disconnect Edge Functions
 *        (service_role server-side, franchisee resolved from JWT).
 *
 * Connect model: franchisees connect their OWN existing standalone Stripe
 * account via OAuth (no account creation, no re-onboarding). stripe-oauth-start
 * returns the authorize URL; the franchisee is redirected to Stripe, authorises,
 * and Stripe redirects to stripe-oauth-callback which persists their acct_… id.
 *
 * Key factory: paymentKeys from ./queryKeys.
 * Types:       ConnectStatus, toConnectStatus from ./types.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ConnectStatus, StripeOAuthStartResponse, DisconnectResponse } from './types';
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
// useStartStripeOAuth — returns the Stripe Connect OAuth authorize URL for the
// signed-in franchisee. The caller should window.location.assign(res.url) so
// the franchisee can sign into their existing Stripe account and authorise.
// ---------------------------------------------------------------------------

export function useStartStripeOAuth() {
  return useMutation<StripeOAuthStartResponse, Error>({
    mutationFn: () => callPaymentEdgeFunction<StripeOAuthStartResponse>('stripe-oauth-start'),
  });
}

// ---------------------------------------------------------------------------
// useDisconnectStripe — revokes Daisy's OAuth access to the franchisee's Stripe
// account and clears the local link. Refetches connect status on success.
// ---------------------------------------------------------------------------

export function useDisconnectStripe() {
  const queryClient = useQueryClient();
  return useMutation<DisconnectResponse, Error>({
    mutationFn: () => callPaymentEdgeFunction<DisconnectResponse>('stripe-disconnect'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: paymentKeys.connectStatus() });
    },
  });
}
