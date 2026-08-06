/**
 * TransferBookingDialog — move a booking to another of the franchisee's
 * upcoming scheduled courses (NTH-12).
 *
 * Lists candidate courses (RLS-scoped to the caller's own instances) with
 * their remaining spots; courses without enough spaces for this booking's
 * seats are disabled. Calls the transfer-booking Edge Function, which
 * re-validates ownership, target status and capacity server-side and moves
 * the seats atomically. Optionally queues a fresh booking confirmation email
 * for the new course (default on).
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTransferBooking, useTransferTargets } from './bookingsQueries';

function formatDate(d: string): string {
  const parts = d.split('-');
  if (parts.length !== 3) return d;
  const [y, m, day] = parts.map(Number);
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Europe/London',
    }).format(new Date(y, m - 1, day));
  } catch {
    return d;
  }
}

export default function TransferBookingDialog({
  open,
  bookingId,
  currentInstanceId,
  seatsNeeded,
  onClose,
}: {
  open: boolean;
  bookingId: string;
  currentInstanceId: string | undefined;
  seatsNeeded: number;
  onClose: () => void;
}) {
  const [targetId, setTargetId] = useState('');
  const [notifyCustomer, setNotifyCustomer] = useState(true);

  const targets = useTransferTargets(currentInstanceId, open);
  const mutation = useTransferBooking();

  function reset() {
    setTargetId('');
    setNotifyCustomer(true);
  }

  function handleOpenChange(next: boolean) {
    if (!next && !mutation.isPending) {
      reset();
      onClose();
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!targetId) return;

    mutation.mutate(
      {
        booking_id: bookingId,
        target_course_instance_id: targetId,
        notify_customer: notifyCustomer,
      },
      {
        onSuccess: () => {
          toast.success(
            notifyCustomer
              ? 'Booking moved — a new confirmation email has been queued for the customer.'
              : 'Booking moved to the new course.',
          );
          reset();
          onClose();
        },
        onError: (err) => {
          toast.error(err.message ?? 'Failed to move booking.');
        },
      },
    );
  }

  const rows = targets.data ?? [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to another course</DialogTitle>
          <DialogDescription>
            Move this booking onto one of your other upcoming scheduled courses. It needs{' '}
            {seatsNeeded} space{seatsNeeded === 1 ? '' : 's'} — courses without enough spaces are
            greyed out. The booking reference and payment details are kept.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="transfer-target"
              className="text-daisy-muted text-[11px] font-bold tracking-wider uppercase"
            >
              Target course
            </Label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger id="transfer-target">
                <SelectValue
                  placeholder={targets.isLoading ? 'Loading courses…' : 'Choose a course'}
                />
              </SelectTrigger>
              <SelectContent>
                {rows.map((r) => (
                  <SelectItem key={r.id} value={r.id} disabled={r.spots_remaining < seatsNeeded}>
                    {r.template_name ?? 'Course'} · {formatDate(r.event_date)}
                    {r.venue_postcode ? ` · ${r.venue_postcode}` : ''} ({r.spots_remaining} left)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!targets.isLoading && rows.length === 0 ? (
              <p className="text-daisy-muted text-xs">
                No other upcoming scheduled courses to move this booking to.
              </p>
            ) : null}
          </div>

          <label className="border-daisy-line bg-daisy-paper-soft flex items-start gap-3 rounded-[8px] border-2 p-3">
            <input
              type="checkbox"
              checked={notifyCustomer}
              onChange={(e) => setNotifyCustomer(e.target.checked)}
              disabled={mutation.isPending}
              className="mt-0.5 h-4 w-4"
            />
            <span className="flex flex-col">
              <span className="text-sm font-bold">Notify the customer</span>
              <span className="text-daisy-muted text-xs">
                Sends a fresh booking confirmation email with the new course details.
              </span>
            </span>
          </label>

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
            <Button type="submit" size="sm" disabled={mutation.isPending || targetId.length === 0}>
              {mutation.isPending ? 'Moving…' : 'Move booking'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
