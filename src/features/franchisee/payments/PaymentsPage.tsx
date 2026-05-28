/**
 * /franchisee/payments — Stripe Connect / payments hub for the franchisee
 * portal (Wave 8A).
 *
 * This page is both the entry point and the Account Link return target.
 * App.tsx routes both `/franchisee/payments` and the Stripe `return_url` /
 * `refresh_url` back here; we inspect `?success` / `?refresh` (via
 * useSearchParams) and pass the state down to <StripeConnectCard>.
 *
 * `?success=1` — franchisee completed Stripe's hosted onboarding form.
 *   The card refetches connect status to pick up the webhook's stripe_connected
 *   flip (may be near-instant or take a few seconds for verification).
 * `?refresh=1` — the Account Link expired (single-use, ~5 min TTL).
 *   The card immediately re-issues a fresh link via create-account-link and
 *   redirects again.
 *
 * Test-mode banner: visible until stripe_connected is true, reminding
 * franchisees that no real money moves during the test phase.
 *
 * Wave 9A franchisee bookings will sit adjacent to this page; we leave
 * the layout open for that without pre-building any of it.
 */
import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/daisy';
import StripeConnectCard from './StripeConnectCard';
import { useConnectStatus } from './connectQueries';

export default function PaymentsPage() {
  const [searchParams] = useSearchParams();

  // Account Link return signalling.
  const returnState: 'success' | 'refresh' | null = searchParams.has('success')
    ? 'success'
    : searchParams.has('refresh')
      ? 'refresh'
      : null;

  // Read connect status so we can suppress the test banner once connected.
  const connectStatus = useConnectStatus();
  const isConnected = connectStatus.data?.charges_enabled ?? false;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Payments" subtitle="Connect Stripe and take card payments for courses." />

      {/* Test-mode notice — shown until charges_enabled flips true */}
      {!isConnected && !connectStatus.isLoading && (
        <div className="border-daisy-line rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-800">
            Test mode — Stripe is in test mode. No real money will move until the platform goes
            live.
          </p>
        </div>
      )}

      <StripeConnectCard returnState={returnState} />
    </div>
  );
}
