import '@testing-library/jest-dom/vitest'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { operationPollBudget, useOperationPolling } from './useOperationPolling'

const request = vi.fn()

vi.mock('../api/authClient', () => ({ useProgrammingApiClient: () => ({ request }) }))

const operation = (state: string) => ({
  operationId: 'operation-1', state, step: 'test', requestedRevisionId: null,
  previousActiveRevisionId: null, actualActiveRevisionId: null, keepsRunningRevision: true,
  startedAt: '2026-08-20T00:00:00Z', updatedAt: '2026-08-20T00:00:00Z'
})

async function flushPromises() {
  await act(async () => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve()
  })
}

describe('useOperationPolling', () => {
  beforeEach(() => {
    request.mockReset()
    sessionStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('dùng fallback 90 giây và tăng budget theo chu kỳ task lớn nhất', () => {
    expect(operationPollBudget([])).toBe(90_000)
    expect(operationPollBudget([1000, 5000, 30_000])).toBe(90_000)
    expect(operationPollBudget([45_000])).toBe(120_000)
  })

  it('poll tuần tự mỗi 1500ms, terminal ROLLED_BACK là non-success và xóa recovery hint', async () => {
    request.mockResolvedValueOnce(operation('VERIFYING')).mockResolvedValueOnce(operation('ROLLED_BACK'))
    const { result } = renderHook(() => useOperationPolling({ recoveryKey: 'test.operation', budgetMs: 90_000 }))

    act(() => result.current.start('operation-1'))
    await flushPromises()
    expect(request).toHaveBeenCalledTimes(1)
    expect(JSON.parse(sessionStorage.getItem('test.operation')!)).toMatchObject({ operationId: 'operation-1' })

    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    await flushPromises()
    expect(result.current.state).toMatchObject({ phase: 'terminal', operation: { state: 'ROLLED_BACK' } })
    expect(sessionStorage.getItem('test.operation')).toBeNull()
  })

  it('enum lạ fail-closed và không lên lịch poll tiếp', async () => {
    request.mockResolvedValueOnce(operation('FUTURE_STATE'))
    const { result } = renderHook(() => useOperationPolling({ recoveryKey: 'test.operation', budgetMs: 90_000 }))
    act(() => result.current.start('operation-1'))
    await flushPromises()
    expect(result.current.state).toEqual({ phase: 'unknown', operationId: 'operation-1' })
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('lỗi đọc operation chuyển sang UNKNOWN và cho phép đọc lại cùng operation ID', async () => {
    request.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(operation('FAILED'))
    const { result } = renderHook(() => useOperationPolling({ recoveryKey: 'test.operation', budgetMs: 90_000 }))
    act(() => result.current.start('operation-1'))
    await flushPromises()
    expect(result.current.state).toEqual({ phase: 'unknown', operationId: 'operation-1' })
    act(() => result.current.start('operation-1'))
    await flushPromises()
    expect(result.current.state).toMatchObject({ phase: 'terminal', operation: { state: 'FAILED' } })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('recovery sau reload chỉ GET operation, không cần POST', async () => {
    sessionStorage.setItem('test.operation', JSON.stringify({ operationId: 'operation-1', deadlineAt: Date.now() + 90_000 }))
    request.mockResolvedValueOnce(operation('SUCCEEDED'))
    const { result } = renderHook(() => useOperationPolling({ recoveryKey: 'test.operation', budgetMs: 90_000 }))
    await flushPromises()
    expect(result.current.state).toMatchObject({ phase: 'terminal', operation: { state: 'SUCCEEDED' } })
    expect(request).toHaveBeenCalledWith('getProgrammingOperation', { path: { operationId: 'operation-1' } })
    expect(sessionStorage.getItem('test.operation')).toBeNull()
  })

  it('reload không khởi động lại budget đã hết; chuyển reconcile mà không GET tự động', async () => {
    sessionStorage.setItem('test.operation', JSON.stringify({ operationId: 'operation-1', deadlineAt: Date.now() - 1 }))
    const { result } = renderHook(() => useOperationPolling({ recoveryKey: 'test.operation', budgetMs: 90_000 }))
    await flushPromises()
    expect(result.current.state).toEqual({ phase: 'unknown', operationId: 'operation-1' })
    expect(request).not.toHaveBeenCalled()
  })

  it('unmount hủy timer và vô hiệu hóa response cũ', async () => {
    let resolve!: (value: ReturnType<typeof operation>) => void
    request.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const { result, unmount } = renderHook(() => useOperationPolling({ recoveryKey: 'test.operation', budgetMs: 90_000 }))
    act(() => result.current.start('operation-1'))
    await flushPromises()
    expect(request).toHaveBeenCalledTimes(1)
    unmount()
    await act(async () => { resolve(operation('SUCCEEDED')); await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(request).toHaveBeenCalledTimes(1)
  })
})
