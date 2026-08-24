import { describe, expect, it } from 'vitest'
import type {
  ProgrammingProgramListItem,
  ProgrammingProgramsPage,
  ProgrammingProject,
  ProgrammingRuntime
} from '../model/types'
import type { ActiveProgramSet } from './activeProgramSet'
import {
  coreSemanticState,
  overviewProgramRows,
  overviewViewModel,
  programHealthSemanticState,
  programRuntimeSemanticState,
  revisionSequenceLabel
} from './overviewViewModel'

/**
 * `T60-201` — view model thuần của PGM-01.
 *
 * Trọng tâm là các luật KHÔNG nhìn thấy bằng mắt lúc review:
 *
 * - `AC-PGM01-04`: mọi số liệu chưa đọc được phải ra `null` để tầng hiển thị vẽ
 *   `—`; không nhánh nào được trả `0`.
 * - Chu kỳ khai báo và chu kỳ Core đang chạy KHÔNG được trộn im lặng.
 * - `health` do server cấp; FE chỉ giải thích vì sao rỗng, không tự tính.
 * - Cột `Last Exec` là MỐC thời gian: `lastExecNs` (thời lượng) không bao giờ
 *   được rò vào đó.
 */

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const BASE_REVISION_ID = '22222222-2222-4222-8222-222222222222'
const ACTIVE_REVISION_ID = '33333333-3333-4333-8333-333333333333'
const OBJECT_A = '44444444-4444-4444-8444-444444444444'
const PROGRAM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROGRAM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function item(overrides: Partial<ProgrammingProgramListItem> = {}): ProgrammingProgramListItem {
  return {
    programId: PROGRAM_A,
    desiredEnabled: true,
    generation: 1,
    updatedBy: 'admin',
    updatedAtUtcMs: 1,
    runtimeState: 'RUNNING',
    runtimeStateSource: 'CORE_LIVE',
    coreState: 'RUNNING',
    enabled: true,
    observedAt: '2026-08-23T10:00:00Z',
    periodMs: 1000,
    lastExecNs: 5_600_000,
    maxExecNs: 7_000_000,
    missedReleaseCount: 0,
    consecutiveMissedRelease: 0,
    lastRunAtUtc: '2026-08-23T10:00:00Z',
    lastRunAgeMs: 400,
    lane: 0,
    health: 'HEALTHY',
    ...overrides
  }
}

function page(items: ProgrammingProgramListItem[], overrides: Partial<ProgrammingProgramsPage> = {}): ProgrammingProgramsPage {
  return {
    schemaVersion: '1.0',
    projectId: PROJECT_ID,
    runtimeStateSource: 'CORE_LIVE',
    observedAt: '2026-08-23T10:00:00Z',
    programsTruncated: false,
    items,
    ...overrides
  }
}

function activeSet(overrides: Partial<ActiveProgramSet> = {}): ActiveProgramSet {
  return {
    revisionId: ACTIVE_REVISION_ID,
    programs: [
      { objectId: OBJECT_A, programId: PROGRAM_A, name: 'AHU_Control', language: 'ST', periodMs: 1000 }
    ],
    reason: null,
    ...overrides
  }
}

describe('revisionSequenceLabel — D-05', () => {
  it('dựng nhãn đọc được thay cho UUID', () => {
    expect(revisionSequenceLabel('draft', 14)).toBe('Draft #14')
    expect(revisionSequenceLabel('active', 12)).toBe('Active #12')
  })

  it('chưa phân giải được sequence ⇒ null, KHÔNG rơi về #0 hay UUID rút gọn', () => {
    expect(revisionSequenceLabel('draft', null)).toBeNull()
    expect(revisionSequenceLabel('active', undefined)).toBeNull()
    expect(revisionSequenceLabel('active', 0)).toBeNull()
    expect(revisionSequenceLabel('active', Number.NaN)).toBeNull()
  })
})

