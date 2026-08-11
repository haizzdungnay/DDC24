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

export interface FbdEditorState {
  document: FbdDocument
  selection: FbdSelection | null
  connectionFromPortId: string | null
  past: FbdDocument[]
  future: FbdDocument[]
  canEdit: boolean
  announcement: string
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
    announcement: '',
  }
}

function reject(state: FbdEditorState, announcement: string): FbdEditorState {
  return { ...state, announcement }
}

function commit(
  state: FbdEditorState,
  document: FbdDocument,
  announcement: string,
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
  if (!target) return reject(state, 'Không tìm thấy port được chọn')
  if (!state.connectionFromPortId) {
    if (target.port.direction !== 'OUTPUT') return reject(state, 'Hãy chọn port OUTPUT để bắt đầu nối')
    return { ...state, connectionFromPortId: targetPortId, announcement: `Đã chọn nguồn ${target.port.name}` }
  }
  const source = findFbdPort(state.document, state.connectionFromPortId)
  if (!source || target.port.direction !== 'INPUT' || source.network.id !== target.network.id ||
      source.port.dataType !== target.port.dataType || source.port.unit !== target.port.unit) {
    return reject(state, 'Không thể nối: port phải cùng network, đúng hướng, type và unit')
  }
  if (!wire || wire.from.portId !== source.port.id || wire.from.nodeId !== source.node.id ||
      wire.to.portId !== target.port.id || wire.to.nodeId !== target.node.id) {
    return reject(state, 'Payload wire không khớp hai port đã chọn')
  }
  if (!identitiesAreNew(state.document, [wire.id])) return reject(state, 'UUID wire không canonical hoặc bị trùng')
  if (source.node.kind !== 'FUNCTION_BLOCK' && target.node.kind !== 'FUNCTION_BLOCK' &&
      source.node.executionOrder >= target.node.executionOrder) {
    return reject(state, 'Không thể nối ngược thứ tự thực thi combinational')
  }
  if (wireCount(state.document) >= FBD_MAX_WIRES || target.network.wires.some((item) => item.to.portId === target.port.id)) {
    return reject(state, 'Input đã có driver hoặc graph đã đạt giới hạn wire')
  }
  const document = cloneFbdDocument(state.document)
  const network = document.networks.find((item) => item.id === target.network.id)
  if (!network) return reject(state, 'Network không còn tồn tại')
  network.wires.push(wire)
  return commit(state, document, `Đã nối ${source.port.name} tới ${target.port.name}`)
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
        announcement: 'Draft đã được đồng bộ từ nguồn ngoài',
      }
    case 'SET_CAN_EDIT':
      return { ...state, canEdit: action.canEdit, announcement: action.canEdit ? 'Đã bật quyền sửa' : 'Chế độ chỉ đọc' }
    case 'SELECT':
      return { ...state, selection: action.selection, announcement: action.selection ? 'Đã đổi vùng chọn' : 'Đã bỏ chọn' }
    case 'SELECT_PORT_OFFSET': { // Duyệt tuần tự bảo đảm thao tác hoàn tất chỉ bằng bàn phím.
      const ports = allPorts(state.document)
      if (!ports.length) return reject(state, 'Graph không có port')
      const selection = state.selection
      const selectedPortId = selection?.kind === 'port' ? selection.portId : null
      const current = selectedPortId
        ? ports.findIndex((port) => port.portId === selectedPortId)
        : -1
      const next = current < 0
        ? (action.offset > 0 ? 0 : ports.length - 1)
        : (current + action.offset + ports.length) % ports.length
      return { ...state, selection: ports[next], announcement: `Đã chọn port ${next + 1}/${ports.length}` }
    }
    case 'ADD_NETWORK': {
      if (!mutationAllowed(state)) return reject(state, 'Không có quyền sửa Draft')
      if (state.document.networks.length >= FBD_MAX_NETWORKS) return reject(state, 'Đã đạt giới hạn network')
      const networkIdentities = [
        action.network.id,
        ...action.network.nodes.flatMap((node) => [node.id, ...node.ports.map((port) => port.id)]),
        ...action.network.wires.map((wire) => wire.id),
      ]
      if (!identitiesAreNew(state.document, networkIdentities)) return reject(state, 'UUID network/node/port/wire không canonical hoặc bị trùng')
      const document = cloneFbdDocument(state.document)
      const network = { ...action.network, order: document.networks.length }
      document.networks.push(network)
      return commit(state, document, `Đã thêm network ${network.name}`, { kind: 'network', networkId: network.id })
    }
    case 'ADD_NODE': {
      if (!mutationAllowed(state)) return reject(state, 'Không có quyền sửa Draft')
      if (nodeCount(state.document) >= FBD_MAX_BLOCKS) return reject(state, 'Đã đạt giới hạn 256 block')
      if (!identitiesAreNew(state.document, [action.node.id, ...action.node.ports.map((port) => port.id)])) {
        return reject(state, 'UUID block/port không canonical hoặc bị trùng')
      }
      const document = cloneFbdDocument(state.document)
      const network = document.networks.find((item) => item.id === action.networkId)
      if (!network) return reject(state, 'Không tìm thấy network')
      const node = { ...action.node, executionOrder: network.nodes.length }
      network.nodes.push(node)
      return commit(state, document, `Đã thêm block ${node.typeRef}`, {
        kind: 'node', networkId: network.id, nodeId: node.id,
      })
    }
    case 'BEGIN_OR_COMMIT_CONNECTION':
      if (!mutationAllowed(state)) return reject(state, 'Không có quyền sửa Draft')
      return connect(state, action.portId, action.wire)
    case 'CANCEL_CONNECTION':
      return { ...state, connectionFromPortId: null, announcement: 'Đã hủy thao tác nối' }
    case 'DELETE_SELECTION': {
      if (!mutationAllowed(state)) return reject(state, 'Không có quyền sửa Draft')
      if (!state.selection) return reject(state, 'Chưa chọn phần tử cần xóa')
      const document = cloneFbdDocument(state.document)
      if (!deleteSelection(document, state.selection)) return reject(state, 'Không thể xóa phần tử đã chọn')
      return commit(state, document, 'Đã xóa phần tử và các wire liên quan', null)
    }
    case 'MOVE_NODE': {
      if (!mutationAllowed(state)) return reject(state, 'Không có quyền sửa Draft')
      if (state.selection?.kind !== 'node') return reject(state, 'Hãy chọn block cần đổi thứ tự')
      const selection = state.selection
      const document = cloneFbdDocument(state.document)
      const network = document.networks.find((item) => item.id === selection.networkId)
      if (!network) return reject(state, 'Không tìm thấy network')
      const ordered = [...network.nodes].sort((left, right) => left.executionOrder - right.executionOrder)
      const index = ordered.findIndex((item) => item.id === selection.nodeId)
      const nextIndex = index + action.delta
      if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return reject(state, 'Block đã ở biên thứ tự')
      const currentOrder = ordered[index].executionOrder
      ordered[index].executionOrder = ordered[nextIndex].executionOrder
      ordered[nextIndex].executionOrder = currentOrder
      return commit(state, document, 'Đã đổi thứ tự thực thi block')
    }
    case 'UNDO': {
      if (!mutationAllowed(state)) return reject(state, 'Không có quyền sửa Draft')
      const previous = state.past[state.past.length - 1]
      if (!previous) return reject(state, 'Không còn thay đổi để hoàn tác')
      return {
        ...state, document: previous, selection: null, connectionFromPortId: null,
        past: state.past.slice(0, -1), future: [state.document, ...state.future].slice(0, FBD_HISTORY_LIMIT),
        announcement: 'Đã hoàn tác',
      }
    }
    case 'REDO': {
      if (!mutationAllowed(state)) return reject(state, 'Không có quyền sửa Draft')
      const [next, ...future] = state.future
      if (!next) return reject(state, 'Không còn thay đổi để làm lại')
      return {
        ...state, document: next, selection: null, connectionFromPortId: null,
        past: [...state.past, state.document].slice(-FBD_HISTORY_LIMIT), future,
        announcement: 'Đã làm lại',
      }
    }
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
