import { describe, expect, it } from 'vitest'
import type { ProgrammingDraftDocument } from '../../model/types'
import {
  buildPouBackup,
  parsePouBackup,
  planImportPouOperations,
  serializePouBackup,
  type PouBackupItem
} from './pouBackup'

function createTestDoc(): ProgrammingDraftDocument {
  return {
    schemaVersion: 2,
    project: { projectId: 'proj-123', name: 'AHU_Project', functionalTags: [] },
    programs: [
      {
        programId: 'prog-1',
        objectId: 'obj-1',
        name: 'MAIN_SEQ',
        kind: 'PROGRAM',
        language: 'ST',
        document: 'PROGRAM MAIN_SEQ\nEND_PROGRAM',
        hasRuntimeConfig: true,
        periodMs: 1000,
        description: 'Chuong trinh chinh',
        access: 'OPERATOR'
      },
      {
        programId: 'prog-2',
        objectId: 'obj-2',
        name: 'SCALE_FBD',
        kind: 'PROGRAM',
        language: 'FBD',
        document: JSON.stringify({ schemaVersion: '1.0', networks: [] }),
        hasRuntimeConfig: true,
        periodMs: 1000
      },
      {
        programId: 'obj-3',
        objectId: 'obj-3',
        name: 'CALC_FAN',
        kind: 'FUNCTION',
        language: 'ST',
        document: 'FUNCTION CALC_FAN : REAL\nEND_FUNCTION',
        hasRuntimeConfig: false
      }
    ],
    variables: [],
    bindings: [],
    task: { taskId: 'task-1', periodMs: 1000, programOrder: ['prog-1', 'prog-2'] },
    library: { profile: 'p1', version: '1.0' }
  } as unknown as ProgrammingDraftDocument
}

