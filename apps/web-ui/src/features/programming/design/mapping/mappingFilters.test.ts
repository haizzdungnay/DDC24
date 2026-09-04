import { describe, expect, it } from 'vitest'
import {
  boundPointKeys,
  matchesAccess,
  matchesPointStatus,
  matchesVariableStatus,
  type MappingPointRow,
  type MappingVariableRow,
} from './mappingViewModel'

/* ISS-PIO-10 (F-PIO-025, đề bài §28) — hai bộ lọc `Access` và `Status`. */

function pointRow(overrides: Partial<MappingPointRow>): MappingPointRow {
  return {
    key: 'LOCAL::UI-01',
    category: 'LOCAL',
    pointId: 'UI-01',
    name: 'Supply air',
    dataType: 'REAL',
    direction: 'READ',
    writable: false,
    value: 21,
    quality: 'GOOD',
    eligibility: 'SUPPORTED',
    compatible: true,
    compatibilityReasons: [],
    ...overrides,
  }
}

function variableRow(overrides: Partial<MappingVariableRow>): MappingVariableRow {
  return {
    id: 'AHU::Fan',
    programId: 'AHU',
    programName: 'AHU',
    name: 'Fan',
    type: 'BOOL',
    direction: 'OUTPUT',
    liveValue: null,
    liveQuality: 'UNKNOWN',
    freshness: 'UNAVAILABLE',
    bindingStatus: 'UNMAPPED',
    eligibility: 'SUPPORTED',
    compatibility: { assignable: true, unitWarning: false, reasons: [] },
    ...overrides,
  }
}

describe('matchesAccess', () => {
  it('READ_WRITE lọt vào CẢ Read lẫn Write', () => {
    const row = pointRow({ direction: 'READ_WRITE', writable: true })
    expect(matchesAccess(row, 'READ')).toBe(true)
    expect(matchesAccess(row, 'WRITE')).toBe(true)
  })

  it('điểm chỉ đọc không lọt vào Write, và ngược lại', () => {
    expect(matchesAccess(pointRow({ direction: 'READ' }), 'WRITE')).toBe(false)
    expect(matchesAccess(pointRow({ direction: 'WRITE' }), 'READ')).toBe(false)
  })

  it('ALL không lọc gì', () => {
    for (const direction of ['READ', 'WRITE', 'READ_WRITE'] as const) {
      expect(matchesAccess(pointRow({ direction }), 'ALL')).toBe(true)
    }
  })
})

describe('boundPointKeys', () => {
  it('chỉ gom Point đang có binding trỏ tới', () => {
    const keys = boundPointKeys([
      variableRow({ point: { category: 'LOCAL', pointId: 'UI-01' }, bindingStatus: 'MAPPED' }),
      variableRow({ bindingStatus: 'UNMAPPED' }),
    ])
    expect(keys.has('LOCAL::UI-01')).toBe(true)
    expect(keys.size).toBe(1)
  })

  it('dựng khoá đúng dạng có deviceId của điểm Modbus', () => {
    const keys = boundPointKeys([
      variableRow({ point: { category: 'MB_RTU', deviceId: 'bus-1-slave-3', pointId: 'coil-1' } }),
    ])
    expect(keys.has('MB_RTU:bus-1-slave-3:coil-1')).toBe(true)
  })
})

describe('matchesPointStatus', () => {
  const bound = new Set(['LOCAL::UI-01'])

  it('Good chỉ nhận chất lượng GOOD', () => {
    expect(matchesPointStatus(pointRow({ quality: 'GOOD' }), 'GOOD', bound)).toBe(true)
    expect(matchesPointStatus(pointRow({ quality: 'OFFLINE' }), 'GOOD', bound)).toBe(false)
    expect(matchesPointStatus(pointRow({ quality: 'STALE' }), 'GOOD', bound)).toBe(false)
  })

  it('Offline KHÔNG nuốt STALE/BAD/UNCERTAIN', () => {
    // Ba cái đó là ba câu trả lời khác nhau của producer; gộp lại là tự dịch
    // lại sự thật của thiết bị.
    expect(matchesPointStatus(pointRow({ quality: 'OFFLINE' }), 'OFFLINE', bound)).toBe(true)
    for (const quality of ['STALE', 'BAD', 'UNCERTAIN'] as const) {
      expect(matchesPointStatus(pointRow({ quality }), 'OFFLINE', bound)).toBe(false)
    }
  })

  it('Unmapped là "chưa có binding", độc lập hoàn toàn với chất lượng', () => {
    // Một điểm vừa chưa map vừa đang offline VẪN phải hiện khi lọc Unmapped:
    // việc cần làm với nó là map, chứ không phải chờ nó online.
    const offlineUnmapped = pointRow({ key: 'LOCAL::UI-09', quality: 'OFFLINE' })
    expect(matchesPointStatus(offlineUnmapped, 'UNMAPPED', bound)).toBe(true)

    const goodMapped = pointRow({ key: 'LOCAL::UI-01', quality: 'GOOD' })
    expect(matchesPointStatus(goodMapped, 'UNMAPPED', bound)).toBe(false)
  })

  it('ALL không lọc gì', () => {
    expect(matchesPointStatus(pointRow({ quality: 'BAD' }), 'ALL', bound)).toBe(true)
  })
})

describe('matchesVariableStatus', () => {
  it('Unmapped ở phía Variable là bindingStatus, không phải chất lượng', () => {
    // Một biến chưa map thì chưa có gì để nói về chất lượng.
    expect(matchesVariableStatus(variableRow({ bindingStatus: 'UNMAPPED' }), 'UNMAPPED')).toBe(true)
    expect(matchesVariableStatus(variableRow({ bindingStatus: 'MAPPED', liveQuality: 'OFFLINE' }), 'UNMAPPED')).toBe(false)

    /* Ca tách bạch hai chiều — và là ca DUY NHẤT bắt được lỗi "đọc chất lượng
     * thay vì bindingStatus". Ở fixture mặc định, biến chưa map cũng có
     * `liveQuality: 'UNKNOWN'`, nên hai cách đọc trùng kết quả và test không
     * phân biệt nổi. Một biến ĐÃ map vào điểm chưa có giá trị live là chuyện
     * bình thường lúc mới nạp cấu hình; nó KHÔNG được hiện khi lọc "Chưa map". */
    expect(matchesVariableStatus(variableRow({ bindingStatus: 'MAPPED', liveQuality: 'UNKNOWN' }), 'UNMAPPED')).toBe(false)
    /* Và chiều ngược lại: biến chưa map mà điểm cũ còn giá trị GOOD vẫn phải
     * hiện khi lọc "Chưa map". */
    expect(matchesVariableStatus(variableRow({ bindingStatus: 'UNMAPPED', liveQuality: 'GOOD' }), 'UNMAPPED')).toBe(true)
  })

  it('Good/Offline ở phía Variable đọc chất lượng live của binding', () => {
    expect(matchesVariableStatus(variableRow({ bindingStatus: 'MAPPED', liveQuality: 'GOOD' }), 'GOOD')).toBe(true)
    expect(matchesVariableStatus(variableRow({ bindingStatus: 'MAPPED', liveQuality: 'OFFLINE' }), 'OFFLINE')).toBe(true)
    expect(matchesVariableStatus(variableRow({ bindingStatus: 'MAPPED', liveQuality: 'STALE' }), 'OFFLINE')).toBe(false)
  })

  it('ALL không lọc gì', () => {
    expect(matchesVariableStatus(variableRow({ liveQuality: 'BAD' }), 'ALL')).toBe(true)
  })
})
