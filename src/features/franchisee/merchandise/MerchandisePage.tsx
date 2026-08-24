/**
 * /franchisee/merchandise — the franchisee's own book sales, plus "My shop":
 * the online listings customers can buy from the booking page at any time.
 *
 * Reads via anon client + RLS (da_product_sales, policy `franchisee_own`).
 * No client-side franchisee_id filter: RLS scopes the rows automatically.
 * Creates flow through the create-product-sale Edge Function (sonner toasts
 * fired inside RecordSaleDialog); deletes through delete-product-sale, which
 * returns 409 with a "contact HQ" message once the period is billed.
 *
 * Online sales (channel = 'online') arrive from Stripe checkouts rather than
 * being keyed in here, so the delete action is withheld for them — see
 * `canDeleteSale` below.
 */

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { ShoppingBag, Trash2, Globe, Store } from 'lucide-react';
import {
  PageHeader,
  DataTable,
  StatCard,
  EmptyState,
  StatusPill,
  FieldHelp,
} from '@/components/daisy';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatPence } from '@/lib/format';
import { extractRequestId } from '@/lib/logger';
import {
  useOwnProductSales,
  useDeleteProductSale,
  saleChannel,
  todayLondon,
  type ProductSaleRow,
} from './merchandiseQueries';
import { RecordSaleDialog } from './RecordSaleDialog';
import { ShopPanel } from './ShopPanel';

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/London',
});

