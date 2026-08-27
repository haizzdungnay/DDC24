import { describe, expect, it } from 'vitest'
import {
  acceptDenial,
  acceptFrame,
  acceptSession,
  acceptsCommands,
  allowedActions,
  canControlSimulation,
  compareSequence,
  currentSession,
  encodeSimulationInput,
  initialSimulationSlice,
  isSimulationSupported,
  isTerminalState,
  simulationValuesByObservation,
  validateSimulationInput,
  type SimulationFrame,
  type SimulationInputDescriptor,
  type SimulationSessionView,
} from './simulationSession'
import type { ProgrammingSimulationCapability } from '../model/types'

function session(overrides: Partial<SimulationSessionView> = {}): SimulationSessionView {
  return {
    sessionId: 's1',
    controllerId: 'ddc-01',
    projectId: 'p1',
    sourceDraftRevisionId: 'r1',
    sourceContentSha256: 'a'.repeat(64),
    state: 'PAUSED',
    sessionSequence: '1',
    etag: '"s1:1"',
    baseTickMs: 1000,
    virtualTimeMs: '0',
    speed: 1,
    observationSequence: '0',
    resetEpoch: '0',
    createdAt: '2026-08-27T00:00:00Z',
    lastActivityAt: '2026-08-27T00:00:00Z',
    idleExpiresAt: '2026-08-27T00:15:00Z',
    hardExpiresAt: '2026-08-27T01:00:00Z',
    failureCode: null,
    workerVersion: '1.0.0',
    ...overrides,
  }
}

function frame(overrides: Partial<SimulationFrame> = {}): SimulationFrame {
  return {
    virtualTimeMs: 1000,
    snapshotSequence: 1,
    resetEpoch: 0,
    observations: [],
    ...overrides,
  }
}

function capability(
  overrides: Partial<ProgrammingSimulationCapability> = {},
): ProgrammingSimulationCapability {
  return {
    supported: true,
    workerVersion: '1.0.0',
    mutationRoles: ['admin'],
    limits: {
      maxConcurrentSessionsPerController: 1,
      idleTtlSeconds: 900,
      hardTtlSeconds: 3600,
      maxRssMiB: 64,
      maxCpuPercentOneCore: 25,
      maxActionsPerSecond: 10,
      maxTraceSamples: 10000,
      maxVirtualInputs: 256,
      workerCommandTimeoutMs: 2000,
    },
    ...overrides,
  }
}

describe('capability là nguồn quyền, không phải nhãn vai', () => {
  it('thiếu bất kỳ mảnh nào của hợp đồng đều là KHÔNG hỗ trợ', () => {
    expect(isSimulationSupported(capability())).toBe(true)
    expect(isSimulationSupported(capability({ supported: false }))).toBe(false)
    expect(isSimulationSupported(capability({ mutationRoles: [] }))).toBe(false)
    expect(isSimulationSupported(undefined)).toBe(false)
    expect(isSimulationSupported(null)).toBe(false)
    // Thiếu `limits`: FE không được suy trần từ hằng của chính nó.
    expect(isSimulationSupported({ ...capability(), limits: undefined as never })).toBe(false)
  })

  it('quyền điều khiển đọc từ mutationRoles server công bố', () => {
    expect(canControlSimulation(capability(), 'admin')).toBe(true)
    expect(canControlSimulation(capability(), 'ADMIN')).toBe(true)
    expect(canControlSimulation(capability(), 'operator')).toBe(false)
    expect(canControlSimulation(capability(), 'viewer')).toBe(false)
    expect(canControlSimulation(capability(), undefined)).toBe(false)
    // Server mở cho operator ⇒ FE theo server, không giữ bảng quyền riêng.
    expect(canControlSimulation(capability({ mutationRoles: ['operator', 'admin'] }), 'operator')).toBe(true)
    // Nhưng capability tắt thì không vai nào điều khiển được.
    expect(canControlSimulation(capability({ supported: false }), 'admin')).toBe(false)
  })
})

