import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '../../../../shared/i18n'
import { ProgrammingWorkbench, type WorkbenchMode, type WorkbenchProblem, type WorkbenchSymbol } from './ProgrammingWorkbench'

const SOURCE = 'PROGRAM P\nVAR\n  FanCmd : BOOL;\nEND_VAR\nFanCmd := TRUE;\nFanCmd := FALSE;\nEND_PROGRAM\n'

function renderWorkbench(overrides: {
  mode?: WorkbenchMode
  sourceLabel?: string
  problems?: WorkbenchProblem[]
  symbols?: WorkbenchSymbol[]
  source?: string | null
} = {}) {
  const onJumpToOffset = vi.fn()
  render(
    <I18nProvider>
      <ProgrammingWorkbench
        mode={overrides.mode ?? 'EDIT'}
        sourceLabel={overrides.sourceLabel ?? 'Draft · AHU_FanControl'}
        problems={overrides.problems ?? []}
        symbols={overrides.symbols ?? []}
        source={overrides.source === undefined ? SOURCE : overrides.source}
        onJumpToOffset={onJumpToOffset}
        checkOwnerHref="/eng/programming/projects/p1/commission"
      />
    </I18nProvider>,
  )
  return { onJumpToOffset }
}

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'vi')
  const prototype = Element.prototype as unknown as Record<string, unknown>
  if (typeof prototype.setPointerCapture !== 'function') {
    prototype.setPointerCapture = () => {}
    prototype.releasePointerCapture = () => {}
  }
})
afterEach(cleanup)

/* Ảnh chuẩn PGM-02B quy định khay đáy MỞ SẴN khi vào trang với chiều cao
 * mặc định 173 px. Quyết định này thay thế `DEV-PROG-024`. */
function openWorkbench() {
  const expandBtn = screen.queryByRole('button', { name: 'Mở rộng' })
  if (expandBtn) fireEvent.click(expandBtn)
}

/*
 * `T59-807` / `WP-06-R1`. Hai AC được khoá ở đây, và cả hai đều là
 * chống-nói-dối:
 *  - "Mỗi tab ghi rõ EDIT/SIMULATE/LIVE và revision/session source";
 *  - "unavailable tab giải thích capability" — một danh sách rỗng đọc như
 *    "không có gì", trong khi sự thật là "chưa đo được".
 */
