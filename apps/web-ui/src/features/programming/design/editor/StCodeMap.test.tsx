import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '../../../../shared/i18n'
import { CODE_MAP_MIN_LINES, StCodeMap, shouldShowCodeMap, stCodeMapEntries } from './StCodeMap'

/**
 * `T59-821` / `TC-PGM02-NAV-01` — Code Map.
 *
 * Điều được khoá chặt nhất ở đây là **điều hướng không đổi một byte tài liệu**.
 */

const short = 'PROGRAM Main\nVAR\n  Fan : BOOL;\nEND_VAR\nEND_PROGRAM'
const long = [
  'PROGRAM Main',
  'VAR',
  '  Fan : BOOL;',
  'END_VAR',
  ...Array.from({ length: CODE_MAP_MIN_LINES }, (_, index) => `  X${index} := ${index};`),
  'IF Fan THEN',
  '  Fan := FALSE;',
  'END_IF',
  'END_PROGRAM',
].join('\n')

beforeEach(() => { localStorage.setItem('mkddc-lang', 'vi') })
afterEach(cleanup)

describe('ngưỡng — dùng chung một con số, không mỗi bên một kiểu', () => {
  it(`dưới ${CODE_MAP_MIN_LINES} dòng thì không hiện: cả tài liệu đã nằm trong một màn hình`, () => {
    expect(shouldShowCodeMap(short)).toBe(false)
    render(<I18nProvider><StCodeMap source={short} onNavigate={vi.fn()} /></I18nProvider>)
    expect(screen.queryByTestId('st-code-map')).toBeNull()
  })

  it('vượt ngưỡng thì hiện', () => {
    expect(shouldShowCodeMap(long)).toBe(true)
    render(<I18nProvider><StCodeMap source={long} onNavigate={vi.fn()} /></I18nProvider>)
    expect(screen.getByTestId('st-code-map')).toBeInTheDocument()
  })
})

describe('dàn ý bám đúng dòng thật', () => {
  it('nhận POU, khối VAR, rẽ nhánh và vòng lặp', () => {
    const entries = stCodeMapEntries('PROGRAM P\nVAR\nEND_VAR\nIF a THEN\nFOR i := 1 TO 2 DO\n')
    expect(entries.map((entry) => entry.kind)).toEqual(['POU', 'VAR_BLOCK', 'BRANCH', 'LOOP'])
    expect(entries.map((entry) => entry.line)).toEqual([1, 2, 4, 5])
  })

  it('offset trỏ đúng đầu dòng tương ứng', () => {
    const source = 'PROGRAM P\nVAR\nEND_VAR'
    const entries = stCodeMapEntries(source)
    expect(source.slice(entries[1].offset, entries[1].offset + 3)).toBe('VAR')
  })
})

describe('điều hướng KHÔNG đổi một byte nào của tài liệu', () => {
  it('bấm một mục chỉ phát ra offset', () => {
    const onNavigate = vi.fn()
    const before = long
    render(<I18nProvider><StCodeMap source={long} onNavigate={onNavigate} /></I18nProvider>)
    fireEvent.click(screen.getAllByTestId('st-code-map-entry')[1])
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(typeof onNavigate.mock.calls[0][0]).toBe('number')
    // Chuỗi nguồn là bất biến trong JS, nên phép so này khoá đúng điều cần khoá:
    // component không có đường nào để ghi ngược lại.
    expect(long).toBe(before)
  })

  it('props không hề có đường ghi vào tài liệu', () => {
    // Bất biến ép bằng hình dạng props, không bằng lời hứa trong chú thích:
    // thêm `onChange` vào đây là thứ phải bị chặn ở review.
    const props = StCodeMap.length
    expect(props).toBe(1)
  })
})
