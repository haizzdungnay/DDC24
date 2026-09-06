import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n'
import { formatTechnicalDateTime } from '../../../../shared/dateTime'
import type { UserRole } from '../../../../shared/types'
import type { ProgrammingDraftDocument, ProgrammingPointCatalogEntry } from '../../model/types'
import { MappingTab } from './MappingTab'

const auth = vi.hoisted(() => ({ role: 'admin' as UserRole }))
const catalog = vi.hoisted(() => ({
  status: 'ready' as 'ready' | 'error' | 'loading',
  data: null as { items: ProgrammingPointCatalogEntry[]; nextCursor?: string | null } | null,
  error: null as string | null,
  lastSuccessAt: 1_777_000_000_000 as number | null,
  complete: undefined as boolean | undefined,
}))

vi.mock('../../../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../auth')>()
  return {
    ...actual,
    useAuth: () => ({
      session: { username: 'u', role: auth.role, loginAt: '2026-08-24T00:00:00Z' },
      getAuthHeader: () => ({}),
    }),
  }
})

vi.mock('../../api/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/queries')>()
  return {
    ...actual,
    useProgrammingPointCatalog: () => ({ ...catalog, refresh: vi.fn() }),
  }
})

function documentFixture(): ProgrammingDraftDocument {
  return {
    schemaVersion: 1,
    project: { projectId: 'project-1', name: 'AHU-01', functionalTags: [] },
    programs: [{
      programId: 'program-1', name: 'AHU_Main', kind: 'PROGRAM', language: 'ST',
      document: 'PROGRAM AHU_Main\nVAR_INPUT\n SupplyTemp : REAL;\nEND_VAR\nVAR_OUTPUT\n FanCmd : BOOL;\nEND_VAR\nEND_PROGRAM',
    }],
    variables: [{ variableId: 'var-supply', programId: 'program-1', name: 'SupplyTemp', type: 'REAL', class: 'INPUT', initialValue: null, retain: false }],
    bindings: [{ bindingId: 'binding-supply', variableId: 'var-supply', point: { category: 'LOCAL', pointId: 'UI-01' }, direction: 'READ', dataType: 'REAL', unit: 'degC', writable: false, qualityPolicy: 'REQUIRE_GOOD' }],
    task: { taskId: 'task-1', periodMs: 1000, programOrder: ['program-1'] },
    library: { profile: 'CORE_REVA', version: '1' },
  }
}

beforeEach(() => {
  auth.role = 'admin'
  catalog.status = 'ready'
  catalog.error = null
  catalog.lastSuccessAt = 1_777_000_000_000
  catalog.complete = undefined
  catalog.data = {
    items: [
      { category: 'LOCAL', pointId: 'UI-01', name: 'Supply air temperature', dataType: 'REAL', unit: 'degC', direction: 'READ', writable: false, quality: 'GOOD', value: 21.4, observedAt: '2026-08-24T09:00:00Z' },
      { category: 'LOCAL', pointId: 'DO-01', name: 'Supply fan', dataType: 'BOOL', direction: 'WRITE', writable: true, quality: 'GOOD', value: true, observedAt: '2026-08-24T09:00:00Z' , mapping: { input: { status: 'SUPPORTED', reasons: [] }, output: { status: 'SUPPORTED', reasons: [] } } },
      { category: 'MB_RTU', deviceId: 'vfd-1', pointId: 'coil-1', name: 'VFD enable', displayId: 'MB-014', deviceLabel: 'VFD-01', sourceDetail: 'CO 12 · FC05', dataType: 'BOOL', direction: 'READ_WRITE', writable: true, quality: 'GOOD', value: true , mapping: { input: { status: 'UNSUPPORTED_BY_CORE', reasons: ['Catalog chưa phát extIndex cho điểm Modbus nên chưa dựng được binding (ISS-PIO-31); Core đã resolve MB_RTU'] }, output: { status: 'UNSUPPORTED_BY_CORE', reasons: ['Catalog chưa phát extIndex cho điểm Modbus nên chưa dựng được binding (ISS-PIO-31); Core đã resolve MB_RTU'] } } },
    ],
  }
  localStorage.setItem('mkddc-lang', 'vi')
})

afterEach(cleanup)