describe('trạng thái phiên', () => {
  it('PREPARING chưa nhận lệnh; terminal thì không bao giờ nhận nữa', () => {
    expect(acceptsCommands(session({ state: 'PREPARING' }))).toBe(false)
    expect(acceptsCommands(session({ state: 'PAUSED' }))).toBe(true)
    expect(acceptsCommands(session({ state: 'RUNNING' }))).toBe(true)
    for (const state of ['COMPLETED', 'FAILED', 'EXPIRED', 'STOPPED'] as const) {
      expect(isTerminalState(state)).toBe(true)
      expect(acceptsCommands(session({ state }))).toBe(false)
    }
    expect(acceptsCommands(null)).toBe(false)
  })

  it('tập hành động hợp lệ là MỘT câu trả lời dùng chung cho nút và bàn phím', () => {
    expect(allowedActions(session({ state: 'PAUSED' }))).toEqual(['RUN', 'STEP_CYCLE', 'RESET', 'SET_SPEED'])
    // Đang chạy thì không Step/Reset: hai lệnh đó chỉ có nghĩa ở ranh giới an toàn.
    expect(allowedActions(session({ state: 'RUNNING' }))).toEqual(['PAUSE', 'SET_SPEED'])
    expect(allowedActions(session({ state: 'FAILED' }))).toEqual([])
    expect(allowedActions(null)).toEqual([])
  })
})

describe('read-back là nguồn trạng thái duy nhất', () => {
  it('nhận phiên mới và xoá cờ pending', () => {
    const slice = acceptSession({ ...initialSimulationSlice, pending: 'RUN' }, session({ state: 'RUNNING' }))
    expect(slice.status).toEqual({ kind: 'ACTIVE', session: session({ state: 'RUNNING' }) })
    expect(slice.pending).toBeNull()
  })

  it('bỏ phản hồi của phiên KHÁC — không cho một phiên cũ kéo giao diện về', () => {
    const base = acceptSession(initialSimulationSlice, session())
    const other = acceptSession(base, session({ sessionId: 's2', sessionSequence: '9' }))
    expect(currentSession(other)?.sessionId).toBe('s1')
  })

  it('bỏ read-back có sequence CŨ hơn thứ đang giữ', () => {
    const base = acceptSession(initialSimulationSlice, session({ sessionSequence: '5' }))
    const stale = acceptSession(base, session({ sessionSequence: '4', state: 'RUNNING' }))
    expect(currentSession(stale)?.sessionSequence).toBe('5')
    expect(currentSession(stale)?.state).toBe('PAUSED')
  })

  it('so sánh sequence theo CHUỖI — uint64 vượt 2^53 vẫn đúng thứ tự', () => {
    expect(compareSequence('9007199254740993', '9007199254740992')).toBeGreaterThan(0)
    expect(compareSequence('10', '9')).toBeGreaterThan(0)
    expect(compareSequence('007', '7')).toBe(0)
    expect(compareSequence('3', '3')).toBe(0)
  })

  it('reset xoá frame của epoch cũ', () => {
    let slice = acceptSession(initialSimulationSlice, session())
    slice = acceptFrame(slice, frame({ snapshotSequence: 5 }))
    expect(slice.frame?.snapshotSequence).toBe(5)
    slice = acceptSession(slice, session({ sessionSequence: '2', resetEpoch: '1', virtualTimeMs: '0' }))
    expect(slice.frame).toBeNull()
  })
})

