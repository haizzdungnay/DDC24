import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '../../../shared/i18n'
import { SimulateWorkspace } from './SimulateWorkspace'
import {
  acceptDenial,
  acceptFrame,
  acceptSession,
  initialSimulationSlice,
  type SimulationInputDescriptor,
  type SimulationSessionView,
  type SimulationSlice,
} from './simulationSession'
import type { ProgrammingBinding, ProgrammingPointCatalogEntry, ProgrammingSimulationCapability } from '../model/types'

const REVISION = '33333333-3333-4333-8333-333333333333'
const OBJECT = '44444444-4444-4444-8444-444444444444'
const SEALED_SOURCE = 'PROGRAM AHU_SEALED\nEND_PROGRAM\n'

const state = vi.hoisted(() => ({ revision: null as unknown }))

vi.mock('../api/queries', () => ({
  useProgrammingRevision: () => state.revision,
  useLazyProgrammingPointCatalog: () => ({
    status: 'idle',
    data: null,
    error: null,
    ensureLoaded: vi.fn(),
  }),
}))

function sealedRevision() {
  return {
    status: 'ready',
    data: {
      revisionId: REVISION,
      snapshot: {
        objects: [{ objectId: OBJECT, kind: 'PROGRAM', payload: { language: 'ST', source: SEALED_SOURCE } }],
      },
    },
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
      maxConcurrentSessionsPerController: 1, idleTtlSeconds: 900, hardTtlSeconds: 3600,
      maxRssMiB: 64, maxCpuPercentOneCore: 25, maxActionsPerSecond: 10,
      maxTraceSamples: 10000, maxVirtualInputs: 256, workerCommandTimeoutMs: 2000,
    },
    ...overrides,
  }
}

function session(overrides: Partial<SimulationSessionView> = {}): SimulationSessionView {
  return {
    sessionId: 'sess-1', controllerId: 'ddc-01', projectId: 'p1',
    sourceDraftRevisionId: REVISION, sourceContentSha256: 'b'.repeat(64),
    state: 'PAUSED', sessionSequence: '1', etag: '"sess-1:1"', baseTickMs: 1000,
    virtualTimeMs: '0', speed: 1, observationSequence: '0', resetEpoch: '0',
    createdAt: '2026-08-27T00:00:00Z', lastActivityAt: '2026-08-27T00:00:00Z',
    idleExpiresAt: '2026-08-27T00:15:00Z', hardExpiresAt: '2026-08-27T01:00:00Z',
    failureCode: null, workerVersion: '1.0.0',
    ...overrides,
  }
}

const INPUT: SimulationInputDescriptor = {
  observationId: 'AHU.Setpoint', programId: 'AHU', variable: 'Setpoint',
  sourceKind: 'VAR_INPUT', dataType: 'REAL', unit: '°C', min: 0, max: 100,
  simulationWritable: true,
}

function renderWorkspace(overrides: {
  capability?: ProgrammingSimulationCapability | null
  role?: string
  slice?: SimulationSlice
  inputs?: SimulationInputDescriptor[]
  bindings?: readonly ProgrammingBinding[]
  pointCatalogItems?: readonly ProgrammingPointCatalogEntry[]
  draftDirty?: boolean
  draftRevisionId?: string | null
  onStart?: () => void
  onAction?: (action: never, speed?: number) => void
  onSetInput?: () => void
  onStop?: () => void
  onRequestCheck?: () => void
} = {}) {
  const props = {
    capability: overrides.capability === undefined ? capability() : overrides.capability,
    role: overrides.role ?? 'admin',
    slice: overrides.slice ?? initialSimulationSlice,
    inputs: overrides.inputs ?? [],
    bindings: overrides.bindings,
    pointCatalogItems: overrides.pointCatalogItems,
    objectId: OBJECT,
    draftDirty: overrides.draftDirty ?? false,
    draftRevisionId: overrides.draftRevisionId === undefined ? REVISION : overrides.draftRevisionId,
    onStart: overrides.onStart ?? vi.fn(),
    onAction: (overrides.onAction ?? vi.fn()) as never,
    onSetInput: overrides.onSetInput ?? vi.fn(),
    onStop: overrides.onStop ?? vi.fn(),
    onRequestCheck: overrides.onRequestCheck,
  }
  return render(
    <I18nProvider>
      <SimulateWorkspace {...props} />
    </I18nProvider>,
  )
}

