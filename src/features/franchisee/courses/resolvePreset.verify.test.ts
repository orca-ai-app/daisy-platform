/**
 * Wave 7 VERIFIER peer test — CoursesList date-preset resolver.
 *
 * resolvePreset maps a UI preset to inclusive {from, to} 'YYYY-MM-DD' bounds
 * using integer y/m/d arithmetic (no UTC drift). System time is pinned so the
 * "today"-relative presets are deterministic.
 *
 * Pinned now: 2025-03-15 (local). With this anchor:
 *   - this-month  -> 2025-03-01 .. 2025-03-31
 *   - last-month  -> 2025-02-01 .. 2025-02-28 (non-leap)
 *   - all         -> {}
 *   - past        -> 2000-01-01 .. 2025-03-14 (yesterday, exclusive of today)
 *   - custom      -> echoes the provided bounds
 *
 * Year-rollback: pinned to 2025-01-10, last-month -> December 2024.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolvePreset } from './CoursesList';

describe('resolvePreset', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('anchored at 2025-03-15', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2025, 2, 15, 12, 0, 0)); // local 15 Mar 2025
    });

    it('all -> no bounds', () => {
      expect(resolvePreset('all')).toEqual({});
    });

    it('this-month -> first..last day of March', () => {
      expect(resolvePreset('this-month')).toEqual({ from: '2025-03-01', to: '2025-03-31' });
    });

    it('last-month -> February (28 days, non-leap)', () => {
      expect(resolvePreset('last-month')).toEqual({ from: '2025-02-01', to: '2025-02-28' });
    });

    it('past -> up to yesterday, exclusive of today', () => {
      expect(resolvePreset('past')).toEqual({ from: '2000-01-01', to: '2025-03-14' });
    });

    it('custom -> echoes provided bounds', () => {
      expect(resolvePreset('custom', '2025-05-01', '2025-05-31')).toEqual({
        from: '2025-05-01',
        to: '2025-05-31',
      });
    });
  });

  describe('year rollback', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2025, 0, 10, 12, 0, 0)); // local 10 Jan 2025
    });

    it('last-month rolls back to December 2024', () => {
      expect(resolvePreset('last-month')).toEqual({ from: '2024-12-01', to: '2024-12-31' });
    });

    it('this-month -> January 2025', () => {
      expect(resolvePreset('this-month')).toEqual({ from: '2025-01-01', to: '2025-01-31' });
    });
  });

  describe('leap year February', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2024, 2, 5, 12, 0, 0)); // local 5 Mar 2024 (leap)
    });

    it('last-month -> February 2024 has 29 days', () => {
      expect(resolvePreset('last-month')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    });
  });
});
