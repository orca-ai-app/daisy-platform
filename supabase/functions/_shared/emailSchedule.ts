// _shared/emailSchedule.ts
//
// Builds da_email_sequences rows for the Daisy post-course journey, anchored to
// the course's REAL start/end times (Europe/London wall clock) — not midnight.
// Replaces the webhook-local builder whose midnight anchor made
// post_course_welcome ("+7h after the session ends") fire at 07:00 BEFORE the
// class, and medical_reminder ("1h before") fire the previous evening.
//
// Schedule (docs/M3-email-journey.md — Jenni's Kartra journey):
//   booking time:  new_booking_notification (→ franchisee), booking_confirmation
//   start − 1h:    medical_reminder (only when still in the future)
//   end + 7h:      post_course_welcome
//   end + N days:  recap_anaphylaxis 28 · recap_choking 70 · recap_head_injuries 112
//                  recap_cpr 154 · recap_febrile_convulsions 196 · recap_burns 238
//                  quiz_general 280 · refresher 322 · refresher_elearning_option 329
//
// Pure module: no Deno globals, so vitest can unit-test it directly.

export interface SequenceRow {
  customer_id: string;
  booking_id: string;
  template_key: string;
  sequence_day: number;
  scheduled_for: string;
  status: 'pending';
}

export type JourneySet = 'full' | 'post_course';

// Minutes that Europe/London is ahead of UTC at the given instant (0 in GMT,
// 60 in BST). Uses Intl so DST rules stay correct without a tz database.
function londonOffsetMinutes(at: Date): number {
  const part =
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/London',
      timeZoneName: 'shortOffset',
    })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = part.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!m) return 0;
  const hours = parseInt(m[1], 10);
  const mins = m[2] ? parseInt(m[2], 10) : 0;
  return hours * 60 + (hours < 0 ? -mins : mins);
}

/**
 * Convert a Europe/London wall-clock date+time ('YYYY-MM-DD', 'HH:MM[:SS]')
 * to a UTC Date. A 10:00 class in July is 09:00 UTC; in January it's 10:00 UTC.
 */
export function londonToUtc(dateStr: string, timeStr: string | null): Date {
  const t = timeStr ?? '00:00:00';
  const normalised = /^\d{2}:\d{2}$/.test(t) ? `${t}:00` : t.slice(0, 8);
  const guess = new Date(`${dateStr}T${normalised}Z`);
  const offset = londonOffsetMinutes(guess);
  return new Date(guess.getTime() - offset * 60_000);
}

function plusHours(d: Date, h: number): Date {
  return new Date(d.getTime() + h * 3_600_000);
}
function plusDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

export interface JourneyInput {
  customerId: string;
  bookingId: string;
  /** 'YYYY-MM-DD' (Postgres DATE) */
  eventDate: string;
  /** 'HH:MM:SS' Postgres TIME, Europe/London wall clock. Null → midnight fallback. */
  startTime: string | null;
  endTime: string | null;
  /** Reference "now" — rows scheduled in the past (except the immediate pair) are dropped. */
  now: Date;
  set: JourneySet;
}

const POST_COURSE: Array<{ key: string; days: number }> = [
  { key: 'recap_anaphylaxis', days: 28 },
  { key: 'recap_choking', days: 70 },
  { key: 'recap_head_injuries', days: 112 },
  { key: 'recap_cpr', days: 154 },
  { key: 'recap_febrile_convulsions', days: 196 },
  { key: 'recap_burns', days: 238 },
  { key: 'quiz_general', days: 280 },
  { key: 'refresher', days: 322 },
  { key: 'refresher_elearning_option', days: 329 },
];

export function buildJourneyRows(input: JourneyInput): SequenceRow[] {
  const { customerId, bookingId, eventDate, startTime, endTime, now, set } = input;
  const startUtc = londonToUtc(eventDate, startTime);
  // If end_time is missing, assume a 2-hour class (Daisy's most common length).
  const endUtc = endTime ? londonToUtc(eventDate, endTime) : plusHours(startUtc, 2);

  const rows: SequenceRow[] = [];
  const push = (template_key: string, when: Date, sequence_day: number) => {
    rows.push({
      customer_id: customerId,
      booking_id: bookingId,
      template_key,
      sequence_day,
      scheduled_for: when.toISOString(),
      status: 'pending',
    });
  };

  if (set === 'full') {
    // Immediate transactional pair (send now regardless of event timing).
    push('new_booking_notification', now, 0);
    push('booking_confirmation', now, 0);

    // Pre-class reminder — only if that moment is still ahead of us.
    const reminderAt = plusHours(startUtc, -1);
    if (reminderAt.getTime() > now.getTime()) {
      push('medical_reminder', reminderAt, 0);
    }
  }

  // Post-course journey (both sets). Skip anything already in the past — an
  // attendee filling the form weeks later shouldn't get a burst of stale recaps.
  const welcomeAt = plusHours(endUtc, 7);
  if (welcomeAt.getTime() > now.getTime()) push('post_course_welcome', welcomeAt, 0);
  for (const step of POST_COURSE) {
    const at = plusDays(endUtc, step.days);
    if (at.getTime() > now.getTime()) push(step.key, at, step.days);
  }

  return rows;
}
