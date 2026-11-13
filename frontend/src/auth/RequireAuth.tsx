import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'

/** UX-only guard. Real authorization is enforced by the Django API on every request. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, restoring } = useAuth()
  const location = useLocation()
  if (restoring) return <div className="page-loading">Loading…</div>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <>{children}</>
}
