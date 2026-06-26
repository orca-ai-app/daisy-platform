/**
 * CustomersList — /franchisee/customers
 *
 * Searchable table of da_customers the franchisee can see (RLS auto-scopes).
 * Clicking a row expands a booking-history panel for that customer.
 *
 * Wave 11.
 */

import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';

import { PageHeader, DataTable, EmptyState } from '@/components/daisy';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatPence } from '@/lib/format';

import {
  useOwnCustomers,
  useCustomerBookings,
  type CustomerWithBookingCount,
} from './customersQueries';

// ---------------------------------------------------------------------------
// Customer booking-history panel
// ---------------------------------------------------------------------------

function CustomerBookingsPanel({ customerId }: { customerId: string }) {
  const { data: bookings = [], isLoading } = useCustomerBookings(customerId);

  if (isLoading) {
    return (
      <div className="bg-daisy-paper-soft rounded-[8px] p-3">
        <p className="text-daisy-muted text-xs">Loading booking history...</p>
      </div>
    );
  }

  if (bookings.length === 0) {
    return (
      <div className="bg-daisy-paper-soft rounded-[8px] p-3">
        <p className="text-daisy-muted text-xs">No bookings found for this customer.</p>
      </div>
    );
  }

  return (
    <div className="bg-daisy-paper-soft rounded-[8px] p-3">
      <p className="text-daisy-ink mb-2 text-xs font-semibold">Booking history</p>
      <ul className="flex flex-col gap-1">
        {bookings.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-daisy-ink font-mono">{b.booking_reference}</span>
            <span className="text-daisy-muted min-w-0 truncate">
              {b.course_template_name ?? '—'}
              {b.course_event_date ? ` · ${b.course_event_date}` : ''}
            </span>
            <span className="text-daisy-muted capitalize">{b.payment_status}</span>
            <span className="text-daisy-ink font-medium">{formatPence(b.total_price_pence)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CustomersList() {
  const { data: customers = [], isLoading, error } = useOwnCustomers();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const columns = useMemo<ColumnDef<CustomerWithBookingCount>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorFn: (row) => `${row.first_name} ${row.last_name}`,
        cell: ({ row }) => (
          <span className="text-daisy-ink font-semibold">
            {row.original.first_name} {row.original.last_name}
          </span>
        ),
      },
      {
        accessorKey: 'email',
        header: 'Email',
        cell: ({ row }) => (
          <a
            href={`mailto:${row.original.email}`}
            className="text-daisy-primary text-[13px] underline-offset-2 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.original.email}
          </a>
        ),
      },
      {
        accessorKey: 'phone',
        header: 'Phone',
        cell: ({ row }) => (
          <span className="text-daisy-muted text-[13px]">{row.original.phone ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'postcode',
        header: 'Postcode',
        cell: ({ row }) => (
          <span className="text-daisy-muted text-[13px]">{row.original.postcode ?? '—'}</span>
        ),
      },
      {
        id: 'booking_count',
        header: 'Bookings',
        accessorFn: (row) => row.booking_count,
        cell: ({ row }) => <Badge variant="default">{row.original.booking_count}</Badge>,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setExpandedId((id) => (id === row.original.id ? null : row.original.id));
              }}
              className="text-daisy-muted hover:text-daisy-primary text-xs"
            >
              {expandedId === row.original.id ? 'Hide history' : 'History'}
            </Button>
          </div>
        ),
      },
    ],
    [expandedId],
  );

  useEffect(() => {
    if (error) {
      toast.error(`Could not load customers: ${(error as Error).message}`);
    }
  }, [error]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customers"
        subtitle="People who have booked courses with you, scoped to your account."
        actions={<Badge variant="primary">{customers.length} total</Badge>}
      />

      {error ? (
        <div className="mb-4 rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
          Could not load customers: {(error as Error).message}
        </div>
      ) : null}

      <DataTable<CustomerWithBookingCount>
        columns={columns}
        data={customers}
        isLoading={isLoading}
        searchable
        searchPlaceholder="Search by name, email or postcode..."
        emptyState={
          <EmptyState
            title="No customers yet"
            body="Customers appear here once they have completed a booking for one of your courses."
          />
        }
      />

      {expandedId ? <CustomerBookingsPanel customerId={expandedId} /> : null}
    </div>
  );
}
