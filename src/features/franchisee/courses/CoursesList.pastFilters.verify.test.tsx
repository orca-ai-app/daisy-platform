/**
 * TRI-0058 (Feola, 8 Oct 2026): "Past only" and "Last month" showed nothing,
 * and typing a custom date wiped each part as she tabbed through it.
 *
 * Past classes are marked Completed overnight, so a past-only date choice must
 * show every status unless one was chosen, including when the choice comes
 * back from the URL or the remembered filters rather than the dropdown. The
 * custom date boxes only save a complete date.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { OwnCoursesFilters } from './courseListQueries';

const ownCoursesMock = vi.fn();

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('./courseListQueries', () => ({
  useOwnCourses: (filters: OwnCoursesFilters) => ownCoursesMock(filters),
  useOwnCoursesForMonth: () => ({ courses: [], isLoading: false, error: null }),
}));
vi.mock('./createCourseQueries', () => ({
  useCourseTemplates: () => ({ data: [] }),
}));
vi.mock('../profileQueries', () => ({
  useOwnProfile: () => ({ data: { number: '0001' } }),
}));
vi.mock('../exportCsv', () => ({ exportCoursesCsv: vi.fn() }));
vi.mock('./CustomerLinkDialog', () => ({ CustomerLinkDialog: () => null }));
vi.mock('../components/MedicalQr', () => ({ MedicalQr: () => null }));

import CoursesList from './CoursesList';

function renderList(initial = '/franchisee/courses') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <CoursesList />
    </MemoryRouter>,
  );
}

const lastFilters = (): OwnCoursesFilters =>
  ownCoursesMock.mock.calls[ownCoursesMock.mock.calls.length - 1][0] as OwnCoursesFilters;

beforeEach(() => {
  ownCoursesMock.mockReset();
  ownCoursesMock.mockReturnValue({ rows: [], totalCount: 0, isLoading: false, error: null });
  localStorage.clear();
});

describe('past-only date choices show every status (TRI-0058)', () => {
  it('"Past only" from the URL, no status chosen: all statuses', () => {
    renderList('/franchisee/courses?date=past');
    expect(lastFilters().status).toBe('all');
  });

  it('"Last month" from the URL: all statuses', () => {
    renderList('/franchisee/courses?date=last-month');
    expect(lastFilters().status).toBe('all');
  });

  it('a remembered "Past only" (from before the fix): all statuses', () => {
    localStorage.setItem('daisy.courses.filters', JSON.stringify({ date: 'past' }));
    renderList();
    expect(lastFilters().status).toBe('all');
  });

  it('a status the trainer chose is kept', () => {
    renderList('/franchisee/courses?date=past&status=cancelled');
    expect(lastFilters().status).toBe('cancelled');
  });

  it('upcoming classes still open on Scheduled', () => {
    renderList();
    expect(lastFilters().status).toBe('scheduled');
  });

  it('a custom range ending in the past: all statuses; one reaching the future: Scheduled', () => {
    renderList('/franchisee/courses?date=custom&from=2026-09-01&to=2026-09-30');
    expect(lastFilters().status).toBe('all');
    ownCoursesMock.mockClear();
    localStorage.clear();
    renderList('/franchisee/courses?date=custom&from=2026-09-01&to=2099-12-31');
    expect(lastFilters().status).toBe('scheduled');
  });
});

describe('custom date boxes keep what is typed (TRI-0058)', () => {
  it('a half-typed date does not wipe the box or the filter; a complete one is saved', () => {
    renderList('/franchisee/courses?date=custom&from=2026-09-01');
    const fromBox = screen.getByLabelText('From date') as HTMLInputElement;
    expect(fromBox.value).toBe('2026-09-01');

    // Mid-typing, a date box reports '' until every part is filled in.
    fireEvent.change(fromBox, { target: { value: '' } });
    expect(lastFilters().from).toBe('2026-09-01');

    fireEvent.change(fromBox, { target: { value: '2026-08-15' } });
    expect(lastFilters().from).toBe('2026-08-15');
  });

  it('clearing the box is saved when it loses focus', () => {
    renderList('/franchisee/courses?date=custom&from=2026-09-01');
    const fromBox = screen.getByLabelText('From date') as HTMLInputElement;
    fireEvent.change(fromBox, { target: { value: '' } });
    fireEvent.blur(fromBox);
    expect(lastFilters().from).toBeUndefined();
  });
});
