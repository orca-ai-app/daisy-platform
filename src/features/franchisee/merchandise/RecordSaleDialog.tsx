/**
 * Record a merchandise (book) sale — modelled on DiscountDialog.
 *
 * Money rule: the form collects a POUNDS value and converts to pence on
 * submit. The unit price prefills from the selected product's RRP whenever
 * the product changes, but stays freely editable (postage / discounts).
 *
 * The Edge Function server-side enforces:
 *   - franchisee_id stamped from JWT (never sent from client)
 *   - total_pence computed server-side (quantity × unit_price_pence)
 * The Zod schema below mirrors the basics so the user gets inline feedback
 * before the round-trip.
 */

import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { formatInTimeZone } from 'date-fns-tz';
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
  useProducts,
  useSaleCourseOptions,
  useCreateProductSale,
  todayLondon,
  type ProductSalePaymentMethod,
} from './merchandiseQueries';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const NO_CLASS = 'none';

const saleSchema = z
  .object({
    product_id: z.string().min(1, 'Choose a product'),
    /** Raw string from the input; whole number ≥ 1. */
    quantityRaw: z.string().trim().min(1, 'Quantity is required'),
    /** Raw string from the input; decimal pounds, e.g. "5.00" → 500 pence. */
    unitPriceRaw: z.string().trim().min(1, 'Unit price is required'),
    payment_method: z.enum(['cash', 'card', 'other'] as const),
    sold_at: z.string().trim().min(1, 'Date sold is required'),
    /** Course-instance id, or NO_CLASS for "not linked to a class". */
    course_instance_id: z.string(),
    note: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    const qty = Number(data.quantityRaw);
    if (!Number.isInteger(qty) || qty < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['quantityRaw'],
        message: 'Quantity must be a whole number of 1 or more',
      });
    }
    const price = Number(data.unitPriceRaw);
    if (!Number.isFinite(price) || price < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unitPriceRaw'],
        message: 'Unit price must be a number of 0 or more',
      });
    }
    if (data.sold_at > todayLondon()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sold_at'],
        message: 'Date sold cannot be in the future',
      });
    }
  });

