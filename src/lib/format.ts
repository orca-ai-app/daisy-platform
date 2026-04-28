/**
 * Daisy formatting helpers. Money is integer pence everywhere
 * (per DECISIONS.md and PRD §4.1). Dates use Europe/London for display.
 */

const gbpFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Format integer pence as a UK pound string (e.g. 1250 → "£12.50").
 * Negative values render with a leading minus (e.g. -500 → "-£5.00").
 */
export function formatPence(p: number): string {
  if (!Number.isFinite(p)) {
    throw new TypeError(`formatPence expected a finite number, got ${String(p)}`)
  }
  const pounds = p / 100
  return gbpFormatter.format(pounds)
}
