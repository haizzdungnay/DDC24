import {
  PROGRAMMING_PROFILE_ID,
  PROGRAMMING_RESOURCES,
  PROGRAMMING_TYPES,
} from '../api/generated/profile'

export const FBD_SCHEMA_VERSION = 1 as const
// Định danh profile và trần FBD là contract, không phải hằng của riêng FE.
// Chép tay các giá trị này từng làm FE và compiler trôi khỏi nhau trong im lặng.
export const FBD_PROFILE_ID = PROGRAMMING_PROFILE_ID
export const FBD_MAX_NETWORKS = PROGRAMMING_RESOURCES.maxFbdBlocks
export const FBD_MAX_BLOCKS = PROGRAMMING_RESOURCES.maxFbdBlocks
export const FBD_MAX_WIRES = PROGRAMMING_RESOURCES.maxFbdConnections
// Issue #801 — 16 bit + 1 cổng word (`WORD_TO_BITS`/`BITS_TO_WORD`); khớp `fbd_v1.schema.json`.
export const FBD_MAX_PORTS_PER_NODE = 17

export type FbdDataType = (typeof PROGRAMMING_TYPES)[number]['name']
export const FBD_DATA_TYPES: readonly FbdDataType[] = PROGRAMMING_TYPES.map((item) => item.name)
export type FbdNodeKind =
  | 'INPUT'
  | 'OUTPUT'
  | 'CONSTANT'
  | 'FUNCTION'
  | 'FUNCTION_BLOCK'
  | 'CONVERSION'
  | 'SIGNAL_READ'
  | 'SIGNAL_PUBLISH'
export type FbdPortDirection = 'INPUT' | 'OUTPUT'
export type FbdParameterValue = boolean | number | string

export interface FbdPort {
  id: string
  name: string
  direction: FbdPortDirection
  dataType: FbdDataType
  unit: string | null
  order: number
}

export interface FbdNode {
  id: string
  kind: FbdNodeKind
  typeRef: string
  executionOrder: number
  parameters: Record<string, FbdParameterValue>
  ports: FbdPort[]
}

export interface FbdEndpoint {
  nodeId: string
  portId: string
}

export interface FbdWire {
  id: string
  from: FbdEndpoint
  to: FbdEndpoint
}

export interface FbdNetwork {
  id: string
  name: string
  order: number
  nodes: FbdNode[]
  wires: FbdWire[]
}

export interface FbdPoint {
  x: number
  y: number
}

/**
 * `T59-806` — hình học TRÌNH BÀY của đồ thị.
 *
 * Đặt ở gốc tài liệu và có phiên bản riêng, KHÔNG nằm trong từng node: nhờ vậy
 * "cùng topology, khác hình học ⇒ cùng IR" là bất biến cấu trúc. Compiler
 * (`st_fbd_model.cpp`) kiểm rồi `erase("layout")` trước khi canonical hoá, nên
 * kéo một block sang phải 10 px không đổi hash artifact.
 */
export interface FbdLayout {
  schemaVersion: 1
  nodes: Record<string, FbdPoint>
}

export interface FbdDocument {
  $schema: '../../fbd_v1.schema.json'
  schemaVersion: typeof FBD_SCHEMA_VERSION
  profileId: typeof FBD_PROFILE_ID
  graphId: string
  name: string
  networks: FbdNetwork[]
  /** Tuỳ chọn: tài liệu cũ chưa có hình học vẫn hợp lệ. */
  layout?: FbdLayout
}

export const FBD_MAX_LAYOUT_NODES = 4096
export const FBD_MAX_LAYOUT_COORDINATE = 100_000

export interface FbdIssue {
  code: string
  path: string
}

/** Phần contract Published Signal mà validator FBD cần. Kiểu cấu trúc này cố
 * ý không phụ thuộc view model của editor để có thể đối soát trực tiếp payload
 * Draft v2 mà API trả về. */
export interface FbdSignalDefinition {
  name: string
  type: FbdDataType
  unit?: string
  publisherProgramId: string
}

export interface FbdValidationContext {
  programId: string
  signals: readonly FbdSignalDefinition[]
}