describe('Mapping Workbench Phase 1A — read-only truth state', () => {
  it('dựng đúng ba vùng, hiển thị live data và khóa mutation cho admin', () => {
    const onSave = vi.fn().mockResolvedValue(true)
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={onSave} /></I18nProvider>)

    expect(screen.getByRole('heading', { name: 'Biến chương trình' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Điểm khả dụng' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Ánh xạ đã gán' })).toBeVisible()
    expect(screen.getAllByText('21.4').length).toBeGreaterThan(0)
    expect(screen.getAllByText('GOOD').length).toBeGreaterThan(0)

    const fanRow = screen.getByRole('button', { name: 'AHU_Main · FanCmd · Chưa map' })
    fireEvent.click(fanRow)
    const mapButton = screen.getByRole('button', { name: 'Ánh xạ AHU_Main · FanCmd' })
    expect(mapButton).toBeDisabled()
    expect(mapButton).toHaveAttribute('title', expect.stringMatching(/Phase 1A/))
    expect(onSave).not.toHaveBeenCalled()
  })

  /* ISS-PIO-09 (F-PIO-026, đề bài §29) — hàng Point phải nói được NGUỒN và
   * CHI TIẾT KỸ THUẬT. Trước bản vá, dòng dưới tên điểm là
   * `MB_RTU:vfd-1:coil-1`: không thanh ghi, không mã hàm, và `vfd-1` là danh
   * tính canonical chứ không phải tên thiết bị trong tủ. */
  it('hàng Point hiện định danh theo nguồn thay cho category:deviceId:pointId', () => {
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)
    const modbusRow = screen.getByRole('button', { name: /VFD enable.*MODBUS/ })

    expect(within(modbusRow).getByText('MB-014')).toBeVisible()
    expect(within(modbusRow).getByText('MODBUS · VFD-01')).toBeVisible()
    expect(within(modbusRow).getByText('CO 12 · FC05')).toBeVisible()
    expect(within(modbusRow).queryByText(/MB_RTU:vfd-1:coil-1/)).not.toBeInTheDocument()
  })

  it('điểm thiếu danh tính máy chủ dựng vẫn nhận diện được bằng pointId', () => {
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)
    // `UI-01` không có `displayId`/`sourceDetail` trong fixture: hàng vẫn phải
    // hiện `UI-01` và `PHYSICAL · UI`, không được để trống chỗ định danh.
    const localRow = screen.getByRole('button', { name: /Supply air temperature.*PHYSICAL · UI/ })
    expect(within(localRow).getByText('UI-01')).toBeVisible()
  })

  it('hiện category unsupported và owner thiếu authority mà không bịa', () => {
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'AHU_Main · FanCmd · Chưa map' }))

    const modbusRow = screen.getByRole('button', { name: /VFD enable.*MODBUS/ })
    expect(within(modbusRow).getByText('Chưa map được')).toBeVisible()
    expect(within(modbusRow).getByText('Chưa map được')).toHaveAttribute('title', 'Catalog chưa phát extIndex cho điểm Modbus nên chưa dựng được binding (ISS-PIO-31); Core đã resolve MB_RTU')
		expect(screen.getByText('Chưa xác minh — chưa chạy preview phía máy chủ')).toBeVisible()
  })

  it('giữ snapshot cũ để inspect nhưng cảnh báo persistent và khóa mọi mutation khi poll lỗi', () => {
    catalog.status = 'error'
    catalog.error = 'Không đọc được Point Catalog.'
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)

    expect(screen.getByRole('alert')).toHaveTextContent('Không đọc được Point Catalog.')
    expect(screen.getByRole('alert')).toHaveTextContent('Lần đọc đầy đủ gần nhất')
    expect(screen.getAllByText('21.4').length).toBeGreaterThan(0)
    expect(screen.getAllByText('STALE').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /^Ánh xạ / }).every((button) => button.hasAttribute('disabled'))).toBe(true)
  })

  it('lọc Variable/Point theo tìm kiếm và category mà không mất identity', () => {
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)

    fireEvent.change(screen.getByRole('searchbox', { name: 'Tìm biến hoặc Point' }), { target: { value: 'FanCmd' } })
    expect(screen.getByRole('button', { name: 'AHU_Main · FanCmd · Chưa map' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /SupplyTemp/ })).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Tìm biến hoặc Point' }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Loại Point' }), { target: { value: 'MB_RTU' } })
    expect(screen.getByRole('button', { name: /VFD enable.*MODBUS/ })).toBeVisible()
  })

  it('lọc Program và phân biệt hai biến cùng tên ở hai Program khác nhau', () => {
    const docWithDuplicateVars: ProgrammingDraftDocument = {
      ...documentFixture(),
      programs: [
        {
          programId: 'program-1',
          name: 'AHU_Main',
          kind: 'PROGRAM',
          language: 'ST',
          document: 'PROGRAM AHU_Main\nVAR_INPUT\n Setpoint : REAL;\nEND_VAR\nEND_PROGRAM',
        },
        {
          programId: 'program-2',
          name: 'FCU_Zone',
          kind: 'PROGRAM',
          language: 'ST',
          document: 'PROGRAM FCU_Zone\nVAR_INPUT\n Setpoint : REAL;\nEND_VAR\nEND_PROGRAM',
        },
      ],
      variables: [
        { variableId: 'var-ahu-sp', programId: 'program-1', name: 'Setpoint', type: 'REAL', class: 'INPUT', initialValue: null, retain: false },
        { variableId: 'var-fcu-sp', programId: 'program-2', name: 'Setpoint', type: 'REAL', class: 'INPUT', initialValue: null, retain: false },
      ],
      bindings: [],
    }

    render(<I18nProvider><MappingTab document={docWithDuplicateVars} saving={false} onSave={vi.fn()} /></I18nProvider>)

    // Mặc định là ALL (không lọc sẵn), cả 2 hàng Setpoint đều hiện ra và phân biệt được qua Program + aria-label
    const programSelect = screen.getByRole('combobox', { name: 'Chương trình' }) as HTMLSelectElement
    expect(programSelect.value).toBe('ALL')

    const ahuRow = screen.getByRole('button', { name: 'AHU_Main · Setpoint · Chưa map' })
    const fcuRow = screen.getByRole('button', { name: 'FCU_Zone · Setpoint · Chưa map' })
    expect(ahuRow).toBeVisible()
    expect(fcuRow).toBeVisible()
    expect(screen.getAllByText('AHU_Main').length).toBeGreaterThan(0)
    expect(screen.getAllByText('FCU_Zone').length).toBeGreaterThan(0)

    // Lọc theo Program AHU_Main
    fireEvent.change(programSelect, { target: { value: 'program-1' } })
    expect(screen.getByRole('button', { name: 'AHU_Main · Setpoint · Chưa map' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'FCU_Zone · Setpoint · Chưa map' })).not.toBeInTheDocument()

    // Lọc về ALL
    fireEvent.change(programSelect, { target: { value: 'ALL' } })
    expect(screen.getByRole('button', { name: 'AHU_Main · Setpoint · Chưa map' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'FCU_Zone · Setpoint · Chưa map' })).toBeVisible()
  })
})

