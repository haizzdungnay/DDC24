import '@testing-library/jest-dom/vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import { useProgrammingRuntime, useProgrammingRuntimeMonitor } from './queries'

const client = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./authClient', () => ({ useProgrammingApiClient: () => client }))

const snapshot = {
  schemaVersion: '1.0',
  controllerId: 'controller-local',
  producerState: 'READY' as const,
  activeRevisionId: 'revision-active',
  lkgRevisionId: null,
  taskState: 'RUNNING' as const,
  safeState: false,
  safeStateNoControllerOnly: false,
  observedAt: '2026-08-19T00:00:00Z'
}

function Wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>
}

beforeEach(() => {
  client.request.mockReset()
  localStorage.setItem('mkddc-lang', 'vi')
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useProgrammingResource', () => {
  it('giữ snapshot cuối và mốc đọc thành công khi lần refresh kế tiếp lỗi', async () => {
    client.request.mockResolvedValueOnce(snapshot)
    const { result } = renderHook(() => useProgrammingRuntime(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.status).toBe('ready'))

    const lastSuccessAt = result.current.lastSuccessAt
    expect(result.current.data).toEqual(snapshot)
    expect(lastSuccessAt).toEqual(expect.any(Number))

    client.request.mockRejectedValueOnce(new Error('Core offline'))
    await act(async () => { await result.current.refresh() })
    expect(result.current.status).toBe('error')

    expect(result.current.data).toEqual(snapshot)
    expect(result.current.lastSuccessAt).toBe(lastSuccessAt)
    expect(result.current.error).toBe('Core offline')
  })

  it('không chồng request monitor khi latency dài hơn chu kỳ poll', async () => {
    vi.useFakeTimers()
    let resolveMonitor: ((value: unknown) => void) | undefined
    client.request.mockImplementation(() => new Promise((resolve) => { resolveMonitor = resolve }))

    const { result } = renderHook(() => useProgrammingRuntimeMonitor(), { wrapper: Wrapper })
    await act(async () => { await Promise.resolve() })
    expect(client.request).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(1_500) })
    expect(client.request).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveMonitor?.({ schemaVersion: '1.0', activeRevisionId: 'revision-active', safeState: false, task: null, items: [] })
      await Promise.resolve()
    })
    expect(result.current.status).toBe('ready')

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(client.request).toHaveBeenCalledTimes(2)
  })
})
