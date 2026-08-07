/**
 * Liệt kê ngày thật của một quy tắc ngoại lệ trong 12 tháng tới.
 *
 * Đây là dữ liệu cho cột "12 tháng tới rơi vào" của Exception Manager, và nó
 * là BẮT BUỘC chứ không phải trang trí: `WEEK_N_DAY` ("thứ Hai đầu tiên của
 * tháng") và `HOLIDAY_GROUP` là hai kiểu quy tắc con người không tính nhẩm
 * được. Không có cột này thì người dùng publish một quy tắc mà không biết nó
 * sẽ nổ vào ngày nào.
 *
 * Thuật toán ở đây phải khớp `date_rule_matches()` phía C++
 * (apps/core/application/schedule/schedule_runtime.cpp). Đặc biệt:
 * `week_of_month = 6` là tuần CUỐI CÙNG theo quy ước BACnet, không phải tuần
 * thứ sáu.
 */
import type { ScheduleDateRule } from '../../shared/types'

export interface DateRulePreview {
  /** Ngày dạng YYYY-MM-DD, tối đa `limit` phần tử. */
  dates: string[]
  /** true khi quy tắc phụ thuộc dữ liệu ngoài (calendar / nhóm ngày lễ). */
  needsExternalData: boolean
  /** true khi còn ngày nữa nhưng đã cắt bớt cho vừa chỗ hiển thị. */
  truncated: boolean
}

const EMPTY: DateRulePreview = { dates: [], needsExternalData: false, truncated: false }

export function previewDateRule(
  rule: ScheduleDateRule,
  from: Date = new Date(),
  limit = 12
): DateRulePreview {
  switch (rule.type) {
    case 'DATE':
      return rule.date ? { ...EMPTY, dates: [rule.date] } : EMPTY

    case 'DATE_RANGE': {
      if (!rule.start_date || !rule.end_date) return EMPTY
      const start = parseISODate(rule.start_date)
      const end = parseISODate(rule.end_date)
      if (!start || !end || end < start) return EMPTY
      const dates: string[] = []
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        if (dates.length >= limit) return { dates, needsExternalData: false, truncated: true }
        dates.push(formatISODate(d))
      }
      return { dates, needsExternalData: false, truncated: false }
    }

    case 'WEEK_N_DAY': {
      const { month, week_of_month: week, day_of_week: dow } = rule
      if (month === undefined || week === undefined || dow === undefined) return EMPTY
      const dates: string[] = []
      const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1))
      for (let i = 0; i < 12; i++) {
        const y = cursor.getUTCFullYear()
        const m = cursor.getUTCMonth() + 1
        if (month === 0 || month === m) {
          const day = weekNDayOfMonth(y, m, week, dow)
          if (day) dates.push(day)
        }
        cursor.setUTCMonth(cursor.getUTCMonth() + 1)
        if (dates.length >= limit) return { dates, needsExternalData: false, truncated: true }
      }
      return { dates, needsExternalData: false, truncated: false }
    }

    case 'CALENDAR_REFERENCE':
    case 'HOLIDAY_GROUP':
      // Phụ thuộc dữ liệu ngoài. Trả rỗng + cờ để giao diện nói "chưa nạp
      // nhóm ngày lễ" thay vì hiện một danh sách rỗng gây hiểu là không rơi
      // vào ngày nào.
      return { dates: [], needsExternalData: true, truncated: false }
  }
}

/**
 * Ngày thứ `dow` (1=Thứ Hai … 7=Chủ nhật) của tuần thứ `week` trong tháng.
 * `week` 1..5 là lần xuất hiện thứ N; `week` 6 là lần CUỐI CÙNG (BACnet).
 * Trả null khi tháng đó không có lần xuất hiện thứ N.
 */
export function weekNDayOfMonth(year: number, month: number, week: number, dow: number): string | null {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const firstIso = ((first.getUTCDay() + 6) % 7) + 1 // JS 0=CN → ISO 1=T2
  const offset = (dow - firstIso + 7) % 7
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()

  if (week === 6) {
    let last = offset + 1
    while (last + 7 <= daysInMonth) last += 7
    return formatISODate(new Date(Date.UTC(year, month - 1, last)))
  }
  const day = offset + 1 + (week - 1) * 7
  if (day > daysInMonth) return null
  return formatISODate(new Date(Date.UTC(year, month - 1, day)))
}

/** Mô tả quy tắc bằng tiếng Việt, cho cột "Quy tắc ngày". */
export function describeDateRule(rule: ScheduleDateRule): string {
  const dowNames = ['', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật']
  switch (rule.type) {
    case 'DATE':
      return `NGÀY ${formatVN(rule.date)}`
    case 'DATE_RANGE':
      return `KHOẢNG ${formatVN(rule.start_date)} → ${formatVN(rule.end_date)}`
    case 'WEEK_N_DAY': {
      const dow = dowNames[rule.day_of_week ?? 0] || '?'
      const week = rule.week_of_month === 6 ? 'cuối cùng' : `thứ ${rule.week_of_month}`
      const month = rule.month === 0 ? 'mỗi tháng' : `tháng ${rule.month}`
      return `${dow} ${week} của ${month}`
    }
    case 'CALENDAR_REFERENCE':
      return `LỊCH ${rule.calendar_id ?? '?'}`
    case 'HOLIDAY_GROUP':
      return `NHÓM ${rule.group_id ?? '?'}`
  }
}

function parseISODate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
}

function formatISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** YYYY-MM-DD → DD/MM/YYYY, dạng người Việt đọc quen. */
export function formatVN(iso: string | undefined): string {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

/**
 * Tìm các cặp ngoại lệ chắc chắn đụng nhau: cùng ngày VÀ cùng event_priority.
 * Đặc tả §7.3 nói rõ hệ thống KHÔNG tự chọn — phải báo để người dùng quyết.
 */
export function findExceptionConflicts(
  exceptions: { exception_id: string; date_rule: ScheduleDateRule; event_priority: number }[],
  from: Date = new Date()
): { a: string; b: string; day: string }[] {
  const out: { a: string; b: string; day: string }[] = []
  const previews = exceptions.map((e) => previewDateRule(e.date_rule, from, 400))
  for (let i = 0; i < exceptions.length; i++) {
    for (let j = i + 1; j < exceptions.length; j++) {
      if (exceptions[i].event_priority !== exceptions[j].event_priority) continue
      const set = new Set(previews[i].dates)
      const hit = previews[j].dates.find((d) => set.has(d))
      if (hit) out.push({ a: exceptions[i].exception_id, b: exceptions[j].exception_id, day: hit })
    }
  }
  return out
}
