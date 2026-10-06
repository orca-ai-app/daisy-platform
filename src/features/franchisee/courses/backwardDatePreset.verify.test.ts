/**
 * Julie, 6 Oct 2026: "Past only" showed nothing because Status stayed on its
 * Scheduled default while past classes are marked Completed overnight. A
 * past-only date choice now moves Status to All.
 */

import { describe, it, expect } from 'vitest';
import { isBackwardDatePreset } from './CoursesList';

const TODAY = new Date(2026, 9, 6); // 6 Oct 2026

describe('isBackwardDatePreset', () => {
  it('Past only and Last month look backwards', () => {
    expect(isBackwardDatePreset('past', TODAY)).toBe(true);
    expect(isBackwardDatePreset('last-month', TODAY)).toBe(true);
  });

  it('a named month before this one looks backwards, this month and later do not', () => {
    expect(isBackwardDatePreset('month:2026-09', TODAY)).toBe(true);
    expect(isBackwardDatePreset('month:2025-12', TODAY)).toBe(true);
    expect(isBackwardDatePreset('month:2026-10', TODAY)).toBe(false);
    expect(isBackwardDatePreset('month:2026-11', TODAY)).toBe(false);
  });

  it('forward-looking and open choices are left alone', () => {
    for (const v of ['all', 'upcoming', 'next-30-days', 'this-month', 'custom']) {
      expect(isBackwardDatePreset(v, TODAY)).toBe(false);
    }
  });
});
