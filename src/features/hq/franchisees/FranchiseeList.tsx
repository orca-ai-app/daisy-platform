import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { PageHeader, DataTable, StatusPill, EmptyState } from '@/components/daisy';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFranchisees, type FranchiseeRow } from './queries';
import type { FranchiseeStatus } from '@/types/franchisee';

const STATUS_OPTIONS: ReadonlyArray<{
  value: FranchiseeStatus | 'all';
  label: string;
}> = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'terminated', label: 'Terminated' },
];

/**
 * Initials for the avatar circle. "Sarah Hughes" → "SH",
 * "Maria O'Connell" → "MO", single-word names just take the first
 * two letters.
 */
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - then.getTime();
  if (Number.isNaN(diffMs)) return '—';
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).format(then);
}

export default function FranchiseeList() {
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<FranchiseeStatus | 'all'>('all');

  const { rows, totalCount, isLoading, error } = useFranchisees({
    search,
    status,
  });

  const columns = useMemo<ColumnDef<FranchiseeRow>[]>(
    () => [
      {
        accessorKey: 'number',
        header: 'Number',
        cell: ({ row }) => (
          <span className="text-daisy-ink-soft font-mono text-[13px] font-bold">
            {row.original.number.padStart(4, '0')}
          </span>
        ),
      },
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <span className="flex items-center gap-2.5">
            <span
              className="bg-daisy-primary-soft text-daisy-primary-deep inline-flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold"
              aria-hidden
            >
              {initialsFor(row.original.name)}
            </span>
            <span className="font-bold">{row.original.name}</span>
          </span>
        ),
      },
      {
        accessorKey: 'email',
        header: 'Email',
        cell: ({ row }) => (
          <span className="text-daisy-muted text-[13px]">{row.original.email}</span>
        ),
      },
      {
        accessorKey: 'territory_count',
        header: 'Territories',
        cell: ({ row }) => <span className="font-semibold">{row.original.territory_count}</span>,
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <StatusPill variant={row.original.status}>{row.original.status}</StatusPill>
        ),
      },
      {
        accessorKey: 'stripe_connected',
        header: 'Stripe',
        cell: ({ row }) => (
          <StatusPill variant={row.original.stripe_connected ? 'connected' : 'not-connected'}>
            {row.original.stripe_connected ? 'Connected' : 'Not connected'}
          </StatusPill>
        ),
      },
      {
        id: 'last_action_at',
        accessorKey: 'last_action_at',
        header: 'Last action',
        cell: ({ row }) => (
          <span className="text-daisy-muted text-[13px]">
            {formatRelative(row.original.last_action_at)}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Franchisees"
        subtitle="Browse the network and onboard new franchisees."
        actions={
          <>
            <Badge variant="primary">{totalCount} total</Badge>
            <Button asChild>
              <Link to="/hq/franchisees/new">+ New franchisee</Link>
            </Button>
          </>
        }
      />

      {/*
       * Filter bar — search hits the Supabase query (so the result
       * span isn't capped at the current page), the dropdown filters
       * by status. The DataTable below adds in-table search across
       * the loaded page, so users get both server- and client-side
       * filtering for free.
       */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, number, or email…"
          className="h-10 max-w-sm flex-1 rounded-full"
          aria-label="Search franchisees"
        />
        <Select value={status} onValueChange={(v) => setStatus(v as FranchiseeStatus | 'all')}>
          <SelectTrigger className="w-[200px]">
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
      </div>

      {error ? (
        <div className="mb-4 rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
          Could not load franchisees: {error.message}
        </div>
      ) : null}

      <DataTable<FranchiseeRow>
        columns={columns}
        data={rows}
        isLoading={isLoading}
        searchable={false}
        onRowClick={(row) => navigate(`/hq/franchisees/${row.id}`)}
        emptyState={
          <EmptyState
            title="No franchisees match"
            body="Try adjusting the search or status filter, or seed some franchisees first."
          />
        }
      />
    </div>
  );
}
