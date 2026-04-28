import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { formatInTimeZone } from 'date-fns-tz';
import { PageHeader, DataTable, StatusPill, EmptyState } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatPence } from '@/lib/format';
import {
  useFranchisee,
  useFranchiseeActivity,
  useFranchiseeBookings,
  useFranchiseeTerritories,
} from './queries';
import type { ActivityRow, FranchiseeBookingRow, Territory } from '@/types/franchisee';

function formatLondonDateTime(iso: string): string {
  try {
    return formatInTimeZone(new Date(iso), 'Europe/London', 'd MMM yyyy, HH:mm');
  } catch {
    return iso;
  }
}

function formatLondonDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return formatInTimeZone(new Date(iso), 'Europe/London', 'd MMM yyyy');
  } catch {
    return iso;
  }
}

export default function FranchiseeDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: franchisee, isLoading, error } = useFranchisee(id);
  const { data: territories = [], isLoading: territoriesLoading } = useFranchiseeTerritories(id);
  const { data: bookings = [], isLoading: bookingsLoading } = useFranchiseeBookings(id);
  const { data: activity = [], isLoading: activityLoading } = useFranchiseeActivity(id);

  const bookingColumns = useMemo<ColumnDef<FranchiseeBookingRow>[]>(
    () => [
      {
        accessorKey: 'booking_reference',
        header: 'Reference',
        cell: ({ row }) => (
          <span className="text-daisy-ink-soft font-mono text-[13px] font-bold">
            {row.original.booking_reference}
          </span>
        ),
      },
      {
        accessorKey: 'customer_name',
        header: 'Customer',
      },
      {
        id: 'course',
        header: 'Course',
        accessorFn: (row) => `${row.course_template_name ?? '—'} ${row.course_event_date ?? ''}`,
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="font-semibold">{row.original.course_template_name ?? '—'}</span>
            <span className="text-daisy-muted text-[12px]">
              {formatLondonDate(row.original.course_event_date)}
            </span>
          </span>
        ),
      },
      {
        accessorKey: 'total_price_pence',
        header: 'Total',
        cell: ({ row }) => (
          <span className="font-semibold">{formatPence(row.original.total_price_pence)}</span>
        ),
      },
      {
        accessorKey: 'payment_status',
        header: 'Payment',
        cell: ({ row }) => {
          // 'refunded' isn't on the StatusPill variant set — map it
          // onto 'manual' (the closest neutral-blue look).
          const v = row.original.payment_status;
          const variant = v === 'refunded' ? 'manual' : v;
          return <StatusPill variant={variant}>{v}</StatusPill>;
        },
      },
      {
        accessorKey: 'booking_status',
        header: 'Booking',
        cell: ({ row }) => {
          // Map db statuses onto pill variants — confirmed/attended → active,
          // cancelled → terminated, no_show → failed.
          const v = row.original.booking_status;
          const variant = v === 'cancelled' ? 'terminated' : v === 'no_show' ? 'failed' : 'active';
          return <StatusPill variant={variant}>{v.replace('_', ' ')}</StatusPill>;
        },
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6">
        <Link
          to="/hq/franchisees"
          className="text-daisy-primary mb-3 inline-flex items-center gap-1 text-sm font-semibold hover:underline"
        >
          ← Back to franchisees
        </Link>

        {error ? (
          <div className="my-4 rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
            Could not load franchisee: {error.message}
          </div>
        ) : null}

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-72" />
            <Skeleton className="h-4 w-96" />
          </div>
        ) : !franchisee ? (
          <EmptyState
            title="Franchisee not found"
            body="This franchisee may have been removed or the link is incorrect."
            action={
              <Button asChild variant="outline">
                <Link to="/hq/franchisees">Back to list</Link>
              </Button>
            }
          />
        ) : (
          <>
            <PageHeader
              title={franchisee.name}
              subtitle={`Franchisee · ${franchisee.email}`}
              actions={
                <>
                  <Badge variant="primary">#{franchisee.number.padStart(4, '0')}</Badge>
                  <StatusPill variant={franchisee.status}>{franchisee.status}</StatusPill>
                </>
              }
            />

            <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
              <Tabs defaultValue="profile" className="w-full">
                <TabsList>
                  <TabsTrigger value="profile">Profile</TabsTrigger>
                  <TabsTrigger value="territories">
                    Territories ({franchisee.territory_count})
                  </TabsTrigger>
                  <TabsTrigger value="bookings">
                    Bookings ({franchisee.recent_bookings_count})
                  </TabsTrigger>
                  <TabsTrigger value="activity">Activity</TabsTrigger>
                </TabsList>

                <TabsContent value="profile">
                  <ProfileCard franchisee={franchisee} />
                </TabsContent>

                <TabsContent value="territories">
                  <TerritoriesList territories={territories} isLoading={territoriesLoading} />
                </TabsContent>

                <TabsContent value="bookings">
                  <DataTable<FranchiseeBookingRow>
                    columns={bookingColumns}
                    data={bookings}
                    isLoading={bookingsLoading}
                    searchable={false}
                    pageSize={10}
                    emptyState={
                      <EmptyState
                        title="No bookings yet"
                        body="Bookings for this franchisee will appear here."
                      />
                    }
                  />
                </TabsContent>

                <TabsContent value="activity">
                  <ActivityTimeline activity={activity} isLoading={activityLoading} />
                </TabsContent>
              </Tabs>

              <aside className="flex flex-col gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Stripe Connect</CardTitle>
                    <CardDescription>
                      Wired in Wave 8 (M2). The flag below reflects the stored DB state only.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <StatusPill
                      variant={franchisee.stripe_connected ? 'connected' : 'not-connected'}
                    >
                      {franchisee.stripe_connected ? 'Connected' : 'Not connected'}
                    </StatusPill>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Billing status</CardTitle>
                    <CardDescription>
                      Live billing-run status arrives in Phase 2 (Wave 5).
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <StatusPill variant="pending">Pending wiring</StatusPill>
                  </CardContent>
                </Card>
              </aside>
            </div>
          </>
        )}
    </div>
  );
}

