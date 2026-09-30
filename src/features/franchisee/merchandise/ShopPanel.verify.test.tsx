/**
 * Per-item shop links (TRI-0045).
 *
 * Covers:
 *  - shopItemUrl builds /search?franchisee=<number>&item=<franchisee product id>.
 *  - My shop shows Copy link + Send via WhatsApp only for items that are on the
 *    booking page (listing online AND catalogue product active).
 *  - Copy link copies the item's own URL; WhatsApp carries it in the message.
 *
 * useShopItems and useOwnProfile are mocked so the test never touches Supabase.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Product, ShopItem } from './merchandiseQueries';

const shopItemsMock = vi.fn();
const profileMock = vi.fn();

vi.mock('./merchandiseQueries', async (importActual) => ({
  ...(await importActual<typeof import('./merchandiseQueries')>()),
  useShopItems: () => shopItemsMock(),
}));

vi.mock('@/features/franchisee/profileQueries', () => ({
  useOwnProfile: () => profileMock(),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { ShopPanel, isItemOnline } from './ShopPanel';
import { shopItemUrl } from '@/lib/publicUrls';

function product(over: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    name: 'Anaphylaxis e-Learning Course',
    description: null,
    rrp_pence: null,
    active: true,
    sort_order: 0,
    kind: 'elearning',
    fulfilment_url: null,
    fulfilment_notes: null,
    franchisee_id: 'f1',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}

function item(
  over: Partial<Product>,
  listing: { id: string; is_online: boolean } | null,
): ShopItem {
  const p = product(over);
  return {
    product: p,
    isOwn: true,
    listing: listing
      ? {
          id: listing.id,
          franchisee_id: 'f1',
          product_id: p.id,
          price_pence: 1499,
          is_online: listing.is_online,
          vat_rate: null,
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
        }
      : null,
  };
}

const ONLINE = item(
  { id: 'p1', name: 'Anaphylaxis e-Learning Course' },
  { id: 'fp-1', is_online: true },
);
const HIDDEN = item(
  { id: 'p2', name: 'Hidden Book', kind: 'physical' },
  { id: 'fp-2', is_online: false },
);
const UNPRICED = item({ id: 'p3', name: 'Unpriced Course' }, null);
const RETIRED = item(
  { id: 'p4', name: 'Retired Course', active: false },
  { id: 'fp-4', is_online: true },
);

describe('shopItemUrl', () => {
  it('links the franchisee number and the franchisee product id', () => {
    expect(shopItemUrl('0031', 'fp-1')).toBe(
      'https://booking.daisyfirstaid.com/search?franchisee=0031&item=fp-1',
    );
  });
});

describe('isItemOnline', () => {
  it('needs the listing switched on and the product active', () => {
    expect(isItemOnline(ONLINE)).toBe(true);
    expect(isItemOnline(HIDDEN)).toBe(false);
    expect(isItemOnline(UNPRICED)).toBe(false);
    expect(isItemOnline(RETIRED)).toBe(false);
  });
});

describe('My shop per-item link', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    Object.assign(navigator, { clipboard: { writeText } });
    profileMock.mockReturnValue({
      data: { id: 'f1', number: '0031', business_name: 'Daisy First Aid Guildford' },
    });
    shopItemsMock.mockReturnValue({
      items: [ONLINE, HIDDEN, UNPRICED, RETIRED],
      isLoading: false,
      error: null,
    });
  });

  function rowFor(name: string): HTMLElement {
    // DataTable may also render a mobile card list; take the table row.
    const row = screen
      .getAllByText(name)
      .map((el) => el.closest('tr'))
      .find((tr) => tr != null);
    expect(row).toBeTruthy();
    return row as HTMLElement;
  }

  it('offers Copy link and Send via WhatsApp only on the online item', () => {
    render(<ShopPanel />);
    const online = within(rowFor('Anaphylaxis e-Learning Course'));
    expect(online.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
    const wa = online.getByRole('link', { name: /send via whatsapp/i });
    expect(decodeURIComponent(wa.getAttribute('href')!)).toContain(
      'https://booking.daisyfirstaid.com/search?franchisee=0031&item=fp-1',
    );
    for (const name of ['Hidden Book', 'Unpriced Course', 'Retired Course']) {
      const row = within(rowFor(name));
      expect(row.queryByRole('button', { name: /copy link/i })).toBeNull();
      expect(row.queryByRole('link', { name: /send via whatsapp/i })).toBeNull();
    }
  });

  it("Copy link copies that item's own link", async () => {
    render(<ShopPanel />);
    fireEvent.click(
      within(rowFor('Anaphylaxis e-Learning Course')).getByRole('button', { name: /copy link/i }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        'https://booking.daisyfirstaid.com/search?franchisee=0031&item=fp-1',
      ),
    );
  });
});
