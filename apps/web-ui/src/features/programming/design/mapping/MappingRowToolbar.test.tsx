import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n'
import type { UserRole } from '../../../../shared/types'
import type { SystemCapabilities } from '../../../../shared/api/capabilities'
import type { ProgrammingDraftDocument, ProgrammingPointCatalogEntry } from '../../model/types'
import { MappingTab } from './MappingTab'

/**
 * `ISS-PGM03-05` — row, toolbar, validation và accessibility của tab Ánh xạ.
 *
 * Bốn chế độ hỏng mà tệp này khoá lại, tất cả đều là "màn hình vẫn chạy nhưng
 * người dùng đọc sai":
 *
 * 1. Bảy vùng dữ liệu không có tiêu đề cột ⇒ người dùng phải ĐOÁN cột nào là
 *    kiểu, cột nào là hướng.
 * 2. "Chưa map" chỉ là chữ nhỏ màu nhạt ⇒ mất hẳn khi in đen trắng hoặc khi
 *    người đọc không phân biệt được màu (`AC-PGM03-01`).
 * 3. Mọi hàng đều in "Mở nguồn" và một nút Map vô hiệu ⇒ người dùng bàn phím
 *    Tab qua hai control chết ở MỖI biến.
 * 4. Hàng chỉ in lý do ĐẦU TIÊN và không nói còn bao nhiêu lý do nữa ⇒ một biến
 *    vướng ba blocker trông hệt một biến vướng một.
 */

const auth = vi.hoisted(() => ({ role: 'admin' as UserRole }))
const catalog = vi.hoisted(() => ({
  status: 'ready' as 'loading' | 'ready' | 'error',
  items: [] as ProgrammingPointCatalogEntry[],
  complete: true as boolean | undefined,
}))

vi.mock('../../../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../auth')>()
  return { ...actual, useAuth: () => ({ session: { username: 'u', role: auth.role }, getAuthHeader: () => ({}) }) }
})

vi.mock('../../../../shared/api/capabilities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../shared/api/capabilities')>()
  return { ...actual, fetchSystemCapabilities: vi.fn(async () => ({ schemaVersion: 1, board: { model: 'DDC-24', channels: [] } } as unknown as SystemCapabilities)) }
})

vi.mock('../../api/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/queries')>()
  return {
    ...actual,
    useProgrammingPointCatalog: () => ({ status: catalog.status, data: { items: catalog.items }, error: null, lastSuccessAt: 100, complete: catalog.complete, refresh: vi.fn() }),
  }
})

const SOURCE = 'PROGRAM AHU_Main\nVAR_INPUT\n SupplyTemp : REAL;\nEND_VAR\nVAR_OUTPUT\n FanCmd : BOOL;\nEND_VAR\nEND_PROGRAM'

function documentFixture(bindings: ProgrammingDraftDocument['bindings'] = []): ProgrammingDraftDocument {
  return {
    schemaVersion: 1,
    project: { projectId: 'project-1', name: 'AHU', functionalTags: [] },
    programs: [{ programId: 'program-1', name: 'AHU_Main', kind: 'PROGRAM', language: 'ST', document: SOURCE }],
    variables: [{ variableId: 'var-supply', programId: 'program-1', name: 'SupplyTemp', type: 'REAL', class: 'INPUT', initialValue: null, retain: false }],
    bindings,
    task: { taskId: 'task-1', periodMs: 1000, programOrder: ['program-1'] },
    library: { profile: 'CORE_REVA', version: '1' },
  }
}

const SUPPORTED = { input: { status: 'SUPPORTED' as const, reasons: [] }, output: { status: 'SUPPORTED' as const, reasons: [] } }

beforeEach(() => {
  auth.role = 'admin'
  catalog.status = 'ready'
  catalog.complete = true
  catalog.items = [
    { category: 'LOCAL', pointId: 'UI-01', name: 'Supply Temp', dataType: 'REAL', unit: 'degC', direction: 'READ', writable: false, quality: 'GOOD', value: 21.4, equipment: 'AHU-01', mapping: SUPPORTED },
    { category: 'MB_RTU', deviceId: 'vfd-1', pointId: 'coil-1', name: 'VFD Enable', dataType: 'BOOL', direction: 'READ_WRITE', writable: true, quality: 'GOOD', value: true, mapping: SUPPORTED },
  ]
  localStorage.setItem('mkddc-lang', 'vi')
})

afterEach(cleanup)

function renderTab(document = documentFixture()) {
  return render(<I18nProvider><MappingTab document={document} saving={false} onSave={vi.fn()} /></I18nProvider>)
}

function openAdvancedFilters() {
  fireEvent.click(screen.getByRole('button', { name: /^Bộ lọc nâng cao/ }))
}

function variableRow(name: RegExp | string) {
  const label = screen.getByRole('button', { name })
  const row = label.closest('div.grid')
  if (!row) throw new Error('Không tìm được hàng chứa nút chọn biến')
  return row as HTMLElement
}

