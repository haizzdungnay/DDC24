import { IS_DEMO } from '../config'
import { getDemoAlarms, getDemoHealth, getDemoPoints } from '../demo/simulator'
import {
  OVERVIEW_SCHEMA_VERSION,
  type ActivityPage,
  type ActivityQuery,
  type Alarm,
  type AttentionSeverity,
  type OverviewAlarmCounts,
  type OverviewAttentionItem,
  type OverviewPointGroup,
  type OverviewPointSummary,
  type OverviewResponse,
  type Point
} from '../types'
import { requestJson } from './client'

/** Lỗi hợp đồng: backend nói một `schemaVersion` mà bản FE này không hiểu.
 *
 * Guardrail §10.3 — "backend cũ / FE mới": UI phải fail closed. Đoán mò field
 * còn thiếu rồi vẽ ra một Landing trông bình thường là cách tệ nhất để xử lý
 * lệch phiên bản trên một thiết bị điều khiển. */
export class OverviewSchemaError extends Error {
  constructor(readonly received: number) {
    super(`Overview schemaVersion ${received} không tương thích với giao diện này (cần ${OVERVIEW_SCHEMA_VERSION}).`)
    this.name = 'OverviewSchemaError'
  }
}

export async function fetchOverview(): Promise<OverviewResponse> {
  if (IS_DEMO) return demoOverview()
  const payload = await requestJson<OverviewResponse>('/overview', { cache: 'no-store', suppressAuthExpired: true })
  if (payload?.schemaVersion !== OVERVIEW_SCHEMA_VERSION) throw new OverviewSchemaError(payload?.schemaVersion ?? 0)
  return {
    ...payload,
    health: payload.health ?? [],
    attention: payload.attention ?? [],
    degraded: payload.degraded ?? [],
    points: payload.points ?? emptyPointSummary(),
    lastDataAt: payload.lastDataAt ?? null
  }
}

export async function fetchActivity(query: ActivityQuery = {}): Promise<ActivityPage> {
  if (IS_DEMO) return demoActivity()
  const params = new URLSearchParams()
  if (query.limit) params.set('limit', String(query.limit))
  if (query.before) params.set('before', String(query.before))
  if (query.kind) params.set('kind', query.kind)
  if (query.action) params.set('action', query.action)
  if (query.objectId) params.set('objectId', query.objectId)
  if (query.from) params.set('from', query.from)
  if (query.to) params.set('to', query.to)
  const suffix = params.toString() ? `?${params}` : ''
  const payload = await requestJson<ActivityPage>(`/activity${suffix}`, { cache: 'no-store', suppressAuthExpired: true })
  return { ...payload, items: payload.items ?? [], nextCursor: payload.nextCursor ?? null }
}

function emptyPointSummary(): OverviewPointSummary {
  return { total: 0, good: 0, uncertain: 0, bad: 0, stale: 0, offline: 0, forced: 0, groups: [] }
}

/* ── Chế độ demo ────────────────────────────────────────────────────────────
 *
 * Demo build (`IS_DEMO`) không có backend, nên overview được dựng lại từ chính
 * simulator. Đây KHÔNG phải dữ liệu giả trà trộn vào bản chạy thật: `IS_DEMO`
 * là hằng số build-time và bản deploy lên bo luôn là `false`.
 */
function demoOverview(): OverviewResponse {
  const points = getDemoPoints()
  const alarms = getDemoAlarms()
  const health = getDemoHealth()
  const now = new Date().toISOString()
  return {
    schemaVersion: OVERVIEW_SCHEMA_VERSION,
    generatedAt: now,
    controller: {
      deviceName: health.deviceName,
      firmware: health.firmware,
      ip: health.deviceIp,
      mac: health.deviceMac,
      systemTime: health.systemTime,
      uptimeS: health.uptimeS
    },
    connected: true,
    lastDataAt: now,
    overallState: alarms.some((alarm) => alarm.severity === 'critical') ? 'fault' : alarms.length ? 'degraded' : 'good',
    overallReasonCode: 'demo',
    alarms: summarizeDemoAlarms(alarms),
    points: summarizeDemoPoints(points),
    health: [
      { domain: 'controller', state: 'good', reasonCode: 'demo', source: 'simulator', observedAt: now, link: '/diagnostics' },
      { domain: 'local_io', state: 'good', reasonCode: 'demo', source: 'simulator', observedAt: now, link: '/monitor' },
      { domain: 'modbus', state: 'unknown', reasonCode: 'not_configured', source: 'simulator', observedAt: now, link: '/eng/modbus-rtu' },
      { domain: 'network', state: 'good', reasonCode: 'demo', source: 'simulator', observedAt: now, link: '/settings/network' },
      { domain: 'historian', state: 'unknown', reasonCode: 'demo', source: 'simulator', observedAt: now, link: '/trends' }
    ],
    attention: demoAttention(alarms, points),
    capabilities: { digitalInputs: 0, universalInputs: 16, analogOutputs: 4, digitalOutputs: 4, modbusRtuBuses: 1, bacnetIpEnabled: false },
    degraded: []
  }
}

