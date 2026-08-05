import type { ModbusRTUDevice, ModbusRTUDiagnostics, ModbusRTUPoint } from '../../shared/types'

/* Phần dùng chung của 4 page Modbus RTU sau khi tách `ModbusRtuPage` monolith
 * theo MBR-B301. Trước đây mỗi mảnh giao diện tự khai báo lại `inputClass`,
 * `emptyDevice`… nên bản sao trong `pages/DevicesPage.tsx` đã bắt đầu trôi khỏi
 * bản gốc. Gom về một chỗ để các page không nói khác nhau về cùng một mặc định. */

// D-14: KHÔNG đặt sẵn '/dev/ttyS3'. Board production Foxlinx chỉ có ttyS2 (dành
// cho MCU STM32) và ttyS5; ttyS3 không tồn tại, nên giá trị mặc định cũ tạo ra
// cấu hình lưu được nhưng không chạy được, và lỗi chỉ lộ ở tầng iobus.
export const emptyDevice: ModbusRTUDevice = {
  device_id: '', display_name: '', enabled: true, rs485_port: '/dev/rs485-1', baud: 19200,
  parity: 'N', stop_bit: 1, slave_id: 1, poll_ms: 1000, timeout_ms: 300, retry: 2,
  offline_after_errors: 2, offline_probe_ms: 10000
}

export const emptyPoint: ModbusRTUPoint = {
  point_id: '', device_id: '', tag_name: '', display_name: '', register_type: 'holding_register',
  address: 0, data_type: 'uint16', byte_order: 'big', word_order: 'high_low', scale: 1,
  offset: 0, unit: '', read_write: 'read', default_value: 0, safe_value: 0, enabled: true
}

export const inputClass = 'h-10 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] px-3 text-sm text-[var(--c-text)]'
export const buttonClass = 'h-10 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-4 text-sm font-semibold text-[var(--c-text)] hover:border-[var(--c-line-strong)]'

/** Ký hiệu "không có dữ liệu". Dùng thay cho 0/BAD khi authority chưa trả gì. */
export const NO_DATA = '—'

export const READ_ONLY_HINT = 'Chỉ vai trò Admin được thay đổi cấu hình Modbus RTU.'

/* D-07: trạng thái giao tiếp của thiết bị phải đến TỪ authority, không được suy
 * diễn ở tầng trình bày.
 *
 * Biểu thức cũ `row.online ? 'GOOD' : row.consecutive_errors ? 'OFFLINE' : 'STALE'`
 * sai hai lần: một thiết bị online nhưng Point đang lỗi decode vẫn hiện GOOD; và
 * thiết bị CHƯA TỪNG được poll (online=false, consecutive_errors=0) hiện STALE
 * — tức "dữ liệu cũ", trong khi sự thật là "chưa có dữ liệu nào".
 *
 * Hàm này KHÔNG gọi ra quality của Point (quality thuộc về Point và do authority
 * cấp); nó chỉ mô tả tình trạng liên lạc với thiết bị. Track B thay bằng
 * `connection_status` từ BE (MBR-B210). */
export function deviceLinkLabel(row?: ModbusRTUDiagnostics): string {
  if (!row) return NO_DATA
  if (row.online) return 'Đang liên lạc'
  if (row.total_polls === 0) return 'Chưa liên lạc lần nào'
  if (row.consecutive_errors > 0) return 'Mất liên lạc'
  return NO_DATA
}
