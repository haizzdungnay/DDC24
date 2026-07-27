import '@testing-library/jest-dom/vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useApi } from './useApi'

afterEach(cleanup)

describe('useApi request ordering', () => {
  it('does not request or poll while disabled', async () => {
    const fetcher = vi.fn().mockResolvedValue('hidden')
    const { result, rerender } = renderHook(
      ({ enabled }) => useApi(fetcher, [], { enabled, refreshMs: 10 }),
      { initialProps: { enabled: false } }
    )

    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 25)) })
    expect(fetcher).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)

    rerender({ enabled: true })
    await waitFor(() => expect(fetcher).toHaveBeenCalled())
  })
  it('does not let a stale response overwrite a newer dependency request', async () => {
    let resolveOld!: (value: string) => void
    let resolveNew!: (value: string) => void
    const oldRequest = new Promise<string>((resolve) => { resolveOld = resolve })
    const newRequest = new Promise<string>((resolve) => { resolveNew = resolve })
    const requests = [oldRequest, newRequest]
    let index = 0
    const hook = renderHook(({ key }: { key: string }) => useApi(() => requests[index++], [key]), { initialProps: { key: 'old' } })

    hook.rerender({ key: 'new' })
    await act(async () => { resolveNew('new-value'); await newRequest })
    expect(hook.result.current.data).toBe('new-value')
    await act(async () => { resolveOld('old-value'); await oldRequest })
    expect(hook.result.current.data).toBe('new-value')
  })

  it('keeps a polling error visible until a later request succeeds', async () => {
    vi.useFakeTimers()
    try {
      let resolveRecovery!: (value: string) => void
      const recovery = new Promise<string>((resolve) => { resolveRecovery = resolve })
      const fetcher = vi.fn()
        .mockRejectedValueOnce(new Error('authority unavailable'))
        .mockImplementationOnce(() => recovery)
      const hook = renderHook(() => useApi(fetcher, [], { refreshMs: 1000 }))

      await act(async () => { await Promise.resolve() })
      expect(hook.result.current.error?.message).toBe('authority unavailable')

      await act(async () => {
        vi.advanceTimersByTime(1000)
        await Promise.resolve()
      })
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(hook.result.current.error?.message).toBe('authority unavailable')

      await act(async () => { resolveRecovery('recovered'); await recovery })
      expect(hook.result.current.data).toBe('recovered')
      expect(hook.result.current.error).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('automatically retries a transient browser network failure', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce('reconnected')
      const hook = renderHook(() => useApi(fetcher))

      await act(async () => { await Promise.resolve(); await Promise.resolve() })
      expect(hook.result.current.error).toBeInstanceOf(TypeError)

      await act(async () => {
        vi.advanceTimersByTime(2000)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(hook.result.current.data).toBe('reconnected')
      expect(hook.result.current.error).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
