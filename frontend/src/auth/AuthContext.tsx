import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getToken, setToken, setUnauthorizedHandler } from '../api/client'
import { api } from '../api/endpoints'
import type { User } from '../api/types'
import { AuthContext } from './useAuth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [restoring, setRestoring] = useState(() => getToken() !== null)

  const expire = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(expire)
    return () => setUnauthorizedHandler(null)
  }, [expire])

  useEffect(() => {
    if (!getToken()) return
    let cancelled = false
    api
      .me()
      .then((u) => !cancelled && setUser(u))
      .catch(() => {
        /* 401 already handled globally; network errors leave us signed out of the UI */
      })
      .finally(() => !cancelled && setRestoring(false))
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password)
    setToken(res.token)
    setUser(res.user)
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      /* token is dropped locally either way */
    }
    setToken(null)
    setUser(null)
  }, [])

  const value = useMemo(() => ({ user, restoring, login, logout, expire }), [user, restoring, login, logout, expire])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