describe('overviewProgramRows — ghép khai báo × read-back', () => {
  it('Program có cả trong gói đang chạy lẫn bảng của Core ⇒ đủ sáu cột từ nguồn sống', () => {
    const model = overviewProgramRows({
      programsStatus: 'ready', programs: page([item()]), activeSet: activeSet(), activeSequence: 12
    })
    expect(model.rows).toHaveLength(1)
    const row = model.rows[0]
    expect(row.origin).toBe('DECLARED_AND_LIVE')
    expect(row.name).toBe('AHU_Control')
    expect(row.language).toBe('ST')
    expect(row.cycle).toEqual({ periodMs: 1000, source: 'CORE_LIVE' })
    expect(row.runtimeState).toBe('RUNNING')
    expect(row.lastRun).toEqual({ atUtc: '2026-08-23T10:00:00Z', ageMs: 400 })
    expect(row.health).toBe('HEALTHY')
    expect(row.healthMissingReason).toBeNull()
    expect(model.activeLabel).toBe('Active #12')
    expect(model.emptyReason).toBeNull()
  })

  it('Core im ⇒ chu kỳ lấy từ KHAI BÁO và nói rõ là khai báo, không giả làm số sống', () => {
    const model = overviewProgramRows({
      programsStatus: 'ready',
      programs: page([item({ runtimeState: 'UNKNOWN', runtimeStateSource: 'UNAVAILABLE', periodMs: null, health: null, lastRunAtUtc: null, lastRunAgeMs: null })],
        { runtimeStateSource: 'UNAVAILABLE', observedAt: null }),
      activeSet: activeSet(),
      activeSequence: 12
    })
    const row = model.rows[0]
    expect(row.cycle).toEqual({ periodMs: 1000, source: 'DECLARED' })
    expect(row.runtimeState).toBe('UNKNOWN')
    expect(row.runtimeStateSource).toBe('UNAVAILABLE')
    expect(row.lastRun).toBeNull()
    expect(row.health).toBeNull()
    expect(row.healthMissingReason).toBe('NOT_READ_FROM_CORE')
  })

  it('nguồn dòng là LAST_KNOWN ⇒ KHÔNG nhận periodMs như số đang chạy', () => {
    // Giá trị cũ không được thăng cấp thành "Core đang chạy chu kỳ này".
    const model = overviewProgramRows({
      programsStatus: 'ready',
      programs: page([item({ runtimeStateSource: 'LAST_KNOWN', periodMs: 5000 })], { runtimeStateSource: 'LAST_KNOWN' }),
      activeSet: activeSet(),
      activeSequence: 12
    })
    expect(model.rows[0].cycle).toEqual({ periodMs: 1000, source: 'DECLARED' })
  })

  it('không có chu kỳ ở cả hai nguồn ⇒ null, tuyệt đối không 0', () => {
    const model = overviewProgramRows({
      programsStatus: 'ready',
      programs: page([item({ periodMs: null })]),
      activeSet: activeSet({ programs: [{ objectId: OBJECT_A, programId: PROGRAM_A, name: 'AHU_Control', language: 'ST', periodMs: null }] }),
      activeSequence: 12
    })
    expect(model.rows[0].cycle).toBeNull()
  })

  it('periodMs = 0 từ Core là "không phân giải được", không phải chu kỳ 0 ms', () => {
    const model = overviewProgramRows({
      programsStatus: 'ready',
      programs: page([item({ periodMs: 0 })]),
      activeSet: activeSet({ programs: [{ objectId: OBJECT_A, programId: PROGRAM_A, name: 'AHU_Control', language: 'ST', periodMs: null }] }),
      activeSequence: 12
    })
    expect(model.rows[0].cycle).toBeNull()
  })

  it('cột Last Exec KHÔNG bao giờ lấy từ lastExecNs (đó là thời lượng, không phải mốc)', () => {
    const model = overviewProgramRows({
      programsStatus: 'ready',
      programs: page([item({ lastExecNs: 5_600_000, lastRunAtUtc: null, lastRunAgeMs: null })]),
      activeSet: activeSet(),
      activeSequence: 12
    })
    expect(model.rows[0].lastRun).toBeNull()
  })

  it('Program khai trong gói nhưng Core không kể tên ⇒ UNKNOWN kèm lý do riêng', () => {
    const model = overviewProgramRows({
      programsStatus: 'ready', programs: page([]), activeSet: activeSet(), activeSequence: 12
    })
    const row = model.rows[0]
    expect(row.origin).toBe('DECLARED_ONLY')
    expect(row.runtimeState).toBe('UNKNOWN')
    expect(row.healthMissingReason).toBe('NOT_REPORTED_BY_CORE')
  })

  it('Program Core kể tên nhưng gói không khai vẫn được liệt kê, không bị giấu', () => {
    const model = overviewProgramRows({
      programsStatus: 'ready',
      programs: page([item(), item({ programId: PROGRAM_B, runtimeState: 'FAULTED', health: 'FAULT' })]),
      activeSet: activeSet(),
      activeSequence: 12
    })
    expect(model.rows).toHaveLength(2)
    expect(model.rows[1].origin).toBe('LIVE_ONLY')
    expect(model.rows[1].name).toBeNull()
    expect(model.rows[1].objectId).toBeNull()
    expect(model.rows[1].health).toBe('FAULT')
  })

  it('health do server cấp: Core sống mà server để trống thì ghi rõ "không gán nhãn", không tự chấm HEALTHY', () => {
    const model = overviewProgramRows({
      programsStatus: 'ready',
      programs: page([item({ runtimeState: 'DISABLED', health: null })]),
      activeSet: activeSet(),
      activeSequence: 12
    })
    expect(model.rows[0].health).toBeNull()
    expect(model.rows[0].healthMissingReason).toBe('NOT_LABELLED')
  })

  it('giá trị enum lạ từ mạng rơi về UNKNOWN/UNAVAILABLE, không rơi về RUNNING/CORE_LIVE', () => {
    // Server đời cũ (route `programs` chưa đổi người phục vụ) vẫn có thể gửi
    // `STARTING` và không gửi `runtimeStateSource` — type sinh tự động chỉ ràng
    // buộc lúc biên dịch, không ràng buộc thân phản hồi thật.
    const legacy = { programId: PROGRAM_A, desiredEnabled: true, generation: 1, runtimeState: 'STARTING', updatedBy: 'admin', updatedAtUtcMs: 1 }
    const model = overviewProgramRows({
      programsStatus: 'ready',
      programs: { items: [legacy] } as unknown as ProgrammingProgramsPage,
      activeSet: activeSet(),
      activeSequence: null
    })
    expect(model.rows[0].runtimeState).toBe('UNKNOWN')
    expect(model.rows[0].runtimeStateSource).toBe('UNAVAILABLE')
    expect(model.source).toBe('UNAVAILABLE')
    expect(model.rows[0].health).toBeNull()
  })

  it('programsTruncated=true được giữ lại: bảng KHÔNG đầy đủ là một sự thật phải nói ra', () => {
    const model = overviewProgramRows({
      programsStatus: 'ready', programs: page([item()], { programsTruncated: true }), activeSet: activeSet(), activeSequence: 12
    })
    expect(model.truncated).toBe(true)
  })

  describe('bảng rỗng luôn có lý do, và "đang tải" khác "không có Program"', () => {
    it('đang tải trang Programs', () => {
      const model = overviewProgramRows({
        programsStatus: 'loading', programs: null, activeSet: activeSet({ programs: [], reason: 'REVISION_LOADING' }), activeSequence: null
      })
      expect(model.emptyReason).toBe('LOADING')
    })

    it('đọc trang Programs hỏng', () => {
      const model = overviewProgramRows({
        programsStatus: 'error', programs: null, activeSet: activeSet({ programs: [], reason: 'NO_ACTIVE_REVISION' }), activeSequence: null
      })
      expect(model.emptyReason).toBe('UNAVAILABLE')
    })

    it('đọc được gói nhưng gói không khai Program nào', () => {
      const model = overviewProgramRows({
        programsStatus: 'ready', programs: page([]), activeSet: activeSet({ programs: [], reason: 'NO_PROGRAM_DECLARED' }), activeSequence: 12
      })
      expect(model.emptyReason).toBe('NO_PROGRAM')
      expect(model.activeSetReason).toBe('NO_PROGRAM_DECLARED')
    })

    it('thân phản hồi không thuộc gói đang chạy ⇒ UNAVAILABLE, không phải "không có Program"', () => {
      const model = overviewProgramRows({
        programsStatus: 'ready', programs: page([]), activeSet: activeSet({ programs: [], reason: 'REVISION_MISMATCH' }), activeSequence: 12
      })
      expect(model.emptyReason).toBe('UNAVAILABLE')
    })
  })
})

