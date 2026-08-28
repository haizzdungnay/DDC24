import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '../../../../shared/i18n'
import { SourceEditor } from './ProgramsTab'
import type { ProgrammingDiagnostic, ProgrammingDraftOperation, ProgrammingPointCatalogEntry, ProgrammingProgram } from '../../model/types'

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
  onSave?: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
}) {
  const onChange = options?.onChange ?? vi.fn()
  const onSave = options?.onSave ?? vi.fn().mockResolvedValue(true)
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
    // `DEV-PROG-001` bỏ hàng "Dòng x, cột y" trùng lặp; vị trí con trỏ nay do
    // THANH TRẠNG THÁI nói (`Dòng:Cột`). Ý định của test không đổi: DOM phải
    // phản ánh con trỏ ngay trong cùng lượt xử lý phím.
    expect(screen.getByTestId('editor-status-position')).toHaveTextContent('2:5')
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
    expect(screen.getByTestId('editor-status-position')).toHaveTextContent('1:9')
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

  it('AC-ST-011: chỉ đọc (canEdit=false): không có nút Định dạng/Lưu/Replace, textarea readOnly', () => {
    const { textarea } = renderEditor('PROGRAM P\nEND_PROGRAM\n', { canEdit: false })
    expect(textarea).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: /Định dạng|Format/ })).not.toBeInTheDocument()
  })

  it('T59-506: Ctrl+Z/Y hoàn tác/làm lại đủ 20 edit và giữ cursor của snapshot', () => {
    const initial = 'PROGRAM P\nEND_PROGRAM\n'
    const snapshots = [initial]
    for (let index = 1; index <= 20; index += 1) {
      snapshots.push(`PROGRAM P\n  X := ${index};\nEND_PROGRAM\n`)
    }

    function Harness() {
      const [source, setSource] = useState(initial)
      return (
        <SourceEditor
          program={program(initial)}
          source={source}
          canEdit
          saving={false}
          diagnostics={[]}
          focusDiagnostic={null}
          onChange={setSource}
          onSave={vi.fn()}
          pointCatalogStatus="idle"
          pointCatalogItems={[]}
          pointCatalogError={null}
          onEnsurePointCatalogLoaded={vi.fn()}
        />
      )
    }

    render(<I18nProvider><Harness /></I18nProvider>)
    const textarea = screen.getByLabelText(/Mã nguồn ST/) as HTMLTextAreaElement
    for (const next of snapshots.slice(1)) {
      fireEvent.change(textarea, { target: { value: next } })
    }
    expect(textarea.value).toBe(snapshots[20])
    expect(screen.getByRole('button', { name: 'Hoàn tác thay đổi ST' })).toBeEnabled()

    fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true })
    expect(textarea.value).toBe(snapshots[19])
    expect(textarea.selectionStart).toBe(snapshots[19].length)
    expect(textarea.selectionEnd).toBe(snapshots[19].length)

    for (let index = 18; index >= 0; index -= 1) {
      fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true })
      expect(textarea.value).toBe(snapshots[index])
    }
    expect(textarea.selectionStart).toBe(0)
    expect(screen.getByRole('button', { name: 'Hoàn tác thay đổi ST' })).toBeDisabled()

    for (let index = 1; index <= 20; index += 1) {
      fireEvent.keyDown(textarea, { key: 'y', ctrlKey: true })
      expect(textarea.value).toBe(snapshots[index])
    }
    expect(textarea.selectionStart).toBe(snapshots[20].length)
    expect(screen.getByRole('button', { name: 'Làm lại thay đổi ST' })).toBeDisabled()
  })

  it('T59-506: Định dạng gọi từ Command Palette vẫn là một bước có thể undo', async () => {
    const initial = 'PROGRAM test VAR Counter:INT; END_VAR Counter:=Counter+1; END_PROGRAM'

    function Harness() {
      const [source, setSource] = useState(initial)
      const [nonce, setNonce] = useState(0)
      return (
        <>
          <button type="button" onClick={() => setNonce((value) => value + 1)}>Format request</button>
          <SourceEditor
            program={program(initial)}
            source={source}
            canEdit
            saving={false}
            diagnostics={[]}
            focusDiagnostic={null}
            onChange={setSource}
            onSave={vi.fn()}
            pointCatalogStatus="idle"
            pointCatalogItems={[]}
            pointCatalogError={null}
            onEnsurePointCatalogLoaded={vi.fn()}
            formatRequest={nonce > 0 ? { programId: 'program-1', nonce } : undefined}
          />
        </>
      )
    }

    render(<I18nProvider><Harness /></I18nProvider>)
    const textarea = screen.getByLabelText(/Mã nguồn ST/) as HTMLTextAreaElement
    fireEvent.click(screen.getByRole('button', { name: 'Format request' }))
    await waitFor(() => expect(textarea.value).not.toBe(initial))

    fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true })
    expect(textarea.value).toBe(initial)
  })

  describe('FE-ST-008: trạng thái Lưu rõ ràng (Saving/Failed/Chưa lưu) thay vì chỉ disable nút không giải thích', () => {
    /** `renderEditor` (dùng cho phần lớn file này) cố ý KHÔNG có state thật
     *  đằng sau `source`/`program.document` — `onChange` mock không phản hồi
     *  lại prop mới, đúng cho các test chỉ đọc DOM trực tiếp
     *  (`textarea.value`/`.selectionStart` do `pendingCursorRef` ghi tay).
     *  Nhưng `dirty`/`canSave`/trạng thái Lưu tính từ PROP `source` thật —
     *  cần một harness có state thật, mô phỏng đúng cách `ProgramsTab` (cha
     *  thật) cập nhật `buffers`/`program.document` sau khi gõ và sau khi Lưu
     *  thành công, nếu không nút Lưu sẽ luôn bị coi là "không dirty". */
    function renderStatefulEditor(initialSource: string, onSaveImpl: (operations: ProgrammingDraftOperation[]) => Promise<boolean>) {
      function Harness() {
        const [source, setSource] = useState(initialSource)
        const [committed, setCommitted] = useState(initialSource)
        const handleSave = async (operations: ProgrammingDraftOperation[]) => {
          const ok = await onSaveImpl(operations)
          if (ok) {
            const op = operations.find((item): item is Extract<ProgrammingDraftOperation, { op: 'replaceProgramSource' }> => item.op === 'replaceProgramSource')
            if (op) setCommitted(op.source)
          }
          return ok
        }
        return (
          <SourceEditor
            program={program(committed)}
            source={source}
            canEdit
            saving={false}
            diagnostics={[]}
            focusDiagnostic={null}
            onChange={setSource}
            onSave={handleSave}
            pointCatalogStatus="idle"
            pointCatalogItems={[]}
            pointCatalogError={null}
            onEnsurePointCatalogLoaded={vi.fn()}
          />
        )
      }
      const utils = render(<I18nProvider><Harness /></I18nProvider>)
      return { ...utils, textarea: screen.getByLabelText(/Mã nguồn ST/) as HTMLTextAreaElement }
    }

    it('Lưu thành công: "Đã lưu." hiện ra, nút Lưu quay lại disabled vì không còn gì để lưu', async () => {
      const onSave = vi.fn().mockResolvedValue(true)
      const { textarea } = renderStatefulEditor('PROGRAM P\nEND_PROGRAM\n', onSave)
      fireEvent.change(textarea, { target: { value: 'PROGRAM P\nX := 1;\nEND_PROGRAM\n' } })
      expect(screen.getByText('Chưa lưu.')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))
      await waitFor(() => expect(screen.getByText('Đã lưu.')).toBeInTheDocument())
      expect(screen.queryByText('Chưa lưu.')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled()
    })

    it('Lưu thất bại: hiện "Lưu thất bại — thử lại." thay vì im lặng hoặc "Chưa lưu" chung chung', async () => {
      const onSave = vi.fn().mockResolvedValue(false)
      const { textarea } = renderStatefulEditor('PROGRAM P\nEND_PROGRAM\n', onSave)
      fireEvent.change(textarea, { target: { value: 'PROGRAM P\nX := 1;\nEND_PROGRAM\n' } })
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))

      await waitFor(() => expect(onSave).toHaveBeenCalled())
      await waitFor(() => expect(screen.getByText('Lưu thất bại — thử lại.')).toBeInTheDocument())
      expect(screen.queryByText('Chưa lưu.')).not.toBeInTheDocument()
    })

    it('gõ tiếp sau khi lưu thất bại: thông báo lỗi cũ biến mất, quay về "Chưa lưu." — không giữ mãi lỗi của buffer đã khác', async () => {
      const onSave = vi.fn().mockResolvedValue(false)
      const { textarea } = renderStatefulEditor('PROGRAM P\nEND_PROGRAM\n', onSave)
      fireEvent.change(textarea, { target: { value: 'PROGRAM P\nX := 1;\nEND_PROGRAM\n' } })
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))
      await waitFor(() => expect(screen.getByText('Lưu thất bại — thử lại.')).toBeInTheDocument())

      fireEvent.change(textarea, { target: { value: 'PROGRAM P\nX := 2;\nEND_PROGRAM\n' } })
      expect(screen.queryByText('Lưu thất bại — thử lại.')).not.toBeInTheDocument()
      expect(screen.getByText('Chưa lưu.')).toBeInTheDocument()
    })

    it('nút Lưu bị disable vì KHÔNG có gì để lưu (không dirty) có tooltip giải thích, không im lặng', () => {
      const source = 'PROGRAM P\nEND_PROGRAM\n'
      renderEditor(source)
      const saveButton = screen.getByRole('button', { name: 'Lưu' })
      expect(saveButton).toBeDisabled()
      expect(saveButton).toHaveAttribute('title', 'Không có thay đổi để lưu')
    })

    it('nút Lưu bị disable vì nguồn rỗng có tooltip giải thích khác (đã có từ trước, không bị đè bởi finding mới)', () => {
      renderEditor('   ')
      const saveButton = screen.getByRole('button', { name: 'Lưu' })
      expect(saveButton).toBeDisabled()
      expect(saveButton).toHaveAttribute('title', 'Mã nguồn ST không được để trống')
    })
  })
})

