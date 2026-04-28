interface TopBarProps {
  email?: string | null
  children?: React.ReactNode
}

export function TopBar({ email, children }: TopBarProps) {
  return (
    <header
      className="sticky top-0 z-50 flex items-center justify-between border-b border-daisy-primary-deep bg-daisy-primary px-6 py-4 text-white"
      data-daisy-stub="TopBar"
    >
      <div className="flex items-center gap-3 font-display text-2xl font-bold">
        <span className="inline-block h-3.5 w-3.5 rounded-full bg-daisy-yellow" />
        Daisy
      </div>
      <nav className="flex items-center gap-3">{children}</nav>
      {email ? (
        <div className="text-sm font-semibold opacity-90">{email}</div>
      ) : null}
    </header>
  )
}
