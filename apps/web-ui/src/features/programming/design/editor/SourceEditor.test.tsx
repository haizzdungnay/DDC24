import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '../../../../shared/i18n'
import { SourceEditor } from './ProgramsTab'
import type { ProgrammingDiagnostic, ProgrammingPointCatalogEntry, ProgrammingProgram } from '../../model/types'

function program(document: string): ProgrammingProgram {
  return { programId: 'program-1', name: 'AHU_FanControl', kind: 'PROGRAM', language: 'ST', document }
}

function renderEditor(source: string, options?: {
  canEdit?: boolean
  diagnostics?: ProgrammingDiagnostic[]
  onChange?: (value: string) => void
  pointCatalogStatus?: 'idle' | 'loading' | 'ready' | 'error'
  pointCatalogItems?: ProgrammingPointCatalogEntry[]
  onEnsurePointCatalogLoaded?: () => void
}) {
  const onChange = options?.onChange ?? vi.fn()
  const onSave = vi.fn().mockResolvedValue(true)
  const onEnsurePointCatalogLoaded = options?.onEnsurePointCatalogLoaded ?? vi.fn()
  const utils = render(
    <I18nProvider>
      <SourceEditor
        program={program(source)}
        source={source}
        canEdit={options?.canEdit ?? true}
        saving={false}
        diagnostics={options?.diagnostics ?? []}
        focusDiagnostic={null}
        onChange={onChange}
        onSave={onSave}
        pointCatalogStatus={options?.pointCatalogStatus ?? 'idle'}
        pointCatalogItems={options?.pointCatalogItems ?? []}
        pointCatalogError={null}
        onEnsurePointCatalogLoaded={onEnsurePointCatalogLoaded}
      />
    </I18nProvider>,
  )
  return { ...utils, onChange, onSave, onEnsurePointCatalogLoaded, textarea: screen.getByLabelText(/Mã nguồn ST/) as HTMLTextAreaElement }
}

beforeEach(() => localStorage.setItem('mkddc-lang', 'vi'))
afterEach(cleanup)