describe('ánh xạ trạng thái ngữ nghĩa', () => {
  it('runtimeState → trạng thái ngữ nghĩa của README §3', () => {
    expect(programRuntimeSemanticState('RUNNING')).toBe('good')
    expect(programRuntimeSemanticState('WAITING')).toBe('warning')
    expect(programRuntimeSemanticState('DISABLED')).toBe('disabled')
    expect(programRuntimeSemanticState('FAULTED')).toBe('fault')
    expect(programRuntimeSemanticState('UNKNOWN')).toBe('unknown')
  })

  it('health → trạng thái ngữ nghĩa; null ra unknown chứ không ra good', () => {
    expect(programHealthSemanticState('HEALTHY')).toBe('good')
    expect(programHealthSemanticState('DEGRADED')).toBe('warning')
    expect(programHealthSemanticState('FAULT')).toBe('fault')
    expect(programHealthSemanticState('UNKNOWN')).toBe('unknown')
    expect(programHealthSemanticState(null)).toBe('unknown')
  })

  it('Core: đang tải ra unknown, DEGRADED ra stale, mất kết nối ra fault', () => {
    expect(coreSemanticState('loading', null)).toBe('unknown')
    expect(coreSemanticState('error', null)).toBe('fault')
    expect(coreSemanticState('ready', 'UNAVAILABLE')).toBe('fault')
    expect(coreSemanticState('ready', 'DEGRADED')).toBe('stale')
    expect(coreSemanticState('ready', 'READY')).toBe('good')
  })
})

