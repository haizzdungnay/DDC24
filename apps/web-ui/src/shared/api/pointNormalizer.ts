import type { Point } from '../types'
import { normalizeInputPointId, normalizeKind, normalizeQuality, uiNode } from '../utils'
import { displayPointName } from './pointTags'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordArrayFrom(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function pointArraySource(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw
  if (!isRecord(raw)) return null
  for (const key of ['points', 'items', 'results']) {
    if (Array.isArray(raw[key])) return raw[key]
  }
  for (const key of ['payload', 'data']) {
    const nested = pointArraySource(raw[key])
    if (nested) return nested
  }
  return null
}

export function pointRecordsFrom(raw: unknown): Record<string, unknown>[] {
  return recordArrayFrom(pointArraySource(raw) ?? [])
}

function numberFrom(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function pointChannel(raw: Record<string, unknown>): number | undefined {
  return numberFrom(raw.channel ?? raw.ch ?? raw.index ?? raw.idx)
}

function idChannel(id: string): number | undefined {
  const numeric = numberFrom(id)
  if (numeric !== undefined && numeric > 0) return numeric
  const match = id.trim().match(/^[A-Z]+[-_]?(\d+)$/i)
  if (!match) return undefined
  const channel = Number(match[1])
  return Number.isFinite(channel) && channel > 0 ? channel : undefined
}

// Core exposes physical output channels in the global 1..24 namespace (AO=17..20, DO=21..24).
// Trends and other APIs use the canonical per-kind 1..4 IDs instead.
function canonicalOutputChannel(kind: Point['kind'], channel?: number): number | undefined {
  if (channel === undefined) return undefined
  if (kind === 'AO' && channel >= 17 && channel <= 20) return channel - 16
  if (kind === 'DO' && channel >= 21 && channel <= 24) return channel - 20
  return channel
}

function pointKind(raw: Record<string, unknown>, rawId: string, channel?: number): Point['kind'] {
  const rawKind = raw.kind ?? raw.type ?? raw.point_type ?? raw.pointType ?? raw.object_type ?? raw.objectType
  const idPrefix = rawId.trim().match(/^([A-Z]+)[-_]?\d+$/i)?.[1]
  if (idPrefix && ['VP', 'AV', 'BV', 'MSV'].includes(idPrefix.toUpperCase())) return 'virtual'
  const direct = normalizeKind(rawKind ?? idPrefix ?? rawId.split(/[-_.]/)[0])
  if (String(rawKind).toLowerCase() === 'modbus_rtu') return 'modbus_rtu'
  if (direct !== 'virtual') return direct

  const text = String(rawKind ?? rawId).toLowerCase()
  if (text.includes('analog_output')) return 'AO'
  if (text.includes('digital_output') || text.includes('binary_output') || text.includes('relay')) return 'DO'
  if (text.includes('universal') || text.includes('analog_input') || text.includes('digital_input') || text === 'input') return 'UI'

  return channel ? 'UI' : 'virtual'
}

function pointId(raw: Record<string, unknown>, kind: Point['kind'], channel?: number): string {
  const rawId = raw.id ?? raw.point_id ?? raw.pointId ?? raw.object_id ?? raw.objectId ?? raw.name ?? raw.label
  const id = rawId === undefined || rawId === null ? '' : String(rawId).trim()
  const rawKind = String(raw.kind ?? raw.type ?? raw.point_type ?? raw.pointType ?? id).toUpperCase()
  const inferredChannel = canonicalOutputChannel(kind, channel ?? idChannel(id))
  if (kind === 'UI') {
    if (inferredChannel) return uiNode(rawKind.startsWith('DI') || rawKind.startsWith('BI') ? inferredChannel + 8 : inferredChannel)
    return normalizeInputPointId(id || 'UNKNOWN')
  }
  if ((kind === 'AO' || kind === 'DO') && inferredChannel) {
    return `${kind}-${String(inferredChannel).padStart(2, '0')}`
  }
  return id || 'UNKNOWN'
}

/** Chuỗi trạng thái nhị phân đến từ core hoặc từ một point Modbus.
 *
 * `open` và `closed` là hai giá trị ĐỐI LẬP — chính kiểu dữ liệu của dự án nói
 * vậy (`DoSafeState = 'open' | 'closed'`). Bản trước xếp cả hai vào danh sách
 * truthy, nên một tiếp điểm DO/DI trả `{"value":"open"}` hiện lên giao diện
 * thành **ON / đã cấp điện** đúng bằng lúc nó trả `closed` (REV-FE-01).
 *
 * Quy ước theo tiếp điểm rơ-le: `closed` = mạch kín = ON, `open` = hở = OFF.
 */
const TRUTHY_STATES = ['true', 'on', 'closed', 'active', 'energized']
const FALSY_STATES = ['false', 'off', 'open', 'inactive', 'deenergized']

function pointValue(raw: Record<string, unknown>): Point['value'] {
  const value = raw.value ?? raw.present_value ?? raw.presentValue ?? raw.pv ?? raw.raw ?? raw.state
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const numeric = numberFrom(trimmed)
    if (numeric !== undefined) return numeric
    const lowered = trimmed.toLowerCase()
    if (TRUTHY_STATES.includes(lowered)) return true
    if (FALSY_STATES.includes(lowered)) return false
    return trimmed
  }
  // Không có giá trị nào ⇒ `undefined`, KHÔNG phải `0`.
  //
  // Một point Modbus RTU chưa từng được poll, hay một point core có `value`
  // vắng/`null`, từng đi qua đây và ra số `0` — rồi bảng Monitor/Trends hiện
  // "0 °C / 0 %" như một số đo thật và biểu đồ live ghi số 0 đó vào đuôi đồ
  // thị. Đây đúng lớp lỗi bịa dữ liệu mà phía BE đã ghi thành nguyên tắc D-07
  // và xử lý bằng cách trả `null` cho telemetry chưa đo được (REV-FE-04).
  return undefined
}

function pointQuality(raw: Record<string, unknown>): Point['quality'] {
  const value = raw.quality ?? raw.q ?? raw.status
  const text = String(value ?? '').toLowerCase()
  if (text === 'offline') return 'offline'
  if (raw.fault === true) return 'bad'
  if (['fault', 'failed', 'error', 'bad'].includes(text)) return 'bad'
  if (['timeout', 'stale'].includes(text)) return 'stale'
  if (raw.online === false) return 'offline'
  return normalizeQuality(value)
}

/** Mốc thời gian THẬT của producer, hoặc `undefined`.
 *
 * PA3-F04 — bản trước kết thúc bằng `?? nowIso()`. Nghĩa là một point mà không
 * nguồn nào biết cập nhật lúc nào sẽ hiện "vừa xong" trên mọi màn hình, và
 * `isFreshIso()` coi nó là dữ liệu tươi. Một cảm biến chết cứng trông y hệt một
 * cảm biến đang chạy — không có tín hiệu nào để người trực nhận ra.
 */
function pointUpdatedAt(raw: Record<string, unknown>): string | undefined {
  const value = raw.updatedAt ?? raw.updated_at ?? raw.timestamp ?? raw.ts
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).trim()
  if (text === '') return undefined
  return Number.isFinite(Date.parse(text)) ? text : undefined
}

