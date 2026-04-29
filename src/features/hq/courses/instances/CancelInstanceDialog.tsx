import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  useCancelCourseInstance,
  useCourseInstanceBookingsCount,
  type CourseInstanceDetail,
} from './queries';

interface Props {
  instance: CourseInstanceDetail;
  open: boolean;
  onClose: () => void;
}

export default function CancelInstanceDialog({ instance, open, onClose }: Props) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cancelInstance = useCancelCourseInstance();
  const bookingsCount = useCourseInstanceBookingsCount(instance.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      setError('Please provide a reason for cancelling.');
      return;
    }
    setError(null);
    try {
      const result = await cancelInstance.mutateAsync({
        id: instance.id,
        fields: { cancellation_reason: trimmed },
      });
      const n = result.bookings_affected;
      const noun = n === 1 ? 'booking' : 'bookings';
      toast.success(n > 0 ? `Course cancelled (${n} ${noun} affected)` : 'Course cancelled');
      setReason('');
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Cancel failed';
      toast.error(message);
    }
  };

  const n = bookingsCount.data ?? 0;

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel course</DialogTitle>
          <DialogDescription>
            This sets the course status to <strong>cancelled</strong> and stamps the reason against
            it. Existing bookings stay in place. Refunds and customer notifications are handled in a
            later wave.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <div
            className="rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-3 text-sm text-[#8A2A2A]"
            role="status"
          >
            {bookingsCount.isLoading ? (
              <span>Counting bookings…</span>
            ) : n === 0 ? (
              <span>No bookings on this course yet.</span>
            ) : (
              <span>
                <strong>{n}</strong> {n === 1 ? 'booking is' : 'bookings are'} attached to this
                course. They will not be cancelled or refunded automatically.
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ci-cancel-reason">Cancellation reason</Label>
            <textarea
              id="ci-cancel-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              placeholder="e.g. Trainer unavailable, venue double-booked"
              className="border-daisy-line text-daisy-ink placeholder:text-daisy-muted focus-visible:border-daisy-primary rounded-[8px] border-2 bg-white px-3 py-2 text-sm focus-visible:outline-none"
            />
            {error ? <p className="text-daisy-orange text-xs">{error}</p> : null}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Keep course
            </Button>
            <Button type="submit" variant="destructive" disabled={cancelInstance.isPending}>
              {cancelInstance.isPending ? 'Cancelling…' : 'Cancel course'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
