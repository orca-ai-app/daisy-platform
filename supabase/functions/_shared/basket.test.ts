// B6 basket: payload validation, seat maths, discount sharing and the rows a
// checkout writes. The single-ticket cases pin the old behaviour so existing
// embeds and /book/:token pages keep getting exactly what they always did.
import { describe, it, expect } from 'vitest';
import {
  MAX_ORDER_LINES,
  allocateDiscount,
  buildBookingRows,
  buildStripeLineItems,
  isOrderLead,
  lineNumber,
  lineReference,
  onePerOrder,
  orderFinalisePlan,
  orderSeats,
  parseOrderItems,
  parseOrderLines,
  priceOrder,
  type OrderItemSnapshot,
} from './basket';

const BOOK: OrderItemSnapshot = {
  franchisee_product_id: 'fp-book',
  product_id: 'p-book',
  name: 'Baby first aid book',
  kind: 'physical',
  quantity: 1,
  unit_price_pence: 1200,
  vat_rate: null,
};

describe('parseOrderLines', () => {
  it('turns the old single-ticket payload into one line', () => {
    expect(parseOrderLines({ ticket_type_id: 't1', quantity: 2 })).toEqual([
      { ticket_type_id: 't1', quantity: 2 },
    ]);
  });

  it('keeps the old payload errors', () => {
    expect(parseOrderLines({ quantity: 1 })).toBe('ticket_type_id is required');
    expect(parseOrderLines({ ticket_type_id: 't1', quantity: 0 })).toBe(
      'quantity must be a positive integer',
    );
    expect(parseOrderLines({ ticket_type_id: 't1', quantity: 1.5 })).toBe(
      'quantity must be a positive integer',
    );
  });

  it('accepts several ticket lines and merges a repeated ticket', () => {
    expect(
      parseOrderLines({
        lines: [
          { ticket_type_id: 'double', quantity: 1 },
          { ticket_type_id: 'single', quantity: 1 },
          { ticket_type_id: 'double', quantity: 2 },
        ],
      }),
    ).toEqual([
      { ticket_type_id: 'double', quantity: 3 },
      { ticket_type_id: 'single', quantity: 1 },
    ]);
  });

  it('rejects an empty basket, a bad quantity and a missing id', () => {
    expect(parseOrderLines({ lines: [] })).toMatch(/at least one ticket/);
    expect(parseOrderLines({ lines: 'x' })).toMatch(/at least one ticket/);
    expect(parseOrderLines({ lines: [{ ticket_type_id: 'a', quantity: 0 }] })).toMatch(/quantity/);
    expect(parseOrderLines({ lines: [{ ticket_type_id: 'a', quantity: '2' }] })).toMatch(
      /quantity/,
    );
    expect(parseOrderLines({ lines: [{ quantity: 1 }] })).toMatch(/ticket_type_id/);
  });

  it('caps the number of ticket types', () => {
    const lines = Array.from({ length: MAX_ORDER_LINES + 1 }, (_, i) => ({
      ticket_type_id: `t${i}`,
      quantity: 1,
    }));
    expect(parseOrderLines({ lines })).toMatch(/at most/);
  });

  it('lines win over stray single-ticket fields', () => {
    expect(
      parseOrderLines({
        lines: [{ ticket_type_id: 'a', quantity: 1 }],
        ticket_type_id: 'b',
        quantity: 9,
      }),
    ).toEqual([{ ticket_type_id: 'a', quantity: 1 }]);
  });
});

describe('parseOrderItems', () => {
  it('treats a missing list as no items', () => {
    expect(parseOrderItems(undefined)).toEqual([]);
    expect(parseOrderItems(null)).toEqual([]);
  });

  it('merges repeats and enforces the per-item cap', () => {
    expect(
      parseOrderItems([
        { franchisee_product_id: 'fp1', quantity: 2 },
        { franchisee_product_id: 'fp1', quantity: 3 },
      ]),
    ).toEqual([{ franchisee_product_id: 'fp1', quantity: 5 }]);
    expect(parseOrderItems([{ franchisee_product_id: 'fp1', quantity: 21 }])).toMatch(/At most 20/);
    expect(parseOrderItems([{ franchisee_product_id: 'fp1', quantity: 0 }])).toMatch(/quantity/);
    expect(parseOrderItems({})).toBe('items must be a list');
  });
});

