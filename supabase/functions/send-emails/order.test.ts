// B6 basket: the one confirmation and one franchisee alert per order list every
// line, and a plain single booking's emails are unchanged.
import { describe, it, expect } from 'vitest';
import {
  buildOrderBlock,
  orderIsCancelled,
  orderSeatsNeeded,
  orderTotalPence,
  orderVat,
  type OrderLineView,
} from './order';
import { buildVatBlockHtml, renderTemplate, type TemplateContext } from './templates';
import type { OrderItemSnapshot } from '../_shared/basket';

const LINES: OrderLineView[] = [
  {
    booking_reference: 'DA-2026-00075-901',
    quantity: 1,
    total_price_pence: 5000,
    booking_status: 'confirmed',
    ticket_name: 'Double',
    seats_consumed: 2,
  },
  {
    booking_reference: 'DA-2026-00075-901-2',
    quantity: 1,
    total_price_pence: 3000,
    booking_status: 'confirmed',
    ticket_name: 'Single',
    seats_consumed: 1,
  },
];

const BOOK: OrderItemSnapshot = {
  franchisee_product_id: 'fp-book',
  product_id: 'p-book',
  name: 'Baby first aid <book>',
  kind: 'physical',
  quantity: 1,
  unit_price_pence: 1200,
  vat_rate: null,
};
const ELEARN: OrderItemSnapshot = { ...BOOK, name: 'Paediatric e-learning', kind: 'elearning' };

const CTX: TemplateContext = {
  first_name: 'Amber',
  customer_name: 'Amber Jones',
  template_name: 'Baby & Child First Aid',
  event_date: 'Friday 20 November 2026',
  start_time: '10:00',
  venue: 'Guildford Hall',
  franchisee_name: 'Feola',
  franchisee_email: 'feola@daisyfirstaid.com',
  booking_reference: 'DA-2026-00075-901',
  unsubscribe_url: 'https://example.com/u',
};

describe('order block', () => {
  it('lists every ticket line and shop item with the total', () => {
    const { html, text } = buildOrderBlock(LINES, [BOOK], 'customer');
    expect(html).toContain('Double × 1');
    expect(html).toContain('Single × 1');
    expect(html).toContain('Baby first aid &lt;book&gt; × 1');
    expect(html).toContain('£92.00');
    expect(text).toContain('Double × 1: £50.00');
    expect(text).toContain('Total: £92.00');
    expect(text).toContain('Your trainer will be in touch about getting your items to you.');
  });

  it('tells the customer e-learning access follows by hand, not the franchisee', () => {
    expect(buildOrderBlock(LINES, [ELEARN], 'customer').text).toMatch(/within 48 hours/);
    const fr = buildOrderBlock(LINES, [ELEARN], 'franchisee');
    expect(fr.text).not.toMatch(/48 hours/);
    expect(fr.text).toMatch(/In this order/);
    expect(fr.text).toMatch(/Merchandise/);
  });

  it('leaves out a cancelled line and counts only what stands', () => {
    const lines = [LINES[0], { ...LINES[1], booking_status: 'cancelled' }];
    const { text } = buildOrderBlock(lines, [], 'customer');
    expect(text).not.toContain('Single');
    expect(orderTotalPence(lines, [])).toBe(5000);
  });
});

describe('order lifecycle and maths', () => {
  it('an order is cancelled only when every line is', () => {
    expect(orderIsCancelled(LINES)).toBe(false);
    expect(orderIsCancelled([{ ...LINES[0], booking_status: 'cancelled' }, LINES[1]])).toBe(false);
    expect(orderIsCancelled(LINES.map((l) => ({ ...l, booking_status: 'cancelled' })))).toBe(true);
  });

  it('the recovery check needs the whole order to fit', () => {
    expect(orderSeatsNeeded(LINES)).toBe(3);
  });

  it('VAT across the order, and none when nothing carries VAT', () => {
    expect(orderVat([{ grossPence: 5000, vatRate: null }])).toBeNull();
    expect(
      orderVat([
        { grossPence: 12000, vatRate: 20 },
        { grossPence: 1200, vatRate: null },
      ]),
    ).toEqual({ gross: 13200, vat: 2000, rate: 20 });
    expect(
      orderVat([
        { grossPence: 12000, vatRate: 20 },
        { grossPence: 1050, vatRate: 5 },
      ])?.rate,
    ).toBeNull();
    const html = buildVatBlockHtml({
      totalPricePence: null,
      vatRate: null,
      businessName: 'Daisy First Aid Guildford',
      vatNumber: null,
      bookingReference: 'R',
      order: { gross: 13200, vat: 2000, rate: null },
    });
    expect(html).toContain('£112.00');
    expect(html).toContain('£132.00');
    expect(html).toContain('>VAT<');
  });
});

describe('one confirmation per order', () => {
  it('the confirmation carries the whole order', () => {
    const block = buildOrderBlock(LINES, [BOOK], 'customer');
    const t = renderTemplate('booking_confirmation', {
      ...CTX,
      order_block_html: block.html,
      order_block_text: block.text,
    })!;
    expect(t.html).toContain('Single × 1');
    expect(t.html).toContain('Double × 1');
    expect(t.text).toContain('Total: £92.00');
  });

  it('the franchisee alert carries the whole order', () => {
    const block = buildOrderBlock(LINES, [BOOK], 'franchisee');
    const t = renderTemplate('new_booking_notification', {
      ...CTX,
      amount_paid: '£92.00 · see the order below',
      order_block_html: block.html,
      order_block_text: block.text,
    })!;
    expect(t.html).toContain('In this order');
    expect(t.text).toContain('Baby first aid <book> × 1: £12.00');
  });

  it('a single booking renders as before, with no order block', () => {
    const t = renderTemplate('booking_confirmation', CTX)!;
    expect(t.html).not.toContain('Your order');
    expect(t.text).not.toContain('Total:');
    expect(t.text).toContain('Reference: DA-2026-00075-901\n\nWe look forward to seeing you.');
  });
});