function formatDate(d: string | null): string {
  if (!d) return '—';
  const date = new Date(`${d}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return '—';
  return DATE_FORMAT.format(date);
}

function paymentMethodLabel(method: ProductSaleRow['payment_method']): string {
  switch (method) {
    case 'cash':
      return 'Cash';
    case 'card':
      return 'Card';
    case 'other':
      return 'Other';
    default:
      return method;
  }
}

function truncate(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function channelLabel(sale: ProductSaleRow): string {
  return saleChannel(sale) === 'online' ? 'Online' : 'In person';
}

/**
 * Manual ledger rows can be deleted; online rows are backed by a Stripe
 * payment and `delete-product-sale` does NOT guard on channel, so deleting
 * one would drop the record while the payment stands. Withhold the action.
 */
function canDeleteSale(sale: ProductSaleRow): boolean {
  return saleChannel(sale) !== 'online';
}

/** Sum of total_pence for sales dated within the current calendar month. */
function sumThisMonth(sales: ProductSaleRow[]): number {
  const monthStart = `${todayLondon().slice(0, 7)}-01`;
  return sales.reduce(
    (acc, s) => (s.sold_at >= monthStart && s.sold_at <= todayLondon() ? acc + s.total_pence : acc),
    0,
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MerchandisePage() {
  const { data: sales = [], isLoading, error } = useOwnProductSales();

  const [recordOpen, setRecordOpen] = useState(false);
  const [deleting, setDeleting] = useState<ProductSaleRow | null>(null);

  const monthTotal = sumThisMonth(sales);

  const columns = useMemo<ColumnDef<ProductSaleRow>[]>(
    () => [
      {
        id: 'sold_at',
        header: 'Date',
        accessorFn: (row) => row.sold_at,
        cell: ({ row }) => (
          <span className="text-daisy-muted text-[13px]">{formatDate(row.original.sold_at)}</span>
        ),
      },
      {
        accessorKey: 'product_name',
        header: 'Product',
        cell: ({ row }) => <span className="font-semibold">{row.original.product_name}</span>,
      },
      {
        accessorKey: 'quantity',
        header: 'Qty',
        cell: ({ row }) => (
          <span className="text-[13px] tabular-nums">{row.original.quantity}</span>
        ),
      },
      {
        id: 'unit_price',
        header: 'Unit price',
        accessorFn: (row) => row.unit_price_pence,
        cell: ({ row }) => (
          <span className="text-[13px] tabular-nums">
            {formatPence(row.original.unit_price_pence)}
          </span>
        ),
      },
      {
        id: 'total',
        header: 'Total',
        accessorFn: (row) => row.total_pence,
        cell: ({ row }) => (
          <span className="font-semibold tabular-nums">
            {formatPence(row.original.total_pence)}
          </span>
        ),
      },
      {
        id: 'channel',
        meta: { mobileLabel: 'Source' },
        header: () => (
          <span className="inline-flex items-center gap-1">
            Source
            <FieldHelp>
              Online sales were paid on your booking page. In person sales are ones you recorded
              yourself.
            </FieldHelp>
          </span>
        ),
        accessorFn: (row) => channelLabel(row),
        cell: ({ row }) =>
          saleChannel(row.original) === 'online' ? (
            <StatusPill variant="connected" className="gap-1.5">
              <Globe className="h-3 w-3" aria-hidden />
              Online
            </StatusPill>
          ) : (
            <StatusPill variant="not-connected" className="gap-1.5">
              <Store className="h-3 w-3" aria-hidden />
              In person
            </StatusPill>
          ),
      },
      {
        id: 'payment_method',
        header: 'Payment',
        accessorFn: (row) => paymentMethodLabel(row.payment_method),
        cell: ({ row }) => (
          <span className="text-daisy-ink text-[13px]">
            {paymentMethodLabel(row.original.payment_method)}
          </span>
        ),
      },
      {
        id: 'class',
        header: 'Class',
        accessorFn: (row) =>
          row.course_event_date
            ? `${formatDate(row.course_event_date)} ${row.course_venue_name ?? ''}`
            : '',
        cell: ({ row }) =>
          row.original.course_event_date ? (
            <span className="text-daisy-muted text-[13px]">
              {formatDate(row.original.course_event_date)}
              {row.original.course_venue_name ? ` · ${row.original.course_venue_name}` : ''}
            </span>
          ) : (
            <span className="text-daisy-muted text-[13px]">—</span>
          ),
      },
      {
        id: 'note',
        header: 'Note',
        accessorFn: (row) => row.note ?? '',
        cell: ({ row }) =>
          row.original.note ? (
            <span className="text-daisy-muted text-[13px]" title={row.original.note}>
              {truncate(row.original.note)}
            </span>
          ) : (
            <span className="text-daisy-muted text-[13px]">—</span>
          ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) =>
          canDeleteSale(row.original) ? (
            <Button
              size="icon"
              variant="ghost"
              title="Delete sale"
              onClick={(e) => {
                e.stopPropagation();
                setDeleting(row.original);
              }}
            >
              <Trash2 className="h-4 w-4 text-[#8A2A2A]" aria-hidden />
              <span className="sr-only">Delete sale of {row.original.product_name}</span>
            </Button>
          ) : (
            <span
              className="text-daisy-muted text-xs"
              title="Online sales are paid for through the website — contact HQ to adjust one"
            >
              Paid online
            </span>
          ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Merchandise"
        subtitle="Record book sales, sell online, and keep track of your merchandise revenue."
        actions={<Button onClick={() => setRecordOpen(true)}>+ Record sale</Button>}
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="This month"
          value={formatPence(monthTotal)}
          delta={monthTotal === 0 ? 'No sales recorded yet' : `${formatPence(monthTotal)} MTD`}
          tone={monthTotal > 0 ? 'up' : 'flat'}
          icon={ShoppingBag}
        />
      </section>

      <Tabs defaultValue="sales" className="w-full">
        <TabsList>
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="shop">My shop</TabsTrigger>
          <span className="ml-1 inline-flex items-center">
            <FieldHelp label="About Sales and My shop">
              Sales is your record of what you have sold. My shop is what customers can buy online
              from your booking page.
            </FieldHelp>
          </span>
        </TabsList>

        <TabsContent value="sales" className="mt-4 flex flex-col gap-4">
          {error ? (
            <div className="rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
              Could not load sales: {error instanceof Error ? error.message : 'Unknown error'}
            </div>
          ) : null}

          <DataTable<ProductSaleRow>
            columns={columns}
            data={sales}
            isLoading={isLoading}
            searchable
            searchPlaceholder="Search by product…"
            emptyState={
              <EmptyState
                icon={<ShoppingBag />}
                title="No merchandise sales yet"
                body="Record your first book sale to see it here, or put an item on your booking page from My shop so customers can buy it themselves. Sales count towards your monthly revenue."
                cta={{ label: 'Record your first book sale', onClick: () => setRecordOpen(true) }}
              />
            }
          />
        </TabsContent>

        <TabsContent value="shop" className="mt-4">
          <ShopPanel />
        </TabsContent>
      </Tabs>

      <RecordSaleDialog open={recordOpen} onOpenChange={setRecordOpen} />

      {deleting ? (
        <DeleteSaleDialog sale={deleting} open onClose={() => setDeleting(null)} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeleteSaleDialog
// ---------------------------------------------------------------------------

function DeleteSaleDialog({
  sale,
  open,
  onClose,
}: {
  sale: ProductSaleRow;
  open: boolean;
  onClose: () => void;
}) {
  const deleteSale = useDeleteProductSale();

  const handleDelete = async () => {
    try {
      await deleteSale.mutateAsync({ sale_id: sale.id });
      toast.success('Sale deleted');
      onClose();
    } catch (err) {
      // A 409 means the period is already billed — the server message says
      // to contact HQ; show it verbatim.
      const message = err instanceof Error ? err.message : 'Delete failed';
      const ref = extractRequestId(err);
      toast.error(ref ? `${message} (ref ${ref})` : message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      {/* Capped at 90vh so a long product name can never push the buttons
          off-screen (F2). */}
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Delete sale</DialogTitle>
          <DialogDescription>
            Delete the sale of <strong>{sale.product_name}</strong> ({formatPence(sale.total_pence)}
            ) recorded on {formatDate(sale.sold_at)}? This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-3 text-sm text-[#8A2A2A]">
          If this sale falls in a period that has already been billed, the delete will be blocked
          and you will need to contact HQ instead.
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handleDelete()}
            disabled={deleteSale.isPending}
          >
            {deleteSale.isPending ? 'Deleting…' : 'Delete sale'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
