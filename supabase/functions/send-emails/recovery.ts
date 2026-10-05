// send-emails/recovery.ts
//
// W4 abandoned checkout recovery. Pure decision logic for the one recovery
// email, so vitest can cover every guard. index.ts gathers the facts.

/** Minutes after expiry before the nudge goes (PRD W4: "~1h after expiry"). */
export const RECOVERY_DELAY_MINUTES = 60;

/** No nudge when the class starts sooner than this. */
export const RECOVERY_MIN_LEAD_HOURS = 2;

export interface RecoveryFacts {
  /** The abandoned booking's own payment status. Must still be 'failed'. */
  paymentStatus: string;
  courseStatus: string | null;
  /** 'YYYY-MM-DD' and 'HH:MM[:SS]', Europe/London wall clock. */
  eventDate: string | null;
  startTime: string | null;
  spotsRemaining: number;
  /** quantity × seats_consumed of the abandoned ticket. */
  seatsNeeded: number;
  stripeConnected: boolean;
  /** Customer opted out of marketing or is on the global suppression list. */
  suppressed: boolean;
  /** Paid, pending, or a later attempt by the same customer on the same class. */
  hasOtherBooking: boolean;
  /** A recovery email already went to this customer for this class. */
  alreadyNudged: boolean;
}

/** 'YYYY-MM-DD HH:MM' in Europe/London for the given instant. */
export function londonStamp(at: Date): string {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/**
 * Why the recovery email must NOT go, or null when it should. Every "no" is
 * final: the row is cancelled, never retried.
 */
export function recoverySkipReason(f: RecoveryFacts, now: Date): string | null {
  if (f.paymentStatus !== 'failed') return 'booking no longer abandoned';
  if (f.courseStatus !== 'scheduled') return 'class not open for booking';
  if (!f.eventDate || !f.startTime) return 'class has no date';
  const cutoff = londonStamp(new Date(now.getTime() + RECOVERY_MIN_LEAD_HOURS * 3_600_000));
  if (`${f.eventDate} ${f.startTime.slice(0, 5)}` <= cutoff) return 'class starts too soon';
  if (f.spotsRemaining < Math.max(1, f.seatsNeeded)) return 'not enough places left';
  if (!f.stripeConnected) return 'trainer cannot take card payments';
  if (f.suppressed) return 'customer opted out';
  if (f.hasOtherBooking) return 'customer booked or tried again';
  if (f.alreadyNudged) return 'already sent one for this class';
  return null;
}

/** 32 random bytes as hex: the resume link token. */
export function newResumeToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