describe('ProgrammingWorkbench (T59-807 / WP-06-R1)', () => {
  it('luôn khai mode và nguồn dữ liệu đang hiện', () => {
    renderWorkbench({ mode: 'EDIT', sourceLabel: 'Draft · AHU_FanControl' })
    expect(screen.getByText('EDIT · Draft · AHU_FanControl')).toBeInTheDocument()
  })

  it('Watch và Trace ở chế độ EDIT GIẢI THÍCH vì sao trống, không hiện danh sách rỗng', () => {
    renderWorkbench()
    fireEvent.click(screen.getByRole('tab', { name: 'Watch (Trực tiếp)' }))
    expect(screen.getByRole('status')).toHaveTextContent(/cần nguồn giá trị runtime/)
    expect(screen.getByRole('status')).toHaveTextContent(/Chế độ EDIT chỉ có Draft/)

    /* Trace KHÔNG cùng lý do với Watch: nó sở hữu một phiên có quota và vòng
     * đời riêng, nên nó thuộc về đúng một nơi (PGM-06) ở MỌI chế độ. Mở phiên
     * thứ hai từ workbench là đúng thứ AC "không duplicate concurrent trace
     * session" cấm. */
    fireEvent.click(screen.getByRole('tab', { name: 'Trace' }))
    expect(screen.getByRole('status')).toHaveTextContent(/phiên có quota và vòng đời riêng/)
  })

  it('khay Vấn đề nhảy tới đúng chỗ, và lỗi không neo được thì nói thẳng', () => {
    const onJump = vi.fn()
    renderWorkbench({
      problems: [
        { id: '1', code: 'FBD-SEM-TYPE-REF-001', detail: 'typeRef sai kind', jumpLabel: 'ENABLE_LOGIC › #2 AND', onJump },
        { id: '2', code: 'FBD-SCHEMA-ROOT-001', detail: 'profileId lạ', jumpLabel: null },
      ],
    })
    openWorkbench()
    fireEvent.click(screen.getByRole('button', { name: /FBD-SEM-TYPE-REF-001/ }))
    expect(onJump).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/không neo vào vị trí nào/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /FBD-SCHEMA-ROOT-001/ })).toBeNull()
  })

  it('giữ nguyên severity WARNING/INFO khi dùng ProblemsDrawer chung', () => {
    renderWorkbench({
      problems: [{
        id: 'warning-1',
        code: 'ST-WARN-001',
        detail: 'Cảnh báo từ compiler',
        severity: 'WARNING',
        jumpLabel: null,
      }],
    })
    fireEvent.click(screen.getByRole('tab', { name: /Vấn đề/ }))
    expect(screen.getByText('Cảnh báo:')).toBeInTheDocument()
    expect(screen.queryByText('Lỗi:')).toBeNull()
  })

  it('nói đích danh nơi sở hữu kết quả Kiểm tra, không để người dùng tưởng khay này là toàn bộ sự thật', () => {
    renderWorkbench()
    openWorkbench()
    const link = screen.getByRole('link', { name: /Kiểm tra & Đưa vào vận hành/ })
    expect(link).toHaveAttribute('href', '/eng/programming/projects/p1/commission')
  })

  it('Tìm kiếm liệt kê mọi lần khớp và nhảy tới đúng offset', () => {
    const { onJumpToOffset } = renderWorkbench()
    fireEvent.click(screen.getByRole('tab', { name: /Tìm kiếm/ }))
    fireEvent.change(screen.getByLabelText(/Tìm trong POU đang mở/), { target: { value: 'FanCmd' } })

    const panel = screen.getByRole('tabpanel')
    const hits = within(panel).getAllByRole('button', { name: /Dòng/ })
    // ba lần xuất hiện: khai báo + hai câu lệnh
    expect(hits).toHaveLength(3)

    fireEvent.click(hits[1])
    expect(onJumpToOffset).toHaveBeenCalledWith(SOURCE.indexOf('FanCmd := TRUE'), 'FanCmd'.length)
  })

  it('đổi POU thì kết quả tìm kiếm của tài liệu CŨ biến mất', () => {
    const { rerender } = render(
      <I18nProvider>
        <ProgrammingWorkbench
          mode="EDIT" sourceLabel="Draft · A" problems={[]} symbols={[]} source={SOURCE}
          onJumpToOffset={vi.fn()} checkOwnerHref="/x"
        />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('tab', { name: /Tìm kiếm/ }))
    fireEvent.change(screen.getByLabelText(/Tìm trong POU đang mở/), { target: { value: 'FanCmd' } })
    expect(within(screen.getByRole('tabpanel')).getAllByRole('button', { name: /Dòng/ })).toHaveLength(3)

    rerender(
      <I18nProvider>
        <ProgrammingWorkbench
          mode="EDIT" sourceLabel="Draft · B" problems={[]} symbols={[]} source={'PROGRAM Q\nEND_PROGRAM\n'}
          onJumpToOffset={vi.fn()} checkOwnerHref="/x"
        />
      </I18nProvider>,
    )
    expect((screen.getByLabelText(/Tìm trong POU đang mở/) as HTMLInputElement).value).toBe('')
    expect(within(screen.getByRole('tabpanel')).queryAllByRole('button', { name: /Dòng/ })).toHaveLength(0)
  })

  it('POU không phải văn bản thì tab Tìm kiếm giải thích, không hiện ô trống vô nghĩa', () => {
    renderWorkbench({ source: null })
    fireEvent.click(screen.getByRole('tab', { name: /Tìm kiếm/ }))
    expect(screen.getByRole('status')).toHaveTextContent(/không phải mã nguồn văn bản/)
    expect(screen.queryByLabelText(/Tìm trong POU đang mở/)).toBeNull()
  })

  it('Tham chiếu liệt kê ký hiệu kèm số đọc/ghi và nhảy được', () => {
    const onJump = vi.fn()
    renderWorkbench({
      symbols: [{ name: 'FanCmd', typeName: 'BOOL', kindLabel: 'biến', reads: 1, writes: 2, onJump }],
    })
    fireEvent.click(screen.getByRole('tab', { name: /Tham chiếu/ }))
    const entry = screen.getByRole('button', { name: /FanCmd/ })
    expect(entry).toHaveTextContent('Đọc 1 · Ghi 2')
    fireEvent.click(entry)
    expect(onJump).toHaveBeenCalledTimes(1)
  })

  it('MỞ SẴN ở chiều cao 173 px, và dải tab vẫn ở nguyên chỗ với đủ số đếm', () => {
    /* `PGM-02B` — mặc định đổi từ thu gọn sang mở, thay thế `DEV-PROG-024`.
       Ảnh chuẩn đo khay đáy y=729..901 tức 173 px. Điều phải giữ nguyên vẫn là
       thứ `DEV-PROG-001` đi sửa: khay KHÔNG được biến khỏi tầm mắt. Dải tab
       đứng yên tại chỗ, mỗi tab mang số đếm của nó, nên "có vấn đề gì không"
       đọc được ngay. */
    renderWorkbench({ problems: [{ id: '1', code: 'FBD-SEM-TYPE-REF-001', detail: 'x', jumpLabel: null }] })
    const panel = screen.getByRole('tabpanel')
    expect(panel).toBeInTheDocument()
    expect(panel.style.height).toBe('173px')
    expect(screen.getByRole('tab', { name: /Vấn đề \(1\)/ })).toBeInTheDocument()
    expect(screen.getByRole('separator')).toBeInTheDocument()
  })

  it('thu gọn rồi mở lại bằng chính nút đó', () => {
    /* Đảo thứ tự so với bản cũ vì khay nay mở sẵn: thao tác đầu tiên có nghĩa
       là thu gọn, không phải mở rộng. */
    renderWorkbench()
    fireEvent.click(screen.getByRole('button', { name: 'Thu gọn' }))
    expect(screen.queryByRole('tabpanel')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Mở rộng' }))
    expect(screen.getByRole('tabpanel')).toBeInTheDocument()
  })

  it('bấm THẲNG một tab cũng mở khay — không bắt đi qua nút Mở rộng', () => {
    renderWorkbench()
    fireEvent.click(screen.getByRole('tab', { name: /Tìm kiếm/ }))
    expect(screen.getByRole('tabpanel')).toBeInTheDocument()
  })

  it('tay kéo khai đủ giá trị ARIA — thiếu aria-valuenow là lỗi axe thật', () => {
    renderWorkbench()
    const handle = screen.getByRole('separator')
    expect(handle).toHaveAttribute('aria-valuemin', '120')
    expect(handle).toHaveAttribute('aria-valuemax', '520')
    /* `PGM-02B` nâng mặc định 120 → 173 theo số đo ảnh chuẩn (y=729..901).
     *
     * Sàn `MIN_HEIGHT` giữ nguyên 120 px, nên mặc định nay nằm HẲN TRONG
     * `[valuemin, valuemax]` thay vì đúng bằng sàn — `aria-valuenow` vẫn hợp
     * lệ, và đó là điều phép kiểm này canh.
     *
     * Lập luận cũ vẫn còn hiệu lực ở khổ chật: `DEV-PROG-021` hạ 150 → 120 sau
     * khi đo ở 1280×800, nơi workbench chiếm 211 px khiến chỗ gõ còn 158 px.
     * Người dùng ở màn hình đó thu khay về đúng 120 px như trước. */
    expect(handle).toHaveAttribute('aria-valuenow', '173')

    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(handle).toHaveAttribute('aria-valuenow', '197')
  })

  it('đổi chiều cao được bằng BÀN PHÍM, không chỉ bằng chuột', () => {
    renderWorkbench()
    openWorkbench()
    const handle = screen.getByRole('separator')
    const before = Number.parseInt((screen.getByRole('tabpanel') as HTMLElement).style.height, 10)

    const heightNow = () => Number.parseInt((screen.getByRole('tabpanel') as HTMLElement).style.height, 10)

    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    const raised = heightNow()
    expect(raised).toBeGreaterThan(before)

    /* `PGM-02B` nâng mặc định lên 173 px, cách sàn 120 px một khoảng thật — nên
       khẳng định được điều bản cũ không khẳng định nổi: phím xuống ĐI XUỐNG
       ĐƯỢC từ chính mặc định, và dừng ĐÚNG ở sàn chứ không xuyên qua. Bản cũ
       đặt mặc định bằng đúng sàn nên chỉ kiểm được vế "không xuyên sàn". */
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(heightNow()).toBeLessThan(raised)

    for (let step = 0; step < 6; step += 1) fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(heightNow(), 'phím xuống phải dừng đúng ở sàn MIN_HEIGHT').toBe(120)
  })

  it('kéo chuột đổi chiều cao trong khoảng cho phép, không vượt trần', () => {
    renderWorkbench()
    openWorkbench()
    const handle = screen.getByRole('separator')
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 500 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: -5000 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    const height = Number.parseInt((screen.getByRole('tabpanel') as HTMLElement).style.height, 10)
    expect(height).toBeLessThanOrEqual(520)
    expect(height).toBeGreaterThanOrEqual(120)
  })
})