/* WP-03 (D-06, REV-PROG-OVERVIEW-DESIGN-GAP-2026-08-15 §8.4): registry này
 * PHẢI khớp đúng những gì C++ compiler thật sự chấp nhận
 * (`st_func_from_name`/`StFbType`, `apps/core/application/st/`), không phải
 * một danh sách IEC 61131-3 "đầy đủ" viết tay độc lập. Trước đây có
 * `SCALE`/`DEADBAND` (pure) và `CTU`/`PI` (stateful) — cả bốn KHÔNG tồn tại ở
 * compiler; nếu một palette tương lai từng cho tạo node các loại này, Check
 * sẽ fail `FBD-SEM-LIBRARY-UNSUPPORTED-001` không giải thích được lý do gốc.
 * Đồng thời thiếu `SQRT`, thứ compiler đã hỗ trợ — đã bổ sung. Nguồn sự thật
 * dài hạn nên là một registry sinh ra từ cùng một chỗ cho cả FE lẫn C++ (xem
 * WP-03 exit criteria trong Master Plan), registry tay này chỉ là bản vá tạm
 * cho tới khi có single source of truth đó. */
const pureFunctions = new Set([
  'AND', 'OR', 'XOR', 'NOT', 'EQ', 'NE', 'LT', 'LE', 'GT', 'GE',
  'ADD', 'SUB', 'MUL', 'DIV', 'MOD', 'ABS', 'MIN', 'MAX', 'LIMIT',
  'SEL', 'SQRT',
])
const statefulFunctions = new Set(['TON', 'TOF', 'R_TRIG', 'F_TRIG', 'PID'])
const conversions = new Set([
  'INT_TO_DINT', 'INT_TO_UINT', 'DINT_TO_INT', 'DINT_TO_UINT',
  'UINT_TO_INT', 'UINT_TO_DINT', 'DINT_TO_REAL', 'UINT_TO_REAL',
  'REAL_TO_DINT', 'REAL_TO_UINT',
])
const scalarTypes = new Set<string>(FBD_DATA_TYPES)
const knownRegistryTypeRefs = new Set<string>([
  ...scalarTypes,
  ...pureFunctions,
  ...statefulFunctions,
  ...conversions,
  'SIGNAL_READ',
  'SIGNAL_PUBLISH',
])
const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const identifier = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function cloneFbdDocument(document: FbdDocument): FbdDocument {
  return clone(document)
}

export function isValidFbdLayout(layout: unknown): layout is FbdLayout {
  if (typeof layout !== 'object' || layout === null || Array.isArray(layout)) return false
  const keys = Object.keys(layout)
  if (keys.some((key) => key !== 'schemaVersion' && key !== 'nodes')) return false
  const candidate = layout as Partial<FbdLayout>
  if (candidate.schemaVersion !== 1) return false
  const nodes = candidate.nodes
  if (typeof nodes !== 'object' || nodes === null || Array.isArray(nodes)) return false
  const nodeIds = Object.keys(nodes)
  if (nodeIds.length > FBD_MAX_LAYOUT_NODES) return false
  return nodeIds.every((nodeId) => {
    if (!canonicalUuid.test(nodeId)) return false
    const point = (nodes as Record<string, unknown>)[nodeId]
    if (typeof point !== 'object' || point === null || Array.isArray(point)) return false
    const pointKeys = Object.keys(point)
    if (pointKeys.length !== 2 || !pointKeys.includes('x') || !pointKeys.includes('y')) return false
    return (['x', 'y'] as const).every((axis) => {
      const value = (point as Record<string, unknown>)[axis]
      return typeof value === 'number' && Number.isFinite(value) &&
        value >= -FBD_MAX_LAYOUT_COORDINATE && value <= FBD_MAX_LAYOUT_COORDINATE
    })
  })
}

export function isCanonicalFbdUuid(value: string): boolean {
  return canonicalUuid.test(value)
}

export function isFbdIdentifier(value: string): boolean {
  return identifier.test(value)
}

