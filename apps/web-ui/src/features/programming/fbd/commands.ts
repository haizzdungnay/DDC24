import type { FbdAnnouncement } from './announcements'
import { FBD_HISTORY_LIMIT } from './keyboard'

export { translateFbdAnnouncement } from './announcements'
export type { FbdAnnouncement } from './announcements'
export { normalizeFbdShortcut, resolveFbdKeyboardCommand, FBD_KEYBOARD_REGISTRY, FBD_HISTORY_LIMIT } from './keyboard'
export type { FbdKeyboardCommand, FbdKeyboardEventLike } from './keyboard'

import {
  FBD_DATA_TYPES,
  FBD_MAX_BLOCKS,
  FBD_MAX_LAYOUT_COORDINATE,
  FBD_MAX_LAYOUT_NODES,
  FBD_MAX_NETWORKS,
  FBD_MAX_WIRES,
  canonicalFbdJson,
  canonicalizeFbdDocument,
  cloneFbdDocument,
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

/** Toạ độ theo trần `fbd_v1.schema.json` §layout. Làm tròn để pixel lẻ không
 * tạo Draft "bẩn"; trả `null` để từ chối giá trị ngoài trần/không hữu hạn. */
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
  | { type: 'ADD_NODE'; networkId: string; node: FbdNode; position?: FbdPoint }
  | { type: 'ADD_WIRE'; networkId: string; wire: FbdWire }
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
  /**
   * Sửa THAM SỐ CHỈNH ĐỊNH của một khối (Kp/Ki/Kd/Ts/ManualOut của PID, PT của
   * TON…). Tách khỏi `SET_NODE_FB_PARAMS` vì hai thứ khác hẳn nhau về vòng đời:
   * `instance`/`retained` là danh tính và chính sách lưu trạng thái, còn các
   * tham số này là số liệu chỉnh định mà người vận hành đổi thường xuyên.
   *
   * Payload chỉ mang những khoá được đổi. Khoá không có trong payload giữ
   * NGUYÊN giá trị cũ; `null` mới là lệnh xoá khoá đó.
   */
  | { type: 'SET_NODE_PARAMETERS'; networkId: string; nodeId: string; parameters: Record<string, FbdParameterValue | null> }
  | { type: 'UPDATE_NODE_ATTRIBUTES'; networkId: string; nodeId: string; dataType?: FbdDataType;
      variable?: string; unit?: string | null; value?: FbdParameterValue; instance?: string | null; retained?: boolean }
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

export type FbdWireRejection =
  | 'port-not-found'
  | 'select-output-port'
  | 'connect-incompatible'
  | 'wire-mismatch'
  | 'wire-uuid-invalid'
  | 'connect-reverse-order'
  | 'input-has-driver-or-limit'

export function validateFbdWireCandidate(
  document: FbdDocument,
  sourcePortId: string,
  targetPortId: string,
  wire: FbdWire | undefined,
): { ok: true } | { ok: false; code: FbdWireRejection } {
  const target = findFbdPort(document, targetPortId)
  if (!target) return { ok: false, code: 'port-not-found' }
  const source = findFbdPort(document, sourcePortId)
  if (!source) return { ok: false, code: 'port-not-found' }

  if (source.port.direction !== 'OUTPUT') {
    return { ok: false, code: 'select-output-port' }
  }

  if (
    target.port.direction !== 'INPUT' ||
    source.network.id !== target.network.id ||
    source.port.dataType !== target.port.dataType ||
    source.port.unit !== target.port.unit
  ) {
    return { ok: false, code: 'connect-incompatible' }
  }

  if (
    !wire ||
    wire.from.portId !== source.port.id ||
    wire.from.nodeId !== source.node.id ||
    wire.to.portId !== target.port.id ||
    wire.to.nodeId !== target.node.id
  ) {
    return { ok: false, code: 'wire-mismatch' }
  }

  if (!identitiesAreNew(document, [wire.id])) {
    return { ok: false, code: 'wire-uuid-invalid' }
  }

  if (
    source.node.kind !== 'FUNCTION_BLOCK' &&
    target.node.kind !== 'FUNCTION_BLOCK' &&
    source.node.executionOrder >= target.node.executionOrder
  ) {
    return { ok: false, code: 'connect-reverse-order' }
  }

  if (
    wireCount(document) >= FBD_MAX_WIRES ||
    target.network.wires.some((item) => item.to.portId === target.port.id)
  ) {
    return { ok: false, code: 'input-has-driver-or-limit' }
  }

  return { ok: true }
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
  if (!source) return reject(state, { code: 'port-not-found' })

  const validation = validateFbdWireCandidate(state.document, state.connectionFromPortId, targetPortId, wire)
  if (!validation.ok) return reject(state, { code: validation.code })

  const document = cloneFbdDocument(state.document)
  const network = document.networks.find((item) => item.id === target.network.id)
  if (!network) return reject(state, { code: 'network-missing' })
  network.wires.push(wire!)
  return commit(state, document, { code: 'wire-connected', params: { from: source.port.name, to: target.port.name } })
}

/* WP-05..07: đổi kiểu toán hạng T phải giữ id/order của port; chỉ cập nhật
 * `dataType` cho port khớp tên với registry. */
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
      return {
        ...state,
        selection: ports[next],
        selectionRevision: state.selectionRevision + 1,
        announcement: { code: 'port-selected', params: { index: next + 1, total: ports.length } },
      }
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
      const entry = fbdPaletteEntry(action.node.typeRef)
      if (entry && entry.featureState !== 'AVAILABLE') {
        return reject(state, { code: 'block-review-required' })
      }
      if (nodeCount(state.document) >= FBD_MAX_BLOCKS) return reject(state, { code: 'block-limit-reached' })
      if (!identitiesAreNew(state.document, [action.node.id, ...action.node.ports.map((port) => port.id)])) {
        return reject(state, { code: 'block-uuid-invalid' })
      }
      let positionToSet: FbdPoint | null = null
      if (action.position) {
        const x = clampLayoutCoordinate(action.position.x)
        const y = clampLayoutCoordinate(action.position.y)
        if (x === null || y === null) return reject(state, { code: 'invalid-position' })
        const currentLayoutNodes = state.document.layout?.nodes ?? {}
        if (!currentLayoutNodes[action.node.id] && Object.keys(currentLayoutNodes).length >= FBD_MAX_LAYOUT_NODES) {
          return reject(state, { code: 'invalid-position' })
        }
        positionToSet = { x, y }
      }
      const document = cloneFbdDocument(state.document)
      const network = document.networks.find((item) => item.id === action.networkId)
      if (!network) return reject(state, { code: 'network-not-found' })
      const node = { ...action.node, executionOrder: network.nodes.length }
      network.nodes.push(node)
      if (positionToSet) {
        const layout = document.layout ?? { schemaVersion: 1 as const, nodes: {} }
        document.layout = { schemaVersion: 1, nodes: { ...layout.nodes, [node.id]: positionToSet } }
      }
      return commit(state, document, { code: 'block-added', params: { type: node.typeRef } }, {
        kind: 'node', networkId: network.id, nodeId: node.id,
      })
    }
    case 'ADD_WIRE': {
      if (!mutationAllowed(state)) return reject(state, { code: 'no-edit-permission' })
      const network = state.document.networks.find((item) => item.id === action.networkId)
      if (!network) return reject(state, { code: 'network-not-found' })
      const source = findFbdPort(state.document, action.wire.from.portId)
      const target = findFbdPort(state.document, action.wire.to.portId)
      if (!source || !target) return reject(state, { code: 'port-not-found' })
      if (source.network.id !== action.networkId || target.network.id !== action.networkId) {
        return reject(state, { code: 'connect-incompatible' })
      }
      const validation = validateFbdWireCandidate(
        state.document,
        action.wire.from.portId,
        action.wire.to.portId,
        action.wire,
      )
      if (!validation.ok) return reject(state, { code: validation.code })
      const document = cloneFbdDocument(state.document)
      const targetNetwork = document.networks.find((item) => item.id === action.networkId)
      if (!targetNetwork) return reject(state, { code: 'network-not-found' })
      targetNetwork.wires.push(action.wire)
      return commit(
        state,
        document,
        { code: 'wire-connected', params: { from: source.port.name, to: target.port.name } },
      )
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
      /* GIỮ mọi tham số khác. Bản trước dựng một object RỖNG rồi gán đè, nên
         mỗi lần đổi tên instance hay bật/tắt RETAIN là một lần **xoá sạch** các
         tham số chỉnh định của khối — Kp/Ki/Kd/Ts/ManualOut của một vòng PID
         biến mất mà không có cảnh báo nào, và Draft vẫn lưu thành công. Lệnh
         này chỉ sở hữu hai khoá `instance` và `retained`; những khoá còn lại
         thuộc về `SET_NODE_PARAMETERS`. */
      const parameters: Record<string, FbdParameterValue> = { ...found.node.parameters }
      if (action.instance !== null) parameters.instance = action.instance
      else delete parameters.instance
      if (action.retained) parameters.retained = true
      else delete parameters.retained
      found.node.parameters = parameters
      return commit(state, document, { code: 'node-fb-params-set' })
    }
    case 'SET_NODE_PARAMETERS': {
      if (!mutationAllowed(state)) return reject(state, { code: 'no-edit-permission' })
      const document = cloneFbdDocument(state.document)
      const found = findNode(document, action.networkId, action.nodeId)
      if (!found) return reject(state, { code: 'node-not-found' })
      /* Hai khoá này có lệnh riêng và có kiểm tra riêng (`isFbdIdentifier` cho
         `instance`). Cho chúng đi qua đường này là mở một cửa sau bỏ qua kiểm
         tra ấy, nên từ chối thẳng thay vì im lặng bỏ qua. */
      if ('instance' in action.parameters || 'retained' in action.parameters) {
        return reject(state, { code: 'invalid-node-attributes' })
      }
      const next: Record<string, FbdParameterValue> = { ...found.node.parameters }
      for (const [name, value] of Object.entries(action.parameters)) {
        if (!isFbdIdentifier(name)) return reject(state, { code: 'invalid-parameter-name' })
        if (value === null) { delete next[name]; continue }
        /* Số không hữu hạn (`NaN`, `Infinity`) KHÔNG canonical hoá được sang
           JSON và sẽ thành `null` trong artifact — tức một tham số chỉnh định
           biến mất trên đường xuống thiết bị. Chặn tại đây. */
        if (typeof value === 'number' && !Number.isFinite(value)) {
          return reject(state, { code: 'invalid-parameter-value' })
        }
        next[name] = value
      }
      found.node.parameters = next
      if (canonicalFbdJson(document) === canonicalFbdJson(state.document)) return state
      return commit(state, document, { code: 'node-parameters-set' })
    }
    case 'UPDATE_NODE_ATTRIBUTES': {
      if (!mutationAllowed(state)) return reject(state, { code: 'no-edit-permission' })
      const document = cloneFbdDocument(state.document)
      const found = findNode(document, action.networkId, action.nodeId)
      if (!found) return reject(state, { code: 'node-not-found' })
      const { node } = found
      const { variable, unit, value, instance, retained } = action
      const hasVariable = variable !== undefined
      const hasUnit = unit !== undefined
      const hasValue = value !== undefined
      const hasInstance = instance !== undefined
      const hasRetained = retained !== undefined
      const entry = fbdPaletteEntry(node.typeRef)
      const hasWrongKindAttribute =
        node.kind === 'INPUT' || node.kind === 'OUTPUT'
          ? hasValue || hasInstance || hasRetained
          : node.kind === 'CONSTANT'
            ? hasVariable || hasUnit || hasInstance || hasRetained
            : node.kind === 'FUNCTION_BLOCK'
              ? action.dataType !== undefined || hasVariable || hasUnit || hasValue
              : hasVariable || hasUnit || hasValue || hasInstance || hasRetained ||
                (action.dataType !== undefined && !entry?.polymorphic)
      if (hasWrongKindAttribute) return reject(state, { code: 'invalid-node-attributes' })

      if (action.dataType !== undefined) {
        if (!FBD_DATA_TYPES.includes(action.dataType)) return reject(state, { code: 'invalid-data-type' })
        if (node.kind !== 'INPUT' && node.kind !== 'OUTPUT' && node.kind !== 'CONSTANT') {
          if (!entry || !entry.polymorphic || !entry.allowedTypes.includes(action.dataType)) {
            return reject(state, { code: 'invalid-data-type' })
          }
        }
      }
      const effectiveType = (action.dataType ?? node.typeRef) as FbdDataType
      if (variable !== undefined) {
        if (node.kind !== 'INPUT' && node.kind !== 'OUTPUT') return reject(state, { code: 'node-not-found' })
        if (!isFbdIdentifier(variable)) return reject(state, { code: 'invalid-variable-name' })
      }
      if (unit !== undefined && unit !== null) {
        if (unit.length < 1 || unit.length > 32) return reject(state, { code: 'invalid-unit' })
      }
      if (value !== undefined) {
        if (node.kind !== 'CONSTANT') return reject(state, { code: 'node-not-found' })
        if (!isValidConstantLiteral(effectiveType, value)) return reject(state, { code: 'invalid-constant-value' })
      }
      if (instance !== undefined && instance !== null) {
        if (node.kind !== 'FUNCTION_BLOCK') return reject(state, { code: 'node-not-found' })
        if (!isFbdIdentifier(instance)) return reject(state, { code: 'invalid-instance-name' })
      }
      if (action.dataType !== undefined && action.dataType !== node.typeRef) {
        if (node.kind === 'INPUT' || node.kind === 'OUTPUT' || node.kind === 'CONSTANT') {
          node.typeRef = action.dataType
          node.ports = node.ports.map((port) => ({ ...port, dataType: action.dataType! }))
          if (node.kind === 'CONSTANT' && action.value === undefined && !isValidConstantLiteral(action.dataType, node.parameters.value)) {
            node.parameters = { ...node.parameters, value: action.dataType === 'BOOL' ? false : action.dataType === 'TIME' ? 'T#0s' : 0 }
          }
        } else {
          applyOperandType(node, action.dataType)
        }
      }
      if (variable !== undefined) {
        node.parameters = { ...node.parameters, variable }
      }
      if (unit !== undefined && node.ports[0]) {
        node.ports[0].unit = unit
      }
      if (value !== undefined) {
        node.parameters = { ...node.parameters, value }
      }
      if (hasInstance || hasRetained) {
        const nextParams = { ...node.parameters }
        if (instance !== undefined) {
          if (instance !== null) nextParams.instance = instance
          else delete nextParams.instance
        }
        if (retained !== undefined) {
          if (retained) nextParams.retained = true
          else delete nextParams.retained
        }
        node.parameters = nextParams
      }
      if (canonicalFbdJson(document) === canonicalFbdJson(state.document)) return state
      return commit(state, document, { code: 'node-attributes-updated' })
    }
    case 'UNDO': {
      if (!mutationAllowed(state)) return reject(state, { code: 'no-edit-permission' })
      const previous = state.past[state.past.length - 1]
      if (!previous) return reject(state, { code: 'nothing-to-undo' })
      return {
        ...state, document: previous, selection: null,
        selectionRevision: state.selectionRevision + 1, connectionFromPortId: null,
        past: state.past.slice(0, -1), future: [state.document, ...state.future].slice(0, FBD_HISTORY_LIMIT),
        announcement: { code: 'undone' },
      }
    }
    case 'REDO': {
      if (!mutationAllowed(state)) return reject(state, { code: 'no-edit-permission' })
      const [next, ...future] = state.future
      if (!next) return reject(state, { code: 'nothing-to-redo' })
      return {
        ...state, document: next, selection: null,
        selectionRevision: state.selectionRevision + 1, connectionFromPortId: null,
        past: [...state.past, state.document].slice(-FBD_HISTORY_LIMIT), future,
        announcement: { code: 'redone' },
      }
    }
  }
}
