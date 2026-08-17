/**
 * Edit one franchisee's listing for a catalogue product — modelled on
 * RecordSaleDialog.
 *
 * Money rule: the form collects a POUNDS value and converts to pence on
 * submit via the shared helpers in ../courses/money. The price prefills from
 * the existing listing, falling back to the HQ RRP for a product the
 * franchisee has not listed yet.
 *
 * The Edge Function server-side enforces:
 *   - franchisee_id stamped from JWT (never sent from client)
 *   - upsert on (franchisee_id, product_id)
 */

import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
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
import { poundsToPence, penceToPounds } from '../courses/money';
import { useUpsertFranchiseeProduct, type ShopItem } from './merchandiseQueries';

// ---------------------------------------------------------------------------
// VAT options — stored as a numeric percentage, or null for "no VAT".
// ---------------------------------------------------------------------------

const NO_VAT = 'none';

const VAT_OPTIONS = [
  { value: NO_VAT, label: 'None' },
  { value: '0', label: '0%' },
  { value: '5', label: '5%' },
  { value: '20', label: '20%' },
] as const;

function vatToFormValue(rate: number | null | undefined): string {
  if (rate == null) return NO_VAT;
  const match = VAT_OPTIONS.find((o) => o.value !== NO_VAT && Number(o.value) === rate);
  return match ? match.value : NO_VAT;
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const listingSchema = z.object({
  /** Raw string from the input; decimal pounds, e.g. "12.50" → 1250 pence. */
  priceRaw: z.string().trim().min(1, 'Price is required'),
  vat: z.string(),
  is_online: z.boolean(),
});

type ListingFormValues = z.infer<typeof listingSchema>;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ShopListingDialogProps {
  /** The catalogue product plus this franchisee's listing, if any. */
  item: ShopItem;
  open: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ShopListingDialog({ item, open, onClose }: ShopListingDialogProps) {
  const upsert = useUpsertFranchiseeProduct();
  const { product, listing, isOwn } = item;
  const isElearning = product.kind === 'elearning';

  /**
   * Price defaults to the existing listing, then the HQ RRP, then blank —
   * the franchisee sets their own price but rarely starts from nothing.
   * Their OWN items carry no network RRP (create-product forces rrp_pence to
   * 0 for them), so those start blank rather than prefilling a misleading £0.
   */
  const defaultPriceRaw =
    listing != null
      ? penceToPounds(listing.price_pence).toFixed(2)
      : !isOwn && product.rrp_pence != null
        ? penceToPounds(product.rrp_pence).toFixed(2)
        : '';

  const defaultValues: ListingFormValues = {
    priceRaw: defaultPriceRaw,
    vat: vatToFormValue(listing?.vat_rate),
    is_online: listing?.is_online ?? false,
  };

  const {
    register,
    handleSubmit,
    setValue,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ListingFormValues>({
    resolver: zodResolver(listingSchema),
    defaultValues,
  });

  const vat = useWatch({ control, name: 'vat' });
  const isOnline = useWatch({ control, name: 'is_online' });
  const priceRaw = useWatch({ control, name: 'priceRaw' });

  // Reset whenever the dialog opens onto a (possibly different) product.
  useEffect(() => {
    if (open) reset(defaultValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product.id, listing?.id]);

  // Live preview of the price the customer pays, once it parses.
  const priceNumber = Number(priceRaw);
  const pricePence =
    priceRaw.trim().length > 0 && Number.isFinite(priceNumber) && priceNumber >= 0
      ? poundsToPence(priceNumber)
      : null;

  const onSubmit = async (values: ListingFormValues) => {
    const price = Number(values.priceRaw);
    if (!Number.isFinite(price) || price < 0) {
      toast.error('Price must be a number of 0 or more');
      return;
    }

    try {
      await upsert.mutateAsync({
        product_id: product.id,
        price_pence: poundsToPence(price),
        is_online: values.is_online,
        vat_rate: values.vat === NO_VAT ? null : Number(values.vat),
      });
      toast.success(
        values.is_online
          ? `${product.name} is on your booking page`
          : `${product.name} saved, not shown online`,
      );
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed';
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
          <DialogTitle>{product.name}</DialogTitle>
          <DialogDescription>
            Set your own price for this item. Customers can buy it from your booking page at any
            time, with no date needed.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="mt-4 flex min-h-0 flex-1 flex-col"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
            {/* HQ reference — a franchisee's own item has no network RRP */}
            {!isOwn ? (
              <div className="border-daisy-line bg-daisy-paper-soft flex items-center justify-between rounded-[8px] border-2 p-3">
                <span className="text-daisy-muted text-xs font-bold tracking-wider uppercase">
                  HQ recommended price
                </span>
                <span className="text-daisy-ink text-sm font-extrabold tabular-nums">
                  {product.rrp_pence != null ? formatPence(product.rrp_pence) : '—'}
                </span>
              </div>
            ) : null}

            {/* Your price + VAT */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fp-price">Your price (£)</Label>
                <Input
                  id="fp-price"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="12.50"
                  {...register('priceRaw')}
                />
                {errors.priceRaw ? (
                  <p className="text-daisy-orange text-xs">{errors.priceRaw.message}</p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>VAT rate</Label>
                <Select
                  value={vat}
                  onValueChange={(v) =>
                    setValue('vat', v, { shouldDirty: true, shouldValidate: true })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VAT_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-daisy-muted text-xs">
                  Leave as None if you are not VAT registered.
                </p>
              </div>
            </div>

            {/* Show on booking page */}
            <label className="border-daisy-line bg-daisy-paper-soft flex items-start gap-3 rounded-[8px] border-2 p-3">
              <input
                type="checkbox"
                checked={isOnline}
                onChange={(e) => setValue('is_online', e.target.checked, { shouldDirty: true })}
                className="mt-0.5 h-4 w-4"
                role="switch"
                aria-checked={isOnline}
              />
              <span className="flex flex-col">
                <span className="text-sm font-bold">Show on my booking page</span>
                <span className="text-daisy-muted text-xs">
                  Customers can buy this at any time, unlike classes which need a date.
                </span>
              </span>
            </label>

            {/* E-learning fulfilment note */}
            {isElearning ? (
              <div className="border-daisy-line bg-daisy-paper-soft rounded-[8px] border-2 p-3">
                <p className="text-sm font-bold">E-learning</p>
                <p className="text-daisy-muted mt-1 text-xs">
                  {isOwn
                    ? 'This is your own course, so you enrol the buyer yourself. Their confirmation email tells them their access details will follow separately, usually within 48 hours.'
                    : product.fulfilment_url
                      ? 'After paying, the customer is sent straight to the course by HQ. You have nothing to post.'
                      : 'HQ has not set the course link for this item yet, so buyers cannot be sent to it. Contact HQ before putting it on your booking page.'}
                </p>
                {product.fulfilment_notes ? (
                  <p className="text-daisy-muted mt-2 text-xs">{product.fulfilment_notes}</p>
                ) : null}
              </div>
            ) : null}

            {/* Price preview */}
            <div className="border-daisy-line bg-daisy-paper-soft flex items-center justify-between rounded-[8px] border-2 p-3">
              <span className="text-daisy-muted text-xs font-bold tracking-wider uppercase">
                Customers pay
              </span>
              <span className="text-daisy-ink text-sm font-extrabold tabular-nums">
                {pricePence !== null ? formatPence(pricePence) : '—'}
              </span>
            </div>
          </div>

          {/* Actions — pinned below the scrolling body */}
          <div className="border-daisy-line-soft mt-4 flex shrink-0 justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={upsert.isPending || isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={upsert.isPending || isSubmitting}>
              {upsert.isPending || isSubmitting ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
