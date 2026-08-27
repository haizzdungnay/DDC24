import { describe, expect, it } from 'vitest'
import {
  activeProgramSet,
  activeProgramSetReasonLabel,
  activeProgramSource,
  type ActiveProgramSetInput
} from './activeProgramSet'

const vi = (viText: string) => viText
const en = (_viText: string, enText: string) => enText

const ACTIVE_REVISION_ID = '9c858901-8a57-4791-81fe-4c455b099bc9'
const DRAFT_REVISION_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

function programObject(overrides: Record<string, unknown> = {}, config: Record<string, unknown> | null = {}) {
  const payload: Record<string, unknown> = {
    objectId: 'a1b2c3d4-0000-4000-8000-000000000001',
    kind: 'PROGRAM',
    name: 'AHU_Control',
    language: 'ST',
    source: 'PROGRAM AHU_Control\nEND_PROGRAM\n',
    ...overrides
  }
  if (config) {
    payload.programConfig = {
      programId: 'b2c3d4e5-0000-4000-8000-000000000002',
      objectId: payload.objectId,
      periodMs: 1000,
      ...config
    }
  }
  return { objectId: payload.objectId, kind: payload.kind, sha256: 'f'.repeat(64), payload }
}

function input(overrides: Partial<ActiveProgramSetInput> = {}): ActiveProgramSetInput {
  return {
    activeRevisionId: ACTIVE_REVISION_ID,
    status: 'ready',
    revision: {
      revisionId: ACTIVE_REVISION_ID,
      projectId: 'c3d4e5f6-0000-4000-8000-000000000003',
      state: 'IMMUTABLE',
      contentHash: 'a'.repeat(64),
      createdAt: '2026-08-23T00:00:00Z',
      snapshot: { manifest: {}, objects: [programObject()] }
    },
    ...overrides
  }
}

