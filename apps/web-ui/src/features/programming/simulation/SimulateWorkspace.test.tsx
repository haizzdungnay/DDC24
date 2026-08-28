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
import type { ProgrammingSimulationCapability } from '../model/types'

const REVISION = '33333333-3333-4333-8333-333333333333'
const OBJECT = '44444444-4444-4444-8444-444444444444'
const SEALED_SOURCE = 'PROGRAM AHU_SEALED\nEND_PROGRAM\n'

const state = vi.hoisted(() => ({ revision: null as unknown }))

vi.mock('../api/queries', () => ({
  useProgrammingRevision: () => state.revision,
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
  draftDirty?: boolean
  draftRevisionId?: string | null
  onStart?: () => void
  onAction?: (action: never, speed?: number) => void
  onSetInput?: () => void
  onStop?: () => void
} = {}) {
  const props = {
    capability: overrides.capability === undefined ? capability() : overrides.capability,
    role: overrides.role ?? 'admin',
    slice: overrides.slice ?? initialSimulationSlice,
    inputs: overrides.inputs ?? [],
    objectId: OBJECT,
    draftDirty: overrides.draftDirty ?? false,
    draftRevisionId: overrides.draftRevisionId === undefined ? REVISION : overrides.draftRevisionId,
    onStart: overrides.onStart ?? vi.fn(),
    onAction: (overrides.onAction ?? vi.fn()) as never,
    onSetInput: overrides.onSetInput ?? vi.fn(),
    onStop: overrides.onStop ?? vi.fn(),
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
afterEach(cleanup)

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
        { observationId: 'AHU.Fan', programId: 'AHU', variable: 'Fan', kind: 'OUTPUT', dataType: 'BOOL', quality: 'GOOD', value: true },
        { observationId: 'AHU.Temp', programId: 'AHU', variable: 'Temp', kind: 'OUTPUT', dataType: 'REAL', quality: 'UNAVAILABLE', value: 0 },
      ],
    })
    renderWorkspace({ slice })

    expect(screen.getByText('AHU.Fan')).toBeInTheDocument()
    expect(screen.getByText('TRUE')).toBeInTheDocument()
    // `UNAVAILABLE` giữ ô trống chứ không hoá 0 — trộn hai thứ đó là kiểu sai
    // nguy hiểm nhất ở màn hình này.
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getAllByText('MÔ PHỎNG')).toHaveLength(2)
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
})
