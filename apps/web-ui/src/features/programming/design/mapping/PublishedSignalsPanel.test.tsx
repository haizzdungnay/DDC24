import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n'
import type { UserRole } from '../../../../shared/types'
import type {
  ProgrammingDraftDocument,
  ProgrammingDraftOperation,
  ProgrammingPublishedSignal,
  ProgrammingSignalDependencies
} from '../../model/types'
import { validateSignalForm, type SignalFormValue } from '../../model/signals'
import { PublishedSignalsPanel } from './PublishedSignalsPanel'

const auth = vi.hoisted(() => ({ role: 'admin' as UserRole }))
vi.mock('../../../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../auth')>()
  return {
    ...actual,
    useAuth: () => ({
      session: { username: 'u', role: auth.role, loginAt: '2026-08-24T00:00:00Z' },
      login: vi.fn(),
      logout: vi.fn(),
      isAuthenticated: true,
      getAuthHeader: () => ({})
    })
  }
})

const PROGRAM_ID = '11111111-1111-4111-8111-111111111111'
const PROGRAM_OBJECT_ID = '22222222-2222-4222-8222-222222222222'
const CONSUMER_OBJECT_ID = '33333333-3333-4333-8333-333333333333'
const SIGNAL_ID = '44444444-4444-4444-8444-444444444444'

function authoritativeDependencies(): ProgrammingSignalDependencies {
  return {
    schemaVersion: '1.0', status: 'AUTHORITATIVE', reasonCode: 'VERIFIED', projectId: 'project-1',
    draftRevisionId: 'draft-1', draftSha256: 'a'.repeat(64), baseRevisionId: 'revision-1',
    checkedDraftSha256: 'a'.repeat(64), checkId: 'check-1', checkRevisionId: 'revision-1',
    checkInputSha256: 'b'.repeat(64), dependencies: [{
      signalId: SIGNAL_ID, name: 'SupplyTemp', type: 'REAL', unit: 'degC',
      publisherProgramId: PROGRAM_ID, freshnessMs: 5_000, stalePolicy: 'HOLD_LAST', fallbackValue: null,
      publisher: { programId: PROGRAM_ID, objectId: PROGRAM_OBJECT_ID, name: 'AirHandler', language: 'ST', location: { line: 2, column: 1, length: 10 } },
      consumers: [{ programId: PROGRAM_ID, objectId: CONSUMER_OBJECT_ID, name: 'SafetyConsumer', language: 'ST', location: { line: 5, column: 11, length: 10 } }],
    }],
  }
}

function signal(overrides: Partial<ProgrammingPublishedSignal> = {}): ProgrammingPublishedSignal {
  return {
    signalId: SIGNAL_ID,
    name: 'SupplyTemp',
    type: 'REAL',
    unit: 'degC',
    publisherProgramId: PROGRAM_ID,
    freshnessMs: 5_000,
    stalePolicy: 'HOLD_LAST',
    ...overrides
  }
}

/** Fixture giữ nguyên shape v2 trên dây; cố ý không qua `toWorkspaceDocument`. */
function v2Draft(signals: ProgrammingPublishedSignal[] = []): ProgrammingDraftDocument {
  return {
    schemaVersion: 2,
    project: { projectId: 'project-1', name: 'AHU-01', functionalTags: [] },
    objects: [
      {
        objectId: PROGRAM_OBJECT_ID,
        kind: 'PROGRAM',
        name: 'AirHandler',
        language: 'ST',
        source: 'PROGRAM AirHandler\nEND_PROGRAM',
        interface: { inputs: [], outputs: [] },
        locals: [],
        dependencies: []
      },
      {
        objectId: CONSUMER_OBJECT_ID,
        kind: 'FUNCTION_BLOCK',
        name: 'SafetyConsumer',
        language: 'ST',
        source: 'FUNCTION_BLOCK SafetyConsumer\nVAR\n  Cached : REAL;\nEND_VAR\nCached := SupplyTemp;\nEND_FUNCTION_BLOCK',
        interface: { inputs: [], outputs: [] },
        locals: [],
        dependencies: []
      }
    ],
    programs: [{ programId: PROGRAM_ID, objectId: PROGRAM_OBJECT_ID, periodMs: 1_000 }],
    signals,
    bindings: [],
    library: { systemProfile: 'CORE_REVA', systemVersion: '1', projectLibraryRevisionId: null },
    execution: {}
  } as unknown as ProgrammingDraftDocument
}

