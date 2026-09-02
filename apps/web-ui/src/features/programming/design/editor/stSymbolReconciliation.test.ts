import { describe, expect, it } from 'vitest'
import { reconcileStSymbols, type StReconciliationInput } from './stSymbolReconciliation'
import { buildStReferenceIndex } from './stReferenceIndex'

/**
 * `ISS-STED-13`. Điều được kiểm không phải "so hai danh sách" mà là **khi nào
 * ĐƯỢC PHÉP so**. Một phép so trên dữ liệu không cùng thời điểm sẽ báo lệch
 * giả, và người dùng học cách bỏ qua cảnh báo — lúc đó cổng còn tệ hơn không có.
 */

const SOURCE = 'PROGRAM P\nVAR_INPUT p : REAL; END_VAR\nVAR_OUTPUT q : BOOL; END_VAR\nEND_PROGRAM\n'

function input(overrides: Partial<StReconciliationInput> = {}): StReconciliationInput {
  return {
    index: buildStReferenceIndex(SOURCE),
    compilerSymbols: [
      { pouId: 'P', name: 'p', direction: 'input', type: 'REAL', slot: 0 },
      { pouId: 'P', name: 'q', direction: 'output', type: 'BOOL', slot: 1 },
    ],
    checkState: 'PASSED',
    bufferChanged: false,
    interfaceVariables: [
      { name: 'p', type: 'REAL', direction: 'INPUT' },
      { name: 'q', type: 'BOOL', direction: 'OUTPUT' },
    ],
    ...overrides,
  }
}

describe('đối chiếu chỉ mục ký hiệu với compiler — ISS-STED-13', () => {
  it('khớp ⇒ MATCHED, không hạ cấp', () => {
    const result = reconcileStSymbols(input())
    expect(result.state).toBe('MATCHED')
    expect(result.degraded).toBe(false)
    expect(result.mismatches).toEqual([])
  })

  it('FE thiếu một biến compiler thấy ⇒ DRIFTED và hạ cấp', () => {
    const result = reconcileStSymbols(input({
      interfaceVariables: [{ name: 'p', type: 'REAL', direction: 'INPUT' }],
    }))
    expect(result.state).toBe('DRIFTED')
    expect(result.degraded).toBe(true)
    expect(result.mismatches).toEqual([{ name: 'q', frontend: null, compiler: 'OUTPUT BOOL' }])
  })

  it('FE thấy một biến compiler KHÔNG có ⇒ cũng là lệch', () => {
    // Duyệt HỢP hai tập: chỉ duyệt một phía sẽ mù với một trong hai chế độ hỏng.
    const result = reconcileStSymbols(input({
      interfaceVariables: [
        { name: 'p', type: 'REAL', direction: 'INPUT' },
        { name: 'q', type: 'BOOL', direction: 'OUTPUT' },
        { name: 'ma', type: 'INT', direction: 'INPUT' },
      ],
    }))
    expect(result.state).toBe('DRIFTED')
    expect(result.mismatches).toEqual([{ name: 'ma', frontend: 'INPUT INT', compiler: null }])
  })

  it('lệch KIỂU hoặc HƯỚNG cũng là lệch, không chỉ lệch tên', () => {
    const wrongType = reconcileStSymbols(input({
      interfaceVariables: [
        { name: 'p', type: 'INT', direction: 'INPUT' },
        { name: 'q', type: 'BOOL', direction: 'OUTPUT' },
      ],
    }))
    expect(wrongType.mismatches).toEqual([{ name: 'p', frontend: 'INPUT INT', compiler: 'INPUT REAL' }])

    const wrongDirection = reconcileStSymbols(input({
      interfaceVariables: [
        { name: 'p', type: 'REAL', direction: 'OUTPUT' },
        { name: 'q', type: 'BOOL', direction: 'OUTPUT' },
      ],
    }))
    expect(wrongDirection.mismatches).toEqual([{ name: 'p', frontend: 'OUTPUT REAL', compiler: 'INPUT REAL' }])
  })

  it('Check chưa PASSED ⇒ UNVERIFIED, KHÔNG hạ cấp và không báo lệch', () => {
    for (const state of ['QUEUED', 'RUNNING', 'FAILED', 'TIMED_OUT', null, undefined]) {
      const result = reconcileStSymbols(input({ checkState: state }))
      expect(result.state).toBe('UNVERIFIED')
      // Check hỏng nghĩa là bảng ký hiệu dở dang; báo lệch ở đây là lệch GIẢ.
      expect(result.degraded).toBe(false)
      expect(result.mismatches).toEqual([])
    }
  })

  it('buffer đã đổi kể từ lần Check ⇒ UNVERIFIED, không so trên dữ liệu lệch thời điểm', () => {
    const result = reconcileStSymbols(input({ bufferChanged: true }))
    expect(result.state).toBe('UNVERIFIED')
    expect(result.reason).toContain('đã đổi')
  })

  it('Check PASSED nhưng không kèm bảng ký hiệu ⇒ UNVERIFIED, không đọc thành "khớp"', () => {
    // `null` khác `[]`: thiếu bằng chứng không phải bằng chứng khớp.
    const result = reconcileStSymbols(input({ compilerSymbols: null }))
    expect(result.state).toBe('UNVERIFIED')
    expect(result.degraded).toBe(false)
  })

  it('POU không khai cổng nào: hai bên cùng rỗng là KHỚP thật', () => {
    const result = reconcileStSymbols(input({ compilerSymbols: [], interfaceVariables: [] }))
    expect(result.state).toBe('MATCHED')
  })

  it('thông báo lệch nêu CẢ HAI phía, để biết bên nào đọc sai', () => {
    const result = reconcileStSymbols(input({
      interfaceVariables: [{ name: 'p', type: 'INT', direction: 'INPUT' }],
    }))
    expect(result.reason).toContain('giao diện')
    expect(result.reason).toContain('trình biên dịch')
    expect(result.reason).toContain('không xác định được')
  })

  it('so không phân biệt hoa/thường, đúng cách ST xử lý định danh', () => {
    const result = reconcileStSymbols(input({
      interfaceVariables: [
        { name: 'P', type: 'REAL', direction: 'INPUT' },
        { name: 'Q', type: 'BOOL', direction: 'OUTPUT' },
      ],
    }))
    expect(result.state).toBe('MATCHED')
  })
})
