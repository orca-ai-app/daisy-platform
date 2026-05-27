import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { LogOut } from 'lucide-react';
import { ErrorBoundary } from 'react-error-boundary';
import { TopBar } from '@/components/daisy';
import { ErrorFallback } from '@/components/error-boundary/ErrorFallback';
import { useRole } from '@/features/auth/RoleContext';
import { getInitials } from '@/utils/initials';
import { cn } from '@/lib/utils';
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
          title={`${item.label} — coming soon`}
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

// ─── Mobile bottom-nav bar ────────────────────────────────────────────────────

/**
 * Phone-first bottom navigation. Visible only below the `md` breakpoint
 * (hidden via `md:hidden`).
 *
 * Layout decisions (record for DECISIONS.md):
 * - Fixed to the bottom of the viewport for thumb reach on all screen sizes.
 * - `pb-safe` adds `env(safe-area-inset-bottom)` for notched/home-bar devices.
 *   Implemented via an inline style because Tailwind v3 does not ship a
 *   `pb-safe` utility out of the box without a plugin.
 * - Active item: Daisy primary blue icon + label, with a yellow dot under
 *   the icon — carries the brand's yellow-dot accent motif.
 * - Not-ready items: greyed out, pointer-events-none, no NavLink rendered.
 * - `<main>` receives a `pb-28` override on mobile so content never sits
 *   behind the fixed bar. 112 px > the bar's ~64 px + breathing room.
 */
function BottomNav() {
  const location = useLocation();

  return (
    <nav
      aria-label="Mobile navigation"
      className="border-daisy-line bg-daisy-paper shadow-lift fixed right-0 bottom-0 left-0 z-40 border-t md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <ul className="flex items-stretch">
        {franchiseeNavLinks.map((item) => {
          const Icon = item.icon;

          const isActive = item.matchPrefix
            ? location.pathname.startsWith(item.matchPrefix)
            : location.pathname === item.path;

          if (!item.ready) {
            return (
              <li key={item.path} className="flex flex-1">
                <span
                  aria-disabled="true"
                  title={`${item.label} — coming soon`}
                  className="flex flex-1 cursor-not-allowed flex-col items-center justify-center gap-0.5 py-2 select-none"
                >
                  <Icon aria-hidden strokeWidth={1.5} className="text-daisy-muted/30 h-5 w-5" />
                  <span className="text-daisy-muted/30 text-[10px] leading-none font-semibold">
                    {item.label}
                  </span>
                </span>
              </li>
            );
          }

          return (
            <li key={item.path} className="flex flex-1">
              <NavLink
                to={item.path}
                end={!item.matchPrefix}
                aria-current={isActive ? 'page' : undefined}
                className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 transition-colors"
              >
                {/* Icon with yellow dot below when active */}
                <span className="relative flex h-7 w-7 items-center justify-center">
                  <Icon
                    aria-hidden
                    strokeWidth={isActive ? 2 : 1.5}
                    className={cn(
                      'h-5 w-5 transition-colors',
                      isActive ? 'text-daisy-primary' : 'text-daisy-muted',
                    )}
                  />
                  {isActive && (
                    <span
                      aria-hidden
                      className="bg-daisy-yellow absolute bottom-0 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full"
                    />
                  )}
                </span>
                <span
                  className={cn(
                    'text-[10px] leading-none font-semibold',
                    isActive ? 'text-daisy-primary' : 'text-daisy-muted',
                  )}
                >
                  {item.label}
                </span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
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
 *   TopBar shows only the brand mark + avatar (nav links hidden via md:flex).
 *   A fixed bottom-nav bar provides thumb-friendly primary navigation.
 *   `<main>` uses pb-28 on mobile (112px) to ensure content clears the bar.
 *
 * Not-ready links:
 *   Rendered disabled on both surfaces — no NavLink, no navigation. Desktop
 *   shows a "Soon" badge; mobile dims the icon/label.
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
          // Below md the nav links move to BottomNav; hide them in the TopBar.
          <ul className="hidden items-center gap-1 md:flex">
            {franchiseeNavLinks.map((item) => (
              <TopBarNavItem key={item.path} item={item} />
            ))}
          </ul>
        }
        actions={
          <UserMenu
            initials={initials}
            name={franchisee?.name ?? user?.email ?? 'Signed in'}
            email={user?.email ?? ''}
            onSignOut={() => void signOut()}
          />
        }
      />

      {/*
        Content container.

        pb-28 (112px) on mobile gives clearance over the ~64px bottom-nav
        plus breathing room. md:pb-24 reverts to the standard HQ value on
        larger screens where there is no bottom bar.

        px-4 on mobile → sm:px-6 → md:px-10 matches the standard responsive
        content padding without causing horizontal scroll on narrow viewports.
      */}
      <main className="mx-auto max-w-[1240px] px-4 pt-8 pb-28 sm:px-6 md:px-10 md:pt-14 md:pb-24">
        <ErrorBoundary
          FallbackComponent={ErrorFallback}
          resetKeys={[location.pathname]}
          onError={(err) => {
            console.error('FranchiseeLayout caught route error:', err);
          }}
        >
          <Outlet />
        </ErrorBoundary>
      </main>

      {/* Bottom navigation — rendered in DOM always, hidden via CSS on desktop */}
      <BottomNav />

      <DevRoleSwitch />
    </div>
  );
}

export default FranchiseeLayout;
