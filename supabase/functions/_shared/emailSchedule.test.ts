/**
 * Unit tests for the shared journey builder — the timing-anchor fix.
 * Chris's spec: welcome fires 7 HOURS AFTER THE SESSION ENDS (not 07:00 on the
 * class day), medical_reminder 1h before the session starts, recaps at
 * end + N days. Europe/London wall clock → UTC, BST-safe.
 */
import { describe, it, expect } from 'vitest';
import { buildJourneyRows, londonToUtc } from './emailSchedule';

const BASE = {
  customerId: 'c-1',
  bookingId: 'b-1',
};

describe('londonToUtc', () => {
  it('BST (July): 10:00 London = 09:00 UTC', () => {
    expect(londonToUtc('2026-07-20', '10:00:00').toISOString()).toBe('2026-07-20T09:00:00.000Z');
  });
  it('GMT (January): 10:00 London = 10:00 UTC', () => {
    expect(londonToUtc('2026-01-20', '10:00:00').toISOString()).toBe('2026-01-20T10:00:00.000Z');
  });
  it('accepts HH:MM', () => {
    expect(londonToUtc('2026-01-20', '18:30').toISOString()).toBe('2026-01-20T18:30:00.000Z');
  });
});

describe('buildJourneyRows — full set (booker at payment)', () => {
  // Class: Mon 20 Jul 2026 (BST), 10:00–18:00 London → 09:00–17:00 UTC.
  const now = new Date('2026-07-01T12:00:00Z');
  const rows = buildJourneyRows({
    ...BASE,
    eventDate: '2026-07-20',
    startTime: '10:00:00',
    endTime: '18:00:00',
    now,
    set: 'full',
  });
  const byKey = Object.fromEntries(rows.map((r) => [r.template_key, r.scheduled_for]));

  it('immediate pair scheduled at booking time', () => {
    expect(byKey.new_booking_notification).toBe(now.toISOString());
    expect(byKey.booking_confirmation).toBe(now.toISOString());
  });

  it('medical_reminder = start − 1h (BST-corrected)', () => {
    // start 09:00 UTC → reminder 08:00 UTC
    expect(byKey.medical_reminder).toBe('2026-07-20T08:00:00.000Z');
  });

  it('post_course_welcome = end + 7h — AFTER the session, same evening', () => {
    // end 17:00 UTC → welcome 2026-07-21T00:00 UTC (which is 01:00 London — evening+7h)
    expect(byKey.post_course_welcome).toBe('2026-07-21T00:00:00.000Z');
  });

  it('recap_anaphylaxis = end + 28 days', () => {
    expect(byKey.recap_anaphylaxis).toBe('2026-08-17T17:00:00.000Z');
  });

  it('queues all 13 keys', () => {
    expect(rows).toHaveLength(13);
  });
});

describe('buildJourneyRows — post_course set (attendee from medical form)', () => {
  const now = new Date('2026-07-20T12:00:00Z'); // during the class
  const rows = buildJourneyRows({
    ...BASE,
    eventDate: '2026-07-20',
    startTime: '10:00:00',
    endTime: '18:00:00',
    now,
    set: 'post_course',
  });
  const keys = rows.map((r) => r.template_key);

  it('excludes the transactional pair and the pre-class reminder', () => {
    expect(keys).not.toContain('booking_confirmation');
    expect(keys).not.toContain('new_booking_notification');
    expect(keys).not.toContain('medical_reminder');
  });

  it('includes the 10-step post-course journey', () => {
    expect(keys).toEqual([
      'post_course_welcome',
      'recap_anaphylaxis',
      'recap_choking',
      'recap_head_injuries',
      'recap_cpr',
      'recap_febrile_convulsions',
      'recap_burns',
      'quiz_general',
      'refresher',
      'refresher_elearning_option',
    ]);
  });
});

describe('past-dropping', () => {
  it('drops medical_reminder when booking happens after start−1h', () => {
    const rows = buildJourneyRows({
      ...BASE,
      eventDate: '2026-07-20',
      startTime: '10:00:00',
      endTime: '18:00:00',
      now: new Date('2026-07-20T08:30:00Z'), // 30 min before class
      set: 'full',
    });
    expect(rows.map((r) => r.template_key)).not.toContain('medical_reminder');
  });

  it('drops already-past recaps for a late form submission', () => {
    const rows = buildJourneyRows({
      ...BASE,
      eventDate: '2026-01-10',
      startTime: '10:00:00',
      endTime: '12:00:00',
      now: new Date('2026-03-15T12:00:00Z'), // 9+ weeks later
      set: 'post_course',
    });
    const keys = rows.map((r) => r.template_key);
    expect(keys).not.toContain('post_course_welcome');
    expect(keys).not.toContain('recap_anaphylaxis'); // day 28 — past
    expect(keys).toContain('recap_choking'); // day 70 — future
  });
});
