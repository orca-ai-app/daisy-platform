/**
 * Create / edit discount code dialog (Wave 9B).
 *
 * Mode is determined by whether `discountId` is supplied:
 *   - undefined  → create (POST create-discount-code)
 *   - string     → edit   (POST update-discount-code)
 *
 * Money rule: the form collects a "pounds" value for fixed-type codes and
 * converts to pence before sending. Percentage values are whole integers.
 *
 * The Edge Function server-side enforces:
 *   - franchisee_id stamped from JWT (never sent from client)
 *   - global code uniqueness (409 on collision)
 *   - value 0-100 for percentage, ≥0 pence for fixed
 * The Zod schema below mirrors those rules so the user gets inline feedback
 * before the round-trip.
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
import {
  useOwnDiscountCodes,
  useCreateDiscountCode,
  useUpdateDiscountCode,
} from './discountQueries';
import type { DiscountType } from './types';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

/**
 * The form collects `valuePounds` (string input, converted to pence on submit
 * for fixed-type codes). For percentage codes it collects `valuePercent`
 * (0-100 integer). We use a single `valueRaw` string input and discriminate
 * on `type` at validation time via `.superRefine`.
 */
const discountSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, 'Code is required')
      .max(50, 'Code must be 50 characters or fewer')
      .transform((v) => v.toUpperCase()),
    type: z.enum(['percentage', 'fixed'] as const),
    /**
     * Raw string from the input.
     * Percentage: whole number 0-100.
     * Fixed: decimal pounds, e.g. "12.50" → 1250 pence.
     */
    valueRaw: z.string().trim().min(1, 'Value is required'),
    maxUsesRaw: z.string().trim().optional(),
    valid_from: z.string().trim().optional(),
    valid_until: z.string().trim().optional(),
    is_active: z.boolean(),
  })
  .superRefine((data, ctx) => {
    const n = Number(data.valueRaw);
    if (!Number.isFinite(n) || n < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['valueRaw'],
        message: 'Value must be a number of 0 or more',
      });
      return;
    }
    if (data.type === 'percentage') {
      if (!Number.isInteger(n) || n > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['valueRaw'],
          message: 'Percentage must be a whole number between 0 and 100',
        });
      }
    } else {
      // Fixed: pounds input, min 0.
      const pence = Math.round(n * 100);
      if (pence < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['valueRaw'],
          message: 'Fixed amount must be 0 or more',
        });
      }
    }
    if (data.maxUsesRaw !== undefined && data.maxUsesRaw.length > 0) {
      const mu = Number(data.maxUsesRaw);
      if (!Number.isInteger(mu) || mu < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['maxUsesRaw'],
          message: 'Max uses must be a whole number of 1 or more',
        });
      }
    }
  });

