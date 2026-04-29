import { describe, it, expect } from 'vitest';
import { getInitials } from './initials';

describe('getInitials', () => {
  it('takes first + last of a two-word name', () => {
    expect(getInitials('Jenni Dunman')).toBe('JD');
  });

  it('handles three-or-more-word names by taking first and last only', () => {
    expect(getInitials("Maria Anne O'Connell")).toBe('MO');
  });

  it('uppercases output', () => {
    expect(getInitials('sarah hughes')).toBe('SH');
  });

  it('returns one initial for a single word', () => {
    expect(getInitials('Ashley')).toBe('A');
  });

  it('falls back to ?? for empty / null input', () => {
    expect(getInitials(null)).toBe('??');
    expect(getInitials(undefined)).toBe('??');
    expect(getInitials('')).toBe('??');
    expect(getInitials('   ')).toBe('??');
  });
});
