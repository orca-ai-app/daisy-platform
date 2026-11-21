import { describe, it, expect } from 'vitest';
import { parseBookerExtras, heardAboutLabel, ATTENDEE_DETAILS_MAX } from './bookerExtras.ts';

describe('parseBookerExtras (November batch)', () => {
  it('keeps who is coming, trimmed, with line breaks', () => {
    expect(
      parseBookerExtras({ attendee_details: '  Jo Bloggs jo@x.com\r\nSam Lee  ' }).attendee_details,
    ).toBe('Jo Bloggs jo@x.com\nSam Lee');
  });

  it('caps who is coming at the maximum length', () => {
    const long = 'a'.repeat(ATTENDEE_DETAILS_MAX + 50);
    expect(parseBookerExtras({ attendee_details: long }).attendee_details).toHaveLength(
      ATTENDEE_DETAILS_MAX,
    );
  });

  it('stores a known source and drops an unknown one', () => {
    expect(parseBookerExtras({ heard_about: 'facebook' }).heard_about).toBe('facebook');
    expect(parseBookerExtras({ heard_about: 'tiktok' }).heard_about).toBeNull();
  });

  it('keeps the other text only when the answer is Other', () => {
    expect(parseBookerExtras({ heard_about: 'other', heard_about_other: ' school gate ' })).toEqual(
      { attendee_details: null, heard_about: 'other', heard_about_other: 'school gate' },
    );
    expect(
      parseBookerExtras({ heard_about: 'google', heard_about_other: 'ignored' }).heard_about_other,
    ).toBeNull();
  });

  it('leaves everything null when nothing is sent (old payloads)', () => {
    expect(parseBookerExtras({})).toEqual({
      attendee_details: null,
      heard_about: null,
      heard_about_other: null,
    });
  });
});

describe('heardAboutLabel', () => {
  it('reads as the option label, or Other with the text', () => {
    expect(heardAboutLabel('google', null)).toBe('Google search');
    expect(heardAboutLabel('other', 'Radio')).toBe('Other: Radio');
    expect(heardAboutLabel('other', '')).toBe('Other');
    expect(heardAboutLabel(null, null)).toBe('');
  });
});