interface ProfileCardProps {
  franchisee: NonNullable<ReturnType<typeof useFranchisee>['data']>;
}

function ProfileCard({ franchisee }: ProfileCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Read-only in Wave 2; editing ships in Wave 4.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <Field label="Number" value={`#${franchisee.number.padStart(4, '0')}`} />
          <Field label="Name" value={franchisee.name} />
          <Field label="Email" value={franchisee.email} />
          <Field label="Phone" value={franchisee.phone ?? '—'} />
          <Field label="Fee tier" value={`£${franchisee.fee_tier} / month`} />
          <Field label="Billing date" value={`${franchisee.billing_date} of each month`} />
          <Field label="VAT registered" value={franchisee.vat_registered ? 'Yes' : 'No'} />
          <Field
            label="Status"
            value={<StatusPill variant={franchisee.status}>{franchisee.status}</StatusPill>}
          />
          <Field label="HQ admin" value={franchisee.is_hq ? 'Yes' : 'No'} />
          <Field label="Notes" value={franchisee.notes ? franchisee.notes : '—'} full />
        </dl>
      </CardContent>
    </Card>
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

function TerritoriesList({
  territories,
  isLoading,
}: {
  territories: Territory[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (territories.length === 0) {
    return (
      <EmptyState
        title="No territories assigned"
        body="Once territories are linked to this franchisee they'll appear here."
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-daisy-line divide-y divide-dashed">
          {territories.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
              <div className="flex flex-col">
                <span className="text-daisy-ink-soft text-[13px] font-bold tracking-wider uppercase">
                  {t.postcode_prefix}
                </span>
                <span className="text-daisy-ink text-sm">{t.name}</span>
              </div>
              <StatusPill variant={t.status}>{t.status}</StatusPill>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
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
      <div className="space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (activity.length === 0) {
    return (
      <EmptyState
        title="No activity yet"
        body="Audit log entries for this franchisee will appear here."
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
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
      </CardContent>
    </Card>
  );
}
