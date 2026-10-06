/**
 * VERIFIER peer test — B6 basket wiring (migration 068).
 *
 * The edge functions import Deno-only modules, so they cannot be run here.
 * These checks read the real source to pin the wiring that makes a
 * multi-line order behave as ONE order:
 *   - the webhook queues emails and bumps the discount for the lead line only;
 *   - a basket's shop items are recorded without a second confirmation email;
 *   - the expiry sweep queues ONE recovery email per abandoned order;
 *   - the recovery guard does not mistake the order's own lines for a rebooking;
 *   - migration 068 lets several lines share a Stripe session.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fns = join(here, '..');
const read = (p: string) => readFileSync(join(fns, p), 'utf8');

const webhook = read('stripe-webhook/index.ts');
const sendEmails = read('send-emails/index.ts');
const checkout = read('create-checkout-session/index.ts');
const migration = readFileSync(join(fns, '..', 'migrations', '068_basket_orders.sql'), 'utf8');

function fnBody(src: string, name: string): string {
  const start = src.indexOf(`async function ${name}(`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const next = src.indexOf('\nasync function ', start + 10);
  return src.slice(start, next === -1 ? undefined : next);
}

describe('webhook: one confirmation per order', () => {
  it('routes an order session to finaliseOrder before the single-booking path', () => {
    const handler = fnBody(webhook, 'handleCheckoutSessionCompleted');
    expect(handler.indexOf('finaliseOrder(')).toBeGreaterThan(-1);
    expect(handler.indexOf('finaliseOrder(')).toBeLessThan(
      handler.indexOf('finalisePendingBooking('),
    );
  });

  it('only the lead line queues the journey and bumps the discount', () => {
    const fin = fnBody(webhook, 'finalisePendingBooking');
    expect(fin).toMatch(/opts: \{ lead: boolean \} = \{ lead: true \}/);
    expect(fin).toMatch(/if \(booking\.discount_code && opts\.lead\)/);
    expect(fin).toMatch(/if \(eventDateStr && opts\.lead\)/);
    const order = fnBody(webhook, 'finaliseOrder');
    expect(order).toMatch(/orderFinalisePlan\(/);
    expect(order).toMatch(/\{ lead: line\.lead \}/);
  });

  it('basket shop items never queue their own purchase email', () => {
    const items = fnBody(webhook, 'recordOrderItems');
    expect(items).toMatch(/from\('da_product_sales'\)/);
    expect(items).not.toMatch(/da_email_sequences/);
    expect(items).not.toMatch(/product_purchase_confirmation/);
  });

  it('the free (100% off) order queues one journey, for the lead', () => {
    const free = checkout.slice(checkout.indexOf('if (netPence === 0)'));
    expect(free.match(/buildJourneyRows\(/g)).toHaveLength(1);
    expect(free).toMatch(/bookingId,\n\s+eventDate/);
  });
});

describe('send-emails: once per order', () => {
  it('queues the recovery email for the lead line only', () => {
    expect(sendEmails).toMatch(
      /b\.stripe_checkout_session_id && b\.customer_id && isOrderLead\(b\)/,
    );
  });

  it("does not count the order's own lines as another booking", () => {
    expect(sendEmails).toMatch(/!b\.order_id \|\| o\.order_id !== b\.order_id/);
  });

  it('an order stops emailing only when every line is cancelled', () => {
    expect(sendEmails).toMatch(/isOrder\s*\?\s*orderIsCancelled\(orderLines\)/);
  });
});

describe('migration 068', () => {
  it('replaces the one-booking-per-session index with one per ticket line', () => {
    expect(migration).toMatch(/drop index if exists idx_bookings_checkout_session;/);
    expect(migration).toMatch(
      /on da_bookings \(stripe_checkout_session_id, ticket_type_id\)\s+where stripe_checkout_session_id is not null/,
    );
  });

  it('lets one session hold several shop items, never the same one twice', () => {
    expect(migration).toMatch(/drop index if exists idx_product_sales_checkout_session;/);
    expect(migration).toMatch(
      /on da_product_sales \(stripe_checkout_session_id, franchisee_product_id\)/,
    );
  });

  it('adds the order columns', () => {
    expect(migration).toMatch(/add column if not exists order_id uuid/);
    expect(migration).toMatch(/add column if not exists order_items jsonb/);
  });
});
