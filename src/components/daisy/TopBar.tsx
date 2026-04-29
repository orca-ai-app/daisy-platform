import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface TopBarProps {
  /** Brand mark slot (left). Optional override; defaults to the Daisy mark. */
  brand?: ReactNode;
  /** Centre / right-of-brand navigation. Typically a list of <NavLink> rendered by the consumer. */
  nav?: ReactNode;
  /** Right-aligned actions slot (avatar, sign-out, etc). */
  actions?: ReactNode;
  className?: string;
}

/**
 * Sticky branded top bar. Used by HQLayout in M1 and re-used by the
 * franchisee shell in M2. The visual is locked to the daisy-flow
 * 03-hq-dashboard.html reference: Daisy primary blue (#006FAC) bar with
 * a Quicksand brand mark and pill-shaped nav links.
 */
export function TopBar({ brand, nav, actions, className }: TopBarProps) {
  return (
    <header
      data-daisy="TopBar"
      className={cn(
        'border-daisy-primary-deep bg-daisy-primary shadow-card sticky top-0 z-50 border-b text-white',
        className,
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-6 px-6">
        <div className="flex shrink-0 items-center">{brand ?? <DefaultBrand />}</div>
        {nav ? (
          <nav aria-label="Primary" className="flex flex-1 items-center gap-1 overflow-x-auto">
            {nav}
          </nav>
        ) : (
          <div className="flex-1" />
        )}
        {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}

function DefaultBrand() {
  return (
    <span
      className="font-display flex items-center gap-3 text-[26px] font-bold tracking-tight"
      data-daisy="TopBar.Brand"
    >
      <span aria-hidden className="bg-daisy-yellow inline-block h-3.5 w-3.5 rounded-full" />
      Daisy First Aid
    </span>
  );
}