export function canonicalizeFbdDocument(document: FbdDocument): FbdDocument {
  const result = cloneFbdDocument(document)
  /* Khoá của `layout.nodes` là map nên thứ tự chèn quyết định byte đầu ra —
   * sắp lại để hai tài liệu giống hệt nhau không sinh hai chuỗi khác nhau chỉ
   * vì thứ tự người dùng kéo block.
   *
   * Hàm này chạy TRƯỚC cả validate (kiểm kích thước gọi `canonicalFbdJson`),
   * nên nó phải chịu được tài liệu chưa hợp lệ: hình học rác bị BỎ khỏi dạng
   * canonical thay vì làm cả hàm ném lỗi — issue `FBD-SCHEMA-LAYOUT-001` mới
   * là chỗ báo cho người dùng. */
  if (result.layout !== undefined) {
    if (isValidFbdLayout(result.layout)) {
      const sorted: Record<string, FbdPoint> = {}
      for (const key of Object.keys(result.layout.nodes).sort()) sorted[key] = result.layout.nodes[key]
      result.layout = { schemaVersion: result.layout.schemaVersion, nodes: sorted }
    } else {
      delete result.layout
    }
  }
  result.networks.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
  for (const network of result.networks) {
    network.nodes.sort((left, right) => left.executionOrder - right.executionOrder || left.id.localeCompare(right.id))
    for (const node of network.nodes) {
      node.ports.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    }
    network.wires.sort((left, right) => left.id.localeCompare(right.id))
  }
  return result
}

export function canonicalFbdJson(document: FbdDocument): string {
  return JSON.stringify(canonicalizeFbdDocument(document))
}

export interface FbdInterfaceVariable {
  name: string
  type: FbdDataType
  direction: 'INPUT' | 'OUTPUT'
}

/** Biến biên ngoài của Program FBD — node `kind: 'INPUT'|'OUTPUT'` mang tên
 *  qua `parameters.variable` (xem golden `ahu_fan_enable.json`). Dùng để mời
 *  chọn thay vì bắt Mapping tab gõ tay tên biến không đối chiếu được. */
export function collectFbdInterfaceVariables(document: FbdDocument): FbdInterfaceVariable[] {
  const output: FbdInterfaceVariable[] = []
  for (const network of document.networks) {
    for (const node of network.nodes) {
      if (node.kind !== 'INPUT' && node.kind !== 'OUTPUT') continue
      const variable = node.parameters.variable
      if (typeof variable !== 'string' || variable.length === 0) continue
      output.push({ name: variable, type: node.typeRef as FbdDataType, direction: node.kind })
    }
  }
  return output
}

function typeRefMatchesKind(node: FbdNode): boolean {
  if (node.kind === 'INPUT' || node.kind === 'OUTPUT' || node.kind === 'CONSTANT') return scalarTypes.has(node.typeRef)
  if (node.kind === 'FUNCTION') {
    return pureFunctions.has(node.typeRef) || !knownRegistryTypeRefs.has(node.typeRef)
  }
  if (node.kind === 'FUNCTION_BLOCK') {
    return statefulFunctions.has(node.typeRef) || !knownRegistryTypeRefs.has(node.typeRef)
  }
  if (node.kind === 'CONVERSION') return conversions.has(node.typeRef)
  return node.typeRef === node.kind
}

function portShapeMatchesKind(node: FbdNode): boolean {
  const inputs = node.ports.filter((port) => port.direction === 'INPUT').length
  const outputs = node.ports.length - inputs
  if (node.kind === 'INPUT' || node.kind === 'CONSTANT') return inputs === 0 && outputs > 0
  if (node.kind === 'OUTPUT') return inputs > 0 && outputs === 0
  if (node.kind === 'SIGNAL_READ') {
    const port = node.ports[0]
    return node.ports.length === 1 && inputs === 0 && outputs === 1 &&
      port?.name === 'OUT' && port.order === 0
  }
  if (node.kind === 'SIGNAL_PUBLISH') {
    const port = node.ports[0]
    return node.ports.length === 1 && inputs === 1 && outputs === 0 &&
      port?.name === 'IN' && port.order === 0
  }
  // Issue #801: `UPTIME` là hàm SYSTEM duy nhất không có đối số — chỉ một cổng ra.
  if (node.kind === 'FUNCTION' && node.typeRef === 'UPTIME') return inputs === 0 && outputs === 1
  return inputs > 0 && outputs > 0
}

function isSignalNode(node: FbdNode): node is FbdNode & { kind: 'SIGNAL_READ' | 'SIGNAL_PUBLISH' } {
  return node.kind === 'SIGNAL_READ' || node.kind === 'SIGNAL_PUBLISH'
}

