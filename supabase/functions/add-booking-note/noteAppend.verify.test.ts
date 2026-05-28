/**
 * Wave 9A VERIFIER peer test — add-booking-note append format.
 *
 * The note-building logic lives inline in the Deno handler
 * (add-booking-note/index.ts lines 66-74 + 187-191) and is not importable, so
 * this test re-implements the *exact* documented contract as pure helpers and
 * pins their behaviour:
 *
 *   - Each entry is prefixed with [YYYY-MM-DD HH:mm UTC] (UTC parts, zero-padded).
 *   - Notes are APPEND-ONLY: an existing value is never overwritten. A new
 *     entry is joined to the existing value with a single '\n'.
 *   - The null/empty-start case yields just the new entry (no leading newline).
 *
 * If the source format changes, these helpers must change in lock-step — they
 * exist to pin the contract, not to import the Deno handler.
 */

import { describe, it, expect } from 'vitest';

// Mirrors buildTimestampPrefix() — index.ts lines 66-74.
function buildTimestampPrefix(now: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const y = now.getUTCFullYear();
  const m = pad2(now.getUTCMonth() + 1);
  const d = pad2(now.getUTCDate());
  const hh = pad2(now.getUTCHours());
  const mm = pad2(now.getUTCMinutes());
  return `[${y}-${m}-${d} ${hh}:${mm} UTC]`;
}

// Mirrors the append logic — index.ts lines 187-191. noteText is the already
// trimmed user note; existing is da_bookings.notes (may be null).
function appendNote(existing: string | null, noteText: string, now: Date): string {
  const prefix = buildTimestampPrefix(now);
  const newEntry = `${prefix} ${noteText}`;
  const existingNotes = existing?.trim() ?? '';
  return existingNotes.length > 0 ? `${existingNotes}\n${newEntry}` : newEntry;
}

// A fixed instant in UTC: 2026-05-28 09:07 UTC.
const FIXED = new Date(Date.UTC(2026, 4, 28, 9, 7, 0));

describe('add-booking-note: timestamp prefix', () => {
  it('formats [YYYY-MM-DD HH:mm UTC] with zero-padded UTC parts', () => {
    expect(buildTimestampPrefix(FIXED)).toBe('[2026-05-28 09:07 UTC]');
  });

  it('uses UTC, not local time (a BST instant still renders UTC parts)', () => {
    // 2026-07-15 23:30 UTC — in BST local this is the next calendar day, but
    // the prefix must stay in UTC.
    const bst = new Date(Date.UTC(2026, 6, 15, 23, 30, 0));
    expect(buildTimestampPrefix(bst)).toBe('[2026-07-15 23:30 UTC]');
  });

  it('zero-pads single-digit month/day/hour/minute', () => {
    const early = new Date(Date.UTC(2026, 0, 3, 4, 5, 0));
    expect(buildTimestampPrefix(early)).toBe('[2026-01-03 04:05 UTC]');
  });
});

describe('add-booking-note: null/empty-start case', () => {
  it('null existing notes → just the new entry, no leading newline', () => {
    const result = appendNote(null, 'First note', FIXED);
    expect(result).toBe('[2026-05-28 09:07 UTC] First note');
    expect(result.startsWith('\n')).toBe(false);
  });

  it('empty-string existing notes → just the new entry', () => {
    expect(appendNote('', 'First note', FIXED)).toBe('[2026-05-28 09:07 UTC] First note');
  });

  it('whitespace-only existing notes treated as empty', () => {
    expect(appendNote('   \n  ', 'First note', FIXED)).toBe('[2026-05-28 09:07 UTC] First note');
  });
});

describe('add-booking-note: append-only (never overwrites)', () => {
  it('joins a new entry to existing notes with a single newline', () => {
    const existing = '[2026-05-27 10:00 UTC] Earlier note';
    const result = appendNote(existing, 'Later note', FIXED);
    expect(result).toBe('[2026-05-27 10:00 UTC] Earlier note\n[2026-05-28 09:07 UTC] Later note');
  });

  it('the existing content is preserved verbatim as a prefix', () => {
    const existing = '[2026-05-27 10:00 UTC] Earlier note';
    expect(appendNote(existing, 'Later note', FIXED).startsWith(existing)).toBe(true);
  });

  it('repeated appends accumulate one line per call', () => {
    let notes: string | null = null;
    notes = appendNote(notes, 'one', new Date(Date.UTC(2026, 4, 28, 9, 0, 0)));
    notes = appendNote(notes, 'two', new Date(Date.UTC(2026, 4, 28, 9, 1, 0)));
    notes = appendNote(notes, 'three', new Date(Date.UTC(2026, 4, 28, 9, 2, 0)));
    expect(notes.split('\n')).toHaveLength(3);
    expect(notes).toContain('] one');
    expect(notes).toContain('] two');
    expect(notes).toContain('] three');
  });
});
