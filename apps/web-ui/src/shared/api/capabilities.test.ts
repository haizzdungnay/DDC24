import { describe, expect, it } from 'vitest'
import {
  boardChannelConfirmed,
  electricalModeAvailability,
  isElectricalModeOffered,
  universalInputChannelCount,
  type CapabilityMode,
  type SystemCapabilities
} from './capabilities'

function doc(overrides: Partial<SystemCapabilities> = {}, uiModes: CapabilityMode[] = []): SystemCapabilities {
  return {
    board_cap_known: true,
    board_cap_map: '0x000D',
    blocks: [
      {
        kind: 'UI',
        presence: 'yes',
        count: 2,
        abi_capacity: 16,
        optional: false,
        channels: [
          { id: 'UI-01', index: 1, modes: uiModes },
          { id: 'UI-02', index: 2, modes: uiModes }
        ]
      },
      { kind: 'DI', presence: 'no', count: 0, abi_capacity: 8, optional: true, channels: [] },
      { kind: 'AO', presence: 'yes', count: 1, abi_capacity: 4, optional: false, channels: [{ id: 'AO-01', index: 1, modes: [] }] },
      { kind: 'DO', presence: 'no', count: 0, abi_capacity: 4, optional: false, channels: [] }
    ],
    ...overrides
  }
}

const withoutRtd: CapabilityMode[] = [
  { id: 'none', availability: 'confirmed' },
  { id: '0-10V', availability: 'confirmed' },
  { id: 'PT100', availability: 'withheld', reason: 'bo không gắn mạch nhiệt trở' },
  { id: 'PT1000', availability: 'withheld', reason: 'bo không gắn mạch nhiệt trở' },
  { id: 'NTC10k', availability: 'unverified', reason: 'không có bit năng lực' },
  { id: 'NTC20k', availability: 'unverified', reason: 'không có bit năng lực' },
  { id: 'light', availability: 'withheld', reason: 'bo không có mạch cảm biến ánh sáng' }
]

describe('universalInputChannelCount', () => {
  // Backend công bố DI thành khối riêng nhưng định danh của nó nằm TRONG không
  // gian UI (`UI-17`..`UI-24`), nên trần kênh là TỔNG hai khối.
  it('cộng cả khối DI vì DI dùng chung không gian điểm với UI', () => {
    const withDi = doc()
    withDi.blocks[1] = { kind: 'DI', presence: 'yes', count: 8, abi_capacity: 8, optional: true, channels: [] }
    expect(universalInputChannelCount(withDi)).toBe(10)
  })

  // "Chưa đọc được" KHÔNG được biến thành một con số: nơi gọi phải tự biết mình
  // đang không có thẩm quyền nào, thay vì tin vào một mặc định viết cứng.
  it('trả null khi chưa có tài liệu capability', () => {
    expect(universalInputChannelCount(null)).toBeNull()
  })
})

describe('electricalModeAvailability', () => {
  // Nhóm `resistance` gộp PT100/PT1000 (đòi bit RTD) với NTC (không bit nào
  // phủ). Bo không có RTD ⇒ nhóm vẫn dùng được nhờ NTC, nhưng lý do PT bị giữ
  // lại PHẢI hiện ra — người vận hành cần biết mình không chọn được PT100.
  it('lấy mức tốt nhất trong nhóm nhưng giữ lại lý do của thành viên bị chặn', () => {
    const result = electricalModeAvailability(doc({}, withoutRtd), 'resistance')
    expect(result.availability).toBe('unverified')
    expect(result.reasons).toContain('bo không gắn mạch nhiệt trở')
    expect(result.reasons).toContain('không có bit năng lực')
  })

  it('mode có bit xác nhận thì confirmed và không kèm lý do', () => {
    const result = electricalModeAvailability(doc({}, withoutRtd), 'volt')
    expect(result.availability).toBe('confirmed')
    expect(result.reasons).toEqual([])
  })

  // Mất mạng KHÔNG được biến thành "phần cứng không hỗ trợ": giấu hết mode chỉ
  // vì một lần gọi hỏng sẽ khoá cứng trang cấu hình, trong khi đường ghi phía
  // backend vẫn chặn đúng chỗ cần chặn.
  it('không có tài liệu ⇒ unverified chứ không phải withheld', () => {
    const result = electricalModeAvailability(null, 'resistance')
    expect(result.availability).toBe('unverified')
    expect(isElectricalModeOffered(null, 'resistance')).toBe(true)
  })

  it('mode bị giữ lại hoàn toàn thì không được mời chọn', () => {
    expect(isElectricalModeOffered(doc({}, withoutRtd), 'light')).toBe(false)
    expect(isElectricalModeOffered(doc({}, withoutRtd), 'volt')).toBe(true)
  })
})

describe('boardChannelConfirmed', () => {
  // Ba giá trị chứ không hai: gộp "không áp dụng" vào "không có" sẽ loại oan mọi
  // Virtual Point và điểm Modbus khỏi gợi ý.
  it('phân biệt kênh bo xác nhận, kênh bo không có, và điểm ngoài thẩm quyền', () => {
    const capabilities = doc()
    expect(boardChannelConfirmed(capabilities, 'UI-01')).toBe(true)
    expect(boardChannelConfirmed(capabilities, 'UI-09')).toBe(false)
    expect(boardChannelConfirmed(capabilities, 'DO-01')).toBe(false)
    expect(boardChannelConfirmed(capabilities, 'VP12')).toBeNull()
    expect(boardChannelConfirmed(capabilities, 'AHU1.SupplyTemp')).toBeNull()
  })

  it('chưa đọc được capability ⇒ kênh cục bộ chưa được xác nhận', () => {
    expect(boardChannelConfirmed(null, 'UI-01')).toBe(false)
    expect(boardChannelConfirmed(null, 'VP12')).toBeNull()
  })
})
