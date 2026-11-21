/**
 * November batch (migration 073): what a booker can tell the trainer on the
 * class booking form, both optional.
 *
 * - "Who's coming?": names and emails of the people they are booking for
 *   (Feola, TRI-0046/0054/0086). Trainer-only booking information.
 * - "How did you hear about us?" (Hannah, TRI-0056).
 *
 * The option keys mirror the CHECK constraint in migration 073 and the
 * widget's list in daisy-booking/src/widget/bookerExtras.ts. Keep all three
 * in step.
 */

export const HEARD_ABOUT_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'google', label: 'Google search' },
  { key: 'daisy_website', label: 'The Daisy First Aid website' },
  { key: 'recommendation', label: 'Recommended by a friend or family member' },
  { key: 'nursery_school_workplace', label: 'Through a nursery, school or workplace' },
  { key: 'been_before', label: "I've been to a Daisy class before" },
  { key: 'other', label: 'Other' },
];

export const ATTENDEE_DETAILS_MAX = 2000;
export const HEARD_ABOUT_OTHER_MAX = 200;

export interface BookerExtras {
  attendee_details: string | null;
  heard_about: string | null;
  heard_about_other: string | null;
}

/**
 * Parse the optional fields from a checkout request. Never fails a booking:
 * an unknown source key or an over-long text is dropped or cut, not rejected,
 * because neither should ever stop someone paying for a class.
 */
export function parseBookerExtras(body: {
  attendee_details?: unknown;
  heard_about?: unknown;
  heard_about_other?: unknown;
}): BookerExtras {
  const text = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string') return null;
    const t = v.replace(/\r\n/g, '\n').trim();
    return t ? t.slice(0, max) : null;
  };
  const key = typeof body.heard_about === 'string' ? body.heard_about.trim() : '';
  const heardAbout = HEARD_ABOUT_OPTIONS.some((o) => o.key === key) ? key : null;
  return {
    attendee_details: text(body.attendee_details, ATTENDEE_DETAILS_MAX),
    heard_about: heardAbout,
    heard_about_other:
      heardAbout === 'other' ? text(body.heard_about_other, HEARD_ABOUT_OTHER_MAX) : null,
  };
}

/** "Facebook", or "Other: the school gate" for an Other answer. '' when none. */
export function heardAboutLabel(
  heardAbout: string | null | undefined,
  other: string | null | undefined,
): string {
  const opt = HEARD_ABOUT_OPTIONS.find((o) => o.key === heardAbout);
  if (!opt) return '';
  const extra = (other ?? '').trim();
  return opt.key === 'other' && extra ? `Other: ${extra}` : opt.label;
}
