import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n'
import { ProgrammingApiError, ProgrammingNoResponseError, type ProgrammingBindingPreview } from '../../api/generated/client'
import type { ProgrammingDraftDocument, ProgrammingPointCatalogEntry, ProgrammingProject } from '../../model/types'
import { MappingTab } from './MappingTab'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const DRAFT_ID = '22222222-2222-4222-8222-222222222222'
const api = vi.hoisted(() => ({ request: vi.fn() }))
const catalog = vi.hoisted(() => ({ items: [] as ProgrammingPointCatalogEntry[] }))

vi.mock('../../../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../auth')>()
  return { ...actual, useAuth: () => ({ session: { username: 'engineer', role: 'engineer', loginAt: '2026-09-06T00:00:00Z' }, getAuthHeader: () => ({}) }) }
})
vi.mock('../../api/authClient', () => ({ useProgrammingApiClient: () => api }))
vi.mock('../../api/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/queries')>()
  return { ...actual, useProgrammingPointCatalog: () => ({ status: 'ready', data: { items: catalog.items, nextCursor: null }, error: null, lastSuccessAt: Date.now(), complete: true, canRetry: false, retry: vi.fn(), restart: vi.fn(), refresh: vi.fn() }) }
})
vi.mock('../../../../shared/api/capabilities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../shared/api/capabilities')>()
  return { ...actual, fetchSystemCapabilities: vi.fn().mockRejectedValue(new Error('không cần cho mutation test')) }
})

function documentFixture(bindings: ProgrammingDraftDocument['bindings'] = []): ProgrammingDraftDocument {
  return {
    schemaVersion: 2,
    project: { projectId: PROJECT_ID, name: 'AHU', functionalTags: [] },
    programs: [{ programId: 'program-1', name: 'AHU_Main', kind: 'PROGRAM', language: 'ST', document: 'PROGRAM AHU_Main\nEND_PROGRAM' }],
    variables: [{ variableId: 'variable-1', programId: 'program-1', name: 'SupplyTemp', type: 'REAL', class: 'INPUT', initialValue: null, retain: false }],
    bindings,
    task: { taskId: 'task-1', periodMs: 1000, programOrder: ['program-1'] },
    library: { profile: 'CORE_REVA', version: '1' },
  }
}

function projectFixture(document: ProgrammingDraftDocument): ProgrammingProject {
  return {
    projectId: PROJECT_ID,
    name: 'AHU',
    etag: '"draft:7"',
    activeRevisionId: null,
    draftRevisionId: DRAFT_ID,
    baseRevisionId: DRAFT_ID,
    updatedAt: '2026-09-06T00:00:00Z',
    draft: document,
    dirty: true,
    draftSequence: 1,
    activeSequence: null,
  }
}