function intFrom(value: unknown): number | undefined {
  const parsed = numberFrom(value)
  return parsed === undefined ? undefined : Math.trunc(parsed)
}

export function normalizePoint(raw: Record<string, unknown>): Point {
  const channel = pointChannel(raw)
  const rawId = String(raw.id ?? raw.point_id ?? raw.pointId ?? raw.object_id ?? raw.objectId ?? raw.name ?? raw.label ?? '')
  const kind = pointKind(raw, rawId, channel)
  const id = pointId(raw, kind, channel)
  const value = pointValue(raw)
  const rawValue = numberFrom(raw.raw)
  const rawUnit = raw.rawUnit ?? raw.raw_unit
  const updatedAt = pointUpdatedAt(raw)
  /* PA3-F03: các trường này ĐÃ CÓ trong `PointDTO` của backend nhưng bản
     trước làm rơi hết ở đây, nên Point Detail không có gì để hiện ngoài
     value/quality — và không có cách nào biết một output đang bị ép tay còn
     bao lâu. */
  const overrideExpiresInS = numberFrom(raw.overrideExpiresInS ?? raw.override_expires_in_s)
  const qualityReason = raw.quality_reason ?? raw.qualityReason
  const busId = intFrom(raw.bus_id ?? raw.busId)
  const slaveAddr = intFrom(raw.slave_addr ?? raw.slaveAddr)
  const exceptionCode = intFrom(raw.exception_code ?? raw.exceptionCode)
  const online = typeof raw.online === 'boolean' ? raw.online : undefined
  return {
    id,
    tag: String(raw.tag_name ?? raw.tag ?? id),
    name: displayPointName(raw.display_name ?? raw.name ?? raw.label, id),
    kind,
    value,
    unit: raw.unit ? String(raw.unit) : undefined,
    ...(rawValue !== undefined ? { raw: rawValue } : {}),
    ...(rawUnit ? { rawUnit: String(rawUnit) } : {}),
    quality: pointQuality(raw),
    source: String(raw.source ?? 'Core'),
    priority: raw.priority ? String(raw.priority) : raw.active_source ? String(raw.active_source) : undefined,
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    fault: Boolean(raw.fault ?? false),
    forced: Boolean(raw.forced ?? false),
    /* `T57-3.1`: thẻ thiết bị chỉ có khi backend gửi. Không suy từ tên điểm —
       `ADR-042` điều 1 cấm đoán, vì đoán sai sẽ gom nhầm hai hệ thống vào một
       khối và người đọc không có cách nào biết. */
    ...(typeof raw.equipment === 'string' && raw.equipment.trim() ? { equipment: raw.equipment.trim() } : {}),
    ...(overrideExpiresInS !== undefined && overrideExpiresInS > 0 ? { overrideExpiresInS } : {}),
    ...(qualityReason ? { qualityReason: String(qualityReason) } : {}),
    ...(busId !== undefined ? { busId } : {}),
    ...(slaveAddr !== undefined ? { slaveAddr } : {}),
    ...(exceptionCode !== undefined ? { exceptionCode } : {}),
    ...(online !== undefined ? { online } : {}),
    sensorType: raw.sensorType ? String(raw.sensorType) : raw.sensor_type ? String(raw.sensor_type) : raw.type ? String(raw.type) : undefined,
    signalType: raw.signalType ? String(raw.signalType) : raw.signal_type ? String(raw.signal_type) : undefined,
    writable: typeof raw.writable === 'boolean' ? raw.writable : undefined,
    logEnabled: typeof raw.logEnabled === 'boolean' ? raw.logEnabled : typeof raw.log_enabled === 'boolean' ? raw.log_enabled : undefined,
    logIntervalMs: numberFrom(raw.logIntervalMs ?? raw.log_interval_ms),
    namespaceState: raw.namespaceState ? String(raw.namespaceState) : raw.namespace_state ? String(raw.namespace_state) : undefined,
    pointId: String(raw.point_id ?? id),
    tagName: String(raw.tag_name ?? raw.tag ?? id),
    displayName: String(raw.display_name ?? raw.name ?? id),
    dataType: raw.data_type ? String(raw.data_type) : undefined,
    ...(updatedAt !== undefined ? { timestamp: updatedAt } : {}),
    readWrite: raw.read_write === 'read_write' ? 'read_write' : 'read',
    defaultValue: (raw.default_value as Point['defaultValue']) ?? null,
    safeValue: (raw.safe_value as Point['safeValue']) ?? null
  }
}
