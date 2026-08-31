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
    { category: 'LOCAL', pointId: 'UI-01', name: 'Supply Temp', dataType: 'REAL', unit: 'degC', direction: 'READ', writable: false, quality: 'GOOD', value: 21.4 },
    { category: 'LOCAL', pointId: 'DO-01', name: 'Supply Fan', dataType: 'BOOL', direction: 'WRITE', writable: true, quality: 'BAD', value: null },
    { category: 'LOCAL', pointId: 'AO-01', name: 'Supply Valve', dataType: 'REAL', direction: 'WRITE', writable: true, quality: 'GOOD', value: 42.5 },
    { category: 'MB_RTU', deviceId: 'vfd-1', pointId: 'coil-1', name: 'VFD Enable', dataType: 'BOOL', direction: 'READ_WRITE', writable: true, quality: 'GOOD', value: true },
  ]
  localStorage.setItem('mkddc-lang', 'vi')
})
afterEach(cleanup)

describe('MappingTab Phase 1A — regression boundaries', () => {
  it('không gọi onSave và khóa toàn bộ Map/Remove với admin', () => {
    const onSave = vi.fn().mockResolvedValue(true)
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={onSave} /></I18nProvider>)

    const mutationButtons = screen.getAllByRole('button', { name: /^Ánh xạ / })
    expect(mutationButtons.length).toBeGreaterThan(0)
    expect(mutationButtons.every((button) => button.hasAttribute('disabled'))).toBe(true)
    expect(screen.queryByRole('button', { name: /Gỡ ánh xạ/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Published Signal')).not.toBeInTheDocument()
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

  it('hiện MB_RTU read-only là Core chưa hỗ trợ', () => {
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'AHU_Main · FanCmd · Chưa map' }))
    expect(screen.getByText('Core chưa hỗ trợ')).toBeVisible()
  })

  it('lọc Point ngay trong pane theo loại UI/AO/DO/VP', () => {
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: /^AO$/ }))
    expect(screen.getByRole('button', { name: 'LOCAL Supply Valve' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'LOCAL Supply Temp' })).not.toBeInTheDocument()
  })

  it('viewer chỉ inspect và không có control Map', () => {
    auth.role = 'viewer'
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)
    expect(screen.getByText('Viewer · read-only')).toBeVisible()
    expect(screen.getAllByRole('button', { name: /^Ánh xạ / }).every((button) => button.hasAttribute('disabled'))).toBe(true)
  })
})
