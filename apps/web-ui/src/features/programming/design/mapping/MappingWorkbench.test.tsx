import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n'
import type { UserRole } from '../../../../shared/types'
import type { ProgrammingDraftDocument, ProgrammingPointCatalogEntry } from '../../model/types'
import { MappingTab } from './MappingTab'

const auth = vi.hoisted(() => ({ role: 'admin' as UserRole }))
const catalog = vi.hoisted(() => ({
  status: 'ready' as 'ready' | 'error' | 'loading',
  data: null as { items: ProgrammingPointCatalogEntry[]; nextCursor?: string | null } | null,
  error: null as string | null,
  lastSuccessAt: 1_777_000_000_000 as number | null,
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
  catalog.data = {
    items: [
      { category: 'LOCAL', pointId: 'UI-01', name: 'Supply air temperature', dataType: 'REAL', unit: 'degC', direction: 'READ', writable: false, quality: 'GOOD', value: 21.4, observedAt: '2026-08-24T09:00:00Z' },
      { category: 'LOCAL', pointId: 'DO-01', name: 'Supply fan', dataType: 'BOOL', direction: 'WRITE', writable: true, quality: 'GOOD', value: true, observedAt: '2026-08-24T09:00:00Z' , mapping: { input: { status: 'SUPPORTED', reasons: [] }, output: { status: 'SUPPORTED', reasons: [] } } },
      { category: 'MB_RTU', deviceId: 'vfd-1', pointId: 'coil-1', name: 'VFD enable', dataType: 'BOOL', direction: 'READ_WRITE', writable: true, quality: 'GOOD', value: true , mapping: { input: { status: 'UNSUPPORTED_BY_CORE', reasons: ['Catalog chưa phát extIndex cho điểm Modbus nên chưa dựng được binding (ISS-PIO-31); Core đã resolve MB_RTU'] }, output: { status: 'UNSUPPORTED_BY_CORE', reasons: ['Catalog chưa phát extIndex cho điểm Modbus nên chưa dựng được binding (ISS-PIO-31); Core đã resolve MB_RTU'] } } },
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

  it('hiện category unsupported và owner thiếu authority mà không bịa', () => {
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'AHU_Main · FanCmd · Chưa map' }))

    const modbusRow = screen.getByRole('button', { name: /MB_RTU.*VFD enable/ })
    expect(within(modbusRow).getByText('Chưa map được')).toBeVisible()
    expect(within(modbusRow).getByText('Chưa map được')).toHaveAttribute('title', 'Catalog chưa phát extIndex cho điểm Modbus nên chưa dựng được binding (ISS-PIO-31); Core đã resolve MB_RTU')
    expect(screen.getByText('Chưa xác minh — API chưa cung cấp authority')).toBeVisible()
  })

  it('giữ snapshot cũ để inspect nhưng cảnh báo persistent và khóa mọi mutation khi poll lỗi', () => {
    catalog.status = 'error'
    catalog.error = 'Không đọc được Point Catalog.'
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)

    expect(screen.getByRole('alert')).toHaveTextContent('Không đọc được Point Catalog.')
    expect(screen.getByRole('alert')).toHaveTextContent('Lần đọc thành công gần nhất')
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
    expect(screen.getByRole('button', { name: /MB_RTU.*VFD enable/ })).toBeVisible()
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

    expect(screen.getByText('Catalog 1+')).toBeVisible()
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

    expect(screen.getByText('Catalog 1')).toBeVisible()
    expect(screen.queryByText(/Catalog Point chưa tải đủ/)).not.toBeInTheDocument()
  })
})
