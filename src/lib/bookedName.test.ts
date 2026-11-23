import { describe, it, expect } from 'vitest';
import { withBookedName } from './bookedName';

// Feola, 23 Nov 2026: one email booked two staff members onto two classes;
// the contact record took the second name, so both bookings showed it.
describe('withBookedName (migration 074)', () => {
  const contact = { first_name: 'Edissa', last_name: 'Crampton', email: 'office@x.co.uk' };

  it("shows the name the booking was made under, keeping the contact's email", () => {
    const row = withBookedName({
      booked_first_name: 'Sam',
      booked_last_name: 'Lee',
      customer: contact,
    });
    expect(row.customer).toEqual({ first_name: 'Sam', last_name: 'Lee', email: 'office@x.co.uk' });
  });

  it("falls back to the contact's name when the booking has none", () => {
    const row = withBookedName({
      booked_first_name: null,
      booked_last_name: '  ',
      customer: contact,
    });
    expect(row.customer).toBe(contact);
  });

  it('leaves a row with no customer alone', () => {
    const row = { booked_first_name: 'Sam', booked_last_name: 'Lee', customer: null };
    expect(withBookedName(row)).toBe(row);
  });
});