describe('ISS-PGM03-05 — hàng biến tự nói ra cột và trạng thái', () => {
  it('có tiêu đề cột ở desktop và nhãn trên từng ô cho khổ card', () => {
    renderTab()
    const list = screen.getByTestId('mapping-variable-list')
    const header = list.previousElementSibling as HTMLElement

    // Tiêu đề cột: đủ bảy cột theo thứ tự đề bài.
    for (const column of ['Biến', 'Kiểu', 'Hướng', 'Ánh xạ', 'Giá trị', 'Quality', 'Thao tác']) {
      expect(within(header).getByText(column)).toBeInTheDocument()
    }
    /* Hàng tiêu đề CHỈ để nhìn: nhãn cho screen reader nằm trên chính từng ô,
     * nếu không desktop sẽ đọc nhãn hai lần. */
    expect(header).toHaveAttribute('aria-hidden', 'true')

    // Và mỗi hàng vẫn tự mang nhãn — đây là thứ khổ card/mobile dựa vào.
    const row = variableRow('AHU_Main · SupplyTemp · Chưa map')
    for (const column of ['Kiểu', 'Hướng', 'Ánh xạ', 'Giá trị', 'Quality']) {
      expect(within(row).getByText(column)).toBeInTheDocument()
    }
  })

  /* `AC-PGM03-01` — nhận ra biến chưa map mà KHÔNG dựa vào màu. Ba tín hiệu
   * độc lập: chữ, biểu tượng, và kiểu viền (`dashed`). */
  it('trạng thái chưa map có chữ, biểu tượng và viền đứt — không chỉ có màu', () => {
    renderTab()
    const row = variableRow('AHU_Main · SupplyTemp · Chưa map')
    const pill = within(row).getByText('Chưa map').parentElement as HTMLElement

    expect(pill.className).toContain('border-dashed')
    expect(pill.querySelector('svg')).not.toBeNull()
    // Screen reader đọc được trạng thái ngay trên tên truy cập của hàng.
    expect(within(row).getByRole('button', { name: /· Chưa map$/ })).toBeInTheDocument()
  })

  it('chỉ hàng đang chọn mới có Mở nguồn và Map; hàng khác không có control chết', () => {
    renderTab()
    expect(screen.getAllByRole('button', { name: 'Mở nguồn' })).toHaveLength(1)

    const selected = variableRow('AHU_Main · SupplyTemp · Chưa map')
    expect(within(selected).getByRole('button', { name: 'Mở nguồn' })).toBeInTheDocument()

    const other = variableRow('AHU_Main · FanCmd · Chưa map')
    // Đúng MỘT nút trên hàng không được chọn: chính nút chọn hàng.
    expect(within(other).getAllByRole('button')).toHaveLength(1)

    fireEvent.click(within(other).getAllByRole('button')[0])
    expect(within(variableRow('AHU_Main · FanCmd · Chưa map')).getByRole('button', { name: 'Mở nguồn' })).toBeInTheDocument()
    expect(within(variableRow('AHU_Main · SupplyTemp · Chưa map')).queryByRole('button', { name: 'Mở nguồn' })).not.toBeInTheDocument()
  })

  it('hàng nói ra số lý do còn lại và Inspector liệt kê đủ cả ba', () => {
    catalog.items = [
      /* REAL ↔ BOOL, degC ↔ kPa, và quality STALE ⇒ ba lý do cùng lúc. */
      { category: 'LOCAL', pointId: 'UI-01', name: 'Supply Temp', dataType: 'BOOL', unit: 'kPa', direction: 'READ', writable: false, quality: 'STALE', value: null, mapping: SUPPORTED },
    ]
    renderTab(documentFixture([{ bindingId: 'binding-1', variableId: 'var-supply', point: { category: 'LOCAL', pointId: 'UI-01' }, direction: 'READ', dataType: 'REAL', unit: 'degC', writable: false, qualityPolicy: 'REQUIRE_GOOD' }]))

    const row = variableRow(/^AHU_Main · SupplyTemp ·/)
    expect(within(row).getByText(/Kiểu dữ liệu không khớp/)).toHaveTextContent('+2 lý do nữa')

    const inspector = screen.getByRole('complementary', { name: /Binding Inspector/ })
    expect(within(inspector).getByText('Chặn ánh xạ · 3 lý do')).toBeVisible()
    expect(within(inspector).getAllByRole('listitem')).toHaveLength(3)
    expect(within(inspector).getByText('Kiểu dữ liệu không khớp')).toBeVisible()
    expect(within(inspector).getByText('Đơn vị không khớp')).toBeVisible()
    expect(within(inspector).getByText(/Quality STALE không đạt REQUIRE_GOOD/)).toBeVisible()
  })

  it('viewer không có control mutation nào nhưng vẫn mở được nguồn', () => {
    auth.role = 'viewer'
    renderTab()
    expect(screen.getByRole('button', { name: 'Mở nguồn' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Ánh xạ / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Đổi ánh xạ / })).not.toBeInTheDocument()
  })
})

