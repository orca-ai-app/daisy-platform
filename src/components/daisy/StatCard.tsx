import type { ComponentType, ReactNode, SVGProps } from 'react';
import { cn } from '@/lib/utils';

export type StatDeltaTone = 'up' | 'down' | 'flat';

interface StatCardProps {
  /** Uppercase label (e.g. "Bookings this month"). */
  label: string;
  /** Primary value. Pre-formatted strings preferred (e.g. "£12,345.67", "8/10"). */
  value: ReactNode;
  /** Secondary delta or supporting copy. */
  delta?: ReactNode;
  /** Tone for the delta line. Default = up. */
  tone?: StatDeltaTone;
  /** Optional lucide-react icon component rendered top-right. */
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  className?: string;
}

const toneClass: Record<StatDeltaTone, string> = {
  up: 'text-[#2F6F4F]',
  down: 'text-[#8A2A2A]',
  flat: 'text-daisy-muted',
};

/**
 * KPI tile. Mirrors the visual from daisy-flow/03-hq-dashboard.html:
 * 18px padding, line-soft border, card shadow, 30px Quicksand value,
 * 12px uppercase tracked label, 13px coloured delta.
 */
export function StatCard({
  label,
  value,
  delta,
  tone = 'up',
  icon: Icon,
  className,
}: StatCardProps) {
  return (
    <div
      data-daisy="StatCard"
      className={cn(
        'border-daisy-line-soft bg-daisy-paper shadow-card relative flex flex-col gap-2 rounded-[12px] border px-5 py-[18px]',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-daisy-muted text-[12px] font-bold tracking-[0.08em] uppercase">
          {label}
        </span>
        {Icon ? <Icon className="text-daisy-muted h-4 w-4" aria-hidden /> : null}
      </div>
      <div className="font-display text-daisy-ink text-[30px] leading-tight font-bold tracking-tight">
        {value}
      </div>
      {delta != null ? (
        <div
          className={cn(
            'mt-1 inline-flex items-center gap-1 text-[13px] font-bold',
            toneClass[tone],
          )}
        >
          {delta}
        </div>
      ) : null}
    </div>
  );
}