beforeEach(() => {
  // Test đọc chữ tiếng Việt, nên chốt ngôn ngữ thay vì phụ thuộc mặc định.
  localStorage.setItem('mkddc-lang', 'vi')
  state.revision = sealedRevision()
})
afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('SIMULATE — capability là điều kiện tiên quyết', () => {
  it('AC-PGM02-008: thiết bị không công bố khả năng ⇒ không mở phiên và KHÔNG hiện giá trị mẫu nào', () => {
    renderWorkspace({ capability: capability({ supported: false }) })
    expect(screen.getByText(/chưa công bố khả năng Mô phỏng/)).toBeInTheDocument()
    // Không có nút mở phiên, và tuyệt đối không có băng giá trị nào.
    expect(screen.queryByRole('button', { name: /Mở phiên mô phỏng/ })).toBeNull()
    expect(screen.queryByLabelText(/Lớp giá trị mô phỏng/)).toBeNull()
    expect(screen.queryByText(/MÔ PHỎNG/)).toBeNull()
  })

  it('AC-PGM02-008: server đời cũ không khai workspaceModes ⇒ cũng là không khả dụng', () => {
    renderWorkspace({ capability: null })
    expect(screen.getByText(/chưa công bố khả năng Mô phỏng/)).toBeInTheDocument()
  })
})

describe('SIMULATE — bản nháp bẩn không bao giờ được mô phỏng', () => {
  it('AC-ST-006 / AC-FBD-008: còn thay đổi chưa lưu ⇒ yêu cầu Lưu và KHÔNG có nút mở phiên', () => {
    const onStart = vi.fn()
    renderWorkspace({ draftDirty: true, onStart })
    expect(screen.getByRole('alert')).toHaveTextContent(/Hãy Lưu \(và chạy Kiểm tra\) trước khi mô phỏng/)
    expect(screen.queryByRole('button', { name: /Mở phiên mô phỏng/ })).toBeNull()
    expect(onStart).not.toHaveBeenCalled()
  })

  it('chưa có Revision nào Kiểm tra đạt ⇒ nút mở phiên bị khoá', () => {
    renderWorkspace({ draftRevisionId: null })
    expect(screen.getByRole('button', { name: /Mở phiên mô phỏng/ })).toBeDisabled()
    // Không có đường chạy Kiểm tra (không quyền / bản nháp bẩn) ⇒ không bày nút.
    expect(screen.queryByRole('button', { name: 'Kiểm tra ngay' })).toBeNull()
  })

  it('chưa có Check PASSED ⇒ đưa đường chạy Kiểm tra ngay tại chỗ, không bắt tự đi tìm', () => {
    const onRequestCheck = vi.fn()
    renderWorkspace({ draftRevisionId: null, onRequestCheck })
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra ngay' }))
    expect(onRequestCheck).toHaveBeenCalledTimes(1)
  })

  it('đã có Check PASSED ⇒ không còn nút Kiểm tra ngay', () => {
    renderWorkspace({ onRequestCheck: vi.fn() })
    expect(screen.queryByRole('button', { name: 'Kiểm tra ngay' })).toBeNull()
  })
})

describe('SIMULATE — quyền đọc từ server, không từ nhãn vai', () => {
  it('AC-PGM02-005: viewer thấy đủ phiên nhưng không có đường điều khiển nào', () => {
    const slice = acceptSession(initialSimulationSlice, session({ state: 'RUNNING' }))
    renderWorkspace({ role: 'viewer', slice, inputs: [INPUT] })

    // Vế phải giữ: viewer ĐỌC được. Chặn ghi mà làm mù luôn thì người trực ca
    // không xem được thứ đang chạy.
    expect(screen.getByTestId('simulation-state')).toHaveTextContent('Đang chạy')
    expect(screen.getByLabelText(/Mã nguồn đang mô phỏng/)).toHaveValue(SEALED_SOURCE)
    expect(screen.getByText(/không điều khiển được/)).toBeInTheDocument()

    for (const label of ['Chạy', 'Tạm dừng', 'Một nhịp', 'Đặt lại', 'Dừng phiên']) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled()
    }
    // Ô nhập ngõ vào ảo cũng phải khoá — bàn phím không được là đường vòng.
    expect(screen.getByLabelText(/Giá trị ảo của AHU.Setpoint/)).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Ghi' })).toBeDisabled()
  })

  it('nút KHÔNG bị ẩn với vai thiếu quyền — ẩn đi là nói dối về thiết bị', () => {
    const slice = acceptSession(initialSimulationSlice, session())
    renderWorkspace({ role: 'operator', slice })
    expect(screen.getByRole('button', { name: 'Chạy' })).toBeInTheDocument()
  })
})

