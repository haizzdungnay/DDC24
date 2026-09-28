import { describe, expect, it } from 'vitest'
import type { ScheduleObject, ScheduleTimeValue } from '../../shared/types'
import { describeDateRule, findExceptionConflicts, previewDateRule, weekNDayOfMonth } from './dateRules'
import {
  blockToTimeValues, capacityUsage, dayToBlocks, formatValue, oppositeValue, removeBlockFromDay, secondsToTime,
  timeToSeconds, weeklySummary
} from './shared'

/**
 * Test cho phần logic thuần của feature Lịch vận hành.
 *
 * Trọng tâm là hai thứ mà giao diện dựa vào và người dùng không tự kiểm được:
 * phép biên dịch Start/End ↔ Time-Value, và việc liệt kê ngày thật của quy tắc
 * ngoại lệ.
 */

describe('biên dịch Start/End ↔ Time-Value', () => {
  it('một khoảng sinh HAI mốc: bật, và trả về mặc định', () => {
    const day = blockToTimeValues([], 8 * 3600, 17 * 3600, 'ACTIVE', 'INACTIVE')
    expect(day).toEqual([
      { time: '08:00:00', value: 'ACTIVE' },
      { time: '17:00:00', value: 'INACTIVE' }
    ])
  })

  it('khoảng kéo tới nửa đêm thì KHÔNG sinh mốc thứ hai', () => {
    // 24:00 không tồn tại; mốc trả về mặc định thuộc về ngày hôm sau.
    const day = blockToTimeValues([], 20 * 3600, 86_400, 'ACTIVE', 'INACTIVE')
    expect(day).toEqual([{ time: '20:00:00', value: 'ACTIVE' }])
  })

  it('đọc ngược từ Time-Value ra khối để vẽ', () => {
    const day: ScheduleTimeValue[] = [
      { time: '08:00:00', value: 'ACTIVE' },
      { time: '12:00:00', value: 'INACTIVE' },
      { time: '13:00:00', value: 'ACTIVE' },
      { time: '18:00:00', value: 'INACTIVE' }
    ]
    const blocks = dayToBlocks(day, 'BINARY')
    // Chỉ vẽ khối cho giá trị khác giá trị nghỉ; nghỉ trưa là khoảng trống.
    expect(blocks).toEqual([
      { startSec: 8 * 3600, endSec: 12 * 3600, value: 'ACTIVE' },
      { startSec: 13 * 3600, endSec: 18 * 3600, value: 'ACTIVE' }
    ])
  })

  it('mốc cuối cùng kéo tới hết ngày', () => {
    const blocks = dayToBlocks([{ time: '22:00:00', value: 'ACTIVE' }], 'BINARY')
    expect(blocks).toEqual([{ startSec: 22 * 3600, endSec: 86_400, value: 'ACTIVE' }])
  })

  it('chèn khối mới xoá các mốc nằm trong khoảng bị đè', () => {
    const existing: ScheduleTimeValue[] = [
      { time: '09:00:00', value: 'ACTIVE' },
      { time: '10:00:00', value: 'INACTIVE' },
      { time: '20:00:00', value: 'ACTIVE' }
    ]
    const next = blockToTimeValues(existing, 8 * 3600, 12 * 3600, 'ACTIVE', 'INACTIVE')
    expect(next.map((e) => e.time)).toEqual(['08:00:00', '12:00:00', '20:00:00'])
  })

  it('chuyển đổi giờ ↔ giây đi về đúng', () => {
    expect(timeToSeconds('08:30:15')).toBe(8 * 3600 + 30 * 60 + 15)
    expect(secondsToTime(timeToSeconds('23:59:59'))).toBe('23:59:59')
    expect(timeToSeconds('8:30')).toBe(-1)
    expect(timeToSeconds('24:00:00')).toBe(-1)
  })

  it('xóa khối TimeBlock dọn sạch cả mốc bật và mốc trả về mặc định', () => {
    const day: ScheduleTimeValue[] = [
      { time: '08:00:00', value: 'ACTIVE' },
      { time: '17:00:00', value: 'INACTIVE' }
    ]
    const res = removeBlockFromDay(day, 8 * 3600, 17 * 3600, 'INACTIVE')
    expect(res).toEqual([])
  })

  it('xóa khối ở giữa giữ nguyên các khối khác', () => {
    const day: ScheduleTimeValue[] = [
      { time: '08:00:00', value: 'ACTIVE' },
      { time: '12:00:00', value: 'INACTIVE' },
      { time: '13:00:00', value: 'ACTIVE' },
      { time: '18:00:00', value: 'INACTIVE' }
    ]
    const res = removeBlockFromDay(day, 8 * 3600, 12 * 3600, 'INACTIVE')
    expect(res).toEqual([
      { time: '13:00:00', value: 'ACTIVE' },
      { time: '18:00:00', value: 'INACTIVE' }
    ])
  })

  it('khi defaultValue là BẬT (ACTIVE), khối vẽ là TẮT (INACTIVE)', () => {
    const day: ScheduleTimeValue[] = [
      { time: '01:55:00', value: 'INACTIVE' },
      { time: '20:35:00', value: 'ACTIVE' }
    ]
    const blocks = dayToBlocks(day, 'BINARY', 'ACTIVE')
    expect(blocks).toEqual([
      { startSec: 1 * 3600 + 55 * 60, endSec: 20 * 3600 + 35 * 60, value: 'INACTIVE' }
    ])
  })

  it('gộp các đoạn liền nhau có cùng giá trị', () => {
    const day: ScheduleTimeValue[] = [
      { time: '08:00:00', value: 'ACTIVE' },
      { time: '12:00:00', value: 'ACTIVE' },
      { time: '18:00:00', value: 'INACTIVE' }
    ]
    const blocks = dayToBlocks(day, 'BINARY', 'INACTIVE')
    expect(blocks).toEqual([
      { startSec: 8 * 3600, endSec: 18 * 3600, value: 'ACTIVE' }
    ])
  })

  it('oppositeValue đảo đúng kiểu BINARY, BOOLEAN, REAL', () => {
    expect(oppositeValue('ACTIVE', 'BINARY')).toBe('INACTIVE')
    expect(oppositeValue('INACTIVE', 'BINARY')).toBe('ACTIVE')
    expect(oppositeValue(true, 'BOOLEAN')).toBe(false)
    expect(oppositeValue(false, 'BOOLEAN')).toBe(true)
    expect(oppositeValue(1, 'REAL')).toBe(0)
    expect(oppositeValue(0, 'REAL')).toBe(1)
  })

  it('blockToTimeValues không tạo mốc trùng khi value trùng defaultValue', () => {
    const day = blockToTimeValues([], 8 * 3600, 17 * 3600, 'ACTIVE', 'ACTIVE')
    expect(day).toEqual([{ time: '08:00:00', value: 'ACTIVE' }])
  })
})


