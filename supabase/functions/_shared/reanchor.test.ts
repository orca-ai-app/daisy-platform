// Re-anchoring queued emails when a class is re-dated or a booking is moved.
// Times follow _shared/emailSchedule.ts exactly, in BST and GMT.
import { describe, it, expect, vi } from 'vitest';
import {
  applyReanchor,
  isClassAnchored,
  journeyTimes,
  missingPreClassReminders,
  planReanchor,
  type QueuedRow,
} from './reanchor';
import { buildJourneyRows } from './emailSchedule';

const row = (id: string, template_key: string, scheduled_for: string): QueuedRow => ({
  id,
  template_key,
  scheduled_for,
});

// The prod case (6 Oct 2026): a class on Sat 29 Nov at 10:00 whose
// medical_reminder rows were queued for 11 and 18 Oct after it was re-dated.
const NOV29 = { eventDate: '2026-11-29', startTime: '10:00:00', endTime: '12:00:00' };
const NOW = new Date('2026-10-06T09:00:00Z');

describe('journeyTimes', () => {
  it('matches buildJourneyRows for every class-anchored key', () => {
    const times = journeyTimes(NOV29);
    const fresh = buildJourneyRows({
      customerId: 'c',
      bookingId: 'b',
      ...NOV29,
      now: NOW,
      set: 'full',
    }).filter((r) => isClassAnchored(r.template_key));
    expect(fresh.length).toBe(12);
    for (const r of fresh) expect(times.get(r.template_key)?.toISOString()).toBe(r.scheduled_for);
  });

  it('GMT: a 10:00 class on 29 Nov reminds at 08:00Z and the day before at 10:00Z', () => {
    const t = journeyTimes(NOV29);
    expect(t.get('medical_reminder')!.toISOString()).toBe('2026-11-29T08:00:00.000Z');
    expect(t.get('day_before_reminder')!.toISOString()).toBe('2026-11-28T10:00:00.000Z');
    expect(t.get('post_course_welcome')!.toISOString()).toBe('2026-11-29T19:00:00.000Z');
  });

  it('BST: a 10:00 class on 20 Oct is 09:00Z, so the reminder is 07:00Z', () => {
    const t = journeyTimes({ eventDate: '2026-10-20', startTime: '10:00', endTime: '12:00' });
    expect(t.get('medical_reminder')!.toISOString()).toBe('2026-10-20T07:00:00.000Z');
    expect(t.get('day_before_reminder')!.toISOString()).toBe('2026-10-19T09:00:00.000Z');
  });
});

