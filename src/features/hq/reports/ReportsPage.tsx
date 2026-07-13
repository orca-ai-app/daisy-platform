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
  useMerchandiseSales,
  type FranchiseeRevenueRow,
  type FranchiseeMerchandiseRow,
  type RevenuePeriod,
  type MonthRevenuePoint,
} from './queries';

const PERIOD_OPTIONS: ReadonlyArray<{ value: RevenuePeriod; label: string }> = [
  { value: 'last-6-months', label: 'Last 6 months' },
  { value: 'last-12-months', label: 'Last 12 months' },
  { value: 'this-year', label: 'This year' },
  { value: 'custom', label: 'Custom range' },
];

const CHART_GRADIENT_ID = 'daisy-revenue-gradient';
const CHART_GRADIENT_PREV_ID = 'daisy-revenue-gradient-prev';

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
  const hasPrev = point.revenuePencePrev !== undefined;
  return (
    <div className="border-daisy-line-soft bg-daisy-paper shadow-card flex flex-col gap-1.5 rounded-[10px] border p-3 text-[13px]">
      <span className="text-daisy-muted text-[11px] font-bold tracking-wider uppercase">
        {point.monthFull}
      </span>
      <span className="flex items-center gap-2">
        <span className="bg-daisy-primary inline-block h-2 w-2 rounded-full" />
        <span className="text-daisy-ink font-extrabold">{formatPence(point.revenuePence)}</span>
        <span className="text-daisy-muted text-[12px]">
          ({point.bookingCount} booking{point.bookingCount === 1 ? '' : 's'})
        </span>
      </span>
      {hasPrev ? (
        <span className="flex items-center gap-2">
          <span className="bg-daisy-cyan inline-block h-2 w-2 rounded-full" />
          <span className="text-daisy-ink-soft font-semibold">
            {formatPence(point.revenuePencePrev ?? 0)}
          </span>
          <span className="text-daisy-muted text-[12px]">
            ({point.bookingCountPrev ?? 0} in {point.monthFullPrev})
          </span>
        </span>
      ) : null}
    </div>
  );
}

