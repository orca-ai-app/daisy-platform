/**
 * Add booking (TRI-0065, Nicola): classes that have already run sit behind an
 * "Already run" switch instead of at the bottom of a long upcoming list.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { isRunClass } from './AddBookingDialog';

describe('isRunClass', () => {
  it('a class before today has already run', () => {
    expect(isRunClass('2026-10-10', '2026-10-14')).toBe(true);
  });
  it("today's and future classes are upcoming", () => {
    expect(isRunClass('2026-10-14', '2026-10-14')).toBe(false);
    expect(isRunClass('2026-12-19', '2026-10-14')).toBe(false);
  });
});
