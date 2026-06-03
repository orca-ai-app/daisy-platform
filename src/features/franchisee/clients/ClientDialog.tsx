/**
 * ClientDialog — create / edit a client (organisation OR individual).
 *
 * Create mode: no `client` prop — starts as an organisation; a toggle switches
 *   to an individual (a person). Organisations require a company name;
 *   individuals require a name (stored in contact_name; company_name is null).
 * Edit mode:   `client` prop present — form prefilled; the type is fixed.
 *
 * On a 409 from the Edge Function (org company-name collision, or an individual
 * email already on file) we surface a friendly field-level error.
 */

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
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

const schema = z
  .object({
    client_type: z.enum(['organisation', 'individual']),
    company_name: z.string().trim(),
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
  })
  .superRefine((val, ctx) => {
    if (val.client_type === 'organisation' && val.company_name.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['company_name'],
        message: 'Company name is required',
      });
    }
    if (val.client_type === 'individual' && val.contact_name.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contact_name'],
        message: 'Name is required',
      });
    }
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
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      client_type: 'organisation',
      company_name: '',
      contact_name: '',
      contact_email: '',
      contact_phone: '',
      notes: '',
    },
  });

  const clientType = watch('client_type');
  const isIndividual = clientType === 'individual';

  // Sync form values when dialog opens or client changes.
  useEffect(() => {
    if (open) {
      reset({
        client_type: client?.client_type ?? 'organisation',
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

  const displayName = (v: FormValues) =>
    v.client_type === 'organisation' ? v.company_name.trim() : v.contact_name.trim();

  const onSubmit = async (values: FormValues) => {
    const org = values.client_type === 'organisation';
    try {
      if (isEdit && client) {
        // Diff: only send changed fields. The client type is fixed in edit mode.
        const fields: Parameters<typeof update.mutateAsync>[0] = { id: client.id };
        if (org && values.company_name.trim() !== (client.company_name ?? '')) {
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
          toast.info('No changes to save');
          onClose();
          return;
        }

        await update.mutateAsync(fields);
        toast.success(`${displayName(values)} saved`);
      } else {
        await create.mutateAsync({
          client_type: values.client_type,
          company_name: org ? values.company_name.trim() : null,
          contact_name: nullify(values.contact_name),
          contact_email: nullify(values.contact_email),
          contact_phone: nullify(values.contact_phone),
          notes: nullify(values.notes),
        });
        toast.success(`${displayName(values)} added`);
      }
      onClose();
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 409) {
        // Collision: org company name, or an individual with this email already.
        setError(org ? 'company_name' : 'contact_email', {
          message: org
            ? 'You already have a client with this company name.'
            : 'You already have an individual client with this email.',
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
              : 'Add an organisation (school/company) or an individual to your client directory.'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="mt-4 flex flex-col gap-4"
        >
          {/* Type toggle — create mode only (type is fixed once created). */}
          {!isEdit ? (
            <div className="flex flex-col gap-1.5">
              <Label>Client type</Label>
              <div className="border-daisy-line inline-flex w-full overflow-hidden rounded-[8px] border-2">
                {(['organisation', 'individual'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setValue('client_type', t, { shouldValidate: false })}
                    className={cn(
                      'flex-1 px-3 py-2 text-sm font-semibold transition-colors',
                      clientType === t
                        ? 'bg-daisy-primary text-white'
                        : 'text-daisy-ink hover:bg-daisy-bg bg-white',
                    )}
                  >
                    {t === 'organisation' ? 'Organisation' : 'Individual'}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Organisation: company name. Individual: full name. */}
          {isIndividual ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="client-contact-name">
                Full name{' '}
                <span aria-hidden className="text-daisy-orange">
                  *
                </span>
              </Label>
              <Input
                id="client-contact-name"
                type="text"
                placeholder="e.g. John Smith"
                {...register('contact_name')}
              />
              {errors.contact_name ? (
                <p className="text-daisy-orange text-xs">{errors.contact_name.message}</p>
              ) : null}
            </div>
          ) : (
            <>
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

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="client-contact-name">Contact name</Label>
                <Input
                  id="client-contact-name"
                  type="text"
                  placeholder="e.g. Jane Smith"
                  {...register('contact_name')}
                />
              </div>
            </>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Phone */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="client-contact-phone">
                {isIndividual ? 'Phone' : 'Contact phone'}
              </Label>
              <Input
                id="client-contact-phone"
                type="tel"
                placeholder="e.g. 07700 900000"
                {...register('contact_phone')}
              />
            </div>

            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="client-contact-email">
                {isIndividual ? 'Email' : 'Contact email'}
              </Label>
              <Input
                id="client-contact-email"
                type="email"
                placeholder={
                  isIndividual ? 'e.g. john@gmail.com' : 'e.g. training@acmeschool.co.uk'
                }
                {...register('contact_email')}
              />
              {errors.contact_email ? (
                <p className="text-daisy-orange text-xs">{errors.contact_email.message}</p>
              ) : null}
            </div>
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

          <div className="mt-2 flex justify-end gap-2">
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
