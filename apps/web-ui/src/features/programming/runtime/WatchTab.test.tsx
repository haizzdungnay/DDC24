import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import type { UserRole } from '../../../shared/types'
import { ProgrammingApiError } from '../api/generated/client'
import { classifyProgrammingMonitorFailure } from '../api/queries'
import type { ProgrammingRuntimeMonitorState } from '../api/queries'
import type { ProgrammingMonitorPage, ProgrammingMonitorSample, ProgrammingRuntimeSignalPage, ProgrammingTrace, RemoteState } from '../model/types'
import { WatchTab } from './WatchTab'

const state = vi.hoisted(() => ({
  role: 'admin' as UserRole,
  monitor: null as unknown,
  signals: null as unknown,
  request: vi.fn()
}))

vi.mock('../api/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/queries')>()
  return {
    ...actual,
    useProgrammingRuntimeMonitor: () => state.monitor,
    useProgrammingRuntimeSignals: () => state.signals
  }
})

vi.mock('../api/authClient', () => ({ useProgrammingApiClient: () => ({ request: state.request }) }))

vi.mock('../../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth')>()
  return {
    ...actual,
    useAuth: () => ({ session: { username: 'tester', role: state.role, loginAt: '2026-08-21T00:00:00Z' } })
  }
})

const ACTIVE_REVISION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function sample(overrides: Partial<ProgrammingMonitorSample> = {}): ProgrammingMonitorSample {
  return {
    variableId: '11111111-1111-4111-8111-111111111111',
    variableName: 'SupplySetpoint',
    programId: 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa',
    point: { category: 'LOCAL', pointId: 'AO-01' },
    direction: 'WRITE',
    dataType: 'REAL',
    unit: 'V',
    programValue: 41,
    actualValue: 62,
    overriddenBy: 'manual',
    effectivePriority: 2,
    overrideActor: 'operator-1',
    overrideRemainingS: 272,
    quality: 'GOOD',
    observedAt: '2026-08-21T01:02:03Z',
    freshness: 'LIVE',
    ...overrides
  }
}

function monitorPage(items: ProgrammingMonitorSample[], overrides: Partial<ProgrammingMonitorPage> = {}): ProgrammingMonitorPage {
  return {
    schemaVersion: '1.0',
    activeRevisionId: ACTIVE_REVISION_ID,
    safeState: false,
    task: {
      taskId: 'Control_Main', periodMs: 1000, budgetMs: 200, state: 'RUNNING',
      runCount: 20, missedReleaseCount: 0, lastExecNs: 1000, maxExecNs: 2000,
      overrunCount: 0, consecutiveOverruns: 0
    },
    items,
    ...overrides
  }
}

function ready(data: ProgrammingMonitorPage): ProgrammingRuntimeMonitorState {
  return { status: 'ready', data, error: null, failure: null, producerRestarted: false, refresh: vi.fn() }
}

function readySignals(data: ProgrammingRuntimeSignalPage): RemoteState<ProgrammingRuntimeSignalPage> {
  return { status: 'ready', data, error: null, refresh: vi.fn() }
}

function signalPage(overrides: Partial<ProgrammingRuntimeSignalPage> = {}): ProgrammingRuntimeSignalPage {
  return {
    schemaVersion: '1.0', producerState: 'READY', activeRevisionId: ACTIVE_REVISION_ID,
    observedAt: '2026-08-21T01:02:03Z', items: [], ...overrides
  }
}

function renderWatch() {
  return render(<I18nProvider><WatchTab /></I18nProvider>)
}

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'vi')
  state.role = 'admin'
  state.request.mockReset().mockRejectedValue(new Error('unexpected request'))
  state.monitor = ready(monitorPage([]))
  state.signals = readySignals(signalPage())
})

afterEach(cleanup)

