/**
 * All contacts rows (Wave 12) with the B7 "future classes" choice
 * (migration 067). Old-form declarations carry no choice and are otherwise
 * merged exactly as before.
 */

import { describe, it, expect } from 'vitest';
import { buildContactRows } from './contactRows';
import type { CustomerWithBookingCount, MedicalContact } from './customersQueries';

function customer(over: Partial<CustomerWithBookingCount> = {}): CustomerWithBookingCount {
  return {
    id: 'c1',
    created_at: '2026-09-01T00:00:00Z',
    first_name: 'Sarah',
    last_name: 'Jones',
    email: 'sarah@example.com',
    phone: null,
    postcode: null,
    booking_count: 1,
    ...over,
  };
}

function med(over: Partial<MedicalContact> = {}): MedicalContact {
  return {
    id: 'm1',
    created_at: '2026-10-10T00:00:00Z',
    attendee_name: 'Amy Smith',
    attendee_email: 'amy@example.com',
    email_opt_in: false,
    photo_consent: true,
    form_version: 2,
    trainer_contact_opt_in: true,
    ...over,
  };
}

describe('buildContactRows', () => {
  it('shows the future-classes choice for a new-form attendee', () => {
    const rows = buildContactRows([], [med()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: 'amy@example.com',
      from_medical_form: true,
      future_classes: true,
    });
    expect(buildContactRows([], [med({ trainer_contact_opt_in: false })])[0].future_classes).toBe(
      false,
    );
  });

  it('old-form attendees look exactly as before: no choice', () => {
    const rows = buildContactRows([], [med({ form_version: 1, trainer_contact_opt_in: false })]);
    expect(rows[0]).toEqual({
      key: 'med-m1',
      id: 'm1',
      name: 'Amy Smith',
      email: 'amy@example.com',
      phone: undefined,
      postcode: undefined,
      booking_count: 0,
      from_medical_form: true,
      future_classes: null,
    });
  });

  it('carries the choice onto a booked customer with the same email', () => {
    const rows = buildContactRows(
      [customer()],
      [med({ attendee_email: 'SARAH@example.com', trainer_contact_opt_in: true })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'cust-c1', booking_count: 1, future_classes: true });
  });

  it('booked customers with no new-form declaration have no choice', () => {
    expect(buildContactRows([customer()], [])[0].future_classes).toBeNull();
  });

  it('the most recent new-form answer wins (input is newest first)', () => {
    const rows = buildContactRows(
      [],
      [
        med({ id: 'new', trainer_contact_opt_in: false }),
        med({ id: 'older', trainer_contact_opt_in: true }),
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].future_classes).toBe(false);
  });

  it('form-only contacts with no email are kept as separate rows with no choice', () => {
    const rows = buildContactRows(
      [],
      [med({ id: 'a', attendee_email: null }), med({ id: 'b', attendee_email: null })],
    );
    expect(rows.map((r) => r.key)).toEqual(['med-a', 'med-b']);
    expect(rows.every((r) => r.future_classes === null)).toBe(true);
  });
});
