/**
 * /franchisee/discounts — franchisee's own discount codes (Wave 9B).
 *
 * Reads via anon client + RLS (da_discount_codes, policy `franchisee_own`).
 * No client-side franchisee_id filter: RLS scopes the rows automatically.
 * Mutations flow through the create-discount-code / update-discount-code
 * Edge Functions; sonner toasts are fired inside DiscountDialog on success.
 */

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { PageHeader, DataTable, StatusPill, EmptyState } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { formatPence } from '@/lib/format';
import { useOwnDiscountCodes } from './discountQueries';
import { DiscountDialog } from './DiscountDialog';
import type { DiscountCode } from './types';

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/London',
});

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return DATE_FORMAT.format(d);
}

// ---------------------------------------------------------------------------
// Value rendering
// ---------------------------------------------------------------------------

function renderValue(row: DiscountCode): string {
  if (row.type === 'percentage') {
    return `${row.value}%`;
  }
  return formatPence(row.value);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DiscountsList() {
  const { data: codes = [], isLoading, error } = useOwnDiscountCodes();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);

  function openCreate() {
    setEditingId(undefined);
    setDialogOpen(true);
  }

  function openEdit(id: string) {
    setEditingId(id);
    setDialogOpen(true);
  }

  const columns = useMemo<ColumnDef<DiscountCode>[]>(
    () => [
      {
        accessorKey: 'code',
        header: 'Code',
        cell: ({ row }) => (
          <span className="font-mono text-[13px] font-bold tracking-wider">
            {row.original.code}
          </span>
        ),
      },
      {
        accessorKey: 'type',
        header: 'Type',
        cell: ({ row }) => (
          <span className="text-daisy-ink text-[13px] capitalize">{row.original.type}</span>
        ),
      },
      {
        id: 'value',
        header: 'Value',
        accessorFn: (row) => renderValue(row),
        cell: ({ row }) => (
          <span className="font-semibold tabular-nums">{renderValue(row.original)}</span>
        ),
      },
      {
        accessorKey: 'max_uses',
        header: 'Max uses',
        cell: ({ row }) => (
          <span className="text-daisy-ink text-[13px]">
            {row.original.max_uses !== null ? row.original.max_uses : '∞'}
          </span>
        ),
      },
      {
        accessorKey: 'uses_count',
        header: 'Used',
        cell: ({ row }) => (
          <span className="text-[13px] tabular-nums">{row.original.uses_count}</span>
        ),
      },
      {
        id: 'valid_from',
        header: 'Valid from',
        accessorFn: (row) => formatDate(row.valid_from),
        cell: ({ row }) => (
          <span className="text-daisy-muted text-[13px]">
            {formatDate(row.original.valid_from)}
          </span>
        ),
      },
      {
        id: 'valid_until',
        header: 'Valid until',
        accessorFn: (row) => formatDate(row.valid_until),
        cell: ({ row }) => (
          <span className="text-daisy-muted text-[13px]">
            {formatDate(row.original.valid_until)}
          </span>
        ),
      },
      {
        accessorKey: 'is_active',
        header: 'Status',
        cell: ({ row }) =>
          row.original.is_active ? (
            <StatusPill variant="active">Active</StatusPill>
          ) : (
            <StatusPill variant="paused">Inactive</StatusPill>
          ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              openEdit(row.original.id);
            }}
          >
            Edit
          </Button>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Discount codes"
        subtitle="Create and manage promotional codes for your bookings."
        actions={<Button onClick={openCreate}>+ Create code</Button>}
      />

      {error ? (
        <div className="mb-4 rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
          Could not load discount codes: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      ) : null}

      <DataTable<DiscountCode>
        columns={columns}
        data={codes}
        isLoading={isLoading}
        searchable
        searchPlaceholder="Search by code…"
        emptyState={
          <EmptyState
            title="No discount codes yet"
            body="Create your first code to offer discounts to customers booking through your territory."
            cta={{ label: 'Create a code', onClick: openCreate }}
          />
        }
      />

      <DiscountDialog open={dialogOpen} onOpenChange={setDialogOpen} discountId={editingId} />
    </div>
  );
}
