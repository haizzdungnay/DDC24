import keyboardRegistryJson from '../../../../../../contracts/programming/fbd_keyboard_commands_v1.json'

import {
  FBD_MAX_BLOCKS,
  FBD_MAX_NETWORKS,
  FBD_MAX_WIRES,
  canonicalFbdJson,
  canonicalizeFbdDocument,
  cloneFbdDocument,
  findFbdPort,
  isCanonicalFbdUuid,
  type FbdDocument,
  type FbdNetwork,
  type FbdNode,
  type FbdWire,
} from './model'

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

export type FbdSelection =
  | { kind: 'network'; networkId: string }
  | { kind: 'node'; networkId: string; nodeId: string }
  | { kind: 'port'; networkId: string; nodeId: string; portId: string }
  | { kind: 'wire'; networkId: string; wireId: string }

type FbdPortSelection = Extract<FbdSelection, { kind: 'port' }>

/**
 * BUG-012 — bản cũ ghi thẳng câu tiếng Việt vào `announcement`, nên vùng
 * `aria-live` (đọc bởi screen reader) luôn tiếng Việt bất kể locale UI đang
 * chọn. Reducer là hàm thuần, không gọi được `useI18n()`, nên chỉ lưu MÃ +
 * tham số ở đây; dịch xảy ra lúc render qua `translateFbdAnnouncement`.
 */
export interface FbdAnnouncement {
  code: string
  params?: Record<string, string | number>
}

export interface FbdEditorState {
  document: FbdDocument
  selection: FbdSelection | null
  connectionFromPortId: string | null
  past: FbdDocument[]
  future: FbdDocument[]
  canEdit: boolean
  announcement: FbdAnnouncement
}

export type FbdEditorAction =
  | { type: 'REPLACE_DOCUMENT'; document: FbdDocument }
  | { type: 'SET_CAN_EDIT'; canEdit: boolean }
  | { type: 'SELECT'; selection: FbdSelection | null }
  | { type: 'SELECT_PORT_OFFSET'; offset: -1 | 1 }
  | { type: 'ADD_NETWORK'; network: FbdNetwork }
  | { type: 'ADD_NODE'; networkId: string; node: FbdNode }
  | { type: 'BEGIN_OR_COMMIT_CONNECTION'; portId: string; wire?: FbdWire }
  | { type: 'CANCEL_CONNECTION' }
  | { type: 'DELETE_SELECTION' }
  | { type: 'MOVE_NODE'; delta: -1 | 1 }
  | { type: 'UNDO' }
  | { type: 'REDO' }

export function createFbdEditorState(document: FbdDocument, canEdit = true): FbdEditorState {
  return {
    document: canonicalizeFbdDocument(document),
    selection: null,
    connectionFromPortId: null,
    past: [],
    future: [],
    canEdit,
    announcement: { code: 'idle' },
  }
}

function reject(state: FbdEditorState, announcement: FbdAnnouncement): FbdEditorState {
  return { ...state, announcement }
}

function commit(
  state: FbdEditorState,
  document: FbdDocument,
  announcement: FbdAnnouncement,
  selection: FbdSelection | null = state.selection,
): FbdEditorState {
  const past = [...state.past, state.document].slice(-FBD_HISTORY_LIMIT)
  return {
    ...state,
    document: canonicalizeFbdDocument(document),
    selection,
    connectionFromPortId: null,
    past,
    future: [],
    announcement,
  }
}

function mutationAllowed(state: FbdEditorState): boolean {
  return state.canEdit
}

function allPorts(document: FbdDocument): FbdPortSelection[] {
  return document.networks.flatMap((network) => network.nodes.flatMap((node) =>
    node.ports.map((port) => ({
      kind: 'port' as const,
      networkId: network.id,
      nodeId: node.id,
      portId: port.id,
    })),
  ))
}

function nodeCount(document: FbdDocument): number {
  return document.networks.reduce((count, network) => count + network.nodes.length, 0)
}

function wireCount(document: FbdDocument): number {
  return document.networks.reduce((count, network) => count + network.wires.length, 0)
}

function identitySet(document: FbdDocument): Set<string> {
  const ids = new Set([document.graphId])
  for (const network of document.networks) {
    ids.add(network.id)
    for (const node of network.nodes) {
      ids.add(node.id)
      node.ports.forEach((port) => ids.add(port.id))
    }
    network.wires.forEach((wire) => ids.add(wire.id))
  }
  return ids
}

function identitiesAreNew(document: FbdDocument, identities: string[]): boolean {
  const existing = identitySet(document)
  const proposed = new Set<string>()
  return identities.every((id) => isCanonicalFbdUuid(id) && !existing.has(id) &&
    !proposed.has(id) && Boolean(proposed.add(id)))
}

