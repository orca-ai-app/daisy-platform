/**
 * Migration 067 (PRD October batch B7) — attendee emails for trainers.
 *
 * The new medical form sends form_version 2. Its email is stored as the
 * certificate email (so the 065 certificate features keep working) and the
 * "future classes and a review" box becomes trainer_contact_opt_in. Anything
 * that does not say form_version 2 is a v1 submission: no 067 columns are sent,
 * so old-form rows are stored exactly as before (forward-only).
 */

import { describe, it, expect } from 'vitest';
import {
  attendeeContactFields,
  INVALID_EMAIL_ERROR,
  TRAINER_CONTACT_EMAIL_ERROR,
} from './attendeeContact.ts';
import { CERTIFICATE_EMAIL_ERROR } from './certificate.ts';

describe('attendeeContactFields: old form (v1), unchanged behaviour', () => {
  it('sends no new columns when form_version is missing', () => {
    expect(attendeeContactFields({}, 'jane@example.com')).toEqual({
      ok: true,
      formVersion: 1,
      columns: null,
    });
  });

  it('keeps the 065 certificate tick exactly as before', () => {
    expect(attendeeContactFields({ certificate_opt_in: true }, 'jane@example.com')).toEqual({
      ok: true,
      formVersion: 1,
      columns: { certificate_opt_in: true, certificate_email: 'jane@example.com' },
    });
    expect(attendeeContactFields({ certificate_opt_in: true }, null)).toEqual({
      ok: false,
      error: CERTIFICATE_EMAIL_ERROR,
    });
  });

  it('ignores a trainer-contact tick that does not come from the new form', () => {
    const r = attendeeContactFields({ trainer_contact_opt_in: true }, 'jane@example.com');
    expect(r).toEqual({ ok: true, formVersion: 1, columns: null });
  });

  it('only a literal 2 counts as the new form', () => {
    for (const v of ['2', 1, 3, true, null]) {
      const r = attendeeContactFields(
        { form_version: v, trainer_contact_opt_in: true },
        'jane@example.com',
      );
      expect(r).toEqual({ ok: true, formVersion: 1, columns: null });
    }
  });
});

describe('attendeeContactFields: new form (v2)', () => {
  it('stores the email as the certificate email and marks the version', () => {
    expect(attendeeContactFields({ form_version: 2 }, 'jane@example.com')).toEqual({
      ok: true,
      formVersion: 2,
      columns: {
        form_version: 2,
        trainer_contact_opt_in: false,
        certificate_opt_in: true,
        certificate_email: 'jane@example.com',
      },
    });
  });

  it('records the future-classes choice when ticked', () => {
    const r = attendeeContactFields(
      { form_version: 2, trainer_contact_opt_in: true },
      'jane@example.com',
    );
    expect(r.ok && r.columns).toMatchObject({ trainer_contact_opt_in: true });
  });

  it('only a literal true counts as ticked', () => {
    const r = attendeeContactFields(
      { form_version: 2, trainer_contact_opt_in: 'true' },
      'jane@example.com',
    );
    expect(r.ok && r.columns).toMatchObject({ trainer_contact_opt_in: false });
  });

  it('ignores the retired certificate tick', () => {
    expect(attendeeContactFields({ form_version: 2, certificate_opt_in: true }, null)).toEqual({
      ok: true,
      formVersion: 2,
      columns: { form_version: 2, trainer_contact_opt_in: false },
    });
  });

  it('without an email: version marked, nothing shared', () => {
    expect(attendeeContactFields({ form_version: 2 }, null)).toEqual({
      ok: true,
      formVersion: 2,
      columns: { form_version: 2, trainer_contact_opt_in: false },
    });
  });

  it('rejects the future-classes tick with no email', () => {
    expect(attendeeContactFields({ form_version: 2, trainer_contact_opt_in: true }, null)).toEqual({
      ok: false,
      error: TRAINER_CONTACT_EMAIL_ERROR,
    });
  });

  it('rejects a malformed or overlong email', () => {
    expect(attendeeContactFields({ form_version: 2 }, 'sarah.gmail.com')).toEqual({
      ok: false,
      error: INVALID_EMAIL_ERROR,
    });
    expect(attendeeContactFields({ form_version: 2 }, `${'a'.repeat(320)}@example.com`)).toEqual({
      ok: false,
      error: INVALID_EMAIL_ERROR,
    });
  });
});
