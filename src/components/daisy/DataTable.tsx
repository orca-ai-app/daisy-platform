interface DataTableProps<T> {
  rows?: T[]
  empty?: React.ReactNode
}

export function DataTable<T>({ rows = [], empty }: DataTableProps<T>) {
  if (rows.length === 0) {
    return <div data-daisy-stub="DataTable">{empty ?? 'No rows yet.'}</div>
  }
  return (
    <div
      className="rounded-[12px] border border-daisy-line-soft bg-daisy-paper p-4"
      data-daisy-stub="DataTable"
    >
      {/* Wave 2 wires TanStack Table here */}
      {rows.length} rows
    </div>
  )
}