function deleteSelection(document: FbdDocument, selection: FbdSelection): boolean {
  const networkIndex = document.networks.findIndex((item) => item.id === selection.networkId)
  if (networkIndex < 0) return false
  const network = document.networks[networkIndex]
  if (selection.kind === 'network') {
    if (document.networks.length <= 1) return false
    document.networks.splice(networkIndex, 1)
    document.networks.forEach((item, index) => { item.order = index })
    return true
  }
  if (selection.kind === 'wire') {
    const before = network.wires.length
    network.wires = network.wires.filter((wire) => wire.id !== selection.wireId)
    return network.wires.length !== before
  }
  if (selection.kind === 'node') {
    const node = network.nodes.find((item) => item.id === selection.nodeId)
    if (!node) return false
    const portIds = new Set(node.ports.map((port) => port.id))
    network.nodes = network.nodes.filter((item) => item.id !== selection.nodeId)
    network.wires = network.wires.filter((wire) => !portIds.has(wire.from.portId) && !portIds.has(wire.to.portId))
    network.nodes.sort((left, right) => left.executionOrder - right.executionOrder)
      .forEach((item, index) => { item.executionOrder = index })
    return true
  }
  const node = network.nodes.find((item) => item.id === selection.nodeId)
  if (!node) return false
  const before = node.ports.length
  node.ports = node.ports.filter((port) => port.id !== selection.portId)
  node.ports.forEach((port, index) => { port.order = index })
  network.wires = network.wires.filter((wire) => wire.from.portId !== selection.portId && wire.to.portId !== selection.portId)
  return node.ports.length !== before
}

function connect(
  state: FbdEditorState,
  targetPortId: string,
  wire: FbdWire | undefined,
): FbdEditorState {
  const target = findFbdPort(state.document, targetPortId)
  if (!target) return reject(state, { code: 'port-not-found' })
  if (!state.connectionFromPortId) {
    if (target.port.direction !== 'OUTPUT') return reject(state, { code: 'select-output-port' })
    return { ...state, connectionFromPortId: targetPortId, announcement: { code: 'source-selected', params: { port: target.port.name } } }
  }
  const source = findFbdPort(state.document, state.connectionFromPortId)
  if (!source || target.port.direction !== 'INPUT' || source.network.id !== target.network.id ||
      source.port.dataType !== target.port.dataType || source.port.unit !== target.port.unit) {
    return reject(state, { code: 'connect-incompatible' })
  }
  if (!wire || wire.from.portId !== source.port.id || wire.from.nodeId !== source.node.id ||
      wire.to.portId !== target.port.id || wire.to.nodeId !== target.node.id) {
    return reject(state, { code: 'wire-mismatch' })
  }
  if (!identitiesAreNew(state.document, [wire.id])) return reject(state, { code: 'wire-uuid-invalid' })
  if (source.node.kind !== 'FUNCTION_BLOCK' && target.node.kind !== 'FUNCTION_BLOCK' &&
      source.node.executionOrder >= target.node.executionOrder) {
    return reject(state, { code: 'connect-reverse-order' })
  }
  if (wireCount(state.document) >= FBD_MAX_WIRES || target.network.wires.some((item) => item.to.portId === target.port.id)) {
    return reject(state, { code: 'input-has-driver-or-limit' })
  }
  const document = cloneFbdDocument(state.document)
  const network = document.networks.find((item) => item.id === target.network.id)
  if (!network) return reject(state, { code: 'network-missing' })
  network.wires.push(wire)
  return commit(state, document, { code: 'wire-connected', params: { from: source.port.name, to: target.port.name } })
}

