// Certificate opt-in (migration 065, PRD W5 October 2026).
//
// "Email me about my certificate" on the medical form. When ticked, the
// attendee's email is copied into certificate_email, which the class trainer
// and HQ see for certificate information only. It is never a marketing list
// and never enrols anyone in a journey (email_opt_in alone does that).

export type CertificateResult =
  | { ok: true; fields: { certificate_opt_in: true; certificate_email: string } | null }
  | { ok: false; error: string };

export const CERTIFICATE_EMAIL_ERROR =
  'Please give a valid email address to be emailed about your certificate';

/**
 * `attendeeEmail` is the already trimmed and lowercased address (or null).
 * Returns the columns to insert, or null when not ticked. Unticked sends
 * nothing, so an unticked submission still inserts even if this function is
 * ever deployed ahead of migration 065.
 */
export function certificateFields(optIn: unknown, attendeeEmail: string | null): CertificateResult {
  if (optIn !== true) return { ok: true, fields: null };
  if (!attendeeEmail || attendeeEmail.length > 320 || !/^\S+@\S+\.\S+$/.test(attendeeEmail)) {
    return { ok: false, error: CERTIFICATE_EMAIL_ERROR };
  }
  return { ok: true, fields: { certificate_opt_in: true, certificate_email: attendeeEmail } };
}
