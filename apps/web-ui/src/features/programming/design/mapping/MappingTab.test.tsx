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

    render(<I18nProvider><MappingTab document={document} saving={false} onSave={onSave} /></I18nProvider>)

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

  it('ẩn biến đã ánh xạ rồi, hiện thông báo khi hết biến khả dụng', async () => {
    const document = baseDocument()
    document.programs.push({
      programId: 'program-1', name: 'P1', kind: 'PROGRAM', language: 'ST',
      document: 'PROGRAM P1\nVAR_OUTPUT\n  FanEnable : BOOL;\nEND_VAR\nEND_PROGRAM'
    })
    document.variables.push({ variableId: 'v1', programId: 'program-1', name: 'FanEnable', type: 'BOOL', class: 'OUTPUT', initialValue: null, retain: false })

    render(<I18nProvider><MappingTab document={document} saving={false} onSave={vi.fn()} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ánh xạ' }))
    const dialog = screen.getByRole('dialog', { name: 'Thêm ánh xạ Biến ↔ Điểm' })

    expect(within(dialog).getByRole('combobox', { name: 'Biến' })).toBeDisabled()
    expect(within(dialog).getByText(/chưa được ánh xạ/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Ánh xạ' })).toBeDisabled()
  })
})
