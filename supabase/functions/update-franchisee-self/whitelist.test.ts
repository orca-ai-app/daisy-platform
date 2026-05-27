/**
 * Peer test (Wave 6 VERIFIER) for the field-whitelist + validation logic in
 * supabase/functions/update-franchisee-self/index.ts.
 *
 * The edge function runs under Deno (Deno.serve, esm.sh imports) so it is not
 * importable into the Vitest/Node test runner. Per the verifier brief, we
 * replicate the PURE allowed/immutable sets and the per-field validation rules
 * here and assert their behaviour. If the source function diverges from these
 * expectations, this test documents the intended contract — update both
 * deliberately.
 *
 * Mirrors:
 *   ALLOWED_SELF_FIELDS  (index.ts:34)
 *   IMMUTABLE_FIELDS     (index.ts:41-58)
 *   field validation     (index.ts:161-211)
 */

import { describe, it, expect } from 'vitest';

// --- Replicated contract (kept in lockstep with index.ts) -------------------

const ALLOWED_SELF_FIELDS = new Set(['name', 'phone']);

const IMMUTABLE_FIELDS = new Set([
  'email',
  'fee_tier',
  'status',
  'is_hq',
  'billing_date',
  'stripe_account_id',
  'stripe_connected',
  'gocardless_mandate_id',
  'number',
  'auth_user_id',
  'id',
  'created_at',
  'updated_at',
  'vat_registered',
  'business_name',
  'notes',
]);

type ValidationResult =
  | { ok: true; updateFields: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/**
 * Pure re-implementation of the body validation in index.ts. Returns the
 * normalised update map on success, or a {status,error} on rejection.
 */
function validateSelfUpdate(fields: Record<string, unknown>): ValidationResult {
  for (const key of Object.keys(fields)) {
    if (IMMUTABLE_FIELDS.has(key)) {
      return {
        ok: false,
        status: 400,
        error: `Field '${key}' cannot be changed through this endpoint. Contact HQ.`,
      };
    }
    if (!ALLOWED_SELF_FIELDS.has(key)) {
      return { ok: false, status: 400, error: `Field not editable: ${key}` };
    }
  }

  if (Object.keys(fields).length === 0) {
    return { ok: false, status: 400, error: 'No fields to update' };
  }

  if (
    'name' in fields &&
    (typeof fields.name !== 'string' || (fields.name as string).trim().length < 2)
  ) {
    return { ok: false, status: 400, error: 'name must be a string of at least 2 characters' };
  }

  if ('phone' in fields && fields.phone !== null && typeof fields.phone !== 'string') {
    return { ok: false, status: 400, error: 'phone must be a string or null' };
  }

  const updateFields: Record<string, unknown> = {};
  if ('name' in fields) updateFields.name = (fields.name as string).trim();
  if ('phone' in fields) {
    if (fields.phone === null) {
      updateFields.phone = null;
    } else {
      const trimmed = (fields.phone as string).trim();
      updateFields.phone = trimmed.length === 0 ? null : trimmed;
    }
  }
  return { ok: true, updateFields };
}

describe('update-franchisee-self whitelist', () => {
  it('accepts name + phone together', () => {
    const r = validateSelfUpdate({ name: 'Jane Doe', phone: '07700 900000' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.updateFields).toEqual({ name: 'Jane Doe', phone: '07700 900000' });
  });

  it('accepts name alone', () => {
    const r = validateSelfUpdate({ name: 'Jo' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.updateFields).toEqual({ name: 'Jo' });
  });

  // The security-critical assertions: every privileged/immutable field is rejected.
  const blocked = [
    'email',
    'fee_tier',
    'status',
    'is_hq',
    'billing_date',
    'stripe_account_id',
    'stripe_connected',
    'gocardless_mandate_id',
    'number',
    'auth_user_id',
    'id',
    'created_at',
    'updated_at',
    'vat_registered',
    'business_name',
    'notes',
  ];

  it.each(blocked)('rejects immutable field: %s', (field) => {
    const r = validateSelfUpdate({ [field]: 'anything' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toContain(field);
      expect(r.error).toContain('Contact HQ');
    }
  });

  it('rejects email even when a legal name change is also present (whole request fails)', () => {
    const r = validateSelfUpdate({ name: 'Jane Doe', email: 'new@evil.test' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('email');
  });

  it('rejects unknown fields', () => {
    const r = validateSelfUpdate({ favourite_colour: 'blue' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Field not editable: favourite_colour');
  });

  it('rejects empty field set', () => {
    const r = validateSelfUpdate({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('No fields to update');
  });

  it('rejects name shorter than 2 characters', () => {
    const r = validateSelfUpdate({ name: 'A' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('at least 2 characters');
  });

  it('trims name whitespace', () => {
    const r = validateSelfUpdate({ name: '  Jane Doe  ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.updateFields.name).toBe('Jane Doe');
  });

  it('normalises blank phone to null', () => {
    const r = validateSelfUpdate({ phone: '   ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.updateFields.phone).toBeNull();
  });

  it('accepts explicit null phone', () => {
    const r = validateSelfUpdate({ phone: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.updateFields.phone).toBeNull();
  });

  it('rejects non-string non-null phone', () => {
    const r = validateSelfUpdate({ phone: 12345 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('phone must be a string or null');
  });

  it('contract guard: allowed set and immutable set never overlap', () => {
    for (const f of ALLOWED_SELF_FIELDS) {
      expect(IMMUTABLE_FIELDS.has(f)).toBe(false);
    }
  });
});
