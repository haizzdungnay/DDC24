import { describe, expect, it } from 'vitest'
import { displayAddress, normalizeConvention, protocolAddress, storedAddress, vendorRange, vendorReference } from './addressConvention'

/* `ISS-PIO-21` — quy ước địa chỉ Modbus (F-PIO-020, đề bài §23).
 *
 * Người dùng cầm datasheet ghi `40102` phải tự trừ để gõ `101`. Sai một đơn vị
 * không làm gì hỏng ồn ào: điểm vẫn đọc, quality vẫn GOOD — chỉ là đang đọc
 * thanh ghi bên cạnh.
 */

it('đúng ví dụ trong issue: 40102 trên datasheet là offset 101', () => {
  expect(protocolAddress('holding_register', 40102)).toBe(101)
  expect(vendorReference('holding_register', 101)).toBe(40102)
})

it('bốn vùng dữ liệu có bốn số đầu theo quy ước Modbus', () => {
  expect(vendorReference('coil', 0)).toBe(1)
  expect(vendorReference('discrete_input', 0)).toBe(10001)
  expect(vendorReference('input_register', 0)).toBe(30001)
  expect(vendorReference('holding_register', 0)).toBe(40001)
})

/* Số nằm ngoài vùng của CHÍNH kiểu thanh ghi đang chọn bị từ chối.
 *
 * Gõ `40102` khi đã chọn Input Register là mâu thuẫn có thật. Nhận nó sẽ cho ra
 * offset 10101 — hợp lệ, trỏ vào chỗ hoàn toàn khác, không có gì báo. */
it('từ chối số của vùng khác', () => {
  expect(protocolAddress('input_register', 40102)).toBeUndefined()
  expect(protocolAddress('coil', 40102)).toBeUndefined()
  expect(protocolAddress('holding_register', 40000)).toBeUndefined()
})

it('trần mỗi vùng dừng ngay dưới số đầu vùng kế tiếp', () => {
  expect(vendorRange('coil')).toEqual({ base: 1, maxOffset: 9999 })
  expect(vendorRange('discrete_input')).toEqual({ base: 10001, maxOffset: 19999 })
  expect(vendorRange('input_register')).toEqual({ base: 30001, maxOffset: 9999 })
  expect(vendorRange('holding_register')).toEqual({ base: 40001, maxOffset: 65535 })
})

// Vùng cao nhất đủ chỗ cho cách viết 6 chữ số của thiết bị đời mới.
it('Holding Register nhận ký hiệu 6 chữ số', () => {
  expect(protocolAddress('holding_register', 105536)).toBe(65535)
})

it('kiểu thanh ghi lạ không suy ra con số gần đúng', () => {
  expect(vendorRange('gi-do-la')).toBeUndefined()
  expect(vendorReference('gi-do-la', 100)).toBeUndefined()
  expect(protocolAddress('gi-do-la', 40102)).toBeUndefined()
})

describe('đổi giữa ô nhập và giá trị lưu', () => {
  it('quy ước protocol giữ nguyên con số', () => {
    expect(displayAddress('protocol', 'holding_register', 101)).toBe(101)
    expect(storedAddress('protocol', 'holding_register', 101)).toBe(101)
  })

  it('quy ước vendor đổi hai chiều', () => {
    expect(displayAddress('vendor', 'holding_register', 101)).toBe(40102)
    expect(storedAddress('vendor', 'holding_register', 40102)).toBe(101)
  })

  /* Không ghi bừa khi con số không thuộc vùng: giá trị `undefined` là tín hiệu
   * để giao diện GIỮ NGUYÊN địa chỉ cũ thay vì lưu một offset trỏ chỗ khác. */
  it('trả undefined khi số không thuộc vùng đang chọn', () => {
    expect(storedAddress('vendor', 'input_register', 40102)).toBeUndefined()
  })
})

// Vắng mặt = `protocol`, khớp cách backend hiểu cấu hình đời cũ.
it('quy ước vắng mặt đọc thành protocol', () => {
  expect(normalizeConvention(undefined)).toBe('protocol')
  expect(normalizeConvention('gi-do-la')).toBe('protocol')
  expect(normalizeConvention('vendor')).toBe('vendor')
})