describe('SIMULATE — trạng thái chỉ đến từ read-back', () => {
  it('tập nút hoạt động theo đúng trạng thái server trả về', () => {
    const paused = acceptSession(initialSimulationSlice, session({ state: 'PAUSED' }))
    const { unmount } = renderWorkspace({ slice: paused })
    expect(screen.getByRole('button', { name: 'Chạy' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Tạm dừng' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Một nhịp' })).toBeEnabled()
    unmount()

    const running = acceptSession(initialSimulationSlice, session({ state: 'RUNNING', sessionSequence: '2' }))
    renderWorkspace({ slice: running })
    // Đang chạy thì không Step/Reset: hai lệnh đó chỉ có nghĩa ở ranh giới an toàn.
    expect(screen.getByRole('button', { name: 'Chạy' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Tạm dừng' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Một nhịp' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Đặt lại' })).toBeDisabled()
  })

  it('phiên terminal không nhận lệnh nào nữa', () => {
    const failed = acceptSession(initialSimulationSlice, session({ state: 'FAILED', failureCode: 'SIM-SUP-CRASH' }))
    renderWorkspace({ slice: failed })
    expect(screen.getByTestId('simulation-state')).toHaveTextContent('Hỏng')
    for (const label of ['Chạy', 'Tạm dừng', 'Một nhịp', 'Đặt lại', 'Dừng phiên']) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled()
    }
  })

  it('lệnh bị từ chối giữ nguyên trạng thái phiên và nêu lý do', () => {
    let slice = acceptSession(initialSimulationSlice, session({ state: 'RUNNING' }))
    slice = acceptDenial(slice, { code: 'PRG-SIM-INPUT-NOT-ALLOWED', message: 'Biến này không ghi được.' })
    renderWorkspace({ slice })
    expect(screen.getByTestId('simulation-state')).toHaveTextContent('Đang chạy')
    expect(screen.getByRole('alert')).toHaveTextContent('Biến này không ghi được.')
  })
})

describe('SIMULATE — giá trị luôn nói rõ nguồn và chất lượng', () => {
  it('AC-PGM02-008: chưa có nhịp nào ⇒ nói "chưa có", không hiện số 0', () => {
    const slice = acceptSession(initialSimulationSlice, session())
    renderWorkspace({ slice, inputs: [INPUT] })
    expect(screen.getByText(/Chưa có nhịp nào chạy/)).toBeInTheDocument()
    // Ngõ vào chưa có mẫu hiện gạch ngang, KHÔNG phải 0.
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('mỗi giá trị mang nhãn nguồn MÔ PHỎNG và chất lượng của nó', () => {
    let slice = acceptSession(initialSimulationSlice, session())
    slice = acceptFrame(slice, {
      virtualTimeMs: 2000, snapshotSequence: 2, resetEpoch: 0,
      observations: [
        { observationId: 'Fan', programId: 'AHU', variable: 'Fan', kind: 'OUTPUT', dataType: 'BOOL', quality: 'GOOD', value: true },
        { observationId: 'Temp', programId: 'AHU', variable: 'Temp', kind: 'OUTPUT', dataType: 'REAL', quality: 'UNAVAILABLE', value: 0 },
      ],
    })
    renderWorkspace({ slice })

    expect(screen.getByText('Fan')).toBeInTheDocument()
    expect(screen.getByText('TRUE')).toBeInTheDocument()
    // `UNAVAILABLE` giữ ô trống chứ không hoá 0 — trộn hai thứ đó là kiểu sai
    // nguy hiểm nhất ở màn hình này.
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getAllByText('MÔ PHỎNG')).toHaveLength(2)
  })

  it('hỗ trợ tìm kiếm và lọc biến quan sát trong chế độ mô phỏng', () => {
    let slice = acceptSession(initialSimulationSlice, session())
    slice = acceptFrame(slice, {
      virtualTimeMs: 2000, snapshotSequence: 2, resetEpoch: 0,
      observations: [
        { observationId: 'Fan', programId: 'AHU', variable: 'Fan', kind: 'OUTPUT', dataType: 'BOOL', quality: 'GOOD', value: true },
        { observationId: 'Temp', programId: 'AHU', variable: 'Temp', kind: 'OUTPUT', dataType: 'REAL', quality: 'GOOD', value: 24.5 },
      ],
    })
    renderWorkspace({ slice })

    expect(screen.getByText('Fan')).toBeInTheDocument()
    expect(screen.getByText('Temp')).toBeInTheDocument()

    const searchInput = screen.getByPlaceholderText('Tìm biến…')
    fireEvent.change(searchInput, { target: { value: 'Fan' } })

    expect(screen.getByText('Fan')).toBeInTheDocument()
    expect(screen.queryByText('Temp')).not.toBeInTheDocument()
  })

  it('băng "KHÔNG CÓ NGÕ RA THẬT" hiện ở mọi trạng thái', () => {
    const slice = acceptSession(initialSimulationSlice, session({ state: 'STOPPED' }))
    renderWorkspace({ slice })
    expect(screen.getByRole('note')).toHaveTextContent(/KHÔNG CÓ NGÕ RA THẬT/)
  })
})

describe('SIMULATE — ngõ vào ảo', () => {
  it('giá trị ngoài miền không gửi được và nói rõ lý do', () => {
    const onSetInput = vi.fn()
    const slice = acceptSession(initialSimulationSlice, session())
    renderWorkspace({ slice, inputs: [INPUT], onSetInput })

    const field = screen.getByLabelText(/Giá trị ảo của AHU.Setpoint/)
    fireEvent.change(field, { target: { value: '150' } })
    expect(screen.getByText(/ngoài miền cho phép/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ghi' })).toBeDisabled()

    fireEvent.change(field, { target: { value: '21.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ghi' }))
    expect(onSetInput).toHaveBeenCalledWith(INPUT, '21.5')
  })

  it('gói không khai ngõ vào ghi được ⇒ nói ra, không hiện khay rỗng khó hiểu', () => {
    const slice = acceptSession(initialSimulationSlice, session())
    renderWorkspace({ slice, inputs: [] })
    expect(screen.getByText(/không khai ngõ vào nào ghi được/)).toBeInTheDocument()
  })

  it('hiển thị đúng tên điểm thay vì chuỗi mã UUID và có thanh cuộn overflow-y-auto trên aside', () => {
    const slice = acceptSession(initialSimulationSlice, session({ state: 'RUNNING' }))
    const uuidInput: SimulationInputDescriptor = {
      observationId: 'a153aa91-f0e9-4b60-8741-3cadcfb7f579.CmdMode',
      programId: 'a153aa91-f0e9-4b60-8741-3cadcfb7f579',
      variable: 'CmdMode',
      sourceKind: 'READ_BINDING',
      dataType: 'UINT',
      unit: null,
      min: null,
      max: null,
      simulationWritable: true,
    }
    const binding: ProgrammingBinding = {
      bindingId: 'b-1',
      programId: 'a153aa91-f0e9-4b60-8741-3cadcfb7f579',
      variableId: 'v-1',
      variable: 'CmdMode',
      direction: 'READ',
      dataType: 'UINT',
      point: { category: 'VP', pointId: 'MSV-01' },
      qualityPolicy: 'REQUIRE_GOOD',
      writable: true,
    }
    const catalogItem: ProgrammingPointCatalogEntry = {
      category: 'VP',
      pointId: 'MSV-01',
      name: 'DO16_MODE',
      dataType: 'UINT',
      direction: 'READ',
      writable: true,
      quality: 'GOOD',
      value: 0,
    }

    const { container } = renderWorkspace({
      slice,
      inputs: [uuidInput],
      bindings: [binding],
      pointCatalogItems: [catalogItem],
    })

    // Hiển thị tên điểm DO16_MODE thay vì chuỗi mã UUID
    expect(screen.getByText('DO16_MODE')).toBeInTheDocument()
    expect(screen.getByText('(CmdMode · MSV-01)')).toBeInTheDocument()
    expect(screen.queryByText('a153aa91-f0e9-4b60-8741-3cadcfb7f579.CmdMode')).not.toBeInTheDocument()

    // Aside có class overflow-y-auto và max-h
    const aside = container.querySelector('aside')
    expect(aside).toHaveClass('overflow-y-auto')
  })
})
