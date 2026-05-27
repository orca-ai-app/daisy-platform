import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useRole } from './RoleContext';

interface RequireRoleProps {
  /**
   * Require the user to be an HQ admin. Non-HQ users (franchisees) are
   * redirected to `/franchisee/dashboard`. This protects every `/hq/*` route.
   */
  hq?: boolean;
  /**
   * Require the user to be a franchisee. HQ users are redirected to
   * `/hq/dashboard`. This protects every `/franchisee/*` route.
   */
  franchisee?: boolean;
  children: ReactNode;
}

/**
 * Route guard. Three failure paths:
 *
 * 1. Not authenticated  → `/login`
 * 2. Authenticated but not provisioned (no franchisee row, not HQ)
 *    → `/unauthorized`
 * 3. Wrong role for the route:
 *    - HQ-only route (`hq` prop) visited by a franchisee → `/franchisee/dashboard`
 *    - Franchisee-only route (`franchisee` prop) visited by HQ → `/hq/dashboard`
 *
 * The redirects in case 3 are intentionally concrete paths, not just the
 * parent segment, so React Router never resolves a layout-only index.
 *
 * HQ behaviour (unchanged from M1):
 *   <RequireRole hq> on `/hq/*` routes blocks franchisees and redirects them
 *   to their own dashboard. An HQ user hitting a franchisee-only route is
 *   similarly redirected to their dashboard.
 *
 * Franchisee hardening (Wave 6A):
 *   <RequireRole franchisee> on `/franchisee/*` routes ensures an HQ user who
 *   navigates to a franchisee URL is sent to `/hq/dashboard` rather than
 *   seeing franchisee UI. Combined with <RequireRole hq> on HQ routes, this
 *   gives a complete bidirectional role fence.
 */
export function RequireRole({ hq, franchisee, children }: RequireRoleProps) {
  const { user, isHQ, notProvisioned, isLoading } = useRole();

  if (isLoading) {
    return (
      <div className="text-daisy-muted flex min-h-screen items-center justify-center">Loading…</div>
    );
  }

  // Not signed in — send to login regardless of which route was attempted.
  if (!user) return <Navigate to="/login" replace />;

  // Signed in but no provisioned role — friendly error screen.
  if (notProvisioned) return <Navigate to="/unauthorized" replace />;

  // HQ-only route accessed by a franchisee → franchisee dashboard.
  if (hq && !isHQ) return <Navigate to="/franchisee/dashboard" replace />;

  // Franchisee-only route accessed by an HQ admin → HQ dashboard.
  if (franchisee && isHQ) return <Navigate to="/hq/dashboard" replace />;

  return <>{children}</>;
}
