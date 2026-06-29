import { useEffect, useMemo, useRef, useState } from 'react'
import { normalizePoint, pointRecordsFrom } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { API_ORIGIN, IS_DEMO, WS_ORIGIN } from '../config'
import { tickDemoPoints } from '../demo/simulator'
import type { ConnectionState, Point } from '../types'
import { nowIso } from '../utils'

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

function mergePointUpdates(current: Point[], updates: Point[]): Point[] {
  const byId = new Map(current.map((point) => [point.id, point]))
  for (const point of updates) byId.set(point.id, point)
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }))
}

export function useWebSocket() {
  const { session } = useAuth()
  const [connectionState, setConnectionState] = useState<ConnectionState>(IS_DEMO ? 'connected' : 'connecting')
  const [allPoints, setAllPoints] = useState<Point[]>([])
  const [lastEnvelope, setLastEnvelope] = useState<MonitorEnvelope | null>(null)
  const [lastEventAt, setLastEventAt] = useState<string | null>(null)
  const retryMs = useRef(1000)
  const timeoutRef = useRef<number | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const url = useMemo(() => wsEndpoint(session?.token), [session?.token])

  useEffect(() => {
    if (IS_DEMO) {
      setAllPoints(tickDemoPoints())
      const id = window.setInterval(() => {
        const points = tickDemoPoints()
        const ts = nowIso()
        const envelope: MonitorEnvelope = { op: 'update', ts, points }
        setAllPoints(points)
        setLastEnvelope(envelope)
        setLastEventAt(ts)
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
          setAllPoints((current) => mergePointUpdates(current, points))
          setLastEnvelope({ ...message, op, ts, points })
          setLastEventAt(ts)
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
  }, [url])

  return { connectionState, allPoints, lastEnvelope, lastEventAt }
}
