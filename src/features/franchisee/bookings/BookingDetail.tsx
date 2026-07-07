/**
 * /franchisee/bookings/:id — franchisee booking detail page (Wave 9A).
 *
 * Shows customer info, course + ticket info, payment info, private client (if
 * any), notes (append-only display), and an audit activity timeline.
 *
 * Actions available to the franchisee:
 *  - Mark as paid: only when payment_status='pending'. Opens an inline form
 *    asking for a payment reference. Calls mark-booking-paid EF.
 *  - Add note: append-only. Opens a textarea dialog. Calls add-booking-note EF.
 *  - Cancel booking: sets booking_status='cancelled'. Opens a form asking for
 *    a reason and an optional refund amount (pence, record-only — no Stripe
 *    action). Calls cancel-booking EF.
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { formatInTimeZone } from 'date-fns-tz';
import { toast } from 'sonner';
import { PageHeader, StatusPill, EmptyState } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatPence } from '@/lib/format';
import { BookingEmailsCard } from '@/features/bookings/BookingEmailsCard';
import type { ActivityRow, BookingStatus, PaymentStatus } from '@/types/franchisee';
import type { StatusVariant } from '@/components/daisy/StatusPill';
import {
  useBookingDetail,
  useBookingActivity,
  useMarkBookingPaid,
  useAddBookingNote,
  useCancelBooking,
} from './bookingsQueries';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatLondonDateTime(iso: string): string {
  try {
    return formatInTimeZone(new Date(iso), 'Europe/London', 'd MMM yyyy, HH:mm');
  } catch {
    return iso;
  }
}

/**
 * Format a Postgres DATE string ('YYYY-MM-DD') without UTC conversion.
 * Splits on '-' and builds a local Date from integer parts.
 */
