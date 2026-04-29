import { useForm } from 'react-hook-form';
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
import { useUpdateFranchisee, type FranchiseeUpdateFields } from './queries';
import type { Franchisee, FranchiseeStatus } from '@/types/franchisee';

const editSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  phone: z.string().trim().optional(),
  fee_tier: z.union([z.literal(100), z.literal(120)]),
  billing_date: z
    .number({ invalid_type_error: 'Billing date is required' })
    .int('Billing date must be a whole number')
    .min(1, 'Billing date must be 1 or later')
    .max(28, 'Billing date must be 28 or earlier'),
  status: z.enum(['active', 'paused', 'terminated']),
  vat_registered: z.boolean(),
  is_hq: z.boolean(),
  notes: z.string().optional(),
});

type EditFormValues = z.infer<typeof editSchema>;

interface EditFranchiseeDialogProps {
  franchisee: Franchisee;
  open: boolean;
  onClose: () => void;
}

export default function EditFranchiseeDialog({
  franchisee,
  open,
  onClose,
}: EditFranchiseeDialogProps) {
  const update = useUpdateFranchisee();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: franchisee.name,
      email: franchisee.email,
      phone: franchisee.phone ?? '',
      fee_tier: (franchisee.fee_tier as 100 | 120) ?? 120,
      billing_date: franchisee.billing_date,
      status: franchisee.status,
      vat_registered: franchisee.vat_registered,
      is_hq: franchisee.is_hq,
      notes: franchisee.notes ?? '',
    },
  });

  const status = watch('status');
  const feeTier = watch('fee_tier');
  const isHq = watch('is_hq');
  const vat = watch('vat_registered');
  const emailWatch = watch('email');
  const emailChanged = emailWatch.trim().toLowerCase() !== franchisee.email.toLowerCase();

  const onSubmit = async (values: EditFormValues) => {
    // Compute the diff against the current row so we only send what
    // actually changed. This keeps the activity log clean.
    const fields: FranchiseeUpdateFields = {};
    if (values.name.trim() !== franchisee.name) fields.name = values.name.trim();
    if (values.email.trim().toLowerCase() !== franchisee.email.toLowerCase()) {
      fields.email = values.email.trim().toLowerCase();
    }
    const phoneValue = values.phone && values.phone.trim().length > 0 ? values.phone.trim() : null;
    if ((franchisee.phone ?? null) !== phoneValue) fields.phone = phoneValue;
    if (values.fee_tier !== franchisee.fee_tier) fields.fee_tier = values.fee_tier;
    if (values.billing_date !== franchisee.billing_date) fields.billing_date = values.billing_date;
    if (values.status !== franchisee.status) fields.status = values.status;
    const notesValue = values.notes && values.notes.trim().length > 0 ? values.notes.trim() : null;
    if ((franchisee.notes ?? null) !== notesValue) fields.notes = notesValue;
    if (values.vat_registered !== franchisee.vat_registered) {
      fields.vat_registered = values.vat_registered;
    }
    if (values.is_hq !== franchisee.is_hq) fields.is_hq = values.is_hq;

    if (Object.keys(fields).length === 0) {
      toast.info('No changes to save');
      onClose();
      return;
    }

    try {
      await update.mutateAsync({ id: franchisee.id, fields });
      toast.success(`${values.name} saved`);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed';
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit franchisee</DialogTitle>
          <DialogDescription>
            Changes are audit-logged. Number can't be changed after onboarding.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="mt-4 flex flex-col gap-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-name">Name</Label>
              <Input id="edit-name" {...register('name')} />
              {errors.name ? (
                <p className="text-daisy-orange text-xs">{errors.name.message}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-email">Email</Label>
              <Input id="edit-email" type="email" {...register('email')} />
              {emailChanged ? (
                <p className="text-daisy-orange text-xs">
                  Email change updates the linked auth account; the franchisee will need to use the
                  new address to sign in.
                </p>
              ) : null}
              {errors.email ? (
                <p className="text-daisy-orange text-xs">{errors.email.message}</p>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-phone">Phone</Label>
              <Input id="edit-phone" type="tel" {...register('phone')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-billing-date">Billing date</Label>
              <Input
                id="edit-billing-date"
                type="number"
                min="1"
                max="28"
                step="1"
                {...register('billing_date', { valueAsNumber: true })}
              />
              {errors.billing_date ? (
                <p className="text-daisy-orange text-xs">{errors.billing_date.message}</p>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Fee tier</Label>
              <Select
                value={String(feeTier)}
                onValueChange={(v) =>
                  setValue('fee_tier', Number(v) as 100 | 120, { shouldDirty: true })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="100">£100 / month</SelectItem>
                  <SelectItem value="120">£120 / month</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(v) =>
                  setValue('status', v as FranchiseeStatus, { shouldDirty: true })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="terminated">Terminated</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="border-daisy-line bg-daisy-paper-soft flex items-start gap-3 rounded-[8px] border-2 p-3">
              <input
                type="checkbox"
                checked={vat}
                onChange={(e) =>
                  setValue('vat_registered', e.target.checked, { shouldDirty: true })
                }
                className="mt-0.5 h-4 w-4"
              />
              <span className="flex flex-col">
                <span className="text-sm font-bold">VAT registered</span>
                <span className="text-daisy-muted text-xs">
                  Toggle when the franchisee crosses the VAT threshold.
                </span>
              </span>
            </label>

            <label className="border-daisy-line bg-daisy-paper-soft flex items-start gap-3 rounded-[8px] border-2 p-3">
              <input
                type="checkbox"
                checked={isHq}
                onChange={(e) => setValue('is_hq', e.target.checked, { shouldDirty: true })}
                className="mt-0.5 h-4 w-4"
              />
              <span className="flex flex-col">
                <span className="text-sm font-bold">HQ admin</span>
                <span className="text-daisy-muted text-xs">
                  HQ admins can onboard franchisees, edit templates and run billing.
                </span>
              </span>
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-notes">Notes</Label>
            <textarea
              id="edit-notes"
              rows={3}
              className="border-daisy-line text-daisy-ink placeholder:text-daisy-muted focus-visible:border-daisy-primary rounded-[8px] border-2 bg-white px-3 py-2 text-sm focus-visible:outline-none"
              {...register('notes')}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || update.isPending}>
              {isSubmitting || update.isPending ? 'Saving...' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
