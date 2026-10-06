/**
 * B7 (migration 067): attendee emails for trainers from the medical form.
 * New-form rows only; old-form rows never show an email or a choice.
 */

import { describe, it, expect } from 'vitest';
import {
  attendeeClassEmail,
  classEmailList,
  futureClassEmailList,
  isNewFormDeclaration,
  oldFormRows,
} from './attendeeContacts';

const v1 = (certificate_email: string | null = null) => ({
  form_version: 1,
  trainer_contact_opt_in: false,
  certificate_email,
});
const v2 = (certificate_email: string | null, trainer_contact_opt_in = false) => ({
  form_version: 2,
  trainer_contact_opt_in,
  certificate_email,
});

describe('isNewFormDeclaration', () => {
  it('is true for form_version 2 only', () => {
    expect(isNewFormDeclaration({ form_version: 2 })).toBe(true);
    expect(isNewFormDeclaration({ form_version: 1 })).toBe(false);
    expect(isNewFormDeclaration({ form_version: null })).toBe(false);
    expect(isNewFormDeclaration({})).toBe(false);
  });
});

describe('attendeeClassEmail', () => {
  it('returns the email for a new-form row', () => {
    expect(attendeeClassEmail(v2('amy@example.com'))).toBe('amy@example.com');
  });

  it('never returns an email for an old-form row, even with a certificate email', () => {
    expect(attendeeClassEmail(v1('amy@example.com'))).toBeNull();
  });

  it('is null when no email was given', () => {
    expect(attendeeClassEmail(v2(null))).toBeNull();
    expect(attendeeClassEmail(v2('  '))).toBeNull();
  });
});

describe('classEmailList', () => {
  it('lists new-form emails only, de-duplicated regardless of case', () => {
    expect(
      classEmailList([
        v2('amy@example.com'),
        v1('old@example.com'),
        v2('AMY@example.com', true),
        v2(null),
        v2('ben@example.com', true),
      ]),
    ).toEqual(['amy@example.com', 'ben@example.com']);
  });

  it('is empty for a class with only old-form rows', () => {
    expect(classEmailList([v1('old@example.com'), v1()])).toEqual([]);
  });
});

describe('futureClassEmailList', () => {
  it('lists only new-form attendees who said yes to future classes', () => {
    expect(
      futureClassEmailList([
        v2('amy@example.com'),
        v2('ben@example.com', true),
        { ...v1('old@example.com'), trainer_contact_opt_in: true },
      ]),
    ).toEqual(['ben@example.com']);
  });
});

describe('oldFormRows', () => {
  it('keeps only old-form rows so the 065 certificate list is unchanged for them', () => {
    const a = v1('old@example.com');
    const b = v2('new@example.com');
    expect(oldFormRows([a, b])).toEqual([a]);
  });
});
