/**
 * Whether a PRIVATE class runs at the customer's own address (home or
 * workplace), which makes the booking page say "At your home" and offer the
 * optional class-address box. Only when the class has no venue: venue TBC
 * leaves the postcode empty. A private class at a named venue (a baby hub, a
 * nursery) is not, and an online class never is (Kirsty, 16 Nov 2026).
 *
 * Public classes keep the franchisee's own tick box (migration 059).
 */
export function privateAtCustomerAddress(
  isOnline: boolean,
  venuePostcode: string | null | undefined,
): boolean {
  if (isOnline) return false;
  return !(venuePostcode ?? '').trim();
}
