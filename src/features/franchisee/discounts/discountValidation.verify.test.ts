/**
 * Wave 9 VERIFIER peer tests — discount value/type rules and code uppercasing.
 *
 * The DiscountDialog Zod schema and onSubmit conversion are not exported, so
 * these tests re-implement the *exact* documented contract (DiscountDialog.tsx
 * lines 78-117 superRefine + 202-205 onSubmit conversion; create-discount-code
 * index.ts validate()) as small pure helpers and assert their behaviour.
 *
 * If the source rules change, these helpers must be kept in lock-step — they
 * exist to pin the contract, not to import private internals.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers mirroring the source contract
// ---------------------------------------------------------------------------

type DiscountType = 'percentage' | 'fixed';

/** Mirrors DiscountDialog.superRefine value validation (lines 78-106). */
function validateValueRaw(
  type: DiscountType,
  valueRaw: string,
): { ok: true } | { ok: false; message: string } {
  const n = Number(valueRaw);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, message: 'Value must be a number of 0 or more' };
  }
  if (type === 'percentage') {
    if (!Number.isInteger(n) || n > 100) {
      return { ok: false, message: 'Percentage must be a whole number between 0 and 100' };
    }
  }
  return { ok: true };
}

/** Mirrors DiscountDialog.onSubmit numeric conversion (lines 202-205). */
function toStoredValue(type: DiscountType, valueRaw: string): number {
  return type === 'percentage' ? Math.round(Number(valueRaw)) : Math.round(Number(valueRaw) * 100);
}

/** Mirrors the code uppercasing transform (DiscountDialog line 65 + edge fn). */
function normaliseCode(raw: string): string {
  return raw.trim().toUpperCase();
}

// ---------------------------------------------------------------------------
// Percentage rules
// ---------------------------------------------------------------------------

describe('discount percentage validation', () => {
  it('accepts a whole-number percentage at the boundaries', () => {
    expect(validateValueRaw('percentage', '0').ok).toBe(true);
    expect(validateValueRaw('percentage', '100').ok).toBe(true);
    expect(validateValueRaw('percentage', '25').ok).toBe(true);
  });

  it('rejects a percentage greater than 100', () => {
    const r = validateValueRaw('percentage', '101');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/between 0 and 100/i);
  });

  it('rejects a non-integer percentage', () => {
    expect(validateValueRaw('percentage', '12.5').ok).toBe(false);
  });

  it('rejects a negative value', () => {
    expect(validateValueRaw('percentage', '-1').ok).toBe(false);
    expect(validateValueRaw('fixed', '-1').ok).toBe(false);
  });

  it('stores a percentage as a whole integer, not pence', () => {
    expect(toStoredValue('percentage', '10')).toBe(10);
    expect(toStoredValue('percentage', '100')).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Fixed-amount rules (pounds -> pence)
// ---------------------------------------------------------------------------

describe('discount fixed-amount validation', () => {
  it('accepts a decimal pounds value', () => {
    expect(validateValueRaw('fixed', '12.50').ok).toBe(true);
    expect(validateValueRaw('fixed', '5').ok).toBe(true);
    expect(validateValueRaw('fixed', '0').ok).toBe(true);
  });

  it('does NOT cap fixed amounts at 100 (only percentages are capped)', () => {
    expect(validateValueRaw('fixed', '150').ok).toBe(true);
  });

  it('converts pounds to integer pence on store', () => {
    expect(toStoredValue('fixed', '12.50')).toBe(1250);
    expect(toStoredValue('fixed', '5')).toBe(500);
    expect(toStoredValue('fixed', '0.99')).toBe(99);
  });

  it('rounds to the nearest pence (no floating-point drift)', () => {
    // 19.99 * 100 = 1998.9999... in float; Math.round fixes it to 1999.
    expect(toStoredValue('fixed', '19.99')).toBe(1999);
  });
});

// ---------------------------------------------------------------------------
// Code uppercasing
// ---------------------------------------------------------------------------

describe('discount code uppercasing', () => {
  it('uppercases and trims the code', () => {
    expect(normaliseCode('summer25')).toBe('SUMMER25');
    expect(normaliseCode('  spring-10  ')).toBe('SPRING-10');
  });

  it('is idempotent for already-uppercased codes', () => {
    expect(normaliseCode('ASHLEY10')).toBe('ASHLEY10');
  });
});
