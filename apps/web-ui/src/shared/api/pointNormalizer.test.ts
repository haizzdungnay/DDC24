import { describe, expect, it } from 'vitest'
import { canonicalOutputPointId } from '../utils'
import { normalizePoint } from './pointNormalizer'

describe('point normalizer output namespace', () => {
  it('maps global AO channel 19 to canonical AO-03', () => {
    expect(normalizePoint({ id: 'AO-03', kind: 'AO', channel: 19, value: 0 }).id).toBe('AO-03')
  })

  it('maps global DO channel 21 to canonical DO-01', () => {
    expect(normalizePoint({ id: 'DO-01', kind: 'DO', channel: 21, value: false }).id).toBe('DO-01')
  })

  it('preserves already-local output channels', () => {
    expect(normalizePoint({ id: 'AO-03', kind: 'AO', channel: 3, value: 0 }).id).toBe('AO-03')
    expect(normalizePoint({ id: 'DO-01', kind: 'DO', channel: 1, value: false }).id).toBe('DO-01')
  })

  it('migrates stale global output IDs stored by the previous frontend', () => {
    expect(canonicalOutputPointId('AO-19')).toBe('AO-03')
    expect(canonicalOutputPointId('DO-21')).toBe('DO-01')
  })

  it('preserves canonical Modbus RTU metadata and OFFLINE quality', () => {
    const point = normalizePoint({
      point_id: 'MB-AHU-SAT', tag_name: 'ahu1 sat', display_name: 'Supply air',
      kind: 'modbus_rtu', value: 21.5, quality: 'OFFLINE', fault: true,
      source: 'modbus_rtu', data_type: 'float32', read_write: 'read'
    })
    expect(point).toMatchObject({
      id: 'MB-AHU-SAT', tag: 'ahu1 sat', name: 'Supply air', kind: 'modbus_rtu',
      quality: 'offline', source: 'modbus_rtu', dataType: 'float32', readWrite: 'read'
    })
  })
})

// Finding REV-FE-01 và REV-FE-04 của rà soát BE/FE ngày 2026-08-06
// (`docs/07_records/reviews/CODE_REVIEW_BE_FE_2026-08-06.md`).
//
// Cả hai đều là lỗi "bịa một giá trị hợp lý thay vì nói chưa biết" — nguy hiểm
// hơn lỗi ồn ào vì không có triệu chứng: một con số trông hợp lý, không đổi bao
// giờ, và không ai nghĩ để nghi ngờ.
describe('biên normalizer không được bịa giá trị', () => {
  it('REV-FE-01: open và closed là hai trạng thái ĐỐI LẬP', () => {
    // `DoSafeState = 'open' | 'closed'` — chính kiểu dữ liệu của dự án nói hai
    // giá trị này ngược nhau. Bản cũ xếp cả hai vào truthy nên tiếp điểm đang
    // mở hiện lên giao diện thành ON / đã cấp điện.
    expect(normalizePoint({ id: 'DO-01', kind: 'DO', value: 'closed' }).value).toBe(true)
    expect(normalizePoint({ id: 'DO-01', kind: 'DO', value: 'open' }).value).toBe(false)
    expect(normalizePoint({ id: 'DO-02', kind: 'DO', value: 'OPEN' }).value).toBe(false)
    expect(normalizePoint({ id: 'DO-02', kind: 'DO', value: ' Closed ' }).value).toBe(true)
  })

  it('REV-FE-01: các cặp trạng thái nhị phân khác vẫn giữ nguyên nghĩa', () => {
    for (const truthy of ['true', 'on', 'active', 'energized']) {
      expect(normalizePoint({ id: 'DO-01', kind: 'DO', value: truthy }).value).toBe(true)
    }
    for (const falsy of ['false', 'off', 'inactive', 'deenergized']) {
      expect(normalizePoint({ id: 'DO-01', kind: 'DO', value: falsy }).value).toBe(false)
    }
  })

  it('REV-FE-04: point chưa có số đo ra undefined, KHÔNG ra 0', () => {
    // Một point Modbus RTU chưa từng được poll, hoặc point core có `value`
    // vắng/null. Trả 0 làm bảng Monitor/Trends hiện "0 °C / 0 %" như số đo thật
    // và biểu đồ live ghi số 0 đó vào đuôi đồ thị.
    expect(normalizePoint({ id: 'MB-SAT', kind: 'modbus_rtu' }).value).toBeUndefined()
    expect(normalizePoint({ id: 'MB-SAT', kind: 'modbus_rtu', value: null }).value).toBeUndefined()
    expect(normalizePoint({ id: 'UI-01', kind: 'UI', value: undefined }).value).toBeUndefined()
  })

  it('REV-FE-04: giá trị 0 THẬT vẫn phải giữ nguyên là 0', () => {
    // Bản vá không được đi quá đà: 0 đo được khác hẳn 0 bịa ra.
    expect(normalizePoint({ id: 'UI-01', kind: 'UI', value: 0 }).value).toBe(0)
    expect(normalizePoint({ id: 'UI-01', kind: 'UI', value: '0' }).value).toBe(0)
    expect(normalizePoint({ id: 'DO-01', kind: 'DO', value: false }).value).toBe(false)
  })
})
