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

export function validatePointName(name: string): string | undefined {
  if (/\p{Cc}/u.test(name)) return 'Name must not contain control characters'
  const normalized = normalizePointName(name)
  if (!normalized) return 'Name is required'
  if (Array.from(normalized).length > 64) return 'Name must be at most 64 characters'
  return undefined
}

export interface PointFieldLocation {
  index: number
  field: 'tag' | 'name' | 'label'
}

export function pointFieldLocation(path: string): PointFieldLocation | undefined {
  const match = path.match(/^(?:ui|ao|do|items)\[(\d+)\]\.(tag|name|label)$/)
  if (!match) return undefined
  return { index: Number(match[1]), field: match[2] as PointFieldLocation['field'] }
}

export function pointTagFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {}
  return Object.fromEntries(error.details.flatMap((detail) => {
    const message = `${detail.message ?? detail.reason ?? error.message}${detail.conflictPointId ? ` (conflicts with ${detail.conflictPointId})` : ''}`
    return detail.conflictPath ? [[detail.path, message], [detail.conflictPath, message]] : [[detail.path, message]]
  }))
}
