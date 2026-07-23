import type { Page, Route } from '@playwright/test'

export interface FixturePoint {
  id: string
  tag: string
  name: string
  kind: 'UI' | 'AO' | 'DO' | 'virtual'
  value: number | boolean
  unit?: string
  quality: string
  source: string
  updatedAt: string
}

export interface FixtureVirtualPoint {
  id: string
  channel: number
  tag: string
  name: string
  label: string
  signalType: 'boolean' | 'integer' | 'float'
  enabled: boolean
  writable: boolean
  logEnabled: boolean
  logIntervalMs?: number
  value: number | boolean
  unit?: string
  generation: number
  updatedAt: string
}

export interface PointNameFixtureState {
  points: FixturePoint[]
  virtualPoints: FixtureVirtualPoint[]
  historyRequests: URL[]
  nameWrites: Array<{ id: string; body: Record<string, unknown> }>
  ioWrites: Array<{ body: Record<string, unknown> }>
  virtualPointWrites: Array<{ id: string; body: Record<string, unknown> }>
  conflictResponses: PointNameConflictDetail[]
  createdVirtualPoints: FixtureVirtualPoint[]
  deletedVirtualPointIds: string[]
  nextGeneration: number
}

export interface PointNameConflictDetail {
  path: string
  reason: 'point_name_conflict'
  message: string
  pointId: string
  conflictPointId: string
  conflictPath: string
}

interface FixtureOptions {
  points: FixturePoint[]
  virtualPoints: FixtureVirtualPoint[]
  nextGeneration?: number
}

export function createPointNameFixture(options: FixtureOptions): PointNameFixtureState {
  return {
    points: options.points.map((point) => ({ ...point })),
    virtualPoints: options.virtualPoints.map((point) => ({ ...point })),
    historyRequests: [],
    nameWrites: [],
    ioWrites: [],
    virtualPointWrites: [],
    conflictResponses: [],
    createdVirtualPoints: [],
    deletedVirtualPointIds: [],
    nextGeneration: options.nextGeneration ?? Math.max(...options.virtualPoints.map((point) => point.generation), 0) + 1
  }
}

/** Route every live API call while retaining mutations so the browser flow remains observable. */
export async function installPointNameApiFixture(page: Page, state: PointNameFixtureState): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const pathname = url.pathname
    const method = route.request().method()

    if (pathname === '/api/v1/points' && method === 'GET') {
      return fulfill(route, 200, projectPoints(state))
    }
    if (pathname === '/api/v1/virtual-points' && method === 'GET') {
      return fulfill(route, 200, state.virtualPoints.map(projectVirtualPoint))
    }
    if (pathname === '/api/v1/trends/config' && method === 'GET') {
      return fulfill(route, 200, historianConfig(state))
    }
    if (pathname === '/api/v1/system/config/io' && method === 'GET') {
      return fulfill(route, 200, ioConfig(state))
    }
    if (pathname === '/api/v1/system/config/io' && method === 'PUT') {
      const body = readJson(route)
      state.ioWrites.push({ body })
      const conflict = ioNameConflict(state, body)
      if (conflict) return fulfillNameConflict(route, state, conflict)
      applyIoNames(state, body)
      return fulfill(route, 200, {})
    }
    if (pathname === '/api/v1/system/config/safe-state' && method === 'GET') {
      return fulfill(route, 200, safeStateConfig(state))
    }
    if (pathname === '/api/v1/system/config/safe-state' && method === 'PUT') {
      return fulfill(route, 200, {})
    }
    if (pathname === '/api/v1/history' && method === 'GET') {
      state.historyRequests.push(url)
      return fulfill(route, 200, historyResponse(url, state))
    }
    if (pathname.startsWith('/api/v1/points/') && pathname.endsWith('/config') && method === 'PUT') {
      const id = decodeURIComponent(pathname.split('/').at(-2) ?? '')
      const body = readJson(route)
      state.nameWrites.push({ id, body })
      const name = typeof body.name === 'string' ? body.name : undefined
      const conflict = name === undefined ? undefined : findNameConflict(state, id, name)
      if (conflict) return fulfillNameConflict(route, state, conflict)
      if (name !== undefined) applyPointName(state, id, name)
      return fulfill(route, 200, { id, name: body.name })
    }
    if (pathname.startsWith('/api/v1/virtual-points/') && method === 'PUT') {
      const id = decodeURIComponent(pathname.split('/').at(-1) ?? '')
      const body = readJson(route)
      state.virtualPointWrites.push({ id, body })
      const current = state.virtualPoints.find((point) => point.id === id)
      if (!current) return fulfill(route, 404, { error: 'virtual point not found' })
      const name = typeof body.label === 'string' ? body.label : typeof body.name === 'string' ? body.name : current.name
      const conflict = findNameConflict(state, id, name)
      if (conflict) return fulfillNameConflict(route, state, conflict)
      const next = { ...current, ...body, id, name, label: name }
      state.virtualPoints = state.virtualPoints.map((point) => point.id === id ? next : point)
      return fulfill(route, 200, projectVirtualPoint(next))
    }
    if (pathname === '/api/v1/virtual-points' && method === 'POST') {
      const body = readJson(route)
      const id = 'VP1'
      const name = String(body.name ?? body.label ?? id)
      const created: FixtureVirtualPoint = {
        id,
        channel: 25,
        tag: String(body.tag ?? 'RECREATED_ZONE'),
        name,
        label: name,
        signalType: body.signalType === 'boolean' || body.signalType === 'integer' ? body.signalType : 'float',
        enabled: body.enabled !== false,
        writable: body.writable !== false,
        logEnabled: Boolean(body.logEnabled),
        logIntervalMs: typeof body.logIntervalMs === 'number' ? body.logIntervalMs : undefined,
        value: typeof body.value === 'boolean' ? body.value : Number(body.value ?? 0),
        unit: typeof body.unit === 'string' ? body.unit : undefined,
        generation: state.nextGeneration,
        updatedAt: '2026-07-23T00:00:00.000Z'
      }
      state.nextGeneration += 1
      state.virtualPoints = [...state.virtualPoints, created]
      state.createdVirtualPoints.push(created)
      return fulfill(route, 200, projectVirtualPoint(created))
    }
    if (pathname.startsWith('/api/v1/virtual-points/') && method === 'DELETE') {
      const id = decodeURIComponent(pathname.split('/').at(-1) ?? '')
      state.deletedVirtualPointIds.push(id)
      state.virtualPoints = state.virtualPoints.filter((point) => point.id !== id)
      return fulfill(route, 204)
    }

    if (pathname === '/api/v1/alarms' && method === 'GET') return fulfill(route, 200, [])
    if (pathname === '/api/v1/system/status' && method === 'GET') return fulfill(route, 200, { device_name: 'E2E Controller', firmware: 'e2e' })
    if (pathname === '/api/v1/me' && method === 'GET') return fulfill(route, 200, { username: 'admin', role: 'admin' })
    if (pathname === '/api/v1/health' && method === 'GET') return fulfill(route, 200, { status: 'ok' })
    return fulfill(route, 200, [])
  })
}

