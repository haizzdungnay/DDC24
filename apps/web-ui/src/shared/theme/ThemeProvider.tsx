import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { applyTheme, THEME_NAMES, type ThemeName } from './tokens'

/**
 * Chọn và ghi nhớ theme — WEB-UX-012.
 *
 * Lý do có theme tối không phải thẩm mỹ: HMI này đặt trong phòng máy, và ca đêm
 * nhìn một màn hình nền sáng suốt ca là mỏi mắt thật. Audit UI/UX xếp nó vào
 * điều kiện nghiệm thu.
 *
 * Thứ tự quyết định theme khi mở trang:
 *   1. lựa chọn người dùng đã lưu (localStorage) — họ đã nói rõ ý muốn;
 *   2. `prefers-color-scheme` của hệ điều hành — suy đoán hợp lý khi chưa có ý muốn;
 *   3. sáng.
 *
 * Chỉ theo dõi thay đổi của hệ điều hành khi người dùng CHƯA chọn gì. Nếu họ đã
 * chọn sáng mà máy chuyển sang tối lúc 18h, giao diện tự nhảy sang tối là ghi đè
 * một quyết định rõ ràng của con người.
 */

const STORAGE_KEY = 'mkddc:theme:v1'

interface ThemeContextValue {
  theme: ThemeName
  /** `null` nghĩa là đang bám theo hệ điều hành. */
  preference: ThemeName | null
  setTheme: (theme: ThemeName | null) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && (THEME_NAMES as readonly string[]).includes(value)
}

function readStoredPreference(): ThemeName | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return isThemeName(raw) ? raw : null
  } catch {
    // localStorage không dùng được ở chế độ riêng tư / trình duyệt bị khoá.
    return null
  }
}

function systemTheme(): ThemeName {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState<ThemeName | null>(readStoredPreference)
  const [system, setSystem] = useState<ThemeName>(systemTheme)
  const theme = preference ?? system

  useEffect(() => {
    if (preference !== null) return undefined
    if (typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (event: MediaQueryListEvent) => setSystem(event.matches ? 'dark' : 'light')
    query.addEventListener('change', handler)
    return () => query.removeEventListener('change', handler)
  }, [preference])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const setTheme = useCallback((next: ThemeName | null) => {
    setPreference(next)
    try {
      if (next === null) window.localStorage.removeItem(STORAGE_KEY)
      else window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Không lưu được thì phiên này vẫn đổi theme; chỉ mất phần ghi nhớ.
    }
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [setTheme, theme])

  const value = useMemo<ThemeContextValue>(() => ({ theme, preference, setTheme, toggleTheme }), [preference, setTheme, theme, toggleTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