export function validateFbdDocument(document: FbdDocument, context?: FbdValidationContext): FbdIssue[] {
  const issues: FbdIssue[] = []
  const add = (code: string, path: string) => {
    if (issues.length < 64) issues.push({ code, path })
  }
  const signalByName = new Map<string, FbdSignalDefinition>()
  const ambiguousSignalNames = new Set<string>()
  context?.signals.forEach((signal, index) => {
    const path = `$signals[${index}]`
    const foldedName = signal.name.toLocaleUpperCase('en-US')
    const valid = identifier.test(signal.name) && FBD_DATA_TYPES.includes(signal.type) &&
      signal.publisherProgramId.length > 0 &&
      (signal.unit === undefined || (signal.unit.length > 0 && signal.unit.length <= 32))
    if (!valid) {
      add('FBD-SEM-SIGNAL-MODEL-001', path)
      return
    }
    if (ambiguousSignalNames.has(foldedName) || signalByName.has(foldedName)) {
      ambiguousSignalNames.add(foldedName)
      signalByName.delete(foldedName)
      add('FBD-SEM-SIGNAL-MODEL-001', `${path}.name`)
      return
    }
    signalByName.set(foldedName, signal)
  })
  const publishedSignals = new Set<string>()
  if (document.$schema !== '../../fbd_v1.schema.json' || document.schemaVersion !== 1 ||
      document.profileId !== FBD_PROFILE_ID || !canonicalUuid.test(document.graphId) ||
      !identifier.test(document.name)) {
    add('FBD-SCHEMA-ROOT-001', '$')
  }
  if (document.networks.length < 1 || document.networks.length > FBD_MAX_NETWORKS) {
    add('FBD-LIMIT-NETWORK-001', '$.networks')
  }
  /* Parity với `is_valid_layout()` ở compiler: hình học sai bị TỪ CHỐI ở biên
   * chứ không bị im lặng bỏ qua — một toạ độ NaN gửi lên rồi mới hỏng ở Core
   * là lỗi khó lần hơn nhiều so với một issue ngay tại editor. */
  if (document.layout !== undefined) {
    if (!isValidFbdLayout(document.layout)) add('FBD-SCHEMA-LAYOUT-001', '$.layout')
  }
  const ids = new Set([document.graphId])
  const networkOrders = new Set<number>()
  let blockCount = 0
  let wireCount = 0
  document.networks.forEach((network, networkIndex) => {
    const networkPath = `$.networks[${networkIndex}]`
    if (!canonicalUuid.test(network.id) || ids.has(network.id) || networkOrders.has(network.order) ||
        !identifier.test(network.name) || network.order < 0 || network.order > 255) {
      add('FBD-SEM-NETWORK-001', networkPath)
    }
    ids.add(network.id)
    networkOrders.add(network.order)
    blockCount += network.nodes.length
    wireCount += network.wires.length
    const nodeOrders = new Set<number>()
    const ports = new Map<string, { node: FbdNode; port: FbdPort }>()
    network.nodes.forEach((node, nodeIndex) => {
      const nodePath = `${networkPath}.nodes[${nodeIndex}]`
      if (!canonicalUuid.test(node.id) || ids.has(node.id) || nodeOrders.has(node.executionOrder) ||
          !identifier.test(node.typeRef) || node.executionOrder < 0 || node.executionOrder > 255) {
        add('FBD-SEM-NODE-001', nodePath)
      }
      ids.add(node.id)
      nodeOrders.add(node.executionOrder)
      if (!typeRefMatchesKind(node)) add('FBD-SEM-TYPE-REF-001', `${nodePath}.typeRef`)
      const parameters = Object.entries(node.parameters)
      if (parameters.length > 32 || parameters.some(([key, value]) =>
        !identifier.test(key) ||
        (typeof value === 'string' && value.length > 128) ||
        (typeof value === 'number' && (!Number.isFinite(value) ||
          (Number.isInteger(value) && (value < -2_147_483_648 || value > 2_147_483_647))))
      )) add('FBD-SEM-PARAMETER-001', `${nodePath}.parameters`)
      const signalName = isSignalNode(node) && parameters.length === 1 &&
        parameters[0]?.[0] === 'signal' && typeof parameters[0][1] === 'string' &&
        identifier.test(parameters[0][1])
        ? parameters[0][1]
        : null
      if (isSignalNode(node) && signalName === null) {
        add('FBD-SEM-PARAM-001', `${nodePath}.parameters`)
      }
      if (node.ports.length < 1 || node.ports.length > FBD_MAX_PORTS_PER_NODE) {
        add('FBD-LIMIT-PORT-001', `${nodePath}.ports`)
      }
      const portOrders = new Set<number>()
      const portNames = new Set<string>()
      node.ports.forEach((port, portIndex) => {
        const portPath = `${nodePath}.ports[${portIndex}]`
        if (!canonicalUuid.test(port.id) || ids.has(port.id) || portOrders.has(port.order) ||
            portNames.has(port.name) || !identifier.test(port.name) || !FBD_DATA_TYPES.includes(port.dataType) ||
            port.order < 0 || port.order > FBD_MAX_PORTS_PER_NODE - 1 || (port.unit !== null && (port.unit.length < 1 || port.unit.length > 32))) {
          add('FBD-SEM-PORT-001', portPath)
        }
        ids.add(port.id)
        portOrders.add(port.order)
        portNames.add(port.name)
        ports.set(port.id, { node, port })
      })
      if (!portShapeMatchesKind(node)) add('FBD-SEM-PORT-SHAPE-001', `${nodePath}.ports`)
      if (context && isSignalNode(node) && signalName !== null) {
        const foldedName = signalName.toLocaleUpperCase('en-US')
        const definition = signalByName.get(foldedName)
        if (!definition || definition.name !== signalName) {
          add('FBD-SEM-SIGNAL-REF-001', `${nodePath}.parameters.signal`)
        } else {
          const port = node.ports[0]
          if (!port || port.dataType !== definition.type || port.unit !== (definition.unit ?? null)) {
            add('FBD-SEM-SIGNAL-PORT-001', `${nodePath}.ports`)
          }
          if (node.kind === 'SIGNAL_PUBLISH') {
            if (definition.publisherProgramId !== context.programId) {
              add('FBD-SEM-SIGNAL-PUBLISHER-001', `${nodePath}.parameters.signal`)
            }
            if (publishedSignals.has(foldedName)) {
              add('FBD-SEM-SIGNAL-PUBLISH-COUNT-001', `${nodePath}.parameters.signal`)
            }
            publishedSignals.add(foldedName)
          }
        }
      }
    })
    if (network.nodes.length < 1 || network.nodes.length > FBD_MAX_BLOCKS) {
      add('FBD-LIMIT-BLOCK-001', `${networkPath}.nodes`)
    }
    if (network.wires.length > FBD_MAX_WIRES) add('FBD-LIMIT-WIRE-001', `${networkPath}.wires`)
    const driven = new Set<string>()
    network.wires.forEach((wire, wireIndex) => {
      const wirePath = `${networkPath}.wires[${wireIndex}]`
      const source = ports.get(wire.from.portId)
      const target = ports.get(wire.to.portId)
      const valid = canonicalUuid.test(wire.id) && !ids.has(wire.id) && source && target &&
        source.node.id === wire.from.nodeId && target.node.id === wire.to.nodeId &&
        source.port.direction === 'OUTPUT' && target.port.direction === 'INPUT' &&
        source.port.dataType === target.port.dataType && source.port.unit === target.port.unit &&
        !driven.has(target.port.id)
      if (!valid) add('FBD-SEM-WIRE-001', wirePath)
      ids.add(wire.id)
      if (target) driven.add(target.port.id)
      if (source && target && source.node.kind !== 'FUNCTION_BLOCK' && target.node.kind !== 'FUNCTION_BLOCK' &&
          source.node.executionOrder >= target.node.executionOrder) {
        add('FBD-SEM-ORDER-001', wirePath)
      }
    })
  })
  if (blockCount > FBD_MAX_BLOCKS) add('FBD-LIMIT-BLOCK-001', '$.networks')
  if (wireCount > FBD_MAX_WIRES) add('FBD-LIMIT-WIRE-001', '$.networks')
  if (new TextEncoder().encode(canonicalFbdJson(document)).length > 65_536) add('FBD-SCHEMA-SIZE-001', '$')
  return issues
}

export function findFbdPort(
  document: FbdDocument,
  portId: string,
): { network: FbdNetwork; node: FbdNode; port: FbdPort } | undefined {
  for (const network of document.networks) {
    for (const node of network.nodes) {
      const port = node.ports.find((candidate) => candidate.id === portId)
      if (port) return { network, node, port }
    }
  }
  return undefined
}
