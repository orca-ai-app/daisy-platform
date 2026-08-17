/**
 * Class-length presets for the create-course wizard (G5, round 2).
 *
 * Choosing a length fills in the end time from the start time. Editing the end
 * time by hand still works and flips the select back to "Custom". This is a
 * form convenience only — nothing is persisted, the instance still stores
 * start_time and end_time.
 *
 * Times are wall-clock 'HH:MM' strings. addMinutes wraps within a single day
 * (a class that runs past midnight is not a real case here, and wrapping is
 * safer than producing "26:00").
 */

/** Preset lengths in minutes, in display order. 2 hours is the default. */
export const CLASS_LENGTH_OPTIONS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 60, label: '1 hour' },
  { minutes: 90, label: '1.5 hours' },
  { minutes: 120, label: '2 hours' },
  { minutes: 180, label: '3 hours' },
  { minutes: 360, label: '6 hours' },
  { minutes: 720, label: '12 hours' },
];

/** Select value used when the end time does not match any preset. */
export const CUSTOM_LENGTH = 'custom';

const TIME_RE = /^(\d{2}):(\d{2})$/;

/** Parse 'HH:MM' to minutes past midnight, or null when malformed. */
export function parseTimeToMinutes(time: string): number | null {
  const match = TIME_RE.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Format minutes past midnight back to 'HH:MM', wrapping at 24 hours. */
export function minutesToTime(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const hh = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const mm = String(wrapped % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * End time for a start time plus a length in minutes.
 * Returns null when the start time is missing or malformed.
 */
export function addMinutesToTime(startTime: string, minutes: number): string | null {
  const start = parseTimeToMinutes(startTime);
  if (start === null) return null;
  return minutesToTime(start + minutes);
}

/**
 * Derive the select value from the current start/end times: the matching
 * preset's minutes as a string, or 'custom' when nothing matches.
 */
export function deriveLengthValue(startTime: string, endTime: string): string {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start === null || end === null) return CUSTOM_LENGTH;
  // Wrap so an end time earlier in the day still yields a positive length.
  const span = (end - start) % 1440 === 0 && end !== start ? 1440 : (end - start + 1440) % 1440;
  const match = CLASS_LENGTH_OPTIONS.find((o) => o.minutes === span);
  return match ? String(match.minutes) : CUSTOM_LENGTH;
}
