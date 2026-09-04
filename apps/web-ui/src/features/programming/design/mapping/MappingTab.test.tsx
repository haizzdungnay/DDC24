import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n'
import type { UserRole } from '../../../../shared/types'
import type { ProgrammingDraftDocument, ProgrammingPointCatalogEntry } from '../../model/types'
import { MappingTab } from './MappingTab'

const auth = vi.hoisted(() => ({ role: 'admin' as UserRole }))
const catalog = vi.hoisted(() => ({
  status: 'ready' as 'loading' | 'ready' | 'error',
  items: [] as ProgrammingPointCatalogEntry[],
  error: null as string | null,
  lastSuccessAt: null as number | null,
}))

vi.mock('../../../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../auth')>()
  return { ...actual, useAuth: () => ({ session: { username: 'u', role: auth.role }, getAuthHeader: () => ({}) }) }
})

vi.mock('../../api/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/queries')>()
  return {
    ...actual,
    useProgrammingPointCatalog: () => ({ status: catalog.status, data: { items: catalog.items }, error: catalog.error, lastSuccessAt: catalog.lastSuccessAt, refresh: vi.fn() }),
  }
})

function documentFixture(): ProgrammingDraftDocument {
  return {
    schemaVersion: 1,
    project: { projectId: 'project-1', name: 'AHU', functionalTags: [] },
    programs: [{ programId: 'program-1', name: 'AHU_Main', kind: 'PROGRAM', language: 'ST', document: 'PROGRAM AHU_Main\nVAR_INPUT\n SupplyTemp : REAL;\nEND_VAR\nVAR_OUTPUT\n FanCmd : BOOL;\nEND_VAR\nEND_PROGRAM' }],
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
  catalog.lastSuccessAt = 100
  catalog.items = [
    /* ISS-PIO-32 — fixture mang `mapping` vì đó là thứ SERVER trả về. Không có
     * nó, FE fail-closed: đúng hành vi mong muốn với server đời cũ. */
    { category: 'LOCAL', pointId: 'UI-01', name: 'Supply Temp', dataType: 'REAL', unit: 'degC', direction: 'READ', writable: false, quality: 'GOOD', value: 21.4,
      mapping: { input: { status: 'SUPPORTED', reasons: [] }, output: { status: 'INCOMPATIBLE', reasons: ['UI là ngõ vào vật lý; chỉ AO/DO nhận được VAR_OUTPUT'] } } },
    { category: 'LOCAL', pointId: 'DO-01', name: 'Supply Fan', dataType: 'BOOL', direction: 'WRITE', writable: true, quality: 'BAD', value: null , mapping: { input: { status: 'SUPPORTED', reasons: [] }, output: { status: 'SUPPORTED', reasons: [] } } },
    { category: 'LOCAL', pointId: 'AO-01', name: 'Supply Valve', dataType: 'REAL', direction: 'WRITE', writable: true, quality: 'GOOD', value: 42.5 , mapping: { input: { status: 'SUPPORTED', reasons: [] }, output: { status: 'SUPPORTED', reasons: [] } } },
    { category: 'MB_RTU', deviceId: 'vfd-1', pointId: 'coil-1', name: 'VFD Enable', dataType: 'BOOL', direction: 'READ_WRITE', writable: true, quality: 'GOOD', value: true , mapping: { input: { status: 'UNSUPPORTED_BY_CORE', reasons: ['Catalog chưa phát extIndex cho điểm Modbus nên chưa dựng được binding (ISS-PIO-31); Core đã resolve MB_RTU'] }, output: { status: 'UNSUPPORTED_BY_CORE', reasons: ['Catalog chưa phát extIndex cho điểm Modbus nên chưa dựng được binding (ISS-PIO-31); Core đã resolve MB_RTU'] } } },
  ]
  localStorage.setItem('mkddc-lang', 'vi')
})
afterEach(cleanup)

describe('MappingTab Phase 1A — regression boundaries', () => {
  it('không gọi onSave và khóa toàn bộ Map/Remove với admin', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={onSave} /></I18nProvider>)

    const mutationButtons = screen.getAllByRole('button', { name: /^Ánh xạ / })
    expect(mutationButtons.length).toBeGreaterThan(0)
    expect(mutationButtons.every((button) => button.hasAttribute('disabled'))).toBe(true)
    expect(screen.queryByRole('button', { name: /Gỡ ánh xạ/ })).not.toBeInTheDocument()
    /* Phase 1A khoá Map/Remove, nhưng KHÔNG khoá Published Signal: đó là bề mặt
     * authoring riêng của `upsertSignal`/`removeSignal` (`UX-REQ-007`). Khẳng
     * định "không được mount" ở đây từng che một hồi quy thật. */
    expect(await screen.findByRole('heading', { name: /Published Signal/ })).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('giữ value zero/null và đủ quality thay vì bịa healthy zero', () => {
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)
    expect(screen.getAllByText('BAD').length).toBeGreaterThan(0)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.getAllByText('21.4').length).toBeGreaterThan(0)
  })

  it('giới hạn danh sách biến bằng vùng cuộn nội bộ để pane không kéo dài vô hạn', () => {
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)
    const list = screen.getByTestId('mapping-variable-list')
    expect(list).toHaveClass('flex-1', 'overflow-y-auto')
  })

  it('giới hạn Point pane ở khoảng 10 dòng và cho kéo xem phần còn lại', () => {
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)
    const list = screen.getByTestId('mapping-point-list')
    expect(list).toHaveClass('flex-1', 'overflow-y-auto')
  })

  /* Nhãn nói TRẠNG THÁI, lý do lấy NGUYÊN VĂN từ server (`ISS-PIO-32`). Câu cũ
   * "Core chưa hỗ trợ" đổ lỗi cho compiler trong khi Core đã resolve MB_RTU từ
   * trước baseline — người đọc đi tìm sai chỗ. */
  it('hiện MB_RTU chưa map được kèm đúng lý do của server', () => {
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'AHU_Main · FanCmd · Chưa map' }))
    expect(screen.getByText('Chưa map được')).toBeVisible()
    expect(screen.getByText('Chưa map được')).toHaveAttribute('title', 'Catalog chưa phát extIndex cho điểm Modbus nên chưa dựng được binding (ISS-PIO-31); Core đã resolve MB_RTU')
    expect(screen.queryByText('Core chưa hỗ trợ')).not.toBeInTheDocument()
  })

  /* ISS-PIO-09 — chip `AO` nay hiện là `UO` theo quyết định của chủ sở hữu, và
   * hàng Point hiện danh tính theo nguồn thay cho `category:deviceId:pointId`.
   * `AO` vẫn là giá trị trên dây; chỉ nhãn đổi. */
  it('lọc Point ngay trong pane theo loại UI/UO/DO/VP', () => {
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: /^UO$/ }))
    expect(screen.getByRole('button', { name: /AO-01 Supply Valve PHYSICAL · UO/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /Supply Temp/ })).not.toBeInTheDocument()
  })

  it('không có chip nào còn ghi AO — nhãn UO là lớp trình bày duy nhất người dùng thấy', () => {
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)
    expect(screen.queryByRole('button', { name: /^AO$/ })).not.toBeInTheDocument()
  })

  it('viewer chỉ inspect và không có control Map', () => {
    auth.role = 'viewer'
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)
    expect(screen.getByText('Viewer · read-only')).toBeVisible()
    expect(screen.getAllByRole('button', { name: /^Ánh xạ / }).every((button) => button.hasAttribute('disabled'))).toBe(true)
  })
})
