/**
 * "All contacts" rows for /franchisee/customers: booked customers plus
 * medical-form attendees, merged case-insensitively by email (Wave 12).
 *
 * B7 (migration 067): attendees on the new medical form chose whether they are
 * happy to hear from their trainer about future classes and be asked for a
 * review. That choice is carried on the row (`future_classes`) for anyone with
 * a new-form declaration, including a booked customer with the same email.
 * Old-form declarations carry no choice (null).
 *
 * Old-form attendees appear by NAME ONLY: that form told them their details are
 * used only for the safe running of the class, so their email is never shown
 * to the trainer (6 Oct 2026). Only new-form emails are shown.
 */

import type { CustomerWithBookingCount, MedicalContact } from './customersQueries';

export interface ContactRow {
  /** Stable unique key for the React table. */
  key: string;
  id: string;
  name: string;
  email: string | null;
  /** Undefined when the row originates from a medical form only. */
  phone: string | null | undefined;
  postcode: string | null | undefined;
  booking_count: number;
  /** True when the contact came only from a medical form (no booking record). */
  from_medical_form: boolean;
  /**
   * New medical form only: true/false for "happy to hear about future classes
   * and be asked for a review". Null when there is no new-form declaration.
   */
  future_classes: boolean | null;
}

function isNewForm(mc: MedicalContact): boolean {
  return (mc.form_version ?? 1) >= 2;
}

/**
 * `medContacts` must be newest first (as useMedicalContacts returns them), so
 * the most recent new-form answer wins for a repeat attendee.
 */
export function buildContactRows(
  customers: ReadonlyArray<CustomerWithBookingCount>,
  medContacts: ReadonlyArray<MedicalContact>,
): ContactRow[] {
  // Latest new-form choice per email.
  const choiceByEmail = new Map<string, boolean>();
  for (const mc of medContacts) {
    if (!mc.attendee_email || !isNewForm(mc)) continue;
    const key = mc.attendee_email.toLowerCase();
    if (!choiceByEmail.has(key)) choiceByEmail.set(key, mc.trainer_contact_opt_in === true);
  }
  const choiceFor = (email: string): boolean | null =>
    choiceByEmail.get(email.toLowerCase()) ?? null;

  // Start with booked customers: they always appear.
  const byEmail = new Map<string, ContactRow>();
  const noEmailRows: ContactRow[] = [];

  for (const c of customers) {
    byEmail.set(c.email.toLowerCase(), {
      key: `cust-${c.id}`,
      id: c.id,
      name: `${c.first_name} ${c.last_name}`,
      email: c.email,
      phone: c.phone,
      postcode: c.postcode,
      booking_count: c.booking_count,
      from_medical_form: false,
      future_classes: choiceFor(c.email),
    });
  }

  // Layer in medical contacts: new-form attendees merge by email; old-form
  // attendees (and anyone without an email) are added by name, once.
  const seenNames = new Set(Array.from(byEmail.values()).map((r) => r.name.trim().toLowerCase()));
  for (const mc of medContacts) {
    if (mc.attendee_email && isNewForm(mc)) {
      const emailKey = mc.attendee_email.toLowerCase();
      // If the email already exists as a booked customer we keep the customer
      // row with its booking count.
      if (!byEmail.has(emailKey)) {
        byEmail.set(emailKey, {
          key: `med-${mc.id}`,
          id: mc.id,
          name: mc.attendee_name,
          email: mc.attendee_email,
          phone: undefined,
          postcode: undefined,
          booking_count: 0,
          from_medical_form: true,
          future_classes: choiceFor(mc.attendee_email),
        });
      }
    } else {
      const nameKey = (mc.attendee_name ?? '').trim().toLowerCase();
      if (!nameKey || seenNames.has(nameKey)) continue;
      seenNames.add(nameKey);
      noEmailRows.push({
        key: `med-${mc.id}`,
        id: mc.id,
        name: mc.attendee_name,
        email: null,
        phone: undefined,
        postcode: undefined,
        booking_count: 0,
        from_medical_form: true,
        future_classes: null,
      });
    }
  }

  return [...Array.from(byEmail.values()), ...noEmailRows];
}
