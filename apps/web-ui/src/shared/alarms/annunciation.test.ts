import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  alarmSoundKey,
  prefersReducedMotion,
  readAlarmSoundPreference,
  resolveAlarmSoundState,
  shouldAnnunciate,
  writeAlarmSoundPreference
} from './annunciation'

/**
 * Test khoá HÀNH VI cho annunciation (`T57-1.5`, thi hành `ADR-034`).
 *
 * Điều 3 của ADR — "cấm hiển thị đã bật khi ngữ cảnh âm thanh đang suspended" —
 * là mệnh đề an toàn quan trọng nhất ở đây và được khoá bằng bốn ca riêng.
 */

describe('resolveAlarmSoundState — ADR-034 điều 3', () => {
  it('chưa bật ⇒ off, bất kể ngữ cảnh âm thanh ở trạng thái nào', () => {
    expect(resolveAlarmSoundState(false, 'running')).toBe('off')
    expect(resolveAlarmSoundState(false, 'suspended')).toBe('off')
    expect(resolveAlarmSoundState(false, undefined)).toBe('off')
  })

  it('đã bật VÀ ngữ cảnh running ⇒ armed', () => {
    expect(resolveAlarmSoundState(true, 'running')).toBe('armed')
  })

  it('đã bật nhưng ngữ cảnh suspended ⇒ BLOCKED, tuyệt đối không phải armed', () => {
    // Đây là tình huống sau mỗi lần tải lại trang trên màn hình treo tường.
    // Hiện "đã bật" ở đây là khẳng định hệ thống sẽ kêu trong khi nó không thể.
    expect(resolveAlarmSoundState(true, 'suspended')).toBe('blocked')
    expect(resolveAlarmSoundState(true, 'suspended')).not.toBe('armed')
  })

  it('đã bật nhưng CHƯA từng tạo ngữ cảnh ⇒ blocked, không phải armed', () => {
    expect(resolveAlarmSoundState(true, undefined)).toBe('blocked')
  })

  it('ngữ cảnh đã closed ⇒ blocked', () => {
    expect(resolveAlarmSoundState(true, 'closed')).toBe('blocked')
  })
})

describe('shouldAnnunciate — chỉ kêu khi số chưa xác nhận TĂNG', () => {
  it('lần đo ĐẦU TIÊN không bao giờ kêu, dù đang có nhiều cảnh báo cũ', () => {
    // Mở trang lúc đang có 5 cảnh báo cũ mà hú lên như vừa có sự cố là làm
    // người trực mất niềm tin vào tín hiệu ngay lần đầu.
    expect(shouldAnnunciate(-1, 5)).toBe(false)
  })

  it('tăng ⇒ kêu', () => {
    expect(shouldAnnunciate(0, 1)).toBe(true)
    expect(shouldAnnunciate(3, 4)).toBe(true)
  })

  it('giữ nguyên ⇒ KHÔNG kêu (nếu không sẽ kêu liên tục suốt ca)', () => {
    expect(shouldAnnunciate(4, 4)).toBe(false)
  })

  it('giảm (vừa ack bớt) ⇒ không kêu', () => {
    expect(shouldAnnunciate(4, 2)).toBe(false)
  })

  it('về 0 ⇒ không kêu', () => {
    expect(shouldAnnunciate(2, 0)).toBe(false)
  })
})

describe('alarmSoundKey — namespace theo (thiết bị, tài khoản)', () => {
  it('hai bo khác nhau cho ra hai khoá khác nhau', () => {
    expect(alarmSoundKey('DDC-A', 'op1')).not.toBe(alarmSoundKey('DDC-B', 'op1'))
  })

  it('hai tài khoản trên cùng bo cho ra hai khoá khác nhau', () => {
    expect(alarmSoundKey('DDC-A', 'op1')).not.toBe(alarmSoundKey('DDC-A', 'op2'))
  })

  it('thiếu thông tin vẫn cho khoá ổn định, không phải undefined', () => {
    expect(alarmSoundKey('', '')).toBe('mkddc:v1:alarm-sound:unknown:anon')
  })
})

describe('đọc/ghi tuỳ chọn', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('mặc định là TẮT khi chưa có gì được lưu', () => {
    expect(readAlarmSoundPreference('k')).toBe(false)
  })

  it('ghi rồi đọc lại đúng cả hai chiều', () => {
    writeAlarmSoundPreference('k', true)
    expect(readAlarmSoundPreference('k')).toBe(true)
    writeAlarmSoundPreference('k', false)
    expect(readAlarmSoundPreference('k')).toBe(false)
  })

  it('giá trị rác trong localStorage được đọc là TẮT, không phải BẬT', () => {
    // Fail-safe đúng hướng: một khoá hỏng không được biến thành lời hứa sẽ kêu.
    localStorage.setItem('k', 'yes-please')
    expect(readAlarmSoundPreference('k')).toBe(false)
  })
})

describe('prefersReducedMotion', () => {
  const original = window.matchMedia

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', { value: original, configurable: true, writable: true })
  })

  it('trả true khi hệ điều hành khai báo giảm chuyển động', () => {
    Object.defineProperty(window, 'matchMedia', {
      value: (query: string) => ({ matches: query.includes('reduce') }),
      configurable: true,
      writable: true
    })
    expect(prefersReducedMotion()).toBe(true)
  })

  it('không có matchMedia thì trả false thay vì ném — ném ở đây làm hỏng cả AppShell', () => {
    Object.defineProperty(window, 'matchMedia', { value: undefined, configurable: true, writable: true })
    expect(() => prefersReducedMotion()).not.toThrow()
    expect(prefersReducedMotion()).toBe(false)
  })
})