describe('seat maths', () => {
  it('sums quantity × places per ticket across every line', () => {
    // 1 Double (2 places) + 1 Single (1 place) = 3 places from the one pool.
    expect(
      orderSeats([
        { seats_consumed: 2, quantity: 1 },
        { seats_consumed: 1, quantity: 1 },
      ]),
    ).toBe(3);
    expect(orderSeats([{ seats_consumed: 2, quantity: 3 }])).toBe(6);
  });

  it('never counts a ticket as free of places', () => {
    expect(orderSeats([{ seats_consumed: 0, quantity: 2 }])).toBe(2);
    expect(orderSeats([{ seats_consumed: null, quantity: 1 }])).toBe(1);
  });
});

describe('allocateDiscount', () => {
  it('shares the discount in proportion and always adds up exactly', () => {
    const shares = allocateDiscount([5000, 3000], 1000);
    expect(shares).toEqual([625, 375]);
    const odd = allocateDiscount([3333, 3333, 3334], 1001);
    expect(odd.reduce((a, b) => a + b, 0)).toBe(1001);
  });

  it('a single line takes the whole discount (the old behaviour)', () => {
    expect(allocateDiscount([6000], 600)).toEqual([600]);
  });

  it('never discounts a line below zero', () => {
    expect(allocateDiscount([500, 300], 9999)).toEqual([500, 300]);
    expect(allocateDiscount([500, 300], 0)).toEqual([0, 0]);
  });
});

describe('priceOrder', () => {
  it('discounts the tickets only, never the shop items', () => {
    const p = priceOrder(
      [
        { price_pence: 5000, quantity: 1 },
        { price_pence: 3000, quantity: 1 },
      ],
      800,
      [{ ...BOOK, quantity: 2 }],
    );
    expect(p.ticketsGross).toBe(8000);
    expect(p.ticketsNet).toBe(7200);
    expect(p.lineNet).toEqual([4500, 2700]);
    expect(p.total).toBe(7200 + 2400);
  });
});

describe('references', () => {
  it('the lead keeps the sequence reference, later lines add a suffix', () => {
    expect(lineReference('DA-2026-00075-901', 0)).toBe('DA-2026-00075-901');
    expect(lineReference('DA-2026-00075-901', 1)).toBe('DA-2026-00075-901-2');
    expect(lineNumber('DA-2026-00075-901-2', 'DA-2026-00075-901')).toBe(2);
    expect(lineNumber('DA-2026-00075-901', 'DA-2026-00075-901')).toBe(1);
  });
});

describe('buildBookingRows', () => {
  const common = { course_instance_id: 'c1', franchisee_id: 'f1', customer_id: 'u1' };
  let n = 0;
  const newId = () => `id-${++n}`;

  it('a single-ticket booking has exactly the old columns: no id, no order_id, no items', () => {
    const rows = buildBookingRows({
      isOrder: false,
      newId,
      leadReference: 'DA-2026-00075-901',
      lines: [{ ticket_type_id: 't-couple', quantity: 2, seats_consumed: 2 }],
      lineNet: [9000],
      lineOff: [1000],
      discountCode: 'SAVE10',
      items: [],
      common,
    });
    expect(rows).toEqual([
      {
        booking_reference: 'DA-2026-00075-901',
        ...common,
        ticket_type_id: 't-couple',
        quantity: 2,
        total_price_pence: 9000,
        discount_code: 'SAVE10',
        discount_amount_pence: 1000,
        payment_status: 'pending',
        booking_status: 'confirmed',
        reserved_seats: 4,
      },
    ]);
  });

  it('an order: one row per line, all sharing the lead id, items on the lead only', () => {
    n = 0;
    const rows = buildBookingRows({
      isOrder: true,
      newId,
      leadReference: 'DA-2026-00075-901',
      lines: [
        { ticket_type_id: 't-double', quantity: 1, seats_consumed: 2 },
        { ticket_type_id: 't-single', quantity: 1, seats_consumed: 1 },
      ],
      lineNet: [5000, 3000],
      lineOff: [0, 0],
      discountCode: null,
      items: [BOOK],
      common,
    });
    expect(rows.map((r) => r.id)).toEqual(['id-1', 'id-2']);
    expect(rows.map((r) => r.order_id)).toEqual(['id-1', 'id-1']);
    expect(rows.map((r) => r.booking_reference)).toEqual([
      'DA-2026-00075-901',
      'DA-2026-00075-901-2',
    ]);
    // Each line holds only its own places, so the sweep gives back 2 + 1 = 3.
    expect(rows.map((r) => r.reserved_seats)).toEqual([2, 1]);
    expect(rows[0].order_items).toEqual([BOOK]);
    expect('order_items' in rows[1]).toBe(false);
  });
});

