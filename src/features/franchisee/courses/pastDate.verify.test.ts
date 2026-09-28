import { describe, it, expect } from 'vitest';
import { pastDateWarning } from './pastDate';

const now = new Date('2026-09-28T10:00:00Z');

describe('pastDateWarning', () => {
  it('warns on a mistyped year', () => {
    expect(pastDateWarning('2025-10-12', now)).toBe(
      '12 October 2025 is more than a month ago. Check the year is right before saving.',
    );
  });
  it('stays silent for a class recorded a few days late', () => {
    expect(pastDateWarning('2026-09-19', now)).toBeNull();
  });
  it('stays silent for today and future dates', () => {
    expect(pastDateWarning('2026-09-28', now)).toBeNull();
    expect(pastDateWarning('2026-12-01', now)).toBeNull();
  });
  it('ignores an empty or partial date', () => {
    expect(pastDateWarning('', now)).toBeNull();
    expect(pastDateWarning('2026-09', now)).toBeNull();
  });
});