beforeEach(() => {
  catalog.items = [{
    category: 'LOCAL', pointId: 'UI-01', name: 'Supply temperature', dataType: 'REAL', unit: 'degC',
    direction: 'READ', writable: false, quality: 'GOOD', value: 21.5, extIndex: 999,
    mapping: { input: { status: 'SUPPORTED', reasons: [] }, output: { status: 'INCOMPATIBLE', reasons: [] } },
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

describe('Mapping mutation qua preview và Draft read-back', () => {
  it('engineer Assign bằng canonical identity, không gửi extIndex và chỉ báo xong sau read-back', async () => {
    const before = documentFixture()
    const onSave = vi.fn().mockResolvedValue(true)
    const view = render(<I18nProvider><MappingTab document={before} draft={before} project={projectFixture(before)} projectId={PROJECT_ID} saving={false} onSave={onSave} /></I18nProvider>)

    fireEvent.click(await screen.findByRole('button', { name: 'Ánh xạ AHU_Main · SupplyTemp' }))
    await screen.findByText('ALLOW')
    expect(api.request).toHaveBeenCalledTimes(1)
    const previewOptions = api.request.mock.calls[0][1]
    expect(previewOptions.ifMatch).toBe('"draft:7"')
    expect(JSON.stringify(previewOptions.body)).not.toContain('extIndex')

    fireEvent.click(screen.getByRole('button', { name: 'Ghi vào Draft' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Đang đối chiếu read-back Draft…')).toBeVisible()

    const operation = onSave.mock.calls[0][0][0]
    const after = documentFixture([operation.binding])
    view.rerender(<I18nProvider><MappingTab document={after} draft={after} project={projectFixture(after)} projectId={PROJECT_ID} saving={false} onSave={onSave} /></I18nProvider>)
    expect(await screen.findByText('Read-back xác nhận Draft đã đổi.')).toBeVisible()
  })

  it.each([
    {
      source: 'VP',
      point: {
        category: 'VP', pointId: 'VP_SUPPLY_TEMP', name: 'Virtual supply temperature', dataType: 'REAL', unit: 'degC',
        direction: 'READ', writable: false, quality: 'GOOD', value: 21.5, extIndex: 401,
        mapping: { input: { status: 'SUPPORTED', reasons: [] }, output: { status: 'INCOMPATIBLE', reasons: [] } },
      } satisfies ProgrammingPointCatalogEntry,
      expectedIdentity: { category: 'VP', pointId: 'VP_SUPPLY_TEMP' },
    },
    {
      source: 'MB_RTU',
      point: {
        category: 'MB_RTU', deviceId: 'bus-1-slave-4', pointId: 'TEMP', name: 'VFD temperature', dataType: 'REAL', unit: 'degC',
        direction: 'READ', writable: false, quality: 'GOOD', value: 31.25, extIndex: 912,
        mapping: { input: { status: 'SUPPORTED', reasons: [] }, output: { status: 'INCOMPATIBLE', reasons: [] } },
      } satisfies ProgrammingPointCatalogEntry,
      expectedIdentity: { category: 'MB_RTU', deviceId: 'bus-1-slave-4', pointId: 'TEMP' },
    },
  ])('Assign $source chỉ gửi canonical point identity', async ({ point, expectedIdentity }) => {
    catalog.items = [point]
    const before = documentFixture()
    render(<I18nProvider><MappingTab document={before} draft={before} project={projectFixture(before)} projectId={PROJECT_ID} saving={false} onSave={vi.fn()} /></I18nProvider>)

    fireEvent.click(await screen.findByRole('button', { name: 'Ánh xạ AHU_Main · SupplyTemp' }))
    await screen.findByText('ALLOW')

    const candidate = api.request.mock.calls[0][1].body.binding
    expect(candidate.point).toEqual(expectedIdentity)
    expect(candidate.point).not.toHaveProperty('extIndex')
  })

  it('hoàn thành chọn Point, xem trước, ghi và đóng modal chỉ bằng bàn phím', async () => {
    const user = userEvent.setup()
    const before = documentFixture()
    const onSave = vi.fn().mockResolvedValue(true)
    const view = render(<I18nProvider><MappingTab document={before} draft={before} project={projectFixture(before)} projectId={PROJECT_ID} saving={false} onSave={onSave} /></I18nProvider>)

    const point = await screen.findByRole('button', { name: /UI-01 Supply temperature/ })
    point.focus()
    await user.keyboard('{Enter}')
    expect(point).toHaveAttribute('aria-pressed', 'true')

    const mapAction = screen.getByRole('button', { name: 'Ánh xạ AHU_Main · SupplyTemp' })
    mapAction.focus()
    await user.keyboard('{Enter}')
    await screen.findByText('ALLOW')
    const confirm = screen.getByRole('button', { name: 'Ghi vào Draft' })
    confirm.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))

    const operation = onSave.mock.calls[0][0][0]
    const after = documentFixture([operation.binding])
    view.rerender(<I18nProvider><MappingTab document={after} draft={after} project={projectFixture(after)} projectId={PROJECT_ID} saving={false} onSave={onSave} /></I18nProvider>)
    const close = await screen.findByRole('button', { name: 'Đóng' })
    close.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Đổi ánh xạ AHU_Main · SupplyTemp' })).toHaveFocus()
  })

  it('Gỡ ánh xạ giữ modal tới khi read-back xác nhận binding đã mất', async () => {
    const binding: ProgrammingDraftDocument['bindings'][number] = {
      bindingId: 'binding-1', variableId: 'variable-1', point: { category: 'LOCAL', pointId: 'UI-01' },
      direction: 'READ', dataType: 'REAL', unit: 'degC', writable: false, qualityPolicy: 'REQUIRE_GOOD',
    }
    const before = documentFixture([binding])
    const onSave = vi.fn().mockResolvedValue(true)
    const view = render(<I18nProvider><MappingTab document={before} draft={before} project={projectFixture(before)} projectId={PROJECT_ID} saving={false} onSave={onSave} /></I18nProvider>)

    fireEvent.click((await screen.findAllByRole('button', { name: /^Gỡ/ }))[0])
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Gỡ ánh xạ' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([{ op: 'removeBinding', bindingId: 'binding-1' }]))

    const after = documentFixture()
    view.rerender(<I18nProvider><MappingTab document={after} draft={after} project={projectFixture(after)} projectId={PROJECT_ID} saving={false} onSave={onSave} /></I18nProvider>)
    expect(await screen.findByText('Read-back xác nhận Draft đã đổi.')).toBeVisible()
  })

  it('Đổi từ bảng ánh xạ giữ bindingId và xem trước Point mới trước khi ghi', async () => {
    const binding: ProgrammingDraftDocument['bindings'][number] = {
      bindingId: 'binding-1', variableId: 'variable-1', point: { category: 'LOCAL', pointId: 'UI-01' },
      direction: 'READ', dataType: 'REAL', unit: 'degC', writable: false, qualityPolicy: 'REQUIRE_GOOD',
    }
    catalog.items.push({
      category: 'LOCAL', pointId: 'UI-02', name: 'Return temperature', dataType: 'REAL', unit: 'degC',
      direction: 'READ', writable: false, quality: 'GOOD', value: 22.5,
      mapping: { input: { status: 'SUPPORTED', reasons: [] }, output: { status: 'INCOMPATIBLE', reasons: [] } },
    })
    const before = documentFixture([binding])
    const onSave = vi.fn().mockResolvedValue(true)
    render(<I18nProvider><MappingTab document={before} draft={before} project={projectFixture(before)} projectId={PROJECT_ID} saving={false} onSave={onSave} /></I18nProvider>)

    fireEvent.click(await screen.findByRole('button', { name: /UI-02 Return temperature/ }))
    const assignedRow = screen.getByRole('row', { name: /SupplyTemp\s+LOCAL:UI-01/ })
    fireEvent.click(within(assignedRow).getByRole('button', { name: 'Đổi' }))
    await screen.findByText('ALLOW')
    expect(api.request.mock.calls[0][1].body.binding).toMatchObject({
      bindingId: 'binding-1',
      variableId: 'variable-1',
      point: { category: 'LOCAL', pointId: 'UI-02' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Ghi vào Draft' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({
        op: 'upsertBinding',
        binding: expect.objectContaining({ bindingId: 'binding-1', point: { category: 'LOCAL', pointId: 'UI-02' } }),
      }),
    ]))
  })

  it.each([
    ['403', new ProgrammingApiError(403, { error: { code: 'PRG-SIM-FORBIDDEN', messageKey: 'programming.error.simForbidden', retryable: false, keepsRunningRevision: true, correlationId: 'correlation-id-403' } }), /quyền sửa Programming đã bị thu hồi/i],
    ['409', new ProgrammingApiError(409, { error: { code: 'PRG-ERR-CONFLICT-001', messageKey: 'programming.error.conflict', retryable: false, keepsRunningRevision: true, correlationId: 'correlation-id-409' } }), /Draft đã thay đổi ở phiên khác/i],
    ['timeout', new ProgrammingNoResponseError('timeout', 15_000), /kết quả chưa xác định/i],
  ])('giữ lựa chọn, nói rõ lỗi %s và không tự phát lại preview', async (_label, failure, expected) => {
    api.request.mockRejectedValueOnce(failure)
    const before = documentFixture()
    render(<I18nProvider><MappingTab document={before} draft={before} project={projectFixture(before)} projectId={PROJECT_ID} saving={false} onSave={vi.fn()} /></I18nProvider>)

    fireEvent.click(await screen.findByRole('button', { name: 'Ánh xạ AHU_Main · SupplyTemp' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(expected)
    expect(api.request).toHaveBeenCalledTimes(1)
    expect(screen.getByText('AHU_Main · SupplyTemp')).toBeVisible()
  })

  it('không báo thành công khi mutation response và Draft read-back không khớp', async () => {
    vi.useFakeTimers()
    try {
      const before = documentFixture()
      const onSave = vi.fn().mockResolvedValue(true)
      const view = render(<I18nProvider><MappingTab document={before} draft={before} project={projectFixture(before)} projectId={PROJECT_ID} saving={false} onSave={onSave} /></I18nProvider>)

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Ánh xạ AHU_Main · SupplyTemp' }))
        await Promise.resolve()
      })
      fireEvent.click(screen.getByRole('button', { name: 'Ghi vào Draft' }))
      await act(async () => { await Promise.resolve() })
      const operation = onSave.mock.calls[0][0][0]
      const alteredBinding = { ...operation.binding, writable: !operation.binding.writable }
      const alteredReadBack = documentFixture([alteredBinding])
      view.rerender(<I18nProvider><MappingTab document={alteredReadBack} draft={alteredReadBack} project={projectFixture(alteredReadBack)} projectId={PROJECT_ID} saving={false} onSave={onSave} /></I18nProvider>)
      await act(async () => { vi.advanceTimersByTime(4000) })

      expect(screen.getByRole('alert')).toHaveTextContent(/Read-back Draft không khớp/)
      expect(onSave).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