/* `ISS-PIO-04` — khi server nói "còn nữa", bảng phải NÓI RA và khoá Map.
 *
 * FE vốn đã đúng: `complete = nextCursor ? false : true`, chip hiện `500+`, và
 * banner khoá Map/Remove. Thứ hỏng nằm ở SERVER — nó cắt danh sách ở 500 rồi
 * vẫn trả `nextCursor = null`, tức nói dối đúng cái trường mà FE tin. Test này
 * khoá nửa nhìn thấy được của hợp đồng, để lần sau ai đó "dọn" chip `+` hay
 * banner thì có người kêu.
 */
describe('ISS-PIO-04 — catalog chưa đủ thì bảng phải nói ra', () => {
  it('hiện dấu + và khoá Map khi server còn trang sau', () => {
    catalog.status = 'ready'
    catalog.error = null
    catalog.data = {
      items: [
        { category: 'LOCAL', pointId: 'UI-01', name: 'Supply Temp', dataType: 'REAL', unit: 'degC',
          direction: 'READ', writable: false, quality: 'GOOD', value: 21.4,
          mapping: { input: { status: 'SUPPORTED', reasons: [] }, output: { status: 'SUPPORTED', reasons: [] } } },
      ],
      nextCursor: 'cursor-trang-2',
    }

    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)

    expect(screen.getByText('Catalog 1+ · đang tải/chưa đủ')).toBeVisible()
    expect(screen.getByText(/Catalog Point chưa tải đủ/)).toBeVisible()
  })

  it('không hiện dấu + khi server khẳng định đã đủ', () => {
    catalog.status = 'ready'
    catalog.error = null
    catalog.data = {
      items: [
        { category: 'LOCAL', pointId: 'UI-01', name: 'Supply Temp', dataType: 'REAL', unit: 'degC',
          direction: 'READ', writable: false, quality: 'GOOD', value: 21.4,
          mapping: { input: { status: 'SUPPORTED', reasons: [] }, output: { status: 'SUPPORTED', reasons: [] } } },
      ],
      nextCursor: null,
    }

    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)

    expect(screen.getByText('Catalog 1 · đã đủ')).toBeVisible()
    expect(screen.queryByText(/Catalog Point chưa tải đủ/)).not.toBeInTheDocument()
  })
})

