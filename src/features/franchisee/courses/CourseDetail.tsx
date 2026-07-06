/**
 * /franchisee/courses/:id — course instance detail for the franchisee portal.
 *
 * Mirrors HQ InstanceDetail structure but scoped to the owning franchisee:
 *  - Read-only info card (template, date/time, venue, capacity, status, visibility).
 *  - Ticket-types panel with inline add/edit/delete modals.
 *  - "Edit course" navigates to EditCourse (/franchisee/courses/:id/edit).
 *  - "Cancel course" modal POSTs to the extended cancel-course-instance EF.
 *
 * Wave 7B.
 */
import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { formatInTimeZone } from 'date-fns-tz';
import {
  Pencil,
  XCircle,
  Plus,
  Trash2,
  Edit2,
  Copy,
  MessageCircle,
  Link2,
  QrCode,
  Download,
} from 'lucide-react';
import QRCode from 'qrcode';
import { toast } from 'sonner';

import { PageHeader, StatusPill, EmptyState } from '@/components/daisy';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { formatPence } from '@/lib/format';
import {
  useActivityLog,
  formatActivityDescription,
  type ActivityRow,
} from '@/lib/queries/activities';

import {
  useCourseInstance,
  useCourseTicketTypes,
  useCancelCourseInstance,
  useCourseBookingsCount,
  useCreateTicketType,
  useUpdateTicketType,
  useDeleteTicketType,
  courseInstanceStatusVariant,
  type TicketTypeInput,
} from './courseDetailQueries';
import type { TicketType } from './types';
import { useOwnProfile } from '../profileQueries';

// ---------------------------------------------------------------------------
// Date / time helpers (BST-safe — never reconstruct via toISOString)
// ---------------------------------------------------------------------------

function formatLondonDate(d: string | null): string {
  if (!d) return '-';
  try {
    // Append T00:00:00Z to treat the DATE as midnight UTC so the conversion
    // to Europe/London gives the correct wall-clock date even during BST.
    return formatInTimeZone(new Date(`${d}T00:00:00Z`), 'Europe/London', 'd MMM yyyy');
  } catch {
    return d;
  }
}

function formatLondonDateTime(iso: string): string {
  try {
    return formatInTimeZone(new Date(iso), 'Europe/London', 'd MMM yyyy, HH:mm');
  } catch {
    return iso;
  }
}

function formatTime(t: string | null): string {
  if (!t) return '';
  return t.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Ticket-type form schema
// ---------------------------------------------------------------------------

const ticketTypeSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  price_pounds: z
    .number({ invalid_type_error: 'Price must be a number' })
    .nonnegative('Price cannot be negative'),
  seats_consumed: z
    .number({ invalid_type_error: 'Seats must be a number' })
    .int()
    .min(1, 'At least 1 seat'),
  max_available: z
    .number({ invalid_type_error: 'Max must be a number' })
    .int()
    .positive('Must be positive')
    .nullable(),
});

