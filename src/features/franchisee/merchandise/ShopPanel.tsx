/**
 * "My shop" — the franchisee's online listings.
 *
 * Two kinds of row appear here (migration 046):
 *   - HQ NETWORK items, which every franchisee sells. Read-only apart from
 *     their own price, VAT rate and visibility.
 *   - THEIR OWN items, added from this page. Fully theirs to rename, edit and
 *     retire. Hannah needed this to add her second e-learning course; Feola
 *     needed it to rename things.
 *
 * Clicking a row opens ShopListingDialog to set price / VAT / visibility;
 * "Edit item" on one of their own opens OwnProductDialog for the item itself.
 *
 * Reads via anon client + RLS (da_franchisee_products is franchisee-scoped,
 * exactly like da_product_sales, and da_products now returns network items plus
 * their own); writes go through the upsert-franchisee-product, create-product
 * and update-product Edge Functions.
 */

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { GraduationCap, BookOpen, Store, Plus } from 'lucide-react';
import { DataTable, EmptyState, StatusPill } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { formatPence } from '@/lib/format';
import { useShopItems, type Product, type ShopItem } from './merchandiseQueries';
import { ShopListingDialog } from './ShopListingDialog';
import { OwnProductDialog } from './OwnProductDialog';

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
  /** null = closed; { product: undefined } = add a new item of their own. */
  const [editingOwn, setEditingOwn] = useState<{ product?: Product } | null>(null);

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
        id: 'owner',
        header: 'Owner',
        accessorFn: (row) => (row.isOwn ? 'Yours' : 'Daisy HQ'),
        cell: ({ row }) =>
          row.original.isOwn ? (
            <span className="text-daisy-ink text-[13px] font-semibold">Yours</span>
          ) : (
            <span className="text-daisy-muted text-[13px]">Daisy HQ</span>
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
          <div className="flex justify-end gap-2">
            {row.original.isOwn ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingOwn({ product: row.original.product });
                }}
              >
                Edit item
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(row.original);
              }}
            >
              {row.original.listing ? 'Edit price' : 'Set price'}
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-daisy-muted max-w-2xl text-sm">
          Set your own price for anything in the catalogue, then switch it on to sell it from your
          booking page. Customers can buy these at any time, unlike classes which need a date. You
          can also add items of your own, such as a second e-learning course.
        </p>
        <Button size="sm" onClick={() => setEditingOwn({})}>
          <Plus className="h-4 w-4" />
          Add your own item
        </Button>
      </div>

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
            title="Nothing in your shop yet"
            body="Add an item of your own, such as an e-learning course, and price it to sell from your booking page at any time. HQ catalogue items will appear here too."
            cta={{ label: 'Add your own item', onClick: () => setEditingOwn({}) }}
          />
        }
      />

      {editing ? <ShopListingDialog item={editing} open onClose={() => setEditing(null)} /> : null}

      {editingOwn ? (
        <OwnProductDialog open product={editingOwn.product} onClose={() => setEditingOwn(null)} />
      ) : null}
    </div>
  );
}