export default function ReportsPage() {
  const [period, setPeriod] = useState<RevenuePeriod>('last-6-months');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [compare, setCompare] = useState(false);

  const customArgs =
    period === 'custom' ? { fromDate, toDate } : { fromDate: undefined, toDate: undefined };

  const network = useNetworkRevenueByMonth(period, customArgs.fromDate, customArgs.toDate, compare);
  const perFranchisee = usePerFranchiseeRevenue(period, customArgs.fromDate, customArgs.toDate);
  const merchandise = useMerchandiseSales(period, customArgs.fromDate, customArgs.toDate);

  const buckets = network.data?.buckets ?? [];
  const hasData = buckets.some((b) => b.revenuePence > 0 || (b.revenuePencePrev ?? 0) > 0);

  const franchiseeColumns = useMemo<ColumnDef<FranchiseeRevenueRow>[]>(
    () => [
      {
        accessorKey: 'number',
        header: 'Number',
        cell: ({ row }) => (
          <span className="text-daisy-ink-soft font-mono text-[13px] font-bold">
            {row.original.number ? `#${row.original.number.padStart(4, '0')}` : '-'}
          </span>
        ),
      },
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => <span className="font-bold">{row.original.name || '-'}</span>,
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

  const merchandiseColumns = useMemo<ColumnDef<FranchiseeMerchandiseRow>[]>(
    () => [
      {
        accessorKey: 'number',
        header: 'Number',
        cell: ({ row }) => (
          <span className="text-daisy-ink-soft font-mono text-[13px] font-bold">
            {row.original.number ? `#${row.original.number.padStart(4, '0')}` : '-'}
          </span>
        ),
      },
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => <span className="font-bold">{row.original.name || '-'}</span>,
      },
      {
        accessorKey: 'units',
        header: 'Units',
        cell: ({ row }) => <span className="font-semibold">{row.original.units}</span>,
      },
      {
        accessorKey: 'revenuePence',
        header: 'Revenue',
        cell: ({ row }) => (
          <span className="font-semibold">{formatPence(row.original.revenuePence)}</span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Network revenue"
        subtitle="Gross booking revenue across the network. HQ fee splits live on the Billing page."
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
        <label className="border-daisy-line bg-daisy-paper hover:bg-daisy-primary-tint inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-semibold transition-colors">
          <input
            type="checkbox"
            checked={compare}
            onChange={(e) => setCompare(e.target.checked)}
            className="text-daisy-primary focus:ring-daisy-primary h-4 w-4 cursor-pointer rounded border-gray-300"
            aria-label="Compare with previous year"
          />
          Compare with previous year
        </label>
        {compare && network.data?.deltaPence !== undefined ? (
          <Badge
            variant={network.data.deltaPence >= 0 ? 'primary' : 'default'}
            className={network.data.deltaPence >= 0 ? '' : 'bg-[#FDEAE5] text-[#8A2A2A]'}
          >
            {network.data.deltaPence >= 0 ? '+' : '−'}
            {formatPence(Math.abs(network.data.deltaPence))} YoY ({network.data.deltaPct ?? 0}%)
          </Badge>
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
                    <linearGradient id={CHART_GRADIENT_PREV_ID} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3AC1EA" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="#D4E8F5" stopOpacity={0.55} />
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
                  {compare ? (
                    <Bar
                      dataKey="revenuePencePrev"
                      name="Previous year"
                      fill={`url(#${CHART_GRADIENT_PREV_ID})`}
                      radius={[6, 6, 0, 0]}
                      maxBarSize={32}
                    />
                  ) : null}
                  <Bar
                    dataKey="revenuePence"
                    name="Current"
                    fill={`url(#${CHART_GRADIENT_ID})`}
                    radius={[8, 8, 0, 0]}
                    maxBarSize={compare ? 32 : 64}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-franchisee table */}
      <Card className="overflow-hidden">
        <CardHeader className="border-daisy-line-soft bg-daisy-primary-tint flex flex-row items-center justify-between gap-2 border-b px-5 py-4">
          <CardTitle className="text-daisy-primary-deep text-[15px] font-extrabold tracking-[0.06em] uppercase">
            Revenue by franchisee
          </CardTitle>
          <Badge variant="primary">
            {perFranchisee.data?.rows.length ?? 0} franchisee
            {(perFranchisee.data?.rows.length ?? 0) === 1 ? '' : 's'}
          </Badge>
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

      {/* Merchandise (da_product_sales) — separate from booking revenue */}
      <Card className="overflow-hidden">
        <CardHeader className="border-daisy-line-soft bg-daisy-primary-tint flex flex-row items-center justify-between gap-2 border-b px-5 py-4">
          <CardTitle className="text-daisy-primary-deep text-[15px] font-extrabold tracking-[0.06em] uppercase">
            Merchandise
          </CardTitle>
          <Badge variant="primary">
            {merchandise.data?.totalUnits ?? 0} unit
            {(merchandise.data?.totalUnits ?? 0) === 1 ? '' : 's'} ·{' '}
            {formatPence(merchandise.data?.totalPence ?? 0)}
          </Badge>
        </CardHeader>
        <CardContent className="p-5">
          {merchandise.isError ? (
            <div className="rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
              Could not load merchandise sales: {merchandise.error.message}
            </div>
          ) : (
            <DataTable<FranchiseeMerchandiseRow>
              columns={merchandiseColumns}
              data={merchandise.data?.rows ?? []}
              isLoading={merchandise.isLoading}
              searchable={false}
              emptyState={
                <EmptyState
                  title="No merchandise sales in this period"
                  body="Book sales recorded by franchisees will appear here."
                />
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
