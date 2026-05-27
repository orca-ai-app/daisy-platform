/**
 * TanStack Query key factory for the franchisee portal.
 *
 * M1 used flat tuple keys namespaced by area, e.g. `['hq', 'network-stats']`
 * and `['hq', 'billing-run', id]`. This factory keeps that convention but
 * gives the franchisee side a single typed entry point so every hook derives
 * its key from here rather than hand-rolling string tuples. All keys are
 * rooted at `['franchisee', ...]` so they invalidate cleanly and never clash
 * with the HQ `['hq', ...]` keys.
 *
 * Wave 6 owns dashboard / profile / territories. The courses, bookings,
 * clients, discounts and payments entries are stubs for later M2 waves —
 * present now so those builders extend rather than redefine the factory.
 *
 * FROZEN CONTRACT (Wave 6 SCAFFOLD): builders import `franchiseeKeys` and
 * call these functions; do not invent parallel key shapes.
 */
export const franchiseeKeys = {
  /** Root key — invalidate to blow away the whole franchisee cache. */
  all: ['franchisee'] as const,

  // --- Wave 6 (live) ---------------------------------------------------
  dashboard: () => [...franchiseeKeys.all, 'dashboard'] as const,
  /** Dashboard KPI aggregate for the signed-in franchisee. */
  dashboardStats: () => [...franchiseeKeys.dashboard(), 'stats'] as const,

  profile: () => [...franchiseeKeys.all, 'profile'] as const,

  territories: () => [...franchiseeKeys.all, 'territories'] as const,

  // --- Later M2 waves (stubs) -----------------------------------------
  courses: () => [...franchiseeKeys.all, 'courses'] as const,
  course: (id: string) => [...franchiseeKeys.courses(), id] as const,

  bookings: () => [...franchiseeKeys.all, 'bookings'] as const,
  booking: (id: string) => [...franchiseeKeys.bookings(), id] as const,

  clients: () => [...franchiseeKeys.all, 'clients'] as const,
  client: (id: string) => [...franchiseeKeys.clients(), id] as const,

  discounts: () => [...franchiseeKeys.all, 'discounts'] as const,
  discount: (id: string) => [...franchiseeKeys.discounts(), id] as const,

  payments: () => [...franchiseeKeys.all, 'payments'] as const,
  payment: (id: string) => [...franchiseeKeys.payments(), id] as const,
} as const;
