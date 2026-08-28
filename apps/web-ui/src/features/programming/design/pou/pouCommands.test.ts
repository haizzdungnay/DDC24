import { describe, expect, it } from 'vitest'
import type { ProgrammingDraftDocument } from '../../model/types'
import {
  createPouOperations,
  deletePouOperations,
  duplicatePouOperations,
  pouDeleteBlockers,
  renamePouOperations,
  uniquePouName,
  validatePouName, pouPublishedSignalBlockers } from './pouCommands'
import { pouItems, type PouItem } from './pouViewModel'

function baseDocument(): ProgrammingDraftDocument {
  return {
    schemaVersion: 2,
    project: { projectId: 'project-1', name: 'AHU', functionalTags: [] },
    programs: [
      {
        programId: 'run-1', objectId: 'obj-1', hasRuntimeConfig: true, periodMs: 1000,
        name: 'AHU_MAIN', kind: 'PROGRAM', language: 'ST', document: '', dependencies: ['obj-2']
      },
      {
        programId: 'obj-2', objectId: 'obj-2', hasRuntimeConfig: false,
        name: 'SCALE_LIN', kind: 'FUNCTION', language: 'ST', document: ''
      },
      {
        programId: 'obj-3', objectId: 'obj-3', hasRuntimeConfig: false,
        name: 'GHOST', kind: 'PROGRAM', language: 'ST', document: ''
      }
    ],
    variables: [
      { variableId: 'var-1', programId: 'run-1', name: 'Supply', dataType: 'REAL' },
      { variableId: 'var-2', programId: 'obj-9', name: 'Other', dataType: 'REAL' }
    ],
    bindings: [
      { bindingId: 'bind-1', variableId: 'var-1', pointId: 'UI-01', direction: 'READ' },
      { bindingId: 'bind-2', variableId: 'var-2', pointId: 'UI-02', direction: 'READ' }
    ],
    task: { taskId: 'task-1', periodMs: 1000, programOrder: ['run-1'] },
    library: { profile: 'revA', version: '1' }
  } as unknown as ProgrammingDraftDocument
}

function itemOf(items: readonly PouItem[], objectId: string): PouItem {
  const found = items.find((item) => item.objectId === objectId)
  if (!found) throw new Error(`thiếu POU ${objectId}`)
  return found
}

