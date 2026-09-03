import { describe, expect, it } from 'vitest'
import { activationWarning, type ActivationReport } from './activation'

const pick = (vi: string) => vi

describe('activationWarning', () => {
  it('im lặng khi phần cứng đã xác nhận', () => {
    expect(activationWarning({ status: 'verified' }, pick)).toBeNull()
  })

  // Cái bẫy mà `ISS-PIO-33` dẹp: coi "không có thông tin" là "đã xác nhận".
  // Backend đời cũ, hay một đường ghi không đi qua bước read-back, đều rơi vào
  // đây — và cả hai đều KHÔNG phải bằng chứng rằng phần cứng đã đổi mode.
  it('vẫn cảnh báo khi thiếu hẳn activation', () => {
    expect(activationWarning(undefined, pick)).toContain('chưa xác nhận được')
    expect(activationWarning(null, pick)).toContain('chưa xác nhận được')
  })

  it('kèm nguyên văn lý do backend đưa ra', () => {
    const report: ActivationReport = { status: 'unverified', reason: 'IOP đang ở trạng thái "fault"' }
    expect(activationWarning(report, pick)).toContain('IOP đang ở trạng thái "fault"')
  })
})
