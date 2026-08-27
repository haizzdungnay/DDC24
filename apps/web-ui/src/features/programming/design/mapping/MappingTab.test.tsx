import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n'
import type { UserRole } from '../../../../shared/types'
import { MappingTab } from './MappingTab'
import type { ProgrammingDraftDocument, ProgrammingPointCatalogEntry } from '../../model/types'

const auth = vi.hoisted(() => ({ role: 'admin' as UserRole }))
vi.mock('../../../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../auth')>()
  return {
    ...actual,
    useAuth: () => ({
      session: { username: 'u', role: auth.role, loginAt: '2026-08-13T00:00:00Z' },
      login: vi.fn(),
      logout: vi.fn(),
      isAuthenticated: true,
      getAuthHeader: () => ({})
    })
  }
})

const catalogItems = vi.hoisted(() => [] as ProgrammingPointCatalogEntry[])
vi.mock('../../api/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/queries')>()
  return {
    ...actual,
    useProgrammingPointCatalog: () => ({ status: 'ready', data: { items: catalogItems }, error: null, refresh: vi.fn() })
  }
})

function baseDocument(): ProgrammingDraftDocument {
  return {
    schemaVersion: 1,
    project: { projectId: 'project-1', name: 'AHU-01', functionalTags: [] },
    programs: [],
    variables: [],
    bindings: [],
    task: { taskId: 'task-1', periodMs: 1000, programOrder: [] },
    library: { profile: 'CORE_REVA', version: '1' }
  }
}

const point: ProgrammingPointCatalogEntry = {
  category: 'VP', pointId: 'p1', deviceId: undefined, name: 'VP p1', dataType: 'REAL', direction: 'READ', writable: false, quality: 'GOOD', value: 0
}

beforeEach(() => {
  auth.role = 'admin'
  catalogItems.length = 0
  catalogItems.push(point)
  localStorage.setItem('mkddc-lang', 'vi')
})
afterEach(cleanup)

