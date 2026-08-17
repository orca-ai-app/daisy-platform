import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { MobileNav, type MobileNavItem } from './MobileNav';

/**
 * Regression cover for the phone-navigation defect.
 *
 * A franchisee reported the portal's bottom nav as "very small and hard to
 * read/touch" on a real handset: eleven destinations were split across a
 * 375px viewport at roughly 34px each, with the last few clipped off-screen.
 * The drawer replaces it, so these tests assert the drawer genuinely lists
 * every destination rather than hiding any behind a squeeze.
 */

const ITEMS: MobileNavItem[] = [
  { label: 'Dashboard', path: '/franchisee/dashboard' },
  { label: 'Territories', path: '/franchisee/territories', matchPrefix: '/franchisee/territories' },
  { label: 'Courses', path: '/franchisee/courses' },
  { label: 'Bookings', path: '/franchisee/bookings' },
  { label: 'Clients', path: '/franchisee/clients' },
  { label: 'Customers', path: '/franchisee/customers' },
  { label: 'Discounts', path: '/franchisee/discounts' },
  { label: 'Merchandise', path: '/franchisee/merchandise' },
  { label: 'Payments', path: '/franchisee/payments' },
  { label: 'Profile', path: '/franchisee/profile' },
  { label: 'Help', path: '/franchisee/help' },
  { label: 'Reports', path: '/franchisee/reports', ready: false },
];

function renderNav(initialPath = '/franchisee/dashboard') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <MobileNav items={ITEMS} accountName="Test Franchisee" accountEmail="test@example.com" />
    </MemoryRouter>,
  );
}

describe('MobileNav', () => {
  it('keeps the drawer closed until the menu button is pressed', () => {
    renderNav();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open navigation menu/i })).toBeInTheDocument();
  });

  it('lists every ready destination once opened', async () => {
    const user = userEvent.setup();
    renderNav();
    await user.click(screen.getByRole('button', { name: /open navigation menu/i }));

    const dialog = await screen.findByRole('dialog');
    const links = within(dialog).getAllByRole('link');

    // Eleven ready items; the not-ready one must not be a link.
    expect(links).toHaveLength(11);
    expect(within(dialog).getByRole('link', { name: 'Merchandise' })).toHaveAttribute(
      'href',
      '/franchisee/merchandise',
    );
    // The item that used to fall off the right edge of the bottom bar.
    expect(within(dialog).getByRole('link', { name: 'Help' })).toBeInTheDocument();
  });

  it('renders a not-ready destination as disabled rather than a link', async () => {
    const user = userEvent.setup();
    renderNav();
    await user.click(screen.getByRole('button', { name: /open navigation menu/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('link', { name: /Reports/ })).not.toBeInTheDocument();
    expect(within(dialog).getByText('Reports')).toBeInTheDocument();
    expect(within(dialog).getByText('Soon')).toBeInTheDocument();
  });

  it('marks the active route with aria-current', async () => {
    const user = userEvent.setup();
    renderNav('/franchisee/territories/abc');
    await user.click(screen.getByRole('button', { name: /open navigation menu/i }));

    const dialog = await screen.findByRole('dialog');
    // matchPrefix means a nested territories route still highlights the parent.
    expect(within(dialog).getByRole('link', { name: 'Territories' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(dialog).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('shows the signed-in account in the drawer header', async () => {
    const user = userEvent.setup();
    renderNav();
    await user.click(screen.getByRole('button', { name: /open navigation menu/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Test Franchisee')).toBeInTheDocument();
    expect(within(dialog).getByText('test@example.com')).toBeInTheDocument();
  });
});