export function fbdEditorReducer(state: FbdEditorState, action: FbdEditorAction): FbdEditorState {
  switch (action.type) {
    case 'REPLACE_DOCUMENT':
      if (canonicalFbdJson(action.document) === canonicalFbdJson(state.document)) return state
      return {
        ...state,
        document: canonicalizeFbdDocument(action.document),
        selection: null,
        connectionFromPortId: null,
        past: [],
        future: [],
        announcement: { code: 'draft-synced-external' },
      }
    case 'SET_CAN_EDIT':
      return { ...state, canEdit: action.canEdit, announcement: { code: action.canEdit ? 'edit-enabled' : 'read-only-mode' } }
    case 'SELECT':
      return { ...state, selection: action.selection, announcement: { code: action.selection ? 'selection-changed' : 'selection-cleared' } }
    case 'SELECT_PORT_OFFSET': { // Duyệt tuần tự bảo đảm thao tác hoàn tất chỉ bằng bàn phím.
      const ports = allPorts(state.document)
      if (!ports.length) return reject(state, { code: 'no-ports' })
      const selection = state.selection
      const selectedPortId = selection?.kind === 'port' ? selection.portId : null
      const current = selectedPortId
        ? ports.findIndex((port) => port.portId === selectedPortId)
        : -1
      const next = current < 0
        ? (action.offset > 0 ? 0 : ports.length - 1)
        : (current + action.offset + ports.length) % ports.length
      return { ...state, selection: ports[next], announcement: { code: 'port-selected', params: { index: next + 1, total: ports.length } } }
    }
    case 'ADD_NETWORK': {
      if (!mutationAllowed(state)) return reject(state, { code: 'no-edit-permission' })
      if (state.document.networks.length >= FBD_MAX_NETWORKS) return reject(state, { code: 'network-limit-reached' })
      const networkIdentities = [
        action.network.id,
        ...action.network.nodes.flatMap((node) => [node.id, ...node.ports.map((port) => port.id)]),
        ...action.network.wires.map((wire) => wire.id),
      ]
      if (!identitiesAreNew(state.document, networkIdentities)) return reject(state, { code: 'network-uuid-invalid' })
      const document = cloneFbdDocument(state.document)
      const network = { ...action.network, order: document.networks.length }
      document.networks.push(network)
      return commit(state, document, { code: 'network-added', params: { name: network.name } }, { kind: 'network', networkId: network.id })
    }
    case 'ADD_NODE': {
      if (!mutationAllowed(state)) return reject(state, { code: 'no-edit-permission' })
      if (nodeCount(state.document) >= FBD_MAX_BLOCKS) return reject(state, { code: 'block-limit-reached' })
      if (!identitiesAreNew(state.document, [action.node.id, ...action.node.ports.map((port) => port.id)])) {
        return reject(state, { code: 'block-uuid-invalid' })
      }
      const document = cloneFbdDocument(state.document)
      const network = document.networks.find((item) => item.id === action.networkId)
      if (!network) return reject(state, { code: 'network-not-found' })
      const node = { ...action.node, executionOrder: network.nodes.length }
      network.nodes.push(node)
      return commit(state, document, { code: 'block-added', params: { type: node.typeRef } }, {
        kind: 'node', networkId: network.id, nodeId: node.id,
      })
    }
    case 'BEGIN_OR_COMMIT_CONNECTION':
      if (!mutationAllowed(state)) return reject(state, { code: 'no-edit-permission' })
      return connect(state, action.portId, action.wire)
    case 'CANCEL_CONNECTION':
      return { ...state, connectionFromPortId: null, announcement: { code: 'connection-cancelled' } }
    case 'DELETE_SELECTION': {
      if (!mutationAllowed(state)) return reject(state, { code: 'no-edit-permission' })
      if (!state.selection) return reject(state, { code: 'no-selection' })
      const document = cloneFbdDocument(state.document)
      if (!deleteSelection(document, state.selection)) return reject(state, { code: 'cannot-delete-selection' })
      return commit(state, document, { code: 'selection-deleted' }, null)
    }
    case 'MOVE_NODE': {
      if (!mutationAllowed(state)) return reject(state, { code: 'no-edit-permission' })
      if (state.selection?.kind !== 'node') return reject(state, { code: 'select-block-to-reorder' })
      const selection = state.selection
      const document = cloneFbdDocument(state.document)
      const network = document.networks.find((item) => item.id === selection.networkId)
      if (!network) return reject(state, { code: 'network-not-found' })
      const ordered = [...network.nodes].sort((left, right) => left.executionOrder - right.executionOrder)
      const index = ordered.findIndex((item) => item.id === selection.nodeId)
      const nextIndex = index + action.delta
      if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return reject(state, { code: 'reorder-at-boundary' })
      const currentOrder = ordered[index].executionOrder
      ordered[index].executionOrder = ordered[nextIndex].executionOrder
      ordered[nextIndex].executionOrder = currentOrder
      return commit(state, document, { code: 'block-reordered' })
    }
    case 'UNDO': {
      if (!mutationAllowed(state)) return reject(state, { code: 'no-edit-permission' })
      const previous = state.past[state.past.length - 1]
      if (!previous) return reject(state, { code: 'nothing-to-undo' })
      return {
        ...state, document: previous, selection: null, connectionFromPortId: null,
        past: state.past.slice(0, -1), future: [state.document, ...state.future].slice(0, FBD_HISTORY_LIMIT),
        announcement: { code: 'undone' },
      }
    }
    case 'REDO': {
      if (!mutationAllowed(state)) return reject(state, { code: 'no-edit-permission' })
      const [next, ...future] = state.future
      if (!next) return reject(state, { code: 'nothing-to-redo' })
      return {
        ...state, document: next, selection: null, connectionFromPortId: null,
        past: [...state.past, state.document].slice(-FBD_HISTORY_LIMIT), future,
        announcement: { code: 'redone' },
      }
    }
  }
}

