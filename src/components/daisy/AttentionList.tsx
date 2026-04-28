interface AttentionItem {
  id: string
  label: string
  count?: number
}

interface AttentionListProps {
  items?: AttentionItem[]
}

export function AttentionList({ items = [] }: AttentionListProps) {
  return (
    <ul
      className="flex flex-col gap-2"
      data-daisy-stub="AttentionList"
    >
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-center justify-between rounded-[8px] border border-daisy-line-soft p-3"
        >
          <span className="text-sm text-daisy-ink">{item.label}</span>
          {item.count != null ? (
            <span className="text-xs font-bold text-daisy-muted">{item.count}</span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
