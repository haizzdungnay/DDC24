import keyboardRegistryJson from '../../../../../../contracts/programming/fbd_keyboard_commands_v1.json'

export type FbdKeyboardCommand =
  | 'ADD_NETWORK'
  | 'ADD_BLOCK'
  | 'SELECT_NEXT_PORT'
  | 'SELECT_PREVIOUS_PORT'
  | 'BEGIN_OR_COMMIT_CONNECTION'
  | 'CANCEL_CONNECTION'
  | 'DELETE_SELECTION'
  | 'MOVE_NODE_UP'
  | 'MOVE_NODE_DOWN'
  | 'UNDO'
  | 'REDO'

interface KeyboardCommandEntry {
  id: FbdKeyboardCommand
  key: string
  mutatesDraft: boolean
  requiresSelection: boolean
  messageKey: string
}

interface KeyboardRegistry {
  contractId: 'PROGRAMMING-FBD-KEYBOARD-V1'
  version: 1
  historyLimit: 50
  commands: KeyboardCommandEntry[]
}

export const FBD_KEYBOARD_REGISTRY = keyboardRegistryJson as KeyboardRegistry
export const FBD_HISTORY_LIMIT = FBD_KEYBOARD_REGISTRY.historyLimit

export interface FbdKeyboardEventLike {
  key: string
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
}

export function normalizeFbdShortcut(event: FbdKeyboardEventLike): string {
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Control')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  parts.push(key)
  return parts.join('+')
}

export function resolveFbdKeyboardCommand(event: FbdKeyboardEventLike): FbdKeyboardCommand | null {
  if (event.metaKey) return null
  const shortcut = normalizeFbdShortcut(event)
  return FBD_KEYBOARD_REGISTRY.commands.find((command) => command.key === shortcut)?.id ?? null
}