/** Dịch `announcement` sang locale hiện tại lúc render (component gọi
 *  `useI18n().pick`) — reducer ở trên chỉ lưu mã, không quyết định ngôn ngữ. */
export function translateFbdAnnouncement(pick: (vi: string, en: string) => string, announcement: FbdAnnouncement): string {
  const p = announcement.params ?? {}
  switch (announcement.code) {
    case 'idle': return ''
    case 'port-not-found': return pick('Không tìm thấy port được chọn', 'Selected port not found')
    case 'select-output-port': return pick('Hãy chọn port OUTPUT để bắt đầu nối', 'Select an OUTPUT port to start connecting')
    case 'source-selected': return pick(`Đã chọn nguồn ${p.port}`, `Selected source ${p.port}`)
    case 'connect-incompatible': return pick('Không thể nối: port phải cùng network, đúng hướng, type và unit', 'Cannot connect: ports must share network, direction, type and unit')
    case 'wire-mismatch': return pick('Payload wire không khớp hai port đã chọn', 'Wire payload does not match the two selected ports')
    case 'wire-uuid-invalid': return pick('UUID wire không canonical hoặc bị trùng', 'Wire UUID is not canonical or is duplicated')
    case 'connect-reverse-order': return pick('Không thể nối ngược thứ tự thực thi combinational', 'Cannot connect against combinational execution order')
    case 'input-has-driver-or-limit': return pick('Input đã có driver hoặc graph đã đạt giới hạn wire', 'Input already has a driver, or the graph reached the wire limit')
    case 'network-missing': return pick('Network không còn tồn tại', 'Network no longer exists')
    case 'wire-connected': return pick(`Đã nối ${p.from} tới ${p.to}`, `Connected ${p.from} to ${p.to}`)
    case 'draft-synced-external': return pick('Draft đã được đồng bộ từ nguồn ngoài', 'Draft synced from an external source')
    case 'edit-enabled': return pick('Đã bật quyền sửa', 'Edit mode enabled')
    case 'read-only-mode': return pick('Chế độ chỉ đọc', 'Read-only mode')
    case 'selection-changed': return pick('Đã đổi vùng chọn', 'Selection changed')
    case 'selection-cleared': return pick('Đã bỏ chọn', 'Selection cleared')
    case 'no-ports': return pick('Graph không có port', 'Graph has no ports')
    case 'port-selected': return pick(`Đã chọn port ${p.index}/${p.total}`, `Selected port ${p.index}/${p.total}`)
    case 'no-edit-permission': return pick('Không có quyền sửa Draft', 'No permission to edit the Draft')
    case 'network-limit-reached': return pick('Đã đạt giới hạn network', 'Reached the network limit')
    case 'network-uuid-invalid': return pick('UUID network/node/port/wire không canonical hoặc bị trùng', 'Network/node/port/wire UUID is not canonical or is duplicated')
    case 'network-added': return pick(`Đã thêm network ${p.name}`, `Added network ${p.name}`)
    case 'block-limit-reached': return pick('Đã đạt giới hạn 256 block', 'Reached the 256-block limit')
    case 'block-uuid-invalid': return pick('UUID block/port không canonical hoặc bị trùng', 'Block/port UUID is not canonical or is duplicated')
    case 'network-not-found': return pick('Không tìm thấy network', 'Network not found')
    case 'block-added': return pick(`Đã thêm block ${p.type}`, `Added block ${p.type}`)
    case 'connection-cancelled': return pick('Đã hủy thao tác nối', 'Connection cancelled')
    case 'no-selection': return pick('Chưa chọn phần tử cần xóa', 'No element selected to delete')
    case 'cannot-delete-selection': return pick('Không thể xóa phần tử đã chọn', 'Cannot delete the selected element')
    case 'selection-deleted': return pick('Đã xóa phần tử và các wire liên quan', 'Deleted the element and its related wires')
    case 'select-block-to-reorder': return pick('Hãy chọn block cần đổi thứ tự', 'Select a block to reorder')
    case 'reorder-at-boundary': return pick('Block đã ở biên thứ tự', 'Block is already at the order boundary')
    case 'block-reordered': return pick('Đã đổi thứ tự thực thi block', 'Block execution order changed')
    case 'nothing-to-undo': return pick('Không còn thay đổi để hoàn tác', 'No more changes to undo')
    case 'undone': return pick('Đã hoàn tác', 'Undone')
    case 'nothing-to-redo': return pick('Không còn thay đổi để làm lại', 'No more changes to redo')
    case 'redone': return pick('Đã làm lại', 'Redone')
    default: return ''
  }
}

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
