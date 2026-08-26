import { describe, expect, it, vi } from 'vitest'
import type { ProgrammingRuntimeMonitorState } from '../../api/queries'
import type { ProgrammingDraftDocument, ProgrammingMonitorSample, ProgrammingProgram } from '../../model/types'
import { runtimeOverlayByProgramId, userPouInterfacesFromDraft } from './workspaceAdapters'

const PROGRAMS: ProgrammingProgram[] = [
  { programId: 'program-b', name: 'Program B', kind: 'PROGRAM', language: 'ST', document: '' },
  { programId: 'program-a', name: 'Program A', kind: 'PROGRAM', language: 'ST', document: '' },
  { programId: 'function-a', name: 'Function A', kind: 'FUNCTION', language: 'ST', document: '' },
]

function sample(overrides: Partial<ProgrammingMonitorSample> = {}): ProgrammingMonitorSample {
  return {
    variableId: 'variable-a',
    variableName: 'A',
    programId: 'program-a',
    point: { category: 'LOCAL', pointId: 'LOCAL-A' },
    direction: 'READ_WRITE',
    dataType: 'REAL',
    unit: 'degC',
    programValue: 21.5,
    actualValue: 21.5,
    overriddenBy: null,
    effectivePriority: null,
    overrideActor: null,
    overrideRemainingS: null,
    quality: 'GOOD',
    observedAt: '2026-08-21T00:00:00Z',
    freshness: 'LIVE',
    ...overrides,
  }
}

function monitor(
  status: ProgrammingRuntimeMonitorState['status'],
  options: {
    activeRevisionId?: string | null
    items?: ProgrammingMonitorSample[]
    /** `null` = snapshot KHÔNG mang dấu producer (`T59-810`). */
    producer?: { capturedMonotonicNs: string } | null
  } = {},
): ProgrammingRuntimeMonitorState {
  const activeRevisionId = options.activeRevisionId === undefined ? 'revision-active' : options.activeRevisionId
  const producer = options.producer === undefined ? { capturedMonotonicNs: '1000' } : options.producer
  return {
    status,
    data: status === 'ready' ? {
      schemaVersion: '1.0', activeRevisionId,
      ...(producer === null ? {} : { producer }),
      safeState: false, task: null, items: options.items ?? [],
    } : null,
    error: status === 'error' ? 'Core offline' : null,
    producerRestarted: false,
    failure: status === 'error' ? 'offline' : null,
    refresh: vi.fn(),
  }
}

describe('runtimeOverlayByProgramId', () => {
  it('fail-closed khi loading, lỗi, không Active hoặc Revision monitor không khớp', () => {
    expect(runtimeOverlayByProgramId(PROGRAMS, monitor('loading'), 'revision-active')).toEqual({
      'program-b': { status: 'loading' },
      'program-a': { status: 'loading' },
    })
    expect(runtimeOverlayByProgramId(PROGRAMS, monitor('error'), 'revision-active')).toEqual({
      'program-b': { status: 'unavailable' },
      'program-a': { status: 'unavailable' },
    })
    expect(runtimeOverlayByProgramId(PROGRAMS, monitor('ready'), null)['program-a']).toEqual({ status: 'unavailable' })
    expect(runtimeOverlayByProgramId(PROGRAMS, monitor('ready', { activeRevisionId: 'revision-old' }), 'revision-active')['program-a'])
      .toEqual({ status: 'unavailable' })
    // FUNCTION/FB không có runtime độc lập nên không được dựng overlay rỗng giả.
    expect(runtimeOverlayByProgramId(PROGRAMS, monitor('loading'), 'revision-active')['function-a']).toBeUndefined()
  })

  it('group đúng Program, giữ zero/false và đánh null là invalid thay vì đổi thành 0', () => {
    const overlays = runtimeOverlayByProgramId(PROGRAMS, monitor('ready', { items: [
      sample({ variableId: 'variable-z', variableName: 'Zero', programValue: 0 }),
      sample({ variableId: 'variable-null', variableName: 'Missing', programValue: null, quality: 'BAD', freshness: 'UNAVAILABLE' }),
      sample({ variableId: 'variable-false', variableName: 'Flag', programId: 'program-b', programValue: false, dataType: 'BOOL' }),
      sample({ variableId: 'foreign', variableName: 'Foreign', programId: 'program-foreign' }),
    ] }), 'revision-active')

    expect(overlays['program-a']).toEqual({ status: 'ready', items: [
      expect.objectContaining({ variableId: 'variable-null', value: null, valid: false }),
      expect.objectContaining({ variableId: 'variable-z', value: 0, valid: true }),
    ] })
    expect(overlays['program-b']).toEqual({ status: 'ready', items: [
      expect.objectContaining({ variableId: 'variable-false', value: false, valid: true }),
    ] })
    expect(Object.values(overlays).flatMap((state) => state?.status === 'ready' ? state.items : [])
      .some((item) => item.variableId === 'foreign')).toBe(false)
  })
})

