/**
 * ============================================================================
 * FROZEN CONTRACT — Wave 8 SCAFFOLD. Builders consume, do not redefine.
 * ============================================================================
 *
 * Payment / Connect query keys for the franchisee portal. These extend the
 * frozen `franchiseeKeys.payments()` root from ../queryKeys so every payment
 * key still lives under `['franchisee', 'payments', …]` and invalidates
 * cleanly alongside the rest of the franchisee cache.
 *
 * 8A (connect status) and 8B (payment-link mutation, invalidating the course
 * cache) import these; do not hand-roll parallel string tuples.
 */
import { franchiseeKeys } from '../queryKeys';

export const paymentKeys = {
  /** Root — `['franchisee', 'payments']`. Invalidate to blow away all payment state. */
  all: () => franchiseeKeys.payments(),

  /**
   * The signed-in franchisee's Stripe Connect status (8A). Read via the anon
   * client + RLS off the da_franchisees row, mapped through `toConnectStatus`.
   */
  connectStatus: () => [...franchiseeKeys.payments(), 'connect-status'] as const,
} as const;
