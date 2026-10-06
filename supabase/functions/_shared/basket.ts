// _shared/basket.ts
//
// B6 basket (October 2026): one checkout can hold several ticket types for a
// class plus the same trainer's shop items. Pure helpers shared by
// create-checkout-session, stripe-webhook, send-emails, get-public-courses and
// update-course-instance, so vitest can cover the maths directly.
//
// Data model (migration 068):
//   - one da_bookings row per ticket line; every line of a multi-line order
//     carries order_id = the LEAD line's id (the lead's order_id is its own id);
//   - a plain single-ticket booking has order_id NULL, exactly as before;
//   - shop items in the order are a snapshot in the lead's order_items, turned
//     into da_product_sales rows by the webhook once paid;
//   - the lead line owns everything that must happen once per order: the
//     customer confirmation, the franchisee alert, the reminder/follow-up
//     journey, the discount use, the recovery email and its resume token.
//
// Pure module: no Deno globals.

/** Most distinct ticket lines one order may hold. */
export const MAX_ORDER_LINES = 10;
/** Same cap as the single-item checkout. */
export const MAX_ITEM_QUANTITY = 20;

export interface OrderLineInput {
  ticket_type_id: string;
  quantity: number;
}

export interface OrderItemInput {
  franchisee_product_id: string;
  quantity: number;
}

/** A shop item as recorded on the lead booking (order_items snapshot). */
export interface OrderItemSnapshot {
  franchisee_product_id: string;
  product_id: string;
  name: string;
  kind: string;
  quantity: number;
  unit_price_pence: number;
  vat_rate: number | null;
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1;
}

