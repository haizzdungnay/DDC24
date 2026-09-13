import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n'
import type { ProgrammingBindingPreview } from '../../api/generated/client'
import type { ProgrammingDraftDocument, ProgrammingPointCatalogEntry, ProgrammingProject } from '../../model/types'
import { MappingTab } from './MappingTab'

/* `ISS-PGM03-11` — chọn biến trong worklist Points & Mapping.
 *
 * Bug gốc: chỉ ô tên ở cột đầu bắt click, nên bấm vào bất kỳ cột nào khác của
 * hàng (kiểu, ánh xạ, giá trị, quality — gần hết bề ngang) không đổi biến đang
 * chọn; Inspector đứng yên ở biến đầu danh sách và người dùng đọc ra "không
 * chuyển được selection". Bộ kiểm này khóa cả năm điều kiện nghiệm thu: đổi
 * được selection, Inspector bám theo, chỉ một hàng được chọn, selection sống
 * qua refresh dữ liệu live, và mutation luôn chạy trên đúng biến đang chọn. */

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const DRAFT_ID = '22222222-2222-4222-8222-222222222222'
const api = vi.hoisted(() => ({ request: vi.fn() }))
const catalog = vi.hoisted(() => ({ items: [] as ProgrammingPointCatalogEntry[] }))

vi.mock('../../../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../auth')>()
  return { ...actual, useAuth: () => ({ session: { username: 'engineer', role: 'engineer', loginAt: '2026-09-13T00:00:00Z' }, getAuthHeader: () => ({}) }) }
})
vi.mock('../../api/authClient', () => ({ useProgrammingApiClient: () => api }))
vi.mock('../../api/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/queries')>()
  return { ...actual, useProgrammingPointCatalog: () => ({ status: 'ready', data: { items: catalog.items, nextCursor: null }, error: null, lastSuccessAt: Date.now(), complete: true, canRetry: false, retry: vi.fn(), restart: vi.fn(), refresh: vi.fn() }) }
})
vi.mock('../../../../shared/api/capabilities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../shared/api/capabilities')>()
  return { ...actual, fetchSystemCapabilities: vi.fn().mockRejectedValue(new Error('không cần cho phép kiểm selection')) }
})

/* Tên và định danh lấy đúng hình dạng Draft thật trên bo Foxlinx (POU
 * `RelayPattern32`): biến là `locals` có `variableId` UUID, không phải index. */
const PROGRAM_ID = '9f1887fe-9fe1-47b2-8801-baf5248a75be'
const VARIABLES = Array.from({ length: 8 }, (_, index) => ({
  variableId: `50050804-0000-4000-8000-00000000000${index + 1}`,
  name: `R50804_DO${index + 1}`,
}))

function documentFixture(options: { names?: string[]; bindings?: ProgrammingDraftDocument['bindings'] } = {}): ProgrammingDraftDocument {
  const chosen = options.names ? VARIABLES.filter((variable) => options.names!.includes(variable.name)) : VARIABLES
  return {
    schemaVersion: 2,
    project: { projectId: PROJECT_ID, name: 'AHU-MASTER-SEQUENCE', functionalTags: [] },
    programs: [{ programId: PROGRAM_ID, name: 'RelayPattern32', kind: 'PROGRAM', language: 'ST', document: 'PROGRAM RelayPattern32\nEND_PROGRAM' }],
    variables: chosen.map((variable) => ({ ...variable, programId: PROGRAM_ID, type: 'BOOL', class: 'OUTPUT' as const, initialValue: null, retain: false })),
    bindings: options.bindings ?? [],
    task: { taskId: 'task-1', periodMs: 1000, programOrder: [PROGRAM_ID] },
    library: { profile: 'CORE_REVA', version: '1' },
  }
}

function projectFixture(document: ProgrammingDraftDocument): ProgrammingProject {
  return {
    projectId: PROJECT_ID,
    name: 'AHU-MASTER-SEQUENCE',
    etag: '"draft:7"',
    activeRevisionId: null,
    draftRevisionId: DRAFT_ID,
    baseRevisionId: DRAFT_ID,
    updatedAt: '2026-09-13T00:00:00Z',
    draft: document,
    dirty: true,
    draftSequence: 1,
    activeSequence: null,
  }
}

function renderTab(document = documentFixture()) {
  return render(<I18nProvider><MappingTab document={document} draft={document} project={projectFixture(document)} projectId={PROJECT_ID} saving={false} onSave={vi.fn().mockResolvedValue(true)} /></I18nProvider>)
}

/** Tên biến mà Binding Inspector đang render. */
function inspectorVariable(): string {
  const inspector = screen.getByRole('complementary', { name: 'Binding Inspector' })
  return within(inspector).getByText('Variable').nextElementSibling?.textContent ?? ''
}

/** Hàng worklist của một biến, tính từ nút tên ở cột đầu. */
function worklistRow(name: string): HTMLElement {
  const list = screen.getByTestId('mapping-variable-list')
  return within(list).getByRole('button', { name: new RegExp(`RelayPattern32 · ${name} · `) }).parentElement as HTMLElement
}

function selectedNames(): string[] {
  const list = screen.getByTestId('mapping-variable-list')
  return within(list).getAllByRole('button', { pressed: true }).map((button) => (button.getAttribute('aria-label') ?? '').split(' · ')[1])
}

