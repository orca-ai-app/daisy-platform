/**
 * Peer test (Wave 6 VERIFIER) for the franchisee Territories page.
 *
 * Render-with-empty-data: when useOwnTerritories returns [] (and is not
 * loading), the page shows the "No territories assigned yet" empty state and
 * does NOT mount the map/table. The query hook is mocked so the test never
 * touches Supabase or Google Maps.
 *
 * Also covers the error branch surfacing the query error message.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const territoriesMock = vi.fn();

vi.mock('./territoryQueries', () => ({
  useOwnTerritories: () => territoriesMock(),
}));

// The request dialog owns its own useMutation (needs a QueryClient); this test
// is about the Territories page states, not the dialog, so stub it out.
vi.mock('./RequestTerritoryDialog', () => ({
  RequestTerritoryDialog: () => null,
}));

import Territories from './Territories';

describe('Franchisee Territories', () => {
  beforeEach(() => {
    territoriesMock.mockReset();
  });

  it('renders the empty state when the franchisee owns no territories', () => {
    territoriesMock.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<Territories />);

    expect(screen.getByText('No territories assigned yet')).toBeInTheDocument();
    // The map sidecar / data table must not render in the empty branch.
    expect(screen.queryByText('Click a row or map marker to inspect a territory.')).toBeNull();
    // The header + request action are always present.
    expect(screen.getByText('My territories')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Request a territory/i })).toBeInTheDocument();
  });

  it('surfaces the query error message', () => {
    territoriesMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('boom from RLS'),
    });

    render(<Territories />);
    expect(screen.getByText(/Could not load your territories: boom from RLS/)).toBeInTheDocument();
  });

  it('does not crash while loading with no data', () => {
    territoriesMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    });

    render(<Territories />);
    expect(screen.getByText('My territories')).toBeInTheDocument();
  });
});
