import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n'
import type { Point, UserRole } from '../../../../shared/types'
import type { ProgrammingDraftDocument, ProgrammingPointCatalogEntry } from '../../model/types'
import { MappingTab } from './MappingTab'

/* `SW-PGM03-LIVE-001` — workbench Ánh xạ lấy metadata từ `point-catalog` và
 * GIÁ TRỊ SỐNG từ WebSocket.
 *
 * Bộ kiểm này khoá đúng ba điều mà thay đổi đó hứa: không còn vòng đọc lại danh
 * mục theo nhịp ngắn; giá trị vẫn cập nhật khi WS đẩy; và mất kênh sống thì số
 * cũ bị gắn nhãn STALE chứ không được vẽ tiếp như số đang sống. */

const auth = vi.hoisted(() => ({ role: 'admin' as UserRole }))
const realtime = vi.hoisted(() => ({
  allPoints: [] as Point[],
  connectionState: 'connected' as 'connected' | 'connecting' | 'reconnecting' | 'disconnected',
  lastPointEventAt: null as string | null,
}))
const api = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('../../../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../auth')>()
  return { ...actual, useAuth: () => ({ session: { username: 'u', role: auth.role, loginAt: '2026-09-13T00:00:00Z' }, getAuthHeader: () => ({}) }) }
})
vi.mock('../../../../shared/realtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../shared/realtime')>()
  return { ...actual, useOptionalRealtime: () => realtime }
})
vi.mock('../../../../shared/api/capabilities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../shared/api/capabilities')>()
  return { ...actual, fetchSystemCapabilities: vi.fn().mockRejectedValue(new Error('không cần cho phép kiểm này')) }
})
vi.mock('../../api/authClient', () => ({ useProgrammingApiClient: () => api }))

function catalogEntry(pointId: string, value: number, quality: ProgrammingPointCatalogEntry['quality'] = 'GOOD'): ProgrammingPointCatalogEntry {
  return {
    category: 'LOCAL', pointId, name: `Điểm ${pointId}`, dataType: 'REAL', unit: 'degC',
    direction: 'READ', writable: false, quality, value, observedAt: '2026-09-13T03:00:00.000Z',
    mapping: { input: { status: 'SUPPORTED', reasons: [] }, output: { status: 'SUPPORTED', reasons: [] } },
  }
}

function livePoint(id: string, value: number, over: Partial<Point> = {}): Point {
  return { id, tag: id, name: id, kind: 'UI', value, quality: 'good', source: 'iop', updatedAt: '2026-09-13T03:00:10.000Z', ...over } as Point
}

function documentFixture(): ProgrammingDraftDocument {
  return {
    schemaVersion: 1,
    project: { projectId: 'project-1', name: 'AHU-01', functionalTags: [] },
    programs: [{
      programId: 'program-1', name: 'AHU_Main', kind: 'PROGRAM', language: 'ST',
      document: 'PROGRAM AHU_Main\nVAR_INPUT\n SupplyTemp : REAL;\nEND_VAR\nEND_PROGRAM',
    }],
    variables: [{ variableId: 'var-supply', programId: 'program-1', name: 'SupplyTemp', type: 'REAL', class: 'INPUT', initialValue: null, retain: false }],
    bindings: [{ bindingId: 'b1', variableId: 'var-supply', point: { category: 'LOCAL', pointId: 'UI-01' }, direction: 'READ', dataType: 'REAL', unit: 'degC', writable: false, qualityPolicy: 'REQUIRE_GOOD' }],
    task: { taskId: 'task-1', periodMs: 1000, programOrder: ['program-1'] },
    library: { profile: 'CORE_REVA', version: '1' },
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  auth.role = 'admin'
  realtime.allPoints = []
  realtime.connectionState = 'connected'
  realtime.lastPointEventAt = null
  api.request.mockReset()
  api.request.mockImplementation(async (operationId: string) => {
    if (operationId !== 'getProgrammingPointCatalog') throw new Error(`operation ngoài dự kiến: ${operationId}`)
    return { items: [catalogEntry('UI-01', 21.5), catalogEntry('UI-02', 30)], nextCursor: null }
  })
  localStorage.setItem('mkddc-lang', 'vi')
})
afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