function draftV2(): ProgrammingDraftDocument {
  return {
    schemaVersion: 2,
    project: { projectId: 'project-a', name: 'Project A', functionalTags: [] },
    objects: [
      {
        objectId: 'function-scale', kind: 'FUNCTION', name: 'Scale', language: 'ST',
        // Cố ý mâu thuẫn với metadata để khoá việc adapter KHÔNG parse source.
        source: 'FUNCTION Scale : BOOL\nVAR_INPUT Wrong : BOOL; END_VAR\nEND_FUNCTION',
        interface: {
          inputs: [{ name: 'Raw', type: 'REAL' }, { name: 'Gain', type: 'REAL' }],
          returnType: 'REAL',
        },
      },
      {
        objectId: 'fb-filter', kind: 'FUNCTION_BLOCK', name: 'Filter', language: 'FBD', source: '{}',
        interface: {
          inputs: [{ name: 'In', type: 'REAL' }],
          outputs: [{ name: 'Out', type: 'REAL' }],
        },
      },
      {
        objectId: 'function-invalid', kind: 'FUNCTION', name: 'InvalidType', language: 'ST', source: '',
        interface: { inputs: [{ name: 'X', type: 'LREAL_NOT_IN_PROFILE' }], returnType: 'REAL' },
      },
      { objectId: 'program-a', kind: 'PROGRAM', name: 'Program A', language: 'ST', source: '', interface: { inputs: [] } },
    ],
    programs: [], signals: [], bindings: [], library: {}, execution: {},
  } as unknown as ProgrammingDraftDocument
}

describe('userPouInterfacesFromDraft', () => {
  it('chỉ dùng interface typed của Draft v2, giữ thứ tự pin và bỏ type ngoài profile', () => {
    expect(userPouInterfacesFromDraft(draftV2())).toEqual([
      {
        name: 'Scale', kind: 'FUNCTION',
        inputs: [{ name: 'Raw', dataType: 'REAL' }, { name: 'Gain', dataType: 'REAL' }],
        returnType: 'REAL',
      },
      {
        name: 'Filter', kind: 'FUNCTION_BLOCK',
        inputs: [{ name: 'In', dataType: 'REAL' }],
        outputs: [{ name: 'Out', dataType: 'REAL' }],
      },
    ])
  })

  it('lọc chính POU đang mở để không cho vẽ direct recursion', () => {
    expect(userPouInterfacesFromDraft(draftV2(), 'fb-filter').map((item) => item.name)).toEqual(['Scale'])
    expect(userPouInterfacesFromDraft(draftV2(), 'function-scale').map((item) => item.name)).toEqual(['Filter'])
  })

  it('Draft v1 và interface không có authority đều fail-closed thành palette rỗng', () => {
    const v1 = {
      schemaVersion: 1,
      project: { projectId: 'project-a', name: 'Project A', functionalTags: [] },
      programs: [], variables: [], bindings: [],
      task: { taskId: 'task-a', periodMs: 1000, programOrder: [] },
      library: { profile: 'CORE_REVA', version: '1' },
    } satisfies ProgrammingDraftDocument
    expect(userPouInterfacesFromDraft(v1)).toEqual([])
  })
})

/* `T59-810` — một snapshot không có dấu producer đọc được là một snapshot
 * không biết mình từ đâu tới. Vẽ giá trị của nó lên topology đang hiện là đúng
 * thứ `AC-ST-007`/`AC-FBD-010` tồn tại để cấm. */
describe('runtimeOverlayByProgramId — dấu producer (T59-810)', () => {
  it('thiếu dấu producer ⇒ unavailable, không vẽ giá trị', () => {
    const overlays = runtimeOverlayByProgramId(
      PROGRAMS,
      monitor('ready', { producer: null, items: [sample()] }),
      'revision-active',
    )
    expect(overlays['program-a']).toEqual({ status: 'unavailable' })
  })

  it('dấu producer hỏng ⇒ unavailable, không đoán', () => {
    const overlays = runtimeOverlayByProgramId(
      PROGRAMS,
      monitor('ready', { producer: { capturedMonotonicNs: 'không-phải-số' }, items: [sample()] }),
      'revision-active',
    )
    expect(overlays['program-a']).toEqual({ status: 'unavailable' })
  })

  it('dấu hợp lệ + đúng Revision ⇒ vẽ bình thường', () => {
    const overlays = runtimeOverlayByProgramId(
      PROGRAMS,
      monitor('ready', { items: [sample()] }),
      'revision-active',
    )
    expect(overlays['program-a']?.status).toBe('ready')
  })
})