function idOf(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Ticket lines from the request. Accepts the new `lines` array, or the old
 * single-ticket fields (ticket_type_id + quantity) so every existing embed and
 * /book/:token page keeps working unchanged. Repeated ticket ids are merged.
 * Returns a message for the customer when the input is unusable.
 */
export function parseOrderLines(body: {
  lines?: unknown;
  ticket_type_id?: unknown;
  quantity?: unknown;
}): OrderLineInput[] | string {
  if (body.lines === undefined || body.lines === null) {
    const id = idOf(body.ticket_type_id);
    if (!id) return 'ticket_type_id is required';
    if (!isPositiveInt(body.quantity)) return 'quantity must be a positive integer';
    return [{ ticket_type_id: id, quantity: body.quantity }];
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return 'Please choose at least one ticket';
  }
  const merged = new Map<string, number>();
  for (const raw of body.lines) {
    const r = (raw ?? {}) as { ticket_type_id?: unknown; quantity?: unknown };
    const id = idOf(r.ticket_type_id);
    if (!id) return 'Every ticket line needs a ticket_type_id';
    if (!isPositiveInt(r.quantity))
      return 'Every ticket line needs a whole-number quantity of 1 or more';
    merged.set(id, (merged.get(id) ?? 0) + r.quantity);
  }
  if (merged.size > MAX_ORDER_LINES)
    return `An order can hold at most ${MAX_ORDER_LINES} ticket types`;
  return [...merged].map(([ticket_type_id, quantity]) => ({ ticket_type_id, quantity }));
}

/** Optional shop items alongside the tickets. Missing = none. */
export function parseOrderItems(raw: unknown): OrderItemInput[] | string {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return 'items must be a list';
  const merged = new Map<string, number>();
  for (const entry of raw) {
    const r = (entry ?? {}) as { franchisee_product_id?: unknown; quantity?: unknown };
    const id = idOf(r.franchisee_product_id);
    if (!id) return 'Every item needs a franchisee_product_id';
    if (!isPositiveInt(r.quantity)) return 'Every item needs a whole-number quantity of 1 or more';
    merged.set(id, (merged.get(id) ?? 0) + r.quantity);
  }
  for (const q of merged.values()) {
    if (q > MAX_ITEM_QUANTITY) return `At most ${MAX_ITEM_QUANTITY} of any one item per order`;
  }
  return [...merged].map(([franchisee_product_id, quantity]) => ({
    franchisee_product_id,
    quantity,
  }));
}

/**
 * Places one ticket uses. Defaults to 1 so a ticket missing the figure is
 * never treated as free against the pool (mirrors the widget's seatsFor).
 */
export function seatsPerTicket(seatsConsumed: unknown): number {
  return typeof seatsConsumed === 'number' && Number.isFinite(seatsConsumed) && seatsConsumed >= 1
    ? seatsConsumed
    : 1;
}

/** Total places an order takes from the class's one shared pool. */
export function orderSeats(lines: Array<{ seats_consumed: unknown; quantity: number }>): number {
  return lines.reduce((sum, l) => sum + seatsPerTicket(l.seats_consumed) * l.quantity, 0);
}

/**
 * Share an order-level discount across ticket lines in proportion to each
 * line's gross, in whole pence, so the line totals always add up to exactly
 * the discounted total. Leftover pence go to the largest lines first. No line
 * is ever discounted below zero.
 */
export function allocateDiscount(lineGross: number[], offPence: number): number[] {
  const total = lineGross.reduce((a, b) => a + b, 0);
  const off = Math.max(0, Math.min(offPence, total));
  if (off === 0 || total === 0) return lineGross.map(() => 0);
  const shares = lineGross.map((g) => Math.floor((g * off) / total));
  let left = off - shares.reduce((a, b) => a + b, 0);
  const order = lineGross.map((g, i) => ({ g, i })).sort((a, b) => b.g - a.g || a.i - b.i);
  while (left > 0) {
    let moved = false;
    for (const { i } of order) {
      if (left === 0) break;
      if (shares[i] < lineGross[i]) {
        shares[i]++;
        left--;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return shares;
}

/**
 * Reference for line `index` of an order. The lead keeps the sequence
 * reference the customer is given ("DA-2026-00075-901"); the others add a
 * suffix ("DA-2026-00075-901-2") so a trainer searching the reference finds
 * every line. A sequence reference never has a fifth part, so no clash.
 */
export function lineReference(leadReference: string, index: number): string {
  return index === 0 ? leadReference : `${leadReference}-${index + 1}`;
}

/** Position of a line within its order, read back from its reference (lead = 1). */
export function lineNumber(reference: string, leadReference: string): number {
  if (reference === leadReference) return 1;
  const n = Number(reference.slice(leadReference.length + 1));
  return Number.isInteger(n) && n > 1 ? n : Number.MAX_SAFE_INTEGER;
}

/**
 * True for the booking that speaks for its order: every plain single booking,
 * and the lead line of a multi-line order. Only these get the confirmation,
 * the franchisee alert, the journey, the recovery email and course updates.
 */
export function isOrderLead(b: { id: string; order_id?: string | null }): boolean {
  return !b.order_id || b.order_id === b.id;
}

/** The key that groups a booking with the rest of its order. */
export function orderKey(b: { id: string; order_id?: string | null }): string {
  return b.order_id ?? b.id;
}

/**
 * One booking per order out of a list of bookings: the lead when it is in the
 * list, otherwise the first line seen (e.g. the lead line was cancelled but
 * others still stand). Used so an update email goes once per order.
 */
export function onePerOrder<T extends { id: string; order_id?: string | null }>(rows: T[]): T[] {
  const chosen = new Map<string, T>();
  for (const r of rows) {
    const key = orderKey(r);
    const have = chosen.get(key);
    if (!have || (isOrderLead(r) && !isOrderLead(have))) chosen.set(key, r);
  }
  return [...chosen.values()];
}

export interface StripeLineItem {
  price_data: {
    currency: 'gbp';
    unit_amount: number;
    product_data: { name: string; description?: string };
  };
  quantity: number;
}

/**
 * Stripe Checkout line items for an order. Each ticket line is one row,
 * "Couple × 2", charged at its discounted total (quantity 1, as the
 * single-ticket checkout always has been). Shop items are priced per unit
 * with Stripe's own quantity. A ticket line discounted to nothing is left off:
 * it is still booked, there is just nothing to charge for it.
 */
export function buildStripeLineItems(
  tickets: Array<{ name: string; quantity: number; net_pence: number; reference: string }>,
  items: Array<{
    name: string;
    description?: string | null;
    quantity: number;
    unit_price_pence: number;
  }>,
  eventDate: string,
): StripeLineItem[] {
  const out: StripeLineItem[] = [];
  for (const t of tickets) {
    if (t.net_pence <= 0) continue;
    out.push({
      price_data: {
        currency: 'gbp',
        unit_amount: t.net_pence,
        product_data: {
          name: `${t.name} × ${t.quantity}`,
          description: `Booking ${t.reference} · ${eventDate}`,
        },
      },
      quantity: 1,
    });
  }
  for (const i of items) {
    out.push({
      price_data: {
        currency: 'gbp',
        unit_amount: i.unit_price_pence,
        product_data: {
          name: i.name,
          ...(i.description ? { description: String(i.description).slice(0, 500) } : {}),
        },
      },
      quantity: i.quantity,
    });
  }
  return out;
}

/** Total of the shop items in an order, in pence. */
export function itemsTotal(items: Array<{ quantity: number; unit_price_pence: number }>): number {
  return items.reduce((sum, i) => sum + i.quantity * i.unit_price_pence, 0);
}

/**
 * The money for an order: each ticket line's gross, its share of the discount
 * and what is charged for it, plus the tickets' and whole order's totals.
 * `discountOffPence` is worked out on the tickets' combined gross by the
 * caller (the discount never touches shop items).
 */
export function priceOrder(
  lines: Array<{ price_pence: number; quantity: number }>,
  discountOffPence: number,
  items: Array<{ quantity: number; unit_price_pence: number }>,
): {
  lineGross: number[];
  lineOff: number[];
  lineNet: number[];
  ticketsGross: number;
  ticketsNet: number;
  total: number;
} {
  const lineGross = lines.map((l) => l.price_pence * l.quantity);
  const ticketsGross = lineGross.reduce((a, b) => a + b, 0);
  const lineOff = allocateDiscount(lineGross, discountOffPence);
  const lineNet = lineGross.map((g, i) => g - lineOff[i]);
  const ticketsNet = lineNet.reduce((a, b) => a + b, 0);
  return {
    lineGross,
    lineOff,
    lineNet,
    ticketsGross,
    ticketsNet,
    total: ticketsNet + itemsTotal(items),
  };
}

/**
 * The pending da_bookings rows for a checkout, one per ticket line. A plain
 * booking (not an order) gets exactly the columns it always had: no id, no
 * order_id, no order_items. An order's rows all carry order_id = the lead's
 * id, each holds only its own places (so the expiry sweep, releasing each
 * row's reserved_seats, gives back exactly what was reserved), and only the
 * lead carries the shop items.
 */
export function buildBookingRows(args: {
  isOrder: boolean;
  newId: () => string;
  leadReference: string;
  lines: Array<{ ticket_type_id: string; quantity: number; seats_consumed: unknown }>;
  lineNet: number[];
  lineOff: number[];
  discountCode: string | null;
  items: OrderItemSnapshot[];
  common: Record<string, unknown>;
}): Array<Record<string, unknown>> {
  const leadId = args.isOrder ? args.newId() : null;
  return args.lines.map((l, i) => ({
    ...(args.isOrder ? { id: i === 0 ? leadId : args.newId(), order_id: leadId } : {}),
    booking_reference: lineReference(args.leadReference, i),
    ...args.common,
    ticket_type_id: l.ticket_type_id,
    quantity: l.quantity,
    total_price_pence: args.lineNet[i],
    discount_code: args.discountCode,
    discount_amount_pence: args.lineOff[i],
    payment_status: 'pending',
    booking_status: 'confirmed',
    reserved_seats: orderSeats([l]),
    ...(args.isOrder && i === 0 && args.items.length > 0 ? { order_items: args.items } : {}),
  }));
}

/**
 * The order's lines in the order the webhook confirms them: lead first, then
 * by line number. Only the lead is flagged, so only it queues the emails and
 * counts the discount use.
 */
export function orderFinalisePlan(
  lines: Array<{ id: string; booking_reference: string }>,
  orderId: string,
): Array<{ id: string; lead: boolean }> {
  const lead = lines.find((l) => l.id === orderId);
  if (!lead) return [];
  return [...lines]
    .sort(
      (a, b) =>
        lineNumber(a.booking_reference, lead.booking_reference) -
        lineNumber(b.booking_reference, lead.booking_reference),
    )
    .map((l) => ({ id: l.id, lead: l.id === orderId }));
}
