/**
 * Migration 074: a booking keeps the name it was made under
 * (da_bookings.booked_first_name / booked_last_name). da_customers is one row
 * per email address and takes the latest name on every booking, so a manager
 * who books two staff members under one email would otherwise see the second
 * name on both bookings.
 *
 * Every query that shows a booking with its customer selects the booked_*
 * columns and passes the row through here, so the screens keep reading
 * `row.customer.first_name` and get this booking's name. The customer's
 * email and phone still come from the contact record.
 */
export interface BookedNameFields {
  booked_first_name?: string | null;
  booked_last_name?: string | null;
}

/** The SELECT fragment to add next to a `customer:da_customers (...)` join. */
export const BOOKED_NAME_COLUMNS = 'booked_first_name, booked_last_name';

export function withBookedName<T extends BookedNameFields & { customer?: unknown }>(row: T): T {
  if (!row) return row;
  const first = row.booked_first_name?.trim();
  const last = row.booked_last_name?.trim();
  if (!first && !last) return row;
  const customer = (row.customer ?? null) as Record<string, unknown> | null;
  if (!customer) return row;
  return {
    ...row,
    customer: {
      ...customer,
      ...(first ? { first_name: first } : {}),
      ...(last ? { last_name: last } : {}),
    },
  };
}
