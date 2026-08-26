import { describe, expect, it } from 'vitest'
import {
  modeSwitchDecision,
  programsModeCapabilities,
  programsModeCapability,
} from './programsMode'

const pick = (vi: string) => vi
const CAPS = programsModeCapabilities(pick)

describe('programsModeCapabilities', () => {
  it('EDIT khả dụng, LIVE và SIMULATE nói rõ increment nào mở chúng', () => {
    expect(programsModeCapability('EDIT', CAPS)).toMatchObject({ available: true, reason: null })
    expect(programsModeCapability('LIVE', CAPS)?.reason).toMatch(/increment R2/)
    expect(programsModeCapability('SIMULATE', CAPS)?.reason).toMatch(/increment R3/)
  })

  it('mode chưa khả dụng vẫn CÓ MẶT trong danh sách — ẩn đi là nói dối về thiết bị', () => {
    expect(CAPS.map((item) => item.mode)).toEqual(['EDIT', 'LIVE', 'SIMULATE'])
  })
})

describe('modeSwitchDecision', () => {
  it('cùng mode thì không làm gì', () => {
    expect(modeSwitchDecision({ from: 'EDIT', to: 'EDIT', draftDirty: true, capabilities: CAPS }))
      .toEqual({ kind: 'SAME_MODE' })
  })

  it('mode chưa khả dụng bị chặn kèm lý do, KHÔNG âm thầm rơi về EDIT', () => {
    const decision = modeSwitchDecision({ from: 'EDIT', to: 'LIVE', draftDirty: false, capabilities: CAPS })
    expect(decision.kind).toBe('UNAVAILABLE')
    expect(decision.kind === 'UNAVAILABLE' && decision.reason).toMatch(/increment R2/)
  })

  it('UNAVAILABLE thắng CONFIRM_DISCARD — không bắt trả giá cho thao tác không xảy ra', () => {
    // Draft bẩn VÀ đích không khả dụng: hỏi "bỏ thay đổi?" rồi mới báo "không
    // dùng được" là bắt người dùng cân nhắc một đánh đổi vô nghĩa.
    const decision = modeSwitchDecision({ from: 'EDIT', to: 'LIVE', draftDirty: true, capabilities: CAPS })
    expect(decision.kind).toBe('UNAVAILABLE')
  })

  it('rời EDIT khi Draft còn thay đổi chưa lưu phải HỎI', () => {
    const capabilities = CAPS.map((item) => item.mode === 'LIVE' ? { ...item, available: true, reason: null } : item)
    expect(modeSwitchDecision({ from: 'EDIT', to: 'LIVE', draftDirty: true, capabilities }))
      .toEqual({ kind: 'CONFIRM_DISCARD' })
  })

  it('Draft sạch và đích khả dụng thì đi thẳng', () => {
    const capabilities = CAPS.map((item) => item.mode === 'LIVE' ? { ...item, available: true, reason: null } : item)
    expect(modeSwitchDecision({ from: 'EDIT', to: 'LIVE', draftDirty: false, capabilities }))
      .toEqual({ kind: 'ALLOW' })
  })

  it('mode lạ hoàn toàn cũng bị chặn, không ném lỗi', () => {
    const decision = modeSwitchDecision({
      from: 'EDIT',
      to: 'HACKED' as never,
      draftDirty: false,
      capabilities: CAPS,
    })
    expect(decision.kind).toBe('UNAVAILABLE')
  })
})