describe('buildStripeLineItems', () => {
  it('a single ticket is the same one line the checkout always sent', () => {
    expect(
      buildStripeLineItems(
        [{ name: 'Couple', quantity: 2, net_pence: 9000, reference: 'DA-2026-00075-901' }],
        [],
        '2026-11-20',
      ),
    ).toEqual([
      {
        price_data: {
          currency: 'gbp',
          unit_amount: 9000,
          product_data: {
            name: 'Couple × 2',
            description: 'Booking DA-2026-00075-901 · 2026-11-20',
          },
        },
        quantity: 1,
      },
    ]);
  });

  it('mixed tickets and a shop item give one row each with the right total', () => {
    const li = buildStripeLineItems(
      [
        { name: 'Double', quantity: 1, net_pence: 5000, reference: 'R' },
        { name: 'Single', quantity: 1, net_pence: 3000, reference: 'R-2' },
      ],
      [{ name: 'Baby first aid book', quantity: 2, unit_price_pence: 1200 }],
      '2026-11-20',
    );
    expect(li).toHaveLength(3);
    expect(li[2]).toMatchObject({ price_data: { unit_amount: 1200 }, quantity: 2 });
    const total = li.reduce((s, l) => s + l.price_data.unit_amount * l.quantity, 0);
    expect(total).toBe(10400);
  });

  it('leaves off a ticket line discounted to nothing', () => {
    const li = buildStripeLineItems(
      [{ name: 'Single', quantity: 1, net_pence: 0, reference: 'R' }],
      [{ name: 'Book', quantity: 1, unit_price_pence: 1200 }],
      '2026-11-20',
    );
    expect(li.map((l) => l.price_data.product_data.name)).toEqual(['Book']);
  });
});

describe('one of everything per order', () => {
  it('isOrderLead: plain bookings and the lead line only', () => {
    expect(isOrderLead({ id: 'a', order_id: null })).toBe(true);
    expect(isOrderLead({ id: 'a' })).toBe(true);
    expect(isOrderLead({ id: 'a', order_id: 'a' })).toBe(true);
    expect(isOrderLead({ id: 'b', order_id: 'a' })).toBe(false);
  });

  it('the webhook confirms lead first and flags only the lead for emails', () => {
    const plan = orderFinalisePlan(
      [
        { id: 'line3', booking_reference: 'R-3' },
        { id: 'lead', booking_reference: 'R' },
        { id: 'line2', booking_reference: 'R-2' },
      ],
      'lead',
    );
    expect(plan).toEqual([
      { id: 'lead', lead: true },
      { id: 'line2', lead: false },
      { id: 'line3', lead: false },
    ]);
    expect(plan.filter((p) => p.lead)).toHaveLength(1);
  });

  it('an order whose lead is missing confirms nothing', () => {
    expect(orderFinalisePlan([{ id: 'x', booking_reference: 'R-2' }], 'lead')).toEqual([]);
  });

  it('onePerOrder keeps one booking per order (the lead when present)', () => {
    const rows = [
      { id: 'b', order_id: 'a', customer_id: 'u' },
      { id: 'a', order_id: 'a', customer_id: 'u' },
      { id: 'solo', order_id: null, customer_id: 'v' },
      { id: 'y', order_id: 'x', customer_id: 'w' }, // lead x cancelled, y still stands
    ];
    expect(
      onePerOrder(rows)
        .map((r) => r.id)
        .sort(),
    ).toEqual(['a', 'solo', 'y']);
  });
});
