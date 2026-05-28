/**
 * <StripeConnectCard> — Stripe Connect onboarding card (Wave 8A).
 *
 * States:
 *  1. No stripe_account_id: "Connect with Stripe" button — calls
 *     create-connect-account then redirects to the Account Link URL.
 *  2. Account created but not charges_enabled: "Finish setting up" button —
 *     calls create-account-link for a fresh link and redirects.
 *  3. charges_enabled: success state — masked account id, charges badge,
 *     link to the franchisee's Stripe dashboard, disabled disconnect button.
 *
 * Returns from Stripe's hosted onboarding land back on /franchisee/payments
 * with ?success or ?refresh (see PaymentsPage). The parent reads those params
 * and passes them as `returnState` so this card can react appropriately.
 *
 * Tokens: Daisy CSS variables. Mutations: Edge Functions only. Toasts: sonner.
 */

import { useEffect } from 'react';
import { ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useConnectStatus, useCreateConnectAccount, useCreateAccountLink } from './connectQueries';
import { paymentKeys } from './queryKeys';
import { useQueryClient } from '@tanstack/react-query';

export interface StripeConnectCardProps {
  /** Optional pre-fetched status; the real component fetches its own if absent. */
  status?: import('./types').ConnectStatus;
  /**
   * Set when the franchisee has just returned from Stripe's hosted onboarding
   * via the Account Link return_url (App.tsx reads ?success / ?refresh).
   * 'success' → refetch status.
   * 'refresh' → re-issue a fresh Account Link immediately.
   */
  returnState?: 'success' | 'refresh' | null;
}

// Mask an acct_... id — keep the prefix and last 4 chars.
function maskAccountId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export default function StripeConnectCard({ returnState }: StripeConnectCardProps) {
  const queryClient = useQueryClient();
  const connectStatus = useConnectStatus();
  const createAccount = useCreateConnectAccount();
  const createLink = useCreateAccountLink();

  const status = connectStatus.data;

  // -------------------------------------------------------------------------
  // Handle return from Stripe hosted onboarding
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (returnState === 'success') {
      // Force a fresh fetch so the card reflects the latest stripe_connected state.
      void queryClient.invalidateQueries({ queryKey: paymentKeys.connectStatus() });
    }

    if (returnState === 'refresh') {
      // The Account Link expired — re-issue one immediately so the franchisee
      // doesn't have to click again. This only makes sense if there's an
      // existing stripe_account_id; the effect runs after the query resolves.
      if (status?.stripe_account_id) {
        createLink.mutate(undefined, {
          onSuccess: (res) => {
            window.location.assign(res.url);
          },
          onError: (err) => {
            toast.error(err.message ?? 'Could not resume onboarding. Please try again.');
          },
        });
      }
    }
    // We deliberately exclude createLink and status from deps to avoid
    // re-running when the mutation object reference changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnState, queryClient]);

  // -------------------------------------------------------------------------
  // Action handlers
  // -------------------------------------------------------------------------

  function handleConnect() {
    createAccount.mutate(undefined, {
      onSuccess: (res) => {
        window.location.assign(res.url);
      },
      onError: (err) => {
        toast.error(err.message ?? 'Could not start Stripe onboarding. Please try again.');
      },
    });
  }

  function handleResumeOnboarding() {
    createLink.mutate(undefined, {
      onSuccess: (res) => {
        window.location.assign(res.url);
      },
      onError: (err) => {
        toast.error(err.message ?? 'Could not resume onboarding. Please try again.');
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

  const isMutating = createAccount.isPending || createLink.isPending;

  // -------------------------------------------------------------------------
  // State 3: Connected and charges enabled
  // -------------------------------------------------------------------------
  if (status?.charges_enabled && status.stripe_account_id) {
    return (
      <div className="border-daisy-line bg-daisy-paper rounded-[12px] border p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-daisy-ink text-lg font-bold">Stripe payments</h2>
            <p className="text-daisy-muted mt-1 text-sm">
              Your Stripe account is connected. Payment links can be generated for private courses.
            </p>
          </div>
          {/* Charges enabled badge */}
          <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-800">
            Charges enabled
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

        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href={`https://dashboard.stripe.com/${status.stripe_account_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-daisy-primary inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
          >
            Open Stripe dashboard
            <ExternalLink aria-hidden className="h-3.5 w-3.5" />
          </a>

          {/* Disconnect is Phase 2 — rendered disabled so franchisees can see it */}
          <Button
            variant="ghost"
            size="sm"
            disabled
            title="Disconnecting your Stripe account is available in a later release."
            className="text-daisy-muted cursor-not-allowed text-sm"
          >
            Disconnect
          </Button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // State 2: Account created but not yet charges_enabled (mid-onboarding)
  // -------------------------------------------------------------------------
  if (status?.stripe_account_id && !status.charges_enabled) {
    return (
      <div className="border-daisy-line bg-daisy-paper rounded-[12px] border p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-daisy-ink text-lg font-bold">Stripe payments</h2>
            <p className="text-daisy-muted mt-1 text-sm">
              Your Stripe account has been created. Complete the setup to start taking payments.
            </p>
          </div>
          {/* Pending badge */}
          <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
            {status.details_submitted ? 'Pending verification' : 'Setup incomplete'}
          </span>
        </div>

        <div className="mt-5">
          <Button onClick={handleResumeOnboarding} disabled={isMutating}>
            {createLink.isPending ? 'Opening Stripe...' : 'Finish setting up'}
          </Button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // State 1: Not connected — no stripe_account_id
  // -------------------------------------------------------------------------
  return (
    <div className="border-daisy-line bg-daisy-paper rounded-[12px] border p-6">
      <h2 className="text-daisy-ink text-lg font-bold">Stripe payments</h2>
      <p className="text-daisy-muted mt-1 text-sm">
        Connect your Stripe account to take card payments for private courses. Daisy takes a 2%
        platform fee; all other revenue settles directly to your bank.
      </p>

      <div className="mt-5">
        <Button onClick={handleConnect} disabled={isMutating}>
          {createAccount.isPending ? 'Connecting...' : 'Connect with Stripe'}
        </Button>
      </div>
    </div>
  );
}
