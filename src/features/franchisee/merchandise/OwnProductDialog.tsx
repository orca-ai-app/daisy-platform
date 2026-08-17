/**
 * Add or rename one of the franchisee's OWN shop items (G9, migration 046).
 *
 * Until now da_products was an HQ-only catalogue, so Hannah could not add her
 * second e-learning course and Feola could not rename anything. A franchisee's
 * own item lives in the same table with da_products.franchisee_id set to them:
 * only they see it, only they can edit it.
 *
 * Deliberately narrower than the HQ product form:
 *   - No RRP. The network RRP is HQ guidance; the franchisee's own selling
 *     price is set in ShopListingDialog against their da_franchisee_products
 *     row, exactly as it is for an HQ item.
 *   - No course link. Their e-learning is fulfilled by hand (licence keys
 *     enrolled through elearnhere), so the purchase confirmation email tells
 *     the buyer access follows separately rather than promising a link.
 *   - No sort order. That orders the network catalogue and stays with HQ.
 *
 * The Edge Functions enforce all of the above server-side; this form simply
 * does not offer the fields.
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
import { extractRequestId } from '@/lib/logger';
import {
  useCreateOwnProduct,
  useUpdateOwnProduct,
  type Product,
  type ProductKind,
} from './merchandiseQueries';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const ownProductSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(120, 'Name must be 120 characters or fewer'),
  description: z.string().trim().max(500, 'Description must be 500 characters or fewer').optional(),
  kind: z.enum(['physical', 'elearning'] as const),
  fulfilment_notes: z
    .string()
    .trim()
    .max(1000, 'Fulfilment notes must be 1000 characters or fewer')
    .optional(),
  active: z.boolean(),
});

type OwnProductFormValues = z.infer<typeof ownProductSchema>;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface OwnProductDialogProps {
  open: boolean;
  onClose: () => void;
  /** The franchisee's own product being edited; omit to add a new one. */
  product?: Product;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OwnProductDialog({ open, onClose, product }: OwnProductDialogProps) {
  const create = useCreateOwnProduct();
  const update = useUpdateOwnProduct();
  const isEdit = product !== undefined;
  const isPending = create.isPending || update.isPending;

  const defaultValues: OwnProductFormValues = {
    name: product?.name ?? '',
    description: product?.description ?? '',
    // Pre-046 rows have no kind; they are all physical stock.
    kind: product?.kind === 'elearning' ? 'elearning' : 'physical',
    fulfilment_notes: product?.fulfilment_notes ?? '',
    active: product?.active ?? true,
  };

  const {
    register,
    handleSubmit,
    setValue,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<OwnProductFormValues>({
    resolver: zodResolver(ownProductSchema),
    defaultValues,
  });

  const kind = useWatch({ control, name: 'kind' });
  const isActive = useWatch({ control, name: 'active' });

  // Reset whenever the dialog opens onto a (possibly different) item.
  useEffect(() => {
    if (open) reset(defaultValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id]);

  const onSubmit = async (values: OwnProductFormValues) => {
    const name = values.name.trim();
    const description = values.description?.trim() ?? '';
    const notes = values.fulfilment_notes?.trim() ?? '';

    try {
      if (isEdit && product) {
        await update.mutateAsync({
          product_id: product.id,
          name,
          description: description.length > 0 ? description : null,
          kind: values.kind,
          fulfilment_notes: notes.length > 0 ? notes : null,
          active: values.active,
        });
        toast.success(`${name} saved`);
      } else {
        await create.mutateAsync({
          name,
          description: description.length > 0 ? description : null,
          kind: values.kind,
          fulfilment_notes: notes.length > 0 ? notes : null,
        });
        toast.success(`${name} added to your shop`);
      }
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
          <DialogTitle>{isEdit ? 'Edit your item' : 'Add your own item'}</DialogTitle>
          <DialogDescription>
            This item is yours alone. It does not appear in anyone else's shop, and only you can
            change it. Set your price once it is saved.
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
              <Label htmlFor="own-prod-name">Name</Label>
              <Input
                id="own-prod-name"
                placeholder="e.g. Paediatric First Aid online course"
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
                Buyers of your e-learning are told their access details will follow by email, so you
                have time to enrol them. Physical items are handed over or posted by you.
              </p>
            </div>

            {/* Description */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="own-prod-description">Description</Label>
              <textarea
                id="own-prod-description"
                rows={3}
                className="border-daisy-line text-daisy-ink placeholder:text-daisy-muted focus-visible:border-daisy-primary rounded-[8px] border-2 bg-white px-3 py-2 text-sm focus-visible:outline-none"
                placeholder="What the customer is buying, in a sentence or two."
                {...register('description')}
              />
              <p className="text-daisy-muted text-xs">Shown to customers on your booking page.</p>
              {errors.description ? (
                <p className="text-daisy-orange text-xs">{errors.description.message}</p>
              ) : null}
            </div>

            {/* Fulfilment notes */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="own-prod-fulfilment-notes">Fulfilment notes</Label>
              <textarea
                id="own-prod-fulfilment-notes"
                rows={2}
                className="border-daisy-line text-daisy-ink placeholder:text-daisy-muted focus-visible:border-daisy-primary rounded-[8px] border-2 bg-white px-3 py-2 text-sm focus-visible:outline-none"
                placeholder="e.g. Access lasts 12 months from the date we enrol you"
                {...register('fulfilment_notes')}
              />
              <p className="text-daisy-muted text-xs">
                Added to the confirmation email the buyer receives. Optional.
              </p>
              {errors.fulfilment_notes ? (
                <p className="text-daisy-orange text-xs">{errors.fulfilment_notes.message}</p>
              ) : null}
            </div>

            {/* Active toggle — edit only; a new item always starts available */}
            {isEdit ? (
              <label className="border-daisy-line bg-daisy-paper-soft flex items-start gap-3 rounded-[8px] border-2 p-3">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setValue('active', e.target.checked, { shouldDirty: true })}
                  className="mt-0.5 h-4 w-4"
                />
                <span className="flex flex-col">
                  <span className="text-sm font-bold">Available</span>
                  <span className="text-daisy-muted text-xs">
                    Turn this off to retire the item. It disappears from your shop and from your
                    booking page.
                  </span>
                </span>
              </label>
            ) : null}
          </div>

          {/* Actions — pinned below the scrolling body */}
          <div className="border-daisy-line-soft mt-4 flex shrink-0 justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isPending || isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || isSubmitting}>
              {isPending || isSubmitting ? 'Saving...' : isEdit ? 'Save changes' : 'Add item'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
