/**
 * Certificate emails (migration 065, PRD W5 October 2026).
 *
 * Attendees who tick "Email me about my certificate" on the medical form give
 * an address for certificate information about that class only. This builds
 * the copy-all list for the class page: certificate emails only, never the
 * general attendee email, de-duplicated, ready to paste into BCC.
 */

export function certificateEmailList(
  rows: ReadonlyArray<{ certificate_email: string | null }>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const email = r.certificate_email?.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}
