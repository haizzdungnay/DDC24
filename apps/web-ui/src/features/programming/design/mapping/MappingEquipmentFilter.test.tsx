import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n'
import type { UserRole } from '../../../../shared/types'
import type { ProgrammingDraftDocument, ProgrammingPointCatalogEntry } from '../../model/types'
import { MappingTab } from './MappingTab'
import { equipmentOptions, matchesEquipment, UNASSIGNED_EQUIPMENT, type MappingPointRow } from './mappingViewModel'

/* `ISS-PIO-07`/`F-PIO-006`: `ADR-042` đã dựng khái niệm thiết bị công nghệ cho
 * trang Giám sát, nhưng tab Ánh xạ **không lọc theo AHU-01 được** — mất mát cụ
 * thể nhất mà finding nêu. */

const auth = vi.hoisted(() => ({ role: 'admin' as UserRole }))
const catalog = vi.hoisted(() => ({
  status: 'ready' as 'ready' | 'error' | 'loading',
  data: null as { items: ProgrammingPointCatalogEntry[]; nextCursor?: string | null } | null,
  error: null as string | null,
  lastSuccessAt: 1_777_000_000_000 as number | null
}))

vi.mock('../../../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../auth')>()
  return {
    ...actual,
    useAuth: () => ({ session: { username: 'u', role: auth.role, loginAt: '2026-08-24T00:00:00Z' }, getAuthHeader: () => ({}) })
  }
})
vi.mock('../../api/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/queries')>()
  return { ...actual, useProgrammingPointCatalog: () => ({ ...catalog, refresh: vi.fn() }) }
})
vi.mock('../../../../shared/api/capabilities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../shared/api/capabilities')>()
  return { ...actual, fetchSystemCapabilities: vi.fn(async () => { throw new Error('không cần cho test này') }) }
})

function documentFixture(): ProgrammingDraftDocument {
  return {
    schemaVersion: 1,
    project: { projectId: 'project-1', name: 'AHU-01', functionalTags: [] },
    programs: [{ programId: 'program-1', name: 'AHU_Main', kind: 'PROGRAM', language: 'ST', document: 'PROGRAM AHU_Main\nEND_PROGRAM' }],
    variables: [],
    bindings: [],
    task: { taskId: 'task-1', periodMs: 1000, programOrder: ['program-1'] },
    library: { profile: 'CORE_REVA', version: '1' }
  }
}

beforeEach(() => {
  auth.role = 'admin'
  catalog.status = 'ready'
  catalog.error = null
  catalog.lastSuccessAt = 1_777_000_000_000
  catalog.data = {
    items: [
      { category: 'LOCAL', pointId: 'UI-01', name: 'Supply air temperature', dataType: 'REAL', direction: 'READ', writable: false, quality: 'GOOD', value: 21.4, equipment: 'AHU-01' },
      { category: 'LOCAL', pointId: 'UI-02', name: 'Return air temperature', dataType: 'REAL', direction: 'READ', writable: false, quality: 'GOOD', value: 23.1, equipment: 'AHU-02' },
      { category: 'LOCAL', pointId: 'UI-03', name: 'Spare channel', dataType: 'REAL', direction: 'READ', writable: false, quality: 'GOOD', value: 0 }
    ]
  }
  localStorage.setItem('mkddc-lang', 'vi')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function row(equipment?: string): MappingPointRow {
  return {
    key: `k-${equipment ?? 'none'}`, category: 'LOCAL', pointId: 'UI-01', name: 'x', dataType: 'REAL',
    direction: 'READ', writable: false, value: null, quality: 'GOOD', eligibility: 'SUPPORTED',
    compatible: true, compatibilityReasons: [], equipment
  }
}

/* `ISS-PGM03-05` — bộ lọc Thiết bị nay nằm trong drawer "Bộ lọc nâng cao"
 * (đóng mặc định) để hàng toolbar chính không xuống dòng ở 1280×800. Mở drawer
 * trước là đúng số thao tác người dùng thật phải làm. */
function openAdvancedFilters() {
  fireEvent.click(screen.getByRole('button', { name: /^Bộ lọc nâng cao/ }))
}

describe('bộ lọc thiết bị ở tab Ánh xạ (ISS-PIO-07)', () => {
  // "Chưa gán" là một nhóm CÓ THẬT mà người dùng cần lọc tới, khác hẳn "không
  // lọc" — nên nó là một lựa chọn riêng, không phải chuỗi rỗng.
  it('liệt kê thiết bị đã sắp xếp và thêm nhóm "chưa gán" khi có điểm chưa gán', () => {
    expect(equipmentOptions([row('AHU-02'), row('AHU-01'), row()])).toEqual(['AHU-01', 'AHU-02', UNASSIGNED_EQUIPMENT])
  })

  it('không thêm nhóm "chưa gán" khi mọi điểm đều đã gán', () => {
    expect(equipmentOptions([row('AHU-01'), row('AHU-02')])).toEqual(['AHU-01', 'AHU-02'])
  })

  it('lọc đúng theo tên thiết bị và theo nhóm chưa gán', () => {
    expect(matchesEquipment(row('AHU-01'), 'AHU-01')).toBe(true)
    expect(matchesEquipment(row('AHU-02'), 'AHU-01')).toBe(false)
    expect(matchesEquipment(row(), UNASSIGNED_EQUIPMENT)).toBe(true)
    expect(matchesEquipment(row('AHU-01'), UNASSIGNED_EQUIPMENT)).toBe(false)
    expect(matchesEquipment(row(), 'ALL')).toBe(true)
  })

  it('lọc thật danh sách Point trên tab Ánh xạ', () => {
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)

    expect(screen.getByRole('button', { name: /Supply air temperature/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Return air temperature/ })).toBeInTheDocument()

    openAdvancedFilters()
    fireEvent.change(screen.getByRole('combobox', { name: 'Thiết bị' }), { target: { value: 'AHU-01' } })

    expect(screen.getByRole('button', { name: /Supply air temperature/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Return air temperature/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Spare channel/ })).not.toBeInTheDocument()
  })

  it('lọc được nhóm chưa gán', () => {
    render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)
    openAdvancedFilters()
    fireEvent.change(screen.getByRole('combobox', { name: 'Thiết bị' }), { target: { value: UNASSIGNED_EQUIPMENT } })

    expect(screen.getByRole('button', { name: /Spare channel/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Supply air temperature/ })).not.toBeInTheDocument()
  })
})
