/**
 * Peer test (Wave 6 VERIFIER) for the franchisee Dashboard.
 *
 * Covers:
 *  - KPI money formatting goes through formatPence (revenue renders as "£X.XX",
 *    never raw pence).
 *  - KPI count formatting via toLocaleString.
 *  - Render-with-empty-data: zero KPIs + both empty-state panels.
 *
 * The data hooks (useFranchiseeDashboard / useRecentBookings /
 * useUpcomingCourses) and useRole are mocked so the test is deterministic and
 * never touches Supabase or the network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const dashboardMock = vi.fn();
const recentMock = vi.fn();
const upcomingMock = vi.fn();
const roleMock = vi.fn();

vi.mock('./dashboardQueries', () => ({
  useFranchiseeDashboard: () => dashboardMock(),
  useRecentBookings: () => recentMock(),
  useUpcomingCourses: () => upcomingMock(),
}));

vi.mock('@/features/auth/RoleContext', () => ({
  useRole: () => roleMock(),
}));

import Dashboard from './Dashboard';

function loaded<T>(data: T) {
  return { data, isLoading: false, isError: false, error: null };
}

describe('Franchisee Dashboard', () => {
  beforeEach(() => {
    roleMock.mockReturnValue({ franchisee: { name: 'Jane Doe' } });
    recentMock.mockReturnValue(loaded([]));
    upcomingMock.mockReturnValue(loaded([]));
  });

  it('formats revenue KPI as pounds via formatPence (no raw pence)', () => {
    dashboardMock.mockReturnValue(
      loaded({
        upcomingCourses: 3,
        bookingsMtd: 12,
        revenueMtd: 123456, // £1,234.56
        outstandingCapacity: 8,
      }),
    );

    render(<Dashboard />);

    expect(screen.getByText('£1,234.56')).toBeInTheDocument();
    // raw pence must not appear as the value
    expect(screen.queryByText('123456')).not.toBeInTheDocument();
  });

  it('formats large counts with thousands separators', () => {
    dashboardMock.mockReturnValue(
      loaded({
        upcomingCourses: 1234,
        bookingsMtd: 0,
        revenueMtd: 0,
        outstandingCapacity: 0,
      }),
    );

    render(<Dashboard />);
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  it('renders empty-data state cleanly: £0.00 revenue + both empty panels', () => {
    dashboardMock.mockReturnValue(
      loaded({
        upcomingCourses: 0,
        bookingsMtd: 0,
        revenueMtd: 0,
        outstandingCapacity: 0,
      }),
    );

    render(<Dashboard />);

    expect(screen.getByText('£0.00')).toBeInTheDocument();
    expect(screen.getByText('No bookings yet')).toBeInTheDocument();
    expect(screen.getByText('Nothing scheduled this week')).toBeInTheDocument();
    // greeting still renders without throwing on empty data
    expect(screen.getByText(/Jane/)).toBeInTheDocument();
  });

  it('shows KPI skeletons while stats are loading', () => {
    dashboardMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    });
    render(<Dashboard />);
    // No revenue value rendered yet.
    expect(screen.queryByText('£0.00')).not.toBeInTheDocument();
  });
});
