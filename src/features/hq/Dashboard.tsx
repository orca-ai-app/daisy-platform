import { Link } from 'react-router';
import { CalendarDays, Clock, Coins, Map, Users } from 'lucide-react';
import {
  AttentionList,
  EmptyState,
  PageHeader,
  StatCard,
  type StatDeltaTone,
} from '@/components/daisy';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useRole } from '@/features/auth/RoleContext';
import { formatPence } from '@/lib/format';
import { useAttentionItems, useNetworkStats, useRecentActivity } from './queries';

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/London',
});

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/London',
});

function greetingFor(name: string | null | undefined): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const safe = name?.split(/\s+/)[0] ?? 'there';
  return `Good ${part}, ${safe}`;
}

function formatDelta(
  current: number,
  previous: number,
): {
  label: string;
  tone: StatDeltaTone;
} {
  if (previous === 0 && current === 0) {
    return { label: 'No data yet (seeded in Wave 5)', tone: 'flat' };
  }
  if (previous === 0) {
    return { label: `${current} this month (no prior)`, tone: 'up' };
  }
  const diff = current - previous;
  const pct = Math.round((diff / previous) * 100);
  if (pct === 0) return { label: 'Flat vs last month', tone: 'flat' };
  if (pct > 0) return { label: `+${pct}% vs last month`, tone: 'up' };
  return { label: `${pct}% vs last month`, tone: 'down' };
}

function formatRevenueDelta(
  currentPence: number,
  previousPence: number,
): {
  label: string;
  tone: StatDeltaTone;
} {
  if (currentPence === 0 && previousPence === 0) {
    return { label: 'No revenue logged yet', tone: 'flat' };
  }
  const diff = currentPence - previousPence;
  if (diff === 0) return { label: 'Flat vs last month', tone: 'flat' };
  const sign = diff > 0 ? '+' : '−';
  const formatted = formatPence(Math.abs(diff));
  return {
    label: `${sign}${formatted} vs last month`,
    tone: diff > 0 ? 'up' : 'down',
  };
}

