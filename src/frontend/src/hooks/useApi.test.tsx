import '@testing-library/jest-dom/vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useApi } from './useApi'

afterEach(cleanup)

describe('useApi request ordering', () => {
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
})
