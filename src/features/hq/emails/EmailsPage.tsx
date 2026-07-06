import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Clock, Images, Mail, MailOpen, Percent } from 'lucide-react';
import { DataTable, EmptyState, PageHeader, StatCard } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useEmailDeliveryIssues,
  useEmailStats,
  useEmailTemplates,
  type EmailStatsPeriod,
  type EmailTemplate,
  type TemplateEmailStats,
} from './queries';

const PERIOD_OPTIONS: ReadonlyArray<{ value: EmailStatsPeriod; label: string }> = [
  { value: 'last-30-days', label: 'Last 30 days' },
  { value: 'last-90-days', label: 'Last 90 days' },
  { value: 'last-365-days', label: 'Last 365 days' },
  { value: 'all-time', label: 'All time' },
];

const NO_STATS: TemplateEmailStats = { sent: 0, opened: 0, openRatePct: null };

interface TemplateRow extends EmailTemplate {
  stats: TemplateEmailStats;
}

interface ChartPoint {
  label: string;
  sent: number;
  opened: number;
}

const LAST_EDITED = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

interface ChartTooltipPayload {
  payload: ChartPoint;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: ChartTooltipPayload[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  return (
    <div className="border-daisy-line-soft bg-daisy-paper shadow-card flex flex-col gap-1.5 rounded-[10px] border p-3 text-[13px]">
      <span className="text-daisy-muted text-[11px] font-bold tracking-wider uppercase">
        {point.label}
      </span>
      <span className="flex items-center gap-2">
        <span className="bg-daisy-primary inline-block h-2 w-2 rounded-full" />
        <span className="text-daisy-ink font-extrabold">{point.sent}</span>
        <span className="text-daisy-muted text-[12px]">sent</span>
      </span>
      <span className="flex items-center gap-2">
        <span className="bg-daisy-cyan inline-block h-2 w-2 rounded-full" />
        <span className="text-daisy-ink font-extrabold">{point.opened}</span>
        <span className="text-daisy-muted text-[12px]">opened</span>
      </span>
    </div>
  );
}

export default function EmailsPage() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<EmailStatsPeriod>('last-30-days');

  const templates = useEmailTemplates();
  const stats = useEmailStats(period);
  const issues = useEmailDeliveryIssues(period);

  const rows = useMemo<TemplateRow[]>(
    () =>
      (templates.data ?? []).map((t) => ({
        ...t,
        stats: stats.data?.byTemplate[t.template_key] ?? NO_STATS,
      })),
    [templates.data, stats.data],
  );

  const chartData = useMemo<ChartPoint[]>(
    () =>
      rows.map((r) => ({
        label: `${r.sort_order}. ${r.name}`,
        sent: r.stats.sent,
        opened: r.stats.opened,
      })),
    [rows],
  );
  const hasChartData = chartData.some((p) => p.sent > 0 || p.opened > 0);
  const issueCount = (issues.data?.bounced ?? 0) + (issues.data?.spamComplaints ?? 0);

