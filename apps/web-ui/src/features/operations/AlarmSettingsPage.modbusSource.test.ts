import { describe, expect, it } from 'vitest'
import { alarmSourceKindsForTest, channelOptionsForTest, normalizeSourceForTest, pointIdForTest } from './AlarmSettingsPage'
import type { ModbusMappingRow } from '../../shared/types'

/* `ISS-PIO-19` (F-PIO-023) — cảnh báo cho điểm Modbus.
 *
 * `AlarmSourceKind` chỉ nhận `UI, AO, DO, VP`, nên một thanh ghi báo lỗi biến
 * tần (`Fault Word`) — thứ đáng báo động nhất trong tủ — không đặt cảnh báo
 * được.
 */

function slot(extIndex: number, tag: string, enabled = true): ModbusMappingRow {
  return {
    point_id: `p-${extIndex}`, tag_name: tag, device_id: 'vfd-1', bus_id: 'bus-0', slave_id: 1,
    register_type: 'holding', address: 100, registers: 1, data_type: 'uint16',
    read_write: 'read', enabled, ext_index: extIndex
  }
}

it('MB_RTU nằm trong tập kind hợp lệ', () => {
  expect(alarmSourceKindsForTest).toContain('MB_RTU')
})

/* `pointId` phải là slot ext, KHÔNG phải danh theo kind.
 *
 * `MB_RTU-03` là chuỗi Core không phân giải được, và Core từ chối MỘT dòng là
 * bỏ nạp TOÀN BỘ cấu hình cảnh báo — cả tủ mất cảnh báo. */
it('pointId của nguồn Modbus là EXT-NN', () => {
  expect(pointIdForTest('MB_RTU', 3)).toBe('EXT-03')
  expect(pointIdForTest('MB_RTU', 137)).toBe('EXT-137')
  expect(pointIdForTest('UI', 3)).toBe('UI-03')
})

describe('danh sách slot để chọn', () => {
  // Chỉ liệt kê slot có điểm thật: 256 con số trần không nói lên điều gì.
  it('chỉ gồm điểm Modbus đang bật và đã có slot', () => {
    const rows = [slot(3, 'VFD_FAULT'), slot(7, 'VFD_SPEED'), slot(9, 'TAT', false), { ...slot(0, 'CHUA_CAP') }]
    expect(channelOptionsForTest('MB_RTU', [], rows)).toEqual([3, 7])
  })

  it('không có điểm Modbus nào thì danh sách rỗng', () => {
    expect(channelOptionsForTest('MB_RTU', [], [])).toEqual([])
  })
})

describe('chuẩn hoá nguồn Modbus', () => {
  it('giữ nguyên slot đã lưu khi slot đó có thật', () => {
    const rows = [slot(3, 'VFD_FAULT')]
    const source = normalizeSourceForTest({ kind: 'MB_RTU', channel: 3, pointId: 'EXT-03' }, [], rows)
    expect(source).toEqual({ kind: 'MB_RTU', channel: 3, pointId: 'EXT-03' })
  })

  /* Danh sách RỖNG nghĩa là "chưa biết", KHÔNG phải "không có".
   *
   * Viết lại nguồn khi chưa biết sẽ âm thầm đổi một cảnh báo đã lưu sang điểm
   * khác chỉ vì trang chưa tải xong danh sách Modbus — người vận hành mở trang,
   * bấm Lưu, và cảnh báo biến tần lặng lẽ trỏ sang UI-01. */
  it('KHÔNG viết lại nguồn khi chưa tải được danh sách Modbus', () => {
    const source = normalizeSourceForTest({ kind: 'MB_RTU', channel: 137, pointId: 'EXT-137' }, [], [])
    expect(source.kind).toBe('MB_RTU')
    expect(source.channel).toBe(137)
    expect(source.pointId).toBe('EXT-137')
  })

  // Các kind cũ giữ nguyên hành vi.
  it('nguồn UI không đổi', () => {
    expect(normalizeSourceForTest({ kind: 'UI', channel: 2, pointId: 'UI-02' }, [])).toEqual({ kind: 'UI', channel: 2, pointId: 'UI-02' })
  })
})
