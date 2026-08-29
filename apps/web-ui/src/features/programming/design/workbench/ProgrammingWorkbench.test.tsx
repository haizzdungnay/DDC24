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
    fireEvent.click(screen.getByRole('button', { name: /FBD-SEM-TYPE-REF-001/ }))
    expect(onJump).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/không neo vào vị trí nào/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /FBD-SCHEMA-ROOT-001/ })).toBeNull()
  })

  it('nói đích danh nơi sở hữu kết quả Kiểm tra, không để người dùng tưởng khay này là toàn bộ sự thật', () => {
    renderWorkbench()
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

  it('thu gọn được và mở lại bằng chính nút đó', () => {
    renderWorkbench()
    const toggle = screen.getByRole('button', { name: 'Thu gọn' })
    expect(screen.getByRole('tabpanel')).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(screen.queryByRole('tabpanel')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Mở rộng' }))
    expect(screen.getByRole('tabpanel')).toBeInTheDocument()
  })

  it('tay kéo khai đủ giá trị ARIA — thiếu aria-valuenow là lỗi axe thật', () => {
    renderWorkbench()
    const handle = screen.getByRole('separator')
    expect(handle).toHaveAttribute('aria-valuemin', '120')
    expect(handle).toHaveAttribute('aria-valuemax', '520')
    /* `DEV-PROG-021` hạ tiếp 150 → 120 sau khi ĐO trên trình duyệt thật: ở
     * 1280×800 cột soạn thảo chỉ có 512 px, mà workbench chiếm 211 px khiến chỗ
     * gõ còn 158 px — khoảng tám dòng. Workbench là nơi tra cứu, chỗ gõ là nơi
     * làm việc; màn hình chật thì nơi làm việc được ưu tiên, và người dùng vẫn
     * kéo to lại bất cứ lúc nào.
     *
     * Dừng đúng ở 120 chứ không thấp hơn: đó là `MIN_HEIGHT`, và một mặc định
     * dưới sàn làm `aria-valuenow` rơi ra ngoài `[valuemin, valuemax]`.
     *
     * `DEV-PROG-001` trước đó hạ 200 → 150: workbench và trình soạn thảo chia
     * cùng một ngân sách chiều cao, nên mỗi pixel mặc định ở đây là một pixel
     * lấy khỏi chỗ người ta gõ. */
    expect(handle).toHaveAttribute('aria-valuenow', '120')

    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(handle).toHaveAttribute('aria-valuenow', '144')
  })

  it('đổi chiều cao được bằng BÀN PHÍM, không chỉ bằng chuột', () => {
    renderWorkbench()
    const handle = screen.getByRole('separator')
    const before = Number.parseInt((screen.getByRole('tabpanel') as HTMLElement).style.height, 10)

    const heightNow = () => Number.parseInt((screen.getByRole('tabpanel') as HTMLElement).style.height, 10)

    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    const raised = heightNow()
    expect(raised).toBeGreaterThan(before)

    /* Đi xuống từ chỗ ĐÃ NÂNG, không đi xuống từ mặc định: `DEV-PROG-021` đặt
       mặc định bằng đúng `MIN_HEIGHT`, nên từ đó phím xuống không còn chỗ. Đó
       là hành vi ĐÚNG và được khẳng định ngay bên dưới — chứ không phải một
       giới hạn của phép kiểm. */
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(heightNow()).toBeLessThan(raised)

    for (let step = 0; step < 6; step += 1) fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(heightNow(), 'phím xuống không được vượt qua sàn').toBeGreaterThanOrEqual(before)
  })

  it('kéo chuột đổi chiều cao trong khoảng cho phép, không vượt trần', () => {
    renderWorkbench()
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
