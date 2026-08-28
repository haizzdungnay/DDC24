import { describe, expect, it } from 'vitest'
import { commStateOf } from './DiagnosticsPage'

/**
 * Test khoá HÀNH VI cho `T57-1.12` — `CommTile` phân biệt "tắt có chủ đích" với
 * "không đọc được" (đề xuất §6.6-P2b).
 *
 * TRIỆU CHỨNG cũ: cả hai đều ra `N/A`. Một cổng chết và một tính năng cố ý chưa
 * bật trông giống hệt nhau, nên người đi hiện trường mất thời gian đi tìm lỗi ở
 * chỗ không có lỗi.
 */

describe('commStateOf — ba trạng thái, không phải hai', () => {
  it('good ⇒ ok', () => {
    expect(commStateOf('good', 'ok')).toBe('ok')
  })

  it('not_configured ⇒ disabled — chưa khai slave nào thì bus không mở là ĐÚNG thiết kế', () => {
    expect(commStateOf('unknown', 'not_configured')).toBe('disabled')
  })

  it('unknown vì lý do KHÁC ⇒ unreadable, không được gộp vào disabled', () => {
    // `telemetry_unpublished` nghĩa là iobus chưa phát dữ liệu — đó là một sự
    // cố cần điều tra, không phải một lựa chọn cấu hình.
    expect(commStateOf('unknown', 'telemetry_unpublished')).toBe('unreadable')
  })

  it('bus không mở được là sự cố ⇒ unreadable', () => {
    expect(commStateOf('fault', 'bus_not_open')).toBe('unreadable')
  })

  it('không có dữ liệu gì ⇒ unreadable, KHÔNG phải disabled', () => {
    // Mặc định fail an toàn về phía "cần điều tra"; mặc định về "tắt có chủ
    // đích" sẽ giấu một sự cố thật sau một nhãn trấn an.
    expect(commStateOf(undefined, undefined)).toBe('unreadable')
  })

  it('degraded ⇒ unreadable chứ không phải ok', () => {
    expect(commStateOf('degraded', 'slave_offline')).toBe('unreadable')
  })

  it('not_configured thắng cả khi state là fault — lý do cụ thể hơn trạng thái tổng', () => {
    expect(commStateOf('fault', 'not_configured')).toBe('disabled')
  })

  it('ba trạng thái là ba giá trị phân biệt được', () => {
    const states = new Set([
      commStateOf('good', 'ok'),
      commStateOf('unknown', 'not_configured'),
      commStateOf('unknown', 'bus_not_open')
    ])
    expect(states.size).toBe(3)
  })
})
