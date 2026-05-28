/**
 * ============================================================================
 * FROZEN CONTRACT — builders consume, do not redefine.
 * ============================================================================
 *
 * Wave 8 SCAFFOLD owns this file. Build agents 8A (Connect onboarding via
 * Account Links), 8B (Payment Link generation) and 8C (Stripe webhook) import
 * these types and MUST NOT declare parallel shapes for the same concepts. If a
 * new field is genuinely needed, raise it back to the scaffold owner rather
 * than widening the type locally.
 *
 * ARCHITECTURE (locked at M2 kick-off — see DECISIONS.md "Locked at M2
 * kick-off" + docs/M2-build-plan.md §3):
 *
 *   - Standard Connect. Each franchisee owns a full Stripe dashboard (refunds,
 *     payouts, disputes). Daisy HQ takes a 2% application fee.
 *   - Account Links, NOT OAuth. The `create-connect-account` Edge Function
 *     creates the connected account via the Accounts API
 *     (`stripe.accounts.create({ type: 'standard' })`), persists the resulting
 *     `acct_…` id on da_franchisees.stripe_account_id, then generates an
 *     `account_onboarding` Account Link and returns its URL for a redirect.
 *     There is NO STRIPE_CONNECT_CLIENT_ID and NO redirect-URI allowlist.
 *   - Connection status is the source-of-truth `account.updated` webhook (8C),
 *     which flips da_franchisees.stripe_connected when `charges_enabled`
 *     becomes true. The UI reads the persisted flag; it does not poll Stripe.
 *   - Direct charges. Payment Links are created ON the connected account
 *     (`{ stripeAccount: franchisee.stripe_account_id }`) with
 *     `application_fee_amount = Math.floor(price_pence * PLATFORM_FEE_PERCENT / 100)`
 *     (PLATFORM_FEE_PERCENT = 2). Money settles to the franchisee directly; the
 *     platform only ever receives the 2% fee.
 *   - Booking rows are NEVER created on Payment Link generation. They are
 *     created by the `checkout.session.completed` webhook branch (8C) only.
 *
 * MONEY: integer pence everywhere. Format with `formatPence` (src/lib/format).
 * Never put raw numbers in the UI.
 *
 * EDGE FUNCTION SECRETS (state of play at Wave 8 kick-off):
 *   - STRIPE_SECRET_KEY (test) — SET. 8A/8B/8C read it from Deno.env.
 *   - STRIPE_WEBHOOK_SECRET — NOT yet set (the webhook endpoint has not been
 *     registered in Stripe). 8C MUST read it from `Deno.env.get('STRIPE_WEBHOOK_SECRET')`
 *     and fail closed (500) if absent; the live signature-verification test is
 *     gated on this secret landing.
 *   - PLATFORM_FEE_PERCENT — 2.
 */

import type { Franchisee } from '@/types/franchisee';

// ---------------------------------------------------------------------------
// Connect status — the slice of da_franchisees the Payments page reads, plus
// the two live-from-Stripe flags the account.updated webhook (8C) keeps in
// sync. `charges_enabled` / `details_submitted` are NOT separate DB columns in
// M2: the webhook collapses them onto `stripe_connected` (true once charges are
// enabled). They are surfaced here so 8A can show a finer-grained status while
// onboarding is mid-flight (e.g. "details submitted, pending verification").
// ---------------------------------------------------------------------------

/**
 * Connection status for the signed-in franchisee, as consumed by
 * <StripeConnectCard> (8A). Derived from the da_franchisees row (anon read +
 * RLS); `charges_enabled` / `details_submitted` mirror the connected account's
 * Stripe state as last synced by the account.updated webhook.
 */
export interface ConnectStatus {
  /** da_franchisees.stripe_account_id — the connected account id (`acct_…`) or null. */
  stripe_account_id: string | null;
  /** da_franchisees.stripe_connected — true once the account can take charges. */
  stripe_connected: boolean;
  /**
   * Stripe `account.charges_enabled`. In M2 this is the same signal that flips
   * `stripe_connected`; exposed separately so the UI can distinguish
   * "connected and charging" from "account created but not yet enabled".
   */
  charges_enabled: boolean;
  /**
   * Stripe `account.details_submitted`. True once the franchisee has finished
   * the hosted onboarding form (may still be pending verification before
   * charges_enabled flips true).
   */
  details_submitted: boolean;
}

/**
 * Map a da_franchisees row to the UI ConnectStatus. In M2 the only persisted
 * truth is `stripe_account_id` + `stripe_connected`; `charges_enabled` is
 * treated as equal to `stripe_connected`, and `details_submitted` is true once
 * an account id exists (onboarding cannot complete without submission). 8C may
 * later persist finer-grained columns; if so, update this mapper, not callers.
 */
