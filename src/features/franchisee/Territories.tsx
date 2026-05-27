/**
 * /franchisee/territories — read-only view of the postcode areas assigned to
 * the signed-in franchisee, with a map sidecar.
 *
 * Design decisions
 * ----------------
 * - RLS (policy "franchisee_own" on da_territories) restricts the query to
 *   the current franchisee's rows. No client-side franchisee_id filter is
 *   applied — see territoryQueries.ts for the reasoning.
 * - "Request a territory" uses a mailto: link to Jenni's inbox. A proper
 *   in-app workflow (request form → HQ approval queue) is deferred to Phase 3.
 * - Map selection: clicking a table row calls setSelected, which passes
 *   selectedId to TerritoryMap; the map's PanToSelection effect handles the
 *   pan/zoom. Clicking a map marker also updates the selection so the row
 *   highlight stays in sync.
 *
 * Reference: docs/M2-build-plan.md §Wave 6C.
 */

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { MapPin, Mail } from 'lucide-react';
import {
  PageHeader,
  DataTable,
  StatusPill,
  EmptyState,
  TerritoryMap,
  type TerritoryMapItem,
} from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { formatPence } from '@/lib/format';
import { useOwnTerritories, type OwnTerritoryRow } from './territoryQueries';
import type { TerritoryStatus } from '@/types/franchisee';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<TerritoryStatus, string> = {
  active: 'Active',
  vacant: 'Vacant',
  reserved: 'Reserved',
};

/**
 * TODO (Phase 3): Replace this placeholder with Jenni's real support address
 * once the in-app territory request workflow ships. The mailto: is an
 * intentional short-term stopgap — it avoids blocking franchisees from making
 * requests while the approval queue is built.
 */
const TERRITORY_REQUEST_EMAIL = 'support@daisyfirst.aid';

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function Territories() {
  const query = useOwnTerritories();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = useMemo(() => query.data ?? [], [query.data]);

  const columns = useMemo<ColumnDef<OwnTerritoryRow>[]>(
    () => [
      {
        id: 'postcode_prefix',
        accessorKey: 'postcode_prefix',
        header: 'Postcode',
        cell: ({ row }) => (
          <span className="text-daisy-ink font-bold whitespace-nowrap">
            {row.original.postcode_prefix}
          </span>
        ),
      },
      {
        id: 'name',
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <span
            className="block max-w-[160px] truncate whitespace-nowrap"
            title={row.original.name}
          >
            {row.original.name}
          </span>
        ),
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
        id: 'courses_this_month',
        accessorKey: 'courses_this_month',
        header: 'Courses (this month)',
        cell: ({ row }) => (
          <span className="text-daisy-ink-soft text-sm tabular-nums">
            {row.original.courses_this_month.toLocaleString('en-GB')}
          </span>
        ),
      },
      {
        id: 'revenue_this_month',
        accessorKey: 'revenue_this_month_pence',
        header: 'Revenue (this month)',
        cell: ({ row }) => (
          <span className="text-daisy-ink-soft text-sm tabular-nums">
            {formatPence(row.original.revenue_this_month_pence)}
          </span>
        ),
      },
    ],
    [],
  );

  const mapItems: TerritoryMapItem[] = useMemo(
    () =>
      rows.map((r) => ({
        id: r.id,
        lat: r.lat,
        lng: r.lng,
        status: r.status,
        postcode_prefix: r.postcode_prefix,
        name: r.name,
      })),
    [rows],
  );

  const selectedTerritory = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const requestHref = `mailto:${TERRITORY_REQUEST_EMAIL}?subject=${encodeURIComponent(
    'Territory enquiry',
  )}&body=${encodeURIComponent(
    'Hi Jenni,\n\nI would like to enquire about adding a territory to my franchise.\n\n',
  )}`;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My territories"
        subtitle="The postcode areas assigned to your franchise. Click a row to inspect it on the map."
        actions={
          <Button asChild variant="outline" size="sm">
            {/* TODO (Phase 3): replace mailto: with in-app request form once
                the HQ approval queue ships. */}
            <a href={requestHref}>
              <Mail className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Request a territory
            </a>
          </Button>
        }
      />

      {query.isError ? (
        <p className="text-daisy-orange text-sm">
          Could not load your territories: {query.error.message}
        </p>
      ) : null}

      {rows.length === 0 && !query.isLoading ? (
        <EmptyState
          icon={<MapPin />}
          title="No territories assigned yet"
          body="Once Jenni has allocated your postcode areas you will see them here, along with your courses and revenue for the current month. Use the button above to get in touch if you are expecting territories and they have not appeared."
        />
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* min-w-0 prevents the flex child from overflowing on narrow
              viewports when territory names are long. */}
          <div className="min-w-0 flex-1">
            <DataTable
              columns={columns}
              data={rows}
              isLoading={query.isLoading}
              searchPlaceholder="Search postcode or name…"
              onRowClick={(row) => setSelectedId(row.id)}
              pageSize={20}
            />
          </div>

          <div className="flex flex-col gap-4 lg:w-[380px] lg:shrink-0">
            <TerritoryMap
              territories={mapItems}
              onMarkerClick={(t) => setSelectedId(t.id)}
              selectedId={selectedId}
            />

            <SelectedTerritoryCard territory={selectedTerritory} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Selected territory side card
// ---------------------------------------------------------------------------

interface SelectedTerritoryCardProps {
  territory: OwnTerritoryRow | null;
}

function SelectedTerritoryCard({ territory }: SelectedTerritoryCardProps) {
  if (!territory) {
    return (
      <div className="border-daisy-line-soft bg-daisy-paper text-daisy-muted shadow-card rounded-[12px] border p-5 text-sm">
        Click a row or map marker to inspect a territory.
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
            Courses this month
          </dt>
          <dd className="text-daisy-ink font-semibold tabular-nums">
            {territory.courses_this_month.toLocaleString('en-GB')}
          </dd>
        </div>
        <div>
          <dt className="text-daisy-muted text-[11px] font-semibold tracking-wide uppercase">
            Revenue this month
          </dt>
          <dd className="text-daisy-ink font-semibold tabular-nums">
            {formatPence(territory.revenue_this_month_pence)}
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
    </div>
  );
}