describe('activeProgramSet — T60-017 (đọc Program đang vận hành từ Active Revision)', () => {
  it('lấy tên, language và periodMs khai báo từ objects[kind=PROGRAM]', () => {
    const result = activeProgramSet(input())
    expect(result.reason).toBeNull()
    expect(result.revisionId).toBe(ACTIVE_REVISION_ID)
    expect(result.programs).toEqual([{
      objectId: 'a1b2c3d4-0000-4000-8000-000000000001',
      programId: 'b2c3d4e5-0000-4000-8000-000000000002',
      name: 'AHU_Control',
      language: 'ST',
      periodMs: 1000
    }])
  })

  it('chỉ đếm kind PROGRAM — FUNCTION và FUNCTION_BLOCK là POU được gọi, không phải đơn vị lập lịch', () => {
    const result = activeProgramSet(input({
      revision: {
        revisionId: ACTIVE_REVISION_ID,
        snapshot: {
          objects: [
            { objectId: 'metadata', kind: 'METADATA', payload: { project: {} } },
            programObject({ objectId: 'p-1', name: 'Prog1' }),
            programObject({ objectId: 'f-1', kind: 'FUNCTION', name: 'SCALE_LIN' }, null),
            programObject({ objectId: 'fb-1', kind: 'FUNCTION_BLOCK', name: 'PID' }, null),
            programObject({ objectId: 'p-2', name: 'Prog2', language: 'FBD' }, { periodMs: 5000 })
          ]
        }
      }
    }))
    expect(result.programs.map((program) => program.name)).toEqual(['Prog1', 'Prog2'])
    expect(result.programs.map((program) => program.periodMs)).toEqual([1000, 5000])
    expect(result.programs[1].language).toBe('FBD')
  })

  it('giữ nguyên thứ tự khai báo của snapshot — không tự sắp lại theo tên', () => {
    const result = activeProgramSet(input({
      revision: {
        revisionId: ACTIVE_REVISION_ID,
        snapshot: {
          objects: [
            programObject({ objectId: 'p-z', name: 'Zone_Reset' }),
            programObject({ objectId: 'p-a', name: 'AHU_Control' })
          ]
        }
      }
    }))
    expect(result.programs.map((program) => program.name)).toEqual(['Zone_Reset', 'AHU_Control'])
  })

  it('D-03/AC-PGM01-04 — trường không đọc được ra null để hiển thị "—", không bao giờ ra 0', () => {
    const result = activeProgramSet(input({
      revision: {
        revisionId: ACTIVE_REVISION_ID,
        snapshot: {
          objects: [
            programObject({ objectId: 'p-1', name: '   ', language: 'PASCAL' }, null),
            programObject({ objectId: 'p-2' }, { periodMs: 0 }),
            programObject({ objectId: 'p-3' }, { periodMs: 'nhanh' })
          ]
        }
      }
    }))
    expect(result.programs.map((program) => program.periodMs)).toEqual([null, null, null])
    expect(result.programs[0].name).toBeNull()
    expect(result.programs[0].language).toBeNull()
    expect(result.programs[0].programId).toBeNull()
    expect(result.programs.some((program) => program.periodMs === 0)).toBe(false)
  })

  it.each([
    ['chưa Commission', { activeRevisionId: null }, 'NO_ACTIVE_REVISION'],
    ['đang đọc', { status: 'loading' as const }, 'REVISION_LOADING'],
    ['chưa bắt đầu đọc', { status: 'idle' as const }, 'REVISION_LOADING'],
    ['đọc hỏng', { status: 'error' as const, revision: null }, 'REVISION_UNAVAILABLE'],
    ['không có thân phản hồi', { revision: null }, 'REVISION_UNAVAILABLE'],
    ['snapshot thiếu objects', { revision: { revisionId: ACTIVE_REVISION_ID, snapshot: { manifest: {} } } }, 'SNAPSHOT_UNREADABLE'],
    ['Revision không khai Program', { revision: { revisionId: ACTIVE_REVISION_ID, snapshot: { objects: [] } } }, 'NO_PROGRAM_DECLARED']
  ])('rỗng vì %s thì luôn kèm lý do phân biệt được', (_name, overrides, reason) => {
    const result = activeProgramSet(input(overrides as Partial<ActiveProgramSetInput>))
    expect(result.programs).toEqual([])
    expect(result.reason).toBe(reason)
    expect(activeProgramSetReasonLabel(vi, result.reason)?.length ?? 0).toBeGreaterThan(0)
  })

  it('KHÔNG MƯỢN DRAFT: thân phản hồi của Revision khác ra rỗng kèm REVISION_MISMATCH', () => {
    const draftBody = {
      revisionId: DRAFT_REVISION_ID,
      snapshot: { objects: [programObject({ name: 'Draft_Only' })] }
    }
    const result = activeProgramSet(input({ revision: draftBody }))
    expect(result.programs).toEqual([])
    expect(result.reason).toBe('REVISION_MISMATCH')
    // Chưa có Active mà lỡ đọc được thân Draft cũng không được mượn.
    const noActive = activeProgramSet(input({ activeRevisionId: null, revision: draftBody }))
    expect(noActive.programs).toEqual([])
    expect(noActive.reason).toBe('NO_ACTIVE_REVISION')
  })

  it('thân phản hồi thiếu revisionId thì không kết luận được, nên cũng không được dùng', () => {
    const result = activeProgramSet(input({ revision: { snapshot: { objects: [programObject()] } } }))
    expect(result.programs).toEqual([])
    expect(result.reason).toBe('REVISION_MISMATCH')
  })

  it('có Program thì reason là null — rỗng và có dữ liệu không bao giờ lẫn nhau', () => {
    expect(activeProgramSet(input()).reason).toBeNull()
    expect(activeProgramSetReasonLabel(vi, null)).toBeNull()
  })

  it('D-06 — lý do có cả hai ngôn ngữ, chọn đúng một tại một thời điểm', () => {
    expect(activeProgramSetReasonLabel(vi, 'NO_ACTIVE_REVISION')).toContain('chưa vận hành gói nào')
    expect(activeProgramSetReasonLabel(en, 'NO_ACTIVE_REVISION')).toContain('not running any package')
    expect(activeProgramSetReasonLabel(en, 'NO_ACTIVE_REVISION')).not.toMatch(/[àáảãạăâđèéêìíòóôơùúưỳý]/i)
  })

  it('object rác trong snapshot bị bỏ qua thay vì làm hỏng cả danh sách', () => {
    const result = activeProgramSet(input({
      revision: {
        revisionId: ACTIVE_REVISION_ID,
        snapshot: { objects: [null, 42, 'PROGRAM', { kind: 'PROGRAM' }, programObject()] }
      }
    }))
    expect(result.programs).toHaveLength(1)
    expect(result.programs[0].name).toBe('AHU_Control')
  })
})

