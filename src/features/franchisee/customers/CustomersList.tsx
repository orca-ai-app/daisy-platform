/**
 * CustomersList — /franchisee/customers
 *
 * Two-tab view:
 *  "Booked customers" — da_customers the franchisee owns (existing behaviour).
 *  "All contacts"     — union of booked customers + medical-form fillers,
 *                       deduped case-insensitively by email.
 *
 * Wave 11 + Wave 12.
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
  useMedicalContacts,
  type CustomerWithBookingCount,
  type MedicalContact,
} from './customersQueries';

// ---------------------------------------------------------------------------
// Unified row type used for the "All contacts" view
// ---------------------------------------------------------------------------

interface ContactRow {
  /** Stable unique key for the React table. */
  key: string;
  id: string;
  name: string;
  email: string | null;
  /** Undefined when the row originates from a medical form only. */
  phone: string | null | undefined;
  postcode: string | null | undefined;
  booking_count: number;
  /** True when the contact came only from a medical form (no booking record). */
  from_medical_form: boolean;
}

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
// Booked customers tab — existing behaviour
// ---------------------------------------------------------------------------

function BookedCustomersTab() {
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
    <>
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
    </>
  );
}

// ---------------------------------------------------------------------------
// All contacts tab — union view
// ---------------------------------------------------------------------------

function AllContactsTab() {
  const { data: customers = [], isLoading: custLoading, error: custError } = useOwnCustomers();
  const { data: medContacts = [], isLoading: medLoading, error: medError } = useMedicalContacts();

  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const isLoading = custLoading || medLoading;

  // Build unified contact rows: merge on lowercase email where both sides have one
  const contactRows = useMemo<ContactRow[]>(() => {
    // Start with booked customers — they always appear
    const byEmail = new Map<string, ContactRow>();
    const noEmailRows: ContactRow[] = [];

    for (const c of customers) {
      const emailKey = c.email.toLowerCase();
      const row: ContactRow = {
        key: `cust-${c.id}`,
        id: c.id,
        name: `${c.first_name} ${c.last_name}`,
        email: c.email,
        phone: c.phone,
        postcode: c.postcode,
        booking_count: c.booking_count,
        from_medical_form: false,
      };
      byEmail.set(emailKey, row);
    }

    // Layer in medical contacts — merge if same email, otherwise add new rows
    for (const mc of medContacts as MedicalContact[]) {
      if (mc.attendee_email) {
        const emailKey = mc.attendee_email.toLowerCase();
        if (!byEmail.has(emailKey)) {
          // Form-only contact
          byEmail.set(emailKey, {
            key: `med-${mc.id}`,
            id: mc.id,
            name: mc.attendee_name,
            email: mc.attendee_email,
            phone: undefined,
            postcode: undefined,
            booking_count: 0,
            from_medical_form: true,
          });
        }
        // If the email already exists as a booked customer, no merge needed —
        // we keep the customer row with its booking count.
      } else {
        // No email — always show as a distinct form-only contact
        noEmailRows.push({
          key: `med-${mc.id}`,
          id: mc.id,
          name: mc.attendee_name,
          email: null,
          phone: undefined,
          postcode: undefined,
          booking_count: 0,
          from_medical_form: true,
        });
      }
    }

    return [...Array.from(byEmail.values()), ...noEmailRows];
  }, [customers, medContacts]);

  const columns = useMemo<ColumnDef<ContactRow>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorFn: (row) => row.name,
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <span className="text-daisy-ink font-semibold">{row.original.name}</span>
            {row.original.from_medical_form ? (
              <Badge variant="secondary" className="text-[11px]">
                from medical form
              </Badge>
            ) : null}
          </span>
        ),
      },
      {
        accessorKey: 'email',
        header: 'Email',
        cell: ({ row }) =>
          row.original.email ? (
            <a
              href={`mailto:${row.original.email}`}
              className="text-daisy-primary text-[13px] underline-offset-2 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {row.original.email}
            </a>
          ) : (
            <span className="text-daisy-muted text-[13px]">—</span>
          ),
      },
      {
        accessorKey: 'phone',
        header: 'Phone',
        cell: ({ row }) => (
          <span className="text-daisy-muted text-[13px]">
            {row.original.phone !== undefined ? (row.original.phone ?? '—') : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'postcode',
        header: 'Postcode',
        cell: ({ row }) => (
          <span className="text-daisy-muted text-[13px]">
            {row.original.postcode !== undefined ? (row.original.postcode ?? '—') : '—'}
          </span>
        ),
      },
      {
        id: 'booking_count',
        header: 'Bookings',
        accessorFn: (row) => row.booking_count,
        cell: ({ row }) =>
          row.original.booking_count > 0 ? (
            <Badge variant="default">{row.original.booking_count}</Badge>
          ) : (
            <span className="text-daisy-muted text-[13px]">—</span>
          ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) =>
          !row.original.from_medical_form ? (
            <div className="flex items-center justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedKey((k) => (k === row.original.key ? null : row.original.key));
                }}
                className="text-daisy-muted hover:text-daisy-primary text-xs"
              >
                {expandedKey === row.original.key ? 'Hide history' : 'History'}
              </Button>
            </div>
          ) : null,
      },
    ],
    [expandedKey],
  );

  const error = custError ?? medError;

  return (
    <>
      {error ? (
        <div className="mb-4 rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
          Could not load contacts: {(error as Error).message}
        </div>
      ) : null}

      <DataTable<ContactRow>
        columns={columns}
        data={contactRows}
        isLoading={isLoading}
        searchable
        searchPlaceholder="Search by name or email..."
        emptyState={
          <EmptyState
            title="No contacts yet"
            body="Booked customers and medical-form submissions will appear here."
          />
        }
      />

      {expandedKey && !contactRows.find((r) => r.key === expandedKey)?.from_medical_form ? (
        <CustomerBookingsPanel
          customerId={contactRows.find((r) => r.key === expandedKey)?.id ?? ''}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type ViewTab = 'booked' | 'all';

export default function CustomersList() {
  const { data: customers = [] } = useOwnCustomers();
  const [tab, setTab] = useState<ViewTab>('booked');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customers"
        subtitle="People who have booked courses or submitted medical forms with you, scoped to your account."
        actions={<Badge variant="primary">{customers.length} booked</Badge>}
      />

      {/* Tab toggle */}
      <div className="border-daisy-line-soft flex w-fit overflow-hidden rounded-full border">
        <button
          type="button"
          onClick={() => setTab('booked')}
          className={
            tab === 'booked'
              ? 'bg-daisy-primary px-5 py-1.5 text-[12px] font-bold text-white'
              : 'text-daisy-muted hover:text-daisy-ink px-5 py-1.5 text-[12px] font-bold'
          }
          aria-pressed={tab === 'booked'}
        >
          Booked customers
        </button>
        <button
          type="button"
          onClick={() => setTab('all')}
          className={
            tab === 'all'
              ? 'bg-daisy-primary px-5 py-1.5 text-[12px] font-bold text-white'
              : 'text-daisy-muted hover:text-daisy-ink px-5 py-1.5 text-[12px] font-bold'
          }
          aria-pressed={tab === 'all'}
        >
          All contacts
        </button>
      </div>

      {tab === 'booked' ? <BookedCustomersTab /> : <AllContactsTab />}
    </div>
  );
}
