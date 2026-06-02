/**
 * Peer test — <StripeConnectCard> render states (OAuth model).
 *
 * Covers the documented states (StripeConnectCard.tsx header):
 *   State 1 — not connected   → "Connect with Stripe" CTA + 2% fee copy.
 *   State 2 — connected       → success card, "Connected" badge, masked id,
 *                               dashboard link, working Disconnect button.
 * Plus the loading skeleton and the error state.
 *
 * The connect-status / mutation hooks and TanStack's useQueryClient are mocked
 * so the test is deterministic and never touches Supabase, Stripe or the
 * network. sonner is stubbed to keep the toast import inert.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ConnectStatus } from './types';

// --- Mocks -----------------------------------------------------------------

const connectStatusMock = vi.fn();
const startOAuthMock = vi.fn();
const disconnectMock = vi.fn();

vi.mock('./connectQueries', () => ({
  useConnectStatus: () => connectStatusMock(),
  useStartStripeOAuth: () => startOAuthMock(),
  useDisconnectStripe: () => disconnectMock(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import StripeConnectCard from './StripeConnectCard';

// --- Fixtures --------------------------------------------------------------

function status(overrides: Partial<ConnectStatus>): ConnectStatus {
  return {
    stripe_account_id: null,
    stripe_connected: false,
    charges_enabled: false,
    details_submitted: false,
    ...overrides,
  };
}

const idleMutation = { mutate: vi.fn(), isPending: false };

beforeEach(() => {
  vi.clearAllMocks();
  startOAuthMock.mockReturnValue({ ...idleMutation });
  disconnectMock.mockReturnValue({ ...idleMutation });
});

// --- Loading + error -------------------------------------------------------

describe('StripeConnectCard loading/error', () => {
  it('renders skeletons while status is loading', () => {
    connectStatusMock.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    const { container } = render(<StripeConnectCard />);
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /connect with stripe/i })).toBeNull();
  });

  it('renders an error message when status fails to load', () => {
    connectStatusMock.mockReturnValue({ isLoading: false, isError: true, data: undefined });
    render(<StripeConnectCard />);
    expect(screen.getByText(/could not load payment status/i)).toBeInTheDocument();
  });
});

// --- State 1: not connected ------------------------------------------------

describe('StripeConnectCard — State 1 (not connected)', () => {
  beforeEach(() => {
    connectStatusMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: status({ stripe_account_id: null, stripe_connected: false }),
    });
  });

  it('shows the "Connect with Stripe" CTA and the 2% fee copy', () => {
    render(<StripeConnectCard />);
    expect(screen.getByRole('button', { name: /connect with stripe/i })).toBeInTheDocument();
    expect(screen.getByText(/2% platform fee/i)).toBeInTheDocument();
  });

  it('does not show the connected success badge', () => {
    render(<StripeConnectCard />);
    expect(screen.queryByText(/^connected$/i)).toBeNull();
  });
});

// --- State 2: connected ----------------------------------------------------

describe('StripeConnectCard — State 2 (connected)', () => {
  beforeEach(() => {
    connectStatusMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: status({
        stripe_account_id: 'acct_1234567890ABCD',
        stripe_connected: true,
        charges_enabled: true,
        details_submitted: true,
      }),
    });
  });

  it('shows the Connected badge and masks the account id', () => {
    render(<StripeConnectCard />);
    expect(screen.getByText(/^connected$/i)).toBeInTheDocument();
    // mask keeps first 8 + last 4: "acct_123…ABCD"
    expect(screen.getByText(/acct_123.*ABCD/)).toBeInTheDocument();
  });

  it('links to the Stripe dashboard for the connected account', () => {
    render(<StripeConnectCard />);
    const link = screen.getByRole('link', { name: /open stripe dashboard/i });
    expect(link).toHaveAttribute('href', 'https://dashboard.stripe.com/acct_1234567890ABCD');
  });

  it('renders the Disconnect control enabled', () => {
    render(<StripeConnectCard />);
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeEnabled();
  });

  it('does not show the connect CTA', () => {
    render(<StripeConnectCard />);
    expect(screen.queryByRole('button', { name: /connect with stripe/i })).toBeNull();
  });
});
