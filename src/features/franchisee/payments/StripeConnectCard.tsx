/**
 * <StripeConnectCard> — Stripe Connect via OAuth.
 *
 * Franchisees connect their OWN existing, standalone Stripe account with a
 * single sign-in — no new account, no KYC re-onboarding.
 *
 * States:
 *  1. Not connected: "Connect with Stripe" → calls stripe-oauth-start and
 *     redirects to the Stripe OAuth authorize URL.
 *  2. Connected: success state — masked account id, link to their Stripe
 *     dashboard, and a working Disconnect button (revokes OAuth access).
 *
 * After authorising, Stripe redirects to stripe-oauth-callback (server-side
 * token exchange), which then redirects back to /franchisee/payments?connected=1
 * (or ?stripe_error=…). PaymentsPage reads those params and passes them here.
 *
 * Tokens: Daisy CSS variables. Mutations: Edge Functions only. Toasts: sonner.
 */

import { useEffect } from 'react';
import { ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useConnectStatus, useStartStripeOAuth, useDisconnectStripe } from './connectQueries';
import { paymentKeys } from './queryKeys';
import { useQueryClient } from '@tanstack/react-query';

export interface StripeConnectCardProps {
  /** Optional pre-fetched status; the real component fetches its own if absent. */
  status?: import('./types').ConnectStatus;
  /**
   * Set when the franchisee has just returned from Stripe's OAuth flow via the
   * callback redirect. 'connected' → refetch status to reflect the new link.
   */
  returnState?: 'connected' | null;
  /** A `stripe_error` code from the callback redirect, surfaced as a toast. */
  oauthError?: string | null;
}

// Mask an acct_... id — keep the prefix and last 4 chars.
function maskAccountId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export default function StripeConnectCard({ returnState, oauthError }: StripeConnectCardProps) {
  const queryClient = useQueryClient();
  const connectStatus = useConnectStatus();
  const startOAuth = useStartStripeOAuth();
  const disconnect = useDisconnectStripe();

  const status = connectStatus.data;

  // -------------------------------------------------------------------------
  // Handle return from Stripe OAuth
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (returnState === 'connected') {
      void queryClient.invalidateQueries({ queryKey: paymentKeys.connectStatus() });
      toast.success('Stripe account connected.');
    }
    if (oauthError) {
      toast.error(`Could not connect Stripe: ${oauthError.replace(/_/g, ' ')}`);
    }
     
  }, [returnState, oauthError, queryClient]);

  // -------------------------------------------------------------------------
  // Action handlers
  // -------------------------------------------------------------------------
  function handleConnect() {
    startOAuth.mutate(undefined, {
      onSuccess: (res) => {
        window.location.assign(res.url);
      },
      onError: (err) => {
        toast.error(err.message ?? 'Could not start Stripe connection. Please try again.');
      },
    });
  }

  function handleDisconnect() {
    disconnect.mutate(undefined, {
      onSuccess: () => {
        toast.success('Stripe account disconnected.');
      },
      onError: (err) => {
        toast.error(err.message ?? 'Could not disconnect. Please try again.');
      },
    });
  }

  // -------------------------------------------------------------------------
  // Loading skeleton
  // -------------------------------------------------------------------------
  if (connectStatus.isLoading) {
    return (
      <div className="border-daisy-line bg-daisy-paper rounded-[12px] border p-6">
        <Skeleton className="mb-3 h-5 w-40" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="mt-5 h-9 w-36" />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Error fetching status
  // -------------------------------------------------------------------------
  if (connectStatus.isError) {
    return (
      <div className="border-daisy-line bg-daisy-paper rounded-[12px] border p-6">
        <h2 className="text-daisy-ink text-lg font-bold">Stripe payments</h2>
        <p className="text-daisy-muted mt-1 text-sm">
          Could not load payment status. Please refresh the page.
        </p>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // State 2: Connected
  // -------------------------------------------------------------------------
  if (status?.stripe_connected && status.stripe_account_id) {
    return (
      <div className="border-daisy-line bg-daisy-paper rounded-[12px] border p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-daisy-ink text-lg font-bold">Stripe payments</h2>
            <p className="text-daisy-muted mt-1 text-sm">
              Your Stripe account is connected. Payment links can be generated for private courses.
            </p>
          </div>
          <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-800">
            Connected
          </span>
        </div>

        <dl className="border-daisy-line mt-5 border-t pt-4">
          <div className="flex items-center gap-2">
            <dt className="text-daisy-muted text-xs font-bold tracking-[0.06em] uppercase">
              Account
            </dt>
            <dd className="text-daisy-ink font-mono text-sm">
              {maskAccountId(status.stripe_account_id)}
            </dd>
          </div>
        </dl>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <a
            href={`https://dashboard.stripe.com/${status.stripe_account_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-daisy-primary inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
          >
            Open Stripe dashboard
            <ExternalLink aria-hidden className="h-3.5 w-3.5" />
          </a>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleDisconnect}
            disabled={disconnect.isPending}
            className="text-daisy-muted text-sm"
          >
            {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // State 1: Not connected
  // -------------------------------------------------------------------------
  return (
    <div className="border-daisy-line bg-daisy-paper rounded-[12px] border p-6">
      <h2 className="text-daisy-ink text-lg font-bold">Stripe payments</h2>
      <p className="text-daisy-muted mt-1 text-sm">
        Connect your existing Stripe account to take card payments for private courses. Daisy takes
        a 2% platform fee; all other revenue settles directly to your bank.
      </p>

      <div className="mt-5">
        <Button onClick={handleConnect} disabled={startOAuth.isPending}>
          {startOAuth.isPending ? 'Connecting…' : 'Connect with Stripe'}
        </Button>
      </div>
    </div>
  );
}
