/**
 * Round 2 peer test — class-length presets (G5).
 *
 * Choosing a length fills the end time from the start time; editing the end
 * time by hand must flip the select back to "Custom". These are pure
 * wall-clock string helpers, no Date construction, so there is no timezone
 * dependence to worry about.
 */

import { describe, it, expect } from 'vitest';
import {
  CLASS_LENGTH_OPTIONS,
  CUSTOM_LENGTH,
  addMinutesToTime,
  deriveLengthValue,
  minutesToTime,
  parseTimeToMinutes,
} from './classLength';

describe('parseTimeToMinutes', () => {
  it('parses a valid wall-clock time', () => {
    expect(parseTimeToMinutes('09:30')).toBe(570);
    expect(parseTimeToMinutes('00:00')).toBe(0);
    expect(parseTimeToMinutes('23:59')).toBe(1439);
  });

  it('rejects malformed or out-of-range input', () => {
    expect(parseTimeToMinutes('')).toBeNull();
    expect(parseTimeToMinutes('9:30')).toBeNull();
    expect(parseTimeToMinutes('24:00')).toBeNull();
    expect(parseTimeToMinutes('09:60')).toBeNull();
  });
});

describe('minutesToTime', () => {
  it('formats with zero padding', () => {
    expect(minutesToTime(570)).toBe('09:30');
    expect(minutesToTime(0)).toBe('00:00');
  });

  it('wraps past midnight rather than producing "26:00"', () => {
    expect(minutesToTime(1440)).toBe('00:00');
    expect(minutesToTime(1500)).toBe('01:00');
  });
});

describe('addMinutesToTime', () => {
  it('adds each preset length', () => {
    expect(addMinutesToTime('09:30', 60)).toBe('10:30');
    expect(addMinutesToTime('09:30', 90)).toBe('11:00');
    expect(addMinutesToTime('09:30', 120)).toBe('11:30');
    expect(addMinutesToTime('09:00', 360)).toBe('15:00');
    expect(addMinutesToTime('09:00', 720)).toBe('21:00');
  });

  it('returns null when the start time is missing or malformed', () => {
    expect(addMinutesToTime('', 120)).toBeNull();
    expect(addMinutesToTime('nonsense', 120)).toBeNull();
  });
});

describe('deriveLengthValue', () => {
  it('recognises every preset', () => {
    for (const option of CLASS_LENGTH_OPTIONS) {
      const end = addMinutesToTime('09:00', option.minutes);
      expect(end).not.toBeNull();
      expect(deriveLengthValue('09:00', end as string)).toBe(String(option.minutes));
    }
  });

  it('reports custom for a hand-edited end time', () => {
    // 09:00 to 10:15 is 75 minutes, which is not a preset.
    expect(deriveLengthValue('09:00', '10:15')).toBe(CUSTOM_LENGTH);
  });

  it('reports custom while the times are still empty', () => {
    expect(deriveLengthValue('', '')).toBe(CUSTOM_LENGTH);
    expect(deriveLengthValue('09:00', '')).toBe(CUSTOM_LENGTH);
  });

  it('defaults the 2-hour preset to 120 minutes', () => {
    expect(deriveLengthValue('10:00', '12:00')).toBe('120');
  });

  it('does not treat an equal start and end as a preset', () => {
    expect(deriveLengthValue('09:00', '09:00')).toBe(CUSTOM_LENGTH);
  });
});
