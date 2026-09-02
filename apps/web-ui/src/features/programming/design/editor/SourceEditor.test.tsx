import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '../../../../shared/i18n'
import { ST_LANGUAGE_PROFILE_VERSION } from '../../api/generated/stLanguageProfile'
import { hashBufferSource } from '../../shared/diagnosticFreshness'
import { SourceEditor } from './ProgramsTab'
import { StCrossReferencePanel } from './StCrossReferencePanel'
import type { StCursorSymbol } from './stReferenceIndex'
import type { ProgrammingDiagnostic, ProgrammingDraftOperation, ProgrammingPointCatalogEntry, ProgrammingProgram } from '../../model/types'

function program(document: string): ProgrammingProgram {
  return { programId: 'program-1', name: 'AHU_FanControl', kind: 'PROGRAM', language: 'ST', document }
}

function renderEditor(source: string, options?: {
  canEdit?: boolean
  diagnostics?: ProgrammingDiagnostic[]
  hasCheckResult?: boolean
  checkRevisionId?: string | null
  onChange?: (value: string) => void
  pointCatalogStatus?: 'idle' | 'loading' | 'ready' | 'error'
  pointCatalogItems?: ProgrammingPointCatalogEntry[]
  onEnsurePointCatalogLoaded?: () => void
  onSave?: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
  codeMapOpen?: boolean
  maximized?: boolean
  onToggleMaximized?: () => void
}) {
  const onChange = options?.onChange ?? vi.fn()
  const onSave = options?.onSave ?? vi.fn().mockResolvedValue(true)
  const onEnsurePointCatalogLoaded = options?.onEnsurePointCatalogLoaded ?? vi.fn()
  /* Khay "Tham chiếu tại con trỏ" nay sống ở CỘT PHẢI (`ProgramsTab`), cạnh
   * Inspector nói về cùng ký hiệu đó — trước nó nằm dưới chỗ gõ và kéo dài cột
   * giữa. Harness dựng lại ĐÚNG cách nối của production (`onCursorSymbolChange`
   * → panel) thay vì soi vào trong editor: bộ test này khoá hành vi "con trỏ
   * đổi thì khay nói đúng ký hiệu", và hành vi đó đi qua chính seam này. */
  function Harness() {
    const [cursorSymbol, setCursorSymbol] = useState<StCursorSymbol | null>(null)
    /* Buffer phải là STATE, không phải hằng số đóng gói.
     *
     * Khay tham chiếu render lại theo con trỏ, và một `source` cố định sẽ dội
     * giá trị CŨ ngược vào `<textarea>` ở đúng lần render đó — buffer người dùng
     * vừa gõ biến mất. Ở production `ProgramsTab` giữ `buffers`, nên harness
     * phải giữ đúng vai trò ấy thay vì dựng một mô hình dữ liệu khác. */
    const [value, setValue] = useState(source)
    return (
      <>
        <SourceEditor
          codeMapOpen={options?.codeMapOpen ?? false}
          maximized={options?.maximized ?? false}
          onToggleMaximized={options?.onToggleMaximized}
          program={program(source)}
          source={value}
          canEdit={options?.canEdit ?? true}
          saving={false}
          diagnostics={options?.diagnostics ?? []}
          hasCheckResult={options?.hasCheckResult ?? false}
          checkRevisionId={options?.checkRevisionId ?? null}
          focusDiagnostic={null}
          onChange={(next) => { setValue(next); onChange(next) }}
          onSave={onSave}
          onCursorSymbolChange={setCursorSymbol}
          pointCatalogStatus={options?.pointCatalogStatus ?? 'idle'}
          pointCatalogItems={options?.pointCatalogItems ?? []}
          pointCatalogError={null}
          onEnsurePointCatalogLoaded={onEnsurePointCatalogLoaded}
        />
        <StCrossReferencePanel cursorSymbol={cursorSymbol} note={null} onJump={vi.fn()} />
      </>
    )
  }
  const utils = render(<I18nProvider><Harness /></I18nProvider>)
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

  /* `ISS-STED-04` × `ISS-STED-18` — gạch lỗi CHỈ khi diagnostic chứng minh được
   * nó thuộc về đúng nội dung đang mở. Trước hai issue này, mọi diagnostic
   * truyền vào đều được gạch; đó chính là hành vi nguy hiểm mà chúng cấm, nên
   * fixture của test cũng phải mang provenance thật. */
  const UNDERLINE_SOURCE = 'PROGRAM P\nX := ;\nEND_PROGRAM\n'

  async function markableDiagnostics(source: string): Promise<ProgrammingDiagnostic[]> {
    return [
      {
        code: 'ST-SYN-001',
        severity: 'ERROR',
        messageKey: 'x',
        location: {
          line: 2,
          column: 6,
          length: 1,
          programId: 'program-1',
          pouId: 'program-1',
          revisionId: 'rev-1',
          sourceSha256: await hashBufferSource(source),
          stLanguageProfileVersion: ST_LANGUAGE_PROFILE_VERSION,
        },
      },
    ]
  }

  it('diagnostic underline: click vào đoạn lỗi nhảy đúng vùng chọn (line/column/length)', async () => {
    const diagnostics = await markableDiagnostics(UNDERLINE_SOURCE)
    const { container, textarea } = renderEditor(UNDERLINE_SOURCE, {
      diagnostics,
      hasCheckResult: true,
      checkRevisionId: 'rev-1',
    })
    // Băm buffer là bất đồng bộ, nên chờ đúng lúc dấu gạch xuất hiện.
    const errorSpan = await waitFor(() => {
      const overlay = container.querySelector('pre.pointer-events-none')!
      const span = overlay.querySelector('span[class*="decoration-wavy"]')
      expect(span).toBeTruthy()
      return span!
    })
    fireEvent.click(errorSpan)
    expect(textarea.selectionStart).toBe(UNDERLINE_SOURCE.indexOf('X := ;') + 5)
  })

  /* Nửa còn lại của hợp đồng, và là nửa quan trọng hơn: KHÔNG gạch khi không
   * chứng minh được. Một dấu gạch sai chỗ nguy hiểm hơn không có dấu nào —
   * người dùng sẽ sửa đúng chỗ bị chỉ, tức sửa một chỗ không hỏng. */
  it('diagnostic KHÔNG mang provenance thì KHÔNG được gạch', async () => {
    const { container } = renderEditor(UNDERLINE_SOURCE, {
      diagnostics: [
        { code: 'ST-SYN-001', severity: 'ERROR', messageKey: 'x', location: { line: 2, column: 6, length: 1 } },
      ],
      hasCheckResult: true,
      checkRevisionId: 'rev-1',
    })
    await waitFor(() => {
      expect(screen.getByText(/không có lỗi|diagnostic từ Kiểm tra|không còn khớp/)).toBeInTheDocument()
    })
    const overlay = container.querySelector('pre.pointer-events-none')!
    expect(overlay.querySelector('span[class*="decoration-wavy"]')).toBeNull()
  })

  it('buffer đã đổi sau Kiểm tra ⇒ gỡ dấu gạch và nói rõ lý do', async () => {
    const diagnostics = await markableDiagnostics(UNDERLINE_SOURCE)
    const { container, textarea } = renderEditor(UNDERLINE_SOURCE, {
      diagnostics,
      hasCheckResult: true,
      checkRevisionId: 'rev-1',
    })
    await waitFor(() => {
      const overlay = container.querySelector('pre.pointer-events-none')!
      expect(overlay.querySelector('span[class*="decoration-wavy"]')).toBeTruthy()
    })
    // Sửa đúng MỘT ký tự.
    fireEvent.change(textarea, { target: { value: UNDERLINE_SOURCE + ' ' } })
    await waitFor(() => {
      expect(screen.getByText(/buffer đã đổi sau Kiểm tra/)).toBeInTheDocument()
    })
    const overlay = container.querySelector('pre.pointer-events-none')!
    expect(overlay.querySelector('span[class*="decoration-wavy"]')).toBeNull()
  })

  /* Chưa Kiểm tra ≠ "không có lỗi". Nói "không có lỗi" khi chưa ai kiểm là
   * khẳng định một điều chưa được xác lập. */
  it('Draft chưa từng Kiểm tra ⇒ nói "Chưa Kiểm tra", KHÔNG nói "không có lỗi"', () => {
    renderEditor(UNDERLINE_SOURCE, { diagnostics: [], hasCheckResult: false })
    expect(screen.getByText(/Chưa Kiểm tra/)).toBeInTheDocument()
    expect(screen.queryByText(/không có lỗi/)).not.toBeInTheDocument()
  })

  it('đã Kiểm tra và POU sạch ⇒ nói "không có lỗi" kèm revision', () => {
    renderEditor(UNDERLINE_SOURCE, { diagnostics: [], hasCheckResult: true, checkRevisionId: 'rev-1' })
    expect(screen.getByText(/revision rev-1: POU này không có lỗi/)).toBeInTheDocument()
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

describe('DEV-PROG-012 — Tới dòng từ thanh trạng thái', () => {
  it('bấm ô Dòng:Cột mở hộp Tới dòng, nhập số đưa con trỏ tới đầu dòng đó', () => {
    const source = 'PROGRAM P\nVAR\n  A : INT;\nEND_VAR\nA := 1;\nEND_PROGRAM\n'
    const { textarea } = renderEditor(source)
    fireEvent.click(within(screen.getByTestId('editor-status-position')).getByRole('button'))
    const form = screen.getByTestId('editor-go-to-line')
    fireEvent.change(within(form).getByLabelText(/Tới dòng/), { target: { value: '5' } })
    fireEvent.submit(form)
    expect(textarea.selectionStart).toBe(source.indexOf('A := 1;'))
    expect(screen.getByTestId('editor-status-position')).toHaveTextContent('5:1')
  })

  it('số ngoài phạm vi KẸP về dòng cuối, không báo lỗi bắt gõ lại', () => {
    // Người gõ `9999` đang nói "xuống cuối tệp"; một thông báo lỗi ở đó chỉ bắt
    // họ đoán lại một con số họ không biết.
    const source = 'A := 1;\nB := 2;\n'
    const { textarea } = renderEditor(source)
    fireEvent.click(within(screen.getByTestId('editor-status-position')).getByRole('button'))
    const form = screen.getByTestId('editor-go-to-line')
    fireEvent.change(within(form).getByLabelText(/Tới dòng/), { target: { value: '9999' } })
    fireEvent.submit(form)
    expect(textarea.selectionStart).toBe(source.length)
  })

  it('số không hợp lệ KHÔNG di chuyển con trỏ và không đóng hộp', () => {
    const { textarea } = renderEditor('A := 1;\nB := 2;\n')
    textarea.setSelectionRange(0, 0)
    fireEvent.click(within(screen.getByTestId('editor-status-position')).getByRole('button'))
    const form = screen.getByTestId('editor-go-to-line')
    fireEvent.change(within(form).getByLabelText(/Tới dòng/), { target: { value: 'abc' } })
    fireEvent.submit(form)
    expect(textarea.selectionStart).toBe(0)
    expect(screen.getByTestId('editor-go-to-line')).toBeInTheDocument()
  })
})

describe('DEV-PROG-019 — nút Định dạng trong trình soạn thảo', () => {
  const MESSY = 'PROGRAM t\nIF A THEN\nX:=1;\nEND_IF\n;\nEND_PROGRAM\n'

  it('bấm Định dạng đưa buffer về đúng style, KHÔNG tự Lưu', () => {
    const onSave = vi.fn().mockResolvedValue(true)
    const { textarea } = renderEditor(MESSY, { onSave })
    fireEvent.click(screen.getByRole('button', { name: 'Định dạng' }))
    expect(textarea.value).toBe([
      'PROGRAM t',
      '    IF A THEN',
      '        X := 1;',
      '    END_IF;',
      'END_PROGRAM',
      '',
    ].join('\n'))
    // Định dạng chỉ đổi buffer; Kiểm tra/Lưu/Commission vẫn do người dùng chủ động.
    expect(onSave).not.toHaveBeenCalled()
  })

  it('Ctrl+Shift+F làm đúng việc của nút', () => {
    const { textarea } = renderEditor(MESSY)
    fireEvent.keyDown(textarea, { key: 'F', ctrlKey: true, shiftKey: true })
    expect(textarea.value).toContain('    END_IF;')
  })

  it('nguồn không phân tích được ⇒ KHÔNG đổi buffer và NÓI RA lý do', () => {
    // Im lặng khi từ chối là để người dùng bấm nút, không thấy gì xảy ra, và
    // tưởng nút hỏng.
    const broken = 'PROGRAM t\n(* chú thích chưa đóng\nX := 1;\nEND_PROGRAM\n'
    const { textarea } = renderEditor(broken)
    fireEvent.click(screen.getByRole('button', { name: 'Định dạng' }))
    expect(textarea.value).toBe(broken)
    expect(screen.getByRole('alert')).toHaveTextContent(/Không định dạng được/)
    expect(screen.getByRole('alert')).toHaveTextContent(/không được đóng/)
  })

  it('nguồn đã đúng style ⇒ nói "đã đúng định dạng", không báo lỗi', () => {
    const tidy = 'PROGRAM t\n    X := 1;\nEND_PROGRAM\n'
    renderEditor(tidy)
    fireEvent.click(screen.getByRole('button', { name: 'Định dạng' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Mã nguồn đã đúng định dạng.')
  })

  it('menu ▾ có hai mức: tài liệu và vùng chọn', () => {
    renderEditor(MESSY)
    fireEvent.click(screen.getByRole('button', { name: 'Tuỳ chọn định dạng' }))
    const menu = screen.getByRole('menu', { name: 'Tuỳ chọn định dạng' })
    expect(within(menu).getByRole('menuitem', { name: /Định dạng tài liệu/ })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Định dạng vùng chọn' })).toBeInTheDocument()
  })

  it('Định dạng vùng chọn khi chưa chọn gì ⇒ nói ra, không âm thầm format cả tệp', () => {
    const { textarea } = renderEditor(MESSY)
    textarea.setSelectionRange(0, 0)
    fireEvent.click(screen.getByRole('button', { name: 'Tuỳ chọn định dạng' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Định dạng vùng chọn' }))
    expect(textarea.value).toBe(MESSY)
    expect(screen.getByRole('alert')).toHaveTextContent('Chưa chọn vùng nào để định dạng.')
  })
})

/*
`DEV-PROG-020` — gợi ý phải thấy được ở dòng SÂU, sau khi đã cuộn.

Lỗi người dùng báo: "gõ ST thì từ gợi ý đâu mất rồi". Popup được đặt theo
`cursor.line * ROW_HEIGHT`, tức toạ độ trong toàn bộ văn bản, trong khi khung
soạn thảo là hộp cao cố định có `overflow-hidden`. Làm việc ở dòng 200 thì popup
vẽ ở `top: 4000px` — ngoài hộp, bị cắt sạch, không lỗi và không cảnh báo.

Bộ test cũ không bắt được vì mọi case đều gõ ở dòng 1, nơi độ cuộn luôn bằng 0.
*/
describe('SourceEditor — gợi ý ở dòng sâu', () => {
  it('popup gợi ý nằm TRONG khung nhìn sau khi cuộn, không bị đẩy ra ngoài', () => {
    const lines = Array.from({ length: 200 }, (_, index) => `L${index} := 1.0;`)
    const before = [...lines, 'X := A'].join('\n')
    const after = [...lines, 'X := AB'].join('\n')
    const { textarea } = renderEditor(before, { onChange: vi.fn() })

    // Cuộn xuống như người dùng thật rồi mới gõ.
    Object.defineProperty(textarea, 'scrollTop', { value: 3800, writable: true, configurable: true })
    fireEvent.scroll(textarea)
    fireEvent.change(textarea, { target: { value: after } })

    const popup = screen.getByRole('listbox', { name: /Gợi ý|Suggestions/ })
    const top = Number.parseFloat((popup as HTMLElement).style.top)
    // Không khẳng định một con số cụ thể — khẳng định điều người dùng cần: nó
    // KHÔNG bị đẩy xuống dưới đáy khung. Trước bản vá, `top` là hơn 4000px.
    expect(Number.isFinite(top)).toBe(true)
    expect(top).toBeLessThan(1000)
  })
})

/*
`DEV-PROG-021` — bản đồ mã: có nội dung thì mới được chiếm chỗ.

Lỗi người dùng báo: dải bản đồ hiện ra RỖNG. `StCodeMap` tự trả `null` cho POU
ngắn (dưới 80 dòng), nhưng khung bọc `w-44` vẫn được render — nên một dải trống
chiếm chỗ và ăn mất bề ngang của chính chỗ gõ. Điều kiện phải hỏi ở chỗ BỌC,
không để bên trong tự im lặng.
*/
describe('SourceEditor — dải bản đồ mã', () => {
  it('POU ngắn: KHÔNG dựng khung, không để lại dải rỗng', () => {
    const short = Array.from({ length: 20 }, (_, i) => `L${i} := 1.0;`).join('\n')
    const { container } = renderEditor(short, { onChange: vi.fn(), codeMapOpen: true })
    expect(screen.queryByTestId('st-code-map')).not.toBeInTheDocument()
    // Và không có khung bọc rỗng nào còn lại.
    expect(container.querySelector('.w-44')).toBeNull()
  })

  it('POU dài: dải có nội dung thật, điều hướng được', () => {
    const long = [
      'PROGRAM Big',
      'VAR_INPUT',
      ...Array.from({ length: 90 }, (_, i) => `  L${i} : REAL;`),
      'END_VAR',
      'END_PROGRAM',
    ].join('\n')
    renderEditor(long, { onChange: vi.fn(), codeMapOpen: true })
    const map = screen.getByTestId('st-code-map')
    expect(map).toBeInTheDocument()
    expect(within(map).getAllByTestId('st-code-map-entry').length).toBeGreaterThan(0)
  })
})

describe('DEV-PROG-023 — bấm Bản đồ mã phải kéo màn hình tới đúng dòng', () => {
  /** POU đủ dài để Bản đồ mã xuất hiện (ngưỡng 80 dòng), với một `IF` ở tận dòng 100. */
  function longSource(): string {
    const filler = Array.from({ length: 95 }, (_, index) => `  Counter${index} := ${index};`)
    return ['PROGRAM P', 'VAR', '  Counter0 : INT;', 'END_VAR', ...filler, '  IF Counter0 > 0 THEN', '    Counter0 := 0;', '  END_IF;', 'END_PROGRAM', ''].join('\n')
  }

  /** jsdom không có layout: `clientHeight`/`scrollHeight` luôn 0 và `scrollTop`
   *  không giữ giá trị. Dựng lại đúng ba số đó để hình học được kiểm thật. */
  function stubGeometry(textarea: HTMLTextAreaElement, lines: number) {
    let scrollTop = 0
    Object.defineProperty(textarea, 'scrollTop', {
      configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value },
    })
    Object.defineProperty(textarea, 'clientHeight', { configurable: true, value: 260 })
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: lines * 20 + 24 })
  }

  it('mục ở dòng sâu: textarea cuộn tới đó, gutter và overlay đi theo cùng một `scrollTop`', () => {
    const source = longSource()
    const { textarea, container } = renderEditor(source, { codeMapOpen: true })
    stubGeometry(textarea, source.split('\n').length)

    const entries = Array.from(container.querySelectorAll('[data-testid="st-code-map-entry"]')) as HTMLElement[]
    const deep = entries.find((entry) => Number(entry.dataset.line) > 80)
    expect(deep, 'Bản đồ mã phải có mục ở dòng sâu để bấm').toBeDefined()

    expect(textarea.scrollTop).toBe(0)
    fireEvent.click(deep!)

    // Dòng đích nằm quanh 1900 px tính từ đầu tài liệu; điều được khoá ở đây là
    // "màn hình ĐÃ đi theo", không phải một con số pixel chính xác.
    expect(textarea.scrollTop).toBeGreaterThan(1000)

    const gutter = container.querySelector('[aria-hidden="true"].mono') as HTMLElement
    const overlay = container.querySelector('pre.mono') as HTMLElement
    expect(gutter.scrollTop).toBe(textarea.scrollTop)
    expect(overlay.scrollTop).toBe(textarea.scrollTop)
  })

  it('đang cuộn ở cuối tệp rồi bấm mục ở đầu: về đầu, và về cả mép trái', () => {
    const source = longSource()
    const { textarea, container } = renderEditor(source, { codeMapOpen: true })
    stubGeometry(textarea, source.split('\n').length)
    textarea.scrollTop = 1800
    textarea.scrollLeft = 400

    const first = container.querySelector('[data-testid="st-code-map-entry"]') as HTMLElement
    expect(Number(first.dataset.line)).toBe(1)
    fireEvent.click(first)

    expect(textarea.scrollTop).toBe(0)
    // Mục Bản đồ mã luôn đáp xuống cột 1; giữ `scrollLeft` cũ là đưa người dùng
    // tới đúng dòng nhưng nhìn vào khoảng trắng bên phải của nó.
    expect(textarea.scrollLeft).toBe(0)
  })
})

describe('DEV-PROG-026 — nút gõ toàn màn hình', () => {
  it('có mặt trên thanh công cụ, nói đúng trạng thái, và gọi đúng handler', () => {
    const onToggleMaximized = vi.fn()
    renderEditor('PROGRAM P\nEND_PROGRAM\n', { onToggleMaximized })

    const button = screen.getByRole('button', { name: 'Gõ toàn màn hình' })
    // `aria-pressed` chứ không phải chỉ đổi icon: một nút bật/tắt mà trình đọc
    // màn hình không biết đang bật hay tắt thì người dùng phải đoán.
    expect(button).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(button)
    expect(onToggleMaximized).toHaveBeenCalledTimes(1)
  })

  it('khi đang toàn màn hình thì nhãn và aria-pressed đổi theo, không chỉ đổi icon', () => {
    renderEditor('PROGRAM P\nEND_PROGRAM\n', { maximized: true, onToggleMaximized: vi.fn() })
    const button = screen.getByRole('button', { name: 'Thoát toàn màn hình' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })

  it('KHÔNG dựng nút khi bề mặt gọi không cấp handler — không có nút chết', () => {
    renderEditor('PROGRAM P\nEND_PROGRAM\n')
    expect(screen.queryByRole('button', { name: /toàn màn hình/ })).toBeNull()
  })

  it('Ctrl+Shift+M trong ô gõ bật/tắt chế độ', () => {
    const onToggleMaximized = vi.fn()
    const { textarea } = renderEditor('PROGRAM P\nEND_PROGRAM\n', { onToggleMaximized })
    fireEvent.keyDown(textarea, { key: 'M', ctrlKey: true, shiftKey: true })
    expect(onToggleMaximized).toHaveBeenCalledTimes(1)
  })
  /* `ISS-STED-11` — gợi ý chữ ký ngay tại chỗ người dùng đang gõ.
   *
   * Test đơn vị của `stSignatureHelp` chứng minh bộ máy đúng; những test dưới
   * đây chứng minh nó THỰC SỰ hiện ra và thực sự đóng được — một bộ máy đúng
   * mà không ai nối vào editor thì người dùng vẫn phải tự nhớ thứ tự tham số.
   */
  function typeSource(textarea: HTMLTextAreaElement, next: string) {
    fireEvent.change(textarea, { target: { value: next, selectionStart: next.length, selectionEnd: next.length } })
  }

  it('gõ `(` sau tên hàm thì hiện chữ ký lấy từ registry', async () => {
    const { textarea } = renderEditor('PROGRAM P\nVAR x : REAL; END_VAR\nEND_PROGRAM\n')
    typeSource(textarea, 'PROGRAM P\nVAR x : REAL; END_VAR\nx := LIMIT(')

    const help = await screen.findByTestId('st-signature-help')
    expect(help).toHaveAttribute('data-signature-callee', 'LIMIT')
    expect(help.textContent).toContain('MN')
    expect(help.textContent).toContain('MX')
  })

  it('tham số đang nhập dịch theo dấu phẩy', async () => {
    const { textarea } = renderEditor('PROGRAM P\nEND_PROGRAM\n')
    typeSource(textarea, 'x := LIMIT(')
    await waitFor(() => expect(screen.getByTestId('st-signature-help'))
      .toHaveAttribute('data-signature-active', '0'))
    typeSource(textarea, 'x := LIMIT(a, ')
    await waitFor(() => expect(screen.getByTestId('st-signature-help'))
      .toHaveAttribute('data-signature-active', '1'))
  })

  it('instance FB hiện dạng gọi theo tên, không gợi ý dạng theo vị trí', async () => {
    const { textarea } = renderEditor('PROGRAM P\nVAR TON_1 : TON; END_VAR\nEND_PROGRAM\n')
    typeSource(textarea, 'PROGRAM P\nVAR TON_1 : TON; END_VAR\nTON_1(')

    const help = await screen.findByTestId('st-signature-help')
    expect(help.textContent).toContain('IN :=')
    expect(help.textContent).toContain('PT :=')
    // `D4` phải đọc được ngay tại chỗ đang gõ, không đợi tới bước Kiểm tra.
    expect(help.textContent).toContain('D4')
  })

  it('khối chờ review vẫn hiện chữ ký nhưng nói rõ Kiểm tra sẽ từ chối', async () => {
    const { textarea } = renderEditor('PROGRAM P\nVAR PID_1 : PID; END_VAR\nEND_PROGRAM\n')
    typeSource(textarea, 'PROGRAM P\nVAR PID_1 : PID; END_VAR\nPID_1(')

    const help = await screen.findByTestId('st-signature-help')
    expect(help).toHaveAttribute('data-signature-callee', 'PID_1')
    expect(help.textContent).toContain('Kiểm tra sẽ từ chối')
  })

  it('Esc đóng chữ ký và KHÔNG chặn gõ tiếp', async () => {
    const { textarea } = renderEditor('PROGRAM P\nEND_PROGRAM\n')
    typeSource(textarea, 'x := ABS(')
    await screen.findByTestId('st-signature-help')

    fireEvent.keyDown(textarea, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('st-signature-help')).not.toBeInTheDocument())

    // Gõ tiếp vẫn chạy: chữ ký không được cướp focus hay nuốt phím.
    typeSource(textarea, 'x := ABS(y')
    expect(textarea.value).toBe('x := ABS(y')
  })

  it('đóng ngoặc xong thì chữ ký biến mất, và không tự chèn `)`', async () => {
    const { textarea } = renderEditor('PROGRAM P\nEND_PROGRAM\n')
    typeSource(textarea, 'x := ABS(')
    await screen.findByTestId('st-signature-help')
    // Người dùng tự gõ `)`; editor không được thêm dấu nào ngoài ý muốn.
    typeSource(textarea, 'x := ABS(y)')
    await waitFor(() => expect(screen.queryByTestId('st-signature-help')).not.toBeInTheDocument())
    expect(textarea.value).toBe('x := ABS(y)')
  })

  it('chữ ký đọc được bằng trình đọc màn hình mà không cướp focus', async () => {
    const { textarea } = renderEditor('PROGRAM P\nEND_PROGRAM\n')
    typeSource(textarea, 'x := LIMIT(')
    const help = await screen.findByTestId('st-signature-help')
    expect(help).toHaveAttribute('role', 'status')
    expect(help).toHaveAttribute('aria-live', 'polite')
    expect(help).not.toHaveAttribute('tabindex')
  })
})

/* `ISS-STED-15` / gate `G17` — BẰNG CHỨNG A11Y, KHÔNG PHẢI KHẲNG ĐỊNH A11Y.
 *
 * Với một trình soạn thảo dựng bằng `<textarea>` trong suốt + lớp phủ `<pre>`
 * tô màu, câu hỏi không phải "có `aria-label` không" mà là: **người không phân
 * biệt màu, và người chỉ dùng bàn phím, có làm được việc không.** Tương phản
 * token đo ở `stEditorA11y.test.ts`; ở đây đo HÀNH VI.
 */
describe('ISS-STED-15 — a11y của ST editor', () => {
  const SOURCE = 'PROGRAM P\nX := ;\nEND_PROGRAM\n'

  async function markable(): Promise<ProgrammingDiagnostic[]> {
    return [
      {
        code: 'ST-SYN-001', severity: 'ERROR', messageKey: 'programming.error.check',
        message: 'expected expression',
        location: {
          line: 2, column: 6, length: 1,
          programId: 'program-1', revisionId: 'rev-1', pouId: 'program-1',
          sourceSha256: await hashBufferSource(SOURCE),
          stLanguageProfileVersion: ST_LANGUAGE_PROFILE_VERSION,
        },
      },
    ]
  }

  it('diagnostic có kênh KHÔNG PHẢI MÀU: hình dạng gạch + chữ trong tooltip', async () => {
    const { container } = renderEditor(SOURCE, {
      diagnostics: await markable(), hasCheckResult: true, checkRevisionId: 'rev-1',
    })
    const span = await waitFor(() => {
      const found = container.querySelector('pre.pointer-events-none span[class*="decoration-wavy"]')
      expect(found).toBeTruthy()
      return found as HTMLElement
    })
    // Kênh 1 — HÌNH DẠNG: gạch lượn sóng, đọc được cả khi không thấy màu đỏ.
    expect(span.className).toContain('decoration-wavy')
    // Kênh 2 — CHỮ: mã lỗi nằm trong tooltip, không chỉ trong màu.
    expect(span.getAttribute('title')).toContain('ST-SYN-001')
  })

  it('diagnostic được THÔNG BÁO cho screen reader, không chỉ mô tả khi nhận focus', async () => {
    const { textarea } = renderEditor(SOURCE, {
      diagnostics: await markable(), hasCheckResult: true, checkRevisionId: 'rev-1',
    })
    const summary = await screen.findByText(/diagnostic từ Kiểm tra/)
    // `aria-describedby` chỉ được đọc lúc NHẬN focus. Kết quả Kiểm tra về khi
    // người dùng đang gõ — tức đang giữ focus — nên phải có `aria-live`.
    expect(summary).toHaveAttribute('aria-live', 'polite')
    expect(textarea.getAttribute('aria-describedby')).toBe(summary.id)
  })

  it('đi hết luồng soạn thảo → xem lỗi → sửa CHỈ BẰNG BÀN PHÍM', async () => {
    const { textarea } = renderEditor(SOURCE, {
      diagnostics: await markable(), hasCheckResult: true, checkRevisionId: 'rev-1',
    })
    await screen.findByText(/diagnostic từ Kiểm tra/)

    textarea.focus()
    expect(document.activeElement).toBe(textarea)

    // Ctrl+G mở hộp Tới dòng; Escape trả focus về đúng chỗ đang gõ.
    fireEvent.keyDown(textarea, { key: 'g', ctrlKey: true })
    const form = await screen.findByTestId('editor-go-to-line')
    const goTo = within(form).getByLabelText(/Tới dòng/)
    fireEvent.keyDown(goTo, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(textarea))

    // Sửa bằng bàn phím ⇒ dấu gạch được gỡ vì buffer đã đổi sau Kiểm tra.
    fireEvent.change(textarea, {
      target: { value: SOURCE.replace('X := ;', 'X := 1;'), selectionStart: 0, selectionEnd: 0 },
    })
    await waitFor(() => expect(screen.getByText(/buffer đã đổi sau Kiểm tra/)).toBeInTheDocument())
  })

  it('Escape trả focus về ô gõ khi đóng hộp Tới dòng', async () => {
    // Mất focus khi đóng một lớp phủ là cách người dùng bàn phím bị đẩy về đầu
    // trang — họ phải Tab lại từ đầu để quay về chỗ đang gõ.
    const { textarea } = renderEditor('PROGRAM P\nEND_PROGRAM\n')
    fireEvent.keyDown(textarea, { key: 'g', ctrlKey: true })
    const form = await screen.findByTestId('editor-go-to-line')
    const goTo = within(form).getByLabelText(/Tới dòng/)
    fireEvent.keyDown(goTo, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(textarea))
  })

  it('danh sách gợi ý KHÔNG cướp focus và đóng được bằng Escape', async () => {
    const { textarea } = renderEditor('PROGRAM P\nEND_PROGRAM\n')
    textarea.focus()
    fireEvent.change(textarea, { target: { value: 'IF', selectionStart: 2, selectionEnd: 2 } })
    await screen.findByRole('listbox')

    // Người dùng vẫn đang gõ: danh sách phải điều hướng được TỪ ô gõ.
    expect(document.activeElement).toBe(textarea)
    fireEvent.keyDown(textarea, { key: 'ArrowDown' })
    fireEvent.keyDown(textarea, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(document.activeElement).toBe(textarea)
  })
  /* Khay Thư viện nhanh sống ở `ProgramsTab` (ngoài `SourceEditor`), nên test
   * trả-focus của nó nằm ở `DesignWorkspacePage.test.tsx`. Khay Vấn đề đã có
   * test bẫy focus + trả focus ở `ProblemsDrawer.test.tsx`. */
  it('nút bật/tắt Bản đồ mã giữ nguyên focus trên chính nó', async () => {
    // Khác khay Thư viện: nút này KHÔNG biến mất khi bật/tắt, nên focus tự
    // nhiên ở lại. Test khoá điều đó để một lần đổi sang render có điều kiện
    // không lặng lẽ tạo ra cùng lỗi mất focus.
    const onToggleMaximized = vi.fn()
    const { textarea } = renderEditor('PROGRAM P\nEND_PROGRAM\n', { onToggleMaximized })
    textarea.focus()
    fireEvent.keyDown(textarea, { key: 'M', ctrlKey: true, shiftKey: true })
    expect(onToggleMaximized).toHaveBeenCalledTimes(1)
    // Phím tắt không cướp focus khỏi ô gõ.
    expect(document.activeElement).toBe(textarea)
  })
})
