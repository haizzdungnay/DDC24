import { describe, expect, it } from 'vitest'

import {
  ST_FB_TYPE_NAMES,
  ST_FUNCTION_NAMES,
  ST_EDITOR_HISTORY_LIMIT,
  buildStCompletions,
  computeAutoIndent,
  createStEditorHistory,
  currentWordPrefix,
  findMatchingBracket,
  mergeDiagnosticRanges,
  recordStEditorEdit,
  redoStEditorEdit,
  tokenizeStSource,
  undoStEditorEdit,
} from './stEditorSupport'

describe('tokenizeStSource (WP-10 P0, đối chiếu ST_SUBSET_SPEC §10)', () => {
  it('nhận diện keyword/type/number/comment/operator đúng grammar', () => {
    const source = 'PROGRAM P\nVAR_INPUT\n  X : REAL; (* ghi chú *)\nEND_VAR\nEND_PROGRAM\n'
    const tokens = tokenizeStSource(source).filter((token) => token.kind !== 'whitespace')
    const kinds = tokens.map((token) => `${token.kind}:${token.text}`)
    expect(kinds).toContain('keyword:PROGRAM')
    expect(kinds).toContain('keyword:VAR_INPUT')
    expect(kinds).toContain('identifier:X')
    expect(kinds).toContain('punctuation:;')
    expect(kinds).toContain('type:REAL')
    expect(kinds).toContain('comment:(* ghi chú *)')
    expect(kinds).toContain('keyword:END_VAR')
    expect(kinds).toContain('keyword:END_PROGRAM')
  })

  it('nhận diện // comment tới cuối dòng, TIME literal, số thực', () => {
    const source = 'X := 1.5; // trailing\nPT := T#1m30s;\n'
    const tokens = tokenizeStSource(source)
    expect(tokens.some((t) => t.kind === 'comment' && t.text === '// trailing')).toBe(true)
    expect(tokens.some((t) => t.kind === 'number' && t.text === '1.5')).toBe(true)
    expect(tokens.some((t) => t.kind === 'time' && t.text === 'T#1m30s')).toBe(true)
  })

  it('nhận diện hàm chuẩn (ABS/SQRT/conversion) và FB type (TON/PID) đúng registry FBD_PALETTE', () => {
    const source = 'Y := ABS(X);\nZ := INT_TO_REAL(N);\nTimer1 : TON;\nLoop1 : PID;\n'
    const tokens = tokenizeStSource(source)
    expect(tokens.find((t) => t.text === 'ABS')?.kind).toBe('function')
    expect(tokens.find((t) => t.text === 'INT_TO_REAL')?.kind).toBe('function')
    expect(tokens.find((t) => t.text === 'TON')?.kind).toBe('fb-type')
    expect(tokens.find((t) => t.text === 'PID')?.kind).toBe('fb-type')
  })

  it('toán tử trung tố (AND/OR/MOD) là keyword, KHÔNG phải function — ST viết "a AND b" không phải "AND(a,b)"', () => {
    const source = 'C := A AND B;\nD := A MOD B;\n'
    const tokens = tokenizeStSource(source)
    expect(tokens.find((t) => t.text === 'AND')?.kind).toBe('keyword')
    expect(tokens.find((t) => t.text === 'MOD')?.kind).toBe('keyword')
    expect(ST_FUNCTION_NAMES).not.toContain('AND')
    expect(ST_FUNCTION_NAMES).not.toContain('MOD')
  })

  it('không có FOR/WHILE/CASE/REPEAT/FUNCTION_BLOCK trong keyword set — compiler chưa hỗ trợ', () => {
    const source = 'FOR WHILE CASE REPEAT FUNCTION_BLOCK'
    const tokens = tokenizeStSource(source).filter((t) => t.kind !== 'whitespace')
    for (const token of tokens) expect(token.kind).not.toBe('keyword')
  })

  it('20 hàm chuẩn + 5 FB type khớp đúng số lượng kFuncs[]/st_fb_type đã xác nhận ở WP-05', () => {
    expect(ST_FUNCTION_NAMES).toHaveLength(20)
    expect(ST_FB_TYPE_NAMES).toHaveLength(5)
    expect([...ST_FB_TYPE_NAMES].sort()).toEqual(['F_TRIG', 'PID', 'R_TRIG', 'TOF', 'TON'].sort())
  })
})

