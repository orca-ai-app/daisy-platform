import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { Copy, FileWarning, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { DataTable, EmptyState, PageHeader, StatusPill } from '@/components/daisy';
import type { StatusVariant } from '@/components/daisy/StatusPill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  useSystemLogs,
  WINDOW_OPTIONS,
  type LogLevel,
  type LogWindow,
  type SystemLogFilters,
  type SystemLogRow,
} from './queries';

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'Europe/London',
});

const fullTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'Europe/London',
});

const LEVEL_VARIANT: Record<LogLevel, StatusVariant> = {
  info: 'not-connected',
  warn: 'pending',
  error: 'failed',
};

const LEVEL_OPTIONS: { value: LogLevel | 'all'; label: string }[] = [
  { value: 'all', label: 'All levels' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
];

function isLogWindow(v: string | null): v is LogWindow {
  return v === '1h' || v === '24h' || v === '7d' || v === '30d';
}

function isLevel(v: string | null): v is LogLevel {
  return v === 'info' || v === 'warn' || v === 'error';
}

function copyRequestId(requestId: string) {
  void navigator.clipboard
    .writeText(requestId)
    .then(() => toast.success('Request id copied'))
    .catch(() => toast.error('Could not copy — select it manually'));
}

export function SystemLogsPage() {
  // Dashboard tiles link here pre-filtered, e.g. ?browser=1&level=error&window=24h
  // or ?source=send-emails. Params seed the initial state only.
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState<SystemLogFilters>(() => ({
    window: isLogWindow(searchParams.get('window'))
      ? (searchParams.get('window') as LogWindow)
      : '24h',
    level: isLevel(searchParams.get('level')) ? (searchParams.get('level') as LogLevel) : 'all',
    source: searchParams.get('source') ?? 'all',
    browserOnly: searchParams.get('browser') === '1',
  }));
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selected, setSelected] = useState<SystemLogRow | null>(null);

  const logs = useSystemLogs(filters, autoRefresh);
  const rows = useMemo(() => logs.data ?? [], [logs.data]);

  // Distinct sources from the loaded page, keeping the current selection
  // visible even when the filter itself has narrowed the data.
  const sources = useMemo(() => {
    const set = new Set(rows.map((r) => r.source));
    if (filters.source !== 'all') set.add(filters.source);
    return [...set].sort();
  }, [rows, filters.source]);

  const columns = useMemo<ColumnDef<SystemLogRow>[]>(
    () => [
      {
        accessorKey: 'created_at',
        header: 'Time',
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {timeFormatter.format(new Date(row.original.created_at))}
          </span>
        ),
      },
      {
        accessorKey: 'level',
        header: 'Level',
        cell: ({ row }) => (
          <StatusPill variant={LEVEL_VARIANT[row.original.level]}>{row.original.level}</StatusPill>
        ),
      },
      {
        accessorKey: 'source',
        header: 'Source',
        cell: ({ row }) => <span className="whitespace-nowrap">{row.original.source}</span>,
      },
      {
        accessorKey: 'message',
        header: 'Message',
        cell: ({ row }) => (
          <span className="block max-w-[420px] truncate" title="Click the row for the full entry">
            {row.original.message}
          </span>
        ),
      },
      {
        accessorKey: 'request_id',
        header: 'Request id',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.request_id ? (
            <button
              type="button"
              className="text-daisy-ink-soft hover:text-daisy-primary inline-flex items-center gap-1 font-mono text-[12px]"
              title="Copy request id"
              onClick={(e) => {
                e.stopPropagation();
                copyRequestId(row.original.request_id!);
              }}
            >
              {row.original.request_id}
              <Copy aria-hidden className="h-3 w-3" />
            </button>
          ) : (
            <span className="text-daisy-muted">—</span>
          ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="System logs"
        subtitle="Debug trail from edge functions and browser sessions. Latest 500 rows per window."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void logs.refetch()}
              disabled={logs.isFetching}
            >
              <RefreshCw aria-hidden className={cn('h-4 w-4', logs.isFetching && 'animate-spin')} />
              Refresh
            </Button>
            <Button
              variant={autoRefresh ? 'default' : 'outline'}
              size="sm"
              aria-pressed={autoRefresh}
              onClick={() => setAutoRefresh((v) => !v)}
            >
              Auto-refresh {autoRefresh ? 'on' : 'off'}
            </Button>
          </>
        }
      />

      <FilterBar filters={filters} sources={sources} onChange={setFilters} />

      {logs.isError ? (
        <p className="rounded-[8px] border border-[#FDEAE5] bg-[#FDEAE5]/40 p-4 text-sm text-[#8A2A2A]">
          Could not load system logs: {logs.error.message}
        </p>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          isLoading={logs.isLoading}
          searchPlaceholder="Search message or request id…"
          pageSize={25}
          onRowClick={(row) => setSelected(row)}
          emptyState={
            <EmptyState
              icon={<FileWarning />}
              title="No log entries"
              body="Nothing matched this window and filter set. Widen the time window or clear the filters."
            />
          }
        />
      )}

      <LogDetailDialog row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

interface FilterBarProps {
  filters: SystemLogFilters;
  sources: string[];
  onChange: (next: SystemLogFilters) => void;
}

function FilterBar({ filters, sources, onChange }: FilterBarProps) {
  return (
    <div className="border-daisy-line-soft bg-daisy-paper grid grid-cols-1 items-end gap-3 rounded-[12px] border p-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-level">Level</Label>
        <select
          id="filter-level"
          className="border-daisy-line text-daisy-ink focus-visible:border-daisy-primary h-10 rounded-[8px] border-2 bg-white px-3 text-sm focus-visible:outline-none"
          value={filters.level}
          onChange={(e) => onChange({ ...filters, level: e.target.value as LogLevel | 'all' })}
        >
          {LEVEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-source">Source</Label>
        <select
          id="filter-source"
          className="border-daisy-line text-daisy-ink focus-visible:border-daisy-primary h-10 rounded-[8px] border-2 bg-white px-3 text-sm focus-visible:outline-none disabled:opacity-60"
          value={filters.source}
          disabled={filters.browserOnly}
          onChange={(e) => onChange({ ...filters, source: e.target.value })}
        >
          <option value="all">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-window">Time window</Label>
        <select
          id="filter-window"
          className="border-daisy-line text-daisy-ink focus-visible:border-daisy-primary h-10 rounded-[8px] border-2 bg-white px-3 text-sm focus-visible:outline-none"
          value={filters.window}
          onChange={(e) => onChange({ ...filters, window: e.target.value as LogWindow })}
        >
          {WINDOW_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Quick filter</span>
        <button
          type="button"
          aria-pressed={filters.browserOnly}
          onClick={() => onChange({ ...filters, browserOnly: !filters.browserOnly })}
          className={cn(
            'inline-flex h-10 items-center justify-center rounded-full border-2 px-4 text-sm font-semibold transition-colors',
            filters.browserOnly
              ? 'border-daisy-primary bg-daisy-primary-soft text-daisy-primary-deep'
              : 'border-daisy-line text-daisy-muted hover:border-daisy-primary bg-white',
          )}
        >
          Browser errors
        </button>
      </div>
    </div>
  );
}

function LogDetailDialog({ row, onClose }: { row: SystemLogRow | null; onClose: () => void }) {
  return (
    <Dialog open={row !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        {row ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <StatusPill variant={LEVEL_VARIANT[row.level]}>{row.level}</StatusPill>
                <span>{row.source}</span>
              </DialogTitle>
              <DialogDescription>
                {fullTimeFormatter.format(new Date(row.created_at))}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4 py-2">
              <p className="text-daisy-ink text-sm break-words whitespace-pre-wrap">
                {row.message}
              </p>

              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                <div>
                  <dt className="text-daisy-muted text-[11px] font-bold tracking-wider uppercase">
                    Request id
                  </dt>
                  <dd className="mt-1">
                    {row.request_id ? (
                      <button
                        type="button"
                        className="text-daisy-ink hover:text-daisy-primary inline-flex items-center gap-1 font-mono text-sm"
                        onClick={() => copyRequestId(row.request_id!)}
                      >
                        {row.request_id}
                        <Copy aria-hidden className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <span className="text-daisy-muted text-sm">—</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-daisy-muted text-[11px] font-bold tracking-wider uppercase">
                    Actor
                  </dt>
                  <dd className="text-daisy-ink mt-1 text-sm break-all">{row.actor ?? '—'}</dd>
                </div>
                {row.entity_type ? (
                  <div className="sm:col-span-2">
                    <dt className="text-daisy-muted text-[11px] font-bold tracking-wider uppercase">
                      Entity
                    </dt>
                    <dd className="mt-1 flex items-center gap-2 text-sm">
                      <Badge variant="default">{row.entity_type}</Badge>
                      <span className="text-daisy-ink font-mono text-[12px] break-all">
                        {row.entity_id ?? '—'}
                      </span>
                    </dd>
                  </div>
                ) : null}
              </dl>

              <div>
                <div className="text-daisy-muted text-[11px] font-bold tracking-wider uppercase">
                  Context
                </div>
                {row.context && Object.keys(row.context).length > 0 ? (
                  <pre className="bg-daisy-ink/[0.04] text-daisy-ink-soft mt-1 overflow-x-auto rounded-[8px] p-3 text-xs">
                    {JSON.stringify(row.context, null, 2)}
                  </pre>
                ) : (
                  <p className="text-daisy-muted mt-1 text-sm italic">No context recorded.</p>
                )}
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default SystemLogsPage;
