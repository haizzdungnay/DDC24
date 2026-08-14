export const FBD_SCHEMA_VERSION = 1 as const
export const FBD_PROFILE_ID = 'revA-1t-1-5-30' as const
export const FBD_MAX_NETWORKS = 256
export const FBD_MAX_BLOCKS = 256
export const FBD_MAX_WIRES = 512
export const FBD_MAX_PORTS_PER_NODE = 16

export const FBD_DATA_TYPES = ['BOOL', 'INT', 'DINT', 'UINT', 'REAL', 'TIME'] as const
export type FbdDataType = (typeof FBD_DATA_TYPES)[number]
export type FbdNodeKind = 'INPUT' | 'OUTPUT' | 'CONSTANT' | 'FUNCTION' | 'FUNCTION_BLOCK' | 'CONVERSION'
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

export interface FbdDocument {
  $schema: '../../fbd_v1.schema.json'
  schemaVersion: typeof FBD_SCHEMA_VERSION
  profileId: typeof FBD_PROFILE_ID
  graphId: string
  name: string
  networks: FbdNetwork[]
}

export interface FbdIssue {
  code: string
  path: string
}

const pureFunctions = new Set([
  'AND', 'OR', 'XOR', 'NOT', 'EQ', 'NE', 'LT', 'LE', 'GT', 'GE',
  'ADD', 'SUB', 'MUL', 'DIV', 'MOD', 'ABS', 'MIN', 'MAX', 'LIMIT',
  'SEL', 'SCALE', 'DEADBAND',
])
const statefulFunctions = new Set(['TON', 'TOF', 'R_TRIG', 'F_TRIG', 'CTU', 'PI', 'PID'])
const conversions = new Set([
  'INT_TO_DINT', 'INT_TO_UINT', 'DINT_TO_INT', 'DINT_TO_UINT',
  'UINT_TO_INT', 'UINT_TO_DINT', 'DINT_TO_REAL', 'UINT_TO_REAL',
  'REAL_TO_DINT', 'REAL_TO_UINT',
])
const scalarTypes = new Set<string>(FBD_DATA_TYPES)
const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const identifier = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function cloneFbdDocument(document: FbdDocument): FbdDocument {
  return clone(document)
}

export function isCanonicalFbdUuid(value: string): boolean {
  return canonicalUuid.test(value)
}

export function canonicalizeFbdDocument(document: FbdDocument): FbdDocument {
  const result = cloneFbdDocument(document)
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
  if (node.kind === 'FUNCTION') return pureFunctions.has(node.typeRef)
  if (node.kind === 'FUNCTION_BLOCK') return statefulFunctions.has(node.typeRef)
  return conversions.has(node.typeRef)
}

function portShapeMatchesKind(node: FbdNode): boolean {
  const inputs = node.ports.filter((port) => port.direction === 'INPUT').length
  const outputs = node.ports.length - inputs
  if (node.kind === 'INPUT' || node.kind === 'CONSTANT') return inputs === 0 && outputs > 0
  if (node.kind === 'OUTPUT') return inputs > 0 && outputs === 0
  return inputs > 0 && outputs > 0
}

export function validateFbdDocument(document: FbdDocument): FbdIssue[] {
  const issues: FbdIssue[] = []
  const add = (code: string, path: string) => {
    if (issues.length < 64) issues.push({ code, path })
  }
  if (document.$schema !== '../../fbd_v1.schema.json' || document.schemaVersion !== 1 ||
      document.profileId !== FBD_PROFILE_ID || !canonicalUuid.test(document.graphId) ||
      !identifier.test(document.name)) {
    add('FBD-SCHEMA-ROOT-001', '$')
  }
  if (document.networks.length < 1 || document.networks.length > FBD_MAX_NETWORKS) {
    add('FBD-LIMIT-NETWORK-001', '$.networks')
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
      if (node.ports.length < 1 || node.ports.length > FBD_MAX_PORTS_PER_NODE) {
        add('FBD-LIMIT-PORT-001', `${nodePath}.ports`)
      }
      const portOrders = new Set<number>()
      const portNames = new Set<string>()
      node.ports.forEach((port, portIndex) => {
        const portPath = `${nodePath}.ports[${portIndex}]`
        if (!canonicalUuid.test(port.id) || ids.has(port.id) || portOrders.has(port.order) ||
            portNames.has(port.name) || !identifier.test(port.name) || !FBD_DATA_TYPES.includes(port.dataType) ||
            port.order < 0 || port.order > 15 || (port.unit !== null && (port.unit.length < 1 || port.unit.length > 32))) {
          add('FBD-SEM-PORT-001', portPath)
        }
        ids.add(port.id)
        portOrders.add(port.order)
        portNames.add(port.name)
        ports.set(port.id, { node, port })
      })
      if (!portShapeMatchesKind(node)) add('FBD-SEM-PORT-SHAPE-001', `${nodePath}.ports`)
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
