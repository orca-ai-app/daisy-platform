/**
 * Migration 064 (TRI-0026) — per-class joining details.
 *
 * The franchisee's per-class text (venue sign-in, parking, Zoom link) goes on
 * every customer email about the class itself: the confirmation, the
 * day-before reminder, the one-hour reminder and the course-updated email. It
 * never goes on the franchisee's own alert. It is escaped, not merged, and
 * web links become clickable.
 */

import { describe, it, expect } from 'vitest';
import { renderTemplate, type TemplateContext } from './templates.ts';

function ctx(over: Partial<TemplateContext> = {}): TemplateContext {
  return {
    first_name: 'Sam',
    customer_name: 'Sam Taylor',
    template_name: 'Baby & Child First Aid',
    event_date: 'Saturday 3 October 2026',
    start_time: '10:00',
    venue: 'URC Fleet, Kings Road, GU51 3AJ',
    franchisee_name: 'Julie Rayson',
    franchisee_email: 'julie@example.com',
    booking_reference: 'DA-2026-00076-001',
    unsubscribe_url: 'https://example.com/unsub',
    ...over,
  };
}

const NOTE = 'Please sign in on the screen at reception to avoid a parking fine.';

describe('joining details', () => {
  for (const key of [
    'booking_confirmation',
    'day_before_reminder',
    'medical_reminder',
    'course_updated',
  ]) {
    it(`appear on ${key}`, () => {
      const out = renderTemplate(key, ctx({ joining_details: NOTE }));
      expect(out?.html).toContain('Joining details');
      expect(out?.html).toContain('sign in on the screen at reception');
      expect(out?.text).toContain(NOTE);
    });
  }

  it('never appear on the franchisee new-booking alert', () => {
    const out = renderTemplate('new_booking_notification', ctx({ joining_details: NOTE }));
    expect(out?.html).not.toContain('Joining details');
  });

  it('render nothing when blank', () => {
    const out = renderTemplate('day_before_reminder', ctx({ joining_details: '  ' }));
    expect(out?.html).not.toContain('Joining details');
  });

  it('escape markup and leave merge fields alone', () => {
    const out = renderTemplate(
      'booking_confirmation',
      ctx({ joining_details: '<b>Buzz flat 3</b> & ask for {{first_name}}' }),
    );
    expect(out?.html).toContain('&lt;b&gt;Buzz flat 3&lt;/b&gt; &amp; ask for {{first_name}}');
  });

  it('make web links clickable', () => {
    const out = renderTemplate(
      'day_before_reminder',
      ctx({ joining_details: 'Join here: https://zoom.us/j/123456789' }),
    );
    expect(out?.html).toContain('<a href="https://zoom.us/j/123456789"');
  });
});