export default function Dashboard() {
  const { franchisee } = useRole();
  const stats = useNetworkStats();
  const attention = useAttentionItems();
  const activity = useRecentActivity(10);

  const today = dateFormatter.format(new Date());

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          <span>
            {greetingFor(franchisee?.name)}
            <span className="font-display text-daisy-muted ml-2 text-[18px] font-semibold">
              , here's your network today
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
            {(() => {
              const delta = formatDelta(
                stats.data?.bookingsMtd ?? 0,
                stats.data?.bookingsLastMonth ?? 0,
              );
              return (
                <StatCard
                  label="Bookings this month"
                  value={(stats.data?.bookingsMtd ?? 0).toLocaleString('en-GB')}
                  delta={delta.label}
                  tone={delta.tone}
                  icon={CalendarDays}
                />
              );
            })()}
            {(() => {
              const delta = formatRevenueDelta(
                stats.data?.revenueMtd ?? 0,
                stats.data?.revenueLastMonth ?? 0,
              );
              // Wave 3B: this card is the entry point to the Reports
              // page (no top-bar nav link to keep the bar uncrowded).
              return (
                <Link
                  to="/hq/reports"
                  aria-label="Open network revenue report"
                  className="hover:shadow-lift focus-visible:ring-daisy-primary rounded-[12px] transition-shadow focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  <StatCard
                    label="Network revenue"
                    value={formatPence(stats.data?.revenueMtd ?? 0)}
                    delta={delta.label}
                    tone={delta.tone}
                    icon={Coins}
                  />
                </Link>
              );
            })()}
            <StatCard
              label="Active franchisees"
              value={
                <span>
                  {stats.data?.activeFranchisees ?? 0}
                  <span className="text-daisy-muted ml-1 text-[18px] font-semibold">
                    / {stats.data?.totalFranchisees ?? 0}
                  </span>
                </span>
              }
              delta={
                stats.data?.vacantTerritories
                  ? `${stats.data.vacantTerritories} territories vacant`
                  : 'All territories covered'
              }
              tone={stats.data?.vacantTerritories ? 'down' : 'up'}
              icon={Users}
            />
            <StatCard
              label="Territory coverage"
              value={`${stats.data?.territoryCoverage ?? 0}%`}
              delta={
                (stats.data?.territoryCoverage ?? 0) >= 80
                  ? 'Healthy coverage'
                  : 'Coverage below 80%'
              }
              tone={(stats.data?.territoryCoverage ?? 0) >= 80 ? 'up' : 'flat'}
              icon={Map}
            />
          </>
        )}
      </section>

      {/* MAIN GRID */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader className="border-daisy-line-soft bg-daisy-primary-tint flex flex-row items-center justify-between gap-4 border-b px-5 py-4">
            <CardTitle className="text-daisy-primary-deep text-[15px] font-extrabold tracking-[0.06em] uppercase">
              Franchisee performance
            </CardTitle>
            <span className="text-daisy-muted text-xs font-semibold">
              Full table lands in Wave 2 (Agent 2B)
            </span>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex flex-col gap-3 p-6">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-5 w-1/2" />
              <p className="text-daisy-muted pt-3 text-sm">
                Sortable table of every franchisee, with number, name, territory count, MTD
                bookings, MTD revenue and fee status. Coming through in this wave from the
                franchisees agent.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="border-daisy-line-soft flex flex-row items-center justify-between gap-4 border-b bg-[#FAF1DF] px-5 py-4">
            <CardTitle className="text-[15px] font-extrabold tracking-[0.06em] text-[#8A5A1A] uppercase">
              Attention needed
            </CardTitle>
            <span className="bg-daisy-amber/20 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold text-[#8A5A1A]">
              {attention.data?.length ?? 0} items
            </span>
          </CardHeader>
          <CardContent className="p-0">
            {attention.isLoading ? (
              <div className="flex flex-col gap-3 p-6">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-5 w-1/2" />
              </div>
            ) : (
              <AttentionList items={attention.data ?? []} />
            )}
          </CardContent>
        </Card>
      </section>

      {/* BOTTOM GRID */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card className="overflow-hidden">
          <CardHeader className="border-daisy-line-soft bg-daisy-primary-tint border-b px-5 py-4">
            <CardTitle className="text-daisy-primary-deep text-[15px] font-extrabold tracking-[0.06em] uppercase">
              Territory map, UK
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex h-[280px] flex-col items-center justify-center gap-2 px-6 text-center">
              <Map aria-hidden className="text-daisy-muted h-8 w-8" />
              <p className="text-daisy-ink text-sm font-semibold">Territory map coming in Wave 3</p>
              <p className="text-daisy-muted text-xs">
                Status-coloured markers (active, quiet, vacant, reserved) on Google Maps.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="border-daisy-line-soft bg-daisy-primary-tint border-b px-5 py-4">
            <CardTitle className="text-daisy-primary-deep text-[15px] font-extrabold tracking-[0.06em] uppercase">
              Network revenue, last 6 months
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex h-[280px] flex-col items-center justify-center gap-2 px-6 text-center">
              <Coins aria-hidden className="text-daisy-muted h-8 w-8" />
              <p className="text-daisy-ink text-sm font-semibold">Revenue chart coming in Wave 3</p>
              <p className="text-daisy-muted text-xs">
                Recharts bar chart of MTD totals across the last six months.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* RECENT ACTIVITY */}
      <Card className="overflow-hidden">
        <CardHeader className="border-daisy-line-soft bg-daisy-primary-tint border-b px-5 py-4">
          <CardTitle className="text-daisy-primary-deep text-[15px] font-extrabold tracking-[0.06em] uppercase">
            Recent activity
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {activity.isLoading ? (
            <div className="flex flex-col gap-2 p-6">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : (activity.data ?? []).length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Clock />}
                title="No activity yet"
                body="When franchisees update bookings or HQ runs billing, the audit trail shows up here."
              />
            </div>
          ) : (
            <ul className="divide-daisy-line-soft divide-y">
              {(activity.data ?? []).map((row) => (
                <li key={row.id} className="flex items-baseline gap-4 px-5 py-3 text-sm">
                  <span className="text-daisy-muted w-36 shrink-0 text-xs font-semibold">
                    {timeFormatter.format(new Date(row.created_at))}
                  </span>
                  <span className="text-daisy-ink flex-1">
                    <span className="font-semibold">{row.action}</span>
                    {row.description ? (
                      <span className="text-daisy-muted"> · {row.description}</span>
                    ) : null}
                  </span>
                  <span className="text-daisy-muted text-xs tracking-wide uppercase">
                    {row.actor_type}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

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
