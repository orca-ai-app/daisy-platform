import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Pencil, XCircle } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import { PageHeader, StatusPill, EmptyState } from '@/components/daisy';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatPence } from '@/lib/format';
import {
  useActivityLog,
  formatActivityDescription,
  type ActivityRow,
} from '@/lib/queries/activities';
import { useCourseInstance, courseInstanceStatusVariant } from './queries';
import EditInstanceDialog from './EditInstanceDialog';
import CancelInstanceDialog from './CancelInstanceDialog';

function formatLondonDate(d: string | null): string {
  if (!d) return '-';
  try {
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

export default function InstanceDetail() {
  const { id } = useParams<{ id: string }>();
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const { data: instance, isLoading, error } = useCourseInstance(id);
  const activity = useActivityLog({ entityType: 'course_instance', entityId: id, limit: 25 });

  const isCancelled = instance?.status === 'cancelled';

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/hq/courses/instances"
        className="text-daisy-primary mb-3 inline-flex items-center gap-1 text-sm font-semibold hover:underline"
      >
        ← Back to instances
      </Link>

      {error ? (
        <div className="rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
          Could not load course instance: {error.message}
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-4 w-96" />
        </div>
      ) : !instance ? (
        <EmptyState
          title="Course instance not found"
          body="This course may have been removed or the link is incorrect."
          action={
            <Button asChild variant="outline">
              <Link to="/hq/courses/instances">Back to list</Link>
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
                  onClick={() => setEditing(true)}
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
              <Card>
                <CardHeader>
                  <CardTitle>Course details</CardTitle>
                  <CardDescription>
                    Editable fields are surfaced via the Edit dialog. Status, franchisee and
                    template stay locked here.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                    <Field label="Template" value={instance.template?.name ?? '-'} />
                    <Field
                      label="Franchisee"
                      value={
                        instance.franchisee ? (
                          <Link
                            to={`/hq/franchisees/${instance.franchisee.id}`}
                            className="text-daisy-primary hover:underline"
                          >
                            #{instance.franchisee.number}, {instance.franchisee.name}
                          </Link>
                        ) : (
                          '-'
                        )
                      }
                    />
                    <Field label="Event date" value={formatLondonDate(instance.event_date)} />
                    <Field
                      label="Time"
                      value={`${formatTime(instance.start_time)} – ${formatTime(instance.end_time)}`}
                    />
                    <Field
                      label="Capacity"
                      value={`${instance.capacity - instance.spots_remaining}/${instance.capacity} sold`}
                    />
                    <Field label="Price" value={formatPence(instance.price_pence)} />
                    <Field label="Visibility" value={instance.visibility} />
                    <Field
                      label="Out of territory"
                      value={
                        instance.out_of_territory
                          ? `Yes${instance.out_of_territory_warning ? ` (${instance.out_of_territory_warning})` : ''}`
                          : 'No'
                      }
                    />
                    {instance.bespoke_details ? (
                      <Field label="Notes" value={instance.bespoke_details} full />
                    ) : null}
                  </dl>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Venue</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                    <Field label="Name" value={instance.venue_name ?? '-'} />
                    <Field label="Postcode" value={instance.venue_postcode} />
                    <Field label="Address" value={instance.venue_address ?? '-'} full />
                    <Field
                      label="Coordinates"
                      value={
                        typeof instance.lat === 'number' && typeof instance.lng === 'number'
                          ? `${instance.lat.toFixed(5)}, ${instance.lng.toFixed(5)}`
                          : '-'
                      }
                    />
                  </dl>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Ticket types</CardTitle>
                  <CardDescription>
                    Read-only here. Franchisees manage ticket types from their own panel.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {instance.ticket_types.length === 0 ? (
                    <p className="text-daisy-muted text-sm">
                      No ticket types defined. Defaults to a single seat per booking.
                    </p>
                  ) : (
                    <ul className="divide-daisy-line-soft divide-y">
                      {instance.ticket_types.map((tt) => (
                        <li
                          key={tt.id}
                          className="flex items-center justify-between gap-3 py-2 text-sm"
                        >
                          <span className="font-semibold">{tt.name}</span>
                          <span className="text-daisy-muted text-[12px]">
                            {tt.seats_consumed} seat{tt.seats_consumed === 1 ? '' : 's'} ·{' '}
                            {tt.max_available != null ? `max ${tt.max_available} · ` : ''}
                            {formatPence(tt.price_pence)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Activity timeline</CardTitle>
                  <CardDescription>Audit log entries scoped to this course.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <ActivityTimeline
                    rows={activity.data?.pages.flatMap((p) => p.rows) ?? []}
                    isLoading={activity.isLoading}
                  />
                </CardContent>
              </Card>
            </div>

            <aside className="flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Bookings</CardTitle>
                  <CardDescription>Bookings linked to this course (any status).</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-daisy-ink text-3xl font-extrabold">
                      {instance.bookings_count}
                    </span>
                    <span className="text-daisy-muted text-xs font-semibold tracking-wide uppercase">
                      total
                    </span>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/hq/bookings?course_instance_id=${instance.id}`}>
                      View bookings →
                    </Link>
                  </Button>
                </CardContent>
              </Card>

              {instance.franchisee ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Franchisee</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="primary">
                        #{instance.franchisee.number.padStart(4, '0')}
                      </Badge>
                      <span className="font-semibold">{instance.franchisee.name}</span>
                    </div>
                    <span className="text-daisy-muted text-[13px]">
                      {instance.franchisee.email}
                    </span>
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/hq/franchisees/${instance.franchisee.id}`}>
                        View franchisee →
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              ) : null}

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
            </aside>
          </div>

          {editing ? (
            <EditInstanceDialog
              instance={instance}
              open={editing}
              onClose={() => setEditing(false)}
            />
          ) : null}
          {cancelling ? (
            <CancelInstanceDialog
              instance={instance}
              open={cancelling}
              onClose={() => setCancelling(false)}
            />
          ) : null}
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
