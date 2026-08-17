/**
 * /hq/products — the network-wide merchandise catalogue (da_products).
 *
 * Modelled on TemplatesPage: DataTable of products with an add/edit dialog.
 * Writes flow through the create-product / update-product Edge Functions
 * (HQ-only server-side). Franchisees see only active products when they
 * record a sale, so an item stays hidden until it is priced and activated.
 */

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, ShoppingBag, GraduationCap, BookOpen } from 'lucide-react';
import { PageHeader, DataTable, EmptyState, StatusPill } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatPence } from '@/lib/format';
import { extractRequestId } from '@/lib/logger';
import {
  useAllProducts,
  useCreateProduct,
  useUpdateProduct,
  type ProductRow,
  type ProductKind,
} from './queries';

// ---------------------------------------------------------------------------
// Zod schema — RRP collected in pounds, converted to pence on submit
// ---------------------------------------------------------------------------

const productSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required'),
    description: z.string().trim().optional(),
    rrp_pounds: z
      .number({ invalid_type_error: 'RRP must be a number' })
      .nonnegative('RRP cannot be negative'),
    active: z.boolean(),
    sort_order: z
      .number({ invalid_type_error: 'Sort order must be a number' })
      .int('Sort order must be a whole number'),
    kind: z.enum(['physical', 'elearning'] as const),
    fulfilment_url: z.string().trim().optional(),
    fulfilment_notes: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    // The course link only applies to e-learning, and must be a real https
    // URL — buyers are redirected straight to it after paying.
    if (data.kind !== 'elearning') return;
    const url = data.fulfilment_url?.trim() ?? '';
    if (url.length === 0) return;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fulfilment_url'],
        message: 'Enter a full URL, e.g. https://learn.example.com/course',
      });
      return;
    }
    if (parsed.protocol !== 'https:') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fulfilment_url'],
        message: 'The course link must start with https://',
      });
    }
  });

type ProductFormValues = z.infer<typeof productSchema>;

