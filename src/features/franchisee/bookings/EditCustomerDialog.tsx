/**
 * EditCustomerDialog — edit a customer's contact details from the booking
 * detail page (NTH-13).
 *
 * Name and phone are simple updates. Email changes are format-checked here
 * and rejected server-side (409) if the address is already in use by another
 * customer record — da_customers is keyed by email and merging is not
 * supported in this version.
 */

import { useEffect, useState } from 'react';
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
import { useUpdateCustomer, type UpdateCustomerPayload } from './bookingsQueries';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface EditableCustomer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
}

export default function EditCustomerDialog({
  open,
  bookingId,
  customer,
  onClose,
}: {
  open: boolean;
  bookingId: string;
  customer: EditableCustomer;
  onClose: () => void;
}) {
  const [firstName, setFirstName] = useState(customer.first_name);
  const [lastName, setLastName] = useState(customer.last_name);
  const [phone, setPhone] = useState(customer.phone ?? '');
  const [email, setEmail] = useState(customer.email);

  const mutation = useUpdateCustomer();

  // Re-seed the form from the current customer whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setFirstName(customer.first_name);
      setLastName(customer.last_name);
      setPhone(customer.phone ?? '');
      setEmail(customer.email);
    }
  }, [open, customer]);

  const canSubmit =
    firstName.trim().length > 0 && lastName.trim().length > 0 && EMAIL_RE.test(email.trim());

  function handleOpenChange(next: boolean) {
    if (!next && !mutation.isPending) {
      onClose();
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    // Only send fields that actually changed.
    const payload: UpdateCustomerPayload = {
      booking_id: bookingId,
      customer_id: customer.id,
    };
    if (firstName.trim() !== customer.first_name) payload.first_name = firstName.trim();
    if (lastName.trim() !== customer.last_name) payload.last_name = lastName.trim();
    if (phone.trim() !== (customer.phone ?? '')) payload.phone = phone.trim() || null;
    if (email.trim().toLowerCase() !== customer.email.toLowerCase()) {
      payload.email = email.trim();
    }

    const changed =
      payload.first_name !== undefined ||
      payload.last_name !== undefined ||
      payload.phone !== undefined ||
      payload.email !== undefined;
    if (!changed) {
      onClose();
      return;
    }

    mutation.mutate(payload, {
      onSuccess: () => {
        toast.success('Customer details updated.');
        onClose();
      },
      onError: (err) => {
        toast.error(err.message ?? 'Failed to update customer details.');
      },
    });
  }

  const labelCls = 'text-daisy-muted text-[11px] font-bold tracking-wider uppercase';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit customer details</DialogTitle>
          <DialogDescription>
            Updates apply to the customer record everywhere, including future emails. Changing the
            email address to one already used by another customer is not allowed.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ec-first" className={labelCls}>
                First name
              </Label>
              <Input
                id="ec-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                disabled={mutation.isPending}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ec-last" className={labelCls}>
                Last name
              </Label>
              <Input
                id="ec-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                disabled={mutation.isPending}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ec-email" className={labelCls}>
              Email
            </Label>
            <Input
              id="ec-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={mutation.isPending}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ec-phone" className={labelCls}>
              Phone (optional)
            </Label>
            <Input
              id="ec-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={mutation.isPending}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit || mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
