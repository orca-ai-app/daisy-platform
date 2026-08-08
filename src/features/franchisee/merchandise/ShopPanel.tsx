/**
 * "My shop" — the franchisee's own online listings for the HQ catalogue.
 *
 * Every active da_products row appears here, whether or not the franchisee
 * has priced it. Clicking a row opens ShopListingDialog to set their price,
 * VAT rate and whether it shows on their public booking page.
 *
 * Reads via anon client + RLS (da_franchisee_products is franchisee-scoped,
 * exactly like da_product_sales); writes go through the
 * upsert-franchisee-product Edge Function.
 */

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { GraduationCap, BookOpen, Store } from 'lucide-react';
import { DataTable, EmptyState, StatusPill } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { formatPence } from '@/lib/format';
import { useShopItems, type ShopItem } from './merchandiseQueries';
import { ShopListingDialog } from './ShopListingDialog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** E-learning is the only non-physical kind; anything else reads as a book. */
function isElearning(item: ShopItem): boolean {
  return item.product.kind === 'elearning';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ShopPanel() {
  const { items, isLoading, error } = useShopItems();
  const [editing, setEditing] = useState<ShopItem | null>(null);

  const onlineCount = items.filter((i) => i.listing?.is_online).length;

  const columns = useMemo<ColumnDef<ShopItem>[]>(
    () => [
      {
        id: 'name',
        header: 'Item',
        accessorFn: (row) => row.product.name,
        cell: ({ row }) => <span className="font-semibold">{row.original.product.name}</span>,
      },
      {
        id: 'kind',
        header: 'Type',
        accessorFn: (row) => (isElearning(row) ? 'E-learning' : 'Book'),
        cell: ({ row }) =>
          isElearning(row.original) ? (
            <span className="bg-daisy-primary-soft text-daisy-primary-deep inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide uppercase">
              <GraduationCap className="h-3 w-3" aria-hidden />
              E-learning
            </span>
          ) : (
            <span className="bg-daisy-line-soft text-daisy-ink-soft inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide uppercase">
              <BookOpen className="h-3 w-3" aria-hidden />
              Book
            </span>
          ),
      },
      {
        id: 'rrp',
        header: 'HQ RRP',
        accessorFn: (row) => row.product.rrp_pence ?? -1,
        cell: ({ row }) => (
          <span className="text-daisy-muted text-[13px] tabular-nums">
            {row.original.product.rrp_pence != null
              ? formatPence(row.original.product.rrp_pence)
              : '—'}
          </span>
        ),
      },
      {
        id: 'price',
        header: 'Your price',
        accessorFn: (row) => row.listing?.price_pence ?? -1,
        cell: ({ row }) =>
          row.original.listing ? (
            <span className="font-semibold tabular-nums">
              {formatPence(row.original.listing.price_pence)}
            </span>
          ) : (
            <span className="text-daisy-muted text-[13px]">Not set</span>
          ),
      },
      {
        id: 'vat',
        header: 'VAT',
        accessorFn: (row) => row.listing?.vat_rate ?? -1,
        cell: ({ row }) => (
          <span className="text-daisy-muted text-[13px] tabular-nums">
            {row.original.listing?.vat_rate != null ? `${row.original.listing.vat_rate}%` : '—'}
          </span>
        ),
      },
      {
        id: 'is_online',
        header: 'On booking page',
        accessorFn: (row) => (row.listing?.is_online ? 'Online' : 'Hidden'),
        cell: ({ row }) =>
          row.original.listing?.is_online ? (
            <StatusPill variant="active">Online</StatusPill>
          ) : (
            <StatusPill variant="paused">Hidden</StatusPill>
          ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(row.original);
            }}
          >
            {row.original.listing ? 'Edit' : 'Set price'}
          </Button>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-daisy-muted text-sm">
        Set your own price for anything in the catalogue, then switch it on to sell it from your
        booking page. Customers can buy these at any time, unlike classes which need a date.
      </p>

      {error ? (
        <div className="rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
          Could not load your shop: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      ) : null}

      {!isLoading && items.length > 0 && onlineCount === 0 ? (
        <div className="border-daisy-line bg-daisy-paper-soft rounded-[8px] border-2 p-4">
          <p className="text-sm font-bold">Nothing is on your booking page yet</p>
          <p className="text-daisy-muted mt-1 text-sm">
            Pick an item below, set your price, and switch on "Show on my booking page". It will
            then appear for customers to buy any time, with no date needed.
          </p>
        </div>
      ) : null}

      <DataTable<ShopItem>
        columns={columns}
        data={items}
        isLoading={isLoading}
        searchable
        searchPlaceholder="Search the catalogue…"
        onRowClick={(item) => setEditing(item)}
        emptyState={
          <EmptyState
            icon={<Store />}
            title="Nothing in the catalogue yet"
            body="Once HQ adds books or e-learning courses, you can price them here and sell them from your booking page at any time."
          />
        }
      />

      {editing ? <ShopListingDialog item={editing} open onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
