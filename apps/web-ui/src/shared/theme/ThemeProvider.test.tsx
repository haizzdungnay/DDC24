import '@testing-library/jest-dom/vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from './ThemeProvider'
import { THEMES } from './tokens'

const STORAGE_KEY = 'mkddc:theme:v1'

const wrapper = ({ children }: { children: React.ReactNode }) => <ThemeProvider>{children}</ThemeProvider>

function stubPrefersDark(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const query = {
    matches,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, handler: (event: MediaQueryListEvent) => void) => listeners.add(handler),
    removeEventListener: (_: string, handler: (event: MediaQueryListEvent) => void) => listeners.delete(handler)
  }
  vi.stubGlobal('matchMedia', () => query)
  return {
    emit(next: boolean) {
      query.matches = next
      for (const handler of listeners) handler({ matches: next } as MediaQueryListEvent)
    }
  }
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** WEB-UX-012 — theme tối cho phòng máy, và nhớ lựa chọn của người dùng. */
describe('ThemeProvider', () => {
  it('theo prefers-color-scheme khi người dùng chưa chọn gì', () => {
    stubPrefersDark(true)
    const hook = renderHook(() => useTheme(), { wrapper })
    expect(hook.result.current.theme).toBe('dark')
    expect(hook.result.current.preference).toBeNull()
  })

  it('ghi token của theme lên :root', () => {
    stubPrefersDark(false)
    renderHook(() => useTheme(), { wrapper })
    const root = document.documentElement
    expect(root.dataset.theme).toBe('light')
    expect(root.style.getPropertyValue('--c-bg')).toBe(THEMES.light['--c-bg'])
    expect(root.style.getPropertyValue('color-scheme')).toBe('light')
  })

  it('nhớ lựa chọn của người dùng qua localStorage', () => {
    stubPrefersDark(false)
    const hook = renderHook(() => useTheme(), { wrapper })

    act(() => hook.result.current.toggleTheme())
    expect(hook.result.current.theme).toBe('dark')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark')
    expect(document.documentElement.style.getPropertyValue('--c-bg')).toBe(THEMES.dark['--c-bg'])

    cleanup()
    const reopened = renderHook(() => useTheme(), { wrapper })
    expect(reopened.result.current.theme).toBe('dark')
  })

  /**
   * Nếu người vận hành đã chọn sáng thì việc máy chuyển sang tối lúc 18h KHÔNG
   * được ghi đè quyết định đó. Chỉ bám theo hệ điều hành khi họ chưa chọn gì.
   */
  it('không để hệ điều hành ghi đè lựa chọn rõ ràng của người dùng', () => {
    const media = stubPrefersDark(false)
    const hook = renderHook(() => useTheme(), { wrapper })

    act(() => hook.result.current.setTheme('light'))
    act(() => media.emit(true))
    expect(hook.result.current.theme).toBe('light')
  })

  it('theo lại hệ điều hành khi lựa chọn bị xoá', () => {
    const media = stubPrefersDark(false)
    const hook = renderHook(() => useTheme(), { wrapper })

    act(() => hook.result.current.setTheme('dark'))
    act(() => hook.result.current.setTheme(null))
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()

    act(() => media.emit(true))
    expect(hook.result.current.theme).toBe('dark')
  })

  it('bỏ qua giá trị rác trong localStorage thay vì vỡ', () => {
    localStorage.setItem(STORAGE_KEY, 'neon')
    stubPrefersDark(false)
    const hook = renderHook(() => useTheme(), { wrapper })
    expect(hook.result.current.theme).toBe('light')
    expect(hook.result.current.preference).toBeNull()
  })
})
