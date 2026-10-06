/**
 * Courses list: month headings (TRI-0034, October batch A3) and the
 * Public/Private filter (TRI-0037, A4).
 *
 * The data hooks are mocked, so nothing touches Supabase. useOwnCourses is a
 * spy: it records the filters each render asked for and returns whichever
 * page of rows the test has set up.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import type { OwnCourseListRow, OwnCoursesFilters } from './courseListQueries';

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

import CoursesList, { courseMonthHeading } from './CoursesList';

function course(id: string, event_date: string, start_time = '10:00:00'): OwnCourseListRow {
  return {
    id,
    event_date,
    start_time,
    end_time: '12:00:00',
    status: 'scheduled',
    venue_name: `Venue ${id}`,
    venue_postcode: 'GU1 1AA',
    venue_tbc: false,
    capacity: 10,
    spots_remaining: 5,
    price_pence: 3000,
    template_id: 't-1',
    template_name: 'Baby First Aid',
    display_name: null,
    booking_token: null,
    ticket_price_from: null,
    ticket_prices_differ: false,
    visibility: 'public',
    private_client_id: null,
  };
}

// Three months of classes, soonest first.
const ASC = [
  course('a', '2026-10-08'),
  course('b', '2026-10-21'),
  course('c', '2026-11-03'),
  course('d', '2026-11-30'),
  course('e', '2026-12-12'),
];

/** Heading text and course venues in the order the desktop table shows them. */
function desktopSequence(): string[] {
  const table = screen.getByRole('table');
  return within(table)
    .getAllByRole('row')
    .slice(1) // header row
    .map((tr) => {
      const heading = tr.querySelector('[data-testid="group-heading-row"]');
      if (heading) return `# ${heading.textContent}`;
      const venue = Array.from(tr.querySelectorAll('span')).find(
        (s) => s.children.length === 0 && s.textContent?.startsWith('Venue '),
      );
      return venue?.textContent ?? '?';
    });
}

function cardHeadings(): string[] {
  return screen.getAllByTestId('group-heading-card').map((h) => h.textContent ?? '');
}

/** Lets a test change the URL the way a filter choice does. */
let goTo: (to: string) => void = () => {};
function UrlDriver() {
  const navigate = useNavigate();
  goTo = (to) => navigate(to, { replace: true });
  return null;
}

function renderList(initial = '/franchisee/courses') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <UrlDriver />
      <CoursesList />
    </MemoryRouter>,
  );
}

function loaded(rows: OwnCourseListRow[], totalCount = rows.length) {
  return { rows, totalCount, isLoading: false, isFetching: false, error: null };
}

beforeEach(() => {
  ownCoursesMock.mockReset();
  try {
    localStorage.clear();
  } catch {
    // jsdom always has storage; ignore just in case.
  }
});

describe('courseMonthHeading', () => {
  it('names the month from the raw date string', () => {
    expect(courseMonthHeading('2026-10-31')).toBe('October 2026');
    expect(courseMonthHeading('2027-01-01')).toBe('January 2027');
  });
  it('returns null for a malformed date', () => {
    expect(courseMonthHeading('')).toBeNull();
  });
});

describe('Courses list month headings (TRI-0034)', () => {
  it('soonest first: one heading before each month, in order', () => {
    ownCoursesMock.mockReturnValue(loaded(ASC));
    renderList('/franchisee/courses?sort=asc');
    expect(desktopSequence()).toEqual([
      '# October 2026',
      'Venue a',
      'Venue b',
      '# November 2026',
      'Venue c',
      'Venue d',
      '# December 2026',
      'Venue e',
    ]);
    // Phone card layout gets the same headings.
    expect(cardHeadings()).toEqual(['October 2026', 'November 2026', 'December 2026']);
  });

  it('latest first: headings follow the reversed order', () => {
    ownCoursesMock.mockReturnValue(loaded([...ASC].reverse()));
    renderList();
    expect(desktopSequence()).toEqual([
      '# December 2026',
      'Venue e',
      '# November 2026',
      'Venue d',
      'Venue c',
      '# October 2026',
      'Venue b',
      'Venue a',
    ]);
    expect(cardHeadings()).toEqual(['December 2026', 'November 2026', 'October 2026']);
  });

  it('a month that runs across a page boundary is headed again on the next page', () => {
    // 21 classes: page 1 = 20 October classes, page 2 = the 21st October
    // class then one in November.
    const october = Array.from({ length: 21 }, (_, i) =>
      course(`o${i + 1}`, `2026-10-${String(i + 1).padStart(2, '0')}`),
    );
    const pageOne = october.slice(0, 20);
    const pageTwo = [october[20], course('n1', '2026-11-02')];
    ownCoursesMock.mockImplementation((f: OwnCoursesFilters) =>
      loaded(f.page === 1 ? pageTwo : pageOne, 22),
    );

    renderList('/franchisee/courses?sort=asc');
    expect(cardHeadings()).toEqual(['October 2026']);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(ownCoursesMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));
    expect(desktopSequence()).toEqual([
      '# October 2026',
      'Venue o21',
      '# November 2026',
      'Venue n1',
    ]);
  });
});

describe('Courses list Public/Private filter (TRI-0037)', () => {
  it('defaults to all classes and reads the choice from the URL', () => {
    ownCoursesMock.mockReturnValue(loaded(ASC));
    renderList();
    expect(ownCoursesMock).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'all' }));

    ownCoursesMock.mockClear();
    renderList('/franchisee/courses?visibility=public');
    expect(ownCoursesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ visibility: 'public' }),
    );
  });

  it('ignores an unknown value in the URL', () => {
    ownCoursesMock.mockReturnValue(loaded(ASC));
    renderList('/franchisee/courses?visibility=bogus');
    expect(ownCoursesMock).toHaveBeenLastCalledWith(expect.objectContaining({ visibility: 'all' }));
  });

  it('changing the filter goes back to page 1', () => {
    ownCoursesMock.mockReturnValue(loaded(ASC, 45));
    renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(ownCoursesMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));

    act(() => goTo('/franchisee/courses?visibility=private'));
    expect(ownCoursesMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ visibility: 'private', page: 0 }),
    );
  });
});
