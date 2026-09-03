import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n'
import type { UserRole } from '../../../../shared/types'
import type { SystemCapabilities } from '../../../../shared/api/capabilities'
import type { ProgrammingDraftDocument, ProgrammingPointCatalogEntry } from '../../model/types'
import { MappingTab } from './MappingTab'

/* `ISS-PIO-13`: nút "Gợi ý" từng bị khoá cứng kèm tooltip *"chỉ bật sau khi
 * capability authority được công bố"*. Authority đó nay có thật
 * (`GET /api/v1/system/capabilities`, `ISS-PIO-12`) — và chính nó là điều kiện
 * khiến gợi ý có nghĩa: KHÔNG gợi ý một Point nằm trên kênh mà bo không xác
 * nhận là có thật. */

const auth = vi.hoisted(() => ({ role: 'admin' as UserRole }))
const catalog = vi.hoisted(() => ({
  status: 'ready' as 'ready' | 'error' | 'loading',
  data: null as { items: ProgrammingPointCatalogEntry[]; nextCursor?: string | null } | null,
  error: null as string | null,
  lastSuccessAt: 1_777_000_000_000 as number | null
}))
const capabilityState = vi.hoisted(() => ({ doc: null as unknown, fail: false }))

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
  return {
    ...actual,
    fetchSystemCapabilities: vi.fn(async () => {
      if (capabilityState.fail) throw new Error('iobus offline')
      return capabilityState.doc as SystemCapabilities
    })
  }
})

function documentFixture(): ProgrammingDraftDocument {
  return {
    schemaVersion: 1,
    project: { projectId: 'project-1', name: 'AHU-01', functionalTags: [] },
    programs: [{
      programId: 'program-1', name: 'AHU_Main', kind: 'PROGRAM', language: 'ST',
      document: 'PROGRAM AHU_Main\nVAR_INPUT\n SupplyTemp : REAL;\nEND_VAR\nEND_PROGRAM'
    }],
    variables: [{ variableId: 'var-supply', programId: 'program-1', name: 'SupplyTemp', type: 'REAL', class: 'INPUT', initialValue: null, retain: false }],
    bindings: [],
    task: { taskId: 'task-1', periodMs: 1000, programOrder: ['program-1'] },
    library: { profile: 'CORE_REVA', version: '1' }
  }
}

/** Bo xác nhận `UI-01` nhưng KHÔNG có `UI-09` (không cắm module DI). */
function boardWithOneChannel(): SystemCapabilities {
  return {
    board_cap_known: true,
    board_cap_map: '0x000D',
    blocks: [
      { kind: 'UI', presence: 'yes', count: 1, abi_capacity: 16, optional: false, channels: [{ id: 'UI-01', index: 1, modes: [] }] },
      { kind: 'DI', presence: 'no', count: 0, abi_capacity: 8, optional: true, channels: [] },
      { kind: 'AO', presence: 'yes', count: 0, abi_capacity: 4, optional: false, channels: [] },
      { kind: 'DO', presence: 'yes', count: 0, abi_capacity: 4, optional: false, channels: [] }
    ]
  }
}

beforeEach(() => {
  auth.role = 'admin'
  catalog.status = 'ready'
  catalog.error = null
  catalog.lastSuccessAt = 1_777_000_000_000
  catalog.data = {
    items: [
      /* `mapping` là quyết định eligibility của MÁY CHỦ. Thiếu nó thì
       * `compatibilityFor` trả `SERVER_DECISION_MISSING` và không có gì để gợi ý
       * cả — nên fixture phải mang nó, đúng như backend thật trả về. */
      { category: 'LOCAL', pointId: 'UI-01', name: 'Supply air temperature', dataType: 'REAL', unit: 'degC', direction: 'READ', writable: false, quality: 'GOOD', value: 21.4, observedAt: '2026-08-24T09:00:00Z', mapping: { input: { status: 'SUPPORTED', reasons: [] }, output: { status: 'SUPPORTED', reasons: [] } } },
      { category: 'LOCAL', pointId: 'UI-09', name: 'Isolated DI channel', dataType: 'REAL', unit: 'degC', direction: 'READ', writable: false, quality: 'GOOD', value: 3.3, observedAt: '2026-08-24T09:00:00Z', mapping: { input: { status: 'SUPPORTED', reasons: [] }, output: { status: 'SUPPORTED', reasons: [] } } }
    ]
  }
  capabilityState.fail = false
  capabilityState.doc = boardWithOneChannel()
  localStorage.setItem('mkddc-lang', 'vi')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderTab() {
  return render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)
}

describe('Gợi ý ở tab Ánh xạ', () => {
  // Tiêu chí 4 của `ISS-PIO-13`: nút hết bị khoá cứng.
  it('mở khoá khi đã đọc được capability và có biến đang chọn', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'AHU_Main · SupplyTemp · Chưa map' }))
    expect(await screen.findByRole('button', { name: 'Gợi ý' })).toBeEnabled()
  })

  // Đây là lý do tính năng phải chờ capability: gợi ý một Point trên kênh mà bo
  // không xác nhận là mời người ta đấu dây vào chỗ có thể không tồn tại.
  it('loại khỏi gợi ý Point nằm trên kênh bo không xác nhận', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'AHU_Main · SupplyTemp · Chưa map' }))
    expect(screen.getByRole('button', { name: /Isolated DI channel/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý' }))

    expect(screen.getByRole('button', { name: /Supply air temperature/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Isolated DI channel/ })).not.toBeInTheDocument()
  })

  it('bấm lần nữa thì trở lại danh sách đầy đủ', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'AHU_Main · SupplyTemp · Chưa map' }))
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý' }))
    fireEvent.click(screen.getByRole('button', { name: 'Gợi ý' }))

    expect(screen.getByRole('button', { name: /Isolated DI channel/ })).toBeInTheDocument()
  })

  // Chưa đọc được capability ⇒ VẪN khoá, và tooltip phải nói ra thiếu cái gì —
  // không để lại một lời hứa vĩnh viễn không ai gỡ như tooltip Phase 1A cũ.
  it('vẫn khoá khi chưa đọc được capability, và nói rõ lý do', async () => {
    capabilityState.fail = true
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: 'AHU_Main · SupplyTemp · Chưa map' }))

    const button = screen.getByRole('button', { name: 'Gợi ý' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', expect.stringMatching(/system\/capabilities/))
  })
})
