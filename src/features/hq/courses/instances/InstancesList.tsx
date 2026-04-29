import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { formatInTimeZone } from 'date-fns-tz';
import { PageHeader, DataTable, StatusPill, EmptyState } from '@/components/daisy';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatPence } from '@/lib/format';
import {
  useCourseInstances,
  useFranchiseeOptions,
  courseInstanceStatusVariant,
  type CourseInstanceListRow,
  type CourseInstancesFilters,
  type CourseInstanceStatus,
  type DateRangePreset,
} from './queries';

const STATUS_OPTIONS: ReadonlyArray<{ value: CourseInstanceStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const DATE_OPTIONS: ReadonlyArray<{ value: DateRangePreset; label: string }> = [
  { value: 'all', label: 'All dates' },
  { value: 'next-30-days', label: 'Next 30 days' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'past', label: 'Past only' },
  { value: 'custom', label: 'Custom range' },
];

function formatLondonDate(d: string | null): string {
  if (!d) return '—';
  try {
    return formatInTimeZone(new Date(`${d}T00:00:00Z`), 'Europe/London', 'd MMM yyyy');
  } catch {
    return d;
  }
}

function formatTime(t: string | null): string {
  if (!t) return '';
  return t.slice(0, 5);
}

export default function InstancesList() {
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CourseInstanceStatus | 'all'>('all');
  const [franchiseeId, setFranchiseeId] = useState<string | 'all'>('all');
  const [dateRange, setDateRange] = useState<DateRangePreset>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const filters: CourseInstancesFilters = {
    search,
    status,
    franchiseeId,
    dateRange,
    fromDate: dateRange === 'custom' ? fromDate || undefined : undefined,
    toDate: dateRange === 'custom' ? toDate || undefined : undefined,
  };

  const { rows, totalCount, isLoading, error } = useCourseInstances(filters);
  const franchiseeOptions = useFranchiseeOptions();

  const columns = useMemo<ColumnDef<CourseInstanceListRow>[]>(
    () => [
      {
        id: 'date',
        header: 'Date & time',
        accessorFn: (row) => `${row.event_date} ${row.start_time}`,
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="font-semibold">{formatLondonDate(row.original.event_date)}</span>
            <span className="text-daisy-muted text-[12px]">
              {formatTime(row.original.start_time)} – {formatTime(row.original.end_time)}
            </span>
          </span>
        ),
      },
      {
        id: 'template',
        header: 'Course',
        accessorFn: (row) => row.template_name,
        cell: ({ row }) => (
          <span className="text-daisy-ink font-semibold">{row.original.template_name}</span>
        ),
      },
      {
        id: 'franchisee',
        header: 'Franchisee',
        accessorFn: (row) => `${row.franchisee_number} ${row.franchisee_name}`,
        cell: ({ row }) =>
          row.original.franchisee_id ? (
            <Link
              to={`/hq/franchisees/${row.original.franchisee_id}`}
              onClick={(e) => e.stopPropagation()}
              className="hover:text-daisy-primary flex flex-col"
            >
              <span className="text-daisy-ink-soft font-mono text-[12px] font-bold">
                {row.original.franchisee_number || '—'}
              </span>
              <span className="text-daisy-muted text-[12px]">{row.original.franchisee_name}</span>
            </Link>
          ) : (
            <span className="text-daisy-muted text-[12px]">—</span>
          ),
      },
      {
        id: 'venue',
        header: 'Venue',
        accessorFn: (row) => `${row.venue_name ?? ''} ${row.venue_postcode}`,
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="font-semibold">{row.original.venue_name ?? '—'}</span>
            <span className="text-daisy-muted font-mono text-[12px]">
              {row.original.venue_postcode}
            </span>
          </span>
        ),
      },
      {
        id: 'capacity',
        header: 'Capacity',
        accessorFn: (row) => row.capacity - row.spots_remaining,
        cell: ({ row }) => {
          const used = row.original.capacity - row.original.spots_remaining;
          return (
            <span className="text-daisy-ink-soft font-mono text-[13px] font-semibold">
              {used}/{row.original.capacity}
            </span>
          );
        },
      },
      {
        accessorKey: 'price_pence',
        header: 'Price',
        cell: ({ row }) => (
          <span className="font-semibold">{formatPence(row.original.price_pence)}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <StatusPill variant={courseInstanceStatusVariant(row.original.status)}>
            {row.original.status}
          </StatusPill>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Course instances"
        subtitle="Every scheduled course across the network. HQ can edit or cancel from the detail page."
        actions={
          <>
            <Badge variant="primary">{totalCount} total</Badge>
            <Button asChild variant="outline" size="sm">
              <Link to="/hq/courses/templates">View templates</Link>
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search venue or postcode…"
          className="h-10 max-w-sm flex-1 rounded-full"
          aria-label="Search course instances"
        />
        <Select value={status} onValueChange={(v) => setStatus(v as CourseInstanceStatus | 'all')}>
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={franchiseeId} onValueChange={(v) => setFranchiseeId(v)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All franchisees" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All franchisees</SelectItem>
            {(franchiseeOptions.data ?? []).map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.number} — {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRangePreset)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {dateRange === 'custom' ? (
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

      {error ? (
        <div className="rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
          Could not load course instances: {error.message}
        </div>
      ) : null}

      <DataTable<CourseInstanceListRow>
        columns={columns}
        data={rows}
        isLoading={isLoading}
        searchable={false}
        onRowClick={(row) => navigate(`/hq/courses/instances/${row.id}`)}
        emptyState={
          <EmptyState
            title="No courses match these filters"
            body="Try widening the date range, clearing the status filter, or picking a different franchisee."
          />
        }
      />
    </div>
  );
}