function summarizeDemoAlarms(alarms: Alarm[]): OverviewAlarmCounts {
  const counts: OverviewAlarmCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0, unacked: 0, total: 0 }
  for (const alarm of alarms) {
    if (alarm.status === 'cleared') continue
    counts.total += 1
    if (alarm.status === 'unack') counts.unacked += 1
    counts[alarm.severity] += 1
  }
  return counts
}

function summarizeDemoPoints(points: Point[]): OverviewPointSummary {
  const summary = emptyPointSummary()
  const groups = new Map<string, OverviewPointGroup>()
  for (const point of points) {
    const group = groups.get(point.kind) ?? { kind: point.kind, total: 0, good: 0, uncertain: 0, bad: 0, stale: 0, offline: 0, forced: 0 }
    group.total += 1
    summary.total += 1
    /* `ISS-PIO-35`: hợp đồng tóm tắt Overview chỉ có NĂM ô đếm, không có ô nào
     * cho "không biết". `unknown`/`config_error` vì thế phải mượn một ô — và
     * mượn ô `good` chính là con bug mà issue này sửa, nên chúng đếm vào `bad`.
     * Đây là lựa chọn fail-closed CÓ Ý THỨC, không phải một phép ánh xạ đúng:
     * người vận hành thấy số BAD nhích lên sẽ đi tra, thấy GOOD thì không.
     * Muốn đếm đúng thì hợp đồng tóm tắt (cả phía Go) phải mọc thêm ô — đã ghi
     * lại ở #381. */
    const bucket = point.quality === 'unknown' || point.quality === 'config_error' ? 'bad' : point.quality
    group[bucket] += 1
    summary[bucket] += 1
    if (point.forced) {
      group.forced += 1
      summary.forced += 1
    }
    groups.set(point.kind, group)
  }
  summary.groups = [...groups.values()]
  return summary
}

function demoAttention(alarms: Alarm[], points: Point[]): OverviewAttentionItem[] {
  const rank: Record<AttentionSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
  const items: OverviewAttentionItem[] = alarms
    .filter((alarm) => alarm.severity === 'critical' || alarm.severity === 'high' || alarm.severity === 'medium')
    .map((alarm) => ({
      id: `alarm:${alarm.id}`,
      severity: alarm.severity as AttentionSeverity,
      category: 'alarm' as const,
      title: alarm.message,
      detail: alarm.source,
      targetType: 'alarm' as const,
      targetId: alarm.id,
      observedAt: alarm.time
    }))
  for (const point of points) {
    if (point.quality === 'good') continue
    items.push({
      id: `point:${point.id}`,
      severity: point.quality === 'bad' || point.quality === 'offline' ? 'high' : 'medium',
      category: point.quality === 'offline' ? 'communication' : 'quality',
      /* `ISS-PGUI-02` — lane demo đi qua ĐÚNG đường của backend thật: mã +
         `subject`, để giao diện dựng câu theo locale. `title` giữ lại làm
         diagnostic fallback, giống hợp đồng. */
      title: `${point.name} — ${point.quality.toUpperCase()}`,
      titleCode: point.quality === 'bad'
        ? 'point_quality_bad'
        : point.quality === 'offline' ? 'point_offline' : 'point_stale',
      subject: point.name,
      detail: point.id,
      targetType: 'point',
      targetId: point.id,
      observedAt: point.updatedAt
    })
  }
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 24)
}

function demoActivity(): ActivityPage {
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), items: [], nextCursor: null, retained: 0, capacity: 0 }
}
