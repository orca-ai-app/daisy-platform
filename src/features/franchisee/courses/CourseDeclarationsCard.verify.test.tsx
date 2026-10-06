/**
 * Class page Medical declarations card with B7 attendee emails (migration 067).
 *
 * Covers:
 *  - New-form rows show name, email and the "future classes" choice, plus
 *    Copy emails (all new-form emails) and Copy future-class emails (yes only).
 *  - Old-form rows show exactly what they showed before: no email unless the
 *    065 certificate tick was used, and then only as "Certificate email".
 *  - A class with only old-form rows has no B7 controls at all.
 *
 * useCourseDeclarations is mocked so the test never touches Supabase.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { CourseDeclarationRow } from './courseDetailQueries';

const declarationsMock = vi.fn();

vi.mock('./courseDetailQueries', async (importActual) => ({
  ...(await importActual<typeof import('./courseDetailQueries')>()),
  useCourseDeclarations: () => declarationsMock(),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { CourseDeclarationsCard } from './CourseDeclarationsCard';

function row(over: Partial<CourseDeclarationRow>): CourseDeclarationRow {
  return {
    id: over.attendee_name ?? 'r',
    created_at: '2026-10-10T09:00:00Z',
    attendee_name: 'Someone',
    photo_consent: true,
    medical_flagged: false,
    certificate_email: null,
    form_version: 1,
    trainer_contact_opt_in: false,
    ...over,
  };
}

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

function renderWith(rows: CourseDeclarationRow[]) {
  declarationsMock.mockReturnValue({ data: rows, isLoading: false });
  return render(<CourseDeclarationsCard courseInstanceId="ci1" />);
}

describe('CourseDeclarationsCard: new-form rows (B7)', () => {
  const rows = [
    row({
      attendee_name: 'Amy New',
      form_version: 2,
      certificate_email: 'amy@example.com',
      trainer_contact_opt_in: true,
    }),
    row({
      attendee_name: 'Ben New',
      form_version: 2,
      certificate_email: 'ben@example.com',
      trainer_contact_opt_in: false,
    }),
    row({ attendee_name: 'Cara New', form_version: 2, certificate_email: null }),
  ];

  it('shows name, email and the future-classes choice', () => {
    renderWith(rows);
    expect(screen.getByText('Amy New')).toBeInTheDocument();
    expect(screen.getByText('amy@example.com')).toBeInTheDocument();
    expect(screen.getByText('ben@example.com')).toBeInTheDocument();
    expect(screen.getByText('future classes: yes')).toBeInTheDocument();
    expect(screen.getByText('future classes: no')).toBeInTheDocument();
    expect(screen.getByText('No email given')).toBeInTheDocument();
    expect(screen.queryByText(/Certificate email:/)).not.toBeInTheDocument();
  });

  it('Copy emails copies every new-form email', async () => {
    renderWith(rows);
    fireEvent.click(screen.getByRole('button', { name: 'Copy emails (2)' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('amy@example.com, ben@example.com'));
  });

  it('Copy future-class emails copies only those who said yes', async () => {
    renderWith(rows);
    fireEvent.click(screen.getByRole('button', { name: 'Copy future-class emails (1)' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('amy@example.com'));
  });

  it('has no certificate-only button for new-form rows', () => {
    renderWith(rows);
    expect(
      screen.queryByRole('button', { name: /Copy certificate emails/ }),
    ).not.toBeInTheDocument();
  });
});

describe('CourseDeclarationsCard: old-form rows are unchanged', () => {
  const oldRows = [
    row({ attendee_name: 'Olive Old', certificate_email: 'olive@example.com' }),
    row({ attendee_name: 'Pete Old', certificate_email: null }),
  ];

  it('shows the 065 certificate email and button, and nothing from B7', () => {
    renderWith(oldRows);
    expect(screen.getByText('Olive Old')).toBeInTheDocument();
    expect(screen.getByText('Pete Old')).toBeInTheDocument();
    expect(screen.getByText(/Certificate email:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy certificate emails (1)' })).toBeInTheDocument();
    expect(screen.queryByText(/future classes/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Copy emails/ })).not.toBeInTheDocument();
    expect(screen.queryByText('No email given')).not.toBeInTheDocument();
    expect(screen.getByText(/ticked "Email me about my certificate"/)).toBeInTheDocument();
  });

  it('keeps old and new apart on a mixed class', async () => {
    renderWith([
      ...oldRows,
      row({
        attendee_name: 'Amy New',
        form_version: 2,
        certificate_email: 'amy@example.com',
        trainer_contact_opt_in: true,
      }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Copy emails (1)' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('amy@example.com'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy certificate emails (1)' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('olive@example.com'));
  });
});
