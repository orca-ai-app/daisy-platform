// send-emails/order.ts
//
// B6 basket (migration 068). A multi-line order sends ONE confirmation and ONE
// franchisee alert, both queued on the lead line, listing every ticket line and
// shop item. Pure helpers so vitest can cover them; index.ts loads the rows.

import { orderSeats, type OrderItemSnapshot } from '../_shared/basket.ts';

export interface OrderLineView {
  booking_reference: string;
  quantity: number;
  total_price_pence: number;
  booking_status: string;
  ticket_name: string;
  seats_consumed?: number | null;
  vat_rate?: number | null;
}

function gbp(pence: number): string {
  return `£${(Math.round(pence) / 100).toFixed(2)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Lines still standing (a trainer may cancel one line of an order). */
export function activeLines(lines: OrderLineView[]): OrderLineView[] {
  return lines.filter((l) => l.booking_status !== 'cancelled');
}

/**
 * An order stops emailing only when EVERY line is cancelled: cancelling one
 * ticket out of three must not silence the reminders for the other two.
 */
export function orderIsCancelled(lines: OrderLineView[]): boolean {
  return lines.length > 0 && activeLines(lines).length === 0;
}

/** What the customer paid for the lines still standing plus the shop items. */
export function orderTotalPence(lines: OrderLineView[], items: OrderItemSnapshot[]): number {
  return (
    activeLines(lines).reduce((s, l) => s + (l.total_price_pence ?? 0), 0) +
    items.reduce((s, i) => s + i.unit_price_pence * i.quantity, 0)
  );
}

/** Places the whole order needs, for the recovery email's "still fits" check. */
export function orderSeatsNeeded(lines: OrderLineView[]): number {
  return orderSeats(lines.map((l) => ({ seats_consumed: l.seats_consumed, quantity: l.quantity })));
}

/**
 * The "Your order" block for the confirmation (customer) and the new-booking
 * alert (franchisee): one row per ticket line and shop item, then the total.
 * The customer also gets how their shop items reach them, worded exactly as
 * the single-item confirmation words it (F8: e-learning is set up by hand).
 * Free text is escaped; the result is safe to drop into the template body.
 */
export function buildOrderBlock(
  lines: OrderLineView[],
  items: OrderItemSnapshot[],
  audience: 'customer' | 'franchisee',
): { html: string; text: string } {
  const standing = activeLines(lines);
  const rows: Array<{ label: string; amount: number }> = [
    ...standing.map((l) => ({
      label: `${l.ticket_name} × ${l.quantity}`,
      amount: l.total_price_pence,
    })),
    ...items.map((i) => ({
      label: `${i.name} × ${i.quantity}`,
      amount: i.unit_price_pence * i.quantity,
    })),
  ];
  if (rows.length === 0) return { html: '', text: '' };
  const total = orderTotalPence(lines, items);

  const notes: string[] = [];
  if (audience === 'customer') {
    if (items.some((i) => i.kind === 'elearning')) {
      notes.push(
        'Your e-learning access details will be emailed to you separately, usually within 48 hours. We set your account up by hand, so it may take a little longer over a weekend or a bank holiday.',
      );
    }
    if (items.some((i) => i.kind !== 'elearning')) {
      notes.push('Your trainer will be in touch about getting your items to you.');
    }
  } else if (items.length > 0) {
    notes.push('Shop items in this order are recorded under Merchandise as online sales.');
  }

  const cell = 'padding:3px 12px 3px 0;color:#1a4359';
  const html = `<div style="border-top:1px solid #e2edf3;margin-top:16px;padding-top:12px">
      <p style="color:#5a7a8f;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;margin:0 0 8px">${audience === 'customer' ? 'Your order' : 'In this order'}</p>
      <table style="font-size:14px;border-collapse:collapse">
        ${rows
          .map(
            (r) =>
              `<tr><td style="${cell}">${escapeHtml(r.label)}</td><td style="${cell};text-align:right">${gbp(r.amount)}</td></tr>`,
          )
          .join('\n        ')}
        <tr><td style="${cell};font-weight:700;border-top:1px solid #e2edf3">Total</td><td style="${cell};font-weight:700;text-align:right;border-top:1px solid #e2edf3">${gbp(total)}</td></tr>
      </table>
      ${notes.map((n) => `<p style="font-size:13px;color:#5a7a8f;margin:10px 0 0">${escapeHtml(n)}</p>`).join('')}
    </div>`;
  const text =
    `\n\n${audience === 'customer' ? 'Your order' : 'In this order'}:\n` +
    rows.map((r) => `${r.label}: ${gbp(r.amount)}`).join('\n') +
    `\nTotal: ${gbp(total)}` +
    notes.map((n) => `\n${n}`).join('');
  return { html, text };
}

/**
 * VAT receipt figures for a whole order. Lines without a VAT rate count in
 * the total with no VAT. Null when nothing in the order carries VAT, so the
 * receipt block is left off exactly as for a non-VAT single booking. `rate`
 * is the one rate when every VAT-rated line shares it, else null.
 */
export function orderVat(
  parts: Array<{ grossPence: number; vatRate: number | null | undefined }>,
): { gross: number; vat: number; rate: number | null } | null {
  const rated = parts.filter((p) => typeof p.vatRate === 'number' && p.vatRate > 0);
  if (rated.length === 0) return null;
  const gross = parts.reduce((s, p) => s + p.grossPence, 0);
  const vat = rated.reduce(
    (s, p) => s + (p.grossPence - Math.round(p.grossPence / (1 + (p.vatRate as number) / 100))),
    0,
  );
  const rates = new Set(rated.map((p) => p.vatRate));
  return { gross, vat, rate: rates.size === 1 ? (rated[0].vatRate as number) : null };
}