  const columns = useMemo<ColumnDef<TemplateRow>[]>(
    () => [
      {
        accessorKey: 'sort_order',
        header: '#',
        cell: ({ row }) => (
          <span className="text-daisy-ink-soft font-mono text-[13px] font-bold">
            {row.original.sort_order}
          </span>
        ),
      },
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => <span className="font-bold">{row.original.name}</span>,
      },
      {
        accessorKey: 'subject',
        header: 'Subject',
        cell: ({ row }) => (
          <span className="text-daisy-ink-soft block max-w-[280px] truncate text-[13px]">
            {row.original.subject}
          </span>
        ),
      },
      {
        accessorKey: 'delay_label',
        header: 'Delay',
        cell: ({ row }) => (
          <span className="text-daisy-muted text-[13px] font-semibold">
            {row.original.delay_label ?? '-'}
          </span>
        ),
      },
      {
        accessorKey: 'updated_at',
        header: 'Last edited',
        cell: ({ row }) => (
          <span className="text-daisy-muted text-[13px]">
            {LAST_EDITED.format(new Date(row.original.updated_at))}
          </span>
        ),
      },
      {
        id: 'sent',
        accessorFn: (row) => row.stats.sent,
        header: 'Sent',
        cell: ({ row }) => <span className="font-semibold">{row.original.stats.sent}</span>,
      },
      {
        id: 'opened',
        accessorFn: (row) => row.stats.opened,
        header: 'Opened',
        cell: ({ row }) => <span className="font-semibold">{row.original.stats.opened}</span>,
      },
      {
        id: 'openRate',
        accessorFn: (row) => row.stats.openRatePct ?? -1,
        header: 'Open rate',
        cell: ({ row }) => (
          <span className="text-daisy-muted text-[13px] font-semibold">
            {row.original.stats.openRatePct !== null ? `${row.original.stats.openRatePct}%` : '-'}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Booking journey emails"
        subtitle="These emails send automatically after a paid booking, timed from the class date. Delays are fixed; content is editable."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/hq/emails/media">
              <Images className="h-4 w-4" />
              Media library
            </Link>
          </Button>
        }
      />

      {/* Period selector */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={period} onValueChange={(v) => setPeriod(v as EmailStatsPeriod)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-daisy-muted text-xs font-semibold">
          Stats are filtered by send date. Queued counts every pending send.
        </span>
      </div>

      {/* Journey totals */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Total sent"
          value={stats.isLoading ? '…' : (stats.data?.totalSent ?? 0)}
          icon={Mail}
        />
        <StatCard
          label="Total opened"
          value={stats.isLoading ? '…' : (stats.data?.totalOpened ?? 0)}
          icon={MailOpen}
        />
        <StatCard
          label="Open rate"
          value={
            stats.isLoading
              ? '…'
              : stats.data?.openRatePct !== null && stats.data?.openRatePct !== undefined
                ? `${stats.data.openRatePct}%`
                : '-'
          }
          icon={Percent}
        />
        <StatCard
          label="Queued"
          value={stats.isLoading ? '…' : (stats.data?.totalPending ?? 0)}
          delta="Scheduled and waiting to send"
          tone="flat"
          icon={Clock}
        />
      </div>

      {/* Sent vs opened per template */}
      <Card className="overflow-hidden">
        <CardHeader className="border-daisy-line-soft bg-daisy-primary-tint border-b px-5 py-4">
          <CardTitle className="text-daisy-primary-deep text-[15px] font-extrabold tracking-[0.06em] uppercase">
            Sent vs opened by email
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5">
          {templates.isLoading || stats.isLoading ? (
            <Skeleton className="h-[360px] w-full" />
          ) : stats.error ? (
            <div className="rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
              Could not load email stats: {stats.error.message}
            </div>
          ) : !hasChartData ? (
            <EmptyState
              title="No sends in this period"
              body="Once the journey starts sending, per-email sent and opened counts will appear here."
            />
          ) : (
            <div className="h-[400px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 10, right: 16, left: 0, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 6" stroke="#E8F0F5" horizontal={false} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fill: '#5A7A8F', fontSize: 12, fontWeight: 600 }}
                    tickLine={false}
                    axisLine={{ stroke: '#D4E1E9' }}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={220}
                    tick={{ fill: '#5A7A8F', fontSize: 12, fontWeight: 600 }}
                    tickLine={false}
                    axisLine={{ stroke: '#D4E1E9' }}
                  />
                  <Tooltip cursor={{ fill: '#EDF5FA', opacity: 0.6 }} content={<ChartTooltip />} />
                  <Bar
                    dataKey="sent"
                    name="Sent"
                    fill="#006FAC"
                    radius={[0, 6, 6, 0]}
                    maxBarSize={14}
                  />
                  <Bar
                    dataKey="opened"
                    name="Opened"
                    fill="#3AC1EA"
                    radius={[0, 6, 6, 0]}
                    maxBarSize={14}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {issueCount > 0 ? (
            <p className="mt-3 text-[13px] font-semibold text-[#8A2A2A]">
              {issues.data?.bounced ?? 0} bounce{(issues.data?.bounced ?? 0) === 1 ? '' : 's'} and{' '}
              {issues.data?.spamComplaints ?? 0} spam complaint
              {(issues.data?.spamComplaints ?? 0) === 1 ? '' : 's'} in this period.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Template list */}
      <Card className="overflow-hidden">
        <CardHeader className="border-daisy-line-soft bg-daisy-primary-tint border-b px-5 py-4">
          <CardTitle className="text-daisy-primary-deep text-[15px] font-extrabold tracking-[0.06em] uppercase">
            The journey
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5">
          {templates.isError ? (
            <p className="text-daisy-orange text-sm">
              Failed to load templates: {templates.error.message}
            </p>
          ) : (
            <DataTable<TemplateRow>
              columns={columns}
              data={rows}
              isLoading={templates.isLoading}
              searchable={false}
              onRowClick={(row) => void navigate(`/hq/emails/${row.template_key}`)}
              emptyState={
                <EmptyState
                  icon={<Mail />}
                  title="No email templates yet"
                  body="The journey templates haven't been loaded into da_email_templates. Contact support if this looks wrong."
                />
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