function projectVirtualPoint(point: FixtureVirtualPoint): Omit<FixtureVirtualPoint, 'name'> {
  const { name: _internalName, ...wirePoint } = point
  return wirePoint
}

function projectPoints(state: PointNameFixtureState): FixturePoint[] {
  const virtual = state.virtualPoints.map((point): FixturePoint => ({
    id: point.id,
    tag: point.tag,
    name: point.name,
    kind: 'virtual',
    value: point.value,
    ...(point.unit ? { unit: point.unit } : {}),
    quality: 'good',
    source: 'runtime',
    updatedAt: point.updatedAt
  }))
  return [...state.points.filter((point) => point.kind !== 'virtual'), ...virtual]
}

function historianConfig(state: PointNameFixtureState) {
  const points = [...state.points.filter((point) => point.kind !== 'virtual').map((point) => point.id), ...state.virtualPoints.map((point) => point.id)]
  const policies = points.map((pointId) => {
    const point = state.virtualPoints.find((item) => item.id === pointId)
    return {
      pointId,
      generation: point?.generation ?? 1,
      dbLoggingEnabled: true,
      dbInterval: '15s',
      retentionDays: 180,
      maxRetentionDays: 180,
      hotCacheEnabled: true,
      hotCacheHours: 48,
      startAtUtc: '2026-07-22T00:00:00.000Z',
      state: 'recording',
      health: 'e2e'
    }
  })
  return {
    revision: 1,
    serverNowUtc: '2026-07-23T00:00:00.000Z',
    points: policies,
    capacity: { enabledPoints: policies.length, reservedBytes: 1024, budgetBytes: 2 * 1024 * 1024, freeBytes: 2 * 1024 * 1024, requiredFreeBytes: 512 * 1024 },
    namespaceRevision: 1,
    retentionMaxDaysByInterval: { '15s': 180 }
  }
}

function ioConfig(state: PointNameFixtureState): Record<string, unknown> {
  return {
    ui: physicalPoints(state, 'UI').map((point) => ({ ch: pointChannel(point.id), tag: point.id, type: 'none', name: point.name, enabled: true })),
    ao: physicalPoints(state, 'AO').map((point) => ({ ch: pointChannel(point.id), tag: point.id, mode: '0-10V', units: 'volt', name: point.name, enabled: true })),
    do: physicalPoints(state, 'DO').map((point) => ({ ch: pointChannel(point.id), tag: point.id, name: point.name, enabled: true }))
  }
}

function safeStateConfig(state: PointNameFixtureState): Record<string, unknown> {
  return {
    ao: physicalPoints(state, 'AO').map((point) => ({ ch: pointChannel(point.id), safe: 0 })),
    do: physicalPoints(state, 'DO').map((point) => ({ ch: pointChannel(point.id), safe: 'open' }))
  }
}

function physicalPoints(state: PointNameFixtureState, kind: Exclude<FixturePoint['kind'], 'virtual'>): FixturePoint[] {
  return state.points.filter((point) => point.kind === kind)
}

