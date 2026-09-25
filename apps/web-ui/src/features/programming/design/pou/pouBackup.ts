import type {
  ProgrammingDraftDocument,
  ProgrammingDraftOperation,
  ProgrammingTaskConfig
} from '../../model/types'
import { canonicalFbdJson, type FbdDocument } from '../../fbd/model'
import { uniquePouName } from './pouCommands'
import type { PouItem, PouKind, PouLanguage } from './pouViewModel'
import {
  loadWireReferencesFromStorage,
  saveWireReferencesToStorage,
  type FbdWireReferenceMap
} from '../../fbd/wireReferences'

export interface PouBackupItem {
  name: string
  kind: PouKind
  language: PouLanguage
  document: unknown
  description?: string
  access?: string
  periodMs?: number
  presentation?: {
    wireReferences?: FbdWireReferenceMap
  }
}

export interface PouBackupFile {
  schemaVersion: 'mkddc-pou-backup-v1'
  exportedAt: string
  projectId?: string
  projectName?: string
  pous: PouBackupItem[]
}

export type CollisionStrategy = 'RENAME' | 'OVERWRITE' | 'SKIP'

export interface ImportPlanInput {
  document: ProgrammingDraftDocument
  itemsToImport: readonly PouBackupItem[]
  strategy: CollisionStrategy
  newObjectIdFactory?: () => string
}

export interface ImportPlanResult {
  operations: ProgrammingDraftOperation[]
  importedObjectIds: string[]
  renamedCount: number
  overwrittenCount: number
  skippedCount: number
}

export function buildPouBackup(
  document: ProgrammingDraftDocument,
  selectedObjectIds?: readonly string[]
): PouBackupFile {
  const selectedSet = selectedObjectIds ? new Set(selectedObjectIds) : null
  const programs = document.programs.filter((prog) => {
    const id = prog.objectId ?? prog.programId
    return selectedSet === null || selectedSet.has(id)
  })

  const pous: PouBackupItem[] = programs.map((prog) => {
    let doc = prog.document
    let presentation: { wireReferences?: FbdWireReferenceMap } | undefined = undefined
    if (prog.language === 'FBD') {
      const id = prog.objectId ?? prog.programId
      let refs = loadWireReferencesFromStorage(document.project?.projectId, id)
      if (!refs || Object.keys(refs).length === 0) {
        if (doc && typeof doc === 'object' && 'graphId' in doc && typeof doc.graphId === 'string') {
          refs = loadWireReferencesFromStorage(document.project?.projectId, doc.graphId)
        }
      }
      if (refs && Object.keys(refs).length > 0) {
        presentation = { wireReferences: refs }
      }
      if (typeof doc === 'string') {
        try {
          doc = JSON.parse(doc)
        } catch {
          // Giữ nguyên nếu không parse được
        }
      }
    }
    return {
      name: prog.name,
      kind: prog.kind,
      language: prog.language,
      document: doc,
      ...(prog.description !== undefined ? { description: prog.description } : {}),
      ...(prog.access !== undefined ? { access: prog.access } : {}),
      ...(prog.periodMs !== undefined ? { periodMs: prog.periodMs } : {}),
      ...(presentation ? { presentation } : {})
    }
  })

  return {
    schemaVersion: 'mkddc-pou-backup-v1',
    exportedAt: new Date().toISOString(),
    projectId: document.project?.projectId,
    projectName: document.project?.name,
    pous
  }
}

export function serializePouBackup(backup: PouBackupFile): string {
  return JSON.stringify(backup, null, 2)
}

export type ParseBackupResult =
  | { ok: true; backup: PouBackupFile }
  | { ok: false; error: string }

export function parsePouBackup(raw: string): ParseBackupResult {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: 'Dữ liệu không phải là đối tượng JSON hợp lệ.' }
    }

    let itemsRaw: unknown = (parsed as { pous?: unknown }).pous
    if (!itemsRaw && Array.isArray(parsed)) {
      itemsRaw = parsed
    }

    if (!Array.isArray(itemsRaw)) {
      return { ok: false, error: 'Tệp sao lưu không chứa danh sách chương trình (pous).' }
    }

    const validKinds = new Set<PouKind>(['PROGRAM', 'FUNCTION', 'FUNCTION_BLOCK'])
    const validLanguages = new Set<PouLanguage>(['ST', 'FBD'])

    const pous: PouBackupItem[] = []
    for (let index = 0; index < itemsRaw.length; index++) {
      const item = itemsRaw[index]
      if (!item || typeof item !== 'object') {
        return { ok: false, error: 'Muc so ' + (index + 1) + ' không hợp lệ.' }
      }
      const rec = item as Record<string, unknown>
      const name = typeof rec.name === 'string' ? rec.name.trim() : ''
      if (!name) {
        return { ok: false, error: 'Muc so ' + (index + 1) + ' thiếu tên POU.' }
      }
      const kind = (typeof rec.kind === 'string' ? rec.kind.toUpperCase() : 'PROGRAM') as PouKind
      if (!validKinds.has(kind)) {
        return { ok: false, error: 'Muc ' + name + ' co loai POU không hợp lệ: ' + String(rec.kind) + '.' }
      }
      const language = (typeof rec.language === 'string' ? rec.language.toUpperCase() : 'ST') as PouLanguage
      if (!validLanguages.has(language)) {
        return { ok: false, error: 'Muc ' + name + ' co ngon ngu không hợp lệ: ' + String(rec.language) + '.' }
      }
      if (rec.document === undefined || rec.document === null) {
        return { ok: false, error: 'Muc ' + name + ' thiếu nội dung mã nguồn.' }
      }

      let presentation: { wireReferences?: FbdWireReferenceMap } | undefined = undefined
      const rawPresentation = rec.presentation
      if (rawPresentation && typeof rawPresentation === 'object' &&
          'wireReferences' in rawPresentation && rawPresentation.wireReferences &&
          typeof rawPresentation.wireReferences === 'object') {
        presentation = {
          wireReferences: rawPresentation.wireReferences as FbdWireReferenceMap
        }
      }

      pous.push({
        name,
        kind,
        language,
        document: rec.document,
        ...(typeof rec.description === 'string' ? { description: rec.description } : {}),
        ...(typeof rec.access === 'string' ? { access: rec.access } : {}),
        ...(typeof rec.periodMs === 'number' ? { periodMs: rec.periodMs } : {}),
        ...(presentation ? { presentation } : {})
      })
    }

    const obj = parsed as Record<string, unknown>
    return {
      ok: true,
      backup: {
        schemaVersion: 'mkddc-pou-backup-v1',
        exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
        projectId: typeof obj.projectId === 'string' ? obj.projectId : undefined,
        projectName: typeof obj.projectName === 'string' ? obj.projectName : undefined,
        pous
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Không thể đọc nội dung tệp JSON.'
    }
  }
}