describe('findMatchingBracket', () => {
  it('tìm đúng cặp ngoặc đơn giản và lồng nhau', () => {
    const source = 'Y := ABS(LIMIT(0, X, 10));'
    const openAbs = source.indexOf('(')
    const match = findMatchingBracket(source, openAbs)
    expect(match).not.toBeNull()
    expect(source[match!.open]).toBe('(')
    expect(source[match!.close]).toBe(')')
    expect(match!.close).toBe(source.lastIndexOf(')'))
  })

  it('trả null khi con trỏ không ở cạnh ngoặc nào', () => {
    const source = 'Y := ABS(X);'
    expect(findMatchingBracket(source, 1)).toBeNull()
  })

  it('bỏ qua ngoặc bên trong comment', () => {
    const source = 'Y := ABS(X); (* comment (has) parens *)'
    const openAbs = source.indexOf('(')
    const match = findMatchingBracket(source, openAbs)
    expect(match!.close).toBe(source.indexOf(')', openAbs))
  })
})

describe('computeAutoIndent', () => {
  it('tăng indent sau PROGRAM/VAR/IF/THEN', () => {
    expect(computeAutoIndent('PROGRAM P', 'PROGRAM P'.length)).toBe('  ')
    expect(computeAutoIndent('  VAR_INPUT', '  VAR_INPUT'.length)).toBe('    ')
    expect(computeAutoIndent('  IF X THEN', '  IF X THEN'.length)).toBe('    ')
  })

  it('giảm indent khi dòng hiện tại là END_VAR/END_IF', () => {
    expect(computeAutoIndent('  END_VAR', '  END_VAR'.length)).toBe('')
    expect(computeAutoIndent('    END_IF', '    END_IF'.length)).toBe('  ')
  })

  it('giữ nguyên indent cho câu lệnh thường (assignment)', () => {
    expect(computeAutoIndent('  X := 1;', '  X := 1;'.length)).toBe('  ')
  })
})

describe('currentWordPrefix', () => {
  it('trả prefix đang gõ dở', () => {
    const source = 'X := AB'
    expect(currentWordPrefix(source, source.length)).toEqual({ start: 5, prefix: 'AB' })
  })
  it('trả null ngay sau khoảng trắng/toán tử', () => {
    const source = 'X := '
    expect(currentWordPrefix(source, source.length)).toBeNull()
  })
})

describe('mergeDiagnosticRanges', () => {
  it('trả nguyên token khi không có diagnostic', () => {
    const tokens = tokenizeStSource('X := 1;')
    const segments = mergeDiagnosticRanges(tokens, [])
    expect(segments.map((s) => s.diagnosticIndex)).toEqual(tokens.map(() => null))
  })

  it('tách đúng token bị diagnostic cắt ngang (diagnostic ngắn hơn token)', () => {
    // identifier "VARIABLE" dài 8 ký tự, diagnostic chỉ phủ 3 ký tự đầu.
    const source = 'VARIABLE'
    const tokens = tokenizeStSource(source)
    const segments = mergeDiagnosticRanges(tokens, [{ start: 0, end: 3, index: 0 }])
    const withDiag = segments.filter((s) => s.diagnosticIndex === 0)
    const withoutDiag = segments.filter((s) => s.diagnosticIndex === null)
    expect(withDiag.map((s) => s.text).join('')).toBe('VAR')
    expect(withoutDiag.map((s) => s.text).join('')).toBe('IABLE')
    // Không đoạn nào chồng lấn hoặc để hở ký tự.
    const total = [...segments].sort((a, b) => a.start - b.start).map((s) => s.text).join('')
    expect(total).toBe(source)
  })

  it('diagnostic phủ đúng nhiều token liên tiếp', () => {
    const source = 'X := Y;'
    const tokens = tokenizeStSource(source)
    const segments = mergeDiagnosticRanges(tokens, [{ start: 0, end: 6, index: 2 }])
    const covered = segments.filter((s) => s.diagnosticIndex === 2).map((s) => s.text).join('')
    expect(covered).toBe('X := Y')
  })
})