type DiscountFormValues = z.infer<typeof discountSchema>;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DiscountDialogProps {
  /** Open state, controlled by the parent list. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing code id for edit mode; undefined for create. */
  discountId?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DiscountDialog({ open, onOpenChange, discountId }: DiscountDialogProps) {
  const isEdit = discountId !== undefined;

  const { data: codes = [] } = useOwnDiscountCodes();
  const existing = isEdit ? codes.find((c) => c.id === discountId) : undefined;

  const create = useCreateDiscountCode();
  const update = useUpdateDiscountCode();
  const isPending = create.isPending || update.isPending;

  // Default raw value string from an existing row.
  function defaultValueRaw(code: typeof existing): string {
    if (!code) return '';
    if (code.type === 'percentage') return String(code.value);
    // Fixed: pence → pounds string
    return (code.value / 100).toFixed(2);
  }

  const {
    register,
    handleSubmit,
    setValue,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DiscountFormValues>({
    resolver: zodResolver(discountSchema),
    defaultValues: {
      code: existing?.code ?? '',
      type: existing?.type ?? 'percentage',
      valueRaw: defaultValueRaw(existing),
      maxUsesRaw:
        existing?.max_uses !== null && existing?.max_uses !== undefined
          ? String(existing.max_uses)
          : '',
      valid_from: existing?.valid_from ? existing.valid_from.slice(0, 10) : '',
      valid_until: existing?.valid_until ? existing.valid_until.slice(0, 10) : '',
      is_active: existing?.is_active ?? true,
    },
  });

  const type = useWatch({ control, name: 'type' }) as DiscountType;
  const isActive = useWatch({ control, name: 'is_active' });

  // Reset form when the dialog opens / target code changes.
  useEffect(() => {
    if (open) {
      reset({
        code: existing?.code ?? '',
        type: existing?.type ?? 'percentage',
        valueRaw: defaultValueRaw(existing),
        maxUsesRaw:
          existing?.max_uses !== null && existing?.max_uses !== undefined
            ? String(existing.max_uses)
            : '',
        valid_from: existing?.valid_from ? existing.valid_from.slice(0, 10) : '',
        valid_until: existing?.valid_until ? existing.valid_until.slice(0, 10) : '',
        is_active: existing?.is_active ?? true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, discountId]);

  const onSubmit = async (values: DiscountFormValues) => {
    // Convert raw value to integer pence or whole percentage.
    const numericValue =
      values.type === 'percentage'
        ? Math.round(Number(values.valueRaw))
        : Math.round(Number(values.valueRaw) * 100);

    const maxUses =
      values.maxUsesRaw && values.maxUsesRaw.length > 0 ? Number(values.maxUsesRaw) : null;

    const validFrom =
      values.valid_from && values.valid_from.length > 0
        ? new Date(values.valid_from).toISOString()
        : null;

    const validUntil =
      values.valid_until && values.valid_until.length > 0
        ? new Date(values.valid_until).toISOString()
        : null;

    try {
      if (isEdit && discountId) {
        await update.mutateAsync({
          id: discountId,
          code: values.code,
          type: values.type,
          value: numericValue,
          max_uses: maxUses,
          valid_from: validFrom,
          valid_until: validUntil,
          is_active: values.is_active,
        });
        toast.success(`Discount code ${values.code} updated`);
      } else {
        await create.mutateAsync({
          code: values.code,
          type: values.type,
          value: numericValue,
          max_uses: maxUses,
          valid_from: validFrom,
          valid_until: validUntil,
          is_active: values.is_active,
        });
        toast.success(`Discount code ${values.code} created`);
      }
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed';
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit discount code' : 'Create discount code'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Changes are audit-logged. Uses count cannot be edited.'
              : 'Codes are globally unique across the whole network, so choose something distinctive.'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="mt-4 flex flex-col gap-4"
        >
          {/* Code */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dc-code">Code</Label>
            <Input
              id="dc-code"
              placeholder="e.g. SUMMER25"
              autoCapitalize="characters"
              {...register('code', {
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                  e.target.value = e.target.value.toUpperCase();
                },
              })}
            />
            <p className="text-daisy-muted text-xs">
              Codes are converted to uppercase. They must be unique across the entire network.
            </p>
            {errors.code ? (
              <p className="text-daisy-orange text-xs">{errors.code.message}</p>
            ) : null}
          </div>

          {/* Type + Value */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Type</Label>
              <Select
                value={type}
                onValueChange={(v) =>
                  setValue('type', v as DiscountType, { shouldDirty: true, shouldValidate: true })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Percentage (%)</SelectItem>
                  <SelectItem value="fixed">Fixed amount (£)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dc-value">
                {type === 'percentage' ? 'Percentage (0-100)' : 'Amount (pounds)'}
              </Label>
              <Input
                id="dc-value"
                type="number"
                min="0"
                max={type === 'percentage' ? 100 : undefined}
                step={type === 'percentage' ? 1 : 0.01}
                placeholder={type === 'percentage' ? '10' : '5.00'}
                {...register('valueRaw')}
              />
              {errors.valueRaw ? (
                <p className="text-daisy-orange text-xs">{errors.valueRaw.message}</p>
              ) : null}
            </div>
          </div>

          {/* Max uses */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dc-max-uses">Max uses</Label>
            <Input
              id="dc-max-uses"
              type="number"
              min="1"
              step="1"
              placeholder="Leave blank for unlimited"
              {...register('maxUsesRaw')}
            />
            {errors.maxUsesRaw ? (
              <p className="text-daisy-orange text-xs">{errors.maxUsesRaw.message}</p>
            ) : null}
          </div>

          {/* Valid from / until */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dc-valid-from">Valid from (optional)</Label>
              <Input id="dc-valid-from" type="date" {...register('valid_from')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dc-valid-until">Valid until (optional)</Label>
              <Input id="dc-valid-until" type="date" {...register('valid_until')} />
            </div>
          </div>

          {/* Active toggle */}
          <label className="border-daisy-line bg-daisy-paper-soft flex items-start gap-3 rounded-[8px] border-2 p-3">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setValue('is_active', e.target.checked, { shouldDirty: true })}
              className="mt-0.5 h-4 w-4"
            />
            <span className="flex flex-col">
              <span className="text-sm font-bold">Active</span>
              <span className="text-daisy-muted text-xs">
                Inactive codes are stored but cannot be redeemed at booking.
              </span>
            </span>
          </label>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending || isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || isSubmitting}>
              {isPending || isSubmitting ? 'Saving...' : isEdit ? 'Save changes' : 'Create code'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
