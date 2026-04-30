import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ListTodo } from 'lucide-react';
import { PageHeader, EmptyState } from '@/components/daisy';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useActivityLog,
  formatActivityDescription,
  type ActivityRow,
} from '@/lib/queries/activities';
import {
  ACTOR_TYPE_OPTIONS,
  DEFAULT_FILTERS,
  ENTITY_TYPE_OPTIONS,
  RANGE_OPTIONS,
  buildActivityFilters,
  type ActivityPageFilters,
  type DateRangePreset,
} from './queries';
import type { ActorType } from '@/lib/queries/activities';

export default function ActivityPage() {
  const [filters, setFilters] = useState<ActivityPageFilters>(DEFAULT_FILTERS);
  const queryFilters = useMemo(() => buildActivityFilters(filters), [filters]);
  const activity = useActivityLog(queryFilters);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const rows = activity.data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <div className="flex flex-col gap-6">
        <PageHeader title="Activity log" subtitle="Every audit-logged action across the network." />

        <FilterBar filters={filters} onChange={setFilters} />

        {activity.isLoading ? (
          <p className="text-daisy-muted text-sm">Loading activity...</p>
        ) : activity.isError ? (
          <p className="text-daisy-orange text-sm">
            Failed to load activity: {activity.error.message}
          </p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ListTodo />}
            title="No activity yet"
            body="Audit rows show up here once HQ or franchisees act on the system."
          />
        ) : (
          <div className="border-daisy-line-soft bg-daisy-paper overflow-x-auto rounded-[12px] border">
            <table className="w-full text-left text-sm">
              <thead className="border-daisy-line-soft text-daisy-muted border-b text-xs tracking-wide uppercase">
                <tr>
                  <th className="w-8 px-3 py-3" aria-label="Expand" />
                  <th className="px-3 py-3">Time</th>
                  <th className="px-3 py-3">Actor</th>
                  <th className="px-3 py-3">Entity</th>
                  <th className="px-3 py-3">Description</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ActivityTableRow
                    key={row.id}
                    row={row}
                    expanded={expanded.has(row.id)}
                    onToggle={() => toggleExpanded(row.id)}
                  />
                ))}
              </tbody>
            </table>

            {activity.hasNextPage ? (
              <div className="border-daisy-line-soft bg-daisy-bg flex justify-center border-t px-4 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void activity.fetchNextPage()}
                  disabled={activity.isFetchingNextPage}
                >
                  {activity.isFetchingNextPage ? 'Loading...' : 'Load more'}
                </Button>
              </div>
            ) : null}
          </div>
        )}
    </div>
  );
}

interface FilterBarProps {
  filters: ActivityPageFilters;
  onChange: (next: ActivityPageFilters) => void;
}

function FilterBar({ filters, onChange }: FilterBarProps) {
  return (
    <div className="border-daisy-line-soft bg-daisy-paper mb-6 grid grid-cols-1 gap-3 rounded-[12px] border p-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-actor">Actor</Label>
        <select
          id="filter-actor"
          className="border-daisy-line text-daisy-ink focus-visible:border-daisy-primary h-10 rounded-[8px] border-2 bg-white px-3 text-sm focus-visible:outline-none"
          value={filters.actorType}
          onChange={(e) =>
            onChange({
              ...filters,
              actorType: e.target.value as ActorType | 'all',
            })
          }
        >
          {ACTOR_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-entity">Entity type</Label>
        <select
          id="filter-entity"
          className="border-daisy-line text-daisy-ink focus-visible:border-daisy-primary h-10 rounded-[8px] border-2 bg-white px-3 text-sm focus-visible:outline-none"
          value={filters.entityType}
          onChange={(e) =>
            onChange({
              ...filters,
              entityType: e.target.value,
            })
          }
        >
          {ENTITY_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-range">Date range</Label>
        <select
          id="filter-range"
          className="border-daisy-line text-daisy-ink focus-visible:border-daisy-primary h-10 rounded-[8px] border-2 bg-white px-3 text-sm focus-visible:outline-none"
          value={filters.range}
          onChange={(e) =>
            onChange({
              ...filters,
              range: e.target.value as DateRangePreset,
            })
          }
        >
          {RANGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-search">Search description</Label>
        <Input
          id="filter-search"
          placeholder="e.g. template, baby, paid"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
        />
      </div>
    </div>
  );
}

interface ActivityTableRowProps {
  row: ActivityRow;
  expanded: boolean;
  onToggle: () => void;
}

function ActivityTableRow({ row, expanded, onToggle }: ActivityTableRowProps) {
  const hasMetadata = row.metadata && Object.keys(row.metadata).length > 0;
  return (
    <>
      <tr
        className="border-daisy-line-soft hover:bg-daisy-bg cursor-pointer border-b"
        onClick={onToggle}
      >
        <td className="text-daisy-muted px-3 py-3">
          {hasMetadata ? (
            expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )
          ) : null}
        </td>
        <td className="text-daisy-ink px-3 py-3 whitespace-nowrap">
          {new Date(row.created_at).toLocaleString('en-GB', {
            timeZone: 'Europe/London',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </td>
        <td className="px-3 py-3">
          <Badge variant="default">{row.actor_type}</Badge>
        </td>
        <td className="text-daisy-ink-soft px-3 py-3">{row.entity_type}</td>
        <td className="text-daisy-ink px-3 py-3">{formatActivityDescription(row)}</td>
      </tr>
      {expanded && hasMetadata ? (
        <tr className="border-daisy-line-soft bg-daisy-bg border-b">
          <td className="px-3 py-3" />
          <td colSpan={4} className="px-3 py-3">
            <pre className="bg-daisy-ink/[0.04] text-daisy-ink-soft overflow-x-auto rounded-[8px] p-3 text-xs">
              {JSON.stringify(row.metadata, null, 2)}
            </pre>
          </td>
        </tr>
      ) : null}
    </>
  );
}