describe('overviewViewModel — hợp nhất cả trang', () => {
  const project: ProgrammingProject = {
    projectId: PROJECT_ID,
    name: 'AHU-01',
    etag: '"r:1"',
    activeRevisionId: ACTIVE_REVISION_ID,
    draftRevisionId: BASE_REVISION_ID,
    baseRevisionId: BASE_REVISION_ID,
    updatedAt: '2026-08-23T09:00:00Z',
    dirty: false,
    draftSequence: 14,
    activeSequence: 12,
    latestCheck: { checkId: 'c1', revisionId: BASE_REVISION_ID, state: 'PASSED', createdAt: '2026-08-23T09:00:00Z' }
  }

  const runtime: ProgrammingRuntime = {
    schemaVersion: '1.0',
    controllerId: 'controller-local',
    producerState: 'READY',
    activeRevisionId: ACTIVE_REVISION_ID,
    lkgRevisionId: null,
    taskState: 'RUNNING',
    safeState: false,
    safeStateNoControllerOnly: false,
    observedAt: '2026-08-23T10:00:00Z'
  }

  it('dựng đủ nhãn Draft/Active và chọn đúng CTA cho trạng thái này', () => {
    const vm = overviewViewModel({
      projectStatus: 'ready', project,
      runtimeStatus: 'ready', runtime,
      programsStatus: 'ready', programs: page([item()]),
      activeSet: activeSet()
    })
    expect(vm.projectName).toBe('AHU-01')
    expect(vm.draft.label).toBe('Draft #14')
    expect(vm.active.label).toBe('Active #12')
    expect(vm.active.present).toBe(true)
    expect(vm.core.semantic).toBe('good')
    // Draft sạch, Check PASSED, Active khác Revision nền ⇒ hàng 3 của handoff §3.
    expect(vm.primaryCta.kind).toBe('REVIEW_CHANGES')
    expect(vm.programs.rows).toHaveLength(1)
  })

  it('runtime chưa đọc được ⇒ safeState là null chứ không phải false', () => {
    const vm = overviewViewModel({
      projectStatus: 'ready', project,
      runtimeStatus: 'error', runtime: null,
      programsStatus: 'ready', programs: page([]),
      activeSet: activeSet({ programs: [], reason: 'REVISION_UNAVAILABLE' })
    })
    expect(vm.safeState.active).toBeNull()
    expect(vm.active.taskState).toBeNull()
    expect(vm.core.semantic).toBe('fault')
    expect(vm.primaryCta.kind).toBeNull()
    expect(vm.primaryCta.undecidedReason).toBe('RUNTIME_UNAVAILABLE')
  })

  it('server chưa phân giải được sequence ⇒ không có nhãn, và KHÔNG lộ UUID thay thế (AC-PGM01-01)', () => {
    const vm = overviewViewModel({
      projectStatus: 'ready',
      project: { ...project, draftSequence: null, activeSequence: null },
      runtimeStatus: 'ready', runtime,
      programsStatus: 'ready', programs: page([item()]),
      activeSet: activeSet()
    })
    expect(vm.draft.label).toBeNull()
    expect(vm.active.label).toBeNull()
    expect(vm.programs.activeLabel).toBeNull()
    // `present` vẫn true: Core CÓ nói là đang chạy một gói, chỉ là chưa biết số của nó.
    expect(vm.active.present).toBe(true)
  })

  it('chưa có Project ⇒ mọi dữ kiện Draft/Active rỗng và không đề xuất CTA nào', () => {
    const vm = overviewViewModel({
      projectStatus: 'ready', project: null,
      runtimeStatus: 'ready', runtime,
      programsStatus: 'ready', programs: page([]),
      activeSet: activeSet({ programs: [], reason: 'NO_ACTIVE_REVISION' })
    })
    expect(vm.projectName).toBeNull()
    expect(vm.draft.dirty).toBeNull()
    expect(vm.primaryCta.kind).toBeNull()
    expect(vm.primaryCta.undecidedReason).toBe('NO_PROJECT')
  })

  it('giữ nguyên phân biệt safe-state nhẹ (chưa ai điều khiển) với safe-state do lỗi thật', () => {
    const gentle = overviewViewModel({
      projectStatus: 'ready', project,
      runtimeStatus: 'ready', runtime: { ...runtime, safeState: true, safeStateNoControllerOnly: true },
      programsStatus: 'ready', programs: page([item()]), activeSet: activeSet()
    })
    const severe = overviewViewModel({
      projectStatus: 'ready', project,
      runtimeStatus: 'ready', runtime: { ...runtime, safeState: true, safeStateNoControllerOnly: false },
      programsStatus: 'ready', programs: page([item()]), activeSet: activeSet()
    })
    expect(gentle.safeState).toEqual({ active: true, noControllerOnly: true })
    expect(severe.safeState).toEqual({ active: true, noControllerOnly: false })
  })
})
