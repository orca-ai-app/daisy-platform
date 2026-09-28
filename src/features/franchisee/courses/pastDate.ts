/**
 * Past-date warning for the class forms (Feola, 28 Sep 2026: a class created
 * on 26 Sep 2026 was dated 12 Oct 2025 by a mistyped year, and nothing said
 * so). Recording a class a few days after it ran is normal, so recent past
 * dates stay silent; anything more than 30 days back is almost always a wrong
 * year. It warns, it never blocks.
 */
import { formatInTimeZone } from 'date-fns-tz';

const LONDON = 'Europe/London';
const THRESHOLD_DAYS = 30;

export function pastDateWarning(date: string, now: Date = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const cutoff = formatInTimeZone(
    new Date(now.getTime() - THRESHOLD_DAYS * 24 * 60 * 60 * 1000),
    LONDON,
    'yyyy-MM-dd',
  );
  if (date >= cutoff) return null;
  const pretty = formatInTimeZone(new Date(`${date}T12:00:00Z`), LONDON, 'd MMMM yyyy');
  return `${pretty} is more than a month ago. Check the year is right before saving.`;
}