describe('frame quan sát', () => {
  it('bỏ mẫu lùi và mẫu thuộc epoch khác', () => {
    let slice = acceptSession(initialSimulationSlice, session())
    slice = acceptFrame(slice, frame({ snapshotSequence: 3 }))
    slice = acceptFrame(slice, frame({ snapshotSequence: 2 }))
    expect(slice.frame?.snapshotSequence).toBe(3)
    // Mẫu của epoch 1 trong khi phiên đang ở epoch 0: hình dạng hợp lệ nhưng
    // nói về một dòng thời gian khác.
    slice = acceptFrame(slice, frame({ snapshotSequence: 9, resetEpoch: 1 }))
    expect(slice.frame?.snapshotSequence).toBe(3)
  })

  it('UNAVAILABLE giữ ô trống, KHÔNG hoá 0', () => {
    const values = simulationValuesByObservation(frame({
      observations: [
        { observationId: 'Fast.Out', programId: 'Fast', variable: 'Out', kind: 'OUTPUT', dataType: 'REAL', quality: 'UNAVAILABLE', value: 0 },
        { observationId: 'Fast.In', programId: 'Fast', variable: 'In', kind: 'INPUT', dataType: 'REAL', quality: 'GOOD', value: 4.5 },
      ],
    }))
    expect(values['Fast.Out'].value).toBeNull()
    expect(values['Fast.Out'].quality).toBe('UNAVAILABLE')
    expect(values['Fast.In'].value).toBe(4.5)
    // Nguồn nằm trong KIỂU: không có đường nào giá trị này đi vào chỗ đọc Active.
    expect(values['Fast.In'].source).toBe('SIMULATION')
  })

  it('không có frame thì không có giá trị nào — không bịa ô rỗng', () => {
    expect(simulationValuesByObservation(null)).toEqual({})
  })
})

describe('lệnh bị từ chối', () => {
  it('giữ NGUYÊN trạng thái phiên và nêu lý do', () => {
    const base = acceptSession({ ...initialSimulationSlice, pending: 'SET_INPUT' }, session({ state: 'RUNNING' }))
    const denied = acceptDenial(base, { code: 'PRG-SIM-INPUT-NOT-ALLOWED', message: 'không ghi được' })
    expect(currentSession(denied)?.state).toBe('RUNNING')
    expect(denied.pending).toBeNull()
    expect(denied.lastDenial?.code).toBe('PRG-SIM-INPUT-NOT-ALLOWED')
  })
})

describe('validate virtual input', () => {
  const descriptor: SimulationInputDescriptor = {
    observationId: 'Fast.Setpoint', programId: 'Fast', variable: 'Setpoint',
    sourceKind: 'VAR_INPUT', dataType: 'REAL', unit: '°C', min: 0, max: 100,
    simulationWritable: true,
  }

  it('chặn biến không nằm trong allowlist', () => {
    expect(validateSimulationInput(undefined, '1').reason).toBe('NOT_WRITABLE')
    expect(validateSimulationInput({ ...descriptor, simulationWritable: false }, '1').reason).toBe('NOT_WRITABLE')
  })

  it('chặn rỗng, NaN/Inf và ngoài miền', () => {
    expect(validateSimulationInput(descriptor, '  ').reason).toBe('EMPTY')
    expect(validateSimulationInput(descriptor, 'abc').reason).toBe('NOT_FINITE')
    expect(validateSimulationInput(descriptor, 'Infinity').reason).toBe('NOT_FINITE')
    expect(validateSimulationInput(descriptor, '-1').reason).toBe('RANGE')
    expect(validateSimulationInput(descriptor, '101').reason).toBe('RANGE')
    expect(validateSimulationInput(descriptor, '21.5').ok).toBe(true)
  })

  it('kiểu nguyên không nhận phần thập phân', () => {
    const integer = { ...descriptor, dataType: 'DINT' as const, min: null, max: null }
    expect(validateSimulationInput(integer, '3').ok).toBe(true)
    expect(validateSimulationInput(integer, '3.5').reason).toBe('TYPE')
  })

  it('BOOL chỉ nhận TRUE/FALSE/0/1 và mã hoá đúng', () => {
    const bool = { ...descriptor, dataType: 'BOOL' as const, min: null, max: null }
    expect(validateSimulationInput(bool, 'TRUE').ok).toBe(true)
    expect(validateSimulationInput(bool, 'false').ok).toBe(true)
    expect(validateSimulationInput(bool, '1').ok).toBe(true)
    expect(validateSimulationInput(bool, 'yes').reason).toBe('TYPE')
    expect(encodeSimulationInput(bool, 'TRUE')).toBe(true)
    expect(encodeSimulationInput(bool, '0')).toBe(false)
    expect(encodeSimulationInput(descriptor, '21.5')).toBe(21.5)
  })
})
