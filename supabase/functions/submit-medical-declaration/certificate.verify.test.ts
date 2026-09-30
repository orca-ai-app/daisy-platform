/**
 * Migration 065 (PRD W5) — certificate opt-in on the medical form.
 *
 * Unticked sends no certificate columns at all (so the insert is unchanged
 * for everyone who does not tick). Ticked needs a usable address, which is
 * copied into certificate_email.
 */

import { describe, it, expect } from 'vitest';
import { certificateFields, CERTIFICATE_EMAIL_ERROR } from './certificate.ts';

describe('certificateFields', () => {
  it('adds nothing when the tick is off or missing', () => {
    expect(certificateFields(false, 'jane@example.com')).toEqual({ ok: true, fields: null });
    expect(certificateFields(undefined, 'jane@example.com')).toEqual({ ok: true, fields: null });
    expect(certificateFields(undefined, null)).toEqual({ ok: true, fields: null });
  });

  it('only a literal true counts as ticked', () => {
    expect(certificateFields('true', 'jane@example.com')).toEqual({ ok: true, fields: null });
    expect(certificateFields(1, 'jane@example.com')).toEqual({ ok: true, fields: null });
  });

  it('copies the address when ticked', () => {
    expect(certificateFields(true, 'jane@example.com')).toEqual({
      ok: true,
      fields: { certificate_opt_in: true, certificate_email: 'jane@example.com' },
    });
  });

  it('rejects a tick with no address or a malformed one', () => {
    expect(certificateFields(true, null)).toEqual({ ok: false, error: CERTIFICATE_EMAIL_ERROR });
    expect(certificateFields(true, 'sarah.gmail.com')).toEqual({
      ok: false,
      error: CERTIFICATE_EMAIL_ERROR,
    });
    expect(certificateFields(true, `${'a'.repeat(320)}@example.com`)).toEqual({
      ok: false,
      error: CERTIFICATE_EMAIL_ERROR,
    });
  });
});
