import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { useRole } from './RoleContext'

interface RequireRoleProps {
  hq?: boolean
  franchisee?: boolean
  children: ReactNode
}

/**
 * Route guard. Redirects to /login if not signed in,
 * /unauthorized if no franchisee row, or to the matching
 * dashboard if the role doesn't match the route.
 */
export function RequireRole({ hq, franchisee, children }: RequireRoleProps) {
  const { user, isHQ, notProvisioned, isLoading } = useRole()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-daisy-muted">
        Loading…
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  if (notProvisioned) return <Navigate to="/unauthorized" replace />

  if (hq && !isHQ) return <Navigate to="/franchisee/dashboard" replace />
  if (franchisee && isHQ) return <Navigate to="/hq/dashboard" replace />

  return <>{children}</>
}
