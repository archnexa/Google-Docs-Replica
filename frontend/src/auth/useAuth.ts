import { createContext, useContext } from 'react'
import type { User } from '../api/types'

export interface AuthState {
  user: User | null
  /** true while restoring a session from a stored token */
  restoring: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  /** Session ended server-side (expired / revoked token). */
  expire: () => void
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
