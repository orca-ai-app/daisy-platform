/**
 * Email delivery health (migration 057) — signal thresholds + escalation logic.
 *
 * Born from the 15-16 Sep incident: Postmark returned 200 + MessageID and
 * silently discarded ~47 emails for 30h. Rows said 'sent', nothing failed
 * loudly. The monitor's whole job is to catch exactly that, so these tests pin
 * the two pure decisions it turns on:
 *
 *   computeState   — which signal counts drive green / amber / red;
 *   alertDecision  — when the red Pushover fires, when it stays quiet (24h
 *                    dedupe), and when the all-clear fires on recovery.
 */
import { describe, it, expect } from 'vitest';
import { computeState, alertDecision } from './health.ts';

describe('computeState — signal thresholds', () => {
  it('all clear is green', () => {
    expect(computeState({ unconfirmed: 0, failed24h: 0, bounceRate7d: 0 })).toBe('green');
  });

  it('1-2 unconfirmed sends is amber (could be webhook lag)', () => {
    expect(computeState({ unconfirmed: 1, failed24h: 0, bounceRate7d: 0 })).toBe('amber');
    expect(computeState({ unconfirmed: 2, failed24h: 0, bounceRate7d: 0 })).toBe('amber');
  });

  it('3+ unconfirmed sends is red — the incident signature', () => {
    expect(computeState({ unconfirmed: 3, failed24h: 0, bounceRate7d: 0 })).toBe('red');
    expect(computeState({ unconfirmed: 47, failed24h: 0, bounceRate7d: 0 })).toBe('red');
  });

  it('any hard failure in 24h is red', () => {
    expect(computeState({ unconfirmed: 0, failed24h: 1, bounceRate7d: 0 })).toBe('red');
  });

  it('bounce rate over 5% is amber; 5% exactly is not (strictly greater)', () => {
    expect(computeState({ unconfirmed: 0, failed24h: 0, bounceRate7d: 5.01 })).toBe('amber');
    expect(computeState({ unconfirmed: 0, failed24h: 0, bounceRate7d: 5 })).toBe('green');
  });

  it('red wins over amber — a discard must not be softened by a benign bounce rate', () => {
    // 3 unconfirmed (red) alongside an elevated bounce rate (amber) stays red.
    expect(computeState({ unconfirmed: 3, failed24h: 0, bounceRate7d: 9 })).toBe('red');
    // A failure (red) alongside 1 unconfirmed (amber) stays red.
    expect(computeState({ unconfirmed: 1, failed24h: 2, bounceRate7d: 0 })).toBe('red');
  });
});

describe('alertDecision — escalation + dedupe + recovery', () => {
  it('fires the red alert on a fresh red', () => {
    expect(alertDecision({ state: 'red', prevState: 'green', alertedWithin24h: false })).toEqual({
      fireRed: true,
      fireAllClear: false,
    });
  });

  it('stays quiet while red if already alerted within 24h (no spam)', () => {
    expect(alertDecision({ state: 'red', prevState: 'red', alertedWithin24h: true })).toEqual({
      fireRed: false,
      fireAllClear: false,
    });
  });

  it('re-alerts once the 24h window has passed and it is still red', () => {
    expect(alertDecision({ state: 'red', prevState: 'red', alertedWithin24h: false })).toEqual({
      fireRed: true,
      fireAllClear: false,
    });
  });

  it('fires the all-clear on recovery from red', () => {
    expect(alertDecision({ state: 'green', prevState: 'red', alertedWithin24h: false })).toEqual({
      fireRed: false,
      fireAllClear: true,
    });
    // Recovery to amber still counts as leaving red — one all-clear.
    expect(alertDecision({ state: 'amber', prevState: 'red', alertedWithin24h: false })).toEqual({
      fireRed: false,
      fireAllClear: true,
    });
  });

  it('is silent on a steady non-red state', () => {
    expect(alertDecision({ state: 'green', prevState: 'green', alertedWithin24h: false })).toEqual({
      fireRed: false,
      fireAllClear: false,
    });
    expect(alertDecision({ state: 'amber', prevState: 'amber', alertedWithin24h: false })).toEqual({
      fireRed: false,
      fireAllClear: false,
    });
  });

  it('does not fire an all-clear on first ever run (no previous state)', () => {
    expect(alertDecision({ state: 'green', alertedWithin24h: false })).toEqual({
      fireRed: false,
      fireAllClear: false,
    });
  });
});
