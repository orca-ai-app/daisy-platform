import { describe, it, expect } from 'vitest';
import { heardAboutLabel } from './heardAbout';

describe('heardAboutLabel (portal)', () => {
  it('labels known answers and Other with its text', () => {
    expect(heardAboutLabel('facebook', null)).toBe('Facebook');
    expect(heardAboutLabel('other', 'Radio')).toBe('Other: Radio');
    expect(heardAboutLabel('other', null)).toBe('Other');
  });
  it('is empty when there is no answer', () => {
    expect(heardAboutLabel(null, null)).toBe('');
    expect(heardAboutLabel('nonsense', null)).toBe('');
  });
});
