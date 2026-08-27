import { describe, expect, it } from 'vitest'
import {
  modeSwitchDecision,
  programsModeCapabilities,
  programsModeCapability,
} from './programsMode'

const pick = (vi: string) => vi
const CAPS = programsModeCapabilities(pick)

describe('programsModeCapabilities', () => {
  it('EDIT và LIVE khả dụng; SIMULATE theo capability server công bố', () => {
    expect(programsModeCapability('EDIT', CAPS)).toMatchObject({ available: true, reason: null })
    // `T59-811` mở LIVE ở R2.
    expect(programsModeCapability('LIVE', CAPS)).toMatchObject({ available: true, reason: null })
    expect(programsModeCapability('SIMULATE', CAPS)?.reason).toMatch(/chưa công bố khả năng Mô phỏng/)
  })

  it('mode chưa khả dụng vẫn CÓ MẶT trong danh sách — ẩn đi là nói dối về thiết bị', () => {
    expect(CAPS.map((item) => item.mode)).toEqual(['EDIT', 'LIVE', 'SIMULATE'])
  })

  /* `T59-814` — nguồn sự thật của SIMULATE là server, không phải bản build FE.
   * Ba trường hợp dưới đây là ba câu trả lời KHÁC NHAU mà FE phải phân biệt:
   * thiết bị nói có, thiết bị nói không, và thiết bị đời cũ không nói gì. */
  it('SIMULATE khả dụng khi và chỉ khi server công bố supported', () => {
    const supported = programsModeCapabilities(pick, { supported: true })
    expect(programsModeCapability('SIMULATE', supported)?.available).toBe(true)
    expect(programsModeCapability('SIMULATE', supported)?.reason).toBeNull()

    const declined = programsModeCapabilities(pick, { supported: false })
    expect(programsModeCapability('SIMULATE', declined)?.available).toBe(false)

    // Server đời cũ không có `workspaceModes`: FE phải coi là UNAVAILABLE chứ
    // không suy "chắc là có" từ việc chính nó biết về SIMULATE.
    const legacy = programsModeCapabilities(pick, undefined)
    expect(programsModeCapability('SIMULATE', legacy)?.available).toBe(false)
    const nulled = programsModeCapabilities(pick, null)
    expect(programsModeCapability('SIMULATE', nulled)?.available).toBe(false)
  })
})

describe('modeSwitchDecision', () => {
  it('cùng mode thì không làm gì', () => {
    expect(modeSwitchDecision({ from: 'EDIT', to: 'EDIT', draftDirty: true, capabilities: CAPS }))
      .toEqual({ kind: 'SAME_MODE' })
  })

  it('mode chưa khả dụng bị chặn kèm lý do, KHÔNG âm thầm rơi về EDIT', () => {
    const decision = modeSwitchDecision({ from: 'EDIT', to: 'SIMULATE', draftDirty: false, capabilities: CAPS })
    expect(decision.kind).toBe('UNAVAILABLE')
    expect(decision.kind === 'UNAVAILABLE' && decision.reason).toMatch(/chưa công bố khả năng Mô phỏng/)
  })

  it('UNAVAILABLE thắng CONFIRM_DISCARD — không bắt trả giá cho thao tác không xảy ra', () => {
    // Draft bẩn VÀ đích không khả dụng: hỏi "bỏ thay đổi?" rồi mới báo "không
    // dùng được" là bắt người dùng cân nhắc một đánh đổi vô nghĩa.
    const decision = modeSwitchDecision({ from: 'EDIT', to: 'SIMULATE', draftDirty: true, capabilities: CAPS })
    expect(decision.kind).toBe('UNAVAILABLE')
  })

  it('rời EDIT khi Draft còn thay đổi chưa lưu phải HỎI', () => {
    expect(modeSwitchDecision({ from: 'EDIT', to: 'LIVE', draftDirty: true, capabilities: CAPS }))
      .toEqual({ kind: 'CONFIRM_DISCARD' })
  })

  it('Draft sạch và đích khả dụng thì đi thẳng', () => {
    expect(modeSwitchDecision({ from: 'EDIT', to: 'LIVE', draftDirty: false, capabilities: CAPS }))
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