export function toConnectStatus(
  row: Pick<Franchisee, 'stripe_account_id' | 'stripe_connected'> | null,
): ConnectStatus {
  return {
    stripe_account_id: row?.stripe_account_id ?? null,
    stripe_connected: row?.stripe_connected ?? false,
    charges_enabled: row?.stripe_connected ?? false,
    details_submitted: Boolean(row?.stripe_account_id),
  };
}

// ---------------------------------------------------------------------------
// create-connect-account — Edge Function I/O contract (8A builds the function)
// ---------------------------------------------------------------------------
//
// POST (auth: franchisee JWT; no body required).
// The function:
//   1. Resolves the caller's franchisee row from JWT sub → auth_user_id.
//   2. If stripe_account_id is null, creates a Standard connected account
//      (`stripe.accounts.create({ type: 'standard', email })`) and persists the
//      `acct_…` id on da_franchisees.stripe_account_id (service_role write).
//   3. Generates an `account_onboarding` Account Link for that account and
//      returns its hosted-onboarding `url` so the client can redirect.
//   4. Inserts a da_activities row (action='stripe_connect_started').
//
// The client treats this as "start onboarding": call it, then
// `window.location.assign(res.url)`.
// ---------------------------------------------------------------------------

/** Request body for create-connect-account. No fields — caller identified by JWT. */
export type CreateConnectAccountRequest = Record<string, never>;

/** 2xx success body for create-connect-account. */
export interface CreateConnectAccountResponse {
  /** The connected account id (`acct_…`) created or already on file. */
  stripe_account_id: string;
  /** Hosted Account Link onboarding URL — redirect the franchisee here. */
  url: string;
}

// ---------------------------------------------------------------------------
// create-account-link — Edge Function I/O contract (8A builds the function)
// ---------------------------------------------------------------------------
//
// POST (auth: franchisee JWT; no body required).
// Re-issues a fresh `account_onboarding` Account Link for the caller's EXISTING
// connected account. Used when the franchisee returns via the `?refresh` return
// route (Account Links are single-use and short-lived) or wants to resume an
// incomplete onboarding. Fails 409 if the franchisee has no stripe_account_id
// yet (call create-connect-account first).
// ---------------------------------------------------------------------------

/** Request body for create-account-link. No fields — caller identified by JWT. */
export type CreateAccountLinkRequest = Record<string, never>;

/** 2xx success body for create-account-link. */
export interface CreateAccountLinkResponse {
  /** Fresh hosted Account Link onboarding URL — redirect the franchisee here. */
  url: string;
}

// ---------------------------------------------------------------------------
// create-payment-link — Edge Function I/O contract (8B builds the function)
// ---------------------------------------------------------------------------
//
// POST { course_instance_id, ticket_type_id, quantity } (auth: franchisee JWT).
// The function:
//   1. Resolves the caller's franchisee row; verifies the course instance
//      belongs to them and the franchisee is stripe_connected.
//   2. Resolves the ticket type (price_pence) under that instance.
//   3. Creates a Payment Link ON the connected account
//      (`stripe.paymentLinks.create({ … }, { stripeAccount: franchisee.stripe_account_id })`)
//      with `application_fee_amount = Math.floor(ticket.price_pence * 2 / 100)`
//      and metadata { course_instance_id, ticket_type_id, franchisee_id } so the
//      webhook (8C) can reconcile the resulting checkout.session.completed.
//   4. Persists the URL on da_course_instances.stripe_payment_link and stamps
//      da_course_instances.payment_link_created_at (migration 019).
//   5. Inserts a da_activities row (action='payment_link_created').
//   6. Returns { payment_link_url }.
//
// NB: generating a Payment Link does NOT create a booking row.
// ---------------------------------------------------------------------------

/** Request body for create-payment-link. `quantity` is the number of tickets. */
export interface CreatePaymentLinkRequest {
  course_instance_id: string;
  ticket_type_id: string;
  quantity: number;
}

/** 2xx success body for create-payment-link. */
export interface CreatePaymentLinkResponse {
  /** The Stripe-hosted Payment Link URL, also persisted on the instance row. */
  payment_link_url: string;
}

// ---------------------------------------------------------------------------
// Shared error body for all Wave 8 payment Edge Functions.
// ---------------------------------------------------------------------------

/** Generic error body shared by all payment/Connect Edge Functions. */
export interface PaymentEdgeErrorResponse {
  error: string;
}
