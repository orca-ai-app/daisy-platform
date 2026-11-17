import { describe, it, expect } from 'vitest';
import { privateAtCustomerAddress } from './courseAddress.ts';

describe('privateAtCustomerAddress', () => {
  it('is false for a private class at a named venue', () => {
    expect(privateAtCustomerAddress(false, 'G67 3EN')).toBe(false);
    expect(privateAtCustomerAddress(false, 'GU1')).toBe(false);
  });
  it('is true when the venue is to be confirmed (no postcode)', () => {
    expect(privateAtCustomerAddress(false, null)).toBe(true);
    expect(privateAtCustomerAddress(false, '  ')).toBe(true);
  });
  it('is never true for an online class', () => {
    expect(privateAtCustomerAddress(true, null)).toBe(false);
  });
});
