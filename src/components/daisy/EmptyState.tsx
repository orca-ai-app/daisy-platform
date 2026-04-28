interface EmptyStateProps {
  title: string
  body?: string
  action?: React.ReactNode
}

export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-daisy-line p-10 text-center"
      data-daisy-stub="EmptyState"
    >
      <h2 className="font-display text-xl font-bold text-daisy-ink">{title}</h2>
      {body ? <p className="max-w-md text-sm text-daisy-muted">{body}</p> : null}
      {action}
    </div>
  )
}
