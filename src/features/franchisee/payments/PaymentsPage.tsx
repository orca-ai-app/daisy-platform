/**
 * /franchisee/payments — Stripe Connect / payments hub for the franchisee
 * portal.
 *
 * This page is both the entry point and the OAuth return target. The
 * stripe-oauth-callback Edge Function redirects the franchisee back here after
 * the token exchange; we inspect `?connected` / `?stripe_error` (via
 * useSearchParams) and pass the state down to <StripeConnectCard>.
 *
 * `?connected=1`     — OAuth succeeded; the card refetches connect status.
 * `?stripe_error=…`  — OAuth failed or was declined; the card shows a toast.
 *
 * Test-mode banner: visible until stripe_connected is true, reminding
 * franchisees that no real money moves during the test phase.
 */
import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/daisy';
import StripeConnectCard from './StripeConnectCard';
import { useConnectStatus } from './connectQueries';

export default function PaymentsPage() {
  const [searchParams] = useSearchParams();

  // OAuth return signalling.
  const returnState: 'connected' | null = searchParams.has('connected') ? 'connected' : null;
  const oauthError = searchParams.get('stripe_error');

  // Read connect status so we can suppress the test banner once connected.
  const connectStatus = useConnectStatus();
  const isConnected = connectStatus.data?.stripe_connected ?? false;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Payments" subtitle="Connect Stripe and take card payments for courses." />

      {/* Test-mode notice — shown until stripe_connected flips true */}
      {!isConnected && !connectStatus.isLoading && (
        <div className="border-daisy-line rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-800">
            Test mode — Stripe is in test mode. No real money will move until the platform goes
            live.
          </p>
        </div>
      )}

      <StripeConnectCard returnState={returnState} oauthError={oauthError} />
    </div>
  );
}
