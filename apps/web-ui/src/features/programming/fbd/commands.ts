import keyboardRegistryJson from '../../../../../../contracts/programming/fbd_keyboard_commands_v1.json'

import {
  FBD_DATA_TYPES,
  FBD_MAX_BLOCKS,
  FBD_MAX_NETWORKS,
  FBD_MAX_WIRES,
  canonicalFbdJson,
  canonicalizeFbdDocument,
  cloneFbdDocument,
  FBD_MAX_LAYOUT_COORDINATE,
  findFbdPort,
  isCanonicalFbdUuid,
  isFbdIdentifier,
  type FbdDataType,
  type FbdDocument,
  type FbdNetwork,
  type FbdNode,
  type FbdParameterValue,
  type FbdPoint,
  type FbdWire,
} from './model'
import { fbdPaletteEntry, isValidConstantLiteral } from './palette'

export type { FbdPoint, FbdDocument } from './model'

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
  | { kind: 'multi-node'; networkId: string; nodeIds: string[] }
  | { kind: 'port'; networkId: string; nodeId: string; portId: string }
  | { kind: 'wire'; networkId: string; wireId: string }

type FbdPortSelection = Extract<FbdSelection, { kind: 'port' }>

export function areSelectionsEqual(a: FbdSelection | null, b: FbdSelection | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.kind !== b.kind || a.networkId !== b.networkId) return false
  if (a.kind === 'network') return true
  if (a.kind === 'node' && b.kind === 'node') return a.nodeId === b.nodeId
  if (a.kind === 'port' && b.kind === 'port') return a.nodeId === b.nodeId && a.portId === b.portId
  if (a.kind === 'wire' && b.kind === 'wire') return a.wireId === b.wireId
  if (a.kind === 'multi-node' && b.kind === 'multi-node') {
    if (a.nodeIds.length !== b.nodeIds.length) return false
    const sortedA = [...a.nodeIds].sort()
    const sortedB = [...b.nodeIds].sort()
    return sortedA.every((val, idx) => val === sortedB[idx])
  }
  return false
}

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
  selectionRevision: number
  connectionFromPortId: string | null
  past: FbdDocument[]
  future: FbdDocument[]
  canEdit: boolean
  announcement: FbdAnnouncement
}

/**
 * Toạ độ hợp lệ theo đúng trần của hợp đồng (`fbd_v1.schema.json` §layout).
 *
 * Làm tròn về số nguyên: một pixel lẻ 0,333 không có ý nghĩa hiển thị nào
 * nhưng đủ để làm byte tài liệu đổi mỗi lần kéo, tức mỗi lần kéo là một Draft
 * "bẩn" khác. `null` = ngoài trần hoặc không phải số hữu hạn, và đó là TỪ CHỐI
 * chứ không phải kẹp về biên — kẹp âm thầm sẽ đặt block vào chỗ người dùng
 * không hề chọn.
 */
