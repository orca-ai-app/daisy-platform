interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header
      className="flex flex-col gap-2 pb-6 sm:flex-row sm:items-center sm:justify-between"
      data-daisy-stub="PageHeader"
    >
      <div>
        <h1 className="font-display text-3xl font-bold text-daisy-ink">{title}</h1>
        {subtitle ? <p className="text-sm text-daisy-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  )
}
