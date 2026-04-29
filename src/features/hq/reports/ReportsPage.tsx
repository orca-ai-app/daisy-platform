import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeader, DataTable, EmptyState } from '@/components/daisy';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatPence } from '@/lib/format';
import {
  useNetworkRevenueByMonth,
  usePerFranchiseeRevenue,
  type FranchiseeRevenueRow,
  type RevenuePeriod,
  type MonthRevenuePoint,
} from './queries';

const PERIOD_OPTIONS: ReadonlyArray<{ value: RevenuePeriod; label: string }> = [
  { value: 'last-6-months', label: 'Last 6 months' },
  { value: 'this-year', label: 'This year' },
  { value: 'custom', label: 'Custom range' },
];

const CHART_GRADIENT_ID = 'daisy-revenue-gradient';

/** Format pence as £k for the Y axis label (e.g. 320000 → "£3.2k"). */
function poundsK(pence: number): string {
  if (pence === 0) return '£0';
  const pounds = pence / 100;
  if (pounds < 1000) return `£${pounds.toFixed(0)}`;
  return `£${(pounds / 1000).toFixed(1)}k`;
}

interface ChartTooltipPayload {
  payload: MonthRevenuePoint;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: ChartTooltipPayload[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  return (
    <div className="border-daisy-line-soft bg-daisy-paper shadow-card flex flex-col gap-1 rounded-[10px] border p-3 text-[13px]">
      <span className="text-daisy-muted text-[11px] font-bold tracking-wider uppercase">
        {point.monthFull}
      </span>
      <span className="text-daisy-ink font-extrabold">{formatPence(point.revenuePence)}</span>
      <span className="text-daisy-muted text-[12px]">
        {point.bookingCount} booking{point.bookingCount === 1 ? '' : 's'}
      </span>
    </div>
  );
}

export default function ReportsPage() {
  const [period, setPeriod] = useState<RevenuePeriod>('last-6-months');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const customArgs =
    period === 'custom' ? { fromDate, toDate } : { fromDate: undefined, toDate: undefined };

  const network = useNetworkRevenueByMonth(period, customArgs.fromDate, customArgs.toDate);
  const perFranchisee = usePerFranchiseeRevenue(period, customArgs.fromDate, customArgs.toDate);

  const buckets = network.data?.buckets ?? [];
  const hasData = buckets.some((b) => b.revenuePence > 0);

  const franchiseeColumns = useMemo<ColumnDef<FranchiseeRevenueRow>[]>(
    () => [
      {
        accessorKey: 'number',
        header: 'Number',
        cell: ({ row }) => (
          <span className="text-daisy-ink-soft font-mono text-[13px] font-bold">
            {row.original.number ? `#${row.original.number.padStart(4, '0')}` : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => <span className="font-bold">{row.original.name || '—'}</span>,
      },
      {
        accessorKey: 'bookingCount',
        header: 'Bookings',
        cell: ({ row }) => <span className="font-semibold">{row.original.bookingCount}</span>,
      },
      {
        accessorKey: 'revenuePence',
        header: 'Revenue',
        cell: ({ row }) => (
          <span className="font-semibold">{formatPence(row.original.revenuePence)}</span>
        ),
      },
      {
        accessorKey: 'pctOfNetwork',
        header: '% of network',
        cell: ({ row }) => (
          <span className="text-daisy-muted text-[13px] font-semibold">
            {row.original.pctOfNetwork}%
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Network revenue"
        subtitle="Gross booking revenue across the network. HQ fee splits land in Wave 4."
        actions={
          network.data?.totalPence ? (
            <Badge variant="primary">{formatPence(network.data.totalPence)} total</Badge>
          ) : null
        }
      />

      {/* Period selector */}
      <div className="flex flex-wrap items-end gap-3">
        <Select value={period} onValueChange={(v) => setPeriod(v as RevenuePeriod)}>
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
        {period === 'custom' ? (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-daisy-muted text-[10px] font-bold tracking-wider uppercase">
                From
              </label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-10 w-[150px]"
                aria-label="From date"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-daisy-muted text-[10px] font-bold tracking-wider uppercase">
                To
              </label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="h-10 w-[150px]"
                aria-label="To date"
              />
            </div>
          </>
        ) : null}
      </div>

      {/* Chart */}
      <Card className="overflow-hidden">
        <CardHeader className="border-daisy-line-soft bg-daisy-primary-tint border-b px-5 py-4">
          <CardTitle className="text-daisy-primary-deep text-[15px] font-extrabold tracking-[0.06em] uppercase">
            Revenue by month
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5">
          {network.isLoading ? (
            <Skeleton className="h-[320px] w-full" />
          ) : network.error ? (
            <div className="rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
              Could not load revenue: {network.error.message}
            </div>
          ) : !hasData ? (
            <EmptyState
              title="No revenue in this period"
              body="Once franchisees take paid bookings the chart will populate."
            />
          ) : (
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={buckets} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
                  <defs>
                    <linearGradient id={CHART_GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#006FAC" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="#3AC1EA" stopOpacity={0.65} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 6" stroke="#E8F0F5" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: '#5A7A8F', fontSize: 12, fontWeight: 600 }}
                    tickLine={false}
                    axisLine={{ stroke: '#D4E1E9' }}
                  />
                  <YAxis
                    tickFormatter={poundsK}
                    tick={{ fill: '#5A7A8F', fontSize: 12, fontWeight: 600 }}
                    tickLine={false}
                    axisLine={{ stroke: '#D4E1E9' }}
                    width={56}
                  />
                  <Tooltip cursor={{ fill: '#EDF5FA', opacity: 0.6 }} content={<ChartTooltip />} />
                  <Bar
                    dataKey="revenuePence"
                    fill={`url(#${CHART_GRADIENT_ID})`}
                    radius={[8, 8, 0, 0]}
                    maxBarSize={64}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-franchisee table */}
      <Card className="overflow-hidden">
        <CardHeader className="border-daisy-line-soft bg-daisy-primary-tint border-b px-5 py-4">
          <CardTitle className="text-daisy-primary-deep text-[15px] font-extrabold tracking-[0.06em] uppercase">
            Revenue by franchisee
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5">
          <DataTable<FranchiseeRevenueRow>
            columns={franchiseeColumns}
            data={perFranchisee.data?.rows ?? []}
            isLoading={perFranchisee.isLoading}
            searchable={false}
            emptyState={
              <EmptyState
                title="No franchisee revenue yet"
                body="Bookings broken down by franchisee will appear here."
              />
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
