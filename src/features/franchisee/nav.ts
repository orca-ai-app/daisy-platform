import {
  LayoutDashboard,
  Map,
  GraduationCap,
  CalendarCheck,
  Users,
  UserCheck,
  Percent,
  CreditCard,
  UserCog,
  CircleHelp,
  type LucideIcon,
} from 'lucide-react';

/**
 * Single source of truth for the franchisee portal's primary navigation.
 *
 * Wave 6 (M2) ships Dashboard, Profile and Territories as real routes;
 * the remaining links (Courses, Bookings, Clients, Discounts, Payments)
 * are declared here so the shell's nav is complete from day one. Until a
 * later wave wires their routes in App.tsx, those paths fall through to the
 * catch-all and redirect — set `ready: false` so the layout can render them
 * disabled / "coming soon" if it chooses. The builders decide presentation;
 * this array is just the data.
 */
export interface FranchiseeNavLink {
  label: string;
  path: string;
  icon: LucideIcon;
  /**
   * `true` once the route exists in App.tsx. Wave 6 routes are ready;
   * later-wave routes are flagged `false` until their wave lands.
   */
  ready: boolean;
  /** Highlight this nav item for any nested route under this prefix. */
  matchPrefix?: string;
}

export const franchiseeNavLinks: FranchiseeNavLink[] = [
  {
    label: 'Dashboard',
    path: '/franchisee/dashboard',
    icon: LayoutDashboard,
    ready: true,
  },
  {
    label: 'Territories',
    path: '/franchisee/territories',
    icon: Map,
    ready: true,
    matchPrefix: '/franchisee/territories',
  },
  {
    label: 'Courses',
    path: '/franchisee/courses',
    icon: GraduationCap,
    ready: true,
    matchPrefix: '/franchisee/courses',
  },
  {
    label: 'Bookings',
    path: '/franchisee/bookings',
    icon: CalendarCheck,
    ready: true,
    matchPrefix: '/franchisee/bookings',
  },
  {
    label: 'Clients',
    path: '/franchisee/clients',
    icon: Users,
    ready: true,
    matchPrefix: '/franchisee/clients',
  },
  {
    label: 'Customers',
    path: '/franchisee/customers',
    icon: UserCheck,
    ready: true,
    matchPrefix: '/franchisee/customers',
  },
  {
    label: 'Discounts',
    path: '/franchisee/discounts',
    icon: Percent,
    ready: true,
    matchPrefix: '/franchisee/discounts',
  },
  {
    label: 'Payments',
    path: '/franchisee/payments',
    icon: CreditCard,
    ready: true,
    matchPrefix: '/franchisee/payments',
  },
  {
    label: 'Profile',
    path: '/franchisee/profile',
    icon: UserCog,
    ready: true,
  },
  {
    label: 'Help',
    path: '/franchisee/help',
    icon: CircleHelp,
    ready: true,
    matchPrefix: '/franchisee/help',
  },
];
