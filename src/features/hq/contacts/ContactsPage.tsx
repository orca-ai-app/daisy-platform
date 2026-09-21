/**
 * ContactsPage — /hq/contacts
 *
 * HQ-only directory over da_customers. HQ can search/filter, tick contacts,
 * and hand a selection (or "everyone opted-in") off to the existing broadcast
 * composer via router state.
 *
 * Reuses the shared Daisy primitives (PageHeader/DataTable/StatusPill/
 * EmptyState) exactly as the HQ bookings + franchisee customers pages do.
 * Pagination is server-side (range()) with our own Prev/Next controls, so the
 * DataTable's internal client-side pagination is disabled by handing it a page
 * size large enough to hold the whole server page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';

import { PageHeader, DataTable, StatusPill, EmptyState } from '@/components/daisy';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  useHQContacts,
  useAllMatchingContactIds,
  type ContactRow,
  type MarketingFilter,
} from './queries';

const PAGE_SIZE = 50;

const MARKETING_OPTIONS: ReadonlyArray<{ value: MarketingFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'emailable', label: 'Emailable' },
  { value: 'suppressed', label: 'Opted-out' },
];

/** True when an import source (e.g. 'kartra_2026-09-17') should show a hint. */
function isImported(source: string | null): boolean {
  return !!source && source.toLowerCase().startsWith('kartra');
}

export default function ContactsPage() {
  const navigate = useNavigate();

  // --- Filters -------------------------------------------------------------
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [marketing, setMarketing] = useState<MarketingFilter>('all');
  const [page, setPage] = useState(0);

  // Debounce the search input (~300ms) and reset to the first page on change.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset to first page whenever the marketing filter changes.
  useEffect(() => {
    setPage(0);
  }, [marketing]);

  const { rows, totalCount, isLoading, isFetching, error } = useHQContacts({
    search,
    marketing,
    page,
    pageSize: PAGE_SIZE,
  });

  useEffect(() => {
    if (error) {
      toast.error(`Could not load contacts: ${(error as Error).message}`);
    }
  }, [error]);

  // --- Selection -----------------------------------------------------------
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectingAll, setSelectingAll] = useState(false);
  const fetchAllMatchingIds = useAllMatchingContactIds();

  const pageIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const togglePage = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  }, [allPageSelected, pageIds]);

  function clearSelection() {
    setSelected(new Set());
  }

  async function selectAllMatching() {
    setSelectingAll(true);
    try {
      const ids = await fetchAllMatchingIds({ search, marketing });
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
      toast.success(`Selected ${ids.length} matching contact${ids.length === 1 ? '' : 's'}.`);
    } catch (err) {
      toast.error(`Could not select all: ${(err as Error).message}`);
    } finally {
      setSelectingAll(false);
    }
  }

  // --- Navigation to the broadcast composer --------------------------------
  function emailAllOptedIn() {
    navigate('/hq/emails/broadcasts/new', {
      state: { crmAudience: { type: 'customers_all' } },
    });
  }

  function emailSelected() {
    navigate('/hq/emails/broadcasts/new', {
      state: {
        crmAudience: { type: 'customers_selected', customerIds: [...selected] },
      },
    });
  }

  // --- Columns -------------------------------------------------------------
  const columns = useMemo<ColumnDef<ContactRow>[]>(
    () => [
      {
        id: 'select',
        header: () => (
          <input
            type="checkbox"
            aria-label="Select all on this page"
            checked={allPageSelected}
            onChange={togglePage}
            className="accent-daisy-primary size-4 cursor-pointer"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select ${row.original.first_name} ${row.original.last_name}`}
            checked={selected.has(row.original.id)}
            onChange={() => toggleOne(row.original.id)}
            onClick={(e) => e.stopPropagation()}
            className="accent-daisy-primary size-4 cursor-pointer"
          />
        ),
        meta: { mobileLabel: 'Select' },
      },
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
        cell: ({ row }) =>
          row.original.booking_count > 0 ? (
            <Badge variant="default">{row.original.booking_count}</Badge>
          ) : (
            <span className="text-daisy-muted text-[13px]">—</span>
          ),
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <StatusPill variant={row.original.marketing_opt_out ? 'not-connected' : 'active'}>
              {row.original.marketing_opt_out ? 'Opted out' : 'Emailable'}
            </StatusPill>
            {isImported(row.original.source) ? (
              <span className="text-daisy-muted text-[11px] font-semibold">imported</span>
            ) : null}
          </span>
        ),
      },
    ],
    [allPageSelected, selected, toggleOne, togglePage],
  );

  // --- Pagination window ---------------------------------------------------
  const from = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, totalCount);
  const hasPrev = page > 0;
  const hasNext = (page + 1) * PAGE_SIZE < totalCount;
  const selectedCount = selected.size;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Contacts"
        subtitle="Everyone who's booked or been imported. Tick contacts to email them, or email all opted-in at once."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="primary">{totalCount} total</Badge>
            <Button variant="outline" size="sm" onClick={emailAllOptedIn}>
              Email all opted-in
            </Button>
            <Button size="sm" disabled={selectedCount === 0} onClick={emailSelected}>
              Email selected ({selectedCount})
            </Button>
          </div>
        }
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        <Input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by name or email…"
          className="h-10 max-w-sm flex-1 rounded-full"
          aria-label="Search contacts"
        />
        <Select value={marketing} onValueChange={(v) => setMarketing(v as MarketingFilter)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MARKETING_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Selection summary */}
      <div className="text-daisy-muted flex flex-wrap items-center gap-3 text-[13px]">
        {selectedCount > 0 ? (
          <>
            <span className="text-daisy-ink font-semibold">{selectedCount} selected</span>
            <button
              type="button"
              onClick={clearSelection}
              className="text-daisy-primary font-semibold underline-offset-2 hover:underline"
            >
              Clear
            </button>
          </>
        ) : (
          <span>No contacts selected.</span>
        )}
        {totalCount > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={selectingAll}
            onClick={() => void selectAllMatching()}
            className="text-daisy-primary text-xs"
          >
            {selectingAll ? 'Selecting…' : `Select all ${totalCount} matching`}
          </Button>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
          Could not load contacts: {(error as Error).message}
        </div>
      ) : null}

      <DataTable<ContactRow>
        columns={columns}
        data={rows}
        isLoading={isLoading}
        searchable={false}
        pageSize={PAGE_SIZE}
        emptyState={
          <EmptyState
            title="No contacts found"
            body="No one matches these filters yet. Contacts appear here once they've booked or been imported."
          />
        }
      />

      {/* Pagination controls */}
      {totalCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-daisy-muted text-[13px]">
            Showing {from}–{to} of {totalCount}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!hasPrev || isFetching}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasNext || isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
