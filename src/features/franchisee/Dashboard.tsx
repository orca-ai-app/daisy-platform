import { BookOpen, CalendarDays, Coins, Users } from 'lucide-react';
import { EmptyState, PageHeader, StatCard, type StatDeltaTone } from '@/components/daisy';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useRole } from '@/features/auth/RoleContext';
import { formatPence } from '@/lib/format';
import { useFranchiseeDashboard, useRecentBookings, useUpcomingCourses } from './dashboardQueries';
import { MedicalQr } from './components/MedicalQr';

// ---------------------------------------------------------------------------
// Date / time formatters — Europe/London, never toISOString().split('T')[0]
// ---------------------------------------------------------------------------

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/London',
});

const shortDateFormatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/London',
});

const shortTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/London',
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function greetingFor(name: string | null | undefined): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const first = name?.split(/\s+/)[0] ?? 'there';
  return `Good ${part}, ${first}`;
}

function bookingStatusLabel(status: string): string {
  switch (status) {
    case 'confirmed':
      return 'Confirmed';
    case 'attended':
      return 'Attended';
    case 'no_show':
      return 'No show';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

function deltaForCount(count: number, zeroLabel: string): { label: string; tone: StatDeltaTone } {
  if (count === 0) return { label: zeroLabel, tone: 'flat' };
  return { label: `${count} in window`, tone: 'up' };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KpiSkeletons() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="border-daisy-line-soft bg-daisy-paper shadow-card flex flex-col gap-3 rounded-[12px] border px-5 py-[18px]"
        >
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-7 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const { franchisee } = useRole();
  const stats = useFranchiseeDashboard();
  const recentBookings = useRecentBookings(5);
  const upcomingCourses = useUpcomingCourses(7);

  const today = dateFormatter.format(new Date());

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          <span>
            {greetingFor(franchisee?.name)}
            <span className="font-display text-daisy-muted ml-2 text-[18px] font-semibold">
              , here's your business today
            </span>
          </span>
        }
        actions={<span className="text-daisy-muted text-sm font-semibold">{today}</span>}
      />

      {/* KPI ROW */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.isLoading ? (
          <KpiSkeletons />
        ) : (
          <>
            <StatCard
              label="Upcoming courses"
              value={(stats.data?.upcomingCourses ?? 0).toLocaleString('en-GB')}
              delta={
                deltaForCount(stats.data?.upcomingCourses ?? 0, 'No courses in the next 30 days')
                  .label
              }
              tone={deltaForCount(stats.data?.upcomingCourses ?? 0, '').tone}
              icon={CalendarDays}
            />

            <StatCard
              label="Bookings this month"
              value={(stats.data?.bookingsMtd ?? 0).toLocaleString('en-GB')}
              delta={
                (stats.data?.bookingsMtd ?? 0) === 0
                  ? 'No bookings recorded yet'
                  : `${stats.data?.bookingsMtd} this month`
              }
              tone={(stats.data?.bookingsMtd ?? 0) > 0 ? 'up' : 'flat'}
              icon={Users}
            />

            <StatCard
              label="Revenue this month"
              value={formatPence(stats.data?.revenueMtd ?? 0)}
              delta={
                (stats.data?.revenueMtd ?? 0) === 0
                  ? 'No revenue logged yet'
                  : `${formatPence(stats.data?.revenueMtd ?? 0)} MTD`
              }
              tone={(stats.data?.revenueMtd ?? 0) > 0 ? 'up' : 'flat'}
              icon={Coins}
            />

            <StatCard
              label="Outstanding capacity"
              value={(stats.data?.outstandingCapacity ?? 0).toLocaleString('en-GB')}
              delta={
                (stats.data?.outstandingCapacity ?? 0) === 0
                  ? 'All courses full or no courses scheduled'
                  : `${stats.data?.outstandingCapacity} spots available`
              }
              tone={(stats.data?.outstandingCapacity ?? 0) > 0 ? 'up' : 'flat'}
              icon={BookOpen}
            />
          </>
        )}
      </section>

      {/* MAIN GRID */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        {/* Recent bookings */}
        <Card className="overflow-hidden">
          <CardHeader className="border-daisy-line-soft bg-daisy-primary-tint border-b px-5 py-4">
            <CardTitle className="text-daisy-primary-deep text-[15px] font-extrabold tracking-[0.06em] uppercase">
              Recent bookings
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recentBookings.isLoading ? (
              <div className="flex flex-col gap-2 p-6">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : (recentBookings.data ?? []).length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={<Users />}
                  title="No bookings yet"
                  body="Your first booking will appear here once it's confirmed."
                />
              </div>
            ) : (
              <ul className="divide-daisy-line-soft divide-y">
                {(recentBookings.data ?? []).map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3 text-sm"
                  >
                    <span className="text-daisy-muted w-36 shrink-0 text-xs font-semibold">
                      {shortTimeFormatter.format(new Date(row.created_at))}
                    </span>
                    <span className="text-daisy-ink flex-1 font-semibold">{row.customer_name}</span>
                    {row.course_template_name ? (
                      <span className="text-daisy-muted text-xs">{row.course_template_name}</span>
                    ) : null}
                    <span className="text-daisy-muted text-xs">
                      {formatPence(row.total_price_pence)}
                    </span>
                    <span className="text-daisy-muted text-xs tracking-wide uppercase">
                      {bookingStatusLabel(row.booking_status)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Right column: upcoming courses + the permanent medical QR tile */}
        <div className="flex flex-col gap-4">
        <Card className="overflow-hidden">
          <CardHeader className="border-daisy-line-soft bg-daisy-primary-tint border-b px-5 py-4">
            <CardTitle className="text-daisy-primary-deep text-[15px] font-extrabold tracking-[0.06em] uppercase">
              Coming up this week
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {upcomingCourses.isLoading ? (
              <div className="flex flex-col gap-2 p-6">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : (upcomingCourses.data ?? []).length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={<CalendarDays />}
                  title="Nothing scheduled this week"
                  body="When you add courses for the next 7 days they'll show here."
                />
              </div>
            ) : (
              <ul className="divide-daisy-line-soft divide-y">
                {(upcomingCourses.data ?? []).map((course) => (
                  <li
                    key={course.id}
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3 text-sm"
                  >
                    <span className="text-daisy-muted w-36 shrink-0 text-xs font-semibold">
                      {shortDateFormatter.format(new Date(course.event_date))}
                    </span>
                    <span className="text-daisy-ink flex-1 font-semibold">
                      {course.template_name ?? 'Course'}
                    </span>
                    {course.venue_name ? (
                      <span className="text-daisy-muted text-xs">{course.venue_name}</span>
                    ) : null}
                    <span className="text-daisy-muted text-xs">
                      {course.spots_remaining}/{course.spots_total} spaces
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {franchisee?.number ? <MedicalQr franchiseeNumber={franchisee.number} compact /> : null}
        </div>
      </section>
    </div>
  );
}