describe('PGM-02 lệnh vòng đời POU', () => {
  it('tạo PROGRAM thì xếp lịch, tạo FUNCTION/FB thì tuyệt đối không', () => {
    const items = pouItems(baseDocument())
    const program = createPouOperations(items, {
      kind: 'PROGRAM', language: 'ST', objectId: 'new-1', task: baseDocument().task
    })
    expect(program.operations.map((operation) => operation.op)).toEqual(['upsertProgram', 'setTask'])

    for (const kind of ['FUNCTION', 'FUNCTION_BLOCK'] as const) {
      const shared = createPouOperations(items, { kind, language: 'ST', objectId: 'new-2', task: baseDocument().task })
      // Chỉ `upsertObject`: một mục trong `programs[]` cho FUNCTION là dựng ra
      // đúng thứ mà `ST-POU-005` phải chặn ở Check.
      expect(shared.operations.map((operation) => operation.op)).toEqual(['upsertObject'])
    }
  })

  it('POU mới ra đời với khung nguồn hợp lệ theo từng kind', () => {
    const items = pouItems(baseDocument())
    const st = createPouOperations(items, { kind: 'PROGRAM', language: 'ST', objectId: 'n1', task: baseDocument().task })
    expect(st.operations[0]).toMatchObject({ op: 'upsertProgram' })
    const source = (st.operations[0] as { program: { document: string } }).program.document
    expect(source).toContain('PROGRAM NewProgram')
    expect(source).toContain('END_PROGRAM')

    const fn = createPouOperations(items, { kind: 'FUNCTION', language: 'ST', objectId: 'n2', task: baseDocument().task })
    const fnSource = (fn.operations[0] as { object: { source: string } }).object.source
    expect(fnSource).toContain('FUNCTION NewFunction : REAL')
    expect(fnSource).toContain('END_FUNCTION')

    const fb = createPouOperations(items, { kind: 'FUNCTION_BLOCK', language: 'ST', objectId: 'n3', task: baseDocument().task })
    const fbSource = (fb.operations[0] as { object: { source: string } }).object.source
    expect(fbSource).toContain('FUNCTION_BLOCK NewFunctionBlock')
    expect(fbSource).toContain('END_FUNCTION_BLOCK')
  })

  it('tên mới không trùng, kể cả trùng với POU khác kind', () => {
    const items = pouItems(baseDocument())
    expect(uniquePouName(items, 'AHU_MAIN')).toBe('AHU_MAIN_2')
    expect(uniquePouName(items, 'SCALE_LIN')).toBe('SCALE_LIN_2')
    expect(uniquePouName(items, 'Mới')).toBe('Mới')
  })

  it('tên POU sai grammar hoặc trùng bị chặn ngay tại FE kèm lý do', () => {
    const items = pouItems(baseDocument())
    expect(validatePouName(items, '')).toBe('EMPTY')
    expect(validatePouName(items, '  ')).toBe('EMPTY')
    expect(validatePouName(items, '2Fast')).toBe('PATTERN')
    expect(validatePouName(items, 'Tên có dấu')).toBe('PATTERN')
    expect(validatePouName(items, 'SCALE_LIN')).toBe('DUPLICATE')
    // Đổi tên chính nó về chính nó không phải trùng.
    expect(validatePouName(items, 'SCALE_LIN', 'obj-2')).toBeNull()
    expect(validatePouName(items, 'NewName')).toBeNull()
  })

  it('đổi tên chỉ gửi renameObject, không gửi lại mã nguồn', () => {
    expect(renamePouOperations('obj-2', '  Scale2  ')).toEqual([
      { op: 'renameObject', objectId: 'obj-2', name: 'Scale2' }
    ])
  })

  it('nhân bản cấp identity mới và KHÔNG mang theo cấu hình chạy', () => {
    const items = pouItems(baseDocument())
    const result = duplicatePouOperations(items, itemOf(items, 'obj-1'), 'copy-1')
    expect(result.operations).toEqual([
      { op: 'duplicateObject', objectId: 'obj-1', newObjectId: 'copy-1', name: 'AHU_MAIN_copy' }
    ])
    // Không có `upsertProgram`/`setTask`: bản sao của một Program đang chạy
    // không được tự vào chu kỳ điều khiển thật.
    expect(result.operations.some((operation) => operation.op === 'setTask')).toBe(false)
  })

  it('xóa Program gửi đúng thứ tự binding → biến → cấu hình chạy → POU', () => {
    const document = baseDocument()
    const items = pouItems(document)
    expect(deletePouOperations(document, itemOf(items, 'obj-1'))).toEqual([
      { op: 'removeBinding', bindingId: 'bind-1' },
      { op: 'removeVariable', variableId: 'var-1' },
      { op: 'removeProgram', programId: 'run-1' },
      { op: 'removeObject', objectId: 'obj-1' }
    ])
  })

  it('xóa FUNCTION và PROGRAM chưa xếp lịch KHÔNG gửi removeProgram', () => {
    const document = baseDocument()
    const items = pouItems(document)
    expect(deletePouOperations(document, itemOf(items, 'obj-2'))).toEqual([
      { op: 'removeObject', objectId: 'obj-2' }
    ])
    expect(deletePouOperations(document, itemOf(items, 'obj-3'))).toEqual([
      { op: 'removeObject', objectId: 'obj-3' }
    ])
  })

  it('POU còn người gọi thì báo chặn thay vì để Check hỏng ở lần sau', () => {
    const items = pouItems(baseDocument())
    expect(pouDeleteBlockers(items, 'obj-2').map((item) => item.name)).toEqual(['AHU_MAIN'])
    expect(pouDeleteBlockers(items, 'obj-1')).toEqual([])
  })
})

describe('pouPublishedSignalBlockers — POU đang publish thì KHÔNG xoá được', () => {
  const scheduled = {
    objectId: 'obj-1', runtimeProgramId: 'prog-1', name: 'SOAK_01',
    kind: 'PROGRAM' as const, language: 'ST' as const, scheduled: true, dependencies: [],
  }
  const signals = [
    { signalId: 's-1', name: 'SOAK_CONSUMED', publisherProgramId: 'prog-1' },
    { signalId: 's-2', name: 'SOAK_SOURCE', publisherProgramId: 'prog-2' },
  ]

  it('trả đúng tín hiệu do POU này công bố', () => {
    /* Hồi quy bo Foxlinx 2026-08-28: `SOAK_01` publish `SOAK_CONSUMED`, backend
       từ chối `removeProgram` (`400 operations[0].removeProgram`) nhưng FE vẫn
       bật nút Xóa — người dùng nhận một mã lỗi không nói phải làm gì. */
    expect(pouPublishedSignalBlockers(signals, scheduled)).toEqual([
      { signalId: 's-1', name: 'SOAK_CONSUMED' },
    ])
  })

  it('POU không publish gì ⇒ không bị chặn', () => {
    expect(pouPublishedSignalBlockers(signals, { ...scheduled, runtimeProgramId: 'prog-9' })).toEqual([])
  })

  it('POU chưa xếp lịch không thể publish ⇒ không bị chặn', () => {
    // `publisherProgramId` là identity RUNTIME. Không có `runtimeProgramId` thì
    // POU chưa có mục trong `programs[]` và không thể là publisher của gì cả.
    expect(pouPublishedSignalBlockers(signals, { ...scheduled, runtimeProgramId: undefined, scheduled: false })).toEqual([])
  })

  it('so theo runtimeProgramId, KHÔNG theo objectId', () => {
    // Hai trục định danh khác nhau; so nhầm sẽ vừa bỏ sót vừa chặn oan.
    const signalsByObject = [{ signalId: 's-3', name: 'X', publisherProgramId: 'obj-1' }]
    expect(pouPublishedSignalBlockers(signalsByObject, scheduled)).toEqual([])
  })
})
