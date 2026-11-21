/**
 * "How did you hear about us?" answers (November batch, migration 073).
 * Mirrors supabase/functions/_shared/bookerExtras.ts and the widget's list in
 * daisy-booking/src/widget/bookerExtras.ts. Keep all three in step.
 */
const LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  google: 'Google search',
  daisy_website: 'The Daisy First Aid website',
  recommendation: 'Recommended by a friend or family member',
  nursery_school_workplace: 'Through a nursery, school or workplace',
  been_before: 'Been to a Daisy class before',
  other: 'Other',
};

/** "Facebook", or "Other: the school gate". '' when the booker didn't say. */
export function heardAboutLabel(
  heardAbout: string | null | undefined,
  other: string | null | undefined,
): string {
  if (!heardAbout || !(heardAbout in LABELS)) return '';
  const extra = (other ?? '').trim();
  return heardAbout === 'other' && extra ? `Other: ${extra}` : LABELS[heardAbout];
}