describe('WatchTab — T59-504', () => {
  it('hiển thị đủ LOCAL/VP/MB_RTU và tách output candidate khỏi actual/source/priority', () => {
    state.monitor = ready(monitorPage([
      sample(),
      sample({
        variableId: '22222222-2222-4222-8222-222222222222', variableName: 'ZoneTemperature',
        programId: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb', point: { category: 'VP', pointId: 'AV-02' },
        direction: 'READ', unit: '°C', programValue: 21.5, actualValue: 21.5,
        overriddenBy: null, effectivePriority: null, overrideActor: null, overrideRemainingS: null,
        quality: 'UNCERTAIN'
      }),
      sample({
        variableId: '33333333-3333-4333-8333-333333333333', variableName: 'PumpEnable',
        programId: 'cccccccc-3333-4ccc-8ccc-cccccccccccc', point: { category: 'MB_RTU', deviceId: 'bus-1-slave-7', pointId: 'PUMP_CMD' },
        direction: 'READ_WRITE', dataType: 'BOOL', unit: undefined, programValue: true, actualValue: false,
        overriddenBy: null, effectivePriority: 5, overrideActor: null, overrideRemainingS: null,
        quality: 'STALE', freshness: 'STALE'
      })
    ]))

    renderWatch()

    expect(screen.getByRole('columnheader', { name: 'Đề xuất đầu ra (mức 5)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cục bộ (LOCAL) · 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Điểm ảo (VP) · 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Modbus RTU (MB_RTU) · 1' })).toBeInTheDocument()

    const local = screen.getByRole('row', { name: /SupplySetpoint/ })
    expect(within(local).getByText('41 V')).toBeInTheDocument()
    expect(within(local).getByText('62 V')).toBeInTheDocument()
    expect(within(local).getByText('manual · operator-1')).toBeInTheDocument()
    expect(within(local).getByText('Mức 2')).toBeInTheDocument()
    expect(within(local).getByTitle('aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa')).toHaveTextContent('Program aaaaaaaa…')

    const vp = screen.getByRole('row', { name: /ZoneTemperature/ })
    expect(within(vp).getByText('Không áp dụng')).toBeInTheDocument()
    expect(within(vp).getAllByText('21.5 °C')).toHaveLength(1)
    expect(within(vp).getByText('Point đầu vào · VP')).toBeInTheDocument()

    const rtu = screen.getByRole('row', { name: /PumpEnable/ })
    expect(within(rtu).getByText('bus-1-slave-7:PUMP_CMD')).toBeInTheDocument()
    expect(within(rtu).getByText('true')).toBeInTheDocument()
    expect(within(rtu).getByText('false')).toBeInTheDocument()
    expect(within(rtu).getByText('Program (logic cục bộ)')).toBeInTheDocument()
    expect(within(rtu).getByText('Mức 5')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Modbus RTU (MB_RTU) · 1' }))
    expect(screen.queryByRole('row', { name: /SupplySetpoint/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /ZoneTemperature/ })).not.toBeInTheDocument()
    expect(screen.getByRole('row', { name: /PumpEnable/ })).toBeInTheDocument()
  })

  it('không vẽ actual invalid thành 0 nhưng vẫn giữ số 0 stale có ngữ nghĩa', () => {
    state.monitor = ready(monitorPage([
      sample({
        variableName: 'OfflineOutput', programValue: null, actualValue: 0,
        overriddenBy: null, effectivePriority: null, overrideActor: null, overrideRemainingS: null,
        quality: 'OFFLINE', freshness: 'UNAVAILABLE'
      }),
      sample({
        variableId: '44444444-4444-4444-8444-444444444444', variableName: 'StaleOutput',
        point: { category: 'LOCAL', pointId: 'AO-02' }, programValue: 3, actualValue: 0,
        overriddenBy: null, effectivePriority: 5, overrideActor: null, overrideRemainingS: null,
        quality: 'STALE', freshness: 'STALE'
      })
    ]))

    renderWatch()

    const offline = screen.getByRole('row', { name: /OfflineOutput/ })
    expect(within(offline).queryByText('0 V')).not.toBeInTheDocument()
    expect(within(offline).getAllByLabelText('Không có dữ liệu').length).toBeGreaterThanOrEqual(3)
    expect(within(offline).getByText('OFFLINE')).toBeInTheDocument()
    expect(within(offline).getByText('UNAVAILABLE')).toBeInTheDocument()

    const stale = screen.getByRole('row', { name: /StaleOutput/ })
    expect(within(stale).getByText('0 V')).toBeInTheDocument()
    expect(within(stale).getAllByText('STALE')).toHaveLength(2)
  })

  it('phân biệt loading, permission, offline, error, không có Active và empty', () => {
    const refresh = vi.fn()
    state.monitor = { status: 'loading', data: null, error: null, failure: null, producerRestarted: false, refresh }
    const view = renderWatch()
    expect(screen.getByText('Đang tải monitor…')).toBeInTheDocument()

    state.monitor = { status: 'error', data: null, error: '403', failure: 'permission', refresh }
    view.rerender(<I18nProvider><WatchTab /></I18nProvider>)
    expect(screen.getByText('Bạn không có quyền xem monitor.')).toBeInTheDocument()

    state.monitor = { status: 'error', data: null, error: '503', failure: 'offline', producerRestarted: false, refresh }
    view.rerender(<I18nProvider><WatchTab /></I18nProvider>)
    expect(screen.getByText('Monitor đang ngoại tuyến.')).toBeInTheDocument()

    state.monitor = { status: 'error', data: null, error: 'payload malformed', failure: 'error', refresh }
    view.rerender(<I18nProvider><WatchTab /></I18nProvider>)
    expect(screen.getByText('Không đọc được monitor')).toBeInTheDocument()

    state.monitor = ready(monitorPage([], { activeRevisionId: null, task: null }))
    view.rerender(<I18nProvider><WatchTab /></I18nProvider>)
    expect(screen.getByText('Chưa có Revision đang chạy.')).toBeInTheDocument()
    expect(screen.getByText('Monitor không suy giá trị từ bản nháp.')).toBeInTheDocument()

    state.monitor = ready(monitorPage([]))
    view.rerender(<I18nProvider><WatchTab /></I18nProvider>)
    expect(screen.getByText('Revision đang chạy chưa có biến ánh xạ.')).toBeInTheDocument()
  })

  it('viewer chỉ đọc: thấy monitor nhưng không thể chọn biến hay khởi tạo trace', () => {
    state.role = 'viewer'
    state.monitor = ready(monitorPage([sample()]))
    renderWatch()

    expect(screen.getByText(/Bạn có quyền xem monitor; chỉ admin/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Trace SupplySetpoint' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Bắt đầu trace' })).not.toBeInTheDocument()
  })

  it('hiện số mẫu rơi và trace giữ null invalid là chưa có dữ liệu', async () => {
    state.monitor = ready(monitorPage([sample()]))
    const trace: ProgrammingTrace = {
      traceId: '99999999-9999-4999-8999-999999999999', state: 'COMPLETED',
      variableIds: ['11111111-1111-4111-8111-111111111111'], durationMs: 60_000,
      samplePeriodMs: 1_000, startedAt: '2026-08-21T01:02:03Z', updatedAt: '2026-08-21T01:02:04Z',
      stopReason: 'DURATION_REACHED', droppedSamples: 7,
      samples: [{ sequence: 1, observedAt: '2026-08-21T01:02:03Z', values: [{
        variableId: '11111111-1111-4111-8111-111111111111', programValue: 41,
        actualValue: null, overriddenBy: null, effectivePriority: 5, quality: 'OFFLINE', freshness: 'UNAVAILABLE'
      }] }]
    }
    state.request.mockImplementation((operationId: string) => {
      if (operationId === 'createProgrammingTrace') {
        return Promise.resolve({ traceId: trace.traceId, statusUrl: `/api/v1/programming/runtime/traces/${trace.traceId}`, state: 'RUNNING', requestHash: 'a'.repeat(64), acceptedAt: trace.startedAt, correlationId: 'correlation-id-0001' })
      }
      if (operationId === 'getProgrammingTrace') return Promise.resolve(trace)
      return Promise.reject(new Error(`unexpected ${operationId}`))
    })

    renderWatch()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Trace SupplySetpoint' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu trace' }))

    expect(await screen.findByText(/7 mẫu rơi/)).toBeInTheDocument()
    const matchingRows = screen.getAllByRole('row', { name: /SupplySetpoint/ })
    const traceRow = matchingRows[matchingRows.length - 1]
    expect(within(traceRow).getByText('41 V')).toBeInTheDocument()
    expect(within(traceRow).getByLabelText('Không có dữ liệu')).toBeInTheDocument()
    expect(within(traceRow).queryByText('0 V')).not.toBeInTheDocument()
    await waitFor(() => expect(state.request.mock.calls.filter(([operationId]) => operationId === 'createProgrammingTrace')).toHaveLength(1))
    const [, options] = state.request.mock.calls.find(([operationId]) => operationId === 'createProgrammingTrace')!
    expect(options.body.variableIds).toEqual(['11111111-1111-4111-8111-111111111111'])
  })

  /* `T59-810` — `SOURCE_UNAVAILABLE` gộp hai chuyện rất khác nhau: mất nguồn,
   * và nguồn ĐỔI THÀNH chương trình khác. Với phiên có pin, người đọc phải biết
   * vế thứ hai — nếu không họ sẽ đi tìm một sự cố kết nối không hề tồn tại. */
  it('phiên dừng vì tuple trôi nói rõ lý do, không chỉ SOURCE_UNAVAILABLE', async () => {
    state.monitor = ready(monitorPage([sample()]))
    const trace: ProgrammingTrace = {
      traceId: '99999999-9999-4999-8999-999999999998', state: 'FAILED',
      pin: { revisionId: '33333333-3333-4333-8333-333333333333', producer: { capturedMonotonicNs: '5000000000' } },
      variableIds: ['11111111-1111-4111-8111-111111111111'], durationMs: 60_000,
      samplePeriodMs: 1_000, startedAt: '2026-08-21T01:02:03Z', updatedAt: '2026-08-21T01:02:04Z',
      stopReason: 'SOURCE_UNAVAILABLE', droppedSamples: 0, samples: []
    }
    state.request.mockImplementation((operationId: string) => {
      if (operationId === 'createProgrammingTrace') {
        return Promise.resolve({ traceId: trace.traceId, statusUrl: `/api/v1/programming/runtime/traces/${trace.traceId}`, state: 'RUNNING', requestHash: 'a'.repeat(64), acceptedAt: trace.startedAt, correlationId: 'correlation-id-0002' })
      }
      if (operationId === 'getProgrammingTrace') return Promise.resolve(trace)
      return Promise.reject(new Error(`unexpected ${operationId}`))
    })

    renderWatch()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Trace SupplySetpoint' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu trace' }))

    expect(await screen.findByText(/rời khỏi tuple đã neo/)).toBeInTheDocument()
    expect(screen.getByText(/33333333-3333-4333-8333-333333333333/)).toBeInTheDocument()
  })

  it('Published Signal dùng snapshot riêng và fail-closed khi invalid/mismatch', () => {
    state.signals = readySignals(signalPage({
      items: [
        {
          signalId: '55555555-5555-4555-8555-555555555555', name: 'ValidZero',
          producerProgramId: 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa', dataType: 'REAL', unit: '%',
          value: 0, valid: true, quality: 'GOOD', freshness: 'FRESH', stalePolicy: 'HOLD_LAST',
          freshnessMs: 5000, publishedAtMonoNs: '1844674407370955161', generation: '7', definitionState: 'MATCHED'
        },
        {
          signalId: '66666666-6666-4666-8666-666666666666', name: 'InvalidMustNotBecomeZero',
          producerProgramId: 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb', dataType: 'REAL', unit: '°C',
          // Payload cố ý vi phạm cặp valid/value để chứng minh UI vẫn fail-closed.
          value: 0, valid: false, quality: 'BAD', freshness: 'UNAVAILABLE', stalePolicy: 'WAIT',
          freshnessMs: 1000, publishedAtMonoNs: '0', generation: '0', definitionState: 'MATCHED'
        },
        {
          signalId: null, name: 'CoreOnly', producerProgramId: 'core-program', dataType: 'BOOL', unit: null,
          value: true, valid: true, quality: 'GOOD', freshness: 'STALE_HELD', stalePolicy: 'SAFE_STATE',
          freshnessMs: 90000, publishedAtMonoNs: '123', generation: '2', definitionState: 'CORE_ONLY'
        }
      ]
    }))

    renderWatch()

    const valid = screen.getByRole('row', { name: /ValidZero/ })
    expect(within(valid).getByText('0 %')).toBeInTheDocument()
    expect(within(valid).getByText('FRESH')).toBeInTheDocument()
    expect(within(valid).getByText('MATCHED')).toBeInTheDocument()
    expect(valid).toHaveTextContent('generation 7')

    const invalid = screen.getByRole('row', { name: /InvalidMustNotBecomeZero/ })
    expect(within(invalid).queryByText('0 °C')).not.toBeInTheDocument()
    expect(within(invalid).getByLabelText('Không có dữ liệu')).toBeInTheDocument()
    expect(within(invalid).getByText('INVALID')).toBeInTheDocument()

    const coreOnly = screen.getByRole('row', { name: /CoreOnly/ })
    expect(within(coreOnly).queryByText('true')).not.toBeInTheDocument()
    expect(within(coreOnly).getByLabelText('Không có dữ liệu')).toBeInTheDocument()
    expect(within(coreOnly).getByText('CORE_ONLY')).toBeInTheDocument()
    expect(within(coreOnly).getByText('Không có ID trong Revision')).toBeInTheDocument()
  })

  it('Published Signal phân biệt loading, error, producer offline, không Active và empty', () => {
    const refresh = vi.fn()
    state.signals = { status: 'loading', data: null, error: null, refresh }
    const view = renderWatch()
    expect(screen.getByText('Đang tải Published Signal…')).toBeInTheDocument()

    state.signals = { status: 'error', data: null, error: '403', refresh }
    view.rerender(<I18nProvider><WatchTab /></I18nProvider>)
    expect(screen.getByText('Không đọc được Published Signal.')).toBeInTheDocument()

    state.signals = readySignals(signalPage({ producerState: 'UNAVAILABLE' }))
    view.rerender(<I18nProvider><WatchTab /></I18nProvider>)
    expect(screen.getByText('Nguồn Published Signal đang ngoại tuyến.')).toBeInTheDocument()

    state.signals = readySignals(signalPage({ activeRevisionId: null }))
    view.rerender(<I18nProvider><WatchTab /></I18nProvider>)
    expect(screen.getByText('Chưa có Revision đang chạy để công bố signal.')).toBeInTheDocument()

    state.signals = readySignals(signalPage())
    view.rerender(<I18nProvider><WatchTab /></I18nProvider>)
    expect(screen.getByText('Revision đang chạy chưa khai báo Published Signal.')).toBeInTheDocument()
  })
})

describe('classifyProgrammingMonitorFailure', () => {
  const envelope = {
    error: {
      code: 'PRG-ERR-UNAVAILABLE-001' as const,
      messageKey: 'programming.error.unavailable', retryable: true,
      keepsRunningRevision: false, correlationId: 'correlation-id-0001'
    }
  }

  it('phân loại bằng status/transport, không parse message', () => {
    expect(classifyProgrammingMonitorFailure(new ProgrammingApiError(403, envelope))).toBe('permission')
    expect(classifyProgrammingMonitorFailure(new ProgrammingApiError(503, envelope))).toBe('offline')
    expect(classifyProgrammingMonitorFailure(new TypeError('Failed to fetch'))).toBe('offline')
    expect(classifyProgrammingMonitorFailure(new Error('503 in text only'))).toBe('error')
  })
})
