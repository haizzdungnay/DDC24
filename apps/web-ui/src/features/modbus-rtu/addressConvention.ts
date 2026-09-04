/* `ISS-PIO-21` — quy ước địa chỉ Modbus: offset protocol ↔ tham chiếu vendor
 * (F-PIO-020, đề bài §23).
 *
 * TRIỆU CHỨNG: người dùng cầm datasheet ghi `40102` phải TỰ TRỪ để gõ `101`. Ô
 * nhập còn ghi thẳng lời nhắc "nhiều tài liệu đánh số từ 1 — trừ đi 1 khi nhập",
 * tức sản phẩm biết vấn đề tồn tại và giao nó cho người dùng làm bằng tay.
 *
 * VÌ SAO ĐÂY LÀ CHỖ NGUY HIỂM: sai một đơn vị không làm gì hỏng ồn ào cả. Điểm
 * vẫn đọc, quality vẫn GOOD, đồ thị vẫn chạy — chỉ là nó đang đọc thanh ghi bên
 * cạnh. Một nhiệt độ gió cấp hoá ra là nhiệt độ gió hồi.
 *
 * Giữ đồng bộ với `apps/web-api/internal/modbusrtu/address.go`. Hai bộ quy tắc
 * cho một phép đổi là hai bộ có thể lệch nhau, nên các con số dưới đây là bản
 * sao có chủ đích của cùng một hằng số, không phải một cách hiểu thứ hai.
 */

export type ModbusAddressConvention = 'protocol' | 'vendor'

export type ModbusRegisterType = 'coil' | 'discrete_input' | 'input_register' | 'holding_register'

/** Số đầu mỗi vùng dữ liệu theo cách đánh số của tài liệu thiết bị. */
const vendorBases: Record<ModbusRegisterType, number> = {
  coil: 1,
  discrete_input: 10001,
  input_register: 30001,
  holding_register: 40001
}

/** Offset lớn nhất một khung Modbus chở được. */
const maxProtocolAddress = 65535

/* Trần của mỗi vùng dừng ngay DƯỚI số đầu vùng kế tiếp.
 *
 * `40102` là số của vùng Holding Register, không lẫn vào đâu được. Nếu Input
 * Register (số đầu 30001) cũng nhận nó thì phép trừ cho ra offset 10101 — hợp
 * lệ, trỏ vào chỗ hoàn toàn khác, và không có gì báo. */
export function vendorRange(registerType: string): { base: number; maxOffset: number } | undefined {
  const base = vendorBases[registerType as ModbusRegisterType]
  if (base === undefined) return undefined
  let maxOffset = maxProtocolAddress
  for (const other of Object.values(vendorBases)) {
    if (other <= base) continue
    maxOffset = Math.min(maxOffset, other - base - 1)
  }
  return { base, maxOffset }
}

/** Offset protocol → số như trong datasheet. `undefined` khi không suy được. */
export function vendorReference(registerType: string, protocolAddress: number): number | undefined {
  const range = vendorRange(registerType)
  if (!range || !Number.isInteger(protocolAddress) || protocolAddress < 0 || protocolAddress > range.maxOffset) return undefined
  return range.base + protocolAddress
}

/** Số trong datasheet → offset protocol. `undefined` khi số không thuộc vùng đó. */
export function protocolAddress(registerType: string, reference: number): number | undefined {
  const range = vendorRange(registerType)
  if (!range || !Number.isInteger(reference)) return undefined
  const offset = reference - range.base
  if (offset < 0 || offset > range.maxOffset) return undefined
  return offset
}

/** Con số hiện trong ô nhập theo quy ước đang chọn. */
export function displayAddress(convention: ModbusAddressConvention, registerType: string, protocolValue: number): number | undefined {
  return convention === 'vendor' ? vendorReference(registerType, protocolValue) : protocolValue
}

/** Con số người dùng vừa gõ → offset protocol để lưu. */
export function storedAddress(convention: ModbusAddressConvention, registerType: string, typed: number): number | undefined {
  return convention === 'vendor' ? protocolAddress(registerType, typed) : typed
}

/** Vắng mặt = `protocol`, khớp cách backend hiểu cấu hình đời cũ. */
export function normalizeConvention(value: unknown): ModbusAddressConvention {
  return value === 'vendor' ? 'vendor' : 'protocol'
}
