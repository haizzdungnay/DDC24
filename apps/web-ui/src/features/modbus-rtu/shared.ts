import { ApiError } from '../../shared/types'
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
  parity: 'N', stop_bits: 1, slave_id: 1, poll_ms: 1000, timeout_ms: 300, retry: 2,
  offline_after_errors: 2, offline_probe_ms: 10000,
  // `ISS-PIO-22` — 0 = suy từ `poll_ms`; thiết bị mới không tự ép một nhịp nào.
  poll_fast_ms: 0, poll_slow_ms: 0
}

export const emptyPoint: ModbusRTUPoint = {
  point_id: '', device_id: '', tag_name: '', display_name: '', register_type: 'holding_register',
  address: 0, data_type: 'uint16', byte_order: 'big', word_order: 'high_low', scale: 1,
  offset: 0, unit: '', read_write: 'read', default_value: 0, safe_value: 0, enabled: true,
  // `ISS-PIO-21` — mặc định là quy ước cũ, để form mới không đổi nghĩa con số
  // mà người dùng quen gõ.
  address_convention: 'protocol',
  // `ISS-PIO-22` — `normal` là mặc định và mang đúng `poll_ms` của thiết bị,
  // nên điểm mới tạo giữ đúng hành vi mà người dùng đang quen.
  poll_group: 'normal'
}

export const inputClass = 'h-10 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] px-3 text-sm text-[var(--c-text)]'
export const buttonClass = 'h-10 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-4 text-sm font-semibold text-[var(--c-text)] hover:border-[var(--c-line-strong)]'

/** Ký hiệu "không có dữ liệu". Dùng thay cho 0/BAD khi authority chưa trả gì. */
export const NO_DATA = '—'

/** BUG-014 (TR-MKDDC24-P1-20260814-01): toàn feature Modbus RTU trước đây
 *  không qua `useI18n`, nên chọn EN không đổi được chữ nào ở đây. Các hằng
 *  số/hàm ở module này KHÔNG phải component nên không gọi được hook — mỗi cái
 *  nay nhận `lang` (mặc định 'vi') từ nơi gọi, cùng quy ước với
 *  `healthReasonLabel` ở `shared/components/pa3/StateAtoms.tsx`. */
export function readOnlyHint(lang: 'vi' | 'en' = 'vi'): string {
  return lang === 'en'
    ? 'Only the Admin role can change Modbus RTU configuration.'
    : 'Chỉ vai trò Admin được thay đổi cấu hình Modbus RTU.'
}

/** Mô tả lỗi API kèm TỪNG trường sai, thay vì chỉ câu tóm tắt.
 *
 * Backend trả `{"error":"validation failed","details":[{path,message,reason}]}`
 * và `apiClient` đã parse `details` vào `ApiError`. Nhưng mọi page Modbus RTU
 * chỉ hiện `error.message`, nên người dùng nhận đúng hai chữ **"validation
 * failed"** và không có cách nào biết ô nào sai — phải đoán từng ô.
 *
 * Quan sát thật trên bo 2026-08-06: người dùng nhập `device_id = "2"`, bị từ
 * chối, và trên màn hình không có gì ngoài "validation failed". Lý do thật —
 * `device_id` phải bắt đầu bằng chữ — nằm trong `details[0]` và bị vứt đi.
 *
 * Từ chối mà không nói vì sao thì tệ hơn từ chối: người dùng không còn đường
 * tự sửa, kể cả khi lỗi rất nhỏ.
 */
export function describeApiError(error: unknown, fallback: string, lang: 'vi' | 'en' = 'vi'): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : fallback
  }
  if (error.details.length === 0) return error.message || fallback
  const unknownField = lang === 'en' ? '(unknown field)' : '(không rõ trường)'
  const invalidReason = lang === 'en' ? 'invalid' : 'không hợp lệ'
  const parts = error.details.map((detail) => {
    const field = detail.path || unknownField
    const reason = detail.message || detail.reason || invalidReason
    return `${field}: ${reason}`
  })
  return `${error.message} — ${parts.join('; ')}`
}

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
export function deviceLinkLabel(row?: ModbusRTUDiagnostics, lang: 'vi' | 'en' = 'vi'): string {
  if (!row) return NO_DATA
  if (row.online) return lang === 'en' ? 'Communicating' : 'Đang liên lạc'
  if (row.total_polls === 0) return lang === 'en' ? 'Never communicated' : 'Chưa liên lạc lần nào'
  if (row.consecutive_errors > 0) return lang === 'en' ? 'Communication lost' : 'Mất liên lạc'
  return NO_DATA
}
