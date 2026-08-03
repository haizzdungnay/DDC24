import '@testing-library/jest-dom/vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../config', () => ({ API_ORIGIN: '', WS_ORIGIN: '', IS_DEMO: false }))
vi.mock('../../features/auth', () => ({
  useAuth: () => ({ session: { token: 'test-token' } })
}))

import { useWebSocket, WS_SUBPROTOCOL, WS_TOKEN_SUBPROTOCOL_PREFIX } from './useWebSocket'

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly url: string
  readonly protocols: string | string[] | undefined
  readyState = FakeWebSocket.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  send = vi.fn()

  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    this.protocols = protocols
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
      `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/v1/ws/monitor`
    )

    act(() => FakeWebSocket.instances[0].open())
    expect(hook.result.current.connectionState).toBe('connected')

    act(() => FakeWebSocket.instances[0].close())
    expect(hook.result.current.connectionState).toBe('reconnecting')

    act(() => window.dispatchEvent(new Event('online')))
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(FakeWebSocket.instances[1].url).toBe(FakeWebSocket.instances[0].url)
  })

  // F-10: JWT không được nằm trong URL — nó đi vào lịch sử browser và access log
  // của mọi reverse proxy đứng trước, với TTL 1 giờ.
  it('sends the token through Sec-WebSocket-Protocol and never in the URL', () => {
    renderHook(() => useWebSocket())
    const socket = FakeWebSocket.instances[0]

    expect(socket.url).not.toContain('token')
    expect(socket.url).not.toContain('?')
    expect(socket.protocols).toEqual([WS_SUBPROTOCOL, `${WS_TOKEN_SUBPROTOCOL_PREFIX}test-token`])
  })

  // F-09: một frame không phải JSON không được throw ra ngoài event handler —
  // exception ở đó không ai bắt và mất luôn cập nhật cho tới lần reconnect.
  it('survives a non-JSON frame without throwing out of onmessage', () => {
    const hook = renderHook(() => useWebSocket())
    const socket = FakeWebSocket.instances[0]
    act(() => socket.open())
    expect(hook.result.current.connectionState).toBe('connected')

    expect(() => {
      act(() => socket.onmessage?.(new MessageEvent('message', { data: '<html>502 Bad Gateway</html>' })))
    }).not.toThrow()

    // Kết nối vẫn sống và frame hợp lệ tiếp theo vẫn được xử lý bình thường.
    expect(hook.result.current.connectionState).toBe('connected')
    act(() => socket.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({ op: 'update', ts: '2026-07-30T00:00:00Z', points: [] })
    })))
    expect(hook.result.current.lastEnvelope?.op).toBe('update')
  })
})
