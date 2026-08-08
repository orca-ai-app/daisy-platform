/**
 * Public-facing addresses for the two customer surfaces.
 *
 * These default to the permanent daisyfirstaid.com subdomains. While those DNS
 * records are still being set up by Daisy's web developer, the VITE_*_BASE_URL
 * environment variables point them at the live Netlify origins so franchisee
 * testing works end to end. Remove the two env vars at cutover and everything
 * reverts to the permanent addresses with no code change.
 */

function normaliseBase(value: string | undefined, fallback: string): string {
  const raw = (value ?? fallback).trim();
  return (raw.length > 0 ? raw : fallback).replace(/\/+$/, '');
}

/** Base URL for the public booking micro-site (…/book/:token). */
export const BOOKING_BASE = normaliseBase(
  import.meta.env.VITE_BOOKING_BASE_URL,
  'https://booking.daisyfirstaid.com',
);

/** Base URL for the medical declaration form. */
export const MEDICAL_BASE = normaliseBase(
  import.meta.env.VITE_MEDICAL_BASE_URL,
  'https://medical.daisyfirstaid.com',
);

/** Host only, for copy that tells attendees what to type by hand. */
export const MEDICAL_HOST = MEDICAL_BASE.replace(/^https?:\/\//, '');

/** The booking page for a course instance's booking token. */
export function bookingUrl(bookingToken: string): string {
  return `${BOOKING_BASE}/book/${bookingToken}`;
}

/** The permanent medical-form URL for an instructor. Nothing else goes in it. */
export function medicalFormUrl(franchiseeNumber: string): string {
  return `${MEDICAL_BASE}/?instructor=${encodeURIComponent(franchiseeNumber)}`;
}
