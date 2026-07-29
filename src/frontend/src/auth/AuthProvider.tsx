import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { API_ORIGIN, AUTH_MODE, IS_DEMO } from '../config'
import { setAuthHeaderProvider } from '../api/client'
import { setHistoryAuthHeaderProvider } from '../api/history'
import type { UserRole } from '../types'
import { isUserRole } from './permissions'

interface Session {
  username: string
  role: UserRole
  token?: string
  apiKey?: string
}

interface AuthContextValue {
  session: Session | null
  isAuthenticated: boolean
  login: (password: string, username?: string) => Promise<void>
  logout: () => void
  getAuthHeader: () => Record<string, string>
}

const AuthContext = createContext<AuthContextValue | null>(null)
const base = `${API_ORIGIN.replace(/\/$/, '')}/api/v1`

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)

  const getAuthHeader = useCallback((): Record<string, string> => {
    if (!session) return {}
    if (session.token) return { Authorization: `Bearer ${session.token}` }
    if (session.apiKey) return { 'X-API-Key': session.apiKey }
    return {}
  }, [session])

  useEffect(() => {
    setAuthHeaderProvider(getAuthHeader)
    setHistoryAuthHeaderProvider(getAuthHeader)
  }, [getAuthHeader])

  useEffect(() => {
    const handler = () => {
      setAuthHeaderProvider(() => ({}))
      setHistoryAuthHeaderProvider(() => ({}))
      setSession(null)
    }
    window.addEventListener('mkddc:auth-expired', handler)
    return () => window.removeEventListener('mkddc:auth-expired', handler)
  }, [])

  const login = useCallback(async (password: string, username = 'admin') => {
    if (IS_DEMO || AUTH_MODE === 'mock' || AUTH_MODE === 'none') {
      setSession({ username, role: 'admin' })
      return
    }

    if (AUTH_MODE === 'apikey') {
      setSession({ username, role: 'admin', apiKey: password })
      return
    }

    const response = await fetch(`${base}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    if (!response.ok) throw new Error('Đăng nhập thất bại')
    const body = await response.json() as { token?: string; role?: unknown }
    if (!isUserRole(body.role)) throw new Error('Login response contains an invalid role')
    if (body.token) {
      const provider = () => ({ Authorization: `Bearer ${body.token}` })
      setAuthHeaderProvider(provider)
      setHistoryAuthHeaderProvider(provider)
    }
    setSession({ username, role: body.role, token: body.token })
  }, [])

  const logout = useCallback(() => {
    setAuthHeaderProvider(() => ({}))
    setHistoryAuthHeaderProvider(() => ({}))
    setSession(null)
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    session,
    isAuthenticated: Boolean(session),
    login,
    logout,
    getAuthHeader
  }), [getAuthHeader, login, logout, session])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
