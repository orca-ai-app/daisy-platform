/**
 * Course-type groupings for the /franchisee/courses filter (G7, round 2).
 *
 * The filter used to list all 12 raw template names, which was both long and
 * full of jargon ("Level 3 Blended Paediatric First Aid Course"). Franchisees
 * think in five buckets, so the filter now offers those and maps each one back
 * to the underlying template ids.
 *
 * Matching is by template NAME, case-insensitive, using keyword rules rather
 * than a hard-coded id or slug list — templates are seeded per environment
 * (migration 025) and HQ can add more, so ids are not stable and a name that
 * does not match must still be reachable. Anything unmatched falls into the
 * trailing "Other course types" group, which is only offered when it is
 * non-empty.
 *
 * The canonical catalogue (migration 025) maps as:
 *   level-3-paediatric  Level 3 Emergency Paediatric First Aid Course
 *                       Level 3 Blended Paediatric First Aid Course
 *   first-aid-at-work   Emergency First Aid At Work
 *                       First Aid At Work
 *   awareness-1h        Baby First Aid Essentials Class          (1h)
 *                       Anaphylaxis Awareness Class              (1h)
 *                       First Aid Class For Children             (1h)
 *   awareness-2h        Baby and Child First Aid Class           (2h)
 *                       Baby and Child First Aid Class — Duty of Care (2h)
 *                       Family First Aid Class                   (2h)
 *                       Basic Life Saver Class                   (2h)
 *   bespoke             Bespoke First Aid Class
 */

import type { CourseTemplateOption } from './types';

/** Stable filter values persisted in the URL / localStorage. */
export type CourseTypeGroupId =
  | 'level-3-paediatric'
  | 'first-aid-at-work'
  | 'awareness-1h'
  | 'awareness-2h'
  | 'bespoke'
  | 'other';

export interface CourseTypeGroup {
  id: CourseTypeGroupId;
  label: string;
  /** Template ids belonging to this group, resolved from the live templates. */
  templateIds: string[];
}

/** Group definitions in display order. Labels are customer-facing copy. */
const GROUP_LABELS: ReadonlyArray<{ id: CourseTypeGroupId; label: string }> = [
  { id: 'level-3-paediatric', label: 'Level 3 Paediatric First Aid (includes EPFA and PFA)' },
  { id: 'first-aid-at-work', label: 'Level 3 First Aid at Work (includes EFAW and FAW)' },
  { id: 'awareness-1h', label: 'Awareness classes, 1 hour' },
  { id: 'awareness-2h', label: 'Awareness classes, 2 hours' },
  { id: 'bespoke', label: 'Bespoke and private classes' },
  { id: 'other', label: 'Other course types' },
];

/**
 * Classify a single template into a group.
 *
 * Order matters: the Level 3 / at-work rules are checked before the duration
 * rules, because those courses are 6h and 12h and would otherwise fall through
 * to "other". Awareness classes are then split on duration_hours, with a
 * name-based fallback for templates whose duration is missing or unusual.
 */
export function classifyTemplate(template: {
  name: string;
  duration_hours?: number | null;
}): CourseTypeGroupId {
  const name = template.name.toLowerCase();
  const hours = typeof template.duration_hours === 'number' ? template.duration_hours : null;

  // Bespoke / private / corporate — checked first so "Corporate Bespoke" does
  // not get pulled into a duration bucket.
  if (name.includes('bespoke') || name.includes('private') || name.includes('corporate')) {
    return 'bespoke';
  }

  // Workplace courses: EFAW / FAW. "at work" covers both seeded names.
  if (name.includes('at work') || name.includes('efaw') || name.includes('faw')) {
    return 'first-aid-at-work';
  }

  // Paediatric qualifications: EPFA / PFA / Level 3 / Award of Worth.
  if (
    name.includes('paediatric') ||
    name.includes('pediatric') ||
    name.includes('epfa') ||
    name.includes('pfa') ||
    name.includes('level 3')
  ) {
    return 'level-3-paediatric';
  }

  // Everything else is an awareness class, split by length.
  if (hours !== null) {
    if (hours <= 1) return 'awareness-1h';
    if (hours <= 2) return 'awareness-2h';
    // Longer, non-qualification classes have no natural home.
    return 'other';
  }

  // No duration recorded — lean on the name.
  if (name.includes('essentials') || name.includes('anaphylaxis')) return 'awareness-1h';
  if (name.includes('class')) return 'awareness-2h';
  return 'other';
}

/**
 * Build the filter's group list from the live templates. Groups with no
 * matching template are omitted, so the filter never offers a dead option.
 */
export function buildCourseTypeGroups(templates: CourseTemplateOption[]): CourseTypeGroup[] {
  const byGroup = new Map<CourseTypeGroupId, string[]>();
  for (const template of templates) {
    const groupId = classifyTemplate(template);
    const existing = byGroup.get(groupId);
    if (existing) existing.push(template.id);
    else byGroup.set(groupId, [template.id]);
  }

  return GROUP_LABELS.filter((g) => (byGroup.get(g.id)?.length ?? 0) > 0).map((g) => ({
    id: g.id,
    label: g.label,
    templateIds: byGroup.get(g.id) ?? [],
  }));
}
