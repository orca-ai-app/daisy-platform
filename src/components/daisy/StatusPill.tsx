type Status =
  | 'active'
  | 'paid'
  | 'pending'
  | 'overdue'
  | 'vacant'
  | 'cancelled'
  | 'unknown'

interface StatusPillProps {
  status: Status | string
  children?: React.ReactNode
}

export function StatusPill({ status, children }: StatusPillProps) {
  return (
    <span
      className="inline-block rounded-full bg-daisy-line-soft px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-daisy-ink-soft"
      data-daisy-stub="StatusPill"
      data-status={status}
    >
      {children ?? status}
    </span>
  )
}
