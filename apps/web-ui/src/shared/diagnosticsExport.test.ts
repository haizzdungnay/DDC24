import { describe, expect, it } from 'vitest'
import { buildSnapshot, redactSensitive } from './diagnosticsExport'

/**
 * Khoá luật an toàn của `T57-2.21`.
 *
 * Tệp xuất ra sẽ được gửi qua email hoặc dán vào ticket — nơi nó **thoát khỏi
 * mọi lớp kiểm soát truy cập của sản phẩm**. Một trường nhạy cảm lọt vào đây
 * không có cách nào thu hồi. Vì vậy luật lọc phải có test, và phải test cả
 * trường hợp trường nằm ở tầng sâu.
 */

describe('redactSensitive — T57-2.21', () => {
  it('loại khoá nhạy cảm ở tầng ĐẦU', () => {
    const out = redactSensitive({ token: 'abc', deviceName: 'DDC24' })
    expect(out).toEqual({ token: '[redacted]', deviceName: 'DDC24' })
  })

  it('loại khoá nhạy cảm ở tầng SÂU', () => {
    const out = redactSensitive({ session: { user: { name: 'admin', pw_bcrypt: '$2b$12$x' } } })
    expect(
      JSON.stringify(out),
      'payload health/overview là dữ liệu lồng nhau do backend định hình; lọc nông sẽ để lọt trường mới thêm ở tầng sâu'
    ).not.toContain('$2b$12$x')
  })

  it('loại theo khoá CHỨA từ nhạy cảm, không chỉ khớp chính xác', () => {
    const out = redactSensitive({ accessToken: 'x', refreshToken: 'y', apiKey: 'z' }) as Record<string, string>
    expect(Object.values(out).every((value) => value === '[redacted]')).toBe(true)
  })

  it('giữ nguyên mảng và giá trị nguyên thuỷ', () => {
    expect(redactSensitive({ points: [1, 2, 3], ok: true, nothing: null }))
      .toEqual({ points: [1, 2, 3], ok: true, nothing: null })
  })

  it('không chạy vô hạn với cấu trúc vòng', () => {
    const cyclic: Record<string, unknown> = { name: 'x' }
    cyclic.self = cyclic
    const out = redactSensitive(cyclic) as Record<string, unknown>
    expect(out.name).toBe('x')
    expect(out.self).toBe('[circular]')
  })
})

describe('buildSnapshot — vỏ bọc phải tự nói ra nó là gì', () => {
  it('mang mốc thời gian, phiên bản web và ghi chú phạm vi', () => {
    const snapshot = buildSnapshot('status-snapshot', '1.2.3', { overview: { token: 'leak' } })
    expect(snapshot.kind).toBe('status-snapshot')
    expect(Number.isNaN(Date.parse(snapshot.capturedAt))).toBe(false)
    expect(snapshot.webVersion).toBe('1.2.3')
    expect(snapshot.note).toMatch(/nhạy cảm/)
    // Vỏ bọc KHÔNG được là đường vòng qua bộ lọc.
    expect(JSON.stringify(snapshot)).not.toContain('leak')
  })

  it('thiếu phiên bản web thì ghi "unknown", không để trống', () => {
    expect(buildSnapshot('diagnostic-bundle', '', {}).webVersion).toBe('unknown')
  })
})
