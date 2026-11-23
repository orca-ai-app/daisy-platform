// November batch (migration 073): "Who's coming" and "Heard about us" on the
// franchisee's new-booking alert, never on the customer's confirmation.
import { describe, it, expect } from 'vitest';
import {
  buildBookingLinkHtml,
  buildBookingLinkText,
  buildExtrasBlockHtml,
  buildExtrasBlockText,
  renderTemplate,
  type TemplateContext,
} from './templates';

const CTX: TemplateContext = {
  first_name: 'Amber',
  customer_name: 'Amber Jones',
  template_name: 'Level 3 Paediatric First Aid',
  event_date: 'Friday 20 November 2026',
  start_time: '09:30',
  venue: 'Guildford Hall',
  franchisee_name: 'Feola',
  franchisee_email: 'feola@daisyfirstaid.com',
  booking_reference: 'DA-2026-00075-901',
  unsubscribe_url: 'https://example.com/u',
};

describe("Who's coming and Heard about us on the trainer alert", () => {
  const who = 'Jo Bloggs, jo@nursery.co.uk\nSam <Lee>, sam@nursery.co.uk';

  it('shows both, escaped, keeping line breaks', () => {
    const t = renderTemplate('new_booking_notification', {
      ...CTX,
      extras_block_html: buildExtrasBlockHtml(who, 'Through a nursery, school or workplace'),
      extras_block_text: buildExtrasBlockText(who, 'Through a nursery, school or workplace'),
    })!;
    expect(t.html).toContain("Who's coming:");
    expect(t.html).toContain('jo@nursery.co.uk<br/>Sam &lt;Lee&gt;');
    expect(t.html).toContain('Heard about us:</strong> Through a nursery, school or workplace');
    expect(t.text).toContain("Who's coming:\nJo Bloggs, jo@nursery.co.uk\nSam <Lee>");
    expect(t.text).toContain('Heard about us: Through a nursery, school or workplace');
  });

  it('adds nothing when the booker gave neither', () => {
    expect(buildExtrasBlockHtml(null, '')).toBe('');
    expect(buildExtrasBlockText('  ', '')).toBe('');
    const t = renderTemplate('new_booking_notification', CTX)!;
    expect(t.html).not.toContain("Who's coming");
    expect(t.html).not.toContain('Heard about us');
  });

  it('never appears on the customer confirmation', () => {
    const t = renderTemplate('booking_confirmation', {
      ...CTX,
      extras_block_html: buildExtrasBlockHtml(who, 'Google search'),
    })!;
    expect(t.html).not.toContain("Who's coming");
  });
});

describe('link to the booking in the portal (TRI-0089)', () => {
  const id = '489d6504-9202-4248-bde8-c04cf16a2f94';

  it("is on the trainer alert, but never the customer's details", () => {
    const t = renderTemplate('new_booking_notification', {
      ...CTX,
      booking_link_html: buildBookingLinkHtml(id),
      booking_link_text: buildBookingLinkText(id),
    })!;
    expect(t.html).toContain(`href="https://app.daisyfirstaid.com/franchisee/bookings/${id}"`);
    expect(t.html).toContain('View this booking in the portal');
    expect(t.text).toContain(`https://app.daisyfirstaid.com/franchisee/bookings/${id}`);
    expect(t.html).not.toContain('mailto:');
  });

  it('adds nothing without a booking id', () => {
    expect(buildBookingLinkHtml(null)).toBe('');
    expect(buildBookingLinkText('')).toBe('');
  });

  it("never appears on the customer's confirmation", () => {
    const t = renderTemplate('booking_confirmation', {
      ...CTX,
      booking_link_html: buildBookingLinkHtml(id),
    })!;
    expect(t.html).not.toContain('/franchisee/bookings/');
  });
});
