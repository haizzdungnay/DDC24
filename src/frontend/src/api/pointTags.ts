import { ApiError } from '../types'

const POINT_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/

export function normalizePointTag(tag: string): string {
  return tag.replace(/^ +| +$/g, '').replace(/ +/g, ' ')
}

export function pointTagKey(tag: string): string {
  return normalizePointTag(tag).toLowerCase()
}

export function validatePointTag(tag: string): string | undefined {
  const normalized = normalizePointTag(tag)
  if (!normalized) return 'Tag is required'
  if (new TextEncoder().encode(normalized).length > 64) return 'Tag must be at most 64 ASCII bytes'
  if (!/^[A-Za-z0-9]/.test(normalized)) return 'Tag must start with an ASCII letter or digit'
  if (!POINT_TAG_PATTERN.test(normalized)) return 'Tag may contain only ASCII letters, digits, spaces, _, ., or -'
  return undefined
}

export function normalizePointName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

/** Canonical display value used when a legacy payload has no name/label. */
export function displayPointName(name: unknown, canonicalId: string): string {
  const normalized = normalizePointName(typeof name === 'string' ? name : '')
  return normalized || canonicalId
}

export function pointNameKey(name: string): string {
  return normalizePointName(name).toLowerCase()
}

export interface PointNameEntry {
  id: string
  name?: string | null
  kind?: string
}

/** Returns the other canonical ids that share this display-name key. */
export function pointNameConflicts(entries: PointNameEntry[]): Map<string, string[]> {
  const byId = new Map<string, PointNameEntry>()
  for (const entry of entries) {
    if (entry.id) byId.set(entry.id, entry)
  }
  const byKey = new Map<string, string[]>()
  for (const entry of byId.values()) {
    const key = pointNameKey(displayPointName(entry.name, entry.id))
    const ids = byKey.get(key) ?? []
    ids.push(entry.id)
    byKey.set(key, ids)
  }
  const conflicts = new Map<string, string[]>()
  for (const ids of byKey.values()) {
    if (ids.length < 2) continue
    for (const id of ids) conflicts.set(id, ids.filter((candidate) => candidate !== id))
  }
  return conflicts
}

export function pointNameConflictState(entries: PointNameEntry[]): 'valid' | 'conflicted' {
  return pointNameConflicts(entries).size ? 'conflicted' : 'valid'
}

export function validatePointName(name: string): string | undefined {
  if (/\p{Cc}/u.test(name)) return 'Name must not contain control characters'
  const normalized = normalizePointName(name)
  if (!normalized) return 'Name is required'
  if (Array.from(normalized).length > 64) return 'Name must be at most 64 characters'
  return undefined
}

export interface PointFieldLocation {
  collection: 'ui' | 'ao' | 'do' | 'items'
  index: number
  field: 'tag' | 'name' | 'label'
}

export function pointFieldLocation(path: string): PointFieldLocation | undefined {
  const match = path.match(/^(ui|ao|do|items)\[(\d+)\]\.(tag|name|label)$/)
  if (!match) return undefined
  return { collection: match[1] as PointFieldLocation['collection'], index: Number(match[2]), field: match[3] as PointFieldLocation['field'] }
}

export function pointFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {}
  return Object.fromEntries(error.details.flatMap((detail) => {
    const baseMessage = detail.message ?? detail.reason ?? error.message
    const paths = [
      { path: detail.path, conflictPointId: detail.conflictPointId },
      ...(detail.conflictPath ? [{ path: detail.conflictPath, conflictPointId: detail.pointId }] : [])
    ]
    return paths.filter((entry) => Boolean(entry.path)).flatMap(({ path, conflictPointId }) => {
      const message = `${baseMessage}${conflictPointId ? ` (conflicts with ${conflictPointId})` : ''}`
      const alias = path.endsWith('.label') ? `${path.slice(0, -'.label'.length)}.name` : path.endsWith('.name') ? `${path.slice(0, -'.name'.length)}.label` : undefined
      return [path, alias].filter((candidate): candidate is string => Boolean(candidate)).map((candidate) => [candidate, message] as [string, string])
    })
  }))
}

/** Prefer the path belonging to the point being edited when a conflict is ordered by canonical id. */
export function pointFieldFocusPath(error: unknown, pointId?: string, preferredCollections: PointFieldLocation['collection'][] = []): string | undefined {
  if (!(error instanceof ApiError)) return undefined
  for (const detail of error.details) {
    if (pointId && detail.pointId === pointId && detail.path) return detail.path
    if (pointId && detail.conflictPointId === pointId && detail.conflictPath) return detail.conflictPath
  }
  if (preferredCollections.length) {
    for (const detail of error.details) {
      for (const path of [detail.conflictPath, detail.path]) {
        const location = path ? pointFieldLocation(path) : undefined
        if (location && preferredCollections.includes(location.collection)) return path
      }
    }
  }
  const detail = error.details.find((candidate) => candidate.path || candidate.conflictPath)
  return detail?.path || detail?.conflictPath
}

export function pointTagFieldErrors(error: unknown): Record<string, string> {
  return pointFieldErrors(error)
}

/** Focus the first field represented by a structured API path after React renders it. */
export function focusPointField(paths: string | readonly string[]): void {
  if (typeof document === 'undefined') return
  const requested = typeof paths === 'string' ? [paths] : paths
  const aliases = new Set(requested.flatMap((path) => {
    const aliases = [path]
    if (path.endsWith('.label')) aliases.push(`${path.slice(0, -'.label'.length)}.name`)
    if (path.endsWith('.name')) aliases.push(`${path.slice(0, -'.name'.length)}.label`)
    return aliases
  }))
  const candidate = [...document.querySelectorAll<HTMLElement>('[data-point-field]')]
    .find((element) => aliases.has(element.dataset.pointField ?? ''))
  candidate?.focus()
}