/* `T59-805` AC: "LIVE and mobile cannot mutate via typing/paste/drop/IME/
 * commands". `readOnly` của textarea chặn được người dùng thật, nhưng nó là một
 * THUỘC TÍNH — một lần refactor quên nó là mọi đường mutation mở lại cùng lúc.
 * Bộ test này khoá GUARD RUNTIME, thứ vẫn đúng kể cả khi thuộc tính biến mất. */
describe('SourceEditor — chỉ đọc là policy runtime, không chỉ thuộc tính', () => {
  it('AC-ST-011: không phát onChange cho gõ tay, dán hay thả khi canEdit=false', () => {
    const { textarea, onChange } = renderEditor('PROGRAM P\nEND_PROGRAM\n', { canEdit: false })
    expect(textarea).toHaveAttribute('readonly')

    // Mô phỏng cả ba đường mà trình duyệt dùng để ghi vào textarea: gõ tay,
    // dán, và thả. Trong jsdom, cả ba đều tới cùng một `change` event.
    fireEvent.change(textarea, { target: { value: 'PROGRAM HACKED\nEND_PROGRAM\n' } })
    fireEvent.paste(textarea, { clipboardData: { getData: () => 'X := 1;' } })
    fireEvent.drop(textarea, { dataTransfer: { getData: () => 'X := 1;' } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('không có nút Lưu/Hoàn tác/Định dạng nào để chạy lệnh sửa', () => {
    renderEditor('PROGRAM P\nEND_PROGRAM\n', { canEdit: false })
    expect(screen.queryByRole('button', { name: /Hoàn tác/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Định dạng/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Lưu' })).not.toBeInTheDocument()
  })

  it('vẫn phát onChange bình thường khi được phép sửa', () => {
    const { textarea, onChange } = renderEditor('PROGRAM P\nEND_PROGRAM\n', { canEdit: true })
    expect(textarea).not.toHaveAttribute('readonly')
    fireEvent.change(textarea, { target: { value: 'PROGRAM P\nX := 1;\nEND_PROGRAM\n' } })
    expect(onChange).toHaveBeenCalledWith('PROGRAM P\nX := 1;\nEND_PROGRAM\n')
  })
})

/* `AC-ST-005` — "Diagnostic jump exact; hover/ref absence shows unavailable,
 * not guessed content". Phần chẩn đoán đã có test từ trước; nhóm này khoá phần
 * THAM CHIẾU: tới khai báo phải đúng chỗ, và khi không tra được thì phải NÓI là
 * không tra được thay vì nhảy tới một đích gần đúng. */
describe('SourceEditor — tham chiếu tại con trỏ (T59-805 / AC-ST-005)', () => {
  const SOURCE = 'PROGRAM P\nVAR\n  FanCmd : BOOL;\n  FanDelay : TON;\nEND_VAR\nFanDelay(IN := FanCmd, PT := T#5s);\nFanCmd := FALSE;\nEND_PROGRAM\n'

  function focusIdentifier(textarea: HTMLTextAreaElement, needle: string, occurrence = 0) {
    let at = -1
    for (let index = 0; index <= occurrence; index += 1) at = textarea.value.indexOf(needle, at + 1)
    textarea.setSelectionRange(at + 1, at + 1)
    fireEvent.select(textarea)
    return at
  }

  it('hiện kiểu và phân loại của định danh dưới con trỏ', () => {
    const { textarea } = renderEditor(SOURCE)
    focusIdentifier(textarea, 'FanDelay(')

    const panel = screen.getByText('Tham chiếu tại con trỏ').parentElement as HTMLElement
    expect(within(panel).getByText('FanDelay')).toBeInTheDocument()
    expect(within(panel).getByText('TON')).toBeInTheDocument()
    expect(within(panel).getByText('instance FB')).toBeInTheDocument()
  })

  it('F12 nhảy tới đúng khai báo, không phải lần dùng gần nhất', () => {
    const { textarea } = renderEditor(SOURCE)
    focusIdentifier(textarea, 'FanCmd :=')
    fireEvent.keyDown(textarea, { key: 'F12' })

    expect(textarea.selectionStart).toBe(SOURCE.indexOf('FanCmd : BOOL;'))
    expect(textarea.selectionEnd).toBe(SOURCE.indexOf('FanCmd : BOOL;') + 'FanCmd'.length)
  })

  it('định danh chưa khai báo: nói KHÔNG XÁC ĐỊNH ĐƯỢC, con trỏ đứng yên', () => {
    const source = 'PROGRAM P\nGhostVar := 1;\nEND_PROGRAM\n'
    const { textarea } = renderEditor(source)
    focusIdentifier(textarea, 'GhostVar')
    const before = textarea.selectionStart

    expect(screen.getByText(/không xác định được/)).toBeInTheDocument()
    fireEvent.keyDown(textarea, { key: 'F12' })
    expect(screen.getByRole('status')).toHaveTextContent('Không tìm thấy khai báo của GhostVar.')
    expect(textarea.selectionStart).toBe(before)
  })

  it('đếm đọc/ghi tách nhau: gán tham số trong lời gọi không phải ghi', () => {
    const { textarea } = renderEditor(SOURCE)
    focusIdentifier(textarea, 'FanCmd :=')

    const panel = screen.getByText('Tham chiếu tại con trỏ').parentElement as HTMLElement
    expect(within(panel).getByText('Đọc (1):')).toBeInTheDocument()
    expect(within(panel).getByText('Ghi (1):')).toBeInTheDocument()
  })

  it('chỉ đọc vẫn tra được tham chiếu — điều hướng không phải mutation', () => {
    const { textarea } = renderEditor(SOURCE, { canEdit: false })
    focusIdentifier(textarea, 'FanDelay(')
    fireEvent.keyDown(textarea, { key: 'F12' })
    expect(textarea.selectionStart).toBe(SOURCE.indexOf('FanDelay : TON;'))
  })
})

/* `AC-ST-010` — "unsupported compiler construct does not crash editor".
 *
 * Editor phải chịu được nguồn mà compiler KHÔNG nhận: cú pháp ngoài subset,
 * chú thích không đóng, khối VAR thiếu END_VAR, ký tự ngoài ASCII, một dòng
 * rất dài. Nó không cần hiểu những thứ đó — nó chỉ không được sập, vì sập thì
 * người dùng mất luôn buffer đang gõ. */
describe('SourceEditor — nguồn ngoài subset không làm sập editor (AC-ST-010)', () => {
  const HOSTILE: Array<[string, string]> = [
    ['chú thích không đóng', 'PROGRAM P\n(* mở mà không đóng\nX := 1;\nEND_PROGRAM\n'],
    ['VAR thiếu END_VAR', 'PROGRAM P\nVAR\n  A : INT;\nX := 1;\nEND_PROGRAM\n'],
    ['cú pháp ngoài subset', 'PROGRAM P\nVAR\n  A : ARRAY[1..10] OF INT;\nEND_VAR\nCASE A[1] OF\n1: X := 1;\nEND_CASE;\nEND_PROGRAM\n'],
    ['toàn dấu ngoặc lệch', 'PROGRAM P\n))((\nX := ((((;\nEND_PROGRAM\n'],
    ['ngoài ASCII trong định danh', 'PROGRAM P\nVAR\n  Nhiệt_độ : REAL;\nEND_VAR\nNhiệt_độ := 1.0;\nEND_PROGRAM\n'],
    ['một dòng rất dài', `PROGRAM P\n${'X := X + 1; '.repeat(400)}\nEND_PROGRAM\n`],
    ['rỗng hoàn toàn', ''],
    ['chỉ có khoảng trắng', '   \n\t\n'],
  ]

  it.each(HOSTILE)('%s: editor vẫn dựng được và vẫn nhận thao tác', (_label, source) => {
    const { textarea } = renderEditor(source)
    expect(textarea).toBeInTheDocument()
    // đặt con trỏ khắp nguồn: mọi bước đều đi qua chỉ mục tham chiếu
    for (const offset of [0, Math.floor(source.length / 2), source.length]) {
      textarea.setSelectionRange(offset, offset)
      fireEvent.select(textarea)
    }
    fireEvent.keyDown(textarea, { key: 'F12' })
    expect(screen.getByText('Tham chiếu tại con trỏ')).toBeInTheDocument()
  })
})

/* `AC-ST-004` — "Save never changes Active". Ở lớp FE, điều đó có nghĩa: nút
 * Lưu chỉ phát THAO TÁC DRAFT, không có đường nào từ editor đụng tới Active. */
describe('SourceEditor — Lưu chỉ chạm Draft (AC-ST-004)', () => {
  /** Nút Lưu chỉ bật khi buffer khác bản đã cam kết, nên harness phải giữ
   *  state thật — editor "controlled giả" không bao giờ dirty. */
  function renderDirtyEditor(initial: string, onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>) {
    function Harness() {
      const [source, setSource] = useState(initial)
      return (
        <SourceEditor
          program={program(initial)}
          source={source}
          canEdit
          saving={false}
          diagnostics={[]}
          focusDiagnostic={null}
          onChange={setSource}
          onSave={onSave}
          pointCatalogStatus="idle"
          pointCatalogItems={[]}
          pointCatalogError={null}
          onEnsurePointCatalogLoaded={vi.fn()}
        />
      )
    }
    render(<I18nProvider><Harness /></I18nProvider>)
    return { textarea: screen.getByLabelText(/Mã nguồn ST/) as HTMLTextAreaElement }
  }

  it('nút Lưu phát đúng một op replaceProgramSource, không op vòng đời nào khác', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    const { textarea } = renderDirtyEditor('PROGRAM P\nEND_PROGRAM\n', onSave)
    fireEvent.change(textarea, { target: { value: 'PROGRAM P\nX := 1;\nEND_PROGRAM\n' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }))

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const operations = onSave.mock.calls[0][0] as ProgrammingDraftOperation[]
    expect(operations).toHaveLength(1)
    expect(operations[0].op).toBe('replaceProgramSource')
    expect(operations.some((operation) => /commission|activate|enable|restore/i.test(operation.op))).toBe(false)
  })
})
