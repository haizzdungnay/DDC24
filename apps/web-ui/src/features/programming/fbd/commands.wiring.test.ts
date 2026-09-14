import { describe, expect, it } from 'vitest'

import goldenJson from '../../../../../../contracts/programming/fbd/golden/ahu_fan_enable.json'

import { createFbdEditorState, fbdEditorReducer, translateFbdAnnouncement } from './commands'
import type { FbdEditorState } from './commands'
import { FBD_MAX_WIRES, type FbdDataType, type FbdDocument, type FbdNode, type FbdWire } from './model'

/* Task 6 — `ADD_NODE` kèm hình học và `ADD_WIRE` một nhịp.
 *
 * Tách khỏi `commands.test.ts` vì hai lát này có bộ fixture riêng (cần dựng
 * node có cổng đúng kiểu/đơn vị để thử ma trận tương thích), và gộp vào file
 * cũ sẽ che mất ranh giới "cái gì thuộc Task 6" khi lần lại lịch sử. */

function golden(): FbdDocument {
  return JSON.parse(JSON.stringify(goldenJson)) as FbdDocument
}

function uuid(prefix: number, index: number): string {
  return `${prefix.toString(16).padStart(8, '0')}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
}

interface PortSpec {
  name: string
  direction: 'INPUT' | 'OUTPUT'
  dataType: FbdDataType
  unit?: string | null
}

let seq = 0

function node(typeRef: string, ports: readonly PortSpec[], kind: FbdNode['kind'] = 'FUNCTION'): FbdNode {
  seq += 1
  const nodeSeq = seq
  return {
    id: uuid(0x70000000, nodeSeq),
    kind,
    typeRef,
    executionOrder: 0,
    parameters: {},
    ports: ports.map((port, index) => ({
      id: uuid(0x71000000 + nodeSeq, index + 1),
      name: port.name,
      direction: port.direction,
      dataType: port.dataType,
      unit: port.unit ?? null,
      order: index,
    })),
  }
}

function portId(target: FbdNode, name: string): string {
  const port = target.ports.find((item) => item.name === name)
  if (!port) throw new Error(`Fixture sai: node ${target.typeRef} không có cổng ${name}`)
  return port.id
}

function wire(from: FbdNode, fromPort: string, to: FbdNode, toPort: string, index = 1): FbdWire {
  return {
    id: uuid(0x72000000, index),
    from: { nodeId: from.id, portId: portId(from, fromPort) },
    to: { nodeId: to.id, portId: portId(to, toPort) },
  }
}

/** Dựng một network chỉ chứa `nodes`, trả state đã canonical hoá. */
function stateWith(...nodes: readonly FbdNode[]): { state: FbdEditorState; networkId: string } {
  const document = golden()
  const target = document.networks[0]
  target.nodes.push(...nodes.map((item, index) => ({ ...item, executionOrder: target.nodes.length + index })))
  return { state: createFbdEditorState(document), networkId: target.id }
}

const vi = (key: string) => translateFbdAnnouncement((a: string) => a, { code: key } as never)

describe('ADD_NODE kèm position — một thao tác đặt khối là một undo', () => {
  it('ghi node và layout trong đúng một history entry', () => {
    const target = node('AND', [
      { name: 'IN1', direction: 'INPUT', dataType: 'BOOL' },
      { name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' },
    ])
    const document = golden()
    const networkId = document.networks[0].id
    let state = createFbdEditorState(document)

    state = fbdEditorReducer(state, {
      type: 'ADD_NODE',
      networkId,
      node: target,
      position: { x: 240, y: 96 },
    })

    expect(state.past).toHaveLength(1)
    expect(state.document.networks[0].nodes.some((item) => item.id === target.id)).toBe(true)
    expect(state.document.layout?.nodes[target.id]).toEqual({ x: 240, y: 96 })
  })

  it('làm tròn toạ độ lẻ về số nguyên như các lệnh layout khác', () => {
    const target = node('OR', [{ name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' }])
    const document = golden()
    let state = createFbdEditorState(document)
    state = fbdEditorReducer(state, {
      type: 'ADD_NODE',
      networkId: document.networks[0].id,
      node: target,
      position: { x: 12.4, y: -7.6 },
    })
    expect(state.document.layout?.nodes[target.id]).toEqual({ x: 12, y: -8 })
  })

  it('từ chối toạ độ phi hữu hạn hoặc ngoài trần, giữ 0 diff', () => {
    const target = node('XOR', [{ name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' }])
    const document = golden()
    const before = createFbdEditorState(document)

    for (const position of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.POSITIVE_INFINITY },
      { x: 100_001, y: 0 },
    ]) {
      const after = fbdEditorReducer(before, {
        type: 'ADD_NODE',
        networkId: document.networks[0].id,
        node: target,
        position,
      })
      expect(after.announcement.code).toBe('invalid-position')
      expect(after.past).toHaveLength(0)
      expect(after.document).toEqual(before.document)
    }
  })

  it('giữ nguyên hành vi cũ khi không truyền position', () => {
    const target = node('NOT', [{ name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' }])
    const document = golden()
    const layoutBefore = createFbdEditorState(document).document.layout
    const state = fbdEditorReducer(createFbdEditorState(document), {
      type: 'ADD_NODE',
      networkId: document.networks[0].id,
      node: target,
    })
    expect(state.past).toHaveLength(1)
    expect(state.document.layout?.nodes[target.id]).toBeUndefined()
    expect(state.document.layout?.nodes).toEqual(layoutBefore?.nodes ?? undefined)
  })
})

/* Fail-closed cho khối chưa qua duyệt Controls+Safety. Khoá ở REDUCER chứ không
 * chỉ ở nút bấm: một `draggable={false}` bị gỡ nhầm trong lần refactor sau sẽ
 * không được phép biến thành một khối PID chạy thật. */
describe('ADD_NODE chặn khối REVIEW_REQUIRED', () => {
  it('từ chối PID với mã block-review-required và 0 diff', () => {
    const pid = node('PID', [
      { name: 'PV', direction: 'INPUT', dataType: 'REAL' },
      { name: 'OUT', direction: 'OUTPUT', dataType: 'REAL' },
    ])
    const document = golden()
    const before = createFbdEditorState(document)
    const after = fbdEditorReducer(before, {
      type: 'ADD_NODE',
      networkId: document.networks[0].id,
      node: pid,
      position: { x: 10, y: 10 },
    })

    expect(after.announcement.code).toBe('block-review-required')
    expect(after.past).toHaveLength(0)
    expect(after.document).toEqual(before.document)
    expect(vi('block-review-required')).not.toBe('')
  })

  it('không chặn node không thuộc registry (INPUT/OUTPUT/CONSTANT/POU người dùng)', () => {
    const io = node('INPUT', [{ name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' }], 'INPUT')
    const document = golden()
    const state = fbdEditorReducer(createFbdEditorState(document), {
      type: 'ADD_NODE',
      networkId: document.networks[0].id,
      node: io,
    })
    expect(state.announcement.code).toBe('block-added')
  })
})

describe('ADD_WIRE — nối một nhịp dùng chung validator với BEGIN_OR_COMMIT_CONNECTION', () => {
  it('nối OUTPUT→INPUT hợp lệ: 1 wire, 1 undo, endpoint canonical', () => {
    const source = node('AND', [{ name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' }])
    const target = node('OR', [
      { name: 'IN1', direction: 'INPUT', dataType: 'BOOL' },
      { name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' },
    ])
    const { state: before, networkId } = stateWith(source, target)
    const candidate = wire(source, 'OUT', target, 'IN1')

    const after = fbdEditorReducer(before, { type: 'ADD_WIRE', networkId, wire: candidate })

    const wires = after.document.networks[0].wires
    expect(after.past).toHaveLength(1)
    expect(wires.filter((item) => item.id === candidate.id)).toHaveLength(1)
    const stored = wires.find((item) => item.id === candidate.id)
    expect(stored?.from).toEqual(candidate.from)
    expect(stored?.to).toEqual(candidate.to)
    expect(after.announcement.code).toBe('wire-connected')
  })

  it('không cần chọn cổng nguồn trước: ADD_WIRE độc lập với connectionFromPortId', () => {
    const source = node('AND', [{ name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' }])
    const target = node('OR', [{ name: 'IN1', direction: 'INPUT', dataType: 'BOOL' }])
    const { state: before, networkId } = stateWith(source, target)
    expect(before.connectionFromPortId).toBeNull()

    const after = fbdEditorReducer(before, {
      type: 'ADD_WIRE',
      networkId,
      wire: wire(source, 'OUT', target, 'IN1'),
    })
    expect(after.past).toHaveLength(1)
    expect(after.connectionFromPortId).toBeNull()
  })

  it.each([
    [
      'sai kiểu BOOL→REAL',
      () => [
        node('AND', [{ name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' }]),
        node('ADD', [{ name: 'IN1', direction: 'INPUT', dataType: 'REAL' }]),
      ] as const,
      'connect-incompatible',
    ],
    [
      'lệch đơn vị',
      () => [
        node('SCALE_A', [{ name: 'OUT', direction: 'OUTPUT', dataType: 'REAL', unit: 'degC' }]),
        node('SCALE_B', [{ name: 'IN1', direction: 'INPUT', dataType: 'REAL', unit: 'kPa' }]),
      ] as const,
      'connect-incompatible',
    ],
    [
      'sai hướng INPUT→INPUT',
      () => [
        node('SRC', [{ name: 'OUT', direction: 'INPUT', dataType: 'BOOL' }]),
        node('DST', [{ name: 'IN1', direction: 'INPUT', dataType: 'BOOL' }]),
      ] as const,
      'select-output-port',
    ],
  ])('chặn %s: 0 wire, 0 undo', (_label, build, expectedCode) => {
    const [source, target] = build()
    const { state: before, networkId } = stateWith(source, target)
    const wiresBefore = before.document.networks[0].wires.length

    const after = fbdEditorReducer(before, {
      type: 'ADD_WIRE',
      networkId,
      wire: wire(source, 'OUT', target, 'IN1'),
    })

    expect(after.announcement.code).toBe(expectedCode)
    expect(after.past).toHaveLength(0)
    expect(after.document.networks[0].wires).toHaveLength(wiresBefore)
  })

  it('chặn nối chéo network', () => {
    const source = node('AND', [{ name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' }])
    const target = node('OR', [{ name: 'IN1', direction: 'INPUT', dataType: 'BOOL' }])
    const document = golden()
    document.networks.push({
      id: uuid(0x60000000, 9),
      name: 'NETWORK_9',
      order: 9,
      nodes: [{ ...target, executionOrder: 0 }],
      wires: [],
    })
    document.networks[0].nodes.push({ ...source, executionOrder: document.networks[0].nodes.length })
    const before = createFbdEditorState(document)

    const after = fbdEditorReducer(before, {
      type: 'ADD_WIRE',
      networkId: document.networks[0].id,
      wire: wire(source, 'OUT', target, 'IN1'),
    })

    expect(after.announcement.code).toBe('connect-incompatible')
    expect(after.past).toHaveLength(0)
  })

  it('chặn cổng đích đã có driver (fan-in)', () => {
    const first = node('AND', [{ name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' }])
    const second = node('OR', [{ name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' }])
    const target = node('XOR', [{ name: 'IN1', direction: 'INPUT', dataType: 'BOOL' }])
    const { state: initial, networkId } = stateWith(first, second, target)

    const withDriver = fbdEditorReducer(initial, {
      type: 'ADD_WIRE',
      networkId,
      wire: wire(first, 'OUT', target, 'IN1', 1),
    })
    expect(withDriver.past).toHaveLength(1)

    const after = fbdEditorReducer(withDriver, {
      type: 'ADD_WIRE',
      networkId,
      wire: wire(second, 'OUT', target, 'IN1', 2),
    })

    expect(after.announcement.code).toBe('input-has-driver-or-limit')
    expect(after.past).toHaveLength(1)
    expect(after.document.networks[0].wires).toEqual(withDriver.document.networks[0].wires)
  })

  it('chặn UUID dây trùng với định danh đã có', () => {
    const source = node('AND', [{ name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' }])
    const target = node('OR', [{ name: 'IN1', direction: 'INPUT', dataType: 'BOOL' }])
    const { state: before, networkId } = stateWith(source, target)
    const clash: FbdWire = { ...wire(source, 'OUT', target, 'IN1'), id: source.id }

    const after = fbdEditorReducer(before, { type: 'ADD_WIRE', networkId, wire: clash })

    expect(after.announcement.code).toBe('wire-uuid-invalid')
    expect(after.past).toHaveLength(0)
  })

  it('chặn khi không có quyền sửa', () => {
    const source = node('AND', [{ name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' }])
    const target = node('OR', [{ name: 'IN1', direction: 'INPUT', dataType: 'BOOL' }])
    const { state, networkId } = stateWith(source, target)
    const readOnly = fbdEditorReducer(state, { type: 'SET_CAN_EDIT', canEdit: false })

    const after = fbdEditorReducer(readOnly, {
      type: 'ADD_WIRE',
      networkId,
      wire: wire(source, 'OUT', target, 'IN1'),
    })

    expect(after.announcement.code).toBe('no-edit-permission')
    expect(after.past).toHaveLength(0)
  })

  it('chặn network không tồn tại', () => {
    const source = node('AND', [{ name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' }])
    const target = node('OR', [{ name: 'IN1', direction: 'INPUT', dataType: 'BOOL' }])
    const { state } = stateWith(source, target)

    const after = fbdEditorReducer(state, {
      type: 'ADD_WIRE',
      networkId: uuid(0x60000000, 77),
      wire: wire(source, 'OUT', target, 'IN1'),
    })

    expect(after.past).toHaveLength(0)
    expect(after.document).toEqual(state.document)
  })

  it('chặn nối ngược thứ tự thực thi combinational (TC-FBD-WIRE-002)', () => {
    const early = node('AND', [
      { name: 'IN1', direction: 'INPUT', dataType: 'BOOL' },
      { name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' },
    ])
    const late = node('OR', [
      { name: 'IN1', direction: 'INPUT', dataType: 'BOOL' },
      { name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' },
    ])
    const { state: before, networkId } = stateWith(early, late)
    const wiresBefore = before.document.networks[0].wires.length

    // Thử nối từ late (executionOrder lớn hơn) sang early (executionOrder nhỏ hơn)
    const candidate = wire(late, 'OUT', early, 'IN1')
    const after = fbdEditorReducer(before, {
      type: 'ADD_WIRE',
      networkId,
      wire: candidate,
    })

    expect(after.announcement.code).toBe('connect-reverse-order')
    expect(after.past).toHaveLength(0)
    expect(after.document.networks[0].wires).toHaveLength(wiresBefore)
  })

  it('chặn vượt FBD_MAX_WIRES (TC-FBD-WIRE-002)', () => {
    const source = node('AND', [{ name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' }])
    const target = node('OR', [{ name: 'IN1', direction: 'INPUT', dataType: 'BOOL' }])
    const document = golden()
    const net = document.networks[0]
    net.nodes.push({ ...source, executionOrder: net.nodes.length })
    net.nodes.push({ ...target, executionOrder: net.nodes.length + 1 })
    // Giả lập đồ thị đã đạt trần số lượng dây FBD_MAX_WIRES
    while (net.wires.length < FBD_MAX_WIRES) {
      net.wires.push({
        id: uuid(0x73000000, net.wires.length + 1),
        from: { nodeId: net.nodes[0].id, portId: net.nodes[0].ports[0].id },
        to: { nodeId: net.nodes[2].id, portId: net.nodes[2].ports[0].id },
      })
    }
    const before = createFbdEditorState(document)
    const wiresBefore = before.document.networks[0].wires.length
    expect(wiresBefore).toBe(FBD_MAX_WIRES)

    const after = fbdEditorReducer(before, {
      type: 'ADD_WIRE',
      networkId: net.id,
      wire: wire(source, 'OUT', target, 'IN1', 9999),
    })

    expect(after.announcement.code).toBe('input-has-driver-or-limit')
    expect(after.past).toHaveLength(0)
    expect(after.document.networks[0].wires).toHaveLength(wiresBefore)
  })
})

describe('RECONNECT_WIRE — giữ wire identity và thay đầu nối theo một transaction', () => {
  it('đổi đầu đích, giữ nguyên nguồn/id và undo trả lại đúng dây cũ', () => {
    const source = node('AND', [{ name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' }])
    const firstTarget = node('OR', [{ name: 'IN1', direction: 'INPUT', dataType: 'BOOL' }])
    const nextTarget = node('XOR', [{ name: 'IN1', direction: 'INPUT', dataType: 'BOOL' }])
    const { state: initial, networkId } = stateWith(source, firstTarget, nextTarget)
    const original = wire(source, 'OUT', firstTarget, 'IN1', 81)
    const connected = fbdEditorReducer(initial, { type: 'ADD_WIRE', networkId, wire: original })
    const replacement = { ...wire(source, 'OUT', nextTarget, 'IN1', 81), id: original.id }

    const reconnected = fbdEditorReducer(connected, {
      type: 'RECONNECT_WIRE', networkId, wireId: original.id, wire: replacement,
    })

    expect(reconnected.document.networks[0].wires.filter((item) => item.id === original.id)).toEqual([replacement])
    expect(reconnected.past).toHaveLength(2)
    expect(reconnected.selection).toEqual({ kind: 'wire', networkId, wireId: original.id })
    expect(reconnected.announcement.code).toBe('wire-reconnected')

    const undone = fbdEditorReducer(reconnected, { type: 'UNDO' })
    expect(undone.document.networks[0].wires.find((item) => item.id === original.id)).toEqual(original)
  })

  it('ứng viên sai bị từ chối atomic: dây cũ và history giữ nguyên', () => {
    const source = node('AND', [{ name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' }])
    const firstTarget = node('OR', [{ name: 'IN1', direction: 'INPUT', dataType: 'BOOL' }])
    const otherSource = node('GE', [{ name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL' }])
    const occupiedTarget = node('XOR', [{ name: 'IN1', direction: 'INPUT', dataType: 'BOOL' }])
    const { state: initial, networkId } = stateWith(source, firstTarget, otherSource, occupiedTarget)
    const original = wire(source, 'OUT', firstTarget, 'IN1', 82)
    const occupied = wire(otherSource, 'OUT', occupiedTarget, 'IN1', 83)
    let connected = fbdEditorReducer(initial, { type: 'ADD_WIRE', networkId, wire: original })
    connected = fbdEditorReducer(connected, { type: 'ADD_WIRE', networkId, wire: occupied })
    const beforeDocument = connected.document

    const rejected = fbdEditorReducer(connected, {
      type: 'RECONNECT_WIRE',
      networkId,
      wireId: original.id,
      wire: { ...wire(source, 'OUT', occupiedTarget, 'IN1', 82), id: original.id },
    })

    expect(rejected.announcement.code).toBe('input-has-driver-or-limit')
    expect(rejected.document).toBe(beforeDocument)
    expect(rejected.past).toHaveLength(2)
  })
})
