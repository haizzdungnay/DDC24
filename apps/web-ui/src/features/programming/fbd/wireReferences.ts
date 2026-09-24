import type { FbdNode, FbdPort, FbdWire } from './model'

export type FbdWirePresentationMode = 'DIRECT' | 'REFERENCE'

export interface FbdWireReferenceItem {
  readonly wireId: string
  readonly signalName: string
  readonly customLabel?: string
  readonly createdAt: number
  readonly sourceOffset?: number
  readonly sinkOffset?: number
}

export type FbdWireReferenceMap = Readonly<Record<string, FbdWireReferenceItem>>

export interface FbdNetworkPresentation {
  readonly networkId: string
  readonly wireReferences: FbdWireReferenceMap
}

export interface FbdDocumentPresentation {
  readonly schemaVersion: 1
  readonly networks: Readonly<Record<string, FbdNetworkPresentation>>
}

const IEC_RESERVED_KEYWORDS = new Set([
  'VAR', 'END_VAR', 'PROGRAM', 'FUNCTION_BLOCK', 'FUNCTION',
  'IF', 'THEN', 'ELSE', 'ELSIF', 'END_IF',
  'CASE', 'OF', 'END_CASE',
  'FOR', 'TO', 'BY', 'DO', 'END_FOR',
  'WHILE', 'END_WHILE', 'REPEAT', 'UNTIL', 'END_REPEAT',
  'RETURN', 'EXIT', 'TRUE', 'FALSE',
  'AND', 'OR', 'XOR', 'NOT', 'MOD'
])

export function sanitizeSignalIdentifier(raw: string): string {
  if (!raw) return 'SIG_1'
  let cleaned = raw.replace(/[^a-zA-Z0-9_]+/g, '_')
  cleaned = cleaned.replace(/^_+|_+$/g, '')
  if (!cleaned) return 'SIG_1'
  if (/^[0-9]/.test(cleaned)) {
    cleaned = 'SIG_' + cleaned
  }
  return cleaned
}

export function generateDefaultSignalName(
  sourceNode: FbdNode,
  sourcePort: FbdPort,
  existingNames?: Set<string>
): string {
  const nodePart =
    typeof sourceNode.parameters?.variable === 'string' && sourceNode.parameters.variable.trim() !== ''
      ? sourceNode.parameters.variable.trim()
      : typeof sourceNode.parameters?.name === 'string' && sourceNode.parameters.name.trim() !== ''
        ? sourceNode.parameters.name.trim()
        : sourceNode.typeRef || sourceNode.id

  const portPart = sourcePort.name || 'OUT'
  const cleanNode = sanitizeSignalIdentifier(nodePart)
  const cleanPort = sanitizeSignalIdentifier(portPart)
  const baseName = cleanNode + '_' + cleanPort

  if (!existingNames || !existingNames.has(baseName)) {
    return baseName
  }

  let index = 1
  while (existingNames.has(baseName + '_' + index)) {
    index++
  }
  return baseName + '_' + index
}

export function validateSignalName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim()
  if (!trimmed) {
    return { valid: false, error: 'Tên tín hiệu không được để trống.' }
  }
  if (trimmed.length > 32) {
    return { valid: false, error: 'Tên tín hiệu không được vượt quá 32 ký tự.' }
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    return { valid: false, error: 'Tên tín hiệu chỉ được chứa chữ cái, chữ số và gạch dưới, bắt đầu bằng chữ cái hoặc gạch dưới.' }
  }
  if (IEC_RESERVED_KEYWORDS.has(trimmed.toUpperCase())) {
    return { valid: false, error: 'Tên tín hiệu không được trùng với từ khóa IEC 61131-3.' }
  }
  return { valid: true }
}

export function normalizeWireReferences(
  wires: readonly FbdWire[],
  currentMap: FbdWireReferenceMap
): FbdWireReferenceMap {
  const activeWireIds = new Set(wires.map((w) => w.id))
  let changed = false
  const nextMap: Record<string, FbdWireReferenceItem> = {}

  for (const [wireId, item] of Object.entries(currentMap)) {
    if (activeWireIds.has(wireId)) {
      nextMap[wireId] = item
    } else {
      changed = true
    }
  }

  return changed ? Object.freeze(nextMap) : currentMap
}

export function buildWireReferencesStorageKey(projectId?: string, objectId?: string): string {
  const p = projectId ? encodeURIComponent(projectId.trim()) : 'default'
  const o = objectId ? encodeURIComponent(objectId.trim()) : 'default'
  return 'mkddc:fbd-wire-references:v1:' + p + ':' + o
}

export function loadWireReferencesFromStorage(
  projectId?: string,
  objectId?: string,
  storage?: Storage
): FbdWireReferenceMap {
  const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : null)
  if (!target) return Object.freeze({})
  const key = buildWireReferencesStorageKey(projectId, objectId)
  try {
    const raw = target.getItem(key)
    if (!raw) return Object.freeze({})
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return Object.freeze({})
    }
    return Object.freeze(parsed as Record<string, FbdWireReferenceItem>)
  } catch {
    return Object.freeze({})
  }
}

export function saveWireReferencesToStorage(
  references: FbdWireReferenceMap,
  projectId?: string,
  objectId?: string,
  storage?: Storage
): void {
  const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : null)
  if (!target) return
  const key = buildWireReferencesStorageKey(projectId, objectId)
  try {
    target.setItem(key, JSON.stringify(references))
  } catch {
    // Bắt QuotaExceededError an toàn
  }
}
