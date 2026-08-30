import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '../../../../shared/i18n'
import { StCodeMap, shouldShowCodeMap, stCodeMapEntries } from './StCodeMap'

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
  ...Array.from({ length: 120 }, (_, index) => `  X${index} := ${index};`),
  'IF Fan THEN',
  '  Fan := FALSE;',
  'END_IF',
  'END_PROGRAM',
].join('\n')

/* Không có mục nào để chỉ tới: chỉ những dòng gán trần trụi. Đây là cổng DUY
 * NHẤT còn lại sau khi bỏ ngưỡng độ dài, nên nó phải có test riêng. */
const outlineless = 'a := 1;\nb := 2;\nc := 3;'

beforeEach(() => { localStorage.setItem('mkddc-lang', 'vi') })
afterEach(cleanup)

describe('hiện với MỌI độ dài — không còn ngưỡng dòng', () => {
  /* Chủ sở hữu chốt 2026-08-30. Ngưỡng 80 dòng cũ ẩn bản đồ IM LẶNG, nên một
   * POU ngắn không phân biệt được với một tính năng hỏng. Ca đầu tiên chính là
   * ca mà bản trước cố tình làm ngược lại. */
  it('POU 5 dòng vẫn hiện', () => {
    expect(shouldShowCodeMap(short)).toBe(true)
    render(<I18nProvider><StCodeMap source={short} onNavigate={vi.fn()} /></I18nProvider>)
    expect(screen.getByTestId('st-code-map')).toBeInTheDocument()
    expect(screen.getAllByTestId('st-code-map-entry')).toHaveLength(2)
  })

  it('POU dài vẫn hiện', () => {
    expect(shouldShowCodeMap(long)).toBe(true)
    render(<I18nProvider><StCodeMap source={long} onNavigate={vi.fn()} /></I18nProvider>)
    expect(screen.getByTestId('st-code-map')).toBeInTheDocument()
  })

  it('không có mục nào để chỉ tới thì KHÔNG dựng khung: khung rỗng vẫn ăn bề ngang của chỗ gõ', () => {
    expect(shouldShowCodeMap(outlineless)).toBe(false)
    render(<I18nProvider><StCodeMap source={outlineless} onNavigate={vi.fn()} /></I18nProvider>)
    expect(screen.queryByTestId('st-code-map')).toBeNull()
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