type TicketTypeFormValues = z.infer<typeof ticketTypeSchema>;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CourseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [cancelling, setCancelling] = useState(false);
  const [addingTicket, setAddingTicket] = useState(false);
  const [editingTicket, setEditingTicket] = useState<TicketType | null>(null);
  const [deletingTicket, setDeletingTicket] = useState<TicketType | null>(null);

  const { data: instance, isLoading, error } = useCourseInstance(id);
  const { data: ticketTypes = [], isLoading: ticketTypesLoading } = useCourseTicketTypes(id);
  const { data: ownProfile } = useOwnProfile();
  const activity = useActivityLog({ entityType: 'course_instance', entityId: id, limit: 25 });

  const isCancelled = instance?.status === 'cancelled';

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/franchisee/courses"
        className="text-daisy-primary mb-3 inline-flex items-center gap-1 text-sm font-semibold hover:underline"
      >
        ← Back to courses
      </Link>

      {error ? (
        <div className="rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
          Could not load course: {(error as Error).message}
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-4 w-96" />
        </div>
      ) : !instance ? (
        <EmptyState
          title="Course not found"
          body="This course may have been removed or the link is incorrect."
          action={
            <Button asChild variant="outline">
              <Link to="/franchisee/courses">Back to list</Link>
            </Button>
          }
        />
      ) : (
        <>
          <PageHeader
            title={
              <span>
                {instance.template?.name ?? 'Course'}
                <span className="text-daisy-muted ml-2 font-mono text-[16px] font-semibold">
                  {formatLondonDate(instance.event_date)}
                </span>
              </span>
            }
            subtitle={`${formatTime(instance.start_time)} – ${formatTime(instance.end_time)} · ${instance.venue_postcode}`}
            actions={
              <>
                <StatusPill variant={courseInstanceStatusVariant(instance.status)}>
                  {instance.status}
                </StatusPill>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void navigate(`/franchisee/courses/${instance.id}/edit`)}
                  disabled={isCancelled}
                  title={isCancelled ? 'Course is cancelled' : undefined}
                >
                  <Pencil aria-hidden className="h-4 w-4" />
                  Edit course
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setCancelling(true)}
                  disabled={isCancelled}
                  title={isCancelled ? 'Already cancelled' : undefined}
                >
                  <XCircle aria-hidden className="h-4 w-4" />
                  Cancel course
                </Button>
              </>
            }
          />

          {isCancelled ? (
            <div className="rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
              <strong>Cancelled.</strong> {instance.cancellation_reason ?? 'No reason recorded.'}
            </div>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div className="flex flex-col gap-4">
              {/* Course details */}
              <Card>
                <CardHeader>
                  <CardTitle>Course details</CardTitle>
                  <CardDescription>
                    Use the Edit button above to change date, time, venue or capacity.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                    <Field label="Template" value={instance.template?.name ?? '-'} />
                    <Field label="Status">
                      <StatusPill variant={courseInstanceStatusVariant(instance.status)}>
                        {instance.status}
                      </StatusPill>
                    </Field>
                    <Field label="Event date" value={formatLondonDate(instance.event_date)} />
                    <Field
                      label="Time"
                      value={`${formatTime(instance.start_time)} – ${formatTime(instance.end_time)}`}
                    />
                    <Field
                      label="Capacity"
                      value={`${instance.capacity - instance.spots_remaining} / ${instance.capacity} sold`}
                    />
                    <Field label="Base price" value={formatPence(instance.price_pence)} />
                    <Field label="Visibility" value={instance.visibility} />
                    {instance.out_of_territory ? (
                      <Field
                        label="Territory warning"
                        value={instance.out_of_territory_warning ?? 'out of territory'}
                      />
                    ) : null}
                    {instance.bespoke_details ? (
                      <Field label="Notes" value={instance.bespoke_details} full />
                    ) : null}
                  </dl>
                </CardContent>
              </Card>

              {/* Venue */}
              <Card>
                <CardHeader>
                  <CardTitle>Venue</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                    <Field label="Name" value={instance.venue_name ?? '-'} />
                    <Field label="Postcode" value={instance.venue_postcode} />
                    <Field label="Address" value={instance.venue_address ?? '-'} full />
                  </dl>
                </CardContent>
              </Card>

              {/* Ticket types */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <div>
                    <CardTitle>Ticket types</CardTitle>
                    <CardDescription>
                      Add ticket variants (Single, Couple, Family, etc.).
                    </CardDescription>
                  </div>
                  {!isCancelled ? (
                    <Button size="sm" variant="outline" onClick={() => setAddingTicket(true)}>
                      <Plus aria-hidden className="h-4 w-4" />
                      Add ticket type
                    </Button>
                  ) : null}
                </CardHeader>
                <CardContent>
                  {ticketTypesLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                    </div>
                  ) : ticketTypes.length === 0 ? (
                    <p className="text-daisy-muted text-sm">
                      No ticket types yet. Add one above to let customers choose seat options.
                    </p>
                  ) : (
                    <ul className="divide-daisy-line-soft divide-y">
                      {ticketTypes.map((tt) => (
                        <li
                          key={tt.id}
                          className="flex items-center justify-between gap-3 py-2.5 text-sm"
                        >
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="font-semibold">{tt.name}</span>
                            <span className="text-daisy-muted text-[12px]">
                              {formatPence(tt.price_pence)} · {tt.seats_consumed} seat
                              {tt.seats_consumed === 1 ? '' : 's'}{' '}
                              {tt.max_available != null
                                ? `· max ${tt.max_available}`
                                : '· unlimited'}
                            </span>
                          </div>
                          {!isCancelled ? (
                            <div className="flex shrink-0 gap-1.5">
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Edit ticket type"
                                onClick={() => setEditingTicket(tt)}
                              >
                                <Edit2 className="h-4 w-4" aria-hidden />
                                <span className="sr-only">Edit {tt.name}</span>
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Delete ticket type"
                                onClick={() => setDeletingTicket(tt)}
                              >
                                <Trash2 className="h-4 w-4 text-[#8A2A2A]" aria-hidden />
                                <span className="sr-only">Delete {tt.name}</span>
                              </Button>
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              {/* Activity timeline */}
              <Card>
                <CardHeader>
                  <CardTitle>Activity</CardTitle>
                  <CardDescription>Audit log entries for this course.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <ActivityTimeline
                    rows={activity.data?.pages.flatMap((p) => p.rows) ?? []}
                    isLoading={activity.isLoading}
                  />
                </CardContent>
              </Card>
            </div>

            {/* Sidebar */}
            <aside className="flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Metadata</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-4">
                    <Field label="Created" value={formatLondonDateTime(instance.created_at)} />
                    <Field label="Updated" value={formatLondonDateTime(instance.updated_at)} />
                    <Field
                      label="ID"
                      value={<span className="font-mono text-[12px] break-all">{instance.id}</span>}
                    />
                  </dl>
                </CardContent>
              </Card>

              {/* Booking link card — all scheduled courses with a booking token */}
              {instance.booking_token && !isCancelled ? (
                <BookingLinkCard
                  bookingToken={instance.booking_token}
                  courseName={instance.template?.name ?? 'Course'}
                />
              ) : null}

              {/* Medical declaration QR — all non-cancelled scheduled courses */}
              {!isCancelled && ownProfile?.number ? (
                <MedicalQrCard
                  franchiseeNumber={ownProfile.number}
                  venuePostcode={instance.venue_postcode}
                  bookingToken={instance.booking_token}
                />
              ) : null}
            </aside>
          </div>

          {/* Modals */}
          {cancelling ? (
            <CancelDialog
              instanceId={instance.id}
              open={cancelling}
              onClose={() => setCancelling(false)}
            />
          ) : null}

          {addingTicket && id ? (
            <TicketTypeFormDialog
              mode="create"
              courseInstanceId={id}
              open={addingTicket}
              onClose={() => setAddingTicket(false)}
            />
          ) : null}

          {editingTicket ? (
            <TicketTypeFormDialog
              mode="edit"
              ticketType={editingTicket}
              open={!!editingTicket}
              onClose={() => setEditingTicket(null)}
            />
          ) : null}

          {deletingTicket ? (
            <DeleteTicketTypeDialog
              ticketType={deletingTicket}
              open={!!deletingTicket}
              onClose={() => setDeletingTicket(null)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field helper
// ---------------------------------------------------------------------------

function Field({
  label,
  value,
  full = false,
  children,
}: {
  label: string;
  value?: React.ReactNode;
  full?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <dt className="text-daisy-muted text-[11px] font-bold tracking-wider uppercase">{label}</dt>
      <dd className="text-daisy-ink mt-1 text-sm">{children ?? value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CancelDialog
// ---------------------------------------------------------------------------

function CancelDialog({
  instanceId,
  open,
  onClose,
}: {
  instanceId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const cancelInstance = useCancelCourseInstance();
  const bookingsCount = useCourseBookingsCount(instanceId);
  const n = bookingsCount.data ?? 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      setFieldError('Please provide a cancellation reason.');
      return;
    }
    setFieldError(null);
    try {
      const result = await cancelInstance.mutateAsync({
        id: instanceId,
        fields: { cancellation_reason: trimmed },
      });
      const affected = result.bookings_affected;
      const noun = affected === 1 ? 'booking' : 'bookings';
      toast.success(
        affected > 0 ? `Course cancelled (${affected} ${noun} affected)` : 'Course cancelled',
      );
      setReason('');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Cancel failed');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel course</DialogTitle>
          <DialogDescription>
            Sets the course status to <strong>cancelled</strong> and stamps the reason. Existing
            bookings are preserved. Refunds and customer notifications are handled in a later wave.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 flex flex-col gap-4">
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
            <Label htmlFor="fr-cancel-reason">Cancellation reason</Label>
            <textarea
              id="fr-cancel-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              placeholder="e.g. Trainer unavailable, venue double-booked"
              className="border-daisy-line text-daisy-ink placeholder:text-daisy-muted focus-visible:border-daisy-primary rounded-[8px] border-2 bg-white px-3 py-2 text-sm focus-visible:outline-none"
            />
            {fieldError ? <p className="text-daisy-orange text-xs">{fieldError}</p> : null}
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

// ---------------------------------------------------------------------------
// TicketTypeFormDialog — handles both create and edit
// ---------------------------------------------------------------------------

type TicketTypeFormDialogProps =
  | {
      mode: 'create';
      courseInstanceId: string;
      open: boolean;
      onClose: () => void;
      ticketType?: never;
    }
  | {
      mode: 'edit';
      ticketType: TicketType;
      open: boolean;
      onClose: () => void;
      courseInstanceId?: never;
    };

function TicketTypeFormDialog(props: TicketTypeFormDialogProps) {
  const { mode, open, onClose } = props;
  const createTicketType = useCreateTicketType();
  const updateTicketType = useUpdateTicketType();

  const defaultValues: TicketTypeFormValues = {
    name: mode === 'edit' ? props.ticketType.name : '',
    price_pounds: mode === 'edit' ? props.ticketType.price_pence / 100 : 0,
    seats_consumed: mode === 'edit' ? props.ticketType.seats_consumed : 1,
    max_available: mode === 'edit' ? props.ticketType.max_available : null,
  };

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TicketTypeFormValues>({
    resolver: zodResolver(ticketTypeSchema),
    defaultValues,
  });

  const onSubmit = async (values: TicketTypeFormValues) => {
    const input: TicketTypeInput = {
      name: values.name,
      price_pence: Math.round(values.price_pounds * 100),
      seats_consumed: values.seats_consumed,
      max_available: values.max_available,
    };

    try {
      if (mode === 'create') {
        await createTicketType.mutateAsync({
          course_instance_id: props.courseInstanceId,
          ticket_type: input,
        });
        toast.success('Ticket type added');
      } else {
        await updateTicketType.mutateAsync({
          id: props.ticketType.id,
          fields: input,
        });
        toast.success('Ticket type updated');
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Add ticket type' : 'Edit ticket type'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Define a new ticket variant for this course.'
              : 'Update the ticket type details.'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="mt-4 flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tt-name">Name</Label>
            <Input id="tt-name" placeholder="e.g. Single, Couple, Family" {...register('name')} />
            {errors.name ? (
              <p className="text-daisy-orange text-xs">{errors.name.message}</p>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tt-price">Price (£)</Label>
              <Input
                id="tt-price"
                type="number"
                step="0.01"
                min="0"
                {...register('price_pounds', { valueAsNumber: true })}
              />
              {errors.price_pounds ? (
                <p className="text-daisy-orange text-xs">{errors.price_pounds.message}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tt-seats">Seats used</Label>
              <Input
                id="tt-seats"
                type="number"
                step="1"
                min="1"
                {...register('seats_consumed', { valueAsNumber: true })}
              />
              {errors.seats_consumed ? (
                <p className="text-daisy-orange text-xs">{errors.seats_consumed.message}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tt-max">Max available</Label>
              <Input
                id="tt-max"
                type="number"
                step="1"
                min="1"
                placeholder="Unlimited"
                {...register('max_available', {
                  setValueAs: (v: string) => (v === '' || v === null ? null : Number(v)),
                })}
              />
              {errors.max_available ? (
                <p className="text-daisy-orange text-xs">{errors.max_available.message}</p>
              ) : null}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : mode === 'create' ? 'Add ticket type' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// DeleteTicketTypeDialog
// ---------------------------------------------------------------------------

function DeleteTicketTypeDialog({
  ticketType,
  open,
  onClose,
}: {
  ticketType: TicketType;
  open: boolean;
  onClose: () => void;
}) {
  const deleteTicketType = useDeleteTicketType();

  const handleDelete = async () => {
    try {
      await deleteTicketType.mutateAsync({ id: ticketType.id });
      toast.success(`"${ticketType.name}" removed`);
      onClose();
    } catch (err) {
      // The EF returns a human-readable message for the booking-reference block.
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove ticket type</DialogTitle>
          <DialogDescription>
            Remove <strong>{ticketType.name}</strong> ({formatPence(ticketType.price_pence)}) from
            this course? This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-3 text-sm text-[#8A2A2A]">
          If any bookings use this ticket type, the delete will be blocked and you will see a clear
          message explaining why.
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handleDelete()}
            disabled={deleteTicketType.isPending}
          >
            {deleteTicketType.isPending ? 'Removing…' : 'Remove ticket type'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// MedicalQrCard — medical declaration QR code (Wave 12)
//
// Encodes https://medical.daisyfirstaid.com/?instructor={number}&postcode={prefix}
// where prefix = everything before the last 3 chars of the venue postcode,
// uppercased and with spaces stripped. e.g. "AB6 4BS" → "AB6".
// ---------------------------------------------------------------------------

/** Derive the outward code from a full postcode, e.g. "AB6 4BS" → "AB6". */
function postcodePrefix(postcode: string | null): string {
  if (!postcode) return '';
  const stripped = postcode.replace(/\s+/g, '').toUpperCase();
  if (stripped.length <= 3) return stripped;
  return stripped.slice(0, stripped.length - 3);
}

const MEDICAL_BASE = 'https://medical.daisyfirstaid.com/';

interface MedicalQrCardProps {
  franchiseeNumber: string;
  venuePostcode: string | null;
  bookingToken?: string | null;
}

function MedicalQrCard({ franchiseeNumber, venuePostcode, bookingToken }: MedicalQrCardProps) {
  const prefix = postcodePrefix(venuePostcode);
  let url = `${MEDICAL_BASE}?instructor=${encodeURIComponent(franchiseeNumber)}&postcode=${encodeURIComponent(prefix)}`;
  if (bookingToken) {
    url += `&course=${encodeURIComponent(bookingToken)}`;
  }

  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { width: 256, margin: 2, color: { dark: '#1a1a2e', light: '#ffffff' } })
      .then((du) => {
        if (!cancelled) setDataUrl(du);
      })
      .catch((err: unknown) => {
        if (!cancelled) setQrError(err instanceof Error ? err.message : 'QR generation failed');
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Suppress unused-ref lint — we keep the ref for potential future canvas use
  void canvasRef;

  const handleDownload = () => {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `medical-declaration-qr-${franchiseeNumber}-${prefix}${bookingToken ? `-${bookingToken}` : ''}.png`;
    a.click();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <QrCode aria-hidden className="text-daisy-primary h-4 w-4" />
          <CardTitle>Medical declaration QR</CardTitle>
        </div>
        <CardDescription>
          Display this QR code at your course so attendees can submit their medical declaration
          before the session starts.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {qrError ? (
          <p className="text-daisy-orange text-sm">{qrError}</p>
        ) : dataUrl ? (
          <div className="flex flex-col items-center gap-3">
            <img
              src={dataUrl}
              alt="Medical declaration QR code"
              width={192}
              height={192}
              className="rounded-[8px] border border-[#E5E7EB]"
            />
          </div>
        ) : (
          <div className="flex h-48 items-center justify-center">
            <span className="text-daisy-muted text-sm">Generating QR…</span>
          </div>
        )}

        <div className="border-daisy-line bg-daisy-paper rounded-[8px] border px-3 py-2">
          <p className="text-daisy-muted mb-1 text-[11px] font-bold tracking-wider uppercase">
            Destination URL
          </p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-daisy-primary text-xs font-medium break-all underline underline-offset-2"
          >
            {url}
          </a>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={handleDownload} disabled={!dataUrl}>
            <Download aria-hidden className="h-4 w-4" />
            Download PNG
          </Button>

          <Button size="sm" variant="outline" onClick={() => window.print()}>
            Print
          </Button>
        </div>

        <p className="text-daisy-muted text-[11px]">
          Each submission is linked to instructor <strong>{franchiseeNumber}</strong> and postcode
          prefix <strong>{prefix || '—'}</strong>.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// BookingLinkCard — all scheduled courses with a booking_token (Wave 11)
//
// Replaces the M2 PaymentLinkCard. The standalone booking page at
// https://booking.daisyfirstaid.com/book/:token is the single entry point
// for all course bookings (public and private). No Edge Function call needed —
// the URL is derived purely from the booking_token already on the instance.
// ---------------------------------------------------------------------------

/** Base URL for the public booking micro-site. */
const BOOKING_BASE = 'https://booking.daisyfirstaid.com';

interface BookingLinkCardProps {
  bookingToken: string;
  courseName: string;
}

function BookingLinkCard({ bookingToken, courseName }: BookingLinkCardProps) {
  const bookingUrl = `${BOOKING_BASE}/book/${bookingToken}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(bookingUrl);
      toast.success('Booking link copied to clipboard');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const whatsAppHref = encodeURIComponent(`Book your place on ${courseName}: ${bookingUrl}`);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Link2 aria-hidden className="text-daisy-primary h-4 w-4" />
          <CardTitle>Booking link</CardTitle>
        </div>
        <CardDescription>
          Share this link so customers can book directly. Works for both public and private courses.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="border-daisy-line bg-daisy-paper rounded-[8px] border px-3 py-2">
          <p className="text-daisy-muted mb-1 text-[11px] font-bold tracking-wider uppercase">
            Booking URL
          </p>
          <a
            href={bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-daisy-primary text-sm font-medium break-all underline underline-offset-2"
          >
            {bookingUrl}
          </a>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void handleCopy()}>
            <Copy aria-hidden className="h-4 w-4" />
            Copy link
          </Button>

          <Button size="sm" variant="outline" asChild>
            <a
              href={`https://wa.me/?text=${whatsAppHref}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle aria-hidden className="h-4 w-4" />
              Send via WhatsApp
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ActivityTimeline
// ---------------------------------------------------------------------------

function ActivityTimeline({ rows, isLoading }: { rows: ActivityRow[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="space-y-2 p-5">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="p-5">
        <EmptyState
          title="No activity yet"
          body="Audit log entries for this course will appear here as they happen."
        />
      </div>
    );
  }
  return (
    <ol className="divide-daisy-line divide-y divide-dashed">
      {rows.map((row) => (
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
            <div className="text-daisy-muted mt-0.5 text-sm">{formatActivityDescription(row)}</div>
            <div className="text-daisy-muted mt-1 text-[12px]">
              {formatLondonDateTime(row.created_at)}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
