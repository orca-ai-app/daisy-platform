/**
 * ClientDialog — create / edit a private client.
 *
 * Create mode: no `client` prop — form starts empty.
 * Edit mode:   `client` prop present — form prefilled with existing values.
 *
 * The only required field is company_name. Contact fields are optional.
 * On a 409 from the Edge Function (franchisee_id, company_name uniqueness
 * collision) we surface a friendly field-level error rather than a generic toast.
 */

import { useEffect } from 'react';
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

import { useCreatePrivateClient, useUpdatePrivateClient } from './clientQueries';
import type { PrivateClient } from './types';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const schema = z.object({
  company_name: z.string().trim().min(1, 'Company name is required'),
  contact_name: z.string().trim(),
  contact_email: z
    .string()
    .trim()
    .refine(
      (v) => v.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      'Enter a valid email address',
    ),
  contact_phone: z.string().trim(),
  notes: z.string().trim(),
});

type FormValues = z.infer<typeof schema>;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ClientDialogProps {
  open: boolean;
  onClose: () => void;
  /** When provided the dialog is in edit mode; omit for create. */
  client?: PrivateClient;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientDialog({ open, onClose, client }: ClientDialogProps) {
  const isEdit = !!client;

  const create = useCreatePrivateClient();
  const update = useUpdatePrivateClient();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      company_name: '',
      contact_name: '',
      contact_email: '',
      contact_phone: '',
      notes: '',
    },
  });

  // Sync form values when dialog opens or client changes.
  useEffect(() => {
    if (open) {
      reset({
        company_name: client?.company_name ?? '',
        contact_name: client?.contact_name ?? '',
        contact_email: client?.contact_email ?? '',
        contact_phone: client?.contact_phone ?? '',
        notes: client?.notes ?? '',
      });
    }
  }, [open, client, reset]);

  function nullify(v: string): string | null {
    return v.trim().length > 0 ? v.trim() : null;
  }

  const onSubmit = async (values: FormValues) => {
    try {
      if (isEdit && client) {
        // Diff: only send changed fields to the Edge Function.
        const fields: Parameters<typeof update.mutateAsync>[0] = { id: client.id };
        if (values.company_name.trim() !== client.company_name) {
          fields.company_name = values.company_name.trim();
        }
        const contactName = nullify(values.contact_name);
        if ((client.contact_name ?? null) !== contactName) fields.contact_name = contactName;
        const contactEmail = nullify(values.contact_email);
        if ((client.contact_email ?? null) !== contactEmail) fields.contact_email = contactEmail;
        const contactPhone = nullify(values.contact_phone);
        if ((client.contact_phone ?? null) !== contactPhone) fields.contact_phone = contactPhone;
        const notes = nullify(values.notes);
        if ((client.notes ?? null) !== notes) fields.notes = notes;

        if (Object.keys(fields).length === 1) {
          // Only id — nothing actually changed.
          toast.info('No changes to save');
          onClose();
          return;
        }

        await update.mutateAsync(fields);
        toast.success(`${values.company_name.trim()} saved`);
      } else {
        await create.mutateAsync({
          company_name: values.company_name.trim(),
          contact_name: nullify(values.contact_name),
          contact_email: nullify(values.contact_email),
          contact_phone: nullify(values.contact_phone),
          notes: nullify(values.notes),
        });
        toast.success(`${values.company_name.trim()} added`);
      }
      onClose();
    } catch (err) {
      const status = (err as Error & { status?: number }).status;

      if (status === 409) {
        // Uniqueness collision: UNIQUE(franchisee_id, company_name).
        setError('company_name', {
          message:
            'You already have a client with this company name. Use a different name to distinguish them.',
        });
        return;
      }

      const message = err instanceof Error ? err.message : 'Save failed';
      toast.error(message);
    }
  };

  const isPending = isSubmitting || create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit client' : 'Add client'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this client's details."
              : 'Add a corporate, school, or other private client to your directory.'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="mt-4 flex flex-col gap-4"
        >
          {/* Company name — required */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="client-company-name">
              Company name{' '}
              <span aria-hidden className="text-daisy-orange">
                *
              </span>
            </Label>
            <Input
              id="client-company-name"
              type="text"
              placeholder="e.g. Acme Primary School"
              {...register('company_name')}
            />
            {errors.company_name ? (
              <p className="text-daisy-orange text-xs">{errors.company_name.message}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Contact name */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="client-contact-name">Contact name</Label>
              <Input
                id="client-contact-name"
                type="text"
                placeholder="e.g. Jane Smith"
                {...register('contact_name')}
              />
            </div>

            {/* Contact phone */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="client-contact-phone">Contact phone</Label>
              <Input
                id="client-contact-phone"
                type="tel"
                placeholder="e.g. 07700 900000"
                {...register('contact_phone')}
              />
            </div>
          </div>

          {/* Contact email */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="client-contact-email">Contact email</Label>
            <Input
              id="client-contact-email"
              type="email"
              placeholder="e.g. training@acmeschool.co.uk"
              {...register('contact_email')}
            />
            {errors.contact_email ? (
              <p className="text-daisy-orange text-xs">{errors.contact_email.message}</p>
            ) : null}
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="client-notes">Notes</Label>
            <textarea
              id="client-notes"
              rows={3}
              placeholder="Any relevant notes about this client..."
              className="border-daisy-line text-daisy-ink placeholder:text-daisy-muted focus-visible:border-daisy-primary rounded-[8px] border-2 bg-white px-3 py-2 text-sm focus-visible:outline-none"
              {...register('notes')}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving...' : isEdit ? 'Save changes' : 'Add client'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
