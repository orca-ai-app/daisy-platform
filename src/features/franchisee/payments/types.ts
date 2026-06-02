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
 *   - OAuth, NOT Account Links (revised 2026-06 — supersedes the M2 kick-off
 *     decision). Franchisees already own standalone, fully-verified Stripe
 *     accounts, so we must CONNECT an existing account, not create a new one.
 *     `stripe-oauth-start` returns a connect.stripe.com/oauth/authorize URL
 *     (scope=read_write); the franchisee signs into their existing account and
 *     authorises; Stripe redirects to `stripe-oauth-callback`, which exchanges
 *     the code for `stripe_user_id` (their acct_… id) and persists it on
 *     da_franchisees.stripe_account_id with stripe_connected=true. This needs
 *     STRIPE_CONNECT_CLIENT_ID and a redirect-URI allowlist entry. (The old
 *     Account-Links flow forced full KYC re-onboarding — wrong for our users.)
 *   - Connection status: set true by the OAuth callback (a standalone account
 *     is already charges-enabled). `account.updated` keeps it in sync and
 *     `account.application.deauthorized` clears it. The UI reads the persisted
 *     flag; it does not poll Stripe.
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
// stripe-oauth-start — Edge Function I/O contract (OAuth connect)
// ---------------------------------------------------------------------------
//
// POST (auth: franchisee JWT; no body required).
// Returns a connect.stripe.com/oauth/authorize URL (scope=read_write) with an
// HMAC-signed `state` carrying the franchisee id. The client redirects the
// franchisee there to sign into their EXISTING Stripe account and authorise.
// Stripe then redirects to stripe-oauth-callback, which exchanges the code and
// persists the franchisee's acct_… id.
//
// The client treats this as "start connect": call it, then
// `window.location.assign(res.url)`.
// ---------------------------------------------------------------------------

/** Request body for stripe-oauth-start. No fields — caller identified by JWT. */
export type StripeOAuthStartRequest = Record<string, never>;

/** 2xx success body for stripe-oauth-start. */
export interface StripeOAuthStartResponse {
  /** Stripe OAuth authorize URL — redirect the franchisee here. */
  url: string;
}

// ---------------------------------------------------------------------------
// stripe-disconnect — Edge Function I/O contract (OAuth deauthorize)
// ---------------------------------------------------------------------------
//
// POST (auth: franchisee JWT; no body required).
// Revokes Daisy's OAuth access (connect.stripe.com/oauth/deauthorize) and
// clears da_franchisees.stripe_account_id / stripe_connected. The franchisee's
// own Stripe account is untouched; only the platform link is removed.
// ---------------------------------------------------------------------------

/** Request body for stripe-disconnect. No fields — caller identified by JWT. */
export type DisconnectRequest = Record<string, never>;

/** 2xx success body for stripe-disconnect. */
export interface DisconnectResponse {
  disconnected: true;
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