describe('SourceEditor — WP-10 P0 (CTO/Owner approval 2026-08-15 §4-6)', () => {
  it('tô cú pháp: keyword/type/function/fb-type/comment/time đúng màu (đối chiếu ST_SUBSET_SPEC §10)', () => {
    const source = 'PROGRAM P\nVAR\n  T1 : TON;\nEND_VAR\nX := ABS(1); (* c *) PT := T#1s;\nEND_PROGRAM\n'
    const { container } = renderEditor(source)
    const overlay = container.querySelector('pre.pointer-events-none')!
    expect(overlay.textContent).toContain('PROGRAM')
    // Overlay phải chứa đủ text gốc — không mất/lặp ký tự khi merge segment.
    expect(overlay.textContent).toBe(source)
    const keywordSpan = [...overlay.querySelectorAll('span')].find((el) => el.textContent === 'PROGRAM')
    expect(keywordSpan?.className).toContain('text-[var(--c-accent)]')
    const fbTypeSpan = [...overlay.querySelectorAll('span')].find((el) => el.textContent === 'TON')
    expect(fbTypeSpan?.className).toContain('text-[var(--c-good-fg)]')
    const functionSpan = [...overlay.querySelectorAll('span')].find((el) => el.textContent === 'ABS')
    expect(functionSpan?.className).toContain('text-[var(--c-good-fg)]')
    const commentSpan = [...overlay.querySelectorAll('span')].find((el) => el.textContent === '(* c *)')
    expect(commentSpan?.className).toContain('italic')
    const timeSpan = [...overlay.querySelectorAll('span')].find((el) => el.textContent === 'T#1s')
    expect(timeSpan?.className).toContain('text-[var(--c-warn-fg)]')
  })

  it('bracket matching: chọn một ngoặc tô sáng cả cặp mở/đóng', () => {
    const source = 'Y := ABS(X);'
    const { textarea, container } = renderEditor(source)
    const openOffset = source.indexOf('(')
    fireEvent.click(textarea)
    textarea.setSelectionRange(openOffset, openOffset)
    fireEvent.select(textarea)
    const overlay = container.querySelector('pre.pointer-events-none')!
    const highlighted = [...overlay.querySelectorAll('span')].filter((el) => el.className.includes('bg-[var(--c-accent-bg)]'))
    expect(highlighted).toHaveLength(2)
    expect(highlighted.map((el) => el.textContent).sort()).toEqual(['(', ')'])
  })

  it('Enter tự thụt lề sau IF...THEN, giảm lại ở END_IF', () => {
    const onChange = vi.fn()
    const source = '  IF X THEN'
    const { textarea } = renderEditor(source, { onChange })
    textarea.setSelectionRange(source.length, source.length)
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(`${source}\n    `)
  })

  // Lỗi người dùng báo trực tiếp (2026-08-15): sau Enter tự thụt lề, khay
  // "Dòng/cột" hiện một dòng KHÁC với vị trí con trỏ thấy trên màn hình, và
  // ký tự gõ tiếp theo chèn nhầm vào dòng cũ. Gốc lỗi: value/selection trên
  // DOM textarea trước đây chỉ được set trong `requestAnimationFrame` (chờ
  // tới frame kế tiếp) — gõ phím trong lúc chờ rơi vào vị trí mặc định của
  // trình duyệt. Test này khẳng định DOM cập nhật ĐỒNG BỘ, ngay trong cùng
  // lượt xử lý phím Enter, không còn khoảng hở đó.
  it('Enter tự thụt lề: DOM value/selection + khay Dòng/cột cập nhật đồng bộ, không qua frame kế tiếp', () => {
    const onChange = vi.fn()
    const source = '  IF X THEN'
    const { textarea } = renderEditor(source, { onChange })
    textarea.setSelectionRange(source.length, source.length)
    fireEvent.keyDown(textarea, { key: 'Enter' })
    const expected = `${source}\n    `
    expect(textarea.value).toBe(expected)
    expect(textarea.selectionStart).toBe(expected.length)
    expect(textarea.selectionEnd).toBe(expected.length)
    expect(screen.getByText(/Dòng 2, cột 5/)).toBeInTheDocument()
  })

  it('Autocomplete chấp nhận: DOM value/selection cập nhật đồng bộ ngay sau Enter chọn gợi ý', () => {
    const onChange = vi.fn()
    const before = 'X := A'
    const after = 'X := AB'
    const { textarea } = renderEditor(before, { onChange })
    fireEvent.change(textarea, { target: { value: after } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(textarea.value).toBe('X := ABS')
    expect(textarea.selectionStart).toBe('X := ABS'.length)
    expect(screen.getByText(/Dòng 1, cột 9/)).toBeInTheDocument()
  })

  it('Thay chỉ đổi lần khớp kế tiếp: DOM value/selection cập nhật đồng bộ', () => {
    const onChange = vi.fn()
    const source = 'A := OLD; B := OLD;'
    const { textarea } = renderEditor(source, { onChange })
    fireEvent.click(screen.getByRole('button', { name: /^Find$|^Tìm$/ }))
    fireEvent.change(screen.getByLabelText(/Find in source|Tìm trong mã nguồn/), { target: { value: 'OLD' } })
    fireEvent.change(screen.getByPlaceholderText(/Replace with|Thay bằng/), { target: { value: 'NEW' } })
    fireEvent.click(screen.getByRole('button', { name: /^Replace$|^Thay$/ }))
    expect(textarea.value).toBe('A := NEW; B := OLD;')
    // Con trỏ dừng NGAY SAU chữ vừa thay ("NEW"), không tính dấu `;` theo sau
    // — dấu đó vốn có sẵn trong nguồn, không thuộc phần vừa Replace.
    expect(textarea.selectionStart).toBe('A := NEW'.length)
  })

  it('autocomplete: gõ prefix hiện dropdown, Enter chèn đúng gợi ý đã chọn', () => {
    const onChange = vi.fn()
    // Render với giá trị NGẮN hơn rồi fireEvent.change sang giá trị dài hơn —
    // React dedupe change event nếu value bắn ra giống hệt value hiện tại
    // (input value tracking), nên phải mô phỏng đúng một lần gõ thật (value
    // đổi), không bắn lại đúng giá trị ban đầu.
    const before = 'X := A'
    const after = 'X := AB'
    const { textarea, rerender } = renderEditor(before, { onChange })
    fireEvent.change(textarea, { target: { value: after } })
    expect(screen.getByRole('listbox', { name: /Gợi ý|Suggestions/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /ABS/ })).toBeInTheDocument()
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('X := ABS')
    // Re-render với nguồn đã có ABS xác nhận dropdown đóng lại sau khi chấp nhận.
    rerender(
      <I18nProvider>
        <SourceEditor
          program={program('X := ABS')}
          source="X := ABS"
          canEdit
          saving={false}
          diagnostics={[]}
          focusDiagnostic={null}
          onChange={onChange}
          onSave={vi.fn()}
          pointCatalogStatus="idle"
          pointCatalogItems={[]}
          pointCatalogError={null}
          onEnsurePointCatalogLoaded={vi.fn()}
        />
      </I18nProvider>,
    )
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('autocomplete gợi ý đúng biến đã khai báo (symbol) lẫn kiểu dữ liệu', () => {
    const before = 'PROGRAM P\nVAR\n  SupplyTemp : R'
    const after = 'PROGRAM P\nVAR\n  SupplyTemp : RE'
    const { textarea } = renderEditor(before)
    fireEvent.change(textarea, { target: { value: after } })
    // Accessible name của option nối cả nhãn lẫn "detail" (vd "REAL_TO_INT")
    // nên so khớp đúng ô nhãn thay vì role name để không dính các hàm
    // REAL_TO_* khác cùng bắt đầu bằng "REAL".
    expect(screen.getByText('REAL', { selector: 'span.mono' })).toBeInTheDocument()
  })

  it('diagnostic underline: click vào đoạn lỗi nhảy đúng vùng chọn (line/column/length)', () => {
    const source = 'PROGRAM P\nX := ;\nEND_PROGRAM\n'
    const diagnostics: ProgrammingDiagnostic[] = [
      { code: 'ST-SYN-001', severity: 'ERROR', messageKey: 'x', location: { line: 2, column: 6, length: 1 } },
    ]
    const { container, textarea } = renderEditor(source, { diagnostics })
    const overlay = container.querySelector('pre.pointer-events-none')!
    const errorSpan = overlay.querySelector('span[class*="decoration-wavy"]')
    expect(errorSpan).toBeTruthy()
    fireEvent.click(errorSpan!)
    expect(textarea.selectionStart).toBe(source.indexOf('X := ;') + 5)
  })

  it('Find + Replace: Thay tất cả đổi đúng mọi lần xuất hiện', () => {
    const onChange = vi.fn()
    const source = 'A := OLD;\nB := OLD;\n'
    const { textarea } = renderEditor(source, { onChange })
    fireEvent.click(screen.getByRole('button', { name: /^Find$|^Tìm$/ }))
    fireEvent.change(screen.getByLabelText(/Find in source|Tìm trong mã nguồn/), { target: { value: 'OLD' } })
    fireEvent.change(screen.getByPlaceholderText(/Replace with|Thay bằng/), { target: { value: 'NEW' } })
    fireEvent.click(screen.getByRole('button', { name: /^Replace all$|^Thay tất cả$/ }))
    expect(onChange).toHaveBeenCalledWith('A := NEW;\nB := NEW;\n')
    void textarea
  })

  it('Find + Replace: Thay chỉ đổi lần khớp kế tiếp', () => {
    const onChange = vi.fn()
    const source = 'A := OLD; B := OLD;'
    renderEditor(source, { onChange })
    fireEvent.click(screen.getByRole('button', { name: /^Find$|^Tìm$/ }))
    fireEvent.change(screen.getByLabelText(/Find in source|Tìm trong mã nguồn/), { target: { value: 'OLD' } })
    fireEvent.change(screen.getByPlaceholderText(/Replace with|Thay bằng/), { target: { value: 'NEW' } })
    fireEvent.click(screen.getByRole('button', { name: /^Replace$|^Thay$/ }))
    expect(onChange).toHaveBeenCalledWith('A := NEW; B := OLD;')
  })

  it('chỉ đọc (canEdit=false): không có nút Định dạng/Lưu/Replace, textarea readOnly', () => {
    const { textarea } = renderEditor('PROGRAM P\nEND_PROGRAM\n', { canEdit: false })
    expect(textarea).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: /Định dạng|Format/ })).not.toBeInTheDocument()
  })
})
