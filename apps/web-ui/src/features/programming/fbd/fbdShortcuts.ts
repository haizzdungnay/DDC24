/**
 * Lớp phím tắt SOẠN THẢO của FBD editor.
 */

export type FbdEditorShortcut =
  | 'DELETE_SELECTION'
  | 'COPY'
  | 'CUT'
  | 'PASTE'
  | 'DUPLICATE'
  | 'SELECT_ALL'
  | 'UNDO'
  | 'REDO'
  | 'ZOOM_100'
  | 'FIT_ALL'
  | 'FIT_SELECTION'
  | 'NUDGE_LEFT'
  | 'NUDGE_RIGHT'
  | 'NUDGE_UP'
  | 'NUDGE_DOWN'
  | 'JOIN_REFERENCE'
  | 'RENAME_REFERENCE'
  | 'GO_TO_PARTNER'
  | 'NAVIGATE_SOURCE'
  | 'NAVIGATE_SINK'

export interface FbdShortcutEventLike {
  key: string
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
}

/** Lệnh có sửa tài liệu hay không — dùng để khoá ở chế độ chỉ đọc. */
export const FBD_SHORTCUT_MUTATES: Readonly<Record<FbdEditorShortcut, boolean>> = {
  DELETE_SELECTION: true,
  COPY: false,
  CUT: true,
  PASTE: true,
  DUPLICATE: true,
  SELECT_ALL: false,
  UNDO: true,
  REDO: true,
  ZOOM_100: false,
  FIT_ALL: false,
  FIT_SELECTION: false,
  NUDGE_LEFT: true,
  NUDGE_RIGHT: true,
  NUDGE_UP: true,
  NUDGE_DOWN: true,
  JOIN_REFERENCE: true,
  RENAME_REFERENCE: false,
  GO_TO_PARTNER: false,
  NAVIGATE_SOURCE: false,
  NAVIGATE_SINK: false,
}

export function resolveFbdEditorShortcut(event: FbdShortcutEventLike): FbdEditorShortcut | null {
  const mod = Boolean(event.ctrlKey) || Boolean(event.metaKey)
  const shift = Boolean(event.shiftKey)
  const alt = Boolean(event.altKey)
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key

  if (key === 'F2') return 'RENAME_REFERENCE'

  if (alt && !mod) {
    if (key === 'j') return 'JOIN_REFERENCE'
    if (key === 'g') return 'GO_TO_PARTNER'
    if (key === 'ArrowLeft') return 'NAVIGATE_SOURCE'
    if (key === 'ArrowRight') return 'NAVIGATE_SINK'
    /* Alt+mũi tên lên/xuống là MOVE_NODE_UP/DOWN của hợp đồng. */
    return null
  }

  if (alt) {
    return null
  }

  if (!mod) {
    if (key === 'Backspace') return 'DELETE_SELECTION'
    if (shift) {
      switch (key) {
        case 'ArrowLeft': return 'NUDGE_LEFT'
        case 'ArrowRight': return 'NUDGE_RIGHT'
        case 'ArrowUp': return 'NUDGE_UP'
        case 'ArrowDown': return 'NUDGE_DOWN'
        default: return null
      }
    }
    return null
  }

  switch (key) {
    case 'c': return shift ? null : 'COPY'
    case 'x': return shift ? null : 'CUT'
    case 'v': return shift ? null : 'PASTE'
    case 'd': return shift ? null : 'DUPLICATE'
    case 'a': return shift ? null : 'SELECT_ALL'
    case 'z': return shift ? 'REDO' : event.metaKey && !event.ctrlKey ? 'UNDO' : null
    case 'y': return shift ? null : event.metaKey && !event.ctrlKey ? 'REDO' : null
    case '0': return shift ? null : 'ZOOM_100'
    case '1': return shift ? null : 'FIT_ALL'
    case '2': return shift ? null : 'FIT_SELECTION'
    default: return null
  }
}

/** Bước dịch một khối bằng `Shift+mũi tên`, theo đơn vị graph. */
export function nudgeDelta(shortcut: FbdEditorShortcut, step: number): { dx: number; dy: number } | null {
  switch (shortcut) {
    case 'NUDGE_LEFT': return { dx: -step, dy: 0 }
    case 'NUDGE_RIGHT': return { dx: step, dy: 0 }
    case 'NUDGE_UP': return { dx: 0, dy: -step }
    case 'NUDGE_DOWN': return { dx: 0, dy: step }
    default: return null
  }
}
