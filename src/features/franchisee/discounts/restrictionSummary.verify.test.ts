/**
 * Round 2 (G10) — course-type restriction summary.
 *
 * `restrictionSummary` is the single source of the wording shown in both the
 * codes list and the edit dialog, so the "NULL/empty = everything" semantics
 * are pinned here. Enforcement at checkout lives in create-checkout-session and
 * is NOT covered by these tests.
 */

import { describe, it, expect } from 'vitest';
import { restrictionSummary, type DiscountCourseType } from './types';

const TYPES: DiscountCourseType[] = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Baby & Child First Aid (2hr)' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Baby & Child First Aid (1hr)' },
];

describe('restrictionSummary', () => {
  it('reads NULL as valid on every course type', () => {
    expect(restrictionSummary(null, TYPES)).toBe('All course types');
  });

  it('reads undefined as valid on every course type', () => {
    expect(restrictionSummary(undefined, TYPES)).toBe('All course types');
  });

  it('reads an empty array as valid on every course type', () => {
    expect(restrictionSummary([], TYPES)).toBe('All course types');
  });

  it('names a single restricted course type', () => {
    expect(restrictionSummary([TYPES[1].id], TYPES)).toBe('Baby & Child First Aid (1hr)');
  });

  it('lists several restricted course types in the order given', () => {
    expect(restrictionSummary([TYPES[0].id, TYPES[1].id], TYPES)).toBe(
      'Baby & Child First Aid (2hr), Baby & Child First Aid (1hr)',
    );
  });

  it('never silently under-reports a template that has since been retired', () => {
    const summary = restrictionSummary([TYPES[0].id, 'deleted-template-id'], TYPES);
    expect(summary).toBe('Baby & Child First Aid (2hr), 1 removed type');
  });

  it('pluralises multiple retired templates', () => {
    const summary = restrictionSummary(['gone-a', 'gone-b'], TYPES);
    expect(summary).toBe('2 removed types');
  });

  it('does not claim "all course types" when every id is unknown', () => {
    // A restricted code whose templates all vanished is still restricted —
    // reading it as unrestricted would be the dangerous failure mode.
    expect(restrictionSummary(['gone-a'], [])).not.toBe('All course types');
  });
});
