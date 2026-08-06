/**
 * Create / edit discount code dialog (Wave 9B; batch mode added pre-launch).
 *
 * Mode is determined by whether `discountId` is supplied:
 *   - undefined  → create (POST create-discount-code)
 *   - string     → edit   (POST update-discount-code)
 *
 * Create mode also offers "Create a batch of single-use codes" (NTH-6/NTH-10):
 * group name + how many + the shared value/validity → one call to
 * create-discount-code with batch_count > 1. The server generates the codes
 * ({PREFIX}-{4 alphanumerics}), forces max_uses=1, and returns the array; the
 * dialog then shows the generated codes with a copy-all button.
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

import { useEffect, useState } from 'react';
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
  useCreateDiscountBatch,
  useUpdateDiscountCode,
} from './discountQueries';
import type { DiscountCode, DiscountType } from './types';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

/**
 * The form collects `valuePounds` (string input, converted to pence on submit
 * for fixed-type codes). For percentage codes it collects `valuePercent`
 * (0-100 integer). We use a single `valueRaw` string input and discriminate
 * on `type` at validation time via `.superRefine`.
 *
 * `batch` switches between a single named code and a generated group of
 * single-use codes; `single_use` is sugar for max_uses=1 on a single code.
 */
const discountSchema = z
  .object({
    code: z
      .string()
      .trim()
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
    batch: z.boolean(),
    single_use: z.boolean(),
    group_name: z.string().trim().max(60, 'Group name must be 60 characters or fewer').optional(),
    batchCountRaw: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.batch && data.code.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['code'],
        message: 'Code is required',
      });
    }
    if (data.batch) {
      if (!data.group_name || data.group_name.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['group_name'],
          message: 'Group name is required for a batch',
        });
      }
      const bc = Number(data.batchCountRaw);
      if (!data.batchCountRaw || !Number.isInteger(bc) || bc < 2 || bc > 200) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['batchCountRaw'],
          message: 'How many must be a whole number between 2 and 200',
        });
      }
    }
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
    if (
      !data.batch &&
      !data.single_use &&
      data.maxUsesRaw !== undefined &&
      data.maxUsesRaw.length > 0
    ) {
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
  const createBatch = useCreateDiscountBatch();
  const update = useUpdateDiscountCode();
  const isPending = create.isPending || createBatch.isPending || update.isPending;

  /** Generated codes from a successful batch create — swaps the form for a results view. */
  const [createdBatch, setCreatedBatch] = useState<DiscountCode[] | null>(null);
  const [copied, setCopied] = useState(false);

  // Default raw value string from an existing row.
  function defaultValueRaw(code: typeof existing): string {
    if (!code) return '';
    if (code.type === 'percentage') return String(code.value);
    // Fixed: pence → pounds string
    return (code.value / 100).toFixed(2);
  }

  function defaultsFrom(code: typeof existing): DiscountFormValues {
    return {
      code: code?.code ?? '',
      type: code?.type ?? 'percentage',
      valueRaw: defaultValueRaw(code),
      maxUsesRaw:
        code?.max_uses !== null && code?.max_uses !== undefined ? String(code.max_uses) : '',
      valid_from: code?.valid_from ? code.valid_from.slice(0, 10) : '',
      valid_until: code?.valid_until ? code.valid_until.slice(0, 10) : '',
      is_active: code?.is_active ?? true,
      batch: false,
      single_use: code?.max_uses === 1,
      group_name: code?.group_name ?? '',
      batchCountRaw: '10',
    };
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
    defaultValues: defaultsFrom(existing),
  });

  const type = useWatch({ control, name: 'type' }) as DiscountType;
  const isActive = useWatch({ control, name: 'is_active' });
  const isBatch = useWatch({ control, name: 'batch' });
  const isSingleUse = useWatch({ control, name: 'single_use' });

  // Reset form when the dialog opens / target code changes.
  useEffect(() => {
    if (open) {
      reset(defaultsFrom(existing));
      setCreatedBatch(null);
      setCopied(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, discountId]);

  const onSubmit = async (values: DiscountFormValues) => {
    // Convert raw value to integer pence or whole percentage.
    const numericValue =
      values.type === 'percentage'
        ? Math.round(Number(values.valueRaw))
        : Math.round(Number(values.valueRaw) * 100);

    const maxUses = values.single_use
      ? 1
      : values.maxUsesRaw && values.maxUsesRaw.length > 0
        ? Number(values.maxUsesRaw)
        : null;

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
        onOpenChange(false);
      } else if (values.batch) {
        const rows = await createBatch.mutateAsync({
          code: values.code.length > 0 ? values.code : undefined,
          group_name: values.group_name!.trim(),
          batch_count: Number(values.batchCountRaw),
          type: values.type,
          value: numericValue,
          valid_from: validFrom,
          valid_until: validUntil,
          is_active: values.is_active,
        });
        toast.success(`${rows.length} single-use codes created in ${values.group_name!.trim()}`);
        // Keep the dialog open showing the generated codes.
        setCreatedBatch(rows);
      } else {
        await create.mutateAsync({
          code: values.code,
          type: values.type,
          value: numericValue,
          max_uses: maxUses,
          valid_from: validFrom,
          valid_until: validUntil,
          is_active: values.is_active,
          group_name:
            values.group_name && values.group_name.trim().length > 0
              ? values.group_name.trim()
              : null,
        });
        toast.success(`Discount code ${values.code} created`);
        onOpenChange(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed';
      toast.error(message);
    }
  };

  const copyAll = async () => {
    if (!createdBatch) return;
    try {
      await navigator.clipboard.writeText(createdBatch.map((c) => c.code).join('\n'));
      setCopied(true);
      toast.success('Codes copied to clipboard');
    } catch {
      toast.error('Could not copy — select and copy the codes manually');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {createdBatch ? (
          <>
            <DialogHeader>
              <DialogTitle>Your codes are ready</DialogTitle>
              <DialogDescription>
                {createdBatch.length} single-use codes created
                {createdBatch[0]?.group_name ? ` in ${createdBatch[0].group_name}` : ''}. Copy them
                now — each one can be redeemed exactly once.
              </DialogDescription>
            </DialogHeader>
            <div className="border-daisy-line bg-daisy-paper-soft mt-4 max-h-64 overflow-y-auto rounded-[8px] border-2 p-3">
              <ul className="flex flex-col gap-1">
                {createdBatch.map((c) => (
                  <li key={c.id} className="font-mono text-[13px] font-bold tracking-wider">
                    {c.code}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => void copyAll()}>
                {copied ? 'Copied' : 'Copy all'}
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </>
        ) : (
          <>
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
              {/* Batch mode toggle — create only */}
              {!isEdit ? (
                <label className="border-daisy-line bg-daisy-paper-soft flex items-start gap-3 rounded-[8px] border-2 p-3">
                  <input
                    type="checkbox"
                    checked={isBatch}
                    onChange={(e) => setValue('batch', e.target.checked, { shouldDirty: true })}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span className="flex flex-col">
                    <span className="text-sm font-bold">Create a batch of single-use codes</span>
                    <span className="text-daisy-muted text-xs">
                      Generates a group of codes that share the same value and validity. Each code
                      can be redeemed exactly once.
                    </span>
                  </span>
                </label>
              ) : null}

              {isBatch ? (
                <>
                  {/* Group name + how many */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="dc-group">Group name</Label>
                      <Input
                        id="dc-group"
                        placeholder="e.g. Spring fair"
                        {...register('group_name')}
                      />
                      {errors.group_name ? (
                        <p className="text-daisy-orange text-xs">{errors.group_name.message}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="dc-batch-count">How many</Label>
                      <Input
                        id="dc-batch-count"
                        type="number"
                        min="2"
                        max="200"
                        step="1"
                        {...register('batchCountRaw')}
                      />
                      {errors.batchCountRaw ? (
                        <p className="text-daisy-orange text-xs">{errors.batchCountRaw.message}</p>
                      ) : null}
                    </div>
                  </div>

                  {/* Optional prefix */}
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="dc-code">Code prefix (optional)</Label>
                    <Input
                      id="dc-code"
                      placeholder="e.g. FAIR25"
                      autoCapitalize="characters"
                      {...register('code', {
                        onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                          e.target.value = e.target.value.toUpperCase();
                        },
                      })}
                    />
                    <p className="text-daisy-muted text-xs">
                      Codes look like PREFIX-A7K2. Leave blank to use the group name as the prefix.
                    </p>
                    {errors.code ? (
                      <p className="text-daisy-orange text-xs">{errors.code.message}</p>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
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
                      Codes are converted to uppercase. They must be unique across the entire
                      network.
                    </p>
                    {errors.code ? (
                      <p className="text-daisy-orange text-xs">{errors.code.message}</p>
                    ) : null}
                  </div>
                </>
              )}

              {/* Type + Value */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label>Type</Label>
                  <Select
                    value={type}
                    onValueChange={(v) =>
                      setValue('type', v as DiscountType, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
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

              {/* Single use + Max uses — hidden in batch mode (always 1 there) */}
              {!isBatch ? (
                <>
                  <label className="border-daisy-line bg-daisy-paper-soft flex items-start gap-3 rounded-[8px] border-2 p-3">
                    <input
                      type="checkbox"
                      checked={isSingleUse}
                      onChange={(e) =>
                        setValue('single_use', e.target.checked, { shouldDirty: true })
                      }
                      className="mt-0.5 h-4 w-4"
                    />
                    <span className="flex flex-col">
                      <span className="text-sm font-bold">Single use</span>
                      <span className="text-daisy-muted text-xs">
                        The code can be redeemed exactly once, then stops working.
                      </span>
                    </span>
                  </label>

                  {!isSingleUse ? (
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
                  ) : null}
                </>
              ) : null}

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
                  {isPending || isSubmitting
                    ? 'Saving...'
                    : isEdit
                      ? 'Save changes'
                      : isBatch
                        ? 'Create batch'
                        : 'Create code'}
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