type SaleFormValues = z.infer<typeof saleSchema>;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RecordSaleDialogProps {
  /** Open state, controlled by the parent. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-select a class (e.g. when opened from a course detail page). */
  presetCourseInstanceId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatOptionDate(d: string): string {
  try {
    return formatInTimeZone(new Date(`${d}T00:00:00Z`), 'Europe/London', 'd MMM yyyy');
  } catch {
    return d;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RecordSaleDialog({
  open,
  onOpenChange,
  presetCourseInstanceId,
}: RecordSaleDialogProps) {
  const { data: products = [] } = useProducts();
  const { data: courseOptions = [] } = useSaleCourseOptions();
  const create = useCreateProductSale();

  const defaultValues: SaleFormValues = {
    product_id: '',
    quantityRaw: '1',
    unitPriceRaw: '',
    payment_method: 'cash',
    sold_at: todayLondon(),
    course_instance_id: presetCourseInstanceId ?? NO_CLASS,
    note: '',
  };

  const {
    register,
    handleSubmit,
    setValue,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SaleFormValues>({
    resolver: zodResolver(saleSchema),
    defaultValues,
  });

  const productId = useWatch({ control, name: 'product_id' });
  const paymentMethod = useWatch({ control, name: 'payment_method' });
  const courseInstanceId = useWatch({ control, name: 'course_instance_id' });
  const quantityRaw = useWatch({ control, name: 'quantityRaw' });
  const unitPriceRaw = useWatch({ control, name: 'unitPriceRaw' });

  // Reset the form whenever the dialog opens (including the preset class).
  useEffect(() => {
    if (open) {
      reset({
        product_id: '',
        quantityRaw: '1',
        unitPriceRaw: '',
        payment_method: 'cash',
        sold_at: todayLondon(),
        course_instance_id: presetCourseInstanceId ?? NO_CLASS,
        note: '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetCourseInstanceId]);

  // Live total preview (quantity × unit price), only when both are valid.
  const qty = Number(quantityRaw);
  const price = Number(unitPriceRaw);
  const totalPence =
    Number.isInteger(qty) && qty >= 1 && Number.isFinite(price) && price >= 0
      ? qty * Math.round(price * 100)
      : null;

  function handleProductChange(id: string) {
    setValue('product_id', id, { shouldDirty: true, shouldValidate: true });
    // Prefill the unit price from the product's RRP; stays freely editable.
    const product = products.find((p) => p.id === id);
    if (product?.rrp_pence != null) {
      setValue('unitPriceRaw', (product.rrp_pence / 100).toFixed(2), { shouldDirty: true });
    }
  }

  const onSubmit = async (values: SaleFormValues) => {
    const note = values.note?.trim() ?? '';
    try {
      const sale = await create.mutateAsync({
        product_id: values.product_id,
        quantity: Number(values.quantityRaw),
        unit_price_pence: Math.round(Number(values.unitPriceRaw) * 100),
        payment_method: values.payment_method,
        sold_at: values.sold_at,
        ...(values.course_instance_id !== NO_CLASS
          ? { course_instance_id: values.course_instance_id }
          : {}),
        ...(note.length > 0 ? { note } : {}),
      });
      toast.success(`Sale recorded, ${formatPence(sale.total_pence)}`);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed';
      const ref = extractRequestId(err);
      toast.error(ref ? `${message} (ref ${ref})` : message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record sale</DialogTitle>
          <DialogDescription>
            Record a merchandise sale. It counts towards your monthly revenue.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="mt-4 flex flex-col gap-4"
        >
          {/* Product */}
          <div className="flex flex-col gap-1.5">
            <Label>Product</Label>
            <Select value={productId} onValueChange={handleProductChange}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a product" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.rrp_pence != null ? ` — RRP ${formatPence(p.rrp_pence)}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.product_id ? (
              <p className="text-daisy-orange text-xs">{errors.product_id.message}</p>
            ) : null}
          </div>

          {/* Quantity + Unit price */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ms-quantity">Quantity</Label>
              <Input id="ms-quantity" type="number" min="1" step="1" {...register('quantityRaw')} />
              {errors.quantityRaw ? (
                <p className="text-daisy-orange text-xs">{errors.quantityRaw.message}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ms-unit-price">Unit price (£)</Label>
              <Input
                id="ms-unit-price"
                type="number"
                min="0"
                step="0.01"
                placeholder="5.00"
                {...register('unitPriceRaw')}
              />
              <p className="text-daisy-muted text-xs">Adjust for postage or discounts</p>
              {errors.unitPriceRaw ? (
                <p className="text-daisy-orange text-xs">{errors.unitPriceRaw.message}</p>
              ) : null}
            </div>
          </div>

          {/* Payment method + Date sold */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Payment method</Label>
              <Select
                value={paymentMethod}
                onValueChange={(v) =>
                  setValue('payment_method', v as ProductSalePaymentMethod, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ms-sold-at">Date sold</Label>
              <Input id="ms-sold-at" type="date" max={todayLondon()} {...register('sold_at')} />
              {errors.sold_at ? (
                <p className="text-daisy-orange text-xs">{errors.sold_at.message}</p>
              ) : null}
            </div>
          </div>

          {/* Class (optional) */}
          <div className="flex flex-col gap-1.5">
            <Label>Class (optional)</Label>
            <Select
              value={courseInstanceId}
              onValueChange={(v) =>
                setValue('course_instance_id', v, { shouldDirty: true, shouldValidate: true })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CLASS}>Not linked to a class</SelectItem>
                {courseOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {formatOptionDate(c.event_date)}
                    {c.venue_name ? ` · ${c.venue_name}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-daisy-muted text-xs">
              Link the sale to the class it was sold at, if any.
            </p>
          </div>

          {/* Note (optional) */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ms-note">Note (optional)</Label>
            <Input id="ms-note" placeholder="e.g. Posted to customer" {...register('note')} />
          </div>

          {/* Total preview */}
          <div className="border-daisy-line bg-daisy-paper-soft flex items-center justify-between rounded-[8px] border-2 p-3">
            <span className="text-daisy-muted text-xs font-bold tracking-wider uppercase">
              Total
            </span>
            <span className="text-daisy-ink text-sm font-extrabold tabular-nums">
              {totalPence !== null ? formatPence(totalPence) : '—'}
            </span>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending || isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || isSubmitting}>
              {create.isPending || isSubmitting ? 'Saving...' : 'Record sale'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
