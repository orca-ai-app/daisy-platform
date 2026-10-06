// Attendee emails for trainers (migration 067, PRD October batch B7).
//
// The new medical form sends form_version: 2. On that form the email box says
// "Your trainer will use this to send your certificate and anything from the
// class", and an optional, unticked box asks "I'm happy to hear from my trainer
// about future classes and to be asked for a review" (trainer_contact_opt_in).
// The separate certificate tick is retired there: a v2 submission that gives an
// email is stored as certificate_opt_in = true so the existing certificate
// features (migration 065) keep working.
//
// FORWARD-ONLY: anything that does not literally say form_version: 2 (old form
// still open in a tab, hand-built requests) is a v1 submission and keeps
// today's behaviour exactly, via certificateFields().

import { certificateFields } from './certificate.ts';

export const FORM_VERSION_CURRENT = 2;

export const TRAINER_CONTACT_EMAIL_ERROR =
  'Please give your email address so your trainer can contact you';
export const INVALID_EMAIL_ERROR = 'Please enter a valid email address, e.g. your@email.com';

export type ContactColumns =
  | {
      form_version: 2;
      trainer_contact_opt_in: boolean;
      certificate_opt_in: true;
      certificate_email: string;
    }
  | { form_version: 2; trainer_contact_opt_in: false }
  | { certificate_opt_in: true; certificate_email: string };

export type ContactResult =
  | { ok: true; formVersion: 1 | 2; columns: ContactColumns | null }
  | { ok: false; error: string };

function usableEmail(email: string | null): email is string {
  return !!email && email.length <= 320 && /^\S+@\S+\.\S+$/.test(email);
}

/**
 * `attendeeEmail` is the already trimmed and lowercased address (or null).
 * Returns the extra columns to insert. v1 sends no 067 columns at all, so a v1
 * insert is byte-for-byte what it was before this change.
 */
export function attendeeContactFields(
  body: { form_version?: unknown; certificate_opt_in?: unknown; trainer_contact_opt_in?: unknown },
  attendeeEmail: string | null,
): ContactResult {
  if (body.form_version !== FORM_VERSION_CURRENT) {
    const cert = certificateFields(body.certificate_opt_in, attendeeEmail);
    if (!cert.ok) return cert;
    return { ok: true, formVersion: 1, columns: cert.fields };
  }

  const trainerContact = body.trainer_contact_opt_in === true;
  if (attendeeEmail === null) {
    if (trainerContact) return { ok: false, error: TRAINER_CONTACT_EMAIL_ERROR };
    return {
      ok: true,
      formVersion: 2,
      columns: { form_version: 2, trainer_contact_opt_in: false },
    };
  }
  if (!usableEmail(attendeeEmail)) return { ok: false, error: INVALID_EMAIL_ERROR };
  return {
    ok: true,
    formVersion: 2,
    columns: {
      form_version: 2,
      trainer_contact_opt_in: trainerContact,
      certificate_opt_in: true,
      certificate_email: attendeeEmail,
    },
  };
}