type DialogMode = { type: 'edit'; product: ProductRow } | { type: 'create' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProductsPage() {
  const products = useAllProducts();
  const [mode, setMode] = useState<DialogMode | null>(null);

  const columns = useMemo<ColumnDef<ProductRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => <span className="font-bold">{row.original.name}</span>,
      },
      {
        id: 'description',
        header: 'Description',
        accessorFn: (row) => row.description ?? '',
        cell: ({ row }) =>
          row.original.description ? (
            <span className="text-daisy-muted text-[13px]" title={row.original.description}>
              {truncate(row.original.description)}
            </span>
          ) : (
            <span className="text-daisy-muted text-[13px]">—</span>
          ),
      },
      {
        id: 'kind',
        header: 'Type',
        accessorFn: (row) => (row.kind === 'elearning' ? 'E-learning' : 'Book'),
        cell: ({ row }) =>
          row.original.kind === 'elearning' ? (
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
        accessorFn: (row) => row.owner_name ?? 'Network',
        cell: ({ row }) =>
          row.original.owner_name ? (
            <span className="text-daisy-muted text-[13px]" title={row.original.owner_name}>
              {row.original.owner_name}
            </span>
          ) : (
            <span className="text-daisy-ink text-[13px] font-semibold">Network</span>
          ),
      },
      {
        id: 'rrp',
        header: 'RRP',
        accessorFn: (row) => row.rrp_pence ?? -1,
        cell: ({ row }) => (
          <span className="font-semibold tabular-nums">
            {row.original.rrp_pence != null ? formatPence(row.original.rrp_pence) : 'Unpriced'}
          </span>
        ),
      },
      {
        accessorKey: 'active',
        header: 'Status',
        cell: ({ row }) =>
          row.original.active ? (
            <StatusPill variant="active">Active</StatusPill>
          ) : (
            <StatusPill variant="paused">Inactive</StatusPill>
          ),
      },
      {
        accessorKey: 'sort_order',
        header: 'Sort order',
        cell: ({ row }) => (
          <span className="text-[13px] tabular-nums">{row.original.sort_order}</span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Products"
        subtitle="Network items are sold by every franchisee and stay hidden until they are priced and active. Items owned by a single franchisee are their own, added from their shop, and visible only to them."
        actions={
          <Button size="sm" onClick={() => setMode({ type: 'create' })}>
            <Plus className="h-4 w-4" />
            Add product
          </Button>
        }
      />

      {products.isError ? (
        <div className="rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
          Could not load products: {products.error.message}
        </div>
      ) : null}

      <DataTable<ProductRow>
        columns={columns}
        data={products.data ?? []}
        isLoading={products.isLoading}
        searchable
        searchPlaceholder="Search by name…"
        onRowClick={(product) => setMode({ type: 'edit', product })}
        emptyState={
          <EmptyState
            icon={<ShoppingBag />}
            title="No products yet"
            body="Add the first item to the network-wide catalogue. Inactive items (like an unpriced First Aid Kit) stay hidden from franchisees until priced."
            cta={{ label: 'Add product', onClick: () => setMode({ type: 'create' }) }}
          />
        }
      />

      {mode ? <ProductDialog mode={mode} open onClose={() => setMode(null)} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProductDialog — create + edit
// ---------------------------------------------------------------------------

interface ProductDialogProps {
  mode: DialogMode;
  open: boolean;
  onClose: () => void;
}

function ProductDialog({ mode, open, onClose }: ProductDialogProps) {
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const isCreate = mode.type === 'create';

  const defaultValues: ProductFormValues = isCreate
    ? {
        name: '',
        description: '',
        rrp_pounds: 0,
        active: true,
        sort_order: 0,
        kind: 'physical',
        fulfilment_url: '',
        fulfilment_notes: '',
      }
    : {
        name: mode.product.name,
        description: mode.product.description ?? '',
        rrp_pounds: (mode.product.rrp_pence ?? 0) / 100,
        active: mode.product.active,
        sort_order: mode.product.sort_order,
        // Pre-migration rows have no kind; they are all physical stock.
        kind: mode.product.kind === 'elearning' ? 'elearning' : 'physical',
        fulfilment_url: mode.product.fulfilment_url ?? '',
        fulfilment_notes: mode.product.fulfilment_notes ?? '',
      };

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues,
  });

  const isActive = watch('active');
  const kind = watch('kind');
  const isElearning = kind === 'elearning';
  /** Set when this row is one franchisee's own item (migration 046). */
  const ownerName = mode.type === 'edit' ? mode.product.owner_name : null;

  const onSubmit = async (values: ProductFormValues) => {
    const description = values.description?.trim() ?? '';
    const rrpPence = Math.round(values.rrp_pounds * 100);

    // Fulfilment details only apply to e-learning; clear them on a physical
    // item so a kind change doesn't leave a stale course link behind.
    const fulfilmentUrl =
      values.kind === 'elearning' ? values.fulfilment_url?.trim() || null : null;
    const fulfilmentNotes =
      values.kind === 'elearning' ? values.fulfilment_notes?.trim() || null : null;

    try {
      if (mode.type === 'create') {
        await createProduct.mutateAsync({
          name: values.name.trim(),
          ...(description.length > 0 ? { description } : {}),
          rrp_pence: rrpPence,
          active: values.active,
          sort_order: values.sort_order,
          kind: values.kind,
          fulfilment_url: fulfilmentUrl,
          fulfilment_notes: fulfilmentNotes,
        });
        toast.success(`${values.name.trim()} created`);
      } else {
        await updateProduct.mutateAsync({
          product_id: mode.product.id,
          name: values.name.trim(),
          description,
          rrp_pence: rrpPence,
          active: values.active,
          sort_order: values.sort_order,
          kind: values.kind,
          fulfilment_url: fulfilmentUrl,
          fulfilment_notes: fulfilmentNotes,
        });
        toast.success(`${values.name.trim()} saved`);
      }
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : isCreate ? 'Create failed' : 'Save failed';
      const ref = extractRequestId(err);
      toast.error(ref ? `${message} (ref ${ref})` : message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      {/* Capped at 90vh with an internally scrolling body so the action
          buttons stay reachable on a short screen (F2). */}
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>{isCreate ? 'Add product' : 'Edit product'}</DialogTitle>
          <DialogDescription>
            {ownerName
              ? `This item belongs to ${ownerName}. Only they can sell it, and it does not appear in anyone else's shop.`
              : 'Network items are sold by every franchisee, so changes apply across the whole network.'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="mt-4 flex min-h-0 flex-1 flex-col"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prod-name">Name</Label>
              <Input
                id="prod-name"
                placeholder="e.g. Paediatric First Aid book"
                {...register('name')}
              />
              {errors.name ? (
                <p className="text-daisy-orange text-xs">{errors.name.message}</p>
              ) : null}
            </div>

            {/* Type */}
            <div className="flex flex-col gap-1.5">
              <Label>Type</Label>
              <Select
                value={kind}
                onValueChange={(v) =>
                  setValue('kind', v as ProductKind, { shouldDirty: true, shouldValidate: true })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="physical">Book or physical item</SelectItem>
                  <SelectItem value="elearning">E-learning course</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-daisy-muted text-xs">
                E-learning buyers are sent straight to the course link after paying; physical items
                are handed over or posted by the franchisee.
              </p>
            </div>

            {/* Description */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prod-description">Description</Label>
              <textarea
                id="prod-description"
                rows={3}
                className="border-daisy-line text-daisy-ink placeholder:text-daisy-muted focus-visible:border-daisy-primary rounded-[8px] border-2 bg-white px-3 py-2 text-sm focus-visible:outline-none"
                {...register('description')}
              />
              {errors.description ? (
                <p className="text-daisy-orange text-xs">{errors.description.message}</p>
              ) : null}
            </div>

            {/* RRP + Sort order */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="prod-rrp">RRP (£)</Label>
                <Input
                  id="prod-rrp"
                  type="number"
                  step="0.01"
                  min="0"
                  {...register('rrp_pounds', { valueAsNumber: true })}
                />
                {errors.rrp_pounds ? (
                  <p className="text-daisy-orange text-xs">{errors.rrp_pounds.message}</p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="prod-sort-order">Sort order</Label>
                <Input
                  id="prod-sort-order"
                  type="number"
                  step="1"
                  {...register('sort_order', { valueAsNumber: true })}
                />
                {errors.sort_order ? (
                  <p className="text-daisy-orange text-xs">{errors.sort_order.message}</p>
                ) : null}
              </div>
            </div>

            {/* Fulfilment — e-learning only */}
            {isElearning ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="prod-fulfilment-url">Course link</Label>
                  <Input
                    id="prod-fulfilment-url"
                    type="url"
                    placeholder="https://learn.example.com/course"
                    {...register('fulfilment_url')}
                  />
                  <p className="text-daisy-muted text-xs">
                    Where the buyer is sent after paying. Must start with https://
                  </p>
                  {errors.fulfilment_url ? (
                    <p className="text-daisy-orange text-xs">{errors.fulfilment_url.message}</p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="prod-fulfilment-notes">Fulfilment notes</Label>
                  <textarea
                    id="prod-fulfilment-notes"
                    rows={2}
                    className="border-daisy-line text-daisy-ink placeholder:text-daisy-muted focus-visible:border-daisy-primary rounded-[8px] border-2 bg-white px-3 py-2 text-sm focus-visible:outline-none"
                    placeholder="e.g. Access lasts 12 months from purchase"
                    {...register('fulfilment_notes')}
                  />
                  <p className="text-daisy-muted text-xs">
                    Shown to franchisees when they list this item.
                  </p>
                  {errors.fulfilment_notes ? (
                    <p className="text-daisy-orange text-xs">{errors.fulfilment_notes.message}</p>
                  ) : null}
                </div>
              </>
            ) : null}

            {/* Active toggle */}
            <label className="border-daisy-line bg-daisy-paper-soft flex items-start gap-3 rounded-[8px] border-2 p-3">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setValue('active', e.target.checked, { shouldDirty: true })}
                className="mt-0.5 h-4 w-4"
              />
              <span className="flex flex-col">
                <span className="text-sm font-bold">Active</span>
                <span className="text-daisy-muted text-xs">
                  Inactive products are hidden from franchisees when they record a sale.
                </span>
              </span>
            </label>
          </div>

          {/* Actions — pinned below the scrolling body */}
          <div className="border-daisy-line-soft mt-4 flex shrink-0 justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || createProduct.isPending || updateProduct.isPending}
            >
              {isSubmitting || createProduct.isPending || updateProduct.isPending
                ? 'Saving...'
                : isCreate
                  ? 'Add product'
                  : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