describe('planReanchor', () => {
  it('fixes the prod medical_reminder rows queued for 11 and 18 Oct', () => {
    const plan = planReanchor(
      [
        row('a', 'medical_reminder', '2026-10-11T08:00:00Z'),
        row('b', 'medical_reminder', '2026-10-18T08:00:00Z'),
      ],
      NOV29,
      NOW,
    );
    expect(plan).toEqual([
      { id: 'a', action: 'reschedule', scheduled_for: '2026-11-29T08:00:00.000Z' },
      { id: 'b', action: 'reschedule', scheduled_for: '2026-11-29T08:00:00.000Z' },
    ]);
  });

  it('moving a BST class into GMT keeps the London wall-clock time', () => {
    // Was Tue 20 Oct 10:00 (BST), moved to Tue 3 Nov 10:00 (GMT).
    const plan = planReanchor(
      [
        row('m', 'medical_reminder', '2026-10-20T07:00:00Z'),
        row('d', 'day_before_reminder', '2026-10-19T09:00:00Z'),
        row('r', 'recap_cpr', '2027-03-23T11:00:00Z'),
      ],
      { eventDate: '2026-11-03', startTime: '10:00', endTime: '12:00' },
      NOW,
    );
    expect(plan).toEqual([
      { id: 'm', action: 'reschedule', scheduled_for: '2026-11-03T08:00:00.000Z' },
      { id: 'd', action: 'reschedule', scheduled_for: '2026-11-02T10:00:00.000Z' },
      { id: 'r', action: 'reschedule', scheduled_for: '2027-04-06T12:00:00.000Z' },
    ]);
  });

  it('leaves rows already at the right time, and every other key, alone', () => {
    const plan = planReanchor(
      [
        row('ok', 'medical_reminder', '2026-11-29T08:00:00.000Z'),
        row('n', 'new_booking_notification', '2026-10-01T09:00:00Z'),
        row('c', 'booking_confirmation', '2026-10-01T09:00:00Z'),
        row('u', 'course_updated', '2026-10-01T09:00:00Z'),
        row('x', 'checkout_recovery', '2026-10-01T09:00:00Z'),
      ],
      NOV29,
      NOW,
    );
    expect(plan).toEqual([]);
  });

  it('class brought forward to later today: the soon reminder goes now, the day-before is dropped', () => {
    // Now 09:00Z on 6 Oct (10:00 BST); class moved to 6 Oct 11:30 BST.
    const plan = planReanchor(
      [
        row('m', 'medical_reminder', '2026-10-20T07:00:00Z'),
        row('d', 'day_before_reminder', '2026-10-19T09:00:00Z'),
      ],
      { eventDate: '2026-10-06', startTime: '11:30', endTime: '13:30' },
      NOW,
    );
    expect(plan).toEqual([
      { id: 'm', action: 'reschedule', scheduled_for: NOW.toISOString() },
      { id: 'd', action: 'cancel' },
    ]);
  });

  it('class tomorrow and its day-before time has passed: the day-before goes now', () => {
    // Now 10:00 BST 6 Oct; class 7 Oct at 09:00 BST, so start − 24h has passed.
    const plan = planReanchor(
      [row('d', 'day_before_reminder', '2026-10-19T09:00:00Z')],
      { eventDate: '2026-10-07', startTime: '09:00', endTime: '11:00' },
      NOW,
    );
    expect(plan).toEqual([{ id: 'd', action: 'reschedule', scheduled_for: NOW.toISOString() }]);
  });

  it('class already started or moved into the past: reminders cancelled, past follow-ups skipped', () => {
    const plan = planReanchor(
      [
        row('m', 'medical_reminder', '2026-10-20T07:00:00Z'),
        row('w', 'post_course_welcome', '2026-10-20T18:00:00Z'),
        row('a', 'recap_anaphylaxis', '2026-11-17T11:00:00Z'),
        row('q', 'quiz_general', '2027-07-27T11:00:00Z'),
      ],
      // Moved back to 1 Sep: welcome and the 4-week recap are past, the quiz is not.
      { eventDate: '2026-09-01', startTime: '10:00', endTime: '12:00' },
      NOW,
    );
    expect(plan).toEqual([
      { id: 'm', action: 'cancel' },
      { id: 'w', action: 'cancel' },
      { id: 'a', action: 'cancel' },
      { id: 'q', action: 'reschedule', scheduled_for: '2027-06-08T11:00:00.000Z' },
    ]);
  });
});

describe('missingPreClassReminders', () => {
  it('an online booking moved to a later class gets both reminders it lacks', () => {
    expect(
      missingPreClassReminders([], ['day_before_reminder', 'medical_reminder'], NOV29, NOW),
    ).toEqual([
      { template_key: 'day_before_reminder', scheduled_for: '2026-11-28T10:00:00.000Z' },
      { template_key: 'medical_reminder', scheduled_for: '2026-11-29T08:00:00.000Z' },
    ]);
  });

  it('a booking added by the trainer gets the day-before only, and nothing it already has', () => {
    expect(
      missingPreClassReminders(['day_before_reminder'], ['day_before_reminder'], NOV29, NOW),
    ).toEqual([]);
    expect(missingPreClassReminders([], ['day_before_reminder'], NOV29, NOW)).toHaveLength(1);
  });

  it('nothing for a class that has already started', () => {
    expect(
      missingPreClassReminders(
        [],
        ['day_before_reminder', 'medical_reminder'],
        { eventDate: '2026-10-06', startTime: '09:00', endTime: '11:00' },
        NOW,
      ),
    ).toEqual([]);
  });
});

describe('applyReanchor', () => {
  it('groups writes by send time, cancels in one go, and only touches pending rows', async () => {
    const calls: Array<{ set: unknown; ids: string[]; status: string }> = [];
    const admin = {
      from: () => ({
        update: (set: unknown) => ({
          in: (_c: string, ids: string[]) => ({
            eq: vi.fn(async (_s: string, status: string) => {
              calls.push({ set, ids, status });
              return { error: null };
            }),
          }),
        }),
      }),
    };
    const res = await applyReanchor(admin, [
      { id: 'a', action: 'reschedule', scheduled_for: 'T1' },
      { id: 'b', action: 'reschedule', scheduled_for: 'T1' },
      { id: 'c', action: 'reschedule', scheduled_for: 'T2' },
      { id: 'd', action: 'cancel' },
    ]);
    expect(res).toEqual({ moved: 3, cancelled: 1, error: null });
    expect(calls).toEqual([
      { set: { scheduled_for: 'T1' }, ids: ['a', 'b'], status: 'pending' },
      { set: { scheduled_for: 'T2' }, ids: ['c'], status: 'pending' },
      { set: { status: 'cancelled' }, ids: ['d'], status: 'pending' },
    ]);
  });
});
