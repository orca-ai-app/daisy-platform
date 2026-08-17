import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';
import { Menu } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

export interface MobileNavItem {
  label: string;
  path: string;
  /** Optional icon. HQ nav has no icons; the drawer copes with either. */
  icon?: LucideIcon;
  /** `false` renders a disabled "Soon" row that does not navigate. */
  ready?: boolean;
  /** Highlight this item for any nested route under this prefix. */
  matchPrefix?: string;
}

interface MobileNavProps {
  items: MobileNavItem[];
  /** Shown at the top of the drawer, e.g. the signed-in person's name. */
  accountName?: string;
  accountEmail?: string;
  /** Rendered at the foot of the drawer, e.g. a sign-out button. */
  footer?: ReactNode;
  /** Accessible name for the drawer. Default "Menu". */
  title?: string;
}

/**
 * Phone navigation drawer (below `md`).
 *
 * Replaces the previous fixed bottom bar, which squeezed eleven items into
 * a 375px-wide strip at ~34px each — far under the 44px minimum touch target
 * and with labels clipped off the right edge (reported by a franchisee on a
 * real handset). A drawer lists every destination at full width with a
 * comfortable 48px row height, and scales to any number of items.
 *
 * Desktop is untouched: this whole component is `md:hidden` and the existing
 * top-bar pill nav still renders from `md` up.
 */
export function MobileNav({
  items,
  accountName,
  accountEmail,
  footer,
  title = 'Menu',
}: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Close the drawer on navigation so tapping a destination doesn't
  // leave the panel sitting over the page it just opened.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label="Open navigation menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="focus-visible:ring-daisy-yellow -mr-2 flex h-11 w-11 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:outline-none"
      >
        <Menu aria-hidden className="h-6 w-6" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          aria-describedby={accountEmail ? undefined : ''}
          className="gap-0 p-0"
        >
          <SheetHeader className="pr-16">
            <SheetTitle>{accountName?.trim() ? accountName : title}</SheetTitle>
            {accountEmail ? (
              <SheetDescription className="truncate">{accountEmail}</SheetDescription>
            ) : null}
          </SheetHeader>

          <nav aria-label="Primary" className="flex-1 overflow-y-auto py-2">
            <ul className="flex flex-col">
              {items.map((item) => {
                const Icon = item.icon;
                const isReady = item.ready !== false;
                const isActive = item.matchPrefix
                  ? location.pathname.startsWith(item.matchPrefix)
                  : location.pathname === item.path;

                if (!isReady) {
                  return (
                    <li key={item.path}>
                      <span
                        aria-disabled="true"
                        className="text-daisy-muted/50 flex min-h-12 cursor-not-allowed items-center gap-3 px-5 py-3 text-[15px] font-semibold select-none"
                      >
                        {Icon ? <Icon aria-hidden strokeWidth={1.5} className="h-5 w-5" /> : null}
                        <span className="flex-1">{item.label}</span>
                        <span className="font-display bg-daisy-line-soft text-daisy-muted rounded px-1.5 py-0.5 text-[10px] leading-none font-bold tracking-wide uppercase">
                          Soon
                        </span>
                      </span>
                    </li>
                  );
                }

                return (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      end={!item.matchPrefix}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'flex min-h-12 items-center gap-3 px-5 py-3 text-[15px] font-semibold transition-colors',
                        isActive
                          ? 'bg-daisy-primary-tint text-daisy-primary border-daisy-primary border-l-[3px] pl-[17px]'
                          : 'text-daisy-ink active:bg-daisy-line-soft',
                      )}
                    >
                      {Icon ? (
                        <Icon
                          aria-hidden
                          strokeWidth={isActive ? 2 : 1.5}
                          className={cn(
                            'h-5 w-5',
                            isActive ? 'text-daisy-primary' : 'text-daisy-muted',
                          )}
                        />
                      ) : null}
                      <span className="flex-1">{item.label}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </nav>

          {footer ? (
            <div
              className="border-daisy-line-soft border-t p-3"
              style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
            >
              {footer}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
