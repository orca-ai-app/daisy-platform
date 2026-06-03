/**
 * /hq/territory-requests — HQ queue of franchisee territory requests.
 *
 * Reached from the dashboard Attention list ("Territory requests"). HQ reviews
 * each request and moves it through reviewing → approved / declined. Actioning a
 * request (away from "new") clears it from the Attention count.
 */

import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { MapPin } from 'lucide-react';
import { PageHeader, DataTable, EmptyState } from '@/components/daisy';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useTerritoryRequests,
  useUpdateTerritoryRequest,
  TERRITORY_REQUEST_ACTIONS,
  type TerritoryRequest,
  type TerritoryRequestStatus,
} from './queries';

const STATUS_CHIP: Record<TerritoryRequestStatus, string> = {
  new: 'bg-blue-100 text-blue-800',
  reviewing: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  declined: 'bg-gray-100 text-gray-700',
};

const STATUS_LABEL: Record<TerritoryRequestStatus, string> = {
  new: 'New',
  reviewing: 'Reviewing',
  approved: 'Approved',
  declined: 'Declined',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function TerritoryRequestsPage() {
  const query = useTerritoryRequests();
  const update = useUpdateTerritoryRequest();
  const rows = useMemo(() => query.data ?? [], [query.data]);

  function setStatus(id: string, status: Exclude<TerritoryRequestStatus, 'new'>) {
    update.mutate(
      { id, status },
      {
        onSuccess: () => toast.success(`Marked ${STATUS_LABEL[status].toLowerCase()}.`),
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : 'Could not update the request.'),
      },
    );
  }

  const columns = useMemo<ColumnDef<TerritoryRequest>[]>(
    () => [
      {
        id: 'franchisee',
        header: 'Franchisee',
        cell: ({ row }) => (
          <span className="text-daisy-ink font-semibold whitespace-nowrap">
            {row.original.franchisee_name}
            {row.original.franchisee_number ? (
              <span className="text-daisy-muted ml-1 text-xs">
                #{row.original.franchisee_number}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: 'area',
        accessorKey: 'area',
        header: 'Area requested',
        cell: ({ row }) => <span className="text-daisy-ink">{row.original.area}</span>,
      },
      {
        id: 'note',
        header: 'Note',
        cell: ({ row }) => (
          <span
            className="text-daisy-muted block max-w-[260px] truncate text-sm"
            title={row.original.note ?? ''}
          >
            {row.original.note || '—'}
          </span>
        ),
      },
      {
        id: 'created_at',
        accessorKey: 'created_at',
        header: 'Requested',
        cell: ({ row }) => (
          <span className="text-daisy-ink-soft text-sm whitespace-nowrap">
            {formatDate(row.original.created_at)}
          </span>
        ),
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${STATUS_CHIP[row.original.status]}`}
          >
            {STATUS_LABEL[row.original.status]}
          </span>
        ),
      },
      {
        id: 'action',
        header: 'Action',
        cell: ({ row }) => (
          <Select
            value=""
            onValueChange={(v) =>
              setStatus(row.original.id, v as Exclude<TerritoryRequestStatus, 'new'>)
            }
          >
            <SelectTrigger className="h-8 w-[140px]">
              <SelectValue placeholder="Set status…" />
            </SelectTrigger>
            <SelectContent>
              {TERRITORY_REQUEST_ACTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
      },
    ],
    // setStatus is stable enough for our purposes; columns don't need to re-create.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Territory requests"
        subtitle="Franchisees asking for new or expanded patches. Review each one and approve or decline."
      />

      {query.isError ? (
        <p className="text-daisy-orange text-sm">
          Could not load territory requests: {query.error.message}
        </p>
      ) : null}

      {rows.length === 0 && !query.isLoading ? (
        <EmptyState
          icon={<MapPin />}
          title="No territory requests"
          body="When a franchisee asks for a territory from their portal, it appears here and in your dashboard Attention list."
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          isLoading={query.isLoading}
          searchPlaceholder="Search franchisee or area…"
          pageSize={20}
        />
      )}
    </div>
  );
}
