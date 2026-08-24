import { useMemo, useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface DataTableProps<TRow> {
  columns: ColumnDef<TRow>[];
  data: TRow[];
  isLoading?: boolean;
  emptyState?: ReactNode;
  onRowClick?: (row: TRow) => void;
  /** Visible search input above the table. Default true. */
  searchable?: boolean;
  /** Placeholder for the search input. */
  searchPlaceholder?: string;
  /** Initial page size. Default 20. */
  pageSize?: number;
  className?: string;
  /**
   * Optional controlled search value. When supplied, the parent owns the
   * search state (useful when the same query needs to filter both the
   * table and a sibling component like a map).
   */
  searchValue?: string;
  /** Called when the user types in the search input (controlled mode). */
  onSearchChange?: (value: string) => void;
}

/**
 * Daisy-styled wrapper around TanStack Table v8.
 *
 * - Visual sorting indicators in the header (▲/▼).
 * - Top-of-table search input doing a global filter across visible cell text.
 * - Pagination at 20 rows per page by default.
 * - Loading state renders skeleton rows.
 * - Empty state renders the slot when there are zero rows after filtering.
 *
 * Match `.fr-table` from daisy-flow/styles/daisy.css: 14px row font,
 * 12px uppercase header, hover bg-daisy-primary-tint, dashed bottom border.
 */
export function DataTable<TRow>({
  columns,
  data,
  isLoading = false,
  emptyState,
  onRowClick,
  searchable = true,
  searchPlaceholder = 'Search…',
  pageSize = 20,
  className,
  searchValue,
  onSearchChange,
}: DataTableProps<TRow>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [internalFilter, setInternalFilter] = useState('');
  const isControlled = searchValue !== undefined;
  const globalFilter = isControlled ? searchValue : internalFilter;
  const setGlobalFilter = isControlled ? (v: string) => onSearchChange?.(v) : setInternalFilter;

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: (updater) => {
      const next = typeof updater === 'function' ? updater(globalFilter) : updater;
      setGlobalFilter(next);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const rows = table.getRowModel().rows;
  const showEmpty = !isLoading && rows.length === 0;

  // Skeleton row placeholders match the column count so the layout
  // doesn't jump when real data arrives.
  const skeletonRows = useMemo(() => Array.from({ length: Math.min(pageSize, 6) }), [pageSize]);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {searchable ? (
        <div className="flex items-center justify-between gap-3">
          <div className="relative max-w-sm flex-1">
            <Input
              type="search"
              value={globalFilter ?? ''}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-11 rounded-full pl-4 text-[16px] md:h-9 md:text-sm"
              aria-label="Search table"
            />
          </div>
          <div className="text-daisy-muted text-xs font-semibold">
            {table.getFilteredRowModel().rows.length} result
            {table.getFilteredRowModel().rows.length === 1 ? '' : 's'}
          </div>
        </div>
      ) : null}

      {/*
        Phone layout (< md): each row becomes a stacked card with the column
        header as an inline label. A horizontally scrolling grid is unreadable
        at 375px — columns collapse to one word per line — so the same row data
        is re-flowed vertically instead. Desktop (>= md) renders the original
        table untouched.
      */}
      <div className="flex flex-col gap-3 md:hidden">
        {isLoading
          ? skeletonRows.map((_, i) => (
              <div
                key={`sk-card-${i}`}
                className="border-daisy-line-soft bg-daisy-paper shadow-card flex flex-col gap-2 rounded-[12px] border p-4"
              >
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-1/3" />
              </div>
            ))
          : rows.map((row) => {
              const cells = row.getVisibleCells();
              return (
                <div
                  key={row.id}
                  role={onRowClick ? 'button' : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onRowClick(row.original);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    'border-daisy-line-soft bg-daisy-paper shadow-card flex flex-col gap-2 rounded-[12px] border p-4 text-[14px]',
                    onRowClick &&
                      'active:bg-daisy-primary-tint focus-visible:ring-daisy-primary cursor-pointer focus-visible:ring-2 focus-visible:outline-none',
                  )}
                >
                  {cells.map((cell) => {
                    const header = cell.column.columnDef.header;
                    // Only string headers make sensible inline labels; a
                    // custom header node (sort button, checkbox) is skipped.
                    const meta = cell.column.columnDef.meta as { mobileLabel?: string } | undefined;
                    const label = typeof header === 'string' ? header : (meta?.mobileLabel ?? null);
                    return (
                      <div
                        key={cell.id}
                        className="flex items-start justify-between gap-3 first:items-center"
                      >
                        {label ? (
                          <span className="text-daisy-muted shrink-0 text-[11px] font-bold tracking-wider uppercase">
                            {label}
                          </span>
                        ) : null}
                        <span
                          className={cn(
                            'text-daisy-ink min-w-0 break-words',
                            label ? 'text-right' : 'flex-1',
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}

        {showEmpty ? (
          <div className="border-daisy-line-soft bg-daisy-paper shadow-card rounded-[12px] border p-4">
            {emptyState ?? (
              <div className="text-daisy-muted py-10 text-center text-sm">No rows.</div>
            )}
          </div>
        ) : null}
      </div>

      <div className="border-daisy-line-soft bg-daisy-paper shadow-card hidden overflow-hidden rounded-[12px] border md:block">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sorted = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        className={cn(
                          'border-daisy-line-soft text-daisy-muted border-b px-3 py-2.5 text-left text-[11px] font-bold tracking-wider whitespace-nowrap uppercase',
                          canSort && 'cursor-pointer select-none',
                        )}
                        onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort ? (
                          <span
                            aria-hidden
                            className="text-daisy-primary ml-1 inline-block text-[10px]"
                          >
                            {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : '▲▼'}
                          </span>
                        ) : null}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {isLoading
                ? skeletonRows.map((_, i) => (
                    <tr key={`sk-${i}`} className="border-daisy-line border-b border-dashed">
                      {columns.map((_col, j) => (
                        <td key={j} className="px-3 py-2.5">
                          <Skeleton className="h-4 w-full max-w-[140px]" />
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map((row) => (
                    <tr
                      key={row.id}
                      className={cn(
                        'border-daisy-line border-b border-dashed transition-colors last:border-b-0',
                        onRowClick && 'hover:bg-daisy-primary-tint cursor-pointer',
                      )}
                      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="text-daisy-ink px-3 py-2.5 align-middle">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        {showEmpty ? (
          <div className="border-daisy-line-soft border-t p-4">
            {emptyState ?? (
              <div className="text-daisy-muted py-10 text-center text-sm">No rows.</div>
            )}
          </div>
        ) : null}
      </div>

      {table.getPageCount() > 1 ? (
        <div className="text-daisy-muted flex items-center justify-between text-xs">
          <div>
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-11 px-4 md:h-9 md:px-3"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-11 px-4 md:h-9 md:px-3"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