/* `T59-811` — Watch trong workbench ở chế độ LIVE.
 *
 * Điều đáng khoá không phải "có bảng" mà là: bảng này chiếu từ CHÍNH snapshot
 * trang cha đã poll, và nó không tự diễn giải lại giá trị. Luật "null/BAD/
 * OFFLINE không bao giờ thành 0" sống ở `presentStRuntimeValue`; workbench chỉ
 * nhận `display`/`state` đã tính sẵn. */
describe('ProgrammingWorkbench — Watch ở LIVE (T59-811)', () => {
  const rows = [
    {
      variableId: 'v1', name: 'SupplyTemp', display: '21.5', state: 'live' as const, unit: 'degC',
      quality: 'GOOD' as const, typeName: 'REAL', observedAt: '2026-08-28T07:32:18.123Z', numeric: 21.5,
    },
    {
      variableId: 'v2', name: 'Missing', display: '—', state: 'invalid' as const, unit: 'degC',
      quality: 'BAD' as const, numeric: null,
    },
  ]

  function renderLiveWatch(watch: typeof rows | [] | null) {
    render(
      <I18nProvider>
        <ProgrammingWorkbench
          mode="LIVE" sourceLabel="Active · AHU" problems={[]} symbols={[]} source={null}
          onJumpToOffset={vi.fn()} checkOwnerHref="/x" watch={watch}
          traceOwnerHref="/eng/programming/runtime?tab=watch"
        />
      </I18nProvider>,
    )
  }

  it('hiện giá trị đã trình bày sẵn, và KHÔNG thêm đơn vị vào ô không hợp lệ', () => {
    renderLiveWatch(rows)
    fireEvent.click(screen.getByRole('tab', { name: /Watch/ }))
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByText('21.5 degC')).toBeInTheDocument()
    // `—` là "không có dữ liệu"; gắn đơn vị vào đó làm nó trông như một số đo.
    // `DEV-PROG-003` thêm cột Mốc đọc, cũng hiện `—` khi không có mốc — nên
    // phải soi ĐÚNG dòng thay vì đếm số lần chuỗi `—` xuất hiện trong khay.
    const invalidRow = within(panel).getAllByTestId('workbench-watch-row')[1]
    expect(within(invalidRow).getAllByText('—').length).toBeGreaterThanOrEqual(1)
    expect(within(panel).queryByText('— degC')).toBeNull()
  })

  it('tab Watch đếm đúng số biến đang theo dõi', () => {
    renderLiveWatch(rows)
    expect(screen.getByRole('tab', { name: 'Watch (Trực tiếp) (2)' })).toBeInTheDocument()
  })

  it('cột Runtime Watch hiện THƯỜNG TRỰC, không nằm sau một cú bấm tab', () => {
    /* `PGM-02B` — ảnh chuẩn đặt bảng Runtime Watch ở cột giữa khay đáy, luôn
       hiện. Đây là khác biệt hành vi thật so với bản cũ: trước kia phải bấm tab
       Watch mới thấy giá trị. Phép kiểm này canh đúng vế đó — KHÔNG bấm tab nào
       cả, và giá trị vẫn phải đọc được. */
    renderLiveWatch(rows)
    const watchColumn = screen.getByTestId('workbench-watch-column')
    expect(within(watchColumn).getByText('21.5 degC')).toBeInTheDocument()
    // Tab đang chọn vẫn là Vấn đề, chứng minh cột Watch không phụ thuộc tab.
    expect(screen.getByRole('tab', { name: /Vấn đề/, selected: true })).toBeInTheDocument()
  })

  it('có nguồn nhưng POU không có biến ánh xạ ⇒ nói đúng vế đó', () => {
    renderLiveWatch([])
    fireEvent.click(screen.getByRole('tab', { name: /Watch/ }))
    // KHÁC HẲN "chế độ này không có nguồn giá trị".
    expect(screen.getByRole('status')).toHaveTextContent(/không có biến runtime nào được ánh xạ/)
    expect(screen.queryByText(/Watch cần nguồn giá trị runtime/)).toBeNull()
  })

  it('Trace vẫn trỏ về nơi sở hữu phiên, kể cả ở LIVE', () => {
    renderLiveWatch(rows)
    fireEvent.click(screen.getByRole('tab', { name: 'Trace' }))
    expect(screen.getByRole('status')).toHaveTextContent(/phiên có quota và vòng đời riêng/)
    expect(screen.getByRole('link', { name: /Runtime & Bảo trì/ })).toHaveAttribute('href', '/eng/programming/runtime?tab=watch')
  })
})

