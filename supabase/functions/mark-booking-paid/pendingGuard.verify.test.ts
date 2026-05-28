/**
 * Wave 9A VERIFIER peer test — mark-booking-paid pending-only state guard.
 *
 * The state-guard branch lives inline in the Deno handler
 * (mark-booking-paid/index.ts lines 177-197) and is not importable, so this
 * test re-implements the *exact* documented contract as a small pure helper
 * and pins its behaviour:
 *
 *   - Only a booking whose current payment_status === 'pending' may be marked
 *     paid. Every other status (paid / manual / refunded / failed) → 409.
 *   - The successful transition sets payment_status to the literal 'manual'
 *     (never 'paid' — the franchisee is recording an out-of-band payment).
 *   - The new status is server-resolved; the caller never supplies it.
 *
 * If the source guard changes, this helper must change in lock-step — it
 * exists to pin the contract, not to import the Deno handler.
 */

import { describe, it, expect } from 'vitest';

// The five values the da_bookings.payment_status CHECK constraint allows
// (migration 003, lines 55-56).
type PaymentStatus = 'pending' | 'paid' | 'refunded' | 'failed' | 'manual';

interface GuardResult {
  status: number;
  newPaymentStatus?: PaymentStatus;
  error?: string;
}

/**
 * Mirrors mark-booking-paid/index.ts lines 177-197: the pending-only guard
 * plus the update that sets payment_status='manual'.
 */
function markPaidGuard(current: PaymentStatus): GuardResult {
  if (current !== 'pending') {
    return {
      status: 409,
      error: `Booking cannot be marked as paid — current payment_status is '${current}'. Only 'pending' bookings may be marked paid.`,
    };
  }
  return { status: 200, newPaymentStatus: 'manual' };
}

const ALL_STATUSES: PaymentStatus[] = ['pending', 'paid', 'refunded', 'failed', 'manual'];

describe('mark-booking-paid: only pending bookings transition', () => {
  it('pending → 200 and payment_status becomes "manual"', () => {
    const result = markPaidGuard('pending');
    expect(result.status).toBe(200);
    expect(result.newPaymentStatus).toBe('manual');
  });

  it('sets the literal "manual", never "paid" (manual = out-of-band payment)', () => {
    const result = markPaidGuard('pending');
    expect(result.newPaymentStatus).toBe('manual');
    expect(result.newPaymentStatus).not.toBe('paid');
  });

  it.each(['paid', 'manual', 'refunded', 'failed'] as PaymentStatus[])(
    'non-pending status "%s" → 409 with no transition',
    (current) => {
      const result = markPaidGuard(current);
      expect(result.status).toBe(409);
      expect(result.newPaymentStatus).toBeUndefined();
    },
  );

  it('exactly one of the five allowed statuses transitions', () => {
    const transitioning = ALL_STATUSES.filter((s) => markPaidGuard(s).status === 200);
    expect(transitioning).toEqual(['pending']);
  });

  it('the 409 message names the blocking status (operator-facing clarity)', () => {
    const result = markPaidGuard('refunded');
    expect(result.error).toContain("'refunded'");
    expect(result.error).toContain('Only');
  });

  it('an already-manual booking cannot be re-marked (no double-stamp)', () => {
    expect(markPaidGuard('manual').status).toBe(409);
  });
});