function pointChannel(id: string): number {
  const channel = Number(id.split('-').at(-1))
  return Number.isFinite(channel) && channel > 0 ? channel : 1
}

function ioNameConflict(state: PointNameFixtureState, body: Record<string, unknown>): PointNameConflictDetail | undefined {
  for (const kind of ['UI', 'AO', 'DO'] as const) {
    const entries = Array.isArray(body[kind.toLowerCase()]) ? body[kind.toLowerCase()] as Array<Record<string, unknown>> : []
    for (const entry of entries) {
      if (typeof entry.name !== 'string') continue
      const channel = typeof entry.ch === 'number' ? entry.ch : entries.indexOf(entry) + 1
      const id = `${kind}-${String(channel).padStart(2, '0')}`
      const current = state.points.find((point) => point.id === id)
      if (!current || nameKey(current.name) === nameKey(entry.name)) continue
      const conflict = findNameConflict(state, id, entry.name)
      if (conflict) return conflict
    }
  }
  return undefined
}

function applyIoNames(state: PointNameFixtureState, body: Record<string, unknown>): void {
  for (const kind of ['UI', 'AO', 'DO'] as const) {
    const entries = Array.isArray(body[kind.toLowerCase()]) ? body[kind.toLowerCase()] as Array<Record<string, unknown>> : []
    for (const [index, entry] of entries.entries()) {
      if (typeof entry.name !== 'string') continue
      const channel = typeof entry.ch === 'number' ? entry.ch : index + 1
      applyPointName(state, `${kind}-${String(channel).padStart(2, '0')}`, entry.name)
    }
  }
}

function findNameConflict(state: PointNameFixtureState, mutationId: string, proposedName: string): PointNameConflictDetail | undefined {
  const key = nameKey(proposedName)
  const owner = namespaceEntries(state).find((entry) => entry.id !== mutationId && nameKey(entry.name) === key)
  if (!owner) return undefined
  return {
    path: pointNamePath(state, mutationId),
    reason: 'point_name_conflict',
    message: 'display name is already used',
    pointId: mutationId,
    conflictPointId: owner.id,
    conflictPath: pointNamePath(state, owner.id)
  }
}

function namespaceEntries(state: PointNameFixtureState): Array<{ id: string; name: string }> {
  return [
    ...state.points.filter((point) => point.kind !== 'virtual').map((point) => ({ id: point.id, name: point.name })),
    ...state.virtualPoints.map((point) => ({ id: point.id, name: point.name }))
  ]
}

function pointNamePath(state: PointNameFixtureState, id: string): string {
  if (id.startsWith('VP')) {
    const index = Math.max(state.virtualPoints.findIndex((point) => point.id === id), 0)
    return `items[${index}].label`
  }
  const kind = id.split('-')[0]?.toLowerCase() ?? 'ui'
  return `${kind}[${Math.max(pointChannel(id) - 1, 0)}].name`
}

function applyPointName(state: PointNameFixtureState, id: string, name: string): void {
  state.points = state.points.map((point) => point.id === id ? { ...point, name } : point)
  state.virtualPoints = state.virtualPoints.map((point) => point.id === id ? { ...point, name, label: name } : point)
}

function nameKey(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
}

async function fulfillNameConflict(route: Route, state: PointNameFixtureState, detail: PointNameConflictDetail): Promise<void> {
  state.conflictResponses.push(detail)
  return fulfill(route, 409, {
    error: 'point namespace conflict',
    code: 'point_name_conflict',
    details: [detail]
  })
}

function historyResponse(url: URL, state: PointNameFixtureState) {
  const requested = (url.searchParams.get('point') ?? '').split(',').filter(Boolean)
  const fromMs = Date.parse(url.searchParams.get('from') ?? '2026-07-22T00:00:00.000Z')
  const toMs = Date.parse(url.searchParams.get('to') ?? '2026-07-22T00:30:00.000Z')
  const series = requested.flatMap((pointId) => {
    const point = state.virtualPoints.find((item) => item.id === pointId)
    const generations = point && state.createdVirtualPoints.some((item) => item.id === pointId)
      ? [point.generation - 1, point.generation]
      : [point?.generation ?? 1]
    return generations.map((generation) => ({
      pointId,
      generation,
      effectiveResolution: '15s',
      samples: [15_000, 30_000].map((offset, index) => ({
        time: new Date(fromMs + offset).toISOString(),
        value: point?.value ?? index,
        min: point?.value ?? index,
        max: point?.value ?? index,
        sum: point?.value ?? index,
        count: 1,
        quality: 'GOOD',
        source: 'runtime',
        tier: 'hot',
        generation
      }))
    }))
  })
  return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), complete: true, tiersUsed: ['hot'], series, gaps: [] }
}

function readJson(route: Route): Record<string, unknown> {
  const raw = route.request().postData() ?? '{}'
  try {
    const body = JSON.parse(raw) as unknown
    return body && typeof body === 'object' ? body as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

async function fulfill(route: Route, status: number, body?: unknown): Promise<void> {
  if (status === 204) return route.fulfill({ status })
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}