function renderPanel(
  draft: ProgrammingDraftDocument,
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
) {
  return render(
    <I18nProvider>
      <PublishedSignalsPanel draft={draft} saving={false} onSave={onSave} dependencies={{
        status: 'ready', data: authoritativeDependencies(), error: null, refresh: () => {},
      }} projectId="project-1" />
    </I18nProvider>
  )
}

beforeEach(() => {
  auth.role = 'admin'
  localStorage.setItem('mkddc-lang', 'vi')
})
afterEach(cleanup)

describe('PublishedSignalsPanel — authoring Draft v2 Plan59', () => {
  it('đọc consumer authoritative từ Check thay vì quét text Draft', () => {
    renderPanel(v2Draft([signal()]), vi.fn().mockResolvedValue(true))

    const table = screen.getByRole('table', { name: 'Bảng Published Signal của bản nháp' })
    expect(within(table).getByRole('row', { name: /SupplyTemp/ })).toHaveTextContent('AirHandler')
    expect(within(table).getByRole('row', { name: /SupplyTemp/ })).toHaveTextContent('SafetyConsumer')
    expect(screen.getByText(/lấy từ compiler trong Check/)).toBeInTheDocument()
    expect(screen.getByText(/Đã kiểm chứng/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'SafetyConsumer' }))
    expect(globalThis.location.search).toContain(`program=${CONSUMER_OBJECT_ID}`)
    expect(globalThis.location.search).toContain('line=5')
  })

  it('không diễn giải stale hoặc unavailable thành không có consumer', () => {
    const stale = authoritativeDependencies()
    stale.status = 'STALE'
    stale.reasonCode = 'DRAFT_CHANGED'
    render(
      <I18nProvider>
        <PublishedSignalsPanel draft={v2Draft([signal()])} saving={false} onSave={vi.fn().mockResolvedValue(true)}
          dependencies={{ status: 'ready', data: stale, error: null, refresh: () => {} }} projectId="project-1" />
      </I18nProvider>
    )
    expect(screen.getByText(/Đã cũ — bản nháp đã đổi/)).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /SupplyTemp/ })).toHaveTextContent('Đã cũ')
    expect(screen.queryByText('Đã kiểm: không có')).not.toBeInTheDocument()
  })

  it('chặn dữ liệu sai, gửi USE_FALLBACK đúng kiểu và chỉ xác nhận sau read-back server', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    const initial = v2Draft([signal()])
    const view = renderPanel(initial, onSave)

    fireEvent.click(screen.getByRole('button', { name: 'Khai Published Signal' }))
    const form = screen.getByRole('form', { name: 'Biểu mẫu Published Signal' })
    fireEvent.change(within(form).getByLabelText('Tên signal'), { target: { value: 'supplytemp' } })
    fireEvent.change(within(form).getByLabelText('Kiểu dữ liệu'), { target: { value: 'BOOL' } })
    fireEvent.change(within(form).getByLabelText('Đơn vị'), { target: { value: ' state ' } })
    fireEvent.change(within(form).getByLabelText('Hạn tươi (ms)'), { target: { value: '999' } })
    fireEvent.change(within(form).getByLabelText('Chính sách khi quá hạn'), { target: { value: 'USE_FALLBACK' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Lưu Published Signal' }))

    expect(within(form).getByText(/trùng tên/)).toBeInTheDocument()
    expect(within(form).getByText(/1000..90000 ms/)).toBeInTheDocument()
    expect(within(form).getByText(/bắt buộc có giá trị dự phòng/)).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()

    fireEvent.change(within(form).getByLabelText('Tên signal'), { target: { value: 'ReturnAirValid' } })
    fireEvent.change(within(form).getByLabelText('Hạn tươi (ms)'), { target: { value: '5000' } })
    fireEvent.change(within(form).getByLabelText('Giá trị dự phòng (TRUE/FALSE)'), { target: { value: 'FALSE' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Lưu Published Signal' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const operations = onSave.mock.calls[0][0] as ProgrammingDraftOperation[]
    expect(operations).toEqual([{
      op: 'upsertSignal',
      signal: {
        signalId: expect.any(String),
        name: 'ReturnAirValid',
        type: 'BOOL',
        unit: 'state',
        publisherProgramId: PROGRAM_ID,
        freshnessMs: 5_000,
        stalePolicy: 'USE_FALLBACK',
        fallbackValue: 0
      }
    }])

    // Không optimistic: trước khi server trả Draft mới, bảng vẫn chỉ có dữ liệu cũ.
    await waitFor(() => expect(screen.getByText('Đang đọc lại bản nháp từ máy chủ…')).toBeInTheDocument())
    expect(screen.queryByRole('row', { name: /ReturnAirValid/ })).not.toBeInTheDocument()

    const stored = operations[0].op === 'upsertSignal' ? operations[0].signal : null
    expect(stored).not.toBeNull()
    view.rerender(
      <I18nProvider>
        <PublishedSignalsPanel
          draft={v2Draft([signal(), stored as ProgrammingPublishedSignal])}
          saving={false}
          onSave={onSave}
        />
      </I18nProvider>
    )
    expect(await screen.findByText(/Máy chủ đã trả lại signal/)).toHaveTextContent('ReturnAirValid · BOOL · 5000 ms · USE_FALLBACK')
  })

  it('ánh xạ tên chính sách UI sang enum runtime và loại fallback khi không áp dụng', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    renderPanel(v2Draft([signal({ stalePolicy: 'USE_FALLBACK', fallbackValue: 12 })]), onSave)

    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }))
    let form = screen.getByRole('form', { name: 'Biểu mẫu Published Signal' })
    fireEvent.change(within(form).getByLabelText('Chính sách khi quá hạn'), { target: { value: 'HOLD_PRIVATE' } })
    expect(within(form).queryByLabelText(/Giá trị dự phòng/)).not.toBeInTheDocument()
    fireEvent.click(within(form).getByRole('button', { name: 'Lưu Published Signal' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toEqual([{
      op: 'upsertSignal',
      signal: expect.objectContaining({ signalId: SIGNAL_ID, stalePolicy: 'HOLD_LAST' })
    }])
    expect((onSave.mock.calls[0][0][0] as { signal: object }).signal).not.toHaveProperty('fallbackValue')

    // Draft chưa read-back nên form đóng, mở lại từ bản server hiện có để thử policy còn lại.
    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }))
    form = screen.getByRole('form', { name: 'Biểu mẫu Published Signal' })
    fireEvent.change(within(form).getByLabelText('Chính sách khi quá hạn'), { target: { value: 'BLOCK_PROGRAM' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Lưu Published Signal' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
    expect(onSave.mock.calls[1][0]).toEqual([{
      op: 'upsertSignal',
      signal: expect.objectContaining({ signalId: SIGNAL_ID, stalePolicy: 'WAIT' })
    }])
    expect((onSave.mock.calls[1][0][0] as { signal: object }).signal).not.toHaveProperty('fallbackValue')
  })

  it('không đổi ngầm FAIL_CLOSED khi sửa và chỉ ghi sau khi người dùng chọn policy thay thế', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    renderPanel(v2Draft([signal({ stalePolicy: 'FAIL_CLOSED' })]), onSave)

    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }))
    const form = screen.getByRole('form', { name: 'Biểu mẫu Published Signal' })
    const policy = within(form).getByLabelText('Chính sách khi quá hạn')
    expect(policy).toHaveValue('')
    expect(within(form).getByText(/FAIL_CLOSED nằm ngoài DDD §7.3/)).toBeInTheDocument()

    fireEvent.click(within(form).getByRole('button', { name: 'Lưu Published Signal' }))
    expect(await within(form).findByText('Chính sách quá hạn không hợp lệ.')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()

    fireEvent.change(policy, { target: { value: 'BLOCK_PROGRAM' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Lưu Published Signal' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([{
      op: 'upsertSignal',
      signal: expect.objectContaining({ signalId: SIGNAL_ID, stalePolicy: 'WAIT' })
    }]))
  })

  it.each([
    ['INT', '32768'],
    ['DINT', '-2147483649'],
    ['UINT', '65536'],
    ['REAL', '3.5e38'],
    ['TIME', '9223372036855']
  ] as const)('chặn fallback %s ngoài dải backend (%s)', (type, fallbackValue) => {
    const value: SignalFormValue = {
      signalId: SIGNAL_ID,
      name: 'SupplyTemp',
      type,
      unit: '',
      publisherProgramId: PROGRAM_ID,
      freshnessMs: '5000',
      stalePolicy: 'USE_FALLBACK',
      fallbackValue
    }
    expect(validateSignalForm(value, {
      signals: [],
      producerProgramIds: [PROGRAM_ID]
    }).fallback).toBe('FALLBACK_RANGE')
  })

  it('viewer đọc được nhưng không có bất kỳ mutation control nào', () => {
    auth.role = 'viewer'
    renderPanel(v2Draft([signal()]), vi.fn().mockResolvedValue(true))

    expect(screen.getByRole('row', { name: /SupplyTemp/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Khai Published Signal' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sửa' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Xoá' })).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Biểu mẫu Published Signal' })).not.toBeInTheDocument()
  })

  it('xoá bằng removeSignal và chỉ xác nhận khi read-back không còn signal', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    const view = renderPanel(v2Draft([signal()]), onSave)

    fireEvent.click(screen.getByRole('button', { name: 'Xoá' }))
    expect(screen.getByText('Check xác nhận 1 consumer bị ảnh hưởng.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Xoá khỏi Draft' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([{ op: 'removeSignal', signalId: SIGNAL_ID }]))
    expect(screen.getByRole('row', { name: /SupplyTemp/ })).toBeInTheDocument()
    expect(screen.getByText('Đang đọc lại bản nháp từ máy chủ…')).toBeInTheDocument()

    view.rerender(
      <I18nProvider>
        <PublishedSignalsPanel draft={v2Draft()} saving={false} onSave={onSave} />
      </I18nProvider>
    )
    expect(await screen.findByText('Máy chủ xác nhận đã xoá signal khỏi bản nháp.')).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /SupplyTemp/ })).not.toBeInTheDocument()
  })

  it('giữ form và báo lỗi khi server từ chối mutation', async () => {
    const onSave = vi.fn().mockResolvedValue(false)
    renderPanel(v2Draft(), onSave)
    fireEvent.click(screen.getByRole('button', { name: 'Khai Published Signal' }))
    const form = screen.getByRole('form', { name: 'Biểu mẫu Published Signal' })
    fireEvent.change(within(form).getByLabelText('Tên signal'), { target: { value: 'SupplyTemp' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Lưu Published Signal' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Máy chủ không nhận thay đổi Published Signal.')
    expect(screen.getByRole('form', { name: 'Biểu mẫu Published Signal' })).toBeInTheDocument()
    expect(screen.queryByText(/Máy chủ đã trả lại signal/)).not.toBeInTheDocument()
  })
})
