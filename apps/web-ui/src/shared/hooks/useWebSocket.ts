import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applyDemoPointMetadata, applyPointConfigOverrides, normalizePoint, pointRecordsFrom } from '../api/client'
import { useAuth } from '../../features/auth'
import { API_ORIGIN, IS_DEMO, WS_ORIGIN } from '../config'
import { forceDemoPoint, tickDemoPoints } from '../demo/simulator'
import type { ConnectionState, Point } from '../types'
import { mergePointsById, nowIso } from '../utils'

type MonitorEnvelope = Record<string, unknown> & { op: string }

function toWsOrigin(origin: string): string {
  return origin.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
}

/** Subprotocol cố định mà server chọn và echo lại. */
export const WS_SUBPROTOCOL = 'mkddc.v1'
/** Prefix của subprotocol mang JWT. Server KHÔNG echo lại phần tử này. */
export const WS_TOKEN_SUBPROTOCOL_PREFIX = 'mkddc.token.'

function wsEndpoint(): string {
  const sameOrigin = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
  const configuredOrigin = WS_ORIGIN || API_ORIGIN
  const origin = configuredOrigin ? toWsOrigin(configuredOrigin) : sameOrigin
  return `${origin.replace(/\/$/, '')}/api/v1/ws/monitor`
}

/**
 * F-10: token đi qua header `Sec-WebSocket-Protocol`, KHÔNG qua query string.
 *
 * `?token=<JWT>` nằm trong URL đầy đủ nên đi vào lịch sử browser và access log
 * của mọi reverse proxy đứng trước — với TTL 1 giờ thì cửa sổ lạm dụng là thật.
 * (`loggingMiddleware` của BE chỉ log `r.URL.Path` nên bản thân app không ghi ra,
 * nhưng nó không kiểm soát được proxy.)
 *
 * Server offer đúng một subprotocol `mkddc.v1` nên response chỉ echo lại phần tử
 * đó — token không bao giờ xuất hiện trong header trả về.
 */
