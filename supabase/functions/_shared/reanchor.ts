// _shared/reanchor.ts
//
// Moves a booking's queued journey emails onto a class's (new) date and times,
// using exactly the timings _shared/emailSchedule.ts gives a fresh booking.
// Used when a class is re-dated (update-course-instance) and when a booking is
// moved to another class (transfer-booking). Without it the reminders kept
// their old send times while rendering the new class's details, e.g. a
// medical_reminder for a 29 Nov class going out on 11 Oct.
//
// Only the class-anchored keys are touched. The booking-time pair
// (new_booking_notification, booking_confirmation), course_updated and
// checkout_recovery are left exactly as they are, as is anything already sent.
//
// When a re-anchored time has already passed:
//   - medical_reminder: sent now if the class has not started, else cancelled;
//   - day_before_reminder: sent now only if the class is tomorrow (Europe/
//     London), since its wording says "tomorrow", else cancelled;
//   - post-course rows: cancelled, never burst-sent.
//
// Pure module apart from applyReanchor, which takes the client as a
// parameter: no Deno globals, so vitest can test it directly.

import { buildJourneyRows, londonToUtc } from './emailSchedule.ts';

export const PRE_CLASS_KEYS = ['day_before_reminder', 'medical_reminder'] as const;
export const POST_COURSE_KEYS = [
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
] as const;

const PRE = new Set<string>(PRE_CLASS_KEYS);
const POST = new Set<string>(POST_COURSE_KEYS);

/** Keys whose send time follows the class. Everything else is left alone. */
export function isClassAnchored(key: string): boolean {
  return PRE.has(key) || POST.has(key);
}

export interface ClassTimes {
  /** 'YYYY-MM-DD' */
  eventDate: string;
  /** 'HH:MM[:SS]' Europe/London, or null */
  startTime: string | null;
  endTime: string | null;
}

/**
 * When each class-anchored email is due for this class, straight from
 * buildJourneyRows (asked with a "now" at the epoch so nothing is dropped).
 */
export function journeyTimes(cls: ClassTimes): Map<string, Date> {
  const rows = buildJourneyRows({
    customerId: '-',
    bookingId: '-',
    eventDate: cls.eventDate,
    startTime: cls.startTime,
    endTime: cls.endTime,
    now: new Date(0),
    set: 'full',
  });
  const out = new Map<string, Date>();
  for (const r of rows) {
    if (isClassAnchored(r.template_key)) out.set(r.template_key, new Date(r.scheduled_for));
  }
  return out;
}

function londonDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(at);
}

/** The London calendar date the day after `at`. */
function londonTomorrow(at: Date): string {
  const [y, m, d] = londonDate(at).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * When a class-anchored email should now go, or null when it should not go
 * at all (cancelled). `due` is its re-anchored time.
 */
export function sendTimeFor(key: string, due: Date, cls: ClassTimes, now: Date): Date | null {
  if (due.getTime() > now.getTime()) return due;
  if (POST.has(key)) return null;
  const start = londonToUtc(cls.eventDate, cls.startTime);
  if (start.getTime() <= now.getTime()) return null;
  if (key === 'medical_reminder') return now;
  // day_before_reminder: its copy says "tomorrow", so only when it is.
  return cls.eventDate === londonTomorrow(now) ? now : null;
}

export interface QueuedRow {
  id: string;
  template_key: string;
  scheduled_for: string;
}

export type ReanchorDecision =
  | { id: string; action: 'reschedule'; scheduled_for: string }
  | { id: string; action: 'cancel' };

/**
 * What to do with each still-pending row so it follows the class. Rows that
 * are not class-anchored, or already due at the right time, are left out.
 */
export function planReanchor(rows: QueuedRow[], cls: ClassTimes, now: Date): ReanchorDecision[] {
  const times = journeyTimes(cls);
  const out: ReanchorDecision[] = [];
  for (const r of rows) {
    const due = times.get(r.template_key);
    if (!due) continue;
    const at = sendTimeFor(r.template_key, due, cls, now);
    if (!at) {
      out.push({ id: r.id, action: 'cancel' });
      continue;
    }
    if (new Date(r.scheduled_for).getTime() === at.getTime()) continue;
    out.push({ id: r.id, action: 'reschedule', scheduled_for: at.toISOString() });
  }
  return out;
}

/**
 * Pre-class reminders a booking should have for this class but has no pending
 * row for (e.g. a booking moved to a later class after its day-before reminder
 * had already gone). `want` is which reminders this booking gets at all: an
 * online booking gets both, one added by the trainer only the day-before.
 */
export function missingPreClassReminders(
  pendingKeys: Iterable<string>,
  want: ReadonlyArray<(typeof PRE_CLASS_KEYS)[number]>,
  cls: ClassTimes,
  now: Date,
): Array<{ template_key: string; scheduled_for: string }> {
  const have = new Set(pendingKeys);
  const times = journeyTimes(cls);
  const out: Array<{ template_key: string; scheduled_for: string }> = [];
  for (const key of want) {
    if (have.has(key)) continue;
    const due = times.get(key);
    if (!due) continue;
    const at = sendTimeFor(key, due, cls, now);
    if (at) out.push({ template_key: key, scheduled_for: at.toISOString() });
  }
  return out;
}

/**
 * Write a plan: one update per distinct send time (a class's recaps all share
 * a time, so a whole class is a handful of writes) plus one for cancellations.
 * Each write is guarded on status 'pending', so a row the cron sent meanwhile
 * is never touched. Returns how many rows were moved and cancelled.
 */
export async function applyReanchor(
  // deno-lint-ignore no-explicit-any
  admin: any,
  plan: ReanchorDecision[],
): Promise<{ moved: number; cancelled: number; error: string | null }> {
  const byTime = new Map<string, string[]>();
  const cancelIds: string[] = [];
  for (const d of plan) {
    if (d.action === 'cancel') cancelIds.push(d.id);
    else byTime.set(d.scheduled_for, [...(byTime.get(d.scheduled_for) ?? []), d.id]);
  }
  let error: string | null = null;
  for (const [at, ids] of byTime) {
    const r = await admin
      .from('da_email_sequences')
      .update({ scheduled_for: at })
      .in('id', ids)
      .eq('status', 'pending');
    if (r.error) error = r.error.message;
  }
  if (cancelIds.length > 0) {
    const r = await admin
      .from('da_email_sequences')
      .update({ status: 'cancelled' })
      .in('id', cancelIds)
      .eq('status', 'pending');
    if (r.error) error = r.error.message;
  }
  return { moved: plan.length - cancelIds.length, cancelled: cancelIds.length, error };
}
