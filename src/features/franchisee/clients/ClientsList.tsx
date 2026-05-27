/**
 * ClientsList — /franchisee/clients
 *
 * DataTable of the franchisee's private clients (RLS-scoped; no client-side
 * franchisee_id filter needed). Create and edit actions open <ClientDialog>.
 */

import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';

import { PageHeader, DataTable, EmptyState } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

import { useOwnPrivateClients, useClientRecentBookings } from './clientQueries';
import { ClientDialog } from './ClientDialog';
import type { PrivateClient } from './types';

// ---------------------------------------------------------------------------
// Recent bookings panel (rendered below the DataTable when a client is expanded)
// ---------------------------------------------------------------------------

function RecentBookingsPanel({ clientId }: { clientId: string }) {
  const { data: bookings = [], isLoading } = useClientRecentBookings(clientId, 5);

  if (isLoading) {
    return (
      <div className="bg-daisy-paper-soft rounded-[8px] p-3">
        <p className="text-daisy-muted text-xs">Loading recent bookings...</p>
      </div>
    );
  }

  if (bookings.length === 0) {
    return (
      <div className="bg-daisy-paper-soft rounded-[8px] p-3">
        <p className="text-daisy-muted text-xs">
          No bookings yet for this client. Link a private course to start generating bookings.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-daisy-paper-soft rounded-[8px] p-3">
      <p className="text-daisy-ink mb-2 text-xs font-semibold">Recent bookings</p>
      <ul className="flex flex-col gap-1">
        {bookings.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-daisy-ink font-mono">{b.booking_reference}</span>
            <span className="text-daisy-muted">
              {b.course_template_name ?? '—'}{' '}
              {b.course_event_date ? `· ${b.course_event_date}` : ''}
            </span>
            <span className="text-daisy-muted capitalize">{b.payment_status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ClientsList() {
  const { data: clients = [], isLoading, error } = useOwnPrivateClients();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<PrivateClient | undefined>(undefined);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function openCreate() {
    setEditingClient(undefined);
    setDialogOpen(true);
  }

  function openEdit(client: PrivateClient) {
    setEditingClient(client);
    setDialogOpen(true);
  }

  function handleClose() {
    setDialogOpen(false);
    setEditingClient(undefined);
  }

  const columns = useMemo<ColumnDef<PrivateClient>[]>(
    () => [
      {
        accessorKey: 'company_name',
        header: 'Company',
        cell: ({ row }) => (
          <span className="text-daisy-ink font-semibold">{row.original.company_name}</span>
        ),
      },
      {
        accessorKey: 'contact_name',
        header: 'Contact',
        cell: ({ row }) => (
          <span className="text-daisy-ink text-[13px]">{row.original.contact_name ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'contact_email',
        header: 'Email',
        cell: ({ row }) =>
          row.original.contact_email ? (
            <a
              href={`mailto:${row.original.contact_email}`}
              className="text-daisy-primary text-[13px] underline-offset-2 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {row.original.contact_email}
            </a>
          ) : (
            <span className="text-daisy-muted text-[13px]">—</span>
          ),
      },
      {
        accessorKey: 'contact_phone',
        header: 'Phone',
        cell: ({ row }) => (
          <span className="text-daisy-muted text-[13px]">{row.original.contact_phone ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'notes',
        header: 'Notes',
        cell: ({ row }) => (
          <span className="text-daisy-muted line-clamp-1 max-w-[200px] text-[13px]">
            {row.original.notes ?? '—'}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-2">
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
              {expandedId === row.original.id ? 'Hide bookings' : 'Bookings'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                openEdit(row.original);
              }}
              className="text-daisy-muted hover:text-daisy-primary text-xs"
            >
              Edit
            </Button>
          </div>
        ),
      },
    ],
    [expandedId],
  );

  // Error toast — fire once when the error first appears, not every render.
  useEffect(() => {
    if (error) {
      toast.error(`Could not load clients: ${error.message}`);
    }
  }, [error]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Clients"
        subtitle="Manage your private clients: schools, companies, and organisations."
        actions={
          <>
            <Badge variant="primary">{clients.length} total</Badge>
            <Button type="button" onClick={openCreate}>
              + Add client
            </Button>
          </>
        }
      />

      {error ? (
        <div className="mb-4 rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
          Could not load clients: {error.message}
        </div>
      ) : null}

      <DataTable<PrivateClient>
        columns={columns}
        data={clients}
        isLoading={isLoading}
        searchable
        searchPlaceholder="Search by company or contact..."
        emptyState={
          <EmptyState
            title="No clients yet"
            body="Add your first private client: a school, company, or other organisation you run courses for."
            cta={{ label: 'Add client', onClick: openCreate }}
          />
        }
      />

      {/* Expanded recent-bookings panel */}
      {expandedId ? <RecentBookingsPanel clientId={expandedId} /> : null}

      <ClientDialog open={dialogOpen} onClose={handleClose} client={editingClient} />
    </div>
  );
}
