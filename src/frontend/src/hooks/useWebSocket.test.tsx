import '@testing-library/jest-dom/vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../config', () => ({ API_ORIGIN: '', WS_ORIGIN: '', IS_DEMO: false }))
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { token: 'test-token' } })
}))

import { useWebSocket } from './useWebSocket'

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly url: string
  readyState = FakeWebSocket.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  send = vi.fn()

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.(new CloseEvent('close'))
  }
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useWebSocket same-origin recovery', () => {
  it('reconnects immediately through the current hostname when the browser comes online', () => {
    const hook = renderHook(() => useWebSocket())
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0].url).toBe(
      `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/v1/ws/monitor?token=test-token`
    )

    act(() => FakeWebSocket.instances[0].open())
    expect(hook.result.current.connectionState).toBe('connected')

    act(() => FakeWebSocket.instances[0].close())
    expect(hook.result.current.connectionState).toBe('reconnecting')

    act(() => window.dispatchEvent(new Event('online')))
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(FakeWebSocket.instances[1].url).toBe(FakeWebSocket.instances[0].url)
  })
})