function wsProtocols(token?: string): string[] {
  return token ? [WS_SUBPROTOCOL, `${WS_TOKEN_SUBPROTOCOL_PREFIX}${token}`] : [WS_SUBPROTOCOL]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function envelopeOp(message: Record<string, unknown>): string {
  return String(message.op ?? message.type ?? message.event ?? message.topic ?? '')
}

function envelopeTs(message: Record<string, unknown>): string {
  const payload = isRecord(message.payload) ? message.payload : {}
  const data = isRecord(message.data) ? message.data : {}
  const value = message.ts ?? message.timestamp ?? payload.ts ?? payload.timestamp ?? data.ts ?? data.timestamp
  return typeof value === 'string' ? value : nowIso()
}

export function useWebSocket() {
  const { session } = useAuth()
  const [connectionState, setConnectionState] = useState<ConnectionState>(IS_DEMO ? 'connected' : 'connecting')
  const [allPoints, setAllPoints] = useState<Point[]>([])
  const [lastEnvelope, setLastEnvelope] = useState<MonitorEnvelope | null>(null)
  const [lastEventAt, setLastEventAt] = useState<string | null>(null)
  const [lastPointEventAt, setLastPointEventAt] = useState<string | null>(null)
  const retryMs = useRef(1000)
  const timeoutRef = useRef<number | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const demoReleaseTimersRef = useRef<Record<string, number>>({})
  const url = useMemo(() => wsEndpoint(), [])
  const protocols = useMemo(() => wsProtocols(session?.token), [session?.token])
  const canConnect = IS_DEMO || Boolean(session)

  const publishPoints = useCallback((points: Point[]) => {
    const ts = nowIso()
    const nextPoints = applyPointConfigOverrides(applyDemoPointMetadata(points))
    const envelope: MonitorEnvelope = { op: 'update', ts, points: nextPoints }
    setAllPoints(nextPoints)
    setLastEnvelope(envelope)
    setLastEventAt(ts)
    setLastPointEventAt(ts)
  }, [])

  const forcePoint = useCallback((id: string, value: number | boolean, expireS?: number): boolean => {
    const safeExpireS = typeof expireS === 'number' && Number.isFinite(expireS) && expireS > 0 ? Math.round(expireS) : 0
    if (IS_DEMO) {
      forceDemoPoint(id, value)
      publishPoints(tickDemoPoints())
      if (demoReleaseTimersRef.current[id]) window.clearTimeout(demoReleaseTimersRef.current[id])
      if (safeExpireS > 0) {
        demoReleaseTimersRef.current[id] = window.setTimeout(() => {
          forceDemoPoint(id, value, true)
          publishPoints(tickDemoPoints())
          delete demoReleaseTimersRef.current[id]
        }, safeExpireS * 1000)
      }
      return true
    }
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify({
      op: 'force',
      id,
      value,
      ...(safeExpireS > 0 ? { expire_s: safeExpireS } : {})
    }))
    const ts = nowIso()
    setAllPoints((current) => mergePointsById(current, current
      .filter((point) => point.id === id)
      .map((point) => ({ ...point, value, forced: true, source: 'Local manual', priority: 'Manual override', updatedAt: ts }))))
    setLastPointEventAt(ts)
    return true
  }, [publishPoints])

  useEffect(() => {
    // Không mở socket khi hook chưa có session. Session mock/none không có
    // token vẫn kết nối sau khi người dùng login.
    if (!canConnect) {
      setConnectionState('disconnected')
      return
    }
    if (IS_DEMO) {
      publishPoints(tickDemoPoints())
      const id = window.setInterval(() => {
        publishPoints(tickDemoPoints())
      }, 200)
      return () => window.clearInterval(id)
    }

    let stopped = false
    const clearReconnectTimer = () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }

    const connect = () => {
      if (stopped) return
      const current = socketRef.current
      if (current && (current.readyState === WebSocket.CONNECTING || current.readyState === WebSocket.OPEN)) return
      clearReconnectTimer()
      setConnectionState(retryMs.current === 1000 ? 'connecting' : 'reconnecting')
      const socket = new WebSocket(url, protocols)
      socketRef.current = socket

      socket.onopen = () => {
        retryMs.current = 1000
        setConnectionState('connected')
        socket.send(JSON.stringify({ op: 'subscribe', points: '*' }))
      }

      socket.onmessage = (event) => {
        // F-09: `JSON.parse` chạy trần trong event handler. Một frame không phải
        // JSON (proxy chèn, khung lỗi, sự cố phía server) sẽ throw ra ngoài
        // handler — không ai bắt được, và mất luôn cập nhật cho tới lần reconnect.
        // Hiện BE luôn ghi bằng wsjson nên xác suất thấp, nhưng handler đọc dữ
        // liệu từ bên ngoài thì phải chống lỗi.
        let parsed: unknown
        try {
          parsed = JSON.parse(String(event.data))
        } catch {
          return
        }
        const message = isRecord(parsed) ? parsed : {}
        const op = envelopeOp(message) || 'update'
        const ts = envelopeTs(message)
        const records = pointRecordsFrom(parsed)

        if (records.length) {
          const points = records.map((point) => normalizePoint({ ts, ...point }))
          setAllPoints((current) => mergePointsById(current, points))
          setLastEnvelope({ ...message, op, ts, points })
          setLastEventAt(ts)
          setLastPointEventAt(ts)
          return
        }

        if (Object.keys(message).length) {
          setLastEnvelope({ ...message, op })
          setLastEventAt(ts)
        }
      }

      socket.onerror = () => socket.close()
      socket.onclose = () => {
        if (stopped) return
        if (socketRef.current === socket) socketRef.current = null
        setConnectionState('reconnecting')
        timeoutRef.current = window.setTimeout(connect, retryMs.current)
        retryMs.current = Math.min(5000, retryMs.current + 1000)
      }
    }

    const reconnectIfDisconnected = () => {
      const current = socketRef.current
      if (!current || current.readyState === WebSocket.CLOSING || current.readyState === WebSocket.CLOSED) connect()
    }

    const reconnectWhenVisible = () => {
      if (document.visibilityState === 'visible') reconnectIfDisconnected()
    }

    window.addEventListener('online', reconnectIfDisconnected)
    document.addEventListener('visibilitychange', reconnectWhenVisible)
    // React.StrictMode dev chạy setup → cleanup → setup. Mở WebSocket đồng bộ ở
    // setup đầu khiến cleanup đóng socket còn CONNECTING và Chrome ghi warning
    // “closed before the connection is established”. Hoãn một microtask để
    // setup đã bị cleanup thấy `stopped=true`; chỉ setup hiện hành được connect.
    queueMicrotask(connect)
    return () => {
      stopped = true
      setConnectionState('disconnected')
      window.removeEventListener('online', reconnectIfDisconnected)
      document.removeEventListener('visibilitychange', reconnectWhenVisible)
      clearReconnectTimer()
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [canConnect, protocols, publishPoints, url])

  useEffect(() => () => {
    Object.values(demoReleaseTimersRef.current).forEach((timerId) => window.clearTimeout(timerId))
    demoReleaseTimersRef.current = {}
  }, [])

  return { connectionState, allPoints, lastEnvelope, lastEventAt, lastPointEventAt, forcePoint }
}
