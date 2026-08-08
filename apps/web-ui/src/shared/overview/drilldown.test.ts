import { describe, expect, it } from 'vitest'
import { resolveDrilldown, safeInternalLink } from './drilldown'

/**
 * PA3-204 / PA3-D06 — resolver drill-down.
 *
 * Điều được bảo vệ ở đây không phải là "link đúng chỗ" mà là "dữ liệu backend
 * không điều khiển được đường điều hướng của giao diện".
 */
describe('resolveDrilldown', () => {
  it('dựng đường đi từ cặp (loại, id) đã đóng', () => {
    expect(resolveDrilldown('point', 'UI-03')).toBe('/monitor?point=UI-03')
    expect(resolveDrilldown('alarm', 'A-12')).toBe('/alarms?alarm=A-12')
    expect(resolveDrilldown('modbus_device', 'PUMP-02')).toBe('/eng/modbus-rtu/devices?q=PUMP-02')
    expect(resolveDrilldown('subsystem', 'historian')).toBe('/trends')
  })

  it('mã hoá id để một tên do người dùng đặt không phá được query string', () => {
    expect(resolveDrilldown('point', 'A&b=c')).toBe('/monitor?point=A%26b%3Dc')
  })

  it('trả null cho loại không nhận ra thay vì đoán', () => {
    expect(resolveDrilldown('firmware_blob', 'x')).toBeNull()
    expect(resolveDrilldown('subsystem', 'khong-ton-tai')).toBeNull()
    expect(resolveDrilldown('point', '   ')).toBeNull()
  })
})

describe('safeInternalLink', () => {
  it('chỉ nhận đường dẫn nội bộ nằm trong bảng route đã biết', () => {
    expect(safeInternalLink('/diagnostics')).toBe('/diagnostics')
    expect(safeInternalLink('/monitor?group=local')).toBe('/monitor?group=local')
  })

  it('từ chối mọi thứ có thể đưa người dùng ra ngoài ứng dụng', () => {
    // Đây là lý do tồn tại của hàm: backend (hoặc thứ gì đó chảy vào backend)
    // không được phép quyết định trình duyệt đi đâu.
    expect(safeInternalLink('https://example.com/phish')).toBeNull()
    expect(safeInternalLink('//example.com')).toBeNull()
    expect(safeInternalLink('javascript:alert(1)')).toBeNull()
    expect(safeInternalLink('/khong-co-route-nay')).toBeNull()
    expect(safeInternalLink(undefined)).toBeNull()
  })
})
