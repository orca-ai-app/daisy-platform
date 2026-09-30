import { describe, it, expect, beforeEach } from 'vitest';
import { rememberReturnTo, takeReturnTo } from './returnTo';

describe('returnTo', () => {
  beforeEach(() => sessionStorage.clear());

  it('returns a remembered franchisee page, with its section link, once', () => {
    rememberReturnTo('/franchisee/help/booking-links#public-classes-and-the-website');
    expect(takeReturnTo(false)).toBe(
      '/franchisee/help/booking-links#public-classes-and-the-website',
    );
    expect(takeReturnTo(false)).toBe('/franchisee/dashboard');
  });

  it('ignores a page from the other side of the portal', () => {
    rememberReturnTo('/hq/franchisees');
    expect(takeReturnTo(false)).toBe('/franchisee/dashboard');
  });

  it('never follows an off-site address', () => {
    rememberReturnTo('//evil.example/franchisee/x');
    expect(takeReturnTo(false)).toBe('/franchisee/dashboard');
  });

  it('falls back to the dashboard when nothing was remembered', () => {
    expect(takeReturnTo(true)).toBe('/hq/dashboard');
  });
});