describe('pouBackup', () => {
  it('buildPouBackup xuat dung tat ca cac POU khi khong truyen filter', () => {
    const doc = createTestDoc()
    const backup = buildPouBackup(doc)
    expect(backup.schemaVersion).toBe('mkddc-pou-backup-v1')
    expect(backup.projectName).toBe('AHU_Project')
    expect(backup.pous).toHaveLength(3)
    expect(backup.pous[0].name).toBe('MAIN_SEQ')
    expect(backup.pous[0].kind).toBe('PROGRAM')
    expect(backup.pous[0].description).toBe('Chuong trinh chinh')
    expect(backup.pous[1].name).toBe('SCALE_FBD')
    expect(backup.pous[1].language).toBe('FBD')
    expect(backup.pous[2].name).toBe('CALC_FAN')
    expect(backup.pous[2].kind).toBe('FUNCTION')
  })

  it('buildPouBackup chi xuat cac POU duoc chon', () => {
    const doc = createTestDoc()
    const backup = buildPouBackup(doc, ['obj-2'])
    expect(backup.pous).toHaveLength(1)
    expect(backup.pous[0].name).toBe('SCALE_FBD')
  })

  it('serialize va parsePouBackup khoi phuc chinh xac du lieu', () => {
    const doc = createTestDoc()
    const backup = buildPouBackup(doc)
    const jsonStr = serializePouBackup(backup)
    const parsed = parsePouBackup(jsonStr)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.backup.pous).toHaveLength(3)
    expect(parsed.backup.pous[0].name).toBe('MAIN_SEQ')
  })

  it('parsePouBackup tu choi JSON loi cu phap hoac thieu truong bat buoc', () => {
    expect(parsePouBackup('invalid json').ok).toBe(false)
    expect(parsePouBackup('{}').ok).toBe(false)
    expect(parsePouBackup(JSON.stringify({ pous: [{ name: '', kind: 'PROGRAM', language: 'ST' }] })).ok).toBe(false)
    expect(parsePouBackup(JSON.stringify({ pous: [{ name: 'A', kind: 'INVALID', language: 'ST', document: '' }] })).ok).toBe(false)
  })

  describe('planImportPouOperations', () => {
    it('nhap POU moi khong trung tao ops hop le va cap nhat programOrder cho PROGRAM', () => {
      const doc = createTestDoc()
      const newItems: PouBackupItem[] = [
        {
          name: 'PUMP_CTRL',
          kind: 'PROGRAM',
          language: 'ST',
          document: 'PROGRAM PUMP_CTRL\nEND_PROGRAM'
        },
        {
          name: 'CONVERT_TEMP',
          kind: 'FUNCTION',
          language: 'ST',
          document: 'FUNCTION CONVERT_TEMP : REAL\nEND_FUNCTION'
        }
      ]

      let counter = 100
      const res = planImportPouOperations({
        document: doc,
        itemsToImport: newItems,
        strategy: 'RENAME',
        newObjectIdFactory: () => 'id-' + String(++counter)
      })

      expect(res.renamedCount).toBe(0)
      expect(res.overwrittenCount).toBe(0)
      expect(res.skippedCount).toBe(0)
      expect(res.importedObjectIds).toEqual(['id-101', 'id-102'])

      const ops = res.operations
      expect(ops.some((op) => op.op === 'upsertProgram' && op.program.name === 'PUMP_CTRL')).toBe(true)
      expect(ops.some((op) => op.op === 'setTask' && op.task.programOrder.includes('id-101'))).toBe(true)
      expect(ops.some((op) => op.op === 'upsertObject' && op.object.name === 'CONVERT_TEMP')).toBe(true)
    })

    it('xu ly trung ten chien luoc RENAME tu dong doi ten va sinh UUID moi', () => {
      const doc = createTestDoc()
      const collidedItems: PouBackupItem[] = [
        {
          name: 'MAIN_SEQ',
          kind: 'PROGRAM',
          language: 'ST',
          document: 'PROGRAM MAIN_SEQ_NEW\nEND_PROGRAM'
        }
      ]

      let counter = 200
      const res = planImportPouOperations({
        document: doc,
        itemsToImport: collidedItems,
        strategy: 'RENAME',
        newObjectIdFactory: () => 'id-' + String(++counter)
      })

      expect(res.renamedCount).toBe(1)
      expect(res.overwrittenCount).toBe(0)
      expect(res.skippedCount).toBe(0)

      const progOp = res.operations.find((op) => op.op === 'upsertProgram')
      expect(progOp).toBeDefined()
      if (progOp && progOp.op === 'upsertProgram') {
        expect(progOp.program.name).toBe('MAIN_SEQ_2')
        expect(progOp.program.programId).toBe('id-201')
      }
    })

    it('xu ly trung ten chien luoc OVERWRITE giu nguyen objectId va ghi de noi dung', () => {
      const doc = createTestDoc()
      const collidedItems: PouBackupItem[] = [
        {
          name: 'MAIN_SEQ',
          kind: 'PROGRAM',
          language: 'ST',
          document: 'PROGRAM OVERWRITTEN\nEND_PROGRAM'
        }
      ]

      const res = planImportPouOperations({
        document: doc,
        itemsToImport: collidedItems,
        strategy: 'OVERWRITE'
      })

      expect(res.renamedCount).toBe(0)
      expect(res.overwrittenCount).toBe(1)
      expect(res.skippedCount).toBe(0)

      const progOp = res.operations.find((op) => op.op === 'upsertProgram')
      expect(progOp).toBeDefined()
      if (progOp && progOp.op === 'upsertProgram') {
        expect(progOp.program.programId).toBe('prog-1')
        expect(progOp.program.name).toBe('MAIN_SEQ')
        expect(progOp.program.document).toBe('PROGRAM OVERWRITTEN\nEND_PROGRAM')
      }
      expect(res.operations.some((op) => op.op === 'setTask')).toBe(false)
    })

    it('xu ly trung ten chien luoc SKIP bo qua cac POU trung', () => {
      const doc = createTestDoc()
      const items: PouBackupItem[] = [
        {
          name: 'MAIN_SEQ',
          kind: 'PROGRAM',
          language: 'ST',
          document: 'PROGRAM MAIN_SEQ\nEND_PROGRAM'
        },
        {
          name: 'FRESH_POU',
          kind: 'FUNCTION',
          language: 'ST',
          document: 'FUNCTION FRESH_POU : BOOL\nEND_FUNCTION'
        }
      ]

      const res = planImportPouOperations({
        document: doc,
        itemsToImport: items,
        strategy: 'SKIP',
        newObjectIdFactory: () => 'id-fresh'
      })

      expect(res.renamedCount).toBe(0)
      expect(res.overwrittenCount).toBe(0)
      expect(res.skippedCount).toBe(1)
      expect(res.importedObjectIds).toEqual(['id-fresh'])
      expect(res.operations).toHaveLength(1)
      expect(res.operations[0].op).toBe('upsertObject')
    })
  })
})
