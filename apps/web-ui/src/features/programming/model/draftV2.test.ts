import { describe, expect, it } from 'vitest'
import { toWorkspaceDocument } from './draftV2'
import type { ProgrammingDraftDocument } from './types'

const V2 = {
  schemaVersion: 2,
  project: { projectId: '11111111-1111-4111-8111-111111111111', name: 'AHU', functionalTags: [] },
  objects: [
    {
      objectId: '22222222-2222-4222-8222-222222222222',
      kind: 'PROGRAM',
      name: 'AHU_MAIN',
      language: 'ST',
      source: 'PROGRAM AHU_MAIN\nEND_PROGRAM\n',
      locals: [{ variableId: '33333333-3333-4333-8333-333333333333', name: 'Fan', type: 'BOOL', retain: true }]
    },
    {
      objectId: '44444444-4444-4444-8444-444444444444',
      kind: 'FUNCTION',
      name: 'SCALE_LIN',
      language: 'ST',
      source: 'FUNCTION SCALE_LIN : REAL\nEND_FUNCTION\n',
      locals: []
    }
  ],
  programs: [
    { programId: '22222222-2222-4222-8222-222222222222', objectId: '22222222-2222-4222-8222-222222222222', periodMs: 5000 }
  ],
  signals: [],
  bindings: [{ bindingId: '55555555-5555-4555-8555-555555555555', pointId: 'BO-1', direction: 'WRITE' }],
  library: { systemProfile: 'revA-1t-1-5-30', systemVersion: 'rev-a.1', projectLibraryRevisionId: null },
  execution: { profileId: 'revA-1t-1-5-30', maxProgramsEnabled: 16 }
} as unknown as ProgrammingDraftDocument

describe('adapter document v2 -> view model Design', () => {
  it('chiếu POU và locals về programs/variables mà bốn tab đang dùng', () => {
    const view = toWorkspaceDocument(V2)
    expect(view.programs.map((program) => program.name)).toEqual(['AHU_MAIN', 'SCALE_LIN'])
    // Mã nguồn nằm ở `source` trong v2 nhưng tab đọc `document`.
    expect(view.programs[0].document).toContain('PROGRAM AHU_MAIN')
    // Biến của POU phải mang `programId` của chính POU sở hữu, nếu không tab
    // Mapping sẽ không tìm thấy biến nào để gán điểm.
    expect(view.variables).toHaveLength(1)
    expect(view.variables[0].programId).toBe('22222222-2222-4222-8222-222222222222')
    expect(view.task.periodMs).toBe(5000)
  })

  /** Hồi quy `F-P59-DELETE-PROGRAM-001`: `programOrder` chỉ được chứa POU CÓ cấu
   *  hình chạy. Bản trước lấy toàn bộ `objects`, nên Project có user FUNCTION
   *  gửi lên một id không nằm trong `programs[]` và backend từ chối cả batch với
   *  `PRG-ERR-REQ-001` — triệu chứng người dùng thấy là "bấm Xoá Program không
   *  có gì xảy ra". */
  it('programOrder loại POU không có cấu hình chạy (FUNCTION/FUNCTION_BLOCK)', () => {
    const view = toWorkspaceDocument(V2)
    expect(view.task.programOrder).toEqual(['22222222-2222-4222-8222-222222222222'])
    // Vẫn giữ FUNCTION trong danh sách POU để tab Chương trình hiển thị nó.
    expect(view.programs.map((program) => program.kind)).toEqual(['PROGRAM', 'FUNCTION'])
    // `objectId` phải đi kèm: xoá một POU nhắm theo `objectId`, không phải `programId`.
    expect(view.programs[1].objectId).toBe('44444444-4444-4444-8444-444444444444')
    // `hasRuntimeConfig` nói POU có mục trong `programs[]` hay không — kind
    // không trả lời được câu đó.
    expect(view.programs.map((program) => program.hasRuntimeConfig)).toEqual([true, false])
  })

  /** POU kind PROGRAM nhưng KHÔNG có cấu hình chạy — di chứng của lỗi xoá cũ
   *  (gỡ `programs[]` nhưng để lại POU trong `objects[]`). Đây là hình dạng làm
   *  `removeProgram` trả `operations[0].removeProgram`, tức người dùng không xoá
   *  nổi đúng cái chương trình ma đó. Đã đo thật trên bo Foxlinx 2026-08-24: ba
   *  Project mang POU kiểu này. */
  it('PROGRAM không có cấu hình chạy phải lộ ra qua hasRuntimeConfig=false', () => {
    const ghost = {
      ...(V2 as unknown as Record<string, unknown>),
      programs: []
    } as unknown as ProgrammingDraftDocument
    const view = toWorkspaceDocument(ghost)
    expect(view.programs[0].kind).toBe('PROGRAM')
    expect(view.programs[0].hasRuntimeConfig).toBe(false)
    expect(view.task.programOrder).toEqual([])
  })

  it('chu kỳ lạ rơi về 1000 thay vì hiển thị giá trị profile không cho phép', () => {
    const odd = { ...(V2 as unknown as Record<string, unknown>), programs: [{ programId: 'x', objectId: 'y', periodMs: 777 }] }
    expect(toWorkspaceDocument(odd as unknown as ProgrammingDraftDocument).task.periodMs).toBe(1000)
  })

  it('document v1 đi qua nguyên trạng', () => {
    const v1 = { schemaVersion: 1, project: V2.project, programs: [], variables: [], bindings: [], task: { taskId: 't', periodMs: 1000, programOrder: [] }, library: { profile: 'CORE_REVA', version: '1' } } as unknown as ProgrammingDraftDocument
    expect(toWorkspaceDocument(v1)).toBe(v1)
  })
})
