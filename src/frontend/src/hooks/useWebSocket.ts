import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applyDemoPointMetadata, applyPointConfigOverrides, normalizePoint, pointRecordsFrom } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { API_ORIGIN, IS_DEMO, WS_ORIGIN } from '../config'
import { forceDemoPoint, tickDemoPoints } from '../demo/simulator'
import type { ConnectionState, Point } from '../types'
import { mergePointsById, nowIso } from '../utils'

type MonitorEnvelope = Record<string, unknown> & { op: string }

function toWsOrigin(origin: string): string {
  return origin.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
}

function wsEndpoint(token?: string): string {
  const sameOrigin = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
  const configuredOrigin = WS_ORIGIN || API_ORIGIN
  const origin = configuredOrigin ? toWsOrigin(configuredOrigin) : sameOrigin
  const endpoint = `${origin.replace(/\/$/, '')}/api/v1/ws/monitor`
  return token ? `${endpoint}?token=${encodeURIComponent(token)}` : endpoint
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
  const url = useMemo(() => wsEndpoint(session?.token), [session?.token])

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
    if (IS_DEMO) {
      publishPoints(tickDemoPoints())
      const id = window.setInterval(() => {
        publishPoints(tickDemoPoints())
      }, 200)
      return () => window.clearInterval(id)
    }

    let stopped = false
    const connect = () => {
      if (stopped) return
      setConnectionState(retryMs.current === 1000 ? 'connecting' : 'reconnecting')
      const socket = new WebSocket(url)
      socketRef.current = socket

      socket.onopen = () => {
        retryMs.current = 1000
        setConnectionState('connected')
        socket.send(JSON.stringify({ op: 'subscribe', points: '*' }))
      }

      socket.onmessage = (event) => {
        const parsed = JSON.parse(String(event.data)) as unknown
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
        setConnectionState('reconnecting')
        timeoutRef.current = window.setTimeout(connect, retryMs.current)
        retryMs.current = Math.min(5000, retryMs.current + 1000)
      }
    }

    connect()
    return () => {
      stopped = true
      setConnectionState('disconnected')
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
      socketRef.current?.close()
    }
  }, [publishPoints, url])

  useEffect(() => () => {
    Object.values(demoReleaseTimersRef.current).forEach((timerId) => window.clearTimeout(timerId))
    demoReleaseTimersRef.current = {}
  }, [])

  return { connectionState, allPoints, lastEnvelope, lastEventAt, lastPointEventAt, forcePoint }
}
