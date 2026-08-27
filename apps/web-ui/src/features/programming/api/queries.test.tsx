import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProgrammingRuntimeMonitor } from './queries'

const client = vi.hoisted(() => ({ request: vi.fn() }))
const pick = vi.hoisted(() => (viText: string) => viText)
vi.mock('./authClient', () => ({ useProgrammingApiClient: () => client }))
vi.mock('../../../shared/i18n', () => ({
  useI18n: () => ({ pick }),
}))

function snapshot(stamp: string) {
  return {
    schemaVersion: '1.0',
    activeRevisionId: 'revision-active',
    producer: { capturedMonotonicNs: stamp },
    safeState: false,
    task: null,
    items: [],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('useProgrammingRuntimeMonitor — vòng đời LIVE T59-812', () => {
  beforeEach(() => client.request.mockReset())
  afterEach(() => vi.restoreAllMocks())

  it('EDIT không subscribe; LIVE subscribe; rời LIVE hủy timer và bỏ response đang bay', async () => {
    const pending = deferred<ReturnType<typeof snapshot>>()
    client.request.mockReturnValue(pending.promise)
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval')

    const { result, rerender, unmount } = renderHook(
      ({ enabled }) => useProgrammingRuntimeMonitor(enabled),
      { initialProps: { enabled: false } },
    )
    expect(client.request).not.toHaveBeenCalled()

    rerender({ enabled: true })
    await waitFor(() => expect(client.request).toHaveBeenCalledTimes(1))
    rerender({ enabled: false })
    expect(clearIntervalSpy).toHaveBeenCalled()

    await act(async () => pending.resolve(snapshot('1000')))
    expect(result.current.data).toBeNull()
    expect(result.current.status).toBe('loading')
    unmount()
  })

  it('không mở request monitor chồng nhau; nhiều refresh được gộp thành một lượt kế', async () => {
    const first = deferred<ReturnType<typeof snapshot>>()
    client.request
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(snapshot('1001'))

    const { result, unmount } = renderHook(() => useProgrammingRuntimeMonitor(true))
    await waitFor(() => expect(client.request).toHaveBeenCalledTimes(1))

    act(() => {
      result.current.refresh()
      result.current.refresh()
      result.current.refresh()
    })
    expect(client.request).toHaveBeenCalledTimes(1)

    await act(async () => first.resolve(snapshot('1000')))
    await waitFor(() => expect(client.request).toHaveBeenCalledTimes(2))
    /* Ba yêu cầu xen giữa chỉ sinh đúng một lượt kế, không ba request. */
    expect(client.request).toHaveBeenCalledTimes(2)
    unmount()
  })
})