/* `T59-811` / `AC-ST-007` — "LIVE displays Active source, never mismatched
 * Draft".
 *
 * Draft và Active trông GIỐNG HỆT nhau trên màn hình: cùng cửa sổ, cùng tên
 * POU, cùng thứ tiếng ST. Người vận hành đọc nhầm Draft thành thứ đang điều
 * khiển tủ là một lỗi không có dấu hiệu bên ngoài nào cả — nên mọi nhánh không
 * chứng minh được phải trả `source: null`, không có nhánh nào rơi về Draft. */
describe('activeProgramSource (T59-811)', () => {
  const REVISION = '33333333-3333-4333-8333-333333333333'
  const OBJECT = '44444444-4444-4444-8444-444444444444'

  function revisionBody(objects: unknown[]): unknown {
    return { revisionId: REVISION, snapshot: { objects } }
  }
  function pou(overrides: Record<string, unknown> = {}) {
    return {
      objectId: OBJECT, kind: 'PROGRAM',
      payload: { objectId: OBJECT, kind: 'PROGRAM', name: 'AHU', language: 'ST', source: 'PROGRAM AHU\nEND_PROGRAM\n', ...overrides }
    }
  }

  it('trả đúng nguồn của POU trong Revision đang chạy', () => {
    const result = activeProgramSource({
      activeRevisionId: REVISION, status: 'ready', revision: revisionBody([pou()]), objectId: OBJECT,
    })
    expect(result).toEqual({
      revisionId: REVISION, objectId: OBJECT, language: 'ST',
      source: 'PROGRAM AHU\nEND_PROGRAM\n', reason: null,
    })
  })

  it('chương trình RỖNG khác hẳn thân không đọc được', () => {
    const empty = activeProgramSource({
      activeRevisionId: REVISION, status: 'ready', revision: revisionBody([pou({ source: '' })]), objectId: OBJECT,
    })
    expect(empty.source).toBe('')
    expect(empty.reason).toBeNull()

    const unreadable = activeProgramSource({
      activeRevisionId: REVISION, status: 'ready', revision: revisionBody([pou({ source: 123 })]), objectId: OBJECT,
    })
    expect(unreadable.source).toBeNull()
    expect(unreadable.reason).toBe('SOURCE_UNREADABLE')
  })

  it('thân phản hồi thuộc Revision KHÁC ⇒ không trả nguồn (chốt chặn mượn Draft)', () => {
    const result = activeProgramSource({
      activeRevisionId: REVISION, status: 'ready',
      revision: { revisionId: 'aaaaaaaa-1111-4111-8111-111111111111', snapshot: { objects: [pou()] } },
      objectId: OBJECT,
    })
    expect(result.source).toBeNull()
    expect(result.reason).toBe('REVISION_MISMATCH')
  })

  it.each([
    ['chưa Commission', { activeRevisionId: null, status: 'ready' as const, revision: revisionBody([pou()]) }, 'NO_ACTIVE_REVISION'],
    ['đang đọc', { activeRevisionId: REVISION, status: 'loading' as const, revision: null }, 'REVISION_LOADING'],
    ['đọc hỏng', { activeRevisionId: REVISION, status: 'error' as const, revision: null }, 'REVISION_UNAVAILABLE'],
    ['snapshot không đọc được', { activeRevisionId: REVISION, status: 'ready' as const, revision: { revisionId: REVISION } }, 'SNAPSHOT_UNREADABLE'],
  ])('%s ⇒ không có nguồn, nêu đúng lý do', (_label, input, reason) => {
    const result = activeProgramSource({ ...input, objectId: OBJECT })
    expect(result.source).toBeNull()
    expect(result.reason).toBe(reason)
  })

  it('POU chưa Commission thì nói thẳng, không hiện Draft thay thế', () => {
    const result = activeProgramSource({
      activeRevisionId: REVISION, status: 'ready', revision: revisionBody([pou()]),
      objectId: '99999999-9999-4999-8999-999999999999',
    })
    expect(result.source).toBeNull()
    expect(result.reason).toBe('POU_NOT_IN_REVISION')
  })

  it('chưa chọn POU nào ⇒ cũng không đoán', () => {
    const result = activeProgramSource({
      activeRevisionId: REVISION, status: 'ready', revision: revisionBody([pou()]), objectId: null,
    })
    expect(result.source).toBeNull()
    expect(result.reason).toBe('POU_NOT_IN_REVISION')
  })
})