describe('MappingTab — chọn biến từ VAR_INPUT/VAR_OUTPUT, không gõ tay (user report 2026-08-14)', () => {
  it('mời chọn đúng các biến khai báo trong ST, không phải ô nhập tự do', async () => {
    const document = baseDocument()
    document.programs.push({
      programId: 'program-1', name: 'AHU_FanControl', kind: 'PROGRAM', language: 'ST',
      document: 'PROGRAM AHU_FanControl\nVAR_INPUT\n  SupplyTemp : REAL;\nEND_VAR\nVAR_OUTPUT\n  FanEnable : BOOL;\nEND_VAR\nEND_PROGRAM'
    })
    const onSave = vi.fn().mockResolvedValue(true)

    render(<I18nProvider><MappingTab draft={document} document={document} saving={false} onSave={onSave} /></I18nProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'Thêm ánh xạ' }))
    const dialog = screen.getByRole('dialog', { name: 'Thêm ánh xạ Biến ↔ Điểm' })

    expect(within(dialog).queryByRole('textbox', { name: /Tên biến/ })).not.toBeInTheDocument()
    const variableSelect = within(dialog).getByRole('combobox', { name: 'Biến' })
    const options = within(variableSelect).getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['SupplyTemp (vào · REAL)', 'FanEnable (ra · BOOL)'])

    fireEvent.click(within(dialog).getByText(/VP:p1/))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ánh xạ' }))

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const operations = onSave.mock.calls[0][0]
    expect(operations[0]).toMatchObject({ op: 'upsertVariable', variable: { programId: 'program-1', name: 'SupplyTemp', type: 'REAL', class: 'INPUT' } })
    expect(operations[1]).toMatchObject({ op: 'upsertBinding', binding: { point: { category: 'VP', pointId: 'p1' } } })
  })

  it('lọc bỏ Point không tương thích hướng/kiểu — tái hiện đúng lỗi thật AlarmHigh (BOOL, OUTPUT) bị chọn nhầm UI-09 (REAL, READ)', async () => {
    catalogItems.length = 0
    catalogItems.push(
      { category: 'LOCAL', pointId: 'UI-09', deviceId: undefined, name: 'UI-09', dataType: 'REAL', direction: 'READ', writable: false, quality: 'BAD', value: 0 },
      { category: 'VP', pointId: 'vp-alarm', deviceId: undefined, name: 'vp-alarm', dataType: 'BOOL', direction: 'READ_WRITE', writable: true, quality: 'GOOD', value: false }
    )
    const document = baseDocument()
    document.programs.push({
      programId: 'program-1', name: 'AHU_FanControl', kind: 'PROGRAM', language: 'ST',
      document: 'PROGRAM AHU_FanControl\nVAR_OUTPUT\n  AlarmHigh : BOOL;\nEND_VAR\nEND_PROGRAM'
    })
    const onSave = vi.fn().mockResolvedValue(true)

    render(<I18nProvider><MappingTab draft={document} document={document} saving={false} onSave={onSave} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ánh xạ' }))
    const dialog = screen.getByRole('dialog', { name: 'Thêm ánh xạ Biến ↔ Điểm' })

    // UI-09 (REAL, READ) không được hiện — không thể ghi BOOL output vào đó.
    expect(within(dialog).queryByText(/UI-09/)).not.toBeInTheDocument()
    expect(within(dialog).getByText(/vp-alarm/)).toBeInTheDocument()

    fireEvent.click(within(dialog).getByText(/vp-alarm/))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ánh xạ' }))

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const operations = onSave.mock.calls[0][0]
    expect(operations[1]).toMatchObject({ op: 'upsertBinding', binding: { point: { category: 'VP', pointId: 'vp-alarm' } } })
  })

  it('hết Point tương thích thì báo rõ lý do (kiểu/hướng), không chỉ "không khớp bộ lọc"', async () => {
    catalogItems.length = 0
    catalogItems.push({ category: 'LOCAL', pointId: 'UI-09', deviceId: undefined, name: 'UI-09', dataType: 'REAL', direction: 'READ', writable: false, quality: 'BAD', value: 0 })
    const document = baseDocument()
    document.programs.push({
      programId: 'program-1', name: 'AHU_FanControl', kind: 'PROGRAM', language: 'ST',
      document: 'PROGRAM AHU_FanControl\nVAR_OUTPUT\n  AlarmHigh : BOOL;\nEND_VAR\nEND_PROGRAM'
    })

    render(<I18nProvider><MappingTab draft={document} document={document} saving={false} onSave={vi.fn()} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ánh xạ' }))
    const dialog = screen.getByRole('dialog', { name: 'Thêm ánh xạ Biến ↔ Điểm' })

    expect(within(dialog).getByText(/Không có Point kiểu BOOL, hướng ghi được/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Ánh xạ' })).toBeDisabled()
  })

  it('WP-08: đọc đúng biến INPUT/OUTPUT từ Program FBD tạo qua palette (WP-05/06), qua đúng JSON.stringify round-trip thật', async () => {
    // Tài liệu này KHÔNG viết tay tự do — có cùng shape hệt như
    // buildInterfaceNode() trong StructuredFbdEditor.tsx sinh ra khi user bấm
    // "Input"/"Output" ở palette (kind INPUT có port OUTPUT tên "OUT", kind
    // OUTPUT có port INPUT tên "IN", variable ở parameters.variable) — xác
    // nhận integration point collectFbdInterfaceVariables() vẫn đọc đúng dữ
    // liệu do palette mới sinh ra, không chỉ đúng với golden JSON cũ.
    const fbdDocument = {
      $schema: '../../fbd_v1.schema.json', schemaVersion: 1, profileId: 'revA-1t-1-5-30',
      graphId: '30000000-0000-4000-8000-000000000001', name: 'AHU_FAN_ENABLE_WP08',
      networks: [{
        id: '30000000-0000-4000-8000-000000000002', name: 'NETWORK_1', order: 0,
        nodes: [
          {
            id: '30000000-0000-4000-8000-000000000003', kind: 'INPUT', typeRef: 'REAL', executionOrder: 0,
            parameters: { variable: 'SETPOINT' },
            ports: [{ id: '30000000-0000-4000-8000-000000000004', name: 'OUT', direction: 'OUTPUT', dataType: 'REAL', unit: 'degC', order: 0 }],
          },
          {
            id: '30000000-0000-4000-8000-000000000005', kind: 'OUTPUT', typeRef: 'BOOL', executionOrder: 1,
            parameters: { variable: 'FAN_CMD' },
            ports: [{ id: '30000000-0000-4000-8000-000000000006', name: 'IN', direction: 'INPUT', dataType: 'BOOL', unit: null, order: 0 }],
          },
        ],
        wires: [],
      }],
    }
    catalogItems.length = 0
    catalogItems.push({ category: 'VP', pointId: 'setpoint-src', deviceId: undefined, name: 'setpoint-src', dataType: 'REAL', direction: 'READ', writable: false, quality: 'GOOD', value: 21 })
    const document = baseDocument()
    document.programs.push({ programId: 'program-fbd-1', name: 'AHU_FBD', kind: 'PROGRAM', language: 'FBD', document: JSON.stringify(fbdDocument) })
    const onSave = vi.fn().mockResolvedValue(true)

    render(<I18nProvider><MappingTab draft={document} document={document} saving={false} onSave={onSave} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ánh xạ' }))
    const dialog = screen.getByRole('dialog', { name: 'Thêm ánh xạ Biến ↔ Điểm' })

    const variableSelect = within(dialog).getByRole('combobox', { name: 'Biến' })
    const options = within(variableSelect).getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['SETPOINT (vào · REAL)', 'FAN_CMD (ra · BOOL)'])

    fireEvent.click(within(dialog).getByText(/VP:setpoint-src/))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ánh xạ' }))

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const operations = onSave.mock.calls[0][0]
    expect(operations[0]).toMatchObject({ op: 'upsertVariable', variable: { programId: 'program-fbd-1', name: 'SETPOINT', type: 'REAL', class: 'INPUT' } })
    expect(operations[1]).toMatchObject({ op: 'upsertBinding', binding: { point: { category: 'VP', pointId: 'setpoint-src' } } })
  })

  it('ẩn biến đã ánh xạ rồi, hiện thông báo khi hết biến khả dụng', async () => {
    const document = baseDocument()
    document.programs.push({
      programId: 'program-1', name: 'P1', kind: 'PROGRAM', language: 'ST',
      document: 'PROGRAM P1\nVAR_OUTPUT\n  FanEnable : BOOL;\nEND_VAR\nEND_PROGRAM'
    })
    document.variables.push({ variableId: 'v1', programId: 'program-1', name: 'FanEnable', type: 'BOOL', class: 'OUTPUT', initialValue: null, retain: false })

    render(<I18nProvider><MappingTab draft={document} document={document} saving={false} onSave={vi.fn()} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ánh xạ' }))
    const dialog = screen.getByRole('dialog', { name: 'Thêm ánh xạ Biến ↔ Điểm' })

    expect(within(dialog).getByRole('combobox', { name: 'Biến' })).toBeDisabled()
    expect(within(dialog).getByText(/chưa được ánh xạ/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Ánh xạ' })).toBeDisabled()
  })
})

describe('bộ chọn Point — ẩn ứng viên thì phải NÓI RA (user report 2026-08-28)', () => {
  /* Người dùng thật hỏi "trang map đang thiếu VP à?" khi 5/7 VP biến mất khỏi
     danh sách. Bộ lọc tương thích ĐÚNG — biến BOOL không ghép được Point REAL —
     nhưng nó ẩn im lặng, và một danh sách còn vài mục trông y hệt một danh sách
     đầy đủ. Ca này nguy hiểm hơn danh sách rỗng, vốn đã có thông báo riêng. */
  function documentWithBoolInput(): ProgrammingDraftDocument {
    const document = baseDocument()
    document.programs.push({
      programId: 'program-1', name: 'AHU_MasterSequence', kind: 'PROGRAM', language: 'ST',
      document: 'PROGRAM AHU_MasterSequence\nVAR_INPUT\n  Occupied : BOOL;\nEND_VAR\nEND_PROGRAM'
    })
    return document
  }

  function vp(pointId: string, dataType: string, direction: ProgrammingPointCatalogEntry['direction']): ProgrammingPointCatalogEntry {
    return { category: 'VP', pointId, deviceId: undefined, name: `VP ${pointId}`, dataType, direction, writable: direction !== 'READ', quality: 'GOOD', value: 0 }
  }

  it('còn ứng viên nhưng có mục bị ẩn ⇒ nêu SỐ và LÝ DO', () => {
    catalogItems.length = 0
    catalogItems.push(vp('VP1', 'BOOL', 'READ'), vp('VP6', 'BOOL', 'READ'))
    catalogItems.push(vp('VP2', 'REAL', 'READ'), vp('VP3', 'REAL', 'READ'), vp('VP5', 'INT', 'READ'))

    render(<I18nProvider><MappingTab draft={documentWithBoolInput()} document={documentWithBoolInput()} saving={false} onSave={vi.fn()} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ánh xạ' }))

    // Hai VP kiểu BOOL vẫn hiện — bộ lọc tương thích là ĐÚNG, không đụng vào.
    expect(screen.getByText('VP:VP1')).toBeInTheDocument()
    expect(screen.getByText('VP:VP6')).toBeInTheDocument()
    expect(screen.queryByText('VP:VP2')).toBeNull()

    const note = screen.getByTestId('point-picker-hidden-note')
    expect(note).toHaveTextContent('Đã ẩn 3 Point')
    expect(note).toHaveTextContent('khác kiểu BOOL')
  })

  it('sai HƯỚNG được kể riêng khỏi sai KIỂU', () => {
    catalogItems.length = 0
    // Cùng kiểu BOOL nhưng chỉ ghi được ⇒ biến INPUT không đọc được từ nó.
    catalogItems.push(vp('VP1', 'BOOL', 'READ'), vp('VP9', 'BOOL', 'WRITE'))

    render(<I18nProvider><MappingTab draft={documentWithBoolInput()} document={documentWithBoolInput()} saving={false} onSave={vi.fn()} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ánh xạ' }))

    const note = screen.getByTestId('point-picker-hidden-note')
    expect(note).toHaveTextContent('sai hướng')
    expect(note).toHaveTextContent('INPUT cần Point đọc được')
  })

  it('không ẩn gì thì KHÔNG hiện ghi chú', () => {
    catalogItems.length = 0
    catalogItems.push(vp('VP1', 'BOOL', 'READ'))

    render(<I18nProvider><MappingTab draft={documentWithBoolInput()} document={documentWithBoolInput()} saving={false} onSave={vi.fn()} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ánh xạ' }))

    expect(screen.queryByTestId('point-picker-hidden-note')).toBeNull()
  })
})
