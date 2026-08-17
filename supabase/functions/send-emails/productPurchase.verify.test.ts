/**
 * Round 2 (F8 + G2) — product_purchase_confirmation wording.
 *
 * F8: this email used to promise instant access and render a "Start now"
 * button. That is factually wrong — the franchisee buys licence keys and
 * enrols the customer through elearnhere by hand, which will not happen on an
 * evening or at a weekend. These tests pin the corrected contract so nobody
 * reinstates the promise:
 *
 *   - an e-learning purchase says access details follow separately, within
 *     ~48 hours, and renders NO call-to-action button;
 *   - a fulfilment_url, if HQ has set one, may appear as a plain extra link but
 *     must not replace or contradict that message;
 *   - a physical purchase keeps its existing "your instructor will be in
 *     touch" wording.
 *
 * G2: the franchisee's own booking_email_message appears in its own block, and
 * is HTML-escaped rather than merged, so a customer-visible apostrophe or angle
 * bracket cannot break the email.
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
    unsubscribe_url: 'https://example.com/unsub',
    product_name: 'Paediatric First Aid online course',
    product_quantity: '1',
    product_kind: 'elearning',
    fulfilment_url: '',
    fulfilment_notes: '',
    ...over,
  };
}

function render(over: Partial<TemplateContext> = {}) {
  const out = renderTemplate('product_purchase_confirmation', ctx(over));
  if (!out) throw new Error('product_purchase_confirmation did not render');
  return out;
}

// ---------------------------------------------------------------------------
// F8 — e-learning must not promise instant access
// ---------------------------------------------------------------------------

describe('e-learning purchase confirmation', () => {
  it('says access details will be emailed separately', () => {
    const { html, text } = render();
    expect(html).toMatch(/access details will be emailed to you separately/i);
    expect(text).toMatch(/access details will be emailed to you separately/i);
  });

  it('sets the expectation at around 48 hours', () => {
    const { html, text } = render();
    expect(html).toMatch(/within 48 hours/i);
    expect(text).toMatch(/within 48 hours/i);
  });

  it('never renders a "start now" style call to action', () => {
    const { html, text } = render({ fulfilment_url: 'https://learn.example.com/course' });
    expect(html).not.toMatch(/start (your course|now)/i);
    expect(text).not.toMatch(/start (your course|now)/i);
  });

  it('never promises the buyer can start straight away', () => {
    const { html, text } = render({ fulfilment_url: 'https://learn.example.com/course' });
    expect(html).not.toMatch(/straight away/i);
    expect(text).not.toMatch(/straight away/i);
  });

  it('keeps the 48-hour message even when a course link IS set', () => {
    const { html } = render({ fulfilment_url: 'https://learn.example.com/course' });
    expect(html).toMatch(/within 48 hours/i);
    expect(html).toContain('https://learn.example.com/course');
  });

  it('renders no link at all when none is set', () => {
    const { html } = render({ fulfilment_url: '' });
    expect(html).not.toMatch(/href="https:\/\/learn/);
  });

  it('warns that a weekend may take longer', () => {
    expect(render().text).toMatch(/weekend/i);
  });
});

// ---------------------------------------------------------------------------
// Physical items keep their existing wording
// ---------------------------------------------------------------------------

describe('physical purchase confirmation', () => {
  it('tells the buyer their instructor will be in touch', () => {
    const { html, text } = render({ product_kind: 'physical', product_name: 'First Aid book' });
    expect(html).toMatch(/instructor will be in touch/i);
    expect(text).toMatch(/instructor will be in touch/i);
  });

  it('does not mention e-learning access timing', () => {
    const { html } = render({ product_kind: 'physical' });
    expect(html).not.toMatch(/within 48 hours/i);
  });

  it('treats a missing kind as physical', () => {
    const { html } = render({ product_kind: undefined });
    expect(html).toMatch(/instructor will be in touch/i);
  });
});

// ---------------------------------------------------------------------------
// Quantity line
// ---------------------------------------------------------------------------

describe('purchase line', () => {
  it('omits the quantity when only one was bought', () => {
    const { text } = render({ product_quantity: '1', product_name: 'Concise First Aid book' });
    expect(text).toContain('Concise First Aid book');
    expect(text).not.toContain('1 ×');
  });

  it('shows the quantity when more than one was bought', () => {
    const { text } = render({ product_quantity: '3', product_name: 'Concise First Aid book' });
    expect(text).toContain('3 × Concise First Aid book');
  });
});

// ---------------------------------------------------------------------------
// G2 — the franchisee's own message
// ---------------------------------------------------------------------------

describe('franchisee booking_email_message', () => {
  it('is absent when the franchisee has not written one', () => {
    const { html, text } = render();
    expect(html).not.toMatch(/A note from/i);
    expect(text).not.toMatch(/A note from/i);
  });

  it('appears in its own attributed block when set', () => {
    const { html, text } = render({
      booking_email_message: 'Parking is easiest on the side road.',
    });
    expect(html).toMatch(/A note from Daisy Sutton/);
    expect(html).toContain('Parking is easiest on the side road.');
    expect(text).toContain('A note from Daisy Sutton:');
    expect(text).toContain('Parking is easiest on the side road.');
  });

  it('escapes HTML so a customer-visible bracket cannot break the email', () => {
    const { html } = render({ booking_email_message: '<script>alert(1)</script> & "quotes"' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('does not treat the message as a template, so braces survive intact', () => {
    const { html } = render({ booking_email_message: 'Ask for {{first_name}} at reception' });
    expect(html).toContain('{{first_name}}');
  });

  it('preserves line breaks as markup', () => {
    const { html } = render({ booking_email_message: 'Line one\nLine two' });
    expect(html).toContain('Line one<br/>Line two');
  });
});

// ---------------------------------------------------------------------------
// Booking confirmation carries the message too (G2)
// ---------------------------------------------------------------------------

describe('booking confirmation', () => {
  it('renders the franchisee message when set', () => {
    const out = renderTemplate(
      'booking_confirmation',
      ctx({ booking_email_message: 'Wear comfy clothes, we do a lot on the floor.' }),
    );
    expect(out?.html).toMatch(/A note from Daisy Sutton/);
    expect(out?.text).toContain('Wear comfy clothes, we do a lot on the floor.');
  });

  it('omits the block entirely when the franchisee has not written one', () => {
    const out = renderTemplate('booking_confirmation', ctx());
    expect(out?.html).not.toMatch(/A note from/i);
  });

  it('still fills the booking merge fields', () => {
    const out = renderTemplate(
      'booking_confirmation',
      ctx({ booking_reference: 'DFA-1234', template_name: 'Baby & Child First Aid' }),
    );
    expect(out?.html).toContain('DFA-1234');
    expect(out?.html).not.toContain('{{booking_reference}}');
    expect(out?.subject).toContain('DFA-1234');
  });

  it('does not add the message to the franchisee-facing new booking alert', () => {
    // send-emails blanks the field for that key; this pins the template side
    // by confirming the block only ever renders from a non-empty value.
    const out = renderTemplate('new_booking_notification', ctx({ booking_email_message: '' }));
    expect(out?.html).not.toMatch(/A note from/i);
  });
});
