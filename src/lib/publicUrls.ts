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

// Guarded so this module can also be imported at build time (the Help index
// plugin in vite.config.ts), where import.meta.env is undefined. In the
// browser Vite substitutes the env object as usual.
const ENV = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

/** Base URL for the public booking micro-site (…/book/:token). */
export const BOOKING_BASE = normaliseBase(
  ENV.VITE_BOOKING_BASE_URL,
  'https://booking.daisyfirstaid.com',
);

/** Base URL for the medical declaration form. */
export const MEDICAL_BASE = normaliseBase(
  ENV.VITE_MEDICAL_BASE_URL,
  'https://medical.daisyfirstaid.com',
);

/** Host only, for copy that tells attendees what to type by hand. */
export const MEDICAL_HOST = MEDICAL_BASE.replace(/^https?:\/\//, '');

/** The booking page for a course instance's booking token. */
export function bookingUrl(bookingToken: string): string {
  return `${BOOKING_BASE}/book/${bookingToken}`;
}

/**
 * A franchisee's public page on the class finder, optionally pre-filtered.
 * This is the link to send customers for the shop (items sit under
 * "Available any time") and for a filtered class list. `courseType` must be
 * one of PUBLIC_COURSE_FAMILIES ids; `month` is 'YYYY-MM'.
 */
export function franchiseePageUrl(
  franchiseeNumber: string,
  opts: { courseType?: string; month?: string } = {},
): string {
  const params = new URLSearchParams({ franchisee: franchiseeNumber });
  if (opts.courseType) params.set('course-type', opts.courseType);
  if (opts.month) params.set('month', opts.month);
  return `${BOOKING_BASE}/search?${params.toString()}`;
}

/** The permanent medical-form URL for an instructor. Nothing else goes in it. */
export function medicalFormUrl(franchiseeNumber: string): string {
  return `${MEDICAL_BASE}/?instructor=${encodeURIComponent(franchiseeNumber)}`;
}
