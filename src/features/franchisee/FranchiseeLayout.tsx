import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { LogOut } from 'lucide-react';
import { ErrorBoundary } from 'react-error-boundary';
import { TopBar, MobileNav } from '@/components/daisy';
import { ErrorFallback } from '@/components/error-boundary/ErrorFallback';
import { useRole } from '@/features/auth/RoleContext';
import { getInitials } from '@/utils/initials';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { DevRoleSwitch } from './DevRoleSwitch';
import { franchiseeNavLinks } from './nav';
import type { FranchiseeNavLink } from './nav';

// ─── Desktop top-bar nav ──────────────────────────────────────────────────────

/**
 * A single item in the desktop top-bar nav.
 *
 * Ready links use NavLink for full router active-state support.
 * Not-ready links render as a disabled span with a "Soon" badge so
 * franchisees can see upcoming features without any navigation firing.
 */
function TopBarNavItem({ item }: { item: FranchiseeNavLink }) {
  if (!item.ready) {
    return (
      <li>
        <span
          aria-disabled="true"
          title={`${item.label} - coming soon`}
          className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full px-[14px] py-2 text-sm font-semibold text-white/40 select-none"
        >
          {item.label}
          <span className="font-display rounded bg-white/10 px-1.5 py-0.5 text-[10px] leading-none font-bold tracking-wide text-white/50 uppercase">
            Soon
          </span>
        </span>
      </li>
    );
  }

  return (
    <li>
      <NavLink
        to={item.path}
        end={!item.matchPrefix}
        className={({ isActive }) =>
          cn(
            'inline-flex items-center rounded-full px-[14px] py-2 text-sm font-semibold transition-colors',
            isActive
              ? 'bg-white/15 text-white'
              : 'text-white/85 hover:bg-white/10 hover:text-white',
          )
        }
      >
        {item.label}
      </NavLink>
    </li>
  );
}

// ─── User avatar + dropdown ───────────────────────────────────────────────────

interface UserMenuProps {
  initials: string;
  name: string;
  email: string;
  onSignOut: () => void;
}

function UserMenu({ initials, name, email, onSignOut }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="User menu"
        onClick={() => setOpen((v) => !v)}
        className="focus-visible:ring-daisy-yellow flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-sm font-bold text-white transition-colors hover:bg-white/25 focus-visible:ring-2 focus-visible:outline-none"
      >
        {initials}
      </button>
      {open ? (
        <div
          role="menu"
          className="border-daisy-line-soft bg-daisy-paper text-daisy-ink shadow-lift absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-[12px] border"
        >
          <div className="border-daisy-line-soft border-b px-4 py-3">
            <div className="text-sm leading-tight font-bold">{name}</div>
            {email ? <div className="text-daisy-muted truncate text-xs">{email}</div> : null}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className="text-daisy-ink hover:bg-daisy-primary-tint flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold"
          >
            <LogOut aria-hidden className="h-4 w-4" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────

/**
 * Franchisee portal shell (Wave 6A, M2).
 *
 * Desktop (≥ md):
 *   Sticky TopBar with full pill nav + avatar dropdown. Content centred at
 *   1240px max-width with standard HQ-matching padding (px-10, pt-14, pb-24).
 *
 * Mobile (< md):
 *   TopBar shows the brand mark, the avatar and a hamburger that opens a
 *   slide-out drawer listing every destination at a 48px row height.
 *
 *   This replaced a fixed bottom bar that split eleven items across a 375px
 *   viewport (~34px each, labels clipped off-screen) — a franchisee reported
 *   the icons as "very small and hard to read/touch" on a real handset. A
 *   drawer does not degrade as items are added.
 *
 * Not-ready links:
 *   Rendered disabled on both surfaces — no NavLink, no navigation. Both the
 *   desktop pill and the drawer row show a "Soon" badge.
 *
 * Error boundary:
 *   Wraps <Outlet> so a thrown page error shows the friendly fallback while
 *   keeping navigation chrome usable.
 */
export function FranchiseeLayout() {
  const { franchisee, user, signOut } = useRole();
  const initials = getInitials(franchisee?.name ?? user?.email ?? null);
  const location = useLocation();

  return (
    <div className="bg-daisy-bg min-h-screen">
      <TopBar
        nav={
          // Below md the nav links move into the drawer; hide them here.
          <ul className="hidden items-center gap-1 md:flex">
            {franchiseeNavLinks.map((item) => (
              <TopBarNavItem key={item.path} item={item} />
            ))}
          </ul>
        }
        actions={
          <>
            <UserMenu
              initials={initials}
              name={franchisee?.name ?? user?.email ?? 'Signed in'}
              email={user?.email ?? ''}
              onSignOut={() => void signOut()}
            />
            <MobileNav
              items={franchiseeNavLinks}
              accountName={franchisee?.name ?? user?.email ?? 'Signed in'}
              accountEmail={user?.email ?? ''}
              footer={
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="text-daisy-ink hover:bg-daisy-line-soft flex min-h-11 w-full items-center gap-2 rounded-[8px] px-4 py-3 text-left text-sm font-semibold"
                >
                  <LogOut aria-hidden className="h-4 w-4" />
                  Sign out
                </button>
              }
            />
          </>
        }
      />

      {/*
        Content container.

        The bottom nav is gone, so mobile no longer needs the 112px cleared
        for it; pb-16 is ordinary breathing room. md:pb-24 keeps the standard
        HQ value on larger screens.

        px-4 on mobile → sm:px-6 → md:px-10 matches the standard responsive
        content padding without causing horizontal scroll on narrow viewports.
      */}
      <main className="mx-auto max-w-[1240px] px-4 pt-8 pb-16 sm:px-6 md:px-10 md:pt-14 md:pb-24">
        <ErrorBoundary
          FallbackComponent={ErrorFallback}
          resetKeys={[location.pathname]}
          onError={(err) => {
            // Ship through the browser logger so route errors reach
            // da_system_logs as well as the console.
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`Franchisee route error: ${message}`, {
              route: location.pathname,
            });
          }}
        >
          <Outlet />
        </ErrorBoundary>
      </main>

      <DevRoleSwitch />
    </div>
  );
}

export default FranchiseeLayout;
