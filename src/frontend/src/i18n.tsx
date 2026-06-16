import { createContext, useContext, useMemo, useState } from 'react'
import type React from 'react'
import type { Language } from './types'

const copy = {
  vi: {
    dashboard: 'Dashboard',
    monitor: 'Monitor I/O',
    alarms: 'Alarms',
    trends: 'Trends',
    scheduler: 'Scheduler',
    network: 'Network',
    users: 'Users',
    settings: 'Settings',
    health: 'System Health',
    commissioning: 'Commissioning',
    validator: 'Validator',
    logout: 'Đăng xuất',
    online: 'ONLINE',
    offline: 'OFFLINE',
    demo: 'DEMO',
    live: 'LIVE',
    all: 'Tất cả',
    loading: 'Đang tải dữ liệu',
    empty: 'Chưa có dữ liệu',
    error: 'Không tải được dữ liệu',
    reconnecting: 'Mất WebSocket, đang kết nối lại. Dữ liệu đang hiển thị là stale.',
    loginTitle: 'Welcome Back',
    loginSub: 'Sign in to access your building control system',
    password: 'Mật khẩu',
    signIn: 'Sign In',
    guest: 'Guest Access',
    force: 'Force',
    confirm: 'Xác nhận',
    cancel: 'Hủy'
  },
  en: {
    dashboard: 'Dashboard',
    monitor: 'Monitor I/O',
    alarms: 'Alarms',
    trends: 'Trends',
    scheduler: 'Scheduler',
    network: 'Network',
    users: 'Users',
    settings: 'Settings',
    health: 'System Health',
    commissioning: 'Commissioning',
    validator: 'Validator',
    logout: 'Logout',
    online: 'ONLINE',
    offline: 'OFFLINE',
    demo: 'DEMO',
    live: 'LIVE',
    all: 'All',
    loading: 'Loading data',
    empty: 'No data',
    error: 'Could not load data',
    reconnecting: 'WebSocket lost. Reconnecting; displayed data is stale.',
    loginTitle: 'Welcome Back',
    loginSub: 'Sign in to access your building control system',
    password: 'Password',
    signIn: 'Sign In',
    guest: 'Guest Access',
    force: 'Force',
    confirm: 'Confirm',
    cancel: 'Cancel'
  }
} as const

type CopyKey = keyof typeof copy.vi

interface I18nValue {
  lang: Language
  setLang: (lang: Language) => void
  t: (key: CopyKey) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Language>('vi')
  const value = useMemo<I18nValue>(() => ({ lang, setLang, t: (key) => copy[lang][key] }), [lang])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}