describe('buildStCompletions', () => {
  it('gợi ý đúng theo prefix, ưu tiên symbol đã khai báo lên trước', () => {
    const items = buildStCompletions('AB', [{ name: 'ABC_TEMP', type: 'REAL' }])
    expect(items[0]).toEqual({ label: 'ABC_TEMP', kind: 'symbol', detail: 'REAL' })
    expect(items.some((item) => item.label === 'ABS' && item.kind === 'function')).toBe(true)
  })

  it('gợi ý kiểu dữ liệu và FB type theo prefix', () => {
    expect(buildStCompletions('RE', []).map((i) => i.label)).toContain('REAL')
    expect(buildStCompletions('TO', []).map((i) => i.label)).toEqual(expect.arrayContaining(['TON', 'TOF']))
  })

  it('không gợi ý gì khi prefix rỗng', () => {
    expect(buildStCompletions('', [])).toEqual([])
  })

  it('không trùng lặp, giới hạn 20 mục', () => {
    const items = buildStCompletions('T', [{ name: 'T1', type: 'BOOL' }, { name: 'T2', type: 'BOOL' }])
    const labels = items.map((item) => `${item.kind}:${item.label}`)
    expect(new Set(labels).size).toBe(labels.length)
    expect(items.length).toBeLessThanOrEqual(20)
  })
})

describe('lịch sử ST editor bền (T59-506)', () => {
  it('hoàn tác/làm lại đủ 20 edit và khôi phục đúng cursor/selection của từng snapshot', () => {
    let history = createStEditorHistory('PROGRAM P\nEND_PROGRAM\n', 8, 9)
    const snapshots = [history.current]

    for (let index = 1; index <= 20; index += 1) {
      const source = `PROGRAM P\n  X := ${index};\nEND_PROGRAM\n`
      const cursor = source.indexOf(String(index)) + String(index).length
      const snapshot = { source, selectionStart: cursor, selectionEnd: cursor }
      history = recordStEditorEdit(history, snapshot)
      snapshots.push(snapshot)
    }

    expect(history.past).toHaveLength(20)
    for (let index = 19; index >= 0; index -= 1) {
      history = undoStEditorEdit(history)
      expect(history.current).toEqual(snapshots[index])
    }
    expect(undoStEditorEdit(history)).toBe(history)

    for (let index = 1; index <= 20; index += 1) {
      history = redoStEditorEdit(history)
      expect(history.current).toEqual(snapshots[index])
    }
    expect(redoStEditorEdit(history)).toBe(history)
  })

  it('giới hạn lịch sử đúng contract 50 snapshot và edit mới cắt nhánh redo', () => {
    let history = createStEditorHistory('0')
    for (let index = 1; index <= ST_EDITOR_HISTORY_LIMIT + 7; index += 1) {
      history = recordStEditorEdit(history, { source: String(index), selectionStart: 1, selectionEnd: 1 })
    }
    expect(history.past).toHaveLength(ST_EDITOR_HISTORY_LIMIT)

    history = undoStEditorEdit(history)
    expect(history.future).toHaveLength(1)
    history = recordStEditorEdit(history, { source: 'nhánh mới', selectionStart: 9, selectionEnd: 9 })
    expect(history.future).toEqual([])
  })
})
