/**
 * /hq/territories — sortable table on the left, Google Map on the right.
 *
 * Reference: docs/M1-build-plan.md §6 Wave 3 Agent 3A.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { MapPin } from 'lucide-react';
import {
  PageHeader,
  DataTable,
  StatusPill,
  EmptyState,
  TerritoryMap,
  type TerritoryMapItem,
} from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AssignFranchiseeModal } from './AssignFranchiseeModal';
import { useTerritories, type TerritoryRow, type TerritoryStatus } from './queries';

const STATUS_LABELS: Record<TerritoryStatus, string> = {
  active: 'Active',
  vacant: 'Vacant',
  reserved: 'Reserved',
};

function formatRelative(iso: string | null): string {
  if (!iso) return '-';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '-';
  const diffMs = Date.now() - then;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function TerritoriesPage() {
  const territories = useTerritories();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<TerritoryRow | null>(null);

  const rows = useMemo(() => territories.data ?? [], [territories.data]);
  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  const columns = useMemo<ColumnDef<TerritoryRow>[]>(
    () => [
      {
        id: 'postcode_prefix',
        accessorKey: 'postcode_prefix',
        header: 'Postcode',
        cell: ({ row }) => (
          <span className="text-daisy-ink font-bold">{row.original.postcode_prefix}</span>
        ),
      },
      {
        id: 'name',
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => <span>{row.original.name}</span>,
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <StatusPill variant={row.original.status}>
            {STATUS_LABELS[row.original.status]}
          </StatusPill>
        ),
      },
      {
        id: 'franchisee',
        accessorFn: (row) =>
          row.franchisee_name ? `${row.franchisee_number} ${row.franchisee_name}` : '',
        header: 'Franchisee',
        cell: ({ row }) => {
          const t = row.original;
          if (!t.franchisee_id) {
            return <span className="text-daisy-muted text-sm italic">Unassigned</span>;
          }
          return (
            <Link
              to={`/hq/franchisees/${t.franchisee_id}`}
              className="text-daisy-primary hover:text-daisy-primary-deep text-sm font-semibold"
              onClick={(e) => e.stopPropagation()}
            >
              {t.franchisee_number} · {t.franchisee_name}
            </Link>
          );
        },
      },
      {
        id: 'updated_at',
        accessorKey: 'updated_at',
        header: 'Last action',
        cell: ({ row }) => (
          <span className="text-daisy-muted text-xs">
            {formatRelative(row.original.updated_at)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        enableSorting: false,
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              setAssignTarget(row.original);
            }}
          >
            {row.original.franchisee_id ? 'Reassign' : 'Assign'}
          </Button>
        ),
      },
    ],
    [],
  );

  // Map items derived from the same row shape — keeps the map and table
  // in sync without a second fetch.
  const mapItems: TerritoryMapItem[] = rows.map((r) => ({
    id: r.id,
    lat: r.lat,
    lng: r.lng,
    status: r.status,
    postcode_prefix: r.postcode_prefix,
    name: r.name,
    franchisee_name: r.franchisee_name,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Territories"
        subtitle="Every postcode prefix Daisy covers, with assignment status and live geocodes."
        actions={
          <Badge variant="primary" className="text-xs font-bold tracking-wide uppercase">
            {rows.length} total
          </Badge>
        }
      />

      {territories.isError ? (
        <p className="text-daisy-orange text-sm">
          Failed to load territories: {territories.error.message}
        </p>
      ) : null}

      {rows.length === 0 && !territories.isLoading ? (
        <EmptyState
          icon={<MapPin />}
          title="No territories yet"
          body="Once postcode prefixes are loaded, every territory appears here with assignment status and a marker on the map."
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <DataTable
              columns={columns}
              data={rows}
              isLoading={territories.isLoading}
              searchPlaceholder="Search postcode, name, franchisee…"
              onRowClick={(row) => setSelectedId(row.id)}
              pageSize={20}
            />
          </div>

          <div className="flex flex-col gap-4 lg:col-span-2">
            <TerritoryMap
              territories={mapItems}
              onMarkerClick={(t) => setSelectedId(t.id)}
              selectedId={selectedId}
            />
            <SelectedTerritoryCard territory={selected} onAssign={(t) => setAssignTarget(t)} />
          </div>
        </div>
      )}

      {assignTarget ? (
        <AssignFranchiseeModal
          territory={assignTarget}
          open
          onClose={() => setAssignTarget(null)}
        />
      ) : null}
    </div>
  );
}

interface SelectedTerritoryCardProps {
  territory: TerritoryRow | null;
  onAssign: (t: TerritoryRow) => void;
}

function SelectedTerritoryCard({ territory, onAssign }: SelectedTerritoryCardProps) {
  if (!territory) {
    return (
      <div className="border-daisy-line-soft bg-daisy-paper text-daisy-muted shadow-card rounded-[12px] border p-5 text-sm">
        Click a marker or table row to inspect a territory.
      </div>
    );
  }

  return (
    <div
      className="border-daisy-line-soft bg-daisy-paper shadow-card flex flex-col gap-3 rounded-[12px] border p-5"
      data-territory-id={territory.id}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-daisy-muted text-[12px] font-semibold tracking-wide uppercase">
            {territory.postcode_prefix}
          </p>
          <h3 className="font-display text-daisy-ink text-xl leading-tight font-bold">
            {territory.name}
          </h3>
        </div>
        <StatusPill variant={territory.status}>{STATUS_LABELS[territory.status]}</StatusPill>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-daisy-muted text-[11px] font-semibold tracking-wide uppercase">
            Franchisee
          </dt>
          <dd>
            {territory.franchisee_id ? (
              <Link
                to={`/hq/franchisees/${territory.franchisee_id}`}
                className="text-daisy-primary hover:text-daisy-primary-deep font-semibold"
              >
                {territory.franchisee_number} · {territory.franchisee_name}
              </Link>
            ) : (
              <span className="text-daisy-muted italic">Unassigned</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-daisy-muted text-[11px] font-semibold tracking-wide uppercase">
            Coordinates
          </dt>
          <dd className="text-daisy-ink-soft">
            {typeof territory.lat === 'number' && typeof territory.lng === 'number'
              ? `${territory.lat.toFixed(3)}, ${territory.lng.toFixed(3)}`
              : 'Not geocoded'}
          </dd>
        </div>
      </dl>

      <Button onClick={() => onAssign(territory)} className="self-start">
        {territory.franchisee_id ? 'Reassign…' : 'Assign…'}
      </Button>
    </div>
  );
}
