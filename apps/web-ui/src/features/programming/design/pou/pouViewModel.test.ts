import { describe, expect, it } from 'vitest'
import type { ProgrammingDraftDocument } from '../../model/types'
import {
  filterPouItems,
  groupPouItems,
  objectIdOfRuntimeProgram,
  pouItems,
  resolvePouSelection,
  runtimeProgramIdOf
} from './pouViewModel'

/** `objectId` KHÁC `programId` ở mọi POU đã xếp lịch — đúng hình dạng mà một
 *  Revision do backend cấp identity runtime riêng sẽ tạo ra. */
function documentWithSplitIdentity(): ProgrammingDraftDocument {
  return {
    schemaVersion: 2,
    project: { projectId: 'project-1', name: 'AHU', functionalTags: [] },
    programs: [
      {
        programId: 'run-1', objectId: 'obj-1', hasRuntimeConfig: true, periodMs: 5000,
        name: 'AHU_MAIN', kind: 'PROGRAM', language: 'ST', document: '', dependencies: ['obj-2']
      },
      {
        programId: 'obj-2', objectId: 'obj-2', hasRuntimeConfig: false,
        name: 'SCALE_LIN', kind: 'FUNCTION', language: 'ST', document: ''
      },
      {
        programId: 'obj-3', objectId: 'obj-3', hasRuntimeConfig: false,
        name: 'GHOST', kind: 'PROGRAM', language: 'FBD', document: ''
      }
    ],
    variables: [], bindings: [],
    task: { taskId: 'task-1', periodMs: 1000, programOrder: ['run-1'] },
    library: { profile: 'revA', version: '1' }
  } as unknown as ProgrammingDraftDocument
}

describe('PGM-02 POU view model — hai trục định danh', () => {
  it('chỉ POU đã xếp lịch mới có identity runtime', () => {
    const items = pouItems(documentWithSplitIdentity())
    expect(items.map((item) => [item.objectId, item.runtimeProgramId, item.scheduled])).toEqual([
      ['obj-1', 'run-1', true],
      ['obj-2', undefined, false],
      // PROGRAM chưa xếp lịch: KHÔNG mượn objectId làm programId, vì Core không
      // có identity runtime nào như vậy.
      ['obj-3', undefined, false]
    ])
  })

  it('chu kỳ đi theo từng POU, không lấy chu kỳ của Task', () => {
    const items = pouItems(documentWithSplitIdentity())
    expect(items.find((item) => item.objectId === 'obj-1')?.periodMs).toBe(5000)
    expect(items.find((item) => item.objectId === 'obj-2')?.periodMs).toBeUndefined()
  })

  it('document v1 (không có hasRuntimeConfig) vẫn suy được theo kind', () => {
    const legacy = {
      schemaVersion: 1,
      project: { projectId: 'p', name: 'p', functionalTags: [] },
      programs: [{ programId: 'p1', name: 'A', kind: 'PROGRAM', language: 'ST', document: '' }],
      variables: [], bindings: [],
      task: { taskId: 't', periodMs: 1000, programOrder: ['p1'] },
      library: { profile: '', version: '' }
    } as unknown as ProgrammingDraftDocument
    const [item] = pouItems(legacy)
    expect(item.objectId).toBe('p1')
    expect(item.runtimeProgramId).toBe('p1')
    expect(item.scheduled).toBe(true)
  })

  it('đổi qua lại hai trục định danh mà không đoán', () => {
    const items = pouItems(documentWithSplitIdentity())
    expect(runtimeProgramIdOf(items, 'obj-1')).toBe('run-1')
    expect(runtimeProgramIdOf(items, 'obj-3')).toBeUndefined()
    expect(objectIdOfRuntimeProgram(items, 'run-1')).toBe('obj-1')
    // `obj-1` là objectId chứ không phải programId: tra nhầm trục phải cho
    // `undefined`, không cho POU nào.
    expect(objectIdOfRuntimeProgram(items, 'obj-1')).toBeUndefined()
  })

  it('chọn POU không tồn tại cho null, không rơi về POU đầu tiên', () => {
    const items = pouItems(documentWithSplitIdentity())
    expect(resolvePouSelection(items, 'obj-2')?.name).toBe('SCALE_LIN')
    expect(resolvePouSelection(items, 'không-có')).toBeNull()
    expect(resolvePouSelection(items, undefined)).toBeNull()
    // Tra bằng identity runtime KHÔNG được mở POU: hai trục không thay nhau.
    expect(resolvePouSelection(items, 'run-1')).toBeNull()
  })

  it('gom đủ ba nhóm kể cả nhóm rỗng và sắp theo tên', () => {
    const groups = groupPouItems(pouItems(documentWithSplitIdentity()))
    expect(groups.map((group) => [group.kind, group.items.length])).toEqual([
      ['PROGRAM', 2], ['FUNCTION_BLOCK', 0], ['FUNCTION', 1]
    ])
    expect(groups[0].items.map((item) => item.name)).toEqual(['AHU_MAIN', 'GHOST'])
  })

  it('lọc theo tên không phân biệt hoa thường và theo ngôn ngữ', () => {
    const items = pouItems(documentWithSplitIdentity())
    expect(filterPouItems(items, 'ahu').map((item) => item.name)).toEqual(['AHU_MAIN'])
    expect(filterPouItems(items, 'fbd').map((item) => item.name)).toEqual(['GHOST'])
    expect(filterPouItems(items, '  ').length).toBe(3)
  })
})