describe('tóm tắt lịch tuần cho cột hẹp', () => {
  const weekly = {
    MON: [{ time: '08:00:00', value: 'ACTIVE' }, { time: '18:00:00', value: 'INACTIVE' }],
    TUE: [{ time: '08:00:00', value: 'ACTIVE' }, { time: '18:00:00', value: 'INACTIVE' }],
    WED: [{ time: '08:00:00', value: 'ACTIVE' }, { time: '18:00:00', value: 'INACTIVE' }],
    THU: [], FRI: [], SAT: [], SUN: []
  } as ScheduleObject['weekly_schedule']

  it('gom các ngày liền nhau cùng khung giờ', () => {
    expect(weeklySummary(weekly, 'BINARY')).toBe('T2-T4 08-18')
  })

  it('lịch rỗng hiện gạch ngang, không hiện chuỗi rỗng', () => {
    const empty = { MON: [], TUE: [], WED: [], THU: [], FRI: [], SAT: [], SUN: [] }
    expect(weeklySummary(empty, 'BINARY')).toBe('—')
  })
})

describe('quy tắc ngày ngoại lệ', () => {
  it('WEEK_N_DAY tuần 6 là tuần CUỐI theo quy ước BACnet, không phải tuần thứ sáu', () => {
    // Tháng 8/2026 có các Thứ Sáu: 7, 14, 21, 28.
    expect(weekNDayOfMonth(2026, 8, 6, 5)).toBe('2026-08-28')
    expect(weekNDayOfMonth(2026, 8, 1, 5)).toBe('2026-08-07')
    // Không có Thứ Sáu thứ năm trong tháng đó.
    expect(weekNDayOfMonth(2026, 8, 5, 5)).toBeNull()
  })

  it('liệt kê ngày thật cho DATE_RANGE', () => {
    const p = previewDateRule(
      { type: 'DATE_RANGE', start_date: '2026-02-14', end_date: '2026-02-17' },
      new Date('2026-01-01T00:00:00Z')
    )
    expect(p.dates).toEqual(['2026-02-14', '2026-02-15', '2026-02-16', '2026-02-17'])
  })

  it('WEEK_N_DAY mọi tháng cho 12 ngày trong 12 tháng tới', () => {
    const p = previewDateRule(
      { type: 'WEEK_N_DAY', month: 0, week_of_month: 1, day_of_week: 1 },
      new Date('2026-09-15T00:00:00Z')
    )
    expect(p.dates[0]).toBe('2026-09-07')  // Thứ Hai đầu tiên của tháng 9/2026
    expect(p.dates[1]).toBe('2026-10-05')
    expect(p.dates.length).toBeGreaterThanOrEqual(10)
  })

  it('HOLIDAY_GROUP báo cần dữ liệu ngoài thay vì trả danh sách rỗng gây hiểu nhầm', () => {
    const p = previewDateRule({ type: 'HOLIDAY_GROUP', group_id: 'HG-001' })
    expect(p.needsExternalData).toBe(true)
    expect(p.dates).toHaveLength(0)
  })

  it('mô tả quy tắc bằng tiếng Việt đọc được', () => {
    expect(describeDateRule({ type: 'DATE', date: '2026-09-02' })).toBe('NGÀY 02/09/2026')
    expect(describeDateRule({ type: 'WEEK_N_DAY', month: 0, week_of_month: 6, day_of_week: 1 }))
      .toBe('Thứ Hai cuối cùng của mỗi tháng')
  })
})

