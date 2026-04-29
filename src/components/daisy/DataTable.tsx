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
}: DataTableProps<TRow>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
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
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 rounded-full pl-4"
              aria-label="Search table"
            />
          </div>
          <div className="text-daisy-muted text-xs font-semibold">
            {table.getFilteredRowModel().rows.length} result
            {table.getFilteredRowModel().rows.length === 1 ? '' : 's'}
          </div>
        </div>
      ) : null}

      <div className="border-daisy-line-soft bg-daisy-paper shadow-card overflow-hidden rounded-[12px] border">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[14px]">
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
                          'border-daisy-line-soft text-daisy-muted border-b px-4 py-3 text-left text-[12px] font-bold tracking-wider whitespace-nowrap uppercase',
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
                        <td key={j} className="px-4 py-3.5">
                          <Skeleton className="h-4 w-full max-w-[160px]" />
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
                        <td key={cell.id} className="text-daisy-ink px-4 py-3.5">
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
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
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
