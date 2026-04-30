import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { formatInTimeZone } from 'date-fns-tz';
import { PageHeader, DataTable, StatusPill, EmptyState } from '@/components/daisy';
import { Badge } from '@/components/ui/badge';
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
  useBookings,
  type BookingListRow,
  type BookingsListFilters,
  type DateRangeFilter,
} from './queries';
import type { BookingStatus, PaymentStatus } from '@/types/franchisee';
import type { StatusVariant } from '@/components/daisy/StatusPill';

const PAYMENT_OPTIONS: ReadonlyArray<{ value: PaymentStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All payments' },
  { value: 'pending', label: 'Pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'failed', label: 'Failed' },
  { value: 'manual', label: 'Manual' },
];

const BOOKING_OPTIONS: ReadonlyArray<{ value: BookingStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'attended', label: 'Attended' },
  { value: 'no_show', label: 'No show' },
  { value: 'cancelled', label: 'Cancelled' },
];

const DATE_OPTIONS: ReadonlyArray<{ value: DateRangeFilter; label: string }> = [
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'last-30-days', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
];

/**
 * Map booking_status to StatusPill variants. Decision recorded in the
 * Wave 3B PR description: rather than extend StatusPill (which is a
 * shared component owned by Wave 1), we pin booking_status onto the
 * existing variant set so the colour treatment stays consistent across
 * pills:
 *   confirmed → active   (green — healthy)
 *   attended  → paid     (green — closed-out happy path)
 *   no_show   → failed   (red — bad outcome)
 *   cancelled → terminated (red — terminal, like a terminated franchisee)
 */
function bookingStatusVariant(s: BookingStatus): StatusVariant {
  if (s === 'cancelled') return 'terminated';
  if (s === 'no_show') return 'failed';
  if (s === 'attended') return 'paid';
  return 'active';
}

/**
 * Map payment_status. Almost all map 1:1 against StatusPill variants;
 * `refunded` doesn't have a dedicated variant so we map it onto
 * `manual` (the neutral pink — same convention used in
 * FranchiseeDetail's bookings tab).
 */
function paymentStatusVariant(p: PaymentStatus): StatusVariant {
  return p === 'refunded' ? 'manual' : p;
}

function formatLondonDate(iso: string | null): string {
  if (!iso) return '-';
  try {
    return formatInTimeZone(new Date(iso), 'Europe/London', 'd MMM yyyy');
  } catch {
    return iso;
  }
}

export default function BookingsList() {
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | 'all'>('all');
  const [bookingStatus, setBookingStatus] = useState<BookingStatus | 'all'>('all');
  const [dateRange, setDateRange] = useState<DateRangeFilter>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const filters: BookingsListFilters = {
    search,
    paymentStatus,
    bookingStatus,
    dateRange,
    fromDate: dateRange === 'custom' ? fromDate || undefined : undefined,
    toDate: dateRange === 'custom' ? toDate || undefined : undefined,
  };

  const { rows, totalCount, isLoading, error } = useBookings(filters);

  const columns = useMemo<ColumnDef<BookingListRow>[]>(
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
        id: 'customer',
        header: 'Customer',
        accessorFn: (row) =>
          `${row.customer_first_name} ${row.customer_last_name} ${row.customer_email}`,
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="font-semibold">
              {row.original.customer_first_name} {row.original.customer_last_name}
            </span>
            <span className="text-daisy-muted text-[12px]">{row.original.customer_email}</span>
          </span>
        ),
      },
      {
        id: 'course',
        header: 'Course',
        accessorFn: (row) => `${row.course_template_name ?? ''} ${row.course_event_date ?? ''}`,
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="font-semibold">{row.original.course_template_name ?? '-'}</span>
            <span className="text-daisy-muted text-[12px]">
              {formatLondonDate(row.original.course_event_date)}
            </span>
          </span>
        ),
      },
      {
        id: 'franchisee',
        header: 'Franchisee',
        accessorFn: (row) => `${row.franchisee_number} ${row.franchisee_name}`,
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="text-daisy-ink-soft font-mono text-[12px] font-bold">
              {row.original.franchisee_number || '-'}
            </span>
            <span className="text-daisy-muted text-[12px]">{row.original.franchisee_name}</span>
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
        cell: ({ row }) => (
          <StatusPill variant={paymentStatusVariant(row.original.payment_status)}>
            {row.original.payment_status}
          </StatusPill>
        ),
      },
      {
        accessorKey: 'booking_status',
        header: 'Booking',
        cell: ({ row }) => (
          <StatusPill variant={bookingStatusVariant(row.original.booking_status)}>
            {row.original.booking_status.replace('_', ' ')}
          </StatusPill>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Bookings"
        subtitle="Every booking across the network. Cancel and refund tools land with the franchisee portal in M2."
        actions={<Badge variant="primary">{totalCount} total</Badge>}
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search booking reference…"
          className="h-10 max-w-sm flex-1 rounded-full"
          aria-label="Search bookings"
        />
        <Select
          value={paymentStatus}
          onValueChange={(v) => setPaymentStatus(v as PaymentStatus | 'all')}
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={bookingStatus}
          onValueChange={(v) => setBookingStatus(v as BookingStatus | 'all')}
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BOOKING_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRangeFilter)}>
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
          Could not load bookings: {error.message}
        </div>
      ) : null}

      <DataTable<BookingListRow>
        columns={columns}
        data={rows}
        isLoading={isLoading}
        searchable={false}
        onRowClick={(row) => navigate(`/hq/bookings/${row.id}`)}
        emptyState={
          <EmptyState
            title="No bookings yet"
            body="As franchisees create courses and parents book, they'll appear here."
          />
        }
      />
    </div>
  );
}
