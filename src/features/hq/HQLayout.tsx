import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { LogOut } from 'lucide-react';
import { TopBar } from '@/components/daisy';
import { useRole } from '@/features/auth/RoleContext';
import { getInitials } from '@/utils/initials';
import { cn } from '@/lib/utils';

interface HQNavItem {
  to: string;
  label: string;
  /** Allow the topbar to highlight a nav item for any nested route under a parent. */
  matchPrefix?: string;
}

const HQ_NAV: HQNavItem[] = [
  { to: '/hq/dashboard', label: 'Dashboard' },
  { to: '/hq/franchisees', label: 'Franchisees', matchPrefix: '/hq/franchisees' },
  { to: '/hq/territories', label: 'Territories' },
  { to: '/hq/courses', label: 'Courses', matchPrefix: '/hq/courses' },
  { to: '/hq/bookings', label: 'Bookings' },
  { to: '/hq/billing', label: 'Billing' },
  { to: '/hq/activity', label: 'Activity' },
];

/**
 * Sticky-topbar shell shared across every /hq/* route. Visual reference:
 * daisy-flow/03-hq-dashboard.html. Renders the route content into the
 * <Outlet /> inside a 1240px-max-width main with the standard padding.
 */
export function HQLayout() {
  const { franchisee, user, signOut } = useRole();
  const initials = getInitials(franchisee?.name ?? user?.email ?? null);

  return (
    <div className="bg-daisy-bg min-h-screen">
      <TopBar
        nav={
          <ul className="flex items-center gap-1">
            {HQ_NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
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

      <main className="mx-auto max-w-[1240px] px-10 pt-14 pb-24">
        <Outlet />
      </main>
    </div>
  );
}

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

export default HQLayout;
