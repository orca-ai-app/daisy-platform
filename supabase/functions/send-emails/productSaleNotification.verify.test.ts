/**
 * The trainer's alert for a standalone online shop order (migration 071).
 * Goes TO the franchisee, so it must name the product and the buyer with
 * their contact details, and for e-learning say plainly that the buyer is
 * waiting to be set up on elearnhere.
 */

import { describe, it, expect } from 'vitest';
import { renderTemplate, type TemplateContext } from './templates.ts';

function ctx(over: Partial<TemplateContext> = {}): TemplateContext {
  return {
    first_name: 'Sam',
    customer_name: 'Sam Taylor',
    template_name: 'your order',
    event_date: '',
    start_time: '',
    venue: '',
    franchisee_name: 'Daisy Sutton',
    franchisee_email: 'sutton@example.com',
    booking_reference: '',
    unsubscribe_url: '',
    product_name: 'Anaphylaxis e-Learning Course',
    product_quantity: '1',
    product_kind: 'elearning',
    amount_paid: '£14.99',
    customer_email: 'sam@example.com',
    customer_phone: '07700 900123',
    ...over,
  };
}

function render(over: Partial<TemplateContext> = {}) {
  const out = renderTemplate('product_sale_notification', ctx(over));
  if (!out) throw new Error('product_sale_notification did not render');
  return out;
}

describe('product_sale_notification', () => {
  it('subject names the product and the buyer', () => {
    expect(render().subject).toBe('New shop order: Anaphylaxis e-Learning Course (Sam Taylor)');
  });

  it('lists product, quantity, amount and the buyer contact details', () => {
    const { html, text } = render({ product_quantity: '2', amount_paid: '£29.98' });
    for (const body of [html, text]) {
      expect(body).toContain('Anaphylaxis e-Learning Course');
      expect(body).toMatch(/Quantity:(<\/strong>)? 2/);
      expect(body).toContain('£29.98');
      expect(body).toContain('Sam Taylor');
      expect(body).toContain('sam@example.com');
      expect(body).toContain('07700 900123');
    }
  });

  it('tells the trainer to set an e-learning buyer up within 48 hours', () => {
    const line =
      'This customer has been told their e-learning access details will follow within 48 hours. Please set them up on elearnhere.';
    const { html, text } = render();
    expect(html).toContain(line);
    expect(text).toContain(line);
  });

  it('a physical item gets no elearnhere line', () => {
    const { html, text } = render({ product_kind: 'physical', product_name: 'Paediatric book' });
    expect(html).not.toMatch(/elearnhere/);
    expect(text).not.toMatch(/elearnhere/);
    expect(text).toMatch(/get in touch with the customer/);
  });

  it('signs off as the business alert does, never "Warm wishes"', () => {
    const { html, text } = render();
    expect(html).toContain('Kind regards,<br/>Daisy First Aid');
    expect(text).toMatch(/Kind regards,\nDaisy First Aid$/);
    expect(html).not.toMatch(/Warm wishes/);
  });

  it('carries no unsubscribe link (the buyer link would unsubscribe the buyer)', () => {
    expect(render().html).not.toMatch(/Unsubscribe/);
  });

  it('escapes customer free text', () => {
    const { html } = render({ customer_name: `<b>O'Neil</b>` });
    expect(html).not.toContain('<b>O');
    expect(html).toContain('&lt;b&gt;O&#39;Neil&lt;/b&gt;');
  });

  it('says "not given" when the buyer left no phone', () => {
    const { html, text } = render({ customer_phone: '' });
    expect(html).toMatch(/Phone:<\/strong> not given/);
    expect(text).toMatch(/Phone: not given/);
  });

  it('customer emails still carry their unsubscribe link', () => {
    const out = renderTemplate('product_purchase_confirmation', {
      ...ctx(),
      unsubscribe_url: 'https://example.com/unsub',
    });
    expect(out?.html).toContain('href="https://example.com/unsub"');
  });
});