function formatDate(d: string | null): string {
  if (!d) return '-';
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

function formatTime(t: string | null): string {
  if (!t) return '';
  return t.slice(0, 5);
}

function paymentStatusVariant(p: PaymentStatus): StatusVariant {
  return p === 'refunded' ? 'manual' : p;
}

function bookingStatusVariant(s: BookingStatus): StatusVariant {
  if (s === 'cancelled') return 'terminated';
  if (s === 'no_show') return 'failed';
  if (s === 'attended') return 'paid';
  return 'active';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Field({
  label,
  value,
  full = false,
}: {
  label: string;
  value: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <dt className="text-daisy-muted text-[11px] font-bold tracking-wider uppercase">{label}</dt>
      <dd className="text-daisy-ink mt-1 text-sm">{value}</dd>
    </div>
  );
}

function ActivityTimeline({
  activity,
  isLoading,
}: {
  activity: ActivityRow[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2 p-5">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }
  if (activity.length === 0) {
    return (
      <div className="p-5">
        <EmptyState
          title="No activity yet"
          body="Audit log entries for this booking will appear here as they happen."
        />
      </div>
    );
  }
  return (
    <ol className="divide-daisy-line divide-y divide-dashed">
      {activity.map((row) => (
        <li key={row.id} className="flex items-start gap-3 px-5 py-3.5">
          <span
            className="bg-daisy-primary mt-1 inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
            aria-hidden
          />
          <div className="flex-1">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-daisy-ink font-bold">{row.action}</span>
              <Badge variant="default">{row.actor_type}</Badge>
            </div>
            {row.description ? (
              <div className="text-daisy-muted mt-0.5 text-sm">{row.description}</div>
            ) : null}
            <div className="text-daisy-muted mt-1 text-[12px]">
              {formatLondonDateTime(row.created_at)}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Mark as paid dialog
// ---------------------------------------------------------------------------

function MarkAsPaidDialog({
  open,
  bookingId,
  onClose,
}: {
  open: boolean;
  bookingId: string;
  onClose: () => void;
}) {
  const [paymentReference, setPaymentReference] = useState('');
  const mutation = useMarkBookingPaid();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ref = paymentReference.trim();
    if (!ref) return;

    mutation.mutate(
      { booking_id: bookingId, payment_reference: ref },
      {
        onSuccess: () => {
          toast.success('Booking marked as manually paid.');
          setPaymentReference('');
          onClose();
        },
        onError: (err) => {
          toast.error(err.message ?? 'Failed to mark booking as paid.');
        },
      },
    );
  }

  function handleOpenChange(next: boolean) {
    if (!next && !mutation.isPending) {
      setPaymentReference('');
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark as manually paid</DialogTitle>
          <DialogDescription>
            Record this booking as paid by cheque, invoice, or other manual method. Enter a
            reference (cheque number, invoice ID, etc.) for the audit trail.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="payment_reference"
              className="text-daisy-muted text-[11px] font-bold tracking-wider uppercase"
            >
              Payment reference
            </label>
            <Input
              id="payment_reference"
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              placeholder="e.g. Cheque 001234, INV-2026-004"
              required
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
            <Button
              type="submit"
              size="sm"
              disabled={mutation.isPending || paymentReference.trim().length === 0}
            >
              {mutation.isPending ? 'Saving…' : 'Mark as paid'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Add note dialog
// ---------------------------------------------------------------------------

function AddNoteDialog({
  open,
  bookingId,
  onClose,
}: {
  open: boolean;
  bookingId: string;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const mutation = useAddBookingNote();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = note.trim();
    if (!trimmed) return;

    mutation.mutate(
      { booking_id: bookingId, note: trimmed },
      {
        onSuccess: () => {
          toast.success('Note added to booking.');
          setNote('');
          onClose();
        },
        onError: (err) => {
          toast.error(err.message ?? 'Failed to add note.');
        },
      },
    );
  }

  function handleOpenChange(next: boolean) {
    if (!next && !mutation.isPending) {
      setNote('');
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add note</DialogTitle>
          <DialogDescription>
            Notes are append-only and timestamped. Each entry is prefixed with the date and time
            (UTC) it was added.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="note_text"
              className="text-daisy-muted text-[11px] font-bold tracking-wider uppercase"
            >
              Note
            </label>
            <textarea
              id="note_text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note about this booking…"
              rows={4}
              required
              disabled={mutation.isPending}
              className="border-daisy-line text-daisy-ink placeholder:text-daisy-muted focus-visible:border-daisy-primary w-full rounded-[8px] border-2 bg-white px-3 py-2 text-sm focus-visible:outline-none disabled:opacity-60"
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
            <Button
              type="submit"
              size="sm"
              disabled={mutation.isPending || note.trim().length === 0}
            >
              {mutation.isPending ? 'Saving…' : 'Add note'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Cancel booking dialog
// ---------------------------------------------------------------------------

function CancelBookingDialog({
  open,
  bookingId,
  totalPricePence,
  onClose,
}: {
  open: boolean;
  bookingId: string;
  totalPricePence: number;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [refundInput, setRefundInput] = useState('');
  const mutation = useCancelBooking();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedReason = reason.trim();
    if (!trimmedReason) return;

    // Parse the refund input as a pound amount and convert to pence.
    // Empty input means no refund flagged.
    let refundAmountPence: number | undefined;
    if (refundInput.trim().length > 0) {
      const parsed = parseFloat(refundInput.replace(/[£,]/g, ''));
      if (!isNaN(parsed) && parsed > 0) {
        refundAmountPence = Math.round(parsed * 100);
      }
    }

    mutation.mutate(
      {
        booking_id: bookingId,
        cancellation_reason: trimmedReason,
        refund_amount_pence: refundAmountPence,
      },
      {
        onSuccess: () => {
          toast.success('Booking cancelled.');
          setReason('');
          setRefundInput('');
          onClose();
        },
        onError: (err) => {
          toast.error(err.message ?? 'Failed to cancel booking.');
        },
      },
    );
  }

  function handleOpenChange(next: boolean) {
    if (!next && !mutation.isPending) {
      setReason('');
      setRefundInput('');
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel booking</DialogTitle>
          <DialogDescription>
            This records the booking as cancelled. If a refund is owed, enter the amount below as a
            record-only flag — process the actual refund in your Stripe dashboard separately. Total
            booking value: {formatPence(totalPricePence)}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="cancel_reason"
              className="text-daisy-muted text-[11px] font-bold tracking-wider uppercase"
            >
              Cancellation reason
            </label>
            <textarea
              id="cancel_reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer requested cancellation, course rescheduled…"
              rows={3}
              required
              disabled={mutation.isPending}
              className="border-daisy-line text-daisy-ink placeholder:text-daisy-muted focus-visible:border-daisy-primary w-full rounded-[8px] border-2 bg-white px-3 py-2 text-sm focus-visible:outline-none disabled:opacity-60"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="refund_amount"
              className="text-daisy-muted text-[11px] font-bold tracking-wider uppercase"
            >
              Refund amount (£) — optional, record only
            </label>
            <Input
              id="refund_amount"
              type="text"
              inputMode="decimal"
              value={refundInput}
              onChange={(e) => setRefundInput(e.target.value)}
              placeholder="e.g. 25.00"
              disabled={mutation.isPending}
            />
            <p className="text-daisy-muted text-[11px]">
              Leave blank if no refund is owed. This amount is stored for reconciliation only — no
              automatic Stripe refund is triggered.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={mutation.isPending}
            >
              Keep booking
            </Button>
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              disabled={mutation.isPending || reason.trim().length === 0}
            >
              {mutation.isPending ? 'Cancelling…' : 'Cancel booking'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function BookingDetail() {
  const { id } = useParams<{ id: string }>();

  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [addNoteOpen, setAddNoteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const { data: booking, isLoading, error } = useBookingDetail(id);
  const { data: activity = [], isLoading: activityLoading } = useBookingActivity(id);

  const isCancelled = booking?.booking_status === 'cancelled';
  const isPending = booking?.payment_status === 'pending';

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/franchisee/bookings"
        className="text-daisy-primary mb-3 inline-flex items-center gap-1 text-sm font-semibold hover:underline"
      >
        ← Back to bookings
      </Link>

      {error ? (
        <div className="rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
          Could not load booking: {error.message}
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-4 w-96" />
        </div>
      ) : !booking ? (
        <EmptyState
          title="Booking not found"
          body="This booking may have been removed or the link is incorrect."
          action={
            <Button asChild variant="outline">
              <Link to="/franchisee/bookings">Back to list</Link>
            </Button>
          }
        />
      ) : (
        <>
          <PageHeader
            title={<span className="font-mono">{booking.booking_reference}</span>}
            subtitle={`Created ${formatLondonDateTime(booking.created_at)}`}
            actions={
              <>
                <StatusPill variant={paymentStatusVariant(booking.payment_status)}>
                  {booking.payment_status}
                </StatusPill>
                <StatusPill variant={bookingStatusVariant(booking.booking_status)}>
                  {booking.booking_status.replace('_', ' ')}
                </StatusPill>
              </>
            }
          />

          {/* Actions card */}
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
              <CardDescription>
                Manage this booking. Mark pending payments as received, add notes, or cancel.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setMarkPaidOpen(true)}
                  disabled={!isPending || isCancelled}
                  title={
                    isCancelled
                      ? 'Booking is cancelled'
                      : !isPending
                        ? `Payment status is '${booking.payment_status}' — only pending bookings can be marked as paid`
                        : undefined
                  }
                >
                  Mark as paid
                </Button>
                <Button variant="outline" size="sm" onClick={() => setAddNoteOpen(true)}>
                  Add note
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setCancelOpen(true)}
                  disabled={isCancelled}
                  title={isCancelled ? 'Booking is already cancelled' : undefined}
                >
                  Cancel booking
                </Button>
                {isCancelled ? (
                  <span className="text-daisy-muted text-xs italic">
                    This booking is already cancelled.
                  </span>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div className="flex flex-col gap-4">
              {/* Booking summary */}
              <Card>
                <CardHeader>
                  <CardTitle>Booking summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                    <Field label="Course" value={booking.course_instance?.template?.name ?? '-'} />
                    <Field
                      label="Event date"
                      value={formatDate(booking.course_instance?.event_date ?? null)}
                    />
                    <Field
                      label="Time"
                      value={
                        booking.course_instance?.start_time
                          ? `${formatTime(booking.course_instance.start_time)} – ${formatTime(booking.course_instance.end_time)}`
                          : '-'
                      }
                    />
                    <Field
                      label="Venue"
                      value={
                        booking.course_instance?.venue_name
                          ? `${booking.course_instance.venue_name} (${booking.course_instance.venue_postcode ?? ''})`
                          : (booking.course_instance?.venue_postcode ?? '-')
                      }
                    />
                    <Field
                      label="Ticket type"
                      value={
                        booking.ticket_type
                          ? `${booking.ticket_type.name} · ${booking.ticket_type.seats_consumed} seat${booking.ticket_type.seats_consumed === 1 ? '' : 's'}`
                          : '-'
                      }
                    />
                    <Field label="Quantity" value={booking.quantity.toString()} />
                    <Field label="Total" value={formatPence(booking.total_price_pence)} />
                    {booking.discount_code ? (
                      <Field
                        label="Discount"
                        value={`${booking.discount_code}: ${formatPence(booking.discount_amount_pence ?? 0)}`}
                      />
                    ) : null}
                    {booking.cancellation_reason ? (
                      <Field label="Cancellation reason" value={booking.cancellation_reason} full />
                    ) : null}
                    {booking.refund_amount_pence && booking.refund_amount_pence > 0 ? (
                      <Field
                        label="Refund flagged (record only)"
                        value={formatPence(booking.refund_amount_pence)}
                      />
                    ) : null}
                  </dl>
                </CardContent>
              </Card>

              {/* Customer */}
              <Card>
                <CardHeader>
                  <CardTitle>Customer</CardTitle>
                </CardHeader>
                <CardContent>
                  {booking.customer ? (
                    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                      <Field
                        label="Name"
                        value={`${booking.customer.first_name} ${booking.customer.last_name}`}
                      />
                      <Field label="Email" value={booking.customer.email} />
                      <Field label="Phone" value={booking.customer.phone ?? '-'} />
                      <Field label="Postcode" value={booking.customer.postcode ?? '-'} />
                    </dl>
                  ) : (
                    <p className="text-daisy-muted text-sm">Customer record missing.</p>
                  )}
                </CardContent>
              </Card>

              {/* Payment */}
              <Card>
                <CardHeader>
                  <CardTitle>Payment</CardTitle>
                  <CardDescription>
                    Use "Mark as paid" above to record manual payment by cheque or invoice.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                    <Field
                      label="Status"
                      value={
                        <StatusPill variant={paymentStatusVariant(booking.payment_status)}>
                          {booking.payment_status}
                        </StatusPill>
                      }
                    />
                    <Field label="Total" value={formatPence(booking.total_price_pence)} />
                  </dl>
                </CardContent>
              </Card>

              {/* Emails */}
              <BookingEmailsCard bookingId={booking.id} />

              {/* Notes */}
              <Card>
                <CardHeader>
                  <CardTitle>Notes</CardTitle>
                  <CardDescription>
                    Append-only. Each note is prefixed with the date and time it was added.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {booking.notes ? (
                    <pre className="text-daisy-ink font-sans text-sm leading-relaxed break-words whitespace-pre-wrap">
                      {booking.notes}
                    </pre>
                  ) : (
                    <p className="text-daisy-muted text-sm italic">No notes yet.</p>
                  )}
                </CardContent>
              </Card>

              {/* Activity timeline */}
              <Card>
                <CardHeader>
                  <CardTitle>Activity timeline</CardTitle>
                  <CardDescription>Audit log entries scoped to this booking.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <ActivityTimeline activity={activity} isLoading={activityLoading} />
                </CardContent>
              </Card>
            </div>

            {/* Sidebar */}
            <aside className="flex flex-col gap-4">
              {/* Private client (if linked) */}
              {booking.private_client ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Private client</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <span className="font-semibold">{booking.private_client.company_name}</span>
                    {booking.private_client.contact_name ? (
                      <span className="text-daisy-muted text-[13px]">
                        {booking.private_client.contact_name}
                      </span>
                    ) : null}
                    {booking.private_client.contact_email ? (
                      <span className="text-daisy-muted text-[13px]">
                        {booking.private_client.contact_email}
                      </span>
                    ) : null}
                    {booking.private_client.contact_phone ? (
                      <span className="text-daisy-muted text-[13px]">
                        {booking.private_client.contact_phone}
                      </span>
                    ) : null}
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/franchisee/clients`}>View all clients →</Link>
                    </Button>
                  </CardContent>
                </Card>
              ) : null}

              {/* Quick stats */}
              <Card>
                <CardHeader>
                  <CardTitle>Quick reference</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="flex flex-col gap-3">
                    <div>
                      <dt className="text-daisy-muted text-[11px] font-bold tracking-wider uppercase">
                        Reference
                      </dt>
                      <dd className="text-daisy-ink mt-1 font-mono text-sm font-bold">
                        {booking.booking_reference}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-daisy-muted text-[11px] font-bold tracking-wider uppercase">
                        Booking status
                      </dt>
                      <dd className="mt-1">
                        <StatusPill variant={bookingStatusVariant(booking.booking_status)}>
                          {booking.booking_status.replace('_', ' ')}
                        </StatusPill>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-daisy-muted text-[11px] font-bold tracking-wider uppercase">
                        Payment status
                      </dt>
                      <dd className="mt-1">
                        <StatusPill variant={paymentStatusVariant(booking.payment_status)}>
                          {booking.payment_status}
                        </StatusPill>
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </aside>
          </div>

          {/* Dialogs */}
          <MarkAsPaidDialog
            open={markPaidOpen}
            bookingId={booking.id}
            onClose={() => setMarkPaidOpen(false)}
          />
          <AddNoteDialog
            open={addNoteOpen}
            bookingId={booking.id}
            onClose={() => setAddNoteOpen(false)}
          />
          <CancelBookingDialog
            open={cancelOpen}
            bookingId={booking.id}
            totalPricePence={booking.total_price_pence}
            onClose={() => setCancelOpen(false)}
          />
        </>
      )}
    </div>
  );
}
