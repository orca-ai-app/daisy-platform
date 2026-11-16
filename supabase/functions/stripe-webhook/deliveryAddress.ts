/**
 * The delivery address Stripe collected for a physical shop item (TRI-0084),
 * one line per address line, or null when none was asked for. Newer Stripe API
 * versions move shipping_details under collected_information, so read both.
 */
export function formatDeliveryAddress(session: unknown): string | null {
  // deno-lint-ignore no-explicit-any
  const s = session as any;
  const sd = s?.shipping_details ?? s?.collected_information?.shipping_details ?? null;
  const a = sd?.address;
  if (!a) return null;
  const lines = [sd.name, a.line1, a.line2, a.city, a.state, a.postal_code]
    .map((v: unknown) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
  return lines.length > 0 ? lines.join('\n') : null;
}
