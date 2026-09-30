import { describe, it, expect } from 'vitest';
import { certificateEmailList } from './certificateEmails';

describe('certificateEmailList', () => {
  it('lists only attendees who ticked for a certificate email', () => {
    expect(
      certificateEmailList([
        { certificate_email: 'amy@example.com' },
        { certificate_email: null },
        { certificate_email: 'ben@example.com' },
      ]),
    ).toEqual(['amy@example.com', 'ben@example.com']);
  });

  it('drops duplicates regardless of case and ignores blanks', () => {
    expect(
      certificateEmailList([
        { certificate_email: 'amy@example.com' },
        { certificate_email: 'AMY@example.com' },
        { certificate_email: '  ' },
      ]),
    ).toEqual(['amy@example.com']);
  });

  it('is empty when nobody ticked', () => {
    expect(certificateEmailList([{ certificate_email: null }])).toEqual([]);
    expect(certificateEmailList([])).toEqual([]);
  });

  it('never reads any other email field on the row', () => {
    const rows = [{ certificate_email: null, attendee_email: 'hidden@example.com' }];
    expect(certificateEmailList(rows)).toEqual([]);
  });
});
