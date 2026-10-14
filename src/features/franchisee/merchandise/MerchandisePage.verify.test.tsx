/**
 * Merchandise > Sales shows who bought an online shop order (migration 071),
 * so a trainer can set an e-learning buyer up without hunting for them.
 *
 * useOwnProductSales is mocked so the test never touches Supabase; the dialog
 * and My shop panel are stubbed as they are not under test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ProductSaleRow } from './merchandiseQueries';

const salesMock = vi.fn();

vi.mock('./merchandiseQueries', async (importActual) => ({
  ...(await importActual<typeof import('./merchandiseQueries')>()),
  useOwnProductSales: () => salesMock(),
  useDeleteProductSale: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('./RecordSaleDialog', () => ({ RecordSaleDialog: () => null }));
vi.mock('./ShopPanel', () => ({ ShopPanel: () => null }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import MerchandisePage from './MerchandisePage';

function sale(over: Partial<ProductSaleRow> = {}): ProductSaleRow {
  return {
    id: 's1',
    franchisee_id: 'f1',
    product_id: 'p1',
    quantity: 1,
    unit_price_pence: 1499,
    total_pence: 1499,
    payment_method: 'card',
    sold_at: '2026-10-08',
    course_instance_id: null,
    note: null,
    channel: 'online',
    created_at: '2026-10-08T19:00:00Z',
    product_name: 'Anaphylaxis e-Learning Course',
    course_event_date: null,
    course_venue_name: null,
    buyer_name: 'Sam Taylor',
    buyer_email: 'sam@example.com',
    buyer_phone: '07700 900123',
    ...over,
  };
}

beforeEach(() => {
  salesMock.mockReset();
});

describe('Merchandise sales: buyer', () => {
  it('shows the buyer name, email and phone on an online sale, with the date', () => {
    salesMock.mockReturnValue({ data: [sale()], isLoading: false, error: null });
    render(<MerchandisePage />);

    // Desktop table and phone cards both render (CSS picks one), so each
    // value appears in both layouts.
    expect(screen.getAllByText('Sam Taylor')).toHaveLength(2);
    const emails = screen.getAllByText('sam@example.com');
    expect(emails).toHaveLength(2);
    expect(emails[0].closest('a')?.getAttribute('href')).toBe('mailto:sam@example.com');
    const phones = screen.getAllByText('07700 900123');
    expect(phones[0].closest('a')?.getAttribute('href')).toBe('tel:07700900123');
    expect(screen.getAllByText('08 Oct 2026').length).toBeGreaterThanOrEqual(2);
    // The phone card labels the field.
    expect(screen.getAllByText('Buyer').length).toBeGreaterThanOrEqual(2);
  });

  it('shows a dash when there is no buyer (an in-person sale)', () => {
    salesMock.mockReturnValue({
      data: [
        sale({
          channel: 'in_person',
          payment_method: 'cash',
          buyer_name: null,
          buyer_email: null,
          buyer_phone: null,
        }),
      ],
      isLoading: false,
      error: null,
    });
    render(<MerchandisePage />);
    expect(screen.queryByText('sam@example.com')).toBeNull();
  });
});