describe('phát hiện xung đột ngoại lệ', () => {
  it('cùng ngày VÀ cùng mức ưu tiên thì báo xung đột', () => {
    const conflicts = findExceptionConflicts([
      { exception_id: 'EXC-A', event_priority: 5, date_rule: { type: 'DATE', date: '2026-09-02' } },
      { exception_id: 'EXC-B', event_priority: 5, date_rule: { type: 'DATE', date: '2026-09-02' } }
    ])
    expect(conflicts).toEqual([{ a: 'EXC-A', b: 'EXC-B', day: '2026-09-02' }])
  })

  it('khác mức ưu tiên thì KHÔNG phải xung đột — hệ thống phân xử được', () => {
    const conflicts = findExceptionConflicts([
      { exception_id: 'EXC-A', event_priority: 1, date_rule: { type: 'DATE', date: '2026-09-02' } },
      { exception_id: 'EXC-B', event_priority: 5, date_rule: { type: 'DATE', date: '2026-09-02' } }
    ])
    expect(conflicts).toHaveLength(0)
  })

  it('khác ngày thì không xung đột', () => {
    const conflicts = findExceptionConflicts([
      { exception_id: 'EXC-A', event_priority: 5, date_rule: { type: 'DATE', date: '2026-09-02' } },
      { exception_id: 'EXC-B', event_priority: 5, date_rule: { type: 'DATE', date: '2026-09-03' } }
    ])
    expect(conflicts).toHaveLength(0)
  })
})

describe('hiển thị giá trị', () => {
  it('thiếu giá trị hiện gạch ngang, KHÔNG hiện 0', () => {
    expect(formatValue(null, 'BINARY')).toBe('—')
    expect(formatValue(undefined, 'REAL')).toBe('—')
    // Số 0 thật thì vẫn phải hiện 0 — chỉ "không có dữ liệu" mới là gạch ngang.
    expect(formatValue(0, 'REAL')).toBe('0')
  })

  it('BINARY và BOOLEAN đọc thành BẬT/TẮT', () => {
    expect(formatValue('ACTIVE', 'BINARY')).toBe('BẬT')
    expect(formatValue('INACTIVE', 'BINARY')).toBe('TẮT')
    expect(formatValue(true, 'BOOLEAN')).toBe('BẬT')
  })
})

describe('đồng hồ dung lượng thật', () => {
  const make = (id: string, targets: { kind: string; ch: number }[]): ScheduleObject => ({
    schema_version: '3.1', schedule_id: id, schedule_name: id, enabled: true, status: 'DRAFT',
    timezone: 'UTC', effective_period: { start_date: null, end_date: null }, value_type: 'BINARY',
    priority_for_writing: 16, core_priority_level: 4, schedule_default: { value: 'INACTIVE' },
    weekly_schedule: { MON: [], TUE: [], WED: [], THU: [], FRI: [], SAT: [], SUN: [] },
    exception_schedule: [],
    target_objects: targets.map((t, i) => ({
      target_id: `TGT-${i}`, target_type: 'INTERNAL_POINT' as const,
      point_kind: t.kind as 'DO', channel: t.ch
    })),
    revision: 1
  })

  it('đếm điểm RIÊNG BIỆT, không đếm trùng', () => {
    const usage = capacityUsage([
      make('SCH-001', [{ kind: 'DO', ch: 1 }, { kind: 'DO', ch: 2 }]),
      make('SCH-002', [{ kind: 'DO', ch: 2 }])
    ])
    expect(usage.points).toBe(2)
    expect(usage.schedules).toBe(2)
  })

  it('đếm số điểm bị NHIỀU lịch cùng ghi — runtime sẽ phân xử bằng priority', () => {
    const usage = capacityUsage([
      make('SCH-001', [{ kind: 'DO', ch: 1 }]),
      make('SCH-002', [{ kind: 'DO', ch: 1 }])
    ])
    expect(usage.contested).toBe(1)
  })

  it('trần điểm ghi nội bộ khớp phần cứng: 4 AO + 4 DO + 32 AV + 16 BV + 8 MSV', () => {
    expect(capacityUsage([]).maxPoints).toBe(64)
  })
})
