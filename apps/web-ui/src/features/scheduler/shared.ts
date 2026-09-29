/**
 * Hạ tầng dùng chung của feature Lịch vận hành (Scheduler Engine v3.1).
 *
 * Nguyên tắc bám theo KX-DDC24-UX-WEB-SCHEDULER-001:
 *  S1 — không nhắc `TSx` ở bất kỳ đâu
 *  S2 — cấu hình là ý định, `runtime` là sự thật; không trộn
 *  S3 — thiếu số liệu thì hiện gạch ngang, không hiện 0/OK
 *  S4 — phép biên dịch Start/End → Time-Value luôn nhìn thấy được
 */
import type {
  ScheduleDayKey,
  ScheduleObject,
  ScheduleStatus,
  ScheduleTimeValue,
  ScheduleValue,
  ScheduleValueType,
  ScheduleWeekly
} from '../../shared/types'

/** Dấu hiển thị khi KHÔNG có số liệu. Không bao giờ thay bằng 0 hay OK (S3). */
export const EM_DASH = '—'

export const MAX_SCHEDULES = 64
export const MAX_TARGETS_PER_SCHEDULE = 32

/** Trần kênh theo loại điểm, khớp contracts/shm/mkddc_shm.h. */
export const POINT_KIND_LIMITS: Record<string, number> = {
  AO: 4, DO: 4, AV: 32, BV: 16, MSV: 8, EXT: 256
}

/** Tổng số điểm ghi nội bộ — dùng cho đồng hồ dung lượng thật (ADR-023 QĐ-3). */
export const INTERNAL_WRITABLE_POINTS =
  POINT_KIND_LIMITS.AO + POINT_KIND_LIMITS.DO + POINT_KIND_LIMITS.AV +
  POINT_KIND_LIMITS.BV + POINT_KIND_LIMITS.MSV

/** Kiểu điểm nào chứa nổi kiểu giá trị nào (SCH-TARGET-003). */
export const ALL_TARGET_KINDS: SchedulePointKind[] = ['DO', 'AO', 'BV', 'AV', 'MSV', 'EXT']

export const KIND_FOR_VALUE_TYPE: Record<ScheduleValueType, string[]> = {
  BINARY: ['DO', 'AO', 'BV', 'AV', 'MSV', 'EXT'],
  BOOLEAN: ['DO', 'AO', 'BV', 'AV', 'MSV', 'EXT'],
  REAL: ['DO', 'AO', 'BV', 'AV', 'MSV', 'EXT'],
  UNSIGNED: ['DO', 'AO', 'BV', 'AV', 'MSV', 'EXT'],
  ENUMERATED: ['DO', 'AO', 'BV', 'AV', 'MSV', 'EXT']
}

