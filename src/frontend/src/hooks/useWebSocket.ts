import { useEffect, useMemo, useRef, useState } from 'react'
import { API_ORIGIN, IS_DEMO, WS_ORIGIN } from '../config'
import { tickDemoPoints } from '../demo/simulator'
import type { ConnectionState, Envelope, IoUpdatePayload, Point } from '../types'
import { normalizeKind, normalizeQuality, nowIso } from '../utils'

function wsEndpoint(): string {
  const sameOrigin = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
  const origin = WS_ORIGIN || (API_ORIGIN ? API_ORIGIN.replace(/^http/, 'ws') : sameOrigin)
  return `${origin.replace(/\/$/, '')}/ws/v1/events`
}

function coercePoint(raw: Point | Record<string, unknown>): Point {
  const item = raw as Record<string, unknown>
  const id = String(item.id ?? 'UNKNOWN')
  return {
    id,
    name: String(item.name ?? item.label ?? id),
    kind: normalizeKind(item.kind ?? item.type),
    value: item.value as Point['value'] ?? 0,
    unit: item.unit ? String(item.unit) : undefined,
    quality: normalizeQuality(item.quality),
    source: String(item.source ?? 'WS'),
    priority: item.priority ? String(item.priority) : undefined,
    updatedAt: String(item.updatedAt ?? item.timestamp ?? nowIso()),
    fault: Boolean(item.fault ?? false),
    forced: Boolean(item.forced ?? false),
    sensorType: item.sensorType ? String(item.sensorType) : undefined,
    trend: Array.isArray(item.trend) ? item.trend.filter((value): value is number => typeof value === 'number') : undefined
  }
}

export function useWebSocket() {
  const [connectionState, setConnectionState] = useState<ConnectionState>(IS_DEMO ? 'connected' : 'connecting')
  const [allPoints, setAllPoints] = useState<Point[]>([])
  const [lastEnvelope, setLastEnvelope] = useState<Envelope<IoUpdatePayload> | null>(null)
  const [lastEventAt, setLastEventAt] = useState<string | null>(null)
  const retryMs = useRef(1000)
  const timeoutRef = useRef<number | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const url = useMemo(wsEndpoint, [])

  useEffect(() => {
    if (IS_DEMO) {
      setAllPoints(tickDemoPoints())
      const id = window.setInterval(() => {
        const points = tickDemoPoints()
        const envelope: Envelope<IoUpdatePayload> = { v: 1, type: 'event', topic: 'io_update', payload: { scan_ms: 12, points } }
        setAllPoints(points)
        setLastEnvelope(envelope)
        setLastEventAt(nowIso())
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
        socket.send(JSON.stringify({ v: 1, type: 'subscribe', topic: 'io_update' }))
      }

      socket.onmessage = (event) => {
        const envelope = JSON.parse(String(event.data)) as Envelope<IoUpdatePayload>
        setLastEnvelope(envelope)
        setLastEventAt(nowIso())
        if (envelope.type === 'event' && envelope.topic === 'io_update' && Array.isArray(envelope.payload?.points)) {
          setAllPoints(envelope.payload.points.map(coercePoint))
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
