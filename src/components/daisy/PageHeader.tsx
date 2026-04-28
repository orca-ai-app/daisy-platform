import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: ReactNode;
  /** Secondary line below the title. Plain string or rich node. */
  subtitle?: ReactNode;
  /** Breadcrumb trail rendered above the title. */
  breadcrumb?: ReactNode;
  /** Right-aligned actions (buttons, search, etc). */
  actions?: ReactNode;
  className?: string;
}

/**
 * Standard page header. Used by every HQ route for a consistent
 * top-of-page layout: optional breadcrumb, large title, optional
 * subtitle, optional actions slot to the right.
 */
export function PageHeader({ title, subtitle, breadcrumb, actions, className }: PageHeaderProps) {
  return (
    <header
      data-daisy="PageHeader"
      className={cn(
        'flex flex-col gap-3 pb-6 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        {breadcrumb ? (
          <div className="text-daisy-muted text-[12px] font-semibold tracking-[0.08em] uppercase">
            {breadcrumb}
          </div>
        ) : null}
        <h1 className="font-display text-daisy-ink text-[24px] leading-tight font-extrabold tracking-tight sm:text-[28px]">
          {title}
        </h1>
        {subtitle ? <p className="text-daisy-muted text-[14px]">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
