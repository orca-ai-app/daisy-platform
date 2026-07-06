import { NavLink } from 'react-router';
import { cn } from '@/lib/utils';

interface EmailTab {
  to: string;
  label: string;
  end?: boolean;
}

const TABS: EmailTab[] = [
  { to: '/hq/emails', label: 'Journey', end: true },
  { to: '/hq/emails/broadcasts', label: 'Broadcasts' },
  { to: '/hq/emails/lists', label: 'Lists' },
  { to: '/hq/emails/media', label: 'Media' },
];

/**
 * Sub-navigation for the Emails section, shared across the Journey,
 * Broadcasts, Lists and Media pages. Pill links echo the topbar nav
 * treatment, adapted for the light page background.
 */
export function EmailSectionTabs() {
  return (
    <nav aria-label="Emails section" className="-mt-3 flex flex-wrap items-center gap-1.5">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              'inline-flex items-center rounded-full px-[14px] py-1.5 text-sm font-semibold transition-colors',
              isActive
                ? 'bg-daisy-primary text-white'
                : 'text-daisy-muted hover:bg-daisy-primary-tint hover:text-daisy-ink',
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