beforeEach(() => {
  catalog.items = [{
    category: 'LOCAL', pointId: 'DO-01', name: 'Relay 1', dataType: 'BOOL',
    direction: 'WRITE', writable: true, quality: 'GOOD', value: false, observedAt: '2026-09-13T09:00:00Z',
    mapping: { input: { status: 'SUPPORTED', reasons: [] }, output: { status: 'SUPPORTED', reasons: [] } },
  }]
  api.request.mockReset()
  api.request.mockImplementation(async (operationId: string) => {
    if (operationId !== 'previewProgrammingBinding') throw new Error(`operation ngoài dự kiến: ${operationId}`)
    return {
      schemaVersion: '1.0', verdict: 'ALLOW', issues: [], projectId: PROJECT_ID,
      draftRevisionId: DRAFT_ID, baseRevisionId: DRAFT_ID, etag: '"draft:7"',
    } satisfies ProgrammingBindingPreview
  })
  localStorage.setItem('mkddc-lang', 'vi')
})
afterEach(cleanup)

describe('Points & Mapping — chọn biến chương trình', () => {
  it('chuyển liên tục DO1 → DO2 → DO6 → DO7, Inspector bám theo và chỉ một hàng được chọn', () => {
    renderTab()
    expect(inspectorVariable()).toBe('R50804_DO1')

    for (const name of ['R50804_DO2', 'R50804_DO6', 'R50804_DO7']) {
      fireEvent.click(within(worklistRow(name)).getByRole('button', { name: new RegExp(`· ${name} · `) }))
      expect(inspectorVariable()).toBe(name)
      expect(selectedNames()).toEqual([name])
    }
  })

  it('bấm vào THÂN hàng (ô kiểu, ô quality) cũng chọn đúng hàng đó', () => {
    renderTab()

    fireEvent.click(within(worklistRow('R50804_DO3')).getAllByText('BOOL')[0])
    expect(inspectorVariable()).toBe('R50804_DO3')
    expect(selectedNames()).toEqual(['R50804_DO3'])

    fireEvent.click(within(worklistRow('R50804_DO5')).getByText('UNKNOWN'))
    expect(inspectorVariable()).toBe('R50804_DO5')
    expect(selectedNames()).toEqual(['R50804_DO5'])
  })

  it('giữ selection qua refresh dữ liệu live và qua lọc rồi bỏ lọc', () => {
    const view = renderTab()
    fireEvent.click(within(worklistRow('R50804_DO4')).getByRole('button', { name: /· R50804_DO4 · / }))
    expect(inspectorVariable()).toBe('R50804_DO4')

    // Snapshot Point mới (giá trị live đổi) không được cuốn selection đi.
    catalog.items = [{ ...catalog.items[0], value: true, observedAt: '2026-09-13T09:00:05Z' }]
    const next = documentFixture()
    view.rerender(<I18nProvider><MappingTab document={next} draft={next} project={projectFixture(next)} projectId={PROJECT_ID} saving={false} onSave={vi.fn()} /></I18nProvider>)
    expect(inspectorVariable()).toBe('R50804_DO4')

    const search = screen.getByRole('searchbox', { name: 'Tìm biến hoặc Point' })
    fireEvent.change(search, { target: { value: 'R50804_DO8' } })
    expect(inspectorVariable()).toBe('R50804_DO4')
    fireEvent.change(search, { target: { value: '' } })
    expect(inspectorVariable()).toBe('R50804_DO4')
    expect(selectedNames()).toEqual(['R50804_DO4'])
  })

  it('biến đang chọn biến mất khỏi Draft thì selection chuyển hẳn sang biến còn tồn tại', () => {
    const view = renderTab()
    fireEvent.click(within(worklistRow('R50804_DO4')).getByRole('button', { name: /· R50804_DO4 · / }))
    expect(inspectorVariable()).toBe('R50804_DO4')

    const shrunk = documentFixture({ names: ['R50804_DO1', 'R50804_DO2'] })
    view.rerender(<I18nProvider><MappingTab document={shrunk} draft={shrunk} project={projectFixture(shrunk)} projectId={PROJECT_ID} saving={false} onSave={vi.fn()} /></I18nProvider>)
    expect(inspectorVariable()).toBe('R50804_DO1')
    expect(selectedNames()).toEqual(['R50804_DO1'])
  })

  it('payload preview mang variableId của đúng biến đang chọn, không phải biến chọn trước đó', async () => {
    renderTab()
    fireEvent.click(within(worklistRow('R50804_DO6')).getByRole('button', { name: /· R50804_DO6 · / }))
    fireEvent.click(screen.getByRole('button', { name: 'Ánh xạ RelayPattern32 · R50804_DO6' }))

    await waitFor(() => expect(api.request).toHaveBeenCalledTimes(1))
    expect(api.request.mock.calls[0][1].body.binding.variableId).toBe('50050804-0000-4000-8000-000000000006')
  })

  it('bấm "Đổi" ở bảng Ánh xạ đã gán kéo selection về đúng hàng đó trước khi xem trước', async () => {
    const bound = documentFixture({
      bindings: [{
        bindingId: 'b0050804-0000-4000-8000-000000000002',
        variableId: '50050804-0000-4000-8000-000000000002',
        point: { category: 'LOCAL', pointId: 'DO-01' },
        direction: 'WRITE', dataType: 'BOOL', writable: true, qualityPolicy: 'REQUIRE_GOOD',
      }],
    })
    renderTab(bound)

    // Đang đứng ở biến đầu danh sách, KHÁC biến của hàng sắp bấm "Đổi".
    expect(inspectorVariable()).toBe('R50804_DO1')

    const assigned = screen.getByRole('region', { name: 'Ánh xạ đã gán' })
    fireEvent.click(within(assigned).getAllByRole('button', { name: 'Đổi' })[0])

    expect(inspectorVariable()).toBe('R50804_DO2')
    await waitFor(() => expect(api.request).toHaveBeenCalledTimes(1))
    expect(api.request.mock.calls[0][1].body.binding.variableId).toBe('50050804-0000-4000-8000-000000000002')
  })
})
