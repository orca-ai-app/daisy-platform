/**
 * Money helpers for the franchisee courses feature (pre-launch NTH-1 / NTH-2).
 *
 * Storage and Edge Function payloads stay integer pence throughout — these
 * helpers cover the pounds-facing form inputs (accept "95" or "95.00", max
 * 2 decimal places) and the £-display convention (£X for whole pounds,
 * £X.XX otherwise).
 */
import { z } from 'zod';

/** Zod schema for a pounds input: >= 0 with at most 2 decimal places. */
export const poundsSchema = z
  .number({ invalid_type_error: 'Price required' })
  .min(0, 'Price cannot be negative')
  .refine((v) => Number.isFinite(v) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, {
    message: 'Use at most 2 decimal places',
  });

/** Convert a pounds form value to integer pence (e.g. 95 → 9500). */
export function poundsToPence(pounds: number): number {
  return Math.round(pounds * 100);
}

/** Convert integer pence to a pounds form value (e.g. 9500 → 95). */
export function penceToPounds(pence: number): number {
  return pence / 100;
}

/** Format integer pence as £X.XX, or £X when a whole number of pounds. */
export function formatPrice(pence: number): string {
  if (!Number.isFinite(pence)) return '';
  const pounds = pence / 100;
  return pence % 100 === 0
    ? `£${pounds.toLocaleString('en-GB')}`
    : `£${pounds.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * "Price from" (NTH-2): when an instance has more than one ticket type with
 * differing prices, show the lowest as "From £X"; otherwise the base price.
 */
export function formatPriceFrom(basePence: number, ticketPrices: number[]): string {
  const distinct = new Set(ticketPrices);
  if (ticketPrices.length > 1 && distinct.size > 1) {
    return `From ${formatPrice(Math.min(...ticketPrices))}`;
  }
  return formatPrice(basePence);
}