export function planImportPouOperations(input: ImportPlanInput): ImportPlanResult {
  const { document, itemsToImport, strategy, newObjectIdFactory = () => 'uuid' } = input
  const operations: ProgrammingDraftOperation[] = []
  const importedObjectIds: string[] = []

  let renamedCount = 0
  let overwrittenCount = 0
  let skippedCount = 0

  let currentPouItems: PouItem[] = document.programs.map((p) => ({
    objectId: p.objectId ?? p.programId,
    runtimeProgramId: p.hasRuntimeConfig ? p.programId : undefined,
    name: p.name,
    kind: p.kind,
    language: p.language,
    scheduled: p.hasRuntimeConfig ?? p.kind === 'PROGRAM',
    periodMs: p.periodMs,
    dependencies: p.dependencies ?? []
  }))

  const defaultTask: ProgrammingTaskConfig = {
    taskId: document.project?.projectId ?? 'task-1',
    periodMs: 1000,
    programOrder: []
  }
  const currentProgramOrder = [...(document.task?.programOrder ?? [])]

  for (const item of itemsToImport) {
    const existing = currentPouItems.find(
      (p) => p.name.toLocaleLowerCase() === item.name.toLocaleLowerCase()
    )

    let targetName = item.name
    let targetObjectId: string
    let isOverwrite = false

    if (existing) {
      if (strategy === 'SKIP') {
        skippedCount++
        continue
      }
      if (strategy === 'OVERWRITE') {
        isOverwrite = true
        overwrittenCount++
        targetObjectId = existing.objectId
        targetName = existing.name
      } else {
        renamedCount++
        targetName = uniquePouName(currentPouItems, item.name)
        targetObjectId = newObjectIdFactory()
      }
    } else {
      targetObjectId = newObjectIdFactory()
    }

    let source: string
    if (item.language === 'FBD') {
      if (typeof item.document === 'string') {
        source = item.document
      } else if (item.document && typeof item.document === 'object') {
        try {
          source = canonicalFbdJson(item.document as FbdDocument)
        } catch {
          source = JSON.stringify(item.document)
        }
      } else {
        source = ''
      }
    } else {
      source = typeof item.document === 'string' ? item.document : String(item.document ?? '')
    }

    if (item.kind === 'PROGRAM') {
      if (isOverwrite) {
        operations.push({
          op: 'upsertProgram',
          program: {
            programId: existing?.runtimeProgramId ?? targetObjectId,
            name: targetName,
            kind: 'PROGRAM',
            language: item.language,
            document: source
          }
        })
      } else {
        operations.push({
          op: 'upsertProgram',
          program: {
            programId: targetObjectId,
            name: targetName,
            kind: 'PROGRAM',
            language: item.language,
            document: source
          }
        })
        if (!currentProgramOrder.includes(targetObjectId)) {
          currentProgramOrder.push(targetObjectId)
          operations.push({
            op: 'setTask',
            task: {
              ...(document.task ?? defaultTask),
              programOrder: [...currentProgramOrder]
            }
          })
        }
      }
    } else {
      operations.push({
        op: 'upsertObject',
        object: {
          objectId: targetObjectId,
          kind: item.kind,
          name: targetName,
          language: item.language,
          source,
          locals: []
        }
      })
    }

    if (item.description !== undefined || item.access !== undefined) {
      operations.push({
        op: 'annotateObject',
        objectId: targetObjectId,
        ...(item.description !== undefined ? { description: item.description } : {}),
        ...(item.access !== undefined ? { access: item.access } : {})
      })
    }

    if (item.presentation?.wireReferences) {
      saveWireReferencesToStorage(item.presentation.wireReferences, document.project?.projectId, targetObjectId)
      if (item.document && typeof item.document === 'object' && 'graphId' in item.document && typeof item.document.graphId === 'string') {
        saveWireReferencesToStorage(item.presentation.wireReferences, document.project?.projectId, item.document.graphId)
      }
    }
    importedObjectIds.push(targetObjectId)

    if (!isOverwrite) {
      currentPouItems = [
        ...currentPouItems,
        {
          objectId: targetObjectId,
          runtimeProgramId: item.kind === 'PROGRAM' ? targetObjectId : undefined,
          name: targetName,
          kind: item.kind,
          language: item.language,
          scheduled: item.kind === 'PROGRAM',
          dependencies: []
        }
      ]
    }
  }

  return {
    operations,
    importedObjectIds,
    renamedCount,
    overwrittenCount,
    skippedCount
  }
}
