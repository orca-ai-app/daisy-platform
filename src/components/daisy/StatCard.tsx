interface StatCardProps {
  label?: string
  value?: string | number
  delta?: string
}

export function StatCard({ label, value, delta }: StatCardProps) {
  return (
    <div
      className="rounded-[12px] border border-daisy-line-soft bg-daisy-paper p-5 shadow-card"
      data-daisy-stub="StatCard"
    >
      <div className="text-xs font-bold uppercase tracking-wide text-daisy-muted">
        {label ?? '—'}
      </div>
      <div className="font-display text-3xl font-bold text-daisy-ink">
        {value ?? '—'}
      </div>
      {delta ? (
        <div className="text-xs text-daisy-muted">{delta}</div>
      ) : null}
    </div>
  )
}