describe('ISS-PGM03-05 — toolbar primary, drawer nâng cao và chip bộ lọc', () => {
  it('drawer đóng mặc định, đếm đúng số bộ lọc nâng cao đang áp', () => {
    renderTab()
    const advanced = screen.getByRole('button', { name: /^Bộ lọc nâng cao/ })
    expect(advanced).toHaveAttribute('aria-expanded', 'false')
    expect(advanced).toHaveTextContent('0')
    // Đóng nghĩa là thật sự không tới được bằng bàn phím.
    expect(screen.queryByRole('combobox', { name: 'Loại Point' })).not.toBeInTheDocument()

    openAdvancedFilters()
    expect(screen.getByRole('button', { name: /^Bộ lọc nâng cao/ })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.change(screen.getByRole('combobox', { name: 'Loại Point' }), { target: { value: 'MB_RTU' } })
    expect(screen.getByRole('button', { name: /^Bộ lọc nâng cao/ })).toHaveTextContent('1')
  })

  /* Bộ lọc nâng cao đang áp KHÔNG được biến mất khỏi nhận thức người dùng chỉ
   * vì drawer đóng: nếu không, danh sách rỗng trông như mất dữ liệu. */
  it('mỗi bộ lọc đang áp có một chip gỡ được bằng bàn phím', () => {
    renderTab()
    openAdvancedFilters()
    fireEvent.change(screen.getByRole('combobox', { name: 'Loại Point' }), { target: { value: 'MB_RTU' } })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Tìm biến hoặc Point' }), { target: { value: 'VFD' } })

    const chips = within(screen.getByRole('list', { name: 'Bộ lọc đang áp' })).getAllByRole('button')
    expect(chips.map((chip) => chip.getAttribute('aria-label'))).toEqual([
      'Xóa bộ lọc Tìm kiếm: VFD',
      'Xóa bộ lọc Loại Point: MB_RTU',
    ])

    chips[1].focus()
    fireEvent.click(chips[1])
    expect(screen.getByRole('button', { name: /^Bộ lọc nâng cao/ })).toHaveTextContent('0')
    expect(within(screen.getByRole('list', { name: 'Bộ lọc đang áp' })).getAllByRole('button')).toHaveLength(1)
  })

  it('Xóa tất cả bộ lọc gỡ cả bộ lọc primary lẫn nâng cao', () => {
    renderTab()
    openAdvancedFilters()
    fireEvent.change(screen.getByRole('combobox', { name: 'Loại Point' }), { target: { value: 'MB_RTU' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Hướng Variable' }), { target: { value: 'OUTPUT' } })

    fireEvent.click(screen.getByRole('button', { name: 'Xóa tất cả bộ lọc' }))

    expect(screen.queryByRole('list', { name: 'Bộ lọc đang áp' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Bộ lọc nâng cao/ })).toHaveTextContent('0')
    expect((screen.getByRole('combobox', { name: 'Hướng Variable' }) as HTMLSelectElement).value).toBe('ALL')
  })

  it('danh sách rỗng nói ra điều kiện đang áp thay vì chỉ "không có kết quả"', () => {
    renderTab()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Tìm biến hoặc Point' }), { target: { value: 'không-có-gì-khớp' } })

    expect(screen.getByText(/Đang áp bộ lọc: Tìm kiếm: “không-có-gì-khớp”\. Xóa bớt bộ lọc để thấy thêm biến/)).toBeVisible()
    expect(screen.getByText(/Đang áp bộ lọc: Tìm kiếm: “không-có-gì-khớp”\. Xóa bớt bộ lọc để thấy thêm Point/)).toBeVisible()
  })

  /* Cụm đếm đứng chung cụm lọc làm "Mapped 1" trông như một bộ lọc bấm được. */
  it('cụm đếm nằm ngoài toolbar và nói ra khi catalog chưa đủ để tin', () => {
    const { unmount } = renderTab()
    const summary = screen.getByRole('region', { name: 'Tóm tắt ánh xạ' })
    expect(within(summary).getByText('Mapped 0')).toBeVisible()
    expect(within(screen.getByRole('region', { name: 'Mapping toolbar' })).queryByText('Mapped 0')).not.toBeInTheDocument()
    expect(within(summary).queryByText(/Số liệu chưa đầy đủ/)).not.toBeInTheDocument()
    unmount()

    catalog.complete = false
    renderTab()
    expect(within(screen.getByRole('region', { name: 'Tóm tắt ánh xạ' })).getByText(/Số liệu chưa đầy đủ/)).toBeVisible()
  })

  it('Gợi ý nói trạng thái bằng chữ, đổi được bằng bàn phím và không ghi gì', async () => {
    const onSave = vi.fn()
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={onSave} /></I18nProvider>)

    const button = await screen.findByRole('button', { name: 'Gợi ý' })
    await waitFor(() => expect(button).toBeEnabled())
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Gợi ý đang TẮT.')).toBeVisible()

    button.focus()
    fireEvent.keyDown(button, { key: 'Enter' })
    fireEvent.click(button)

    expect(screen.getByRole('button', { name: 'Gợi ý' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Gợi ý đang BẬT.')).toBeVisible()
    expect(onSave).not.toHaveBeenCalled()
  })
})
