/**
 * Attendee emails for trainers (migration 067, PRD October batch B7).
 *
 * The new medical form (form_version 2) tells attendees their email goes to
 * their trainer "to send your certificate and anything from the class", and
 * asks separately whether they are happy to hear about future classes and be
 * asked for a review (trainer_contact_opt_in).
 *
 * FORWARD-ONLY: declarations made on the old form (form_version 1, or a row
 * read before migration 067 has run) never show an email or a choice here.
 * They keep the 065 "certificate email" behaviour only.
 *
 * For a v2 row the server copies the attendee's email into certificate_email,
 * so the portal never needs to read attendee_email for the class page.
 */

export interface AttendeeContactFields {
  form_version?: number | null;
  trainer_contact_opt_in?: boolean | null;
  certificate_email: string | null;
}

/** True only for declarations made on the new (B7) medical form. */
export function isNewFormDeclaration(row: Pick<AttendeeContactFields, 'form_version'>): boolean {
  return (row.form_version ?? 1) >= 2;
}

/** The email a trainer may use for this attendee, or null (old form, or none given). */
export function attendeeClassEmail(row: AttendeeContactFields): string | null {
  if (!isNewFormDeclaration(row)) return null;
  return row.certificate_email?.trim() || null;
}

function dedupe(emails: Array<string | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const email of emails) {
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/** "Copy emails": every new-form attendee who gave an email, for class matters. */
export function classEmailList(rows: ReadonlyArray<AttendeeContactFields>): string[] {
  return dedupe(rows.map(attendeeClassEmail));
}

/** New-form attendees who ticked the "future classes and a review" box. */
export function futureClassEmailList(rows: ReadonlyArray<AttendeeContactFields>): string[] {
  return dedupe(rows.filter((r) => r.trainer_contact_opt_in === true).map(attendeeClassEmail));
}

/** Old-form rows only: the 065 certificate tick, exactly as before B7. */
export function oldFormRows<T extends Pick<AttendeeContactFields, 'form_version'>>(
  rows: ReadonlyArray<T>,
): T[] {
  return rows.filter((r) => !isNewFormDeclaration(r));
}
