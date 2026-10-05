// W4 abandoned checkout recovery (migration 066): every guard on the one
// recovery email, and the email itself.
import { describe, it, expect } from 'vitest';
import { recoverySkipReason, londonStamp, newResumeToken, type RecoveryFacts } from './recovery';
import { renderTemplate, type TemplateContext } from './templates';

// 10:00 BST on Mon 5 Oct 2026.
const NOW = new Date('2026-10-05T09:00:00Z');

const OK: RecoveryFacts = {
  paymentStatus: 'failed',
  courseStatus: 'scheduled',
  eventDate: '2026-10-20',
  startTime: '10:00:00',
  spotsRemaining: 8,
  seatsNeeded: 2,
  stripeConnected: true,
  suppressed: false,
  hasOtherBooking: false,
  alreadyNudged: false,
};

describe('recoverySkipReason', () => {
  it('sends when every guard passes', () => {
    expect(recoverySkipReason(OK, NOW)).toBeNull();
  });

  it.each([
    [{ paymentStatus: 'paid' }, 'booking no longer abandoned'],
    [{ courseStatus: 'cancelled' }, 'class not open for booking'],
    [{ courseStatus: 'completed' }, 'class not open for booking'],
    [{ eventDate: '2026-10-05', startTime: '11:30:00' }, 'class starts too soon'],
    [{ eventDate: '2026-10-04' }, 'class starts too soon'],
    [{ spotsRemaining: 1 }, 'not enough places left'],
    [{ stripeConnected: false }, 'trainer cannot take card payments'],
    [{ suppressed: true }, 'customer opted out'],
    [{ hasOtherBooking: true }, 'customer booked or tried again'],
    [{ alreadyNudged: true }, 'already sent one for this class'],
  ])('skips when %o', (patch, reason) => {
    expect(recoverySkipReason({ ...OK, ...patch } as RecoveryFacts, NOW)).toBe(reason);
  });

  it('still sends for a class later the same day', () => {
    expect(
      recoverySkipReason({ ...OK, eventDate: '2026-10-05', startTime: '12:30:00' }, NOW),
    ).toBeNull();
  });
});

describe('londonStamp', () => {
  it('uses UK wall-clock time in summer and winter', () => {
    expect(londonStamp(new Date('2026-07-01T09:00:00Z'))).toBe('2026-07-01 10:00');
    expect(londonStamp(new Date('2026-12-01T09:00:00Z'))).toBe('2026-12-01 09:00');
  });
});

describe('newResumeToken', () => {
  it('is 64 hex characters and unique', () => {
    const a = newResumeToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newResumeToken()).not.toBe(a);
  });
});

describe('checkout_recovery email', () => {
  const ctx: TemplateContext = {
    first_name: 'Amber',
    customer_name: 'Amber Jones',
    template_name: 'Baby & Child First Aid',
    event_date: 'Tuesday 20 October 2026',
    start_time: '10:00',
    venue: 'Guildford Hall, GU1 1AA',
    franchisee_name: 'Feola',
    franchisee_email: 'feola@daisyfirstaid.com',
    booking_reference: 'DA-2026-00031-900',
    unsubscribe_url: 'https://example.com/unsub',
    resume_url: 'https://booking.daisyfirstaid.com/book/tok?resume=abc',
  };
  const out = renderTemplate('checkout_recovery', ctx)!;

  it('carries the class details and the resume link', () => {
    expect(out.subject).toBe('Your place on Baby & Child First Aid is still available');
    expect(out.html).toContain('href="https://booking.daisyfirstaid.com/book/tok?resume=abc"');
    expect(out.html).toContain('Finish my booking');
    expect(out.html).toContain('Tuesday 20 October 2026 at 10:00');
    expect(out.text).toContain('https://booking.daisyfirstaid.com/book/tok?resume=abc');
    expect(out.html).toContain('nothing has been charged');
  });

  it('has the right footer reason and no booking reference', () => {
    expect(out.html).toContain('you started a booking with Daisy First Aid');
    expect(out.html).not.toContain('DA-2026-00031-900');
  });
});
