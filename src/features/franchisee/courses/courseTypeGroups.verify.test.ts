/**
 * Round 2 peer test — course-type groupings (G7).
 *
 * The filter maps the 12 seeded templates (migration 025) into five
 * franchisee-facing groups. These tests pin the mapping for every seeded
 * name, and check the graceful fallbacks: an unrecognised name lands in
 * "Other course types", and empty groups are never offered.
 */

import { describe, it, expect } from 'vitest';
import { buildCourseTypeGroups, classifyTemplate } from './courseTypeGroups';
import type { CourseTemplateOption } from './types';

/** Minimal template factory — only name + duration drive classification. */
function template(
  name: string,
  duration_hours: number,
  id = name.toLowerCase().replace(/\s+/g, '-'),
): CourseTemplateOption {
  return {
    id,
    name,
    slug: id,
    duration_hours,
    default_price_pence: 3000,
    default_capacity: 12,
    age_range: null,
    certification: null,
    description: null,
    is_active: true,
    default_ticket_types: [],
  };
}

/** The catalogue from migration 025, verbatim. */
const SEEDED: ReadonlyArray<readonly [string, number]> = [
  ['Baby First Aid Essentials Class', 1],
  ['Baby and Child First Aid Class', 2],
  ['Baby and Child First Aid Class — Duty of Care', 2],
  ['Family First Aid Class', 2],
  ['Basic Life Saver Class', 2],
  ['Anaphylaxis Awareness Class', 1],
  ['Level 3 Emergency Paediatric First Aid Course', 6],
  ['Level 3 Blended Paediatric First Aid Course', 6],
  ['Emergency First Aid At Work', 6],
  ['First Aid At Work', 12],
  ['First Aid Class For Children', 1],
  ['Bespoke First Aid Class', 2],
];

describe('classifyTemplate — the seeded catalogue', () => {
  it.each([
    ['Level 3 Emergency Paediatric First Aid Course', 6, 'level-3-paediatric'],
    ['Level 3 Blended Paediatric First Aid Course', 6, 'level-3-paediatric'],
    ['Emergency First Aid At Work', 6, 'first-aid-at-work'],
    ['First Aid At Work', 12, 'first-aid-at-work'],
    ['Baby First Aid Essentials Class', 1, 'awareness-1h'],
    ['Anaphylaxis Awareness Class', 1, 'awareness-1h'],
    ['First Aid Class For Children', 1, 'awareness-1h'],
    ['Baby and Child First Aid Class', 2, 'awareness-2h'],
    ['Baby and Child First Aid Class — Duty of Care', 2, 'awareness-2h'],
    ['Family First Aid Class', 2, 'awareness-2h'],
    ['Basic Life Saver Class', 2, 'awareness-2h'],
    ['Bespoke First Aid Class', 2, 'bespoke'],
  ])('%s (%ih) -> %s', (name, hours, expected) => {
    expect(classifyTemplate({ name, duration_hours: hours })).toBe(expected);
  });

  it('is case-insensitive', () => {
    expect(classifyTemplate({ name: 'BESPOKE FIRST AID CLASS', duration_hours: 2 })).toBe(
      'bespoke',
    );
    expect(classifyTemplate({ name: 'first aid at work', duration_hours: 12 })).toBe(
      'first-aid-at-work',
    );
  });

  it('groups the older catalogue names sensibly too', () => {
    expect(classifyTemplate({ name: 'Corporate Bespoke', duration_hours: 2 })).toBe('bespoke');
    expect(classifyTemplate({ name: 'Emergency Paediatric First Aid', duration_hours: 6 })).toBe(
      'level-3-paediatric',
    );
    expect(
      classifyTemplate({ name: 'Paediatric First Aid (Award of Worth)', duration_hours: 12 }),
    ).toBe('level-3-paediatric');
  });

  it('falls back to "other" for an unrecognised long class', () => {
    expect(classifyTemplate({ name: 'Wilderness Survival Weekend', duration_hours: 20 })).toBe(
      'other',
    );
  });

  it('leans on the name when duration is missing', () => {
    expect(classifyTemplate({ name: 'Baby First Aid Essentials Class' })).toBe('awareness-1h');
    expect(classifyTemplate({ name: 'Family First Aid Class', duration_hours: null })).toBe(
      'awareness-2h',
    );
  });
});

describe('buildCourseTypeGroups', () => {
  const templates = SEEDED.map(([name, hours]) => template(name, hours));

  it('offers exactly the five groups for the seeded catalogue (no "Other")', () => {
    const groups = buildCourseTypeGroups(templates);
    expect(groups.map((g) => g.id)).toEqual([
      'level-3-paediatric',
      'first-aid-at-work',
      'awareness-1h',
      'awareness-2h',
      'bespoke',
    ]);
  });

  it('uses the client-facing labels', () => {
    const groups = buildCourseTypeGroups(templates);
    expect(groups.map((g) => g.label)).toEqual([
      'Level 3 Paediatric First Aid (includes EPFA and PFA)',
      'Level 3 First Aid at Work (includes EFAW and FAW)',
      'Awareness classes, 1 hour',
      'Awareness classes, 2 hours',
      'Bespoke and private classes',
    ]);
  });

  it('covers every template exactly once', () => {
    const groups = buildCourseTypeGroups(templates);
    const ids = groups.flatMap((g) => g.templateIds);
    expect(ids).toHaveLength(templates.length);
    expect(new Set(ids).size).toBe(templates.length);
  });

  it('adds "Other course types" last, only when something is unmatched', () => {
    const groups = buildCourseTypeGroups([
      ...templates,
      template('Wilderness Survival Weekend', 20, 'wilderness'),
    ]);
    expect(groups[groups.length - 1]).toMatchObject({
      id: 'other',
      label: 'Other course types',
      templateIds: ['wilderness'],
    });
  });

  it('omits groups with no templates', () => {
    const groups = buildCourseTypeGroups([template('Bespoke First Aid Class', 2, 'bespoke-id')]);
    expect(groups).toEqual([
      expect.objectContaining({ id: 'bespoke', templateIds: ['bespoke-id'] }),
    ]);
  });

  it('returns nothing when there are no templates', () => {
    expect(buildCourseTypeGroups([])).toEqual([]);
  });
});
