import { describe, expect, it } from 'vitest'

import { collectStInterfaceVariables, collectStSymbols, formatStSource, isDuplicateProgramName, uniqueProgramName } from './ProgramsTab'
import type { ProgrammingProgram } from '../../model/types'

function program(overrides: Partial<ProgrammingProgram> = {}): ProgrammingProgram {
  return {
    programId: overrides.programId ?? 'p1',
    name: overrides.name ?? 'New program',
    kind: 'PROGRAM',
    language: 'ST',
    document: '',
    executionOrder: 0,
    functionalTags: [],
    ...overrides
  }
}

describe('formatStSource (BUG-013)', () => {
  it('tách code dán một dòng thành nhiều dòng theo từ khoá khối', () => {
    const oneLine = 'PROGRAM test VAR Counter:INT; END_VAR Counter:=Counter+1; END_PROGRAM'
    const formatted = formatStSource(oneLine)
    const lines = formatted.split('\n').filter((line) => line.length > 0).map((line) => line.trim())
    expect(lines[0]).toBe('PROGRAM test')
    expect(lines).toContain('VAR')
    expect(lines.some((line) => line.startsWith('Counter:INT;'))).toBe(true)
    expect(lines).toContain('END_VAR')
    expect(lines[lines.length - 1]).toBe('END_PROGRAM')
  })

  it('không đổi gì với chuỗi rỗng', () => {
    expect(formatStSource('')).toBe('')
  })

  it('vẫn hoạt động với code đã có xuống dòng sẵn', () => {
    const multiline = 'PROGRAM test\nVAR\nCounter : INT;\nEND_VAR\nEND_PROGRAM'
    const formatted = formatStSource(multiline)
    expect(formatted.split('\n').filter(Boolean)).toEqual([
      'PROGRAM test', '  VAR', '    Counter : INT;', '  END_VAR', 'END_PROGRAM'
    ])
  })
})

describe('collectStSymbols (BUG-013)', () => {
  it('nhận diện khai báo VAR ngay cả khi source còn một dòng, chưa Format', () => {
    const oneLine = 'PROGRAM test VAR Counter:INT; END_VAR Counter:=Counter+1; END_PROGRAM'
    const symbols = collectStSymbols(oneLine)
    expect(symbols).toHaveLength(1)
    expect(symbols[0].name).toBe('Counter')
    expect(symbols[0].type).toBe('INT')
  })

  it('nhận diện nhiều khai báo liên tiếp sau khi Format', () => {
    const formatted = formatStSource('PROGRAM t VAR A:BOOL; B:REAL; END_VAR END_PROGRAM')
    const symbols = collectStSymbols(formatted)
    expect(symbols.map((s) => s.name)).toEqual(['A', 'B'])
  })

  it('rỗng khi không có VAR nào', () => {
    expect(collectStSymbols('PROGRAM t END_PROGRAM')).toHaveLength(0)
  })
})

describe('collectStInterfaceVariables (Mapping tab phải chọn từ VAR_INPUT/VAR_OUTPUT, không gõ tay)', () => {
  const reference = `PROGRAM AHU_FanControl
VAR_INPUT
    SupplyTemp  : REAL;
    Setpoint    : REAL;
    Occupied    : BOOL;
END_VAR
VAR_OUTPUT
    FanEnable   : BOOL;
    FanSpeed    : REAL;
END_VAR
VAR
    StartDelay  : TON;
    Deviation   : REAL;
END_VAR
    Deviation := SupplyTemp - Setpoint;
END_PROGRAM`

  it('chỉ lấy biến trong VAR_INPUT/VAR_OUTPUT, bỏ qua VAR cục bộ', () => {
    expect(collectStInterfaceVariables(reference)).toEqual([
      { name: 'SupplyTemp', type: 'REAL', direction: 'INPUT' },
      { name: 'Setpoint', type: 'REAL', direction: 'INPUT' },
      { name: 'Occupied', type: 'BOOL', direction: 'INPUT' },
      { name: 'FanEnable', type: 'BOOL', direction: 'OUTPUT' },
      { name: 'FanSpeed', type: 'REAL', direction: 'OUTPUT' }
    ])
  })

  it('vẫn nhận diện được khi source chưa Format (một dòng)', () => {
    const oneLine = 'PROGRAM t VAR_INPUT SupplyTemp:REAL; END_VAR VAR_OUTPUT FanEnable:BOOL; END_VAR END_PROGRAM'
    expect(collectStInterfaceVariables(oneLine)).toEqual([
      { name: 'SupplyTemp', type: 'REAL', direction: 'INPUT' },
      { name: 'FanEnable', type: 'BOOL', direction: 'OUTPUT' }
    ])
  })

  it('rỗng khi chương trình không khai báo VAR_INPUT/VAR_OUTPUT', () => {
    expect(collectStInterfaceVariables('PROGRAM t VAR x : BOOL; END_VAR END_PROGRAM')).toEqual([])
  })
})

describe('isDuplicateProgramName / uniqueProgramName (BUG-006)', () => {
  it('phát hiện trùng tên không phân biệt hoa/thường và khoảng trắng', () => {
    const programs = [program({ programId: 'a', name: 'New program' })]
    expect(isDuplicateProgramName(programs, ' new program ')).toBe(true)
    expect(isDuplicateProgramName(programs, 'Other')).toBe(false)
  })

  it('bỏ qua chính chương trình đang sửa khi excludeProgramId khớp', () => {
    const programs = [program({ programId: 'a', name: 'New program' })]
    expect(isDuplicateProgramName(programs, 'New program', 'a')).toBe(false)
  })

  it('sinh tên tăng dần khi trùng, giữ nguyên nếu chưa dùng', () => {
    const programs = [program({ programId: 'a', name: 'New program' })]
    expect(uniqueProgramName(programs, 'New program')).toBe('New program 2')
    expect(uniqueProgramName(programs, 'Free name')).toBe('Free name')
  })

  it('nhảy tiếp số khi hai chương trình đã tạo trước đó', () => {
    const programs = [
      program({ programId: 'a', name: 'New program' }),
      program({ programId: 'b', name: 'New program 2' })
    ]
    expect(uniqueProgramName(programs, 'New program')).toBe('New program 3')
  })
})
