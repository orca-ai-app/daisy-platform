import { Link, useParams } from 'react-router';
import { formatInTimeZone } from 'date-fns-tz';
import { PageHeader, StatusPill, EmptyState } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatPence } from '@/lib/format';
import { useBooking, useBookingActivity } from './queries';
import type { ActivityRow, BookingStatus, PaymentStatus } from '@/types/franchisee';
import type { StatusVariant } from '@/components/daisy/StatusPill';

function formatLondonDateTime(iso: string): string {
  try {
    return formatInTimeZone(new Date(iso), 'Europe/London', 'd MMM yyyy, HH:mm');
  } catch {
    return iso;
  }
}

function formatLondonDate(iso: string | null): string {
  if (!iso) return '-';
  try {
    return formatInTimeZone(new Date(iso), 'Europe/London', 'd MMM yyyy');
  } catch {
    return iso;
  }
}

function formatTime(t: string | null): string {
  if (!t) return '';
  // Postgres TIME serialises as HH:MM:SS — slice to HH:MM.
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

export default function BookingDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: booking, isLoading, error } = useBooking(id);
  const { data: activity = [], isLoading: activityLoading } = useBookingActivity(id);

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/hq/bookings"
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
              <Link to="/hq/bookings">Back to list</Link>
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

          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Booking summary</CardTitle>
                  <CardDescription>
                    Read-only. Cancel and refund actions land with the franchisee portal in M2.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                    <Field label="Course" value={booking.course_instance?.template?.name ?? '-'} />
                    <Field
                      label="Event date"
                      value={formatLondonDate(booking.course_instance?.event_date ?? null)}
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
                      label="Venue postcode"
                      value={booking.course_instance?.venue_postcode ?? '-'}
                    />
                    {booking.course_instance?.venue_name ? (
                      <Field label="Venue name" value={booking.course_instance.venue_name} />
                    ) : null}
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
                      <Field label="Refunded" value={formatPence(booking.refund_amount_pence)} />
                    ) : null}
                    {booking.notes ? <Field label="Notes" value={booking.notes} full /> : null}
                  </dl>
                </CardContent>
              </Card>

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

              <Card>
                <CardHeader>
                  <CardTitle>Payment</CardTitle>
                  <CardDescription>
                    Stripe identifiers shown for traceability. Refund and cancel tools ship in Wave
                    4.
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
                    <Field
                      label="Stripe checkout session"
                      value={
                        <span className="font-mono text-[12px] break-all">
                          {booking.stripe_checkout_session_id ?? '-'}
                        </span>
                      }
                      full
                    />
                    <Field
                      label="Stripe payment intent"
                      value={
                        <span className="font-mono text-[12px] break-all">
                          {booking.stripe_payment_intent_id ?? '-'}
                        </span>
                      }
                      full
                    />
                  </dl>
                </CardContent>
              </Card>

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

            <aside className="flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Franchisee</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {booking.franchisee ? (
                    <>
                      <div className="flex items-center gap-2">
                        <Badge variant="primary">
                          #{booking.franchisee.number.padStart(4, '0')}
                        </Badge>
                        <span className="font-semibold">{booking.franchisee.name}</span>
                      </div>
                      <span className="text-daisy-muted text-[13px]">
                        {booking.franchisee.email}
                      </span>
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/hq/franchisees/${booking.franchisee.id}`}>
                          View franchisee →
                        </Link>
                      </Button>
                    </>
                  ) : (
                    <p className="text-daisy-muted text-sm">Franchisee record missing.</p>
                  )}
                </CardContent>
              </Card>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

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