describe('ISS-PGM03-08 — Point ở trang sau vẫn giữ đúng Binding', () => {
  it('không báo POINT_UNAVAILABLE giữa các trang; sau trang cuối tìm và chọn được Point thứ 501', () => {
    const document = documentFixture()
    document.bindings = [{
      ...document.bindings[0],
      point: { category: 'VP', pointId: 'VP501' },
    }]
    catalog.status = 'loading'
    catalog.complete = false
    catalog.lastSuccessAt = null
    catalog.data = {
      items: [
        { category: 'VP', pointId: 'VP001', name: 'Point trang đầu', dataType: 'REAL', unit: 'degC',
          direction: 'READ_WRITE', writable: true, quality: 'GOOD', value: 20,
          mapping: { input: { status: 'SUPPORTED', reasons: [] }, output: { status: 'SUPPORTED', reasons: [] } } },
      ],
      nextCursor: 'cursor-500',
    }

    const view = render(<I18nProvider><MappingTab document={document} saving={false} onSave={vi.fn()} /></I18nProvider>)

    expect(screen.queryByText('Point không còn')).not.toBeInTheDocument()
    expect(screen.getByText('PAGING_INCOMPLETE')).toBeVisible()
    expect(screen.getByText('Catalog 1+ · đang tải/chưa đủ')).toBeVisible()
    expect(screen.getAllByRole('button', { name: /^Ánh xạ / }).every((button) => button.hasAttribute('disabled'))).toBe(true)

    catalog.status = 'ready'
    catalog.complete = true
    catalog.lastSuccessAt = 1_777_000_000_001
    catalog.data = {
      items: [
        ...(catalog.data?.items ?? []),
        { category: 'VP', pointId: 'VP501', name: 'Point thứ 501', dataType: 'REAL', unit: 'degC',
          direction: 'READ_WRITE', writable: true, quality: 'GOOD', value: 25,
          mapping: { input: { status: 'SUPPORTED', reasons: [] }, output: { status: 'SUPPORTED', reasons: [] } } },
      ],
      nextCursor: null,
    }
    view.rerender(<I18nProvider><MappingTab document={document} saving={false} onSave={vi.fn()} /></I18nProvider>)

    fireEvent.change(screen.getByRole('searchbox', { name: 'Tìm biến hoặc Point' }), { target: { value: 'Point thứ 501' } })
    const latePoint = screen.getByRole('button', { name: /VP501 Point thứ 501/ })
    fireEvent.click(latePoint)
    expect(latePoint).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Point không còn')).not.toBeInTheDocument()
    expect(screen.getByText('Catalog 2 · đã đủ')).toBeVisible()
  })
})


/**
 * `ISS-PGUI-02` — Points & Mapping không được trộn EN/VI (`PM-006`).
 *
 * Bốn bề mặt của Workbench từng viết cứng toàn bộ nhãn bằng tiếng Việt và
 * `toLocaleString('vi-VN')`, nên `mkddc-lang=en` vẫn hiện "Điểm khả dụng",
 * "Tất cả", "Chỉ đọc", "Ghi được", "Ánh xạ đã gán", "đang inspect".
 */