function renderTab() {
  return render(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)
}

function catalogCalls(): number {
  return api.request.mock.calls.filter(([operationId]) => operationId === 'getProgrammingPointCatalog').length
}

describe('Points & Mapping — danh mục và giá trị sống là hai kênh', () => {
  it('không đọc lại danh mục theo nhịp ngắn: 60 giây im lặng vẫn chỉ một lần đọc', async () => {
    renderTab()
    await waitFor(() => expect(catalogCalls()).toBe(1))

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(catalogCalls()).toBe(1)

    // vẫn có lưới an toàn: sau 5 phút thì đối chiếu lại đúng một lần
    await act(async () => { await vi.advanceTimersByTimeAsync(241_000) })
    expect(catalogCalls()).toBe(2)
  })

  it('giá trị vẫn sống: WS đẩy số mới thì worklist đổi mà không gọi lại danh mục', async () => {
    const view = renderTab()
    await waitFor(() => expect(screen.getAllByText('21.5').length).toBeGreaterThan(0))
    expect(catalogCalls()).toBe(1)

    realtime.allPoints = [livePoint('UI-01', 23.75), livePoint('UI-02', 30)]
    realtime.lastPointEventAt = '2026-09-13T03:00:10.000Z'
    view.rerender(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)

    await waitFor(() => expect(screen.getAllByText('23.75').length).toBeGreaterThan(0))
    expect(screen.queryAllByText('21.5')).toHaveLength(0)
    expect(catalogCalls()).toBe(1)
  })

  it('mất kênh sống ⇒ Quality thành STALE, giá trị cuối vẫn hiện chứ không bị bịa lại', async () => {
    const view = renderTab()
    await waitFor(() => expect(screen.getAllByText('21.5').length).toBeGreaterThan(0))

    realtime.allPoints = [livePoint('UI-01', 23.75), livePoint('UI-02', 30)]
    realtime.lastPointEventAt = '2026-09-13T03:00:10.000Z'
    view.rerender(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)
    await waitFor(() => expect(screen.getAllByText('23.75').length).toBeGreaterThan(0))

    realtime.connectionState = 'disconnected'
    view.rerender(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)

    await waitFor(() => expect(screen.getAllByText('STALE').length).toBeGreaterThan(0))
    expect(screen.getAllByText('23.75').length).toBeGreaterThan(0)
  })

  it('WS lộ ra điểm mà danh mục chưa có ⇒ nạp lại danh mục đúng một lần', async () => {
    const view = renderTab()
    await waitFor(() => expect(catalogCalls()).toBe(1))

    realtime.allPoints = [livePoint('UI-01', 21.5), livePoint('UI-02', 30), livePoint('UI-03', 12)]
    realtime.lastPointEventAt = '2026-09-13T03:00:10.000Z'
    view.rerender(<I18nProvider><MappingTab document={documentFixture()} saving={false} onSave={vi.fn()} /></I18nProvider>)

    await waitFor(() => expect(catalogCalls()).toBe(2))
    // danh mục vẫn trả hai điểm (máy chủ chưa kịp đổi) — không được nạp lại vô hạn
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(catalogCalls()).toBeLessThanOrEqual(3)
  })

  it('bảng vẫn dựng được khi hoàn toàn không có kênh sống', async () => {
    renderTab()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Biến chương trình' })).toBeVisible())
    const list = screen.getByTestId('mapping-variable-list')
    expect(within(list).getByRole('button', { name: /AHU_Main · SupplyTemp · / })).toBeVisible()
    await waitFor(() => expect(screen.getAllByText('21.5').length).toBeGreaterThan(0))
  })
})
