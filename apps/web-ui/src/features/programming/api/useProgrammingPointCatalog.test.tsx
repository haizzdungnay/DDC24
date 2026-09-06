import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProgrammingPointCatalogEntry, ProgrammingPointCatalogPage } from '../model/types'
import { useProgrammingPointCatalog } from './queries'

const client = vi.hoisted(() => ({ request: vi.fn() }))
const pick = vi.hoisted(() => (viText: string) => viText)

vi.mock('./authClient', () => ({ useProgrammingApiClient: () => client }))
vi.mock('../../../shared/i18n', () => ({ useI18n: () => ({ pick }) }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function point(index: number, overrides: Partial<ProgrammingPointCatalogEntry> = {}): ProgrammingPointCatalogEntry {
  return {
    category: 'VP',
    pointId: `VP${String(index).padStart(3, '0')}`,
    name: `Virtual Point ${index}`,
    dataType: 'REAL',
    direction: 'READ_WRITE',
    writable: true,
    quality: 'GOOD',
    value: index,
    mapping: {
      input: { status: 'SUPPORTED', reasons: [] },
      output: { status: 'SUPPORTED', reasons: [] },
    },
    ...overrides,
  }
}

function page(items: ProgrammingPointCatalogEntry[], nextCursor: string | null): ProgrammingPointCatalogPage {
  return { items, nextCursor }
}

describe('useProgrammingPointCatalog — ISS-PGM03-08', () => {
  beforeEach(() => { client.request.mockReset() })
  afterEach(() => vi.restoreAllMocks())

  it('744 Point với limit=500 phát đúng hai request và công bố snapshot đầy đủ một lần', async () => {
    client.request
      .mockResolvedValueOnce(page(Array.from({ length: 500 }, (_, index) => point(index + 1)), 'cursor-500'))
      .mockResolvedValueOnce(page(Array.from({ length: 244 }, (_, index) => point(index + 501)), null))

    const { result } = renderHook(() => useProgrammingPointCatalog(true, 'project-a'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(client.request).toHaveBeenCalledTimes(2)
    expect(client.request.mock.calls[0][1].query).toEqual({ limit: 500 })
    expect(client.request.mock.calls[0][1].query).not.toHaveProperty('cursor')
    expect(client.request.mock.calls[1][1].query).toEqual({ limit: 500, cursor: 'cursor-500' })
    expect(result.current.complete).toBe(true)
    expect(result.current.data?.nextCursor).toBeNull()
    expect(result.current.data?.items).toHaveLength(744)
    expect(new Set(result.current.data?.items.map((item) => `${item.category}|${item.deviceId ?? ''}|${item.pointId}`))).toHaveProperty('size', 744)
    expect(result.current.lastSuccessAt).toEqual(expect.any(Number))
  })

  it('khử trùng phần overlap theo canonical identity, không theo tên hoặc extIndex', async () => {
    const duplicateNewer = point(2, { name: 'Tên mới', extIndex: 99 })
    client.request
      .mockResolvedValueOnce(page([
        point(1, { name: 'Trùng tên', extIndex: 1 }),
        point(2, { name: 'Tên cũ', extIndex: 2 }),
      ], 'cursor-overlap'))
      .mockResolvedValueOnce(page([
        duplicateNewer,
        point(3, { name: 'Trùng tên', extIndex: 1 }),
      ], null))

    const { result } = renderHook(() => useProgrammingPointCatalog())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(result.current.data?.items).toHaveLength(3)
    expect(result.current.data?.items.find((item) => item.pointId === 'VP002')).toEqual(duplicateNewer)
    expect(result.current.data?.items.filter((item) => item.name === 'Trùng tên')).toHaveLength(2)
  })

  it('trang hai lỗi giữ 500 mục inspect-only; retry dùng đúng cursor rồi nâng lên 744', async () => {
    client.request
      .mockResolvedValueOnce(page(Array.from({ length: 500 }, (_, index) => point(index + 1)), 'cursor-500'))
      .mockRejectedValueOnce(new Error('cursor tạm thời hết hạn'))
      .mockResolvedValueOnce(page(Array.from({ length: 244 }, (_, index) => point(index + 501)), null))

    const { result } = renderHook(() => useProgrammingPointCatalog())
    await waitFor(() => expect(result.current.status).toBe('error'))

    expect(result.current.complete).toBe(false)
    expect(result.current.data?.items).toHaveLength(500)
    expect(result.current.data?.nextCursor).toBe('cursor-500')
    expect(result.current.lastSuccessAt).toBeNull()
    expect(result.current.canRetry).toBe(true)
    expect(client.request).toHaveBeenCalledTimes(2)

    act(() => result.current.retry())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(client.request).toHaveBeenCalledTimes(3)
    expect(client.request.mock.calls[2][1].query).toEqual({ limit: 500, cursor: 'cursor-500' })
    expect(result.current.data?.items).toHaveLength(744)
    expect(result.current.complete).toBe(true)
  })

  it('cursor lặp dừng sau hai request, không optimistic complete và restart từ trang đầu', async () => {
    client.request
      .mockResolvedValueOnce(page([point(1)], 'cursor-loop'))
      .mockResolvedValueOnce(page([point(2)], 'cursor-loop'))
      .mockResolvedValueOnce(page([point(9)], null))

    const { result } = renderHook(() => useProgrammingPointCatalog())
    await waitFor(() => expect(result.current.failure).toBe('REPEATED_CURSOR'))

    expect(client.request).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('error')
    expect(result.current.complete).toBe(false)
    expect(result.current.lastSuccessAt).toBeNull()
    expect(result.current.canRetry).toBe(false)

    act(() => result.current.restart())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(client.request).toHaveBeenCalledTimes(3)
    expect(client.request.mock.calls[2][1].query).toEqual({ limit: 500 })
    expect(result.current.data?.items.map((item) => item.pointId)).toEqual(['VP009'])
  })

  it('response hỏng dừng fail-closed và chỉ cho đọc lại từ trang đầu', async () => {
    client.request.mockResolvedValueOnce({ items: [point(1)], nextCursor: '' })

    const { result } = renderHook(() => useProgrammingPointCatalog())
    await waitFor(() => expect(result.current.failure).toBe('INVALID_PAGE'))

    expect(client.request).toHaveBeenCalledTimes(1)
    expect(result.current.complete).toBe(false)
    expect(result.current.canRetry).toBe(false)
    expect(result.current.lastSuccessAt).toBeNull()
  })

  it('đổi Project khi request đang bay bỏ generation cũ, không ghép response trễ', async () => {
    const oldRoute = deferred<ProgrammingPointCatalogPage>()
    client.request
      .mockReturnValueOnce(oldRoute.promise)
      .mockResolvedValueOnce(page([point(2)], null))

    const { result, rerender } = renderHook(
      ({ projectId }) => useProgrammingPointCatalog(true, projectId),
      { initialProps: { projectId: 'project-a' } },
    )
    await waitFor(() => expect(client.request).toHaveBeenCalledTimes(1))
    const firstSignal = client.request.mock.calls[0][1].signal as AbortSignal

    rerender({ projectId: 'project-b' })
    expect(result.current.status).toBe('loading')
    expect(result.current.complete).toBe(false)
    expect(result.current.data?.items ?? []).toHaveLength(0)
    await waitFor(() => expect(client.request).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(firstSignal.aborted).toBe(true)
    expect(result.current.data?.items.map((item) => item.pointId)).toEqual(['VP002'])

    await act(async () => oldRoute.resolve(page([point(1)], null)))
    expect(result.current.data?.items.map((item) => item.pointId)).toEqual(['VP002'])
  })

  it('enabled=false và unmount không fetch thêm hoặc nhận response cũ', async () => {
    const pending = deferred<ProgrammingPointCatalogPage>()
    client.request.mockReturnValue(pending.promise)

    const { result, rerender, unmount } = renderHook(
      ({ enabled }) => useProgrammingPointCatalog(enabled, 'project-a'),
      { initialProps: { enabled: false } },
    )
    await act(async () => { await Promise.resolve() })
    expect(client.request).not.toHaveBeenCalled()
    expect(result.current.status).toBe('loading')

    rerender({ enabled: true })
    await waitFor(() => expect(client.request).toHaveBeenCalledTimes(1))
    const signal = client.request.mock.calls[0][1].signal as AbortSignal
    unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve(page([point(1)], null)))
    expect(client.request).toHaveBeenCalledTimes(1)
  })

  it('ẩn rồi mở lại tab tạo generation mới và không tái dùng snapshot cũ', async () => {
    client.request
      .mockResolvedValueOnce(page([point(1)], null))
      .mockResolvedValueOnce(page([point(2)], null))

    const { result, rerender } = renderHook(
      ({ enabled }) => useProgrammingPointCatalog(enabled, 'project-a'),
      { initialProps: { enabled: true } },
    )
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.data?.items.map((item) => item.pointId)).toEqual(['VP001'])

    rerender({ enabled: false })
    expect(result.current.complete).toBe(false)
    expect(result.current.data).toBeNull()

    rerender({ enabled: true })
    expect(result.current.complete).toBe(false)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.data?.items.map((item) => item.pointId)).toEqual(['VP002'])
    expect(client.request).toHaveBeenCalledTimes(2)
  })
})
