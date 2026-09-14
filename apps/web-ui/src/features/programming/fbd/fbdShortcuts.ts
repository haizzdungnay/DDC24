/**
 * Lớp phím tắt SOẠN THẢO của FBD editor.
 *
 * Tách hẳn khỏi `keyboard.ts`. Chỗ đó là hợp đồng
 * `contracts/programming/fbd_keyboard_commands_v1.json` — 11 lệnh điều hướng
 * graph, đã băm vào `contracts/programming/fbd/manifest*` qua `keyboardSha256`
 * và `keyboardCommandCount`, nên thêm phím vào đó là một lần re-pin contract
 * (và một lần chạm cổng governance) cho một việc thuần UX. Lớp này phủ các
 * phím soạn thảo mà mọi editor đồ hoạ đều có và FBD thì chưa có phím nào:
 * Backspace, Ctrl+C/X/V/D/A, Ctrl+Shift+Z, Ctrl+0/1/2, Shift+mũi tên.
 *
 * Nó cũng vá một lỗ của `resolveFbdKeyboardCommand`: hàm đó trả `null` ngay khi
 * `metaKey` bật, nên trên macOS `Cmd+Z` không hoàn tác được gì. Ở đây `Cmd`
 * tương đương `Ctrl` — cùng một phím tắt, hai bàn phím.
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
}

export function resolveFbdEditorShortcut(event: FbdShortcutEventLike): FbdEditorShortcut | null {
  const mod = Boolean(event.ctrlKey) || Boolean(event.metaKey)
  const shift = Boolean(event.shiftKey)
  const alt = Boolean(event.altKey)
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key

  if (alt) {
    /* `Alt+mũi tên` là MOVE_NODE_UP/DOWN của hợp đồng (đổi thứ tự thực thi).
     * Không được nhận ở đây, nếu không hai tầng cùng trả lời một phím. */
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
    /* `Ctrl+Z` là của hợp đồng; ở đây chỉ nhận biến thể mà hợp đồng không
     * phủ — `Cmd+Z` của macOS và `Ctrl/Cmd+Shift+Z` (redo kiểu Adobe/VS). */
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
