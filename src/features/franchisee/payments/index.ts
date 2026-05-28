/**
 * Barrel for the franchisee payments / Stripe Connect feature (Wave 8).
 *
 * Scaffold exports the page + card stubs and re-exports the frozen contract so
 * builders import everything from one place. 8A/8B add their query hooks
 * (e.g. a future `paymentQueries.ts`) here as they land.
 */
export { default as PaymentsPage } from './PaymentsPage';
export { default as StripeConnectCard } from './StripeConnectCard';
export type { StripeConnectCardProps } from './StripeConnectCard';

export { paymentKeys } from './queryKeys';

export type {
  ConnectStatus,
  CreateConnectAccountRequest,
  CreateConnectAccountResponse,
  CreateAccountLinkRequest,
  CreateAccountLinkResponse,
  CreatePaymentLinkRequest,
  CreatePaymentLinkResponse,
  PaymentEdgeErrorResponse,
} from './types';
export { toConnectStatus } from './types';