describe('ISS-PGUI-02 — Mapping Workbench theo đúng ngôn ngữ đang chọn', () => {
  const VI_DIACRITICS = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i

  /** Chuỗi CỦA MÁY CHỦ (`ISS-PIO-32`) hiển thị nguyên văn — không phải lỗi i18n. */
  const SERVER_REASON = 'Catalog chưa phát extIndex cho điểm Modbus nên chưa dựng được binding (ISS-PIO-31); Core đã resolve MB_RTU'

  function renderEn() {
    localStorage.setItem('mkddc-lang', 'en')
    return render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)
  }

  it('mọi tiêu đề và nhãn bộ lọc chuyển sang tiếng Anh', () => {
    renderEn()
    expect(screen.getByRole('heading', { name: 'Program Variables' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Available Points' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Assigned Mappings' })).toBeVisible()
    expect(screen.getAllByRole('button', { name: 'All' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Writable').length).toBeGreaterThan(0)
    // Fixture có một điểm chưa map được (`SERVER_DECISION_MISSING`): chip của
    // nó phải nói TRẠNG THÁI bằng tiếng Anh, không phải "Chưa map được".
    expect(screen.getAllByText('Cannot be mapped').length).toBeGreaterThan(0)
  })

  /* Định danh kỹ thuật KHÔNG được dịch: người dùng tra đúng những chuỗi này
     trong tài liệu, trong cấu hình và trong API. */
  it('định danh kỹ thuật giữ nguyên ở cả hai ngôn ngữ', () => {
    renderEn()
    for (const identifier of ['MB-014', 'MODBUS · VFD-01', 'CO 12 · FC05', 'GOOD', 'REAL', 'BOOL']) {
      expect(screen.getAllByText(identifier).length).toBeGreaterThan(0)
    }
  })

  it('không còn chữ tiếng Việt nào ngoài chuỗi nguyên văn của máy chủ', () => {
    const { container } = renderEn()
    const remaining = (container.textContent ?? '').split(SERVER_REASON).join('')
    expect(remaining).not.toMatch(VI_DIACRITICS)
  })

  /* `ISS-PGUI-02` — mốc đọc phải theo `locale` của `useI18n`, không phải hằng
     `'vi-VN'`. Định dạng ngày của hai locale khác nhau hoàn toàn
     (`24/8/2026` ≠ `8/24/2026`), nên một phép quét dấu tiếng Việt KHÔNG bắt
     được lỗi này — phải khẳng định thẳng vào chuỗi. */
  it('mốc đọc định dạng theo locale đang chọn', () => {
    renderEn()
    const en = formatTechnicalDateTime('2026-08-24T09:00:00Z', 'en-US')
    expect(screen.getAllByText(en).length).toBeGreaterThan(0)
    expect(screen.queryByText(formatTechnicalDateTime('2026-08-24T09:00:00Z', 'vi-VN'))).not.toBeInTheDocument()
  })

  /* Lý do do CHÍNH FE kết luận phải đi qua bảng mã. Đổi nó thành một chuỗi
     tiếng Việt cứng (dù núp dưới nhánh `server`) sẽ hiện ra ở đây. */
  it('lý do không tương thích nói tiếng Anh; câu của máy chủ giữ nguyên văn', () => {
    localStorage.setItem('mkddc-lang', 'en')
    const document = documentFixture()
    // Biến REAL gắn vào một Point BOOL ⇒ `TYPE_MISMATCH` do FE kết luận.
    document.bindings = [{
      bindingId: 'binding-mismatch', variableId: 'var-supply',
      point: { category: 'LOCAL', pointId: 'DO-01' },
      direction: 'READ', dataType: 'REAL', writable: false, qualityPolicy: 'REQUIRE_GOOD',
    }]
    const { container } = render(<I18nProvider><MappingTab document={document} saving={false} onSave={vi.fn()} /></I18nProvider>)

    expect(screen.getAllByText(/Data type does not match/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Kiểu dữ liệu không khớp/)).not.toBeInTheDocument()
    /* Câu của máy chủ (`ISS-PIO-32`) vẫn nguyên văn, kể cả khi là tiếng Việt.
       Nó nằm trong `title`/`aria-label` của chip "chưa map được", nên đọc qua
       `innerHTML` chứ không qua text node. */
    expect(container.innerHTML).toContain(SERVER_REASON.slice(0, 30))
  })

  it('cùng fixture ở tiếng Việt vẫn ra tiếng Việt', () => {
    localStorage.setItem('mkddc-lang', 'vi')
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)
    expect(screen.getByRole('heading', { name: 'Điểm khả dụng' })).toBeVisible()
    expect(screen.getAllByText('Ghi được').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Chưa map được').length).toBeGreaterThan(0)
  })
})
