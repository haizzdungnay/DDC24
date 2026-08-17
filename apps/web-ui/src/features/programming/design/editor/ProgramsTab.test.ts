import { describe, expect, it } from 'vitest'

import {
  collectStInterfaceVariables, collectStSymbols, formatStSource, isDuplicateProgramName,
  mapOffsetAcrossReplaceAll, mapOffsetByNonWhitespaceCount, uniqueProgramName
} from './ProgramsTab'
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

  // Báo lỗi trực tiếp kèm ảnh chụp 2026-08-17: bấm "Định dạng" xé `VAR RETAIN`
  // thành hai dòng "VAR" / "RETAIN" lệch thụt lề (đè EBNF §10 `"VAR" "RETAIN"`
  // phải chung một dòng) và xé `IF ... THEN` thành "IF" / "<điều kiện> THEN"
  // cùng độ sâu thụt lề với thân khối — cả hai PHẢI giữ nguyên trên một dòng.
  it('giữ "VAR RETAIN" trên cùng một dòng, không xé thành "VAR" + "RETAIN"', () => {
    const source = 'PROGRAM t\nVAR RETAIN\n  StartCount : INT;\nEND_VAR\nEND_PROGRAM'
    const formatted = formatStSource(source)
    expect(formatted.split('\n').filter(Boolean)).toEqual([
      'PROGRAM t', '  VAR RETAIN', '    StartCount : INT;', '  END_VAR', 'END_PROGRAM'
    ])
  })

  it('giữ "IF <điều kiện> THEN" trên cùng một dòng, không xé "IF" ra riêng', () => {
    const source = 'PROGRAM t\nIF HighTrig.Q THEN\n  StartCount := StartCount + 1;\nEND_IF\nEND_PROGRAM'
    const formatted = formatStSource(source)
    expect(formatted.split('\n').filter(Boolean)).toEqual([
      'PROGRAM t', '  IF HighTrig.Q THEN', '    StartCount := StartCount + 1;', '  END_IF', 'END_PROGRAM'
    ])
  })

  it('giữ "ELSIF <điều kiện> THEN" trên cùng một dòng', () => {
    const source = 'PROGRAM t\nIF A THEN\n  B := TRUE;\nELSIF C THEN\n  B := FALSE;\nEND_IF\nEND_PROGRAM'
    const formatted = formatStSource(source)
    expect(formatted.split('\n').filter(Boolean)).toEqual([
      'PROGRAM t', '  IF A THEN', '    B := TRUE;', '  ELSIF C THEN', '    B := FALSE;', '  END_IF', 'END_PROGRAM'
    ])
  })

  it('không đổi gì khi VAR không đi kèm RETAIN (đường thường vẫn phải giữ nguyên)', () => {
    const source = 'PROGRAM t\nVAR\n  Counter : INT;\nEND_VAR\nEND_PROGRAM'
    const formatted = formatStSource(source)
    expect(formatted.split('\n').filter(Boolean)).toEqual([
      'PROGRAM t', '  VAR', '    Counter : INT;', '  END_VAR', 'END_PROGRAM'
    ])
  })

  it('idempotent — Format lần hai trên kết quả đã đúng không đổi gì thêm', () => {
    const source = 'PROGRAM t\nVAR RETAIN\n  StartCount : INT;\nEND_VAR\nIF A THEN\n  B := TRUE;\nEND_IF\nEND_PROGRAM'
    const once = formatStSource(source)
    const twice = formatStSource(once)
    expect(twice).toBe(once)
  })
})

// Báo lỗi trực tiếp 2026-08-17: "chọn dòng A thì nó lại hiện dòng B" — bấm
// "Định dạng"/"Thay tất cả" gọi thẳng `onChange(next)` không qua
// `applyEditRange`, nên khay Dòng/cột + dải active-line đứng yên ở vị trí CŨ
// trong khi con trỏ DOM thật của textarea bị đặt lại (thường về offset 0).
// Hai hàm dưới đây ánh xạ vị trí con trỏ cũ sang bản mới để khay luôn khớp
// con trỏ thật — test đúng phần lõi thuần logic (không cần dựng textarea thật,
// bằng chứng hành vi thật đã có ở e2e).
describe('mapOffsetByNonWhitespaceCount (giữ vị trí con trỏ qua "Định dạng")', () => {
  it('map offset đúng khi Format thêm dòng trống/thụt lề phía trước', () => {
    const before = 'PROGRAM t VAR RETAIN Counter:INT; END_VAR END_PROGRAM'
    const after = formatStSource(before)
    // Con trỏ đứng ngay sau "END_PROGRAM" ở bản cũ (cuối chuỗi).
    const offset = before.length
    const mapped = mapOffsetByNonWhitespaceCount(before, after, offset)
    expect(after.slice(0, mapped).replace(/\s/g, '').length).toBe(before.replace(/\s/g, '').length)
    // `formatStSource` luôn thêm `\n` cuối cùng — vị trí đúng ngay SAU ký tự
    // không-trắng cuối (END_PROGRAM), TRƯỚC dòng trống thêm vào đó.
    expect(mapped).toBe(after.length - 1)
  })

  it('offset 0 map về 0', () => {
    expect(mapOffsetByNonWhitespaceCount('PROGRAM t', 'PROGRAM\n  t', 0)).toBe(0)
  })

  it('map đúng vị trí giữa chuỗi — không lệch dòng khi format chèn xuống dòng phía trước con trỏ', () => {
    const before = 'PROGRAM t VAR RETAIN Counter:INT; END_VAR Counter:=Counter+1; END_PROGRAM'
    const after = formatStSource(before)
    const offset = before.indexOf('Counter:=Counter+1')
    const mapped = mapOffsetByNonWhitespaceCount(before, after, offset)
    // Vị trí mới phải rơi ngay trước cùng token "Counter:=Counter+1" ở bản đã format.
    expect(after.slice(mapped).replace(/\s/g, '').startsWith('Counter:=Counter+1'.replace(/\s/g, ''))).toBe(true)
  })
})

describe('mapOffsetAcrossReplaceAll (giữ vị trí con trỏ qua "Thay tất cả")', () => {
  it('offset trước lần thay đầu tiên không đổi', () => {
    const before = 'A := Old + Old;'
    expect(mapOffsetAcrossReplaceAll(before, 'Old', 'New', 0)).toBe(0)
  })

  it('offset sau một lần thay dịch đúng chênh lệch độ dài thay thế', () => {
    const before = 'Old := Old + 1;'
    // offset ngay sau lần xuất hiện "Old" đầu tiên (index 0..3)
    const offset = 3
    // "New" dài hơn "Old" 0 ký tự (cùng 3 ký tự) — thử với chênh lệch thật:
    const mapped = mapOffsetAcrossReplaceAll(before, 'Old', 'Renamed', offset)
    expect(mapped).toBe(offset + ('Renamed'.length - 'Old'.length))
  })

  it('nhiều lần thay trước con trỏ cộng dồn đúng', () => {
    const before = 'Old + Old + Old'
    const offset = before.length // con trỏ ở cuối, sau cả 3 lần "Old"
    const mapped = mapOffsetAcrossReplaceAll(before, 'Old', 'Renamed', offset)
    expect(mapped).toBe(offset + 3 * ('Renamed'.length - 'Old'.length))
  })

  it('searchText rỗng trả nguyên offset (không chia cho 0/vòng lặp vô hạn)', () => {
    expect(mapOffsetAcrossReplaceAll('abc', '', 'x', 2)).toBe(2)
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
