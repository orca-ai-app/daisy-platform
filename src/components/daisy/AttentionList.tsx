import { useNavigate } from 'react-router';
import { cn } from '@/lib/utils';

export type AttentionSeverity = 'red' | 'amber' | 'blue' | 'grey';

export interface AttentionItem {
  id: string;
  title: string;
  meta: string;
  count?: number;
  severity: AttentionSeverity;
  href?: string;
}

interface AttentionListProps {
  items: AttentionItem[];
  /** Rendered when items is empty. Defaults to a friendly Daisy-toned message. */
  empty?: React.ReactNode;
}

const dotClass: Record<AttentionSeverity, string> = {
  red: 'bg-daisy-red',
  amber: 'bg-daisy-amber',
  blue: 'bg-daisy-cyan',
  grey: 'bg-[#A0AEC0]',
};

/**
 * Severity-coded action queue. Matches the daisy-flow attention panel:
 * coloured 10px dot + 14px bold title + 12px muted meta + right-aligned
 * count badge. Dashed underline between rows. Whole row is clickable
 * when href is set.
 */
export function AttentionList({ items, empty }: AttentionListProps) {
  const navigate = useNavigate();

  if (items.length === 0) {
    return (
      <div data-daisy="AttentionList" className="text-daisy-muted px-4 py-10 text-center text-sm">
        {empty ?? 'Nothing needs your attention right now — quiet week, that.'}
      </div>
    );
  }

  return (
    <ul data-daisy="AttentionList" className="px-4 py-2">
      {items.map((item) => {
        const interactive = !!item.href;
        return (
          <li
            key={item.id}
            className={cn(
              'border-daisy-line flex items-start gap-3 border-b border-dashed py-3 last:border-b-0',
              interactive &&
                'hover:bg-daisy-primary-tint cursor-pointer rounded-[8px] transition-colors',
            )}
            onClick={interactive ? () => navigate(item.href!) : undefined}
            onKeyDown={
              interactive
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(item.href!);
                    }
                  }
                : undefined
            }
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
          >
            <span
              aria-hidden
              className={cn(
                'mt-[7px] inline-block h-[10px] w-[10px] shrink-0 rounded-full',
                dotClass[item.severity],
              )}
            />
            <div className="flex-1">
              <div className="text-daisy-ink text-[14px] font-bold">{item.title}</div>
              <div className="text-daisy-muted mt-[2px] text-[12px]">{item.meta}</div>
            </div>
            {item.count != null ? (
              <span className="bg-daisy-primary-soft text-daisy-primary-deep ml-auto inline-flex items-center rounded-full px-2 py-[2px] text-[12px] font-bold">
                {item.count}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
