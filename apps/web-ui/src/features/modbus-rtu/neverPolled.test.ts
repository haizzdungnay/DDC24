import { describe, expect, it } from 'vitest'
import type { ModbusRTUDiagnostics } from '../../shared/types'

/**
 * Khoá luật phân biệt "chưa từng được poll" với "mất liên lạc" — bẫy số 1 của
 * `HW-FOXLINX-RS485-HANDOVER-001` §5.
 *
 * Luật nằm ở một biểu thức lọc duy nhất, nhưng nó mang một quyết định chẩn đoán:
 * `total_polls === 0` nghĩa là lỗi **cấu hình** (profile không giải được, bus
 * không có cổng vật lý), còn `online === false` sau khi đã poll nghĩa là lỗi
 * **dây/thiết bị**. Trộn hai thứ là buộc người đi hiện trường dò dây cho một
 * lỗi nằm trong file JSON.
 */

function diag(overrides: Partial<ModbusRTUDiagnostics>): ModbusRTUDiagnostics {
  return {
    device_id: 'DEV-1', slave_id: 1, bus_id: 1, online: false,
    total_polls: 0, total_errors: 0, timeout_errors: 0, crc_errors: 0,
    retry_attempts: 0, consecutive_errors: 0, ...overrides
  } as ModbusRTUDiagnostics
}

/** Cùng biểu thức mà `NeverPolledWarning` dùng. */
const neverPolled = (rows: ModbusRTUDiagnostics[]) => rows.filter((row) => row.total_polls === 0)

describe('Bẫy #1 — chưa từng được poll ≠ mất liên lạc', () => {
  it('thiết bị chưa từng poll bị bắt', () => {
    expect(neverPolled([diag({ total_polls: 0 })])).toHaveLength(1)
  })

  it('thiết bị ĐÃ poll rồi mất liên lạc KHÔNG bị bắt — đó là lỗi dây, không phải cấu hình', () => {
    const offline = diag({ total_polls: 4210, total_errors: 4210, online: false, consecutive_errors: 12 })
    expect(
      neverPolled([offline]),
      'gộp thiết bị offline vào cảnh báo cấu hình sẽ đẩy người đi hiện trường đi sai hướng'
    ).toHaveLength(0)
  })

  it('thiết bị đang chạy bình thường KHÔNG bị bắt', () => {
    expect(neverPolled([diag({ total_polls: 100, online: true })])).toHaveLength(0)
  })

  it('không dùng `online` làm điều kiện — thiết bị chưa poll cũng online=false', () => {
    // Chiều xuôi đúng nhưng chiều ngược thì không: mọi thiết bị chưa poll đều
    // offline, còn thiết bị offline thì chưa chắc là chưa poll.
    const rows = [diag({ total_polls: 0, online: false }), diag({ slave_id: 2, total_polls: 900, online: false })]
    expect(neverPolled(rows).map((row) => row.slave_id)).toEqual([1])
  })
})