function clampLayoutCoordinate(value: number): number | null {
  if (!Number.isFinite(value)) return null
  const rounded = Math.round(value)
  if (rounded < -FBD_MAX_LAYOUT_COORDINATE || rounded > FBD_MAX_LAYOUT_COORDINATE) return null
  return rounded
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
  | { type: 'SET_NODE_POSITION'; networkId: string; nodeId: string; x: number; y: number }
  | {
      type: 'MULTI_MOVE'
      networkId: string
      moves: Array<{ nodeId: string; x: number; y: number }>
      expectedSelectionRevision?: number
    }
  | {
      type: 'SET_LAYOUT_BATCH'
      networkId: string
      positions: Record<string, FbdPoint>
      expectedSelectionRevision?: number
    }
  | {
      type: 'PASTE_SUBGRAPH'
      targetNetworkId: string
      nodes: FbdNode[]
      wires: FbdWire[]
      layoutNodes?: Record<string, FbdPoint>
      expectedSelectionRevision?: number
    }
  | { type: 'SET_NODE_VARIABLE'; networkId: string; nodeId: string; variable: string; unit: string | null }
  | { type: 'SET_NODE_VALUE'; networkId: string; nodeId: string; value: FbdParameterValue }
  | { type: 'SET_NODE_TYPE'; networkId: string; nodeId: string; dataType: FbdDataType }
  | { type: 'SET_NODE_FB_PARAMS'; networkId: string; nodeId: string; instance: string | null; retained: boolean }
  | { type: 'UNDO' }
  | { type: 'REDO' }

export function createFbdEditorState(document: FbdDocument, canEdit = true): FbdEditorState {
  return {
    document: canonicalizeFbdDocument(document),
    selection: null,
    selectionRevision: 0,
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
    selectionRevision: state.selectionRevision + 1,
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
  if (selection.kind === 'multi-node') {
    const toDeleteSet = new Set(selection.nodeIds)
    const nodesToDelete = network.nodes.filter((item) => toDeleteSet.has(item.id))
    if (nodesToDelete.length === 0) return false
    const portIds = new Set(nodesToDelete.flatMap((node) => node.ports.map((port) => port.id)))
    network.nodes = network.nodes.filter((item) => !toDeleteSet.has(item.id))
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

/* WP-05..07 (FBD_EDITOR_DESIGN.md §3.1): đổi kiểu toán hạng T cho node đa
 * hình phải giữ nguyên id/order từng port (wire trỏ theo portId, không theo
 * tên) — chỉ ghi đè `dataType` cho các port khớp tên với `entry.buildPorts`. */
function applyOperandType(node: FbdNode, dataType: FbdDataType): void {
  const entry = fbdPaletteEntry(node.typeRef)
  if (!entry) return
  const templates = entry.buildPorts(dataType)
  node.ports = node.ports.map((port) => {
    const template = templates.find((item) => item.name === port.name)
    return template ? { ...port, dataType: template.dataType } : port
  })
}

function findNode(document: FbdDocument, networkId: string, nodeId: string): { network: FbdNetwork; node: FbdNode } | null {
  const network = document.networks.find((item) => item.id === networkId)
  const node = network?.nodes.find((item) => item.id === nodeId)
  return network && node ? { network, node } : null
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
    case 'SELECT': {
      if (areSelectionsEqual(state.selection, action.selection)) {
        return state
      }
      return {
        ...state,
        selection: action.selection,
        selectionRevision: state.selectionRevision + 1,
        announcement: { code: action.selection ? 'selection-changed' : 'selection-cleared' },
      }
    }
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
    case 'SET_NODE_POSITION': {
      /* `T59-806` — kéo một block chỉ đổi HÌNH HỌC. Không đụng
       * `executionOrder`: suy thứ tự thực thi từ x/y nghĩa là kéo một block
       * sang trái sẽ âm thầm đổi chương trình đang chạy. Thứ tự vẫn do người
       * dùng đặt tường minh bằng `MOVE_NODE`. */
      if (!mutationAllowed(state)) return reject(state, { code: 'no-edit-permission' })
      const document = cloneFbdDocument(state.document)
      if (!findNode(document, action.networkId, action.nodeId)) return reject(state, { code: 'node-not-found' })
      const x = clampLayoutCoordinate(action.x)
      const y = clampLayoutCoordinate(action.y)
      if (x === null || y === null) return reject(state, { code: 'invalid-position' })
      const layout = document.layout ?? { schemaVersion: 1 as const, nodes: {} }
      document.layout = { schemaVersion: 1, nodes: { ...layout.nodes, [action.nodeId]: { x, y } } }
      return commit(state, document, { code: 'block-moved' })
    }
    case 'MULTI_MOVE': {
      if (!mutationAllowed(state)) return reject(state, { code: 'no-edit-permission' })
      if (
        action.expectedSelectionRevision !== undefined &&
        action.expectedSelectionRevision !== state.selectionRevision
      ) {
        return reject(state, { code: 'selection-revision-mismatch' })
      }
      const document = cloneFbdDocument(state.document)
      const network = document.networks.find((item) => item.id === action.networkId)
      if (!network) return reject(state, { code: 'network-not-found' })

      const layout = document.layout ?? { schemaVersion: 1 as const, nodes: {} }
      const newNodesMap = { ...layout.nodes }
      let hasChanges = false

      for (const move of action.moves) {
        if (!network.nodes.some((n) => n.id === move.nodeId)) {
          return reject(state, { code: 'node-not-found' })
        }
        const x = clampLayoutCoordinate(move.x)
        const y = clampLayoutCoordinate(move.y)
        if (x === null || y === null) return reject(state, { code: 'invalid-position' })

        const currentPos = newNodesMap[move.nodeId]
        if (!currentPos || currentPos.x !== x || currentPos.y !== y) {
          newNodesMap[move.nodeId] = { x, y }
          hasChanges = true
        }
      }

      if (!hasChanges) {
        return state
      }

      document.layout = { schemaVersion: 1, nodes: newNodesMap }
      return commit(state, document, { code: 'blocks-moved' })
    }
    case 'SET_LAYOUT_BATCH': {
      if (!mutationAllowed(state)) return reject(state, { code: 'no-edit-permission' })
      if (
        action.expectedSelectionRevision !== undefined &&
        action.expectedSelectionRevision !== state.selectionRevision
      ) {
        return reject(state, { code: 'selection-revision-mismatch' })
      }
      const document = cloneFbdDocument(state.document)
      const network = document.networks.find((item) => item.id === action.networkId)
      if (!network) return reject(state, { code: 'network-not-found' })

      const layout = document.layout ?? { schemaVersion: 1 as const, nodes: {} }
      const newNodesMap = { ...layout.nodes }
      let hasChanges = false

      for (const [nodeId, pt] of Object.entries(action.positions)) {
        if (!network.nodes.some((n) => n.id === nodeId)) {
          return reject(state, { code: 'node-not-found' })
        }
        const x = clampLayoutCoordinate(pt.x)
        const y = clampLayoutCoordinate(pt.y)
        if (x === null || y === null) return reject(state, { code: 'invalid-position' })

        const currentPos = newNodesMap[nodeId]
        if (!currentPos || currentPos.x !== x || currentPos.y !== y) {
          newNodesMap[nodeId] = { x, y }
          hasChanges = true
        }
      }

      if (!hasChanges) {
        return state
      }

      document.layout = { schemaVersion: 1, nodes: newNodesMap }
      return commit(state, document, { code: 'blocks-moved' })
    }
    case 'PASTE_SUBGRAPH': {
      if (!mutationAllowed(state)) return reject(state, { code: 'no-edit-permission' })
      if (
        action.expectedSelectionRevision !== undefined &&
        action.expectedSelectionRevision !== state.selectionRevision
      ) {
        return reject(state, { code: 'selection-revision-mismatch' })
      }
      if (nodeCount(state.document) + action.nodes.length > FBD_MAX_BLOCKS) {
        return reject(state, { code: 'block-limit-reached' })
      }
      if (wireCount(state.document) + action.wires.length > FBD_MAX_WIRES) {
        return reject(state, { code: 'wire-limit-reached' })
      }

      const allNewIds = [
        ...action.nodes.flatMap((n) => [n.id, ...n.ports.map((p) => p.id)]),
        ...action.wires.map((w) => w.id),
      ]
      if (!identitiesAreNew(state.document, allNewIds)) {
        return reject(state, { code: 'block-uuid-invalid' })
      }

      const document = cloneFbdDocument(state.document)
      const network = document.networks.find((item) => item.id === action.targetNetworkId)
      if (!network) return reject(state, { code: 'network-not-found' })

      let nextOrder = network.nodes.length
      const nodesToAdd = action.nodes.map((node) => ({
        ...node,
        executionOrder: nextOrder++,
      }))
      network.nodes.push(...nodesToAdd)
      network.wires.push(...action.wires)

      if (action.layoutNodes && Object.keys(action.layoutNodes).length > 0) {
        const layout = document.layout ?? { schemaVersion: 1 as const, nodes: {} }
        const newNodesMap = { ...layout.nodes }
        for (const [nodeId, pt] of Object.entries(action.layoutNodes)) {
          const x = clampLayoutCoordinate(pt.x)
          const y = clampLayoutCoordinate(pt.y)
          if (x !== null && y !== null) {
            newNodesMap[nodeId] = { x, y }
          }
        }
        document.layout = { schemaVersion: 1, nodes: newNodesMap }
      }

      const newSelection: FbdSelection = {
        kind: 'multi-node',
        networkId: action.targetNetworkId,
        nodeIds: action.nodes.map((n) => n.id),
      }

      return commit(state, document, { code: 'subgraph-pasted' }, newSelection)
    }
    case 'SET_NODE_VARIABLE': {
      if (!mutationAllowed(state)) return reject(state, { code: 'no-edit-permission' })
      const document = cloneFbdDocument(state.document)
      const found = findNode(document, action.networkId, action.nodeId)
      if (!found || (found.node.kind !== 'INPUT' && found.node.kind !== 'OUTPUT')) return reject(state, { code: 'node-not-found' })
      if (!isFbdIdentifier(action.variable)) return reject(state, { code: 'invalid-variable-name' })
      if (action.unit !== null && (action.unit.length < 1 || action.unit.length > 32)) return reject(state, { code: 'invalid-unit' })
      found.node.parameters = { ...found.node.parameters, variable: action.variable }
      found.node.ports[0].unit = action.unit
      return commit(state, document, { code: 'node-variable-set', params: { variable: action.variable } })
    }
    case 'SET_NODE_VALUE': {
      if (!mutationAllowed(state)) return reject(state, { code: 'no-edit-permission' })
      const document = cloneFbdDocument(state.document)
      const found = findNode(document, action.networkId, action.nodeId)
      if (!found || found.node.kind !== 'CONSTANT') return reject(state, { code: 'node-not-found' })
      if (!isValidConstantLiteral(found.node.typeRef as FbdDataType, action.value)) return reject(state, { code: 'invalid-constant-value' })
      found.node.parameters = { ...found.node.parameters, value: action.value }
      return commit(state, document, { code: 'node-value-set' })
    }
    case 'SET_NODE_TYPE': {
      if (!mutationAllowed(state)) return reject(state, { code: 'no-edit-permission' })
      const document = cloneFbdDocument(state.document)
      const found = findNode(document, action.networkId, action.nodeId)
      if (!found) return reject(state, { code: 'node-not-found' })
      const { node } = found
      if (!FBD_DATA_TYPES.includes(action.dataType)) return reject(state, { code: 'invalid-data-type' })
      if (node.kind === 'INPUT' || node.kind === 'OUTPUT' || node.kind === 'CONSTANT') {
        node.typeRef = action.dataType
        node.ports = node.ports.map((port) => ({ ...port, dataType: action.dataType }))
        if (node.kind === 'CONSTANT' && !isValidConstantLiteral(action.dataType, node.parameters.value)) {
          node.parameters = { ...node.parameters, value: action.dataType === 'BOOL' ? false : action.dataType === 'TIME' ? 'T#0s' : 0 }
        }
      } else {
        const entry = fbdPaletteEntry(node.typeRef)
        if (!entry || !entry.polymorphic || !entry.allowedTypes.includes(action.dataType)) return reject(state, { code: 'invalid-data-type' })
        applyOperandType(node, action.dataType)
      }
      return commit(state, document, { code: 'node-type-set', params: { type: action.dataType } })
    }
    case 'SET_NODE_FB_PARAMS': {
      if (!mutationAllowed(state)) return reject(state, { code: 'no-edit-permission' })
      const document = cloneFbdDocument(state.document)
      const found = findNode(document, action.networkId, action.nodeId)
      if (!found || found.node.kind !== 'FUNCTION_BLOCK') return reject(state, { code: 'node-not-found' })
      if (action.instance !== null && !isFbdIdentifier(action.instance)) return reject(state, { code: 'invalid-instance-name' })
      const parameters: Record<string, FbdParameterValue> = {}
      if (action.instance !== null) parameters.instance = action.instance
      if (action.retained) parameters.retained = true
      found.node.parameters = parameters
      return commit(state, document, { code: 'node-fb-params-set' })
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
    case 'block-moved': return pick('Đã đổi vị trí block trên canvas', 'Block moved on the canvas')
    case 'invalid-position': return pick('Vị trí ngoài phạm vi canvas cho phép', 'Position is outside the allowed canvas range')
    case 'node-not-found': return pick('Không tìm thấy node đã chọn', 'Selected node not found')
    case 'invalid-variable-name': return pick('Tên biến không hợp lệ', 'Invalid variable name')
    case 'invalid-unit': return pick('Đơn vị không hợp lệ (1-32 ký tự)', 'Invalid unit (1-32 characters)')
    case 'node-variable-set': return pick(`Đã đặt biến ${p.variable}`, `Set variable ${p.variable}`)
    case 'invalid-constant-value': return pick('Giá trị hằng số không hợp lệ với kiểu đã chọn', 'Constant value is not valid for the selected type')
    case 'node-value-set': return pick('Đã cập nhật giá trị hằng số', 'Constant value updated')
    case 'invalid-data-type': return pick('Kiểu dữ liệu không hợp lệ cho node này', 'Data type is not valid for this node')
    case 'node-type-set': return pick(`Đã đổi kiểu sang ${p.type}`, `Type changed to ${p.type}`)
    case 'invalid-instance-name': return pick('Tên instance không hợp lệ', 'Invalid instance name')
    case 'node-fb-params-set': return pick('Đã cập nhật tham số function block', 'Function block parameters updated')
    case 'selection-revision-mismatch': return pick('Phiên bản vùng chọn không khớp', 'Selection revision mismatch')
    case 'wire-limit-reached': return pick('Đã đạt giới hạn wire', 'Reached wire limit')
    case 'blocks-moved': return pick('Đã đổi vị trí các block trên canvas', 'Blocks moved on canvas')
    case 'subgraph-pasted': return pick('Đã dán subgraph vào canvas', 'Subgraph pasted to canvas')
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
