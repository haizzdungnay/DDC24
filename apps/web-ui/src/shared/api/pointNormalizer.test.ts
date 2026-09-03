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

// PA3-F03/F04 — normalizer phải GIỮ đủ field backend đã trả, và không được
// đóng dấu thời gian lên dữ liệu không có mốc thời gian.
describe('PA3 — trung thực thời gian và đủ trường chẩn đoán', () => {
  it('PA3-F04: thiếu timestamp ⇒ updatedAt undefined, KHÔNG phải giờ hiện tại', () => {
    // Bản cũ kết thúc bằng `?? nowIso()`: một cảm biến chết cứng hiện "vừa
    // xong" trên mọi màn hình và `isFreshIso()` coi nó là dữ liệu tươi.
    expect(normalizePoint({ id: 'UI-01', kind: 'UI', value: 21 }).updatedAt).toBeUndefined()
    expect(normalizePoint({ id: 'UI-01', kind: 'UI', value: 21, updatedAt: '' }).updatedAt).toBeUndefined()
    expect(normalizePoint({ id: 'UI-01', kind: 'UI', value: 21, updatedAt: 'khong-phai-thoi-gian' }).updatedAt).toBeUndefined()
  })

  it('PA3-F04: timestamp THẬT vẫn được giữ nguyên văn', () => {
    const point = normalizePoint({ id: 'UI-01', kind: 'UI', value: 21, updatedAt: '2026-08-08T03:00:00Z' })
    expect(point.updatedAt).toBe('2026-08-08T03:00:00Z')
    expect(point.timestamp).toBe('2026-08-08T03:00:00Z')
  })

  it('PA3-F03: giữ overrideExpiresInS, quality_reason, bus/slave/exception/online', () => {
    // Backend `PointDTO` đã có sẵn các trường này; bản cũ làm rơi hết nên Point
    // Detail không có gì để hiện và không ai biết output còn bị ép bao lâu.
    const point = normalizePoint({
      id: 'MB-01', kind: 'modbus_rtu', value: 3.2, quality: 'bad',
      overrideExpiresInS: 272, quality_reason: 'timeout',
      bus_id: 1, slave_addr: 12, exception_code: 2, online: false
    })
    expect(point.overrideExpiresInS).toBe(272)
    expect(point.qualityReason).toBe('timeout')
    expect(point.busId).toBe(1)
    expect(point.slaveAddr).toBe(12)
    expect(point.exceptionCode).toBe(2)
    expect(point.online).toBe(false)
  })

  it('PA3-F03: online không được báo ⇒ undefined, khác hẳn false', () => {
    // "Producer không nói" và "producer nói là mất kết nối" là hai chuyện khác
    // nhau; gộp lại sẽ báo offline giả cho mọi point không phải Modbus.
    expect(normalizePoint({ id: 'UI-01', kind: 'UI', value: 1 }).online).toBeUndefined()
  })

  it('PA3-F05: TTL bằng 0 nghĩa là không có lệnh có thời hạn', () => {
    expect(normalizePoint({ id: 'AO-01', kind: 'AO', value: 1, overrideExpiresInS: 0 }).overrideExpiresInS).toBeUndefined()
  })
})

describe('ISS-PIO-35 — quality fail-closed xuyên tầng', () => {
  /* Kịch bản NGUYÊN VĂN trong `F-PIO-001`, đã truy đủ đường: một Virtual Point
   * có `source = PROGRAM`, `boundPointId = "AV-3"`, Core chưa publish slot.
   * Backend làm ĐÚNG — `points.go` trả `{"value": null, "quality": "unknown"}`.
   * FE nhận, không khớp `offline`, `fault` không `true`, `online` không
   * `false`, rồi rơi vào nhánh cuối của `normalizeQuality` và ra **`good`**.
   * Trang Giám sát vẽ huy hiệu GOOD cho một điểm không ai đọc được. */
  it('VP trỏ tới slot Core chưa publish KHÔNG được hiện good', () => {
    const point = normalizePoint({ id: 'VP1', kind: 'virtual', value: null, quality: 'unknown', source: 'PROGRAM' })
    expect(point.quality).toBe('unknown')
    expect(point.value).toBeUndefined()
  })

  it('điểm Modbus cấu hình sai giữ nguyên CONFIG_ERROR thay vì bị hạ về good', () => {
    const point = normalizePoint({ id: 'EXT1', kind: 'modbus_rtu', value: null, quality: 'CONFIG_ERROR' })
    expect(point.quality).toBe('config_error')
  })

  it('một mức mà producer đời mới vừa thêm ra unknown, không ra good', () => {
    expect(normalizePoint({ id: 'UI-01', kind: 'UI', value: 21, quality: 'DEGRADED_SOMEHOW' }).quality).toBe('unknown')
  })

  it('khoá quality vắng mặt là KHÔNG BIẾT, không phải tin tốt', () => {
    expect(normalizePoint({ id: 'UI-02', kind: 'UI', value: 21 }).quality).toBe('unknown')
  })

  /* Yêu cầu thứ ba của issue: `reason`, `timestamp`, `data-age` phải đi xuyên
   * tầng. Ghim lại để chúng không rụng mất trong một lần dọn dẹp sau này —
   * một quality không có lý do buộc người vận hành phải đoán. */
  it('giữ lý do và mốc thời gian của producer đi kèm quality', () => {
    const point = normalizePoint({
      id: 'EXT2',
      kind: 'modbus_rtu',
      value: null,
      quality: 'BAD',
      quality_reason: 'CRC_ERROR',
      updated_at: '2026-09-03T10:00:00Z'
    })
    expect(point.quality).toBe('bad')
    expect(point.qualityReason).toBe('CRC_ERROR')
    expect(point.updatedAt).toBe('2026-09-03T10:00:00Z')
  })
})