/* `DEV-PROG-017` — tìm kiếm bằng biểu thức chính quy và danh sách chỗ dùng. */
describe('ProgrammingWorkbench — DEV-PROG-017', () => {
  it('bật biểu thức chính quy thì mẫu được hiểu là REGEX, không phải chữ thường', () => {
    renderWorkbench()
    fireEvent.click(screen.getByRole('tab', { name: /Tìm kiếm/ }))
    fireEvent.change(screen.getByLabelText(/Tìm trong POU đang mở/), { target: { value: 'Fan.*TRUE' } })
    // Tắt regex: `Fan.*TRUE` không phải một chuỗi có thật trong nguồn.
    expect(screen.getByText('Không có kết quả.')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Biểu thức chính quy'))
    expect(screen.queryByText('Không có kết quả.')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Tìm kiếm (1)' })).toBeInTheDocument()
  })

  it('biểu thức hỏng NÓI RA lỗi, không âm thầm rơi về tìm chữ thường', () => {
    // Người dùng gõ dở `IF (`: "0 kết quả" là câu trả lời đúng cho một mẫu chưa
    // hoàn chỉnh; lặng lẽ đi tìm chuỗi `IF (` là trả lời một câu hỏi khác.
    renderWorkbench()
    fireEvent.click(screen.getByRole('tab', { name: /Tìm kiếm/ }))
    fireEvent.click(screen.getByLabelText('Biểu thức chính quy'))
    fireEvent.change(screen.getByLabelText(/Tìm trong POU đang mở/), { target: { value: 'FanCmd(' } })
    expect(screen.getByRole('alert')).toHaveTextContent(/Biểu thức không hợp lệ/)
  })

  it('mẫu khớp chuỗi rỗng KHÔNG treo vòng lặp', () => {
    // `a*` khớp chuỗi rỗng ở mọi vị trí; không đẩy `lastIndex` thì `exec` đứng
    // yên mãi mãi và cả tab trắng màn hình.
    renderWorkbench()
    fireEvent.click(screen.getByRole('tab', { name: /Tìm kiếm/ }))
    fireEvent.click(screen.getByLabelText('Biểu thức chính quy'))
    fireEvent.change(screen.getByLabelText(/Tìm trong POU đang mở/), { target: { value: 'x*' } })
    expect(screen.getByRole('tab', { name: /Tìm kiếm \(\d+\)/ })).toBeInTheDocument()
  })

  it('khay Tham chiếu liệt kê TỪNG chỗ dùng, không chỉ con số đếm', () => {
    const onJump = vi.fn()
    renderWorkbench({
      symbols: [{
        name: 'FanCmd', typeName: 'BOOL', kindLabel: 'biến', reads: 1, writes: 2,
        onJump: vi.fn(),
        occurrences: [
          { line: 5, role: 'WRITE', preview: 'FanCmd := TRUE;', onJump },
          { line: 6, role: 'WRITE', preview: 'FanCmd := FALSE;', onJump: vi.fn() },
        ],
      }],
    })
    fireEvent.click(screen.getByRole('tab', { name: /Tham chiếu/ }))
    fireEvent.click(screen.getByText('Xem 2 chỗ dùng'))
    fireEvent.click(screen.getByText('FanCmd := TRUE;'))
    expect(onJump).toHaveBeenCalledTimes(1)
  })
})
