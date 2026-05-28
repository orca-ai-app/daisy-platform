/**
 * Wave 9A VERIFIER peer test — cancel-booking refund-flag recording + guards.
 *
 * The cancel logic lives inline in the Deno handler (cancel-booking/index.ts
 * lines 140-210) and is not importable, so this test re-implements the *exact*
 * documented contract as pure helpers and pins their behaviour:
 *
 *   - refund_amount_pence is a RECORD-ONLY flag. The function never calls
 *     Stripe; it only stamps the value so HQ can reconcile what was owed.
 *   - refund_amount_pence is only written when supplied AND strictly > 0.
 *     Zero / omitted leave the DB default (0) untouched (no key in the update).
 *   - A negative or non-integer refund is rejected (400) before any update.
 *   - Cancellation always sets booking_status='cancelled' + cancellation_reason.
 *   - An already-cancelled booking is rejected with 409 (not idempotent — a
 *     re-cancel could silently overwrite an existing reason/refund record).
 *
 * If the source logic changes, these helpers must change in lock-step — they
 * exist to pin the contract, not to import the Deno handler.
 */

import { describe, it, expect } from 'vitest';

type BookingStatus = 'confirmed' | 'attended' | 'no_show' | 'cancelled';

// Mirrors the refund validation — index.ts lines 140-154.
function validateRefund(input: unknown): { ok: true; value: number | null } | { ok: false } {
  if (input === undefined || input === null) return { ok: true, value: null };
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 0) {
    return { ok: false };
  }
  return { ok: true, value: input };
}

// Mirrors the update-payload builder — index.ts lines 200-210.
function buildCancelPayload(
  cancellationReason: string,
  refundAmountPence: number | null,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    booking_status: 'cancelled',
    cancellation_reason: cancellationReason,
  };
  // Only stamp refund_amount_pence when a positive value is supplied.
  if (refundAmountPence !== null && refundAmountPence > 0) {
    payload.refund_amount_pence = refundAmountPence;
  }
  return payload;
}

// Mirrors the already-cancelled state guard — index.ts lines 193-195.
function cancelStateGuard(current: BookingStatus): { status: number } {
  if (current === 'cancelled') return { status: 409 };
  return { status: 200 };
}

describe('cancel-booking: refund flag is record-only', () => {
  it('a positive refund is stamped onto the update payload', () => {
    const payload = buildCancelPayload('Customer requested', 2500);
    expect(payload.refund_amount_pence).toBe(2500);
  });

  it('refund of 0 is NOT written (leaves DB default of 0 untouched)', () => {
    const payload = buildCancelPayload('No refund owed', 0);
    expect('refund_amount_pence' in payload).toBe(false);
  });

  it('omitted refund (null) is NOT written', () => {
    const payload = buildCancelPayload('No refund owed', null);
    expect('refund_amount_pence' in payload).toBe(false);
  });

  it('the payload never contains a Stripe instruction — it is a flag, not a refund', () => {
    const payload = buildCancelPayload('Customer requested', 2500);
    const keys = Object.keys(payload);
    expect(keys).toEqual(['booking_status', 'cancellation_reason', 'refund_amount_pence']);
    // No stripe_* / refund_id / charge keys leak in.
    expect(keys.some((k) => k.toLowerCase().includes('stripe'))).toBe(false);
    expect(keys.some((k) => k.toLowerCase().includes('charge'))).toBe(false);
  });
});

describe('cancel-booking: refund validation', () => {
  it('a negative refund is rejected', () => {
    expect(validateRefund(-100).ok).toBe(false);
  });

  it('a fractional refund is rejected (pence are integers)', () => {
    expect(validateRefund(12.5).ok).toBe(false);
  });

  it('a non-numeric refund is rejected', () => {
    expect(validateRefund('2500').ok).toBe(false);
  });

  it('a valid positive integer passes', () => {
    expect(validateRefund(2500)).toEqual({ ok: true, value: 2500 });
  });

  it('zero passes validation (treated as "no refund flagged")', () => {
    expect(validateRefund(0)).toEqual({ ok: true, value: 0 });
  });

  it('omitted (undefined) passes as null', () => {
    expect(validateRefund(undefined)).toEqual({ ok: true, value: null });
  });
});

describe('cancel-booking: status + reason always set', () => {
  it('booking_status is always cancelled and reason is recorded', () => {
    const payload = buildCancelPayload('Course rescheduled', null);
    expect(payload.booking_status).toBe('cancelled');
    expect(payload.cancellation_reason).toBe('Course rescheduled');
  });
});

describe('cancel-booking: already-cancelled guard', () => {
  it('cancelling an already-cancelled booking → 409', () => {
    expect(cancelStateGuard('cancelled').status).toBe(409);
  });

  it.each(['confirmed', 'attended', 'no_show'] as BookingStatus[])(
    'a %s booking may be cancelled (200)',
    (current) => {
      expect(cancelStateGuard(current).status).toBe(200);
    },
  );
});