export const DAY_KEYS: ScheduleDayKey[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
export const DAY_LABELS: Record<ScheduleDayKey, string> = {
  MON: 'T2', TUE: 'T3', WED: 'T4', THU: 'T5', FRI: 'T6', SAT: 'T7', SUN: 'CN'
}
export const DAY_LABELS_EN: Record<ScheduleDayKey, string> = {
  MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun'
}

export function emptyWeekly(): ScheduleWeekly {
  return { MON: [], TUE: [], WED: [], THU: [], FRI: [], SAT: [], SUN: [] }
}

/** Giá trị "nghỉ" của từng kiểu — dùng làm schedule_default khi tạo lịch mới. */
export function restingValue(valueType: ScheduleValueType): ScheduleValue {
  switch (valueType) {
    case 'BINARY': return 'INACTIVE'
    case 'BOOLEAN': return false
    default: return 0
  }
}

export function oppositeValue(val: ScheduleValue, valueType: ScheduleValueType): ScheduleValue {
  if (valueType === 'BINARY') return val === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
  if (valueType === 'BOOLEAN') return !val
  return Number(val) === 0 ? 1 : 0
}

export function activeValue(valueType: ScheduleValueType): ScheduleValue {
  switch (valueType) {
    case 'BINARY': return 'ACTIVE'
    case 'BOOLEAN': return true
    default: return 1
  }
}

/** Nhãn người đọc cho một giá trị. Thiếu giá trị ⇒ gạch ngang (S3).
 *
 *  `lang` mặc định `'vi'` để không đổi hành vi những nơi gọi cũ chưa truyền
 *  locale hiện tại (feature Scheduler còn nhiều tab dùng chung hàm này). */
export function formatValue(value: ScheduleValue | null | undefined, valueType: ScheduleValueType, lang: 'vi' | 'en' = 'vi'): string {
  if (value === null || value === undefined) return EM_DASH
  const on = lang === 'en' ? 'ON' : 'BẬT'
  const off = lang === 'en' ? 'OFF' : 'TẮT'
  if (valueType === 'BINARY') return value === 'ACTIVE' ? on : off
  if (valueType === 'BOOLEAN') return value ? on : off
  return String(value)
}

/** true nếu giá trị khác giá trị nghỉ — quyết định màu khối trên lịch tuần. */
export function isActiveValue(value: ScheduleValue, valueType: ScheduleValueType): boolean {
  if (valueType === 'BINARY') return value === 'ACTIVE'
  if (valueType === 'BOOLEAN') return value === true
  return Number(value) !== 0
}

// ── Thời gian ─────────────────────────────────────────────────────────────

/** "HH:mm:ss" → giây trong ngày. Chuỗi sai trả -1 để nơi gọi tự quyết. */
export function timeToSeconds(time: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/.exec(time)
  if (!m) return -1
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

export function secondsToTime(seconds: number): string {
  const s = Math.max(0, Math.min(86_399, Math.round(seconds)))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

/** "HH:mm:ss" → "HH:mm" cho chỗ hiển thị hẹp. */
export function shortTime(time: string): string {
  return time.length >= 5 ? time.slice(0, 5) : time
}

export function sortTimeValues(list: ScheduleTimeValue[]): ScheduleTimeValue[] {
  return [...list].sort((a, b) => timeToSeconds(a.time) - timeToSeconds(b.time))
}

// ── Biên dịch Start/End → Time-Value (S4, đặc tả §2.3) ───────────────────

export interface TimeBlock {
  /** giây trong ngày */
  startSec: number
  endSec: number
  value: ScheduleValue
}

/**
 * Đọc một ngày Time-Value thành các KHỐI để vẽ.
 *
 * Đây là chiều ngược của phép biên dịch: người dùng vẽ khối, hệ thống lưu
 * Time-Value. Giao diện phải hiện được cả hai chiều, nếu không người dùng
 * không hiểu vì sao một khoảng 08:00→18:00 lại sinh HAI sự kiện.
 */
export function dayToBlocks(
  day: ScheduleTimeValue[],
  valueType: ScheduleValueType,
  defaultValue?: ScheduleValue
): TimeBlock[] {
  const sorted = sortTimeValues(day)
  const blocks: TimeBlock[] = []
  for (let i = 0; i < sorted.length; i++) {
    const startSec = timeToSeconds(sorted[i].time)
    if (startSec < 0) continue
    const endSec = i + 1 < sorted.length ? timeToSeconds(sorted[i + 1].time) : 86_400
    // Chỉ vẽ khối cho giá trị khác giá trị nghỉ/mặc định; khoảng "nghỉ" là nền.
    const isRest = defaultValue !== undefined
      ? sorted[i].value === defaultValue
      : !isActiveValue(sorted[i].value, valueType)
    if (!isRest && endSec > startSec) {
      const last = blocks[blocks.length - 1]
      if (last && last.endSec === startSec && last.value === sorted[i].value) {
        last.endSec = endSec
      } else {
        blocks.push({ startSec, endSec, value: sorted[i].value })
      }
    }
  }
  return blocks
}

/**
 * Chèn một khối [start, end) với giá trị `value` vào một ngày, sinh ra cặp
 * Time-Value tương ứng: mốc bật ở `start`, mốc trả về mặc định ở `end`.
 *
 * Mốc thứ hai KHÔNG phải trang trí — thiếu nó thì giá trị dính lại qua đêm.
 */
export function blockToTimeValues(
  day: ScheduleTimeValue[],
  startSec: number,
  endSec: number,
  value: ScheduleValue,
  defaultValue: ScheduleValue
): ScheduleTimeValue[] {
  const kept = day.filter((tv) => {
    const s = timeToSeconds(tv.time)
    return s < startSec || s > endSec
  })
  kept.push({ time: secondsToTime(startSec), value })
  if (endSec < 86_400 && defaultValue !== value) kept.push({ time: secondsToTime(endSec), value: defaultValue })
  return sortTimeValues(kept)
}

/**
 * Xoá một khối [startSec, endSec) khỏi ngày, dọn sạch mốc bật và mốc trả về mặc định.
 */
export function removeBlockFromDay(
  day: ScheduleTimeValue[],
  startSec: number,
  endSec: number,
  defaultValue: ScheduleValue
): ScheduleTimeValue[] {
  const sorted = sortTimeValues(day)
  return sorted.filter((e) => {
    const s = timeToSeconds(e.time)
    if (s === startSec) return false
    if (s > startSec && s < endSec) return false
    if (s === endSec && e.value === defaultValue) return false
    return true
  })
}


export function getNextDay(day: ScheduleDayKey): ScheduleDayKey {
  const i = DAY_KEYS.indexOf(day)
  return DAY_KEYS[(i + 1) % DAY_KEYS.length]
}

export function getPrevDay(day: ScheduleDayKey): ScheduleDayKey {
  const i = DAY_KEYS.indexOf(day)
  return DAY_KEYS[(i + DAY_KEYS.length - 1) % DAY_KEYS.length]
}

export interface DayPiece {
  day: ScheduleDayKey
  startSec: number
  endSec: number
}

export interface OvernightSpan {
  startDay: ScheduleDayKey
  startSec: number
  endDay: ScheduleDayKey
  endSec: number
  value: ScheduleValue
  isOvernight: boolean
  pieces: DayPiece[]
}

/**
 * Áp dụng một khoảng thời gian (kể cả xuyên ngày/qua đêm) vào lịch tuần.
 */
export function applySpanToWeekly(
  weekly: ScheduleWeekly,
  startDay: ScheduleDayKey,
  startSec: number,
  endDay: ScheduleDayKey,
  endSec: number,
  val: ScheduleValue,
  defVal: ScheduleValue
): ScheduleWeekly {
  const nextWeekly = { ...weekly }
  if (startDay === endDay && startSec < endSec) {
    nextWeekly[startDay] = blockToTimeValues(nextWeekly[startDay] || [], startSec, endSec, val, defVal)
    return nextWeekly
  }

  const effectiveEndDay = (startDay === endDay && startSec >= endSec) ? getNextDay(startDay) : endDay
  const days: ScheduleDayKey[] = []
  let cur = startDay
  days.push(cur)
  while (cur !== effectiveEndDay && days.length <= 7) {
    cur = getNextDay(cur)
    days.push(cur)
  }

  for (let i = 0; i < days.length; i++) {
    const d = days[i]
    const dayEvents = nextWeekly[d] || []
    if (i === 0) {
      nextWeekly[d] = blockToTimeValues(dayEvents, startSec, 86_400, val, defVal)
    } else if (i === days.length - 1) {
      if (endSec > 0) {
        nextWeekly[d] = blockToTimeValues(dayEvents, 0, endSec, val, defVal)
      }
    } else {
      nextWeekly[d] = blockToTimeValues(dayEvents, 0, 86_400, val, defVal)
    }
  }
  return nextWeekly
}

/**
 * Xóa danh sách các mảnh thuộc một sự kiện khỏi lịch tuần.
 */
export function removePiecesFromWeekly(
  weekly: ScheduleWeekly,
  pieces: DayPiece[],
  defVal: ScheduleValue
): ScheduleWeekly {
  const nextWeekly = { ...weekly }
  for (const p of pieces) {
    nextWeekly[p.day] = removeBlockFromDay(nextWeekly[p.day] || [], p.startSec, p.endSec, defVal)
  }
  return nextWeekly
}

/**
 * Nhận diện một khối có phải là một phần của sự kiện xuyên đêm (ví dụ: 23:00 T2 -> 03:00 T3).
 */
export function findOvernightSpan(
  weekly: ScheduleWeekly,
  day: ScheduleDayKey,
  block: TimeBlock,
  defVal: ScheduleValue,
  valType: ScheduleValueType
): OvernightSpan {
  const nextDay = getNextDay(day)
  const prevDay = getPrevDay(day)

  if (block.endSec === 86_400) {
    const nextBlocks = dayToBlocks(weekly[nextDay] || [], valType, defVal)
    const nextPiece = nextBlocks.find((b) => b.startSec === 0 && b.value === block.value)
    if (nextPiece) {
      return {
        startDay: day,
        startSec: block.startSec,
        endDay: nextDay,
        endSec: nextPiece.endSec,
        value: block.value,
        isOvernight: true,
        pieces: [
          { day, startSec: block.startSec, endSec: 86_400 },
          { day: nextDay, startSec: 0, endSec: nextPiece.endSec }
        ]
      }
    }
  }

  if (block.startSec === 0) {
    const prevBlocks = dayToBlocks(weekly[prevDay] || [], valType, defVal)
    const prevPiece = prevBlocks.find((b) => b.endSec === 86_400 && b.value === block.value)
    if (prevPiece) {
      return {
        startDay: prevDay,
        startSec: prevPiece.startSec,
        endDay: day,
        endSec: block.endSec,
        value: block.value,
        isOvernight: true,
        pieces: [
          { day: prevDay, startSec: prevPiece.startSec, endSec: 86_400 },
          { day, startSec: 0, endSec: block.endSec }
        ]
      }
    }
  }

  return {
    startDay: day,
    startSec: block.startSec,
    endDay: day,
    endSec: block.endSec,
    value: block.value,
    isOvernight: false,
    pieces: [{ day, startSec: block.startSec, endSec: block.endSec }]
  }
}

// ── Trạng thái ────────────────────────────────────────────────────────────

export interface StatusPresentation {
  /** Ký hiệu riêng cho từng trạng thái — màu KHÔNG phải kênh duy nhất (S8). */
  glyph: string
  label: string
  tone: string
}

export function statusPresentation(status: ScheduleStatus, lang: 'vi' | 'en' = 'vi'): StatusPresentation {
  if (lang === 'en') {
    switch (status) {
      case 'DRAFT': return { glyph: '◐', label: 'Draft', tone: 'text-[var(--c-text-dim)]' }
      case 'VALIDATED': return { glyph: '◑', label: 'Validated', tone: 'text-[var(--c-text)]' }
      case 'PUBLISHED': return { glyph: '●', label: 'Published', tone: 'text-[var(--c-accent)]' }
      case 'ACTIVE': return { glyph: '●', label: 'Active', tone: 'text-[var(--c-good-fg)]' }
      case 'INACTIVE': return { glyph: '○', label: 'Inactive', tone: 'text-[var(--c-text-dim)]' }
      case 'DISABLED': return { glyph: '⊘', label: 'Disabled', tone: 'text-[var(--c-text-dim)]' }
      case 'ERROR': return { glyph: '✕', label: 'Error', tone: 'text-[var(--c-bad-fg)]' }
      case 'OUT_OF_SYNC': return { glyph: '▲', label: 'Out of sync', tone: 'text-[var(--c-warn-fg)]' }
    }
  }
  switch (status) {
    case 'DRAFT': return { glyph: '◐', label: 'Nháp', tone: 'text-[var(--c-text-dim)]' }
    case 'VALIDATED': return { glyph: '◑', label: 'Đã kiểm', tone: 'text-[var(--c-text)]' }
    case 'PUBLISHED': return { glyph: '●', label: 'Đã publish', tone: 'text-[var(--c-accent)]' }
    case 'ACTIVE': return { glyph: '●', label: 'Đang chạy', tone: 'text-[var(--c-good-fg)]' }
    case 'INACTIVE': return { glyph: '○', label: 'Ngoài hiệu lực', tone: 'text-[var(--c-text-dim)]' }
    case 'DISABLED': return { glyph: '⊘', label: 'Đã tắt', tone: 'text-[var(--c-text-dim)]' }
    case 'ERROR': return { glyph: '✕', label: 'Lỗi', tone: 'text-[var(--c-bad-fg)]' }
    case 'OUT_OF_SYNC': return { glyph: '▲', label: 'Lệch revision', tone: 'text-[var(--c-warn-fg)]' }
  }
}

/** Tên người đọc của nguồn đang ghi đè — trả lời "sao thiết bị không chạy". */
export function overrideSourceLabel(source: string | null): string | null {
  switch (source) {
    case 'FIRE_SAFETY': return 'An toàn cháy (mức 1)'
    case 'LOCAL_MANUAL': return 'Lệnh tay tại chỗ (mức 2)'
    case 'BACNET': return 'BACnet (mức 3)'
    case 'LOCAL_LOGIC': return 'Logic nội bộ (mức 5)'
    default: return null
  }
}

// ── Tóm tắt lịch tuần cho cột hẹp trong Grid ─────────────────────────────

/**
 * "T2-T6 08-18" — chữ đọc được ngay, thay vì một mini-chart 4 mm không đọc nổi.
 * Nhiều khoảng trong ngày thì liệt kê, quá dài thì cắt bằng dấu ba chấm.
 */
export function weeklySummary(weekly: ScheduleWeekly, valueType: ScheduleValueType, lang: 'vi' | 'en' = 'vi'): string {
  const dayLabels = lang === 'en' ? DAY_LABELS_EN : DAY_LABELS
  const perDay = DAY_KEYS.map((key) => ({
    key,
    ranges: dayToBlocks(weekly[key], valueType)
      .map((b) => `${pad2(Math.floor(b.startSec / 3600))}-${pad2(Math.floor(b.endSec / 3600))}`)
      .join(', ')
  }))
  const active = perDay.filter((d) => d.ranges !== '')
  if (active.length === 0) return EM_DASH

  // Gom các ngày liền nhau có cùng khung giờ: T2,T3,T4,T5,T6 → T2-T6
  const groups: { days: ScheduleDayKey[]; ranges: string }[] = []
  for (const d of active) {
    const last = groups[groups.length - 1]
    const isNext = last && DAY_KEYS.indexOf(d.key) === DAY_KEYS.indexOf(last.days[last.days.length - 1]) + 1
    if (last && last.ranges === d.ranges && isNext) last.days.push(d.key)
    else groups.push({ days: [d.key], ranges: d.ranges })
  }
  return groups
    .map((g) => {
      const span = g.days.length >= 3
        ? `${dayLabels[g.days[0]]}-${dayLabels[g.days[g.days.length - 1]]}`
        : g.days.map((k) => dayLabels[k]).join(',')
      return `${span} ${g.ranges}`
    })
    .join(' · ')
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// ── Dung lượng thật (ADR-023 QĐ-3) ───────────────────────────────────────

export interface CapacityUsage {
  schedules: number
  maxSchedules: number
  /** Số điểm ghi NỘI BỘ riêng biệt đang bị lịch chiếm. */
  points: number
  maxPoints: number
  /** Số điểm bị NHIỀU lịch cùng ghi — runtime sẽ phân xử bằng priority. */
  contested: number
}

export function capacityUsage(list: ScheduleObject[]): CapacityUsage {
  const owners = new Map<string, Set<string>>()
  for (const s of list) {
    for (const t of s.target_objects) {
      if (t.target_type !== 'INTERNAL_POINT' || t.channel === undefined) continue
      const key = `${t.point_kind}-${t.channel}`
      if (!owners.has(key)) owners.set(key, new Set())
      owners.get(key)!.add(s.schedule_id)
    }
  }
  let contested = 0
  for (const ids of owners.values()) if (ids.size > 1) contested++
  return {
    schedules: list.length,
    maxSchedules: MAX_SCHEDULES,
    points: owners.size,
    maxPoints: INTERNAL_WRITABLE_POINTS,
    contested
  }
}

// ── Tạo lịch mới ──────────────────────────────────────────────────────────

export function nextScheduleId(list: ScheduleObject[]): string {
  const used = new Set(list.map((s) => s.schedule_id))
  for (let i = 1; i <= MAX_SCHEDULES; i++) {
    const id = `SCH-${String(i).padStart(3, '0')}`
    if (!used.has(id)) return id
  }
  return ''
}

export function blankSchedule(id: string, valueType: ScheduleValueType = 'BINARY'): ScheduleObject {
  return {
    schema_version: '3.1',
    schedule_id: id,
    schedule_name: '',
    enabled: false,
    status: 'DRAFT',
    timezone: 'Asia/Ho_Chi_Minh',
    effective_period: { start_date: null, end_date: null },
    value_type: valueType,
    priority_for_writing: 16,
    core_priority_level: 4,
    schedule_default: { value: restingValue(valueType) },
    weekly_schedule: emptyWeekly(),
    exception_schedule: [],
    target_objects: [],
    revision: 1
  }
}

/** Mã lỗi đặc tả §11 → câu giải thích ngắn cho người dùng. */
export const ERROR_CODE_HINTS: Record<string, string> = {
  'SCH-CONFIG-001': 'Thiếu giá trị mặc định',
  'SCH-CONFIG-002': 'Lịch tuần không hợp lệ',
  'SCH-CONFIG-003': 'Ngoại lệ trùng hoặc xung đột',
  'SCH-TARGET-001': 'Điểm mục tiêu không tồn tại',
  'SCH-TARGET-002': 'Điểm mục tiêu không ghi được',
  'SCH-TARGET-003': 'Kiểu dữ liệu không tương thích',
  'SCH-TIME-001': 'Múi giờ không hợp lệ',
  'SCH-TIME-002': 'Giờ hệ thống chưa đồng bộ',
  'SCH-WRITE-001': 'Ghi điểm thất bại',
  'SCH-WRITE-002': 'Ghi điểm quá hạn',
  'SCH-RUNTIME-001': 'Controller không phản hồi',
  'SCH-VERSION-001': 'Xung đột phiên bản',
  'SCH-PUBLISH-001': 'Publish thất bại',
  'SCH-ROLLBACK-001': 'Rollback thất bại'
}
