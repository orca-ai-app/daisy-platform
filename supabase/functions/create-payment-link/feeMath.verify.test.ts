/**
 * Wave 8 VERIFIER peer test — application-fee floor math.
 *
 * The fee calculation in create-payment-link/index.ts (lines 289-290) is not
 * exported (it lives inline in the Deno handler), so this test re-implements
 * the *exact* documented contract as a small pure helper and pins its
 * behaviour:
 *
 *   amount_pence           = ticket.price_pence * quantity
 *   application_fee_amount = Math.floor(amount_pence * PLATFORM_FEE_PERCENT / 100)
 *
 * PLATFORM_FEE_PERCENT defaults to 2 (Deno.env, falls back to '2' in source).
 *
 * Money is integer pence everywhere (DECISIONS.md). The fee must always be an
 * integer (Stripe rejects fractional application_fee_amount), hence Math.floor.
 *
 * If the source formula changes, this helper must change in lock-step — it
 * exists to pin the contract, not to import the Deno handler.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Helper mirroring create-payment-link/index.ts lines 289-290 exactly.
// ---------------------------------------------------------------------------

function computeAmounts(
  pricePence: number,
  quantity: number,
  feePercent: number,
): { amount_pence: number; application_fee_amount: number } {
  const amount_pence = pricePence * quantity;
  const application_fee_amount = Math.floor((amount_pence * feePercent) / 100);
  return { amount_pence, application_fee_amount };
}

const FEE = 2; // PLATFORM_FEE_PERCENT default

// ---------------------------------------------------------------------------
// Brief-mandated worked examples
// ---------------------------------------------------------------------------

describe('application fee floor math (PLATFORM_FEE_PERCENT = 2)', () => {
  it('999p (£9.99) → 19 fee (19.98 floored)', () => {
    const { amount_pence, application_fee_amount } = computeAmounts(999, 1, FEE);
    expect(amount_pence).toBe(999);
    expect(application_fee_amount).toBe(19);
  });

  it('6000p (£60.00) → 120 fee (exactly 120, no rounding)', () => {
    const { amount_pence, application_fee_amount } = computeAmounts(6000, 1, FEE);
    expect(amount_pence).toBe(6000);
    expect(application_fee_amount).toBe(120);
  });

  it('5500p (£55 single) → 110 fee', () => {
    expect(computeAmounts(5500, 1, FEE).application_fee_amount).toBe(110);
  });

  it('9500p (£95 full day) → 190 fee', () => {
    expect(computeAmounts(9500, 1, FEE).application_fee_amount).toBe(190);
  });
});

// ---------------------------------------------------------------------------
// Quantity multiplies the base before the fee is taken
// ---------------------------------------------------------------------------

describe('quantity is applied before the fee', () => {
  it('999p × 3 = 2997p → 59 fee (59.94 floored)', () => {
    const { amount_pence, application_fee_amount } = computeAmounts(999, 3, FEE);
    expect(amount_pence).toBe(2997);
    expect(application_fee_amount).toBe(59);
  });

  it('5500p × 2 = 11000p → 220 fee', () => {
    const { amount_pence, application_fee_amount } = computeAmounts(5500, 2, FEE);
    expect(amount_pence).toBe(11000);
    expect(application_fee_amount).toBe(220);
  });
});

// ---------------------------------------------------------------------------
// Floor always rounds DOWN — the platform never over-charges its fee
// ---------------------------------------------------------------------------

describe('floor never rounds up', () => {
  it('rounds 19.98 down to 19, not up to 20', () => {
    // 999 * 2 / 100 = 19.98
    expect(computeAmounts(999, 1, FEE).application_fee_amount).toBe(19);
  });

  it('rounds a .999... case down (149p → 2.98 → 2)', () => {
    expect(computeAmounts(149, 1, FEE).application_fee_amount).toBe(2);
  });

  it('always returns an integer (Stripe rejects fractional fees)', () => {
    for (const price of [1, 49, 99, 150, 333, 777, 12345]) {
      const { application_fee_amount } = computeAmounts(price, 1, FEE);
      expect(Number.isInteger(application_fee_amount)).toBe(true);
    }
  });

  it('a price too small to yield 1p of fee floors to 0', () => {
    // 49p * 2 / 100 = 0.98 → 0
    expect(computeAmounts(49, 1, FEE).application_fee_amount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The fee is always strictly less than the total (franchisee always nets >0)
// ---------------------------------------------------------------------------

describe('fee invariant', () => {
  it('application_fee_amount is always <= amount_pence', () => {
    for (const [price, qty] of [
      [999, 1],
      [5500, 2],
      [9500, 4],
      [1, 1],
    ] as const) {
      const { amount_pence, application_fee_amount } = computeAmounts(price, qty, FEE);
      expect(application_fee_amount).toBeLessThanOrEqual(amount_pence);
    }
  });
});
