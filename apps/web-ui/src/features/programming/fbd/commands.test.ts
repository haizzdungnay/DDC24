import { describe, expect, it } from 'vitest'

import goldenJson from '../../../../../../contracts/programming/fbd/golden/ahu_fan_enable.json'

import {
  FBD_HISTORY_LIMIT,
  createFbdEditorState,
  fbdEditorReducer,
  resolveFbdKeyboardCommand,
  translateFbdAnnouncement,
} from './commands'
import { canonicalFbdJson } from './model'
import type { FbdDocument, FbdNetwork, FbdWire } from './model'

function golden(): FbdDocument {
  return JSON.parse(JSON.stringify(goldenJson)) as FbdDocument
}

function uuid(prefix: number, index: number): string {
  return `${prefix.toString(16).padStart(8, '0')}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
}

function network(index: number): FbdNetwork {
  return { id: uuid(0x60000000, index), name: `NETWORK_${index}`, order: index, nodes: [], wires: [] }
}

describe('command reducer FBD', () => {
  it('resolve đúng registry shortcut, không nhận Meta hoặc shortcut lạ', () => {
    expect(resolveFbdKeyboardCommand({ key: 'n', ctrlKey: true, shiftKey: true })).toBe('ADD_NETWORK')
    expect(resolveFbdKeyboardCommand({ key: 'ArrowUp', altKey: true })).toBe('MOVE_NODE_UP')
    expect(resolveFbdKeyboardCommand({ key: 'z', ctrlKey: true })).toBe('UNDO')
    expect(resolveFbdKeyboardCommand({ key: 'z', metaKey: true })).toBeNull()
    expect(resolveFbdKeyboardCommand({ key: 'F1' })).toBeNull()
  })

  it('thêm, xóa, undo/redo và chặn mutation khi chỉ đọc', () => {
    let state = createFbdEditorState(golden())
    state = fbdEditorReducer(state, { type: 'ADD_NETWORK', network: network(1) })
    expect(state.document.networks).toHaveLength(2)
    expect(state.past).toHaveLength(1)
    state = fbdEditorReducer(state, { type: 'UNDO' })
    expect(state.document.networks).toHaveLength(1)
    state = fbdEditorReducer(state, { type: 'REDO' })
    expect(state.document.networks).toHaveLength(2)
    state = fbdEditorReducer(state, { type: 'SET_CAN_EDIT', canEdit: false })
    state = fbdEditorReducer(state, { type: 'ADD_NETWORK', network: network(2) })
    expect(state.document.networks).toHaveLength(2)
    expect(state.announcement.code).toBe('no-edit-permission')
  })

  /* `T59-804` AC: "Ambiguous FBD port không auto-connect". Khoá bằng test vì
   * đây là loại tiện ích rất dễ bị thêm vào sau: thêm node xong tự nối vào cổng
   * "hợp lý nhất" sẽ tạo ra một dây mà người dùng không hề vẽ, và trong đồ hoạ
   * điều khiển một dây thừa là một lệnh chạy thật. */
  it('ADD_NODE không bao giờ tự nối dây, kể cả khi chỉ có đúng một cổng khớp', () => {
    const document = golden()
    const wiresBefore = document.networks[0].wires.length
    let state = createFbdEditorState(document)
    const node = {
      id: uuid(0x70000000, 1),
      kind: 'FUNCTION' as const,
      typeRef: 'AND',
      operandType: 'BOOL' as const,
      executionOrder: 0,
      parameters: {},
      ports: [
        { id: uuid(0x71000000, 1), name: 'IN1', direction: 'INPUT' as const, dataType: 'BOOL' as const, unit: null, order: 0 },
        { id: uuid(0x71000000, 2), name: 'IN2', direction: 'INPUT' as const, dataType: 'BOOL' as const, unit: null, order: 1 },
        { id: uuid(0x71000000, 3), name: 'OUT', direction: 'OUTPUT' as const, dataType: 'BOOL' as const, unit: null, order: 2 }
      ]
    }
    state = fbdEditorReducer(state, { type: 'ADD_NODE', networkId: document.networks[0].id, node })
    const nodes = state.document.networks[0].nodes
    expect(nodes[nodes.length - 1].typeRef).toBe('AND')
    expect(state.document.networks[0].wires).toHaveLength(wiresBefore)
    expect(state.connectionFromPortId).toBeNull()
  })

  it('nối output→input tương thích và từ chối input đã có driver', () => {
    const document = golden()
    document.networks[0].wires = document.networks[0].wires.slice(1)
    let state = createFbdEditorState(document)
    const sourcePortId = document.networks[0].nodes[0].ports[0].id
    const targetPortId = document.networks[0].nodes[2].ports[0].id
    state = fbdEditorReducer(state, { type: 'BEGIN_OR_COMMIT_CONNECTION', portId: sourcePortId })
    const wire: FbdWire = {
      id: '50000000-0000-4000-8000-000000000004',
      from: { nodeId: document.networks[0].nodes[0].id, portId: sourcePortId },
      to: { nodeId: document.networks[0].nodes[2].id, portId: targetPortId },
    }
    state = fbdEditorReducer(state, { type: 'BEGIN_OR_COMMIT_CONNECTION', portId: targetPortId, wire })
    expect(state.document.networks[0].wires).toHaveLength(3)
    state = fbdEditorReducer(state, { type: 'BEGIN_OR_COMMIT_CONNECTION', portId: sourcePortId })
    state = fbdEditorReducer(state, {
      type: 'BEGIN_OR_COMMIT_CONNECTION',
      portId: targetPortId,
      wire: { ...wire, id: '50000000-0000-4000-8000-000000000005' },
    })
    expect(state.document.networks[0].wires).toHaveLength(3)
    expect(state.announcement.code).toBe('input-has-driver-or-limit')
  })

  it('xóa block kéo theo wire và đổi thứ tự có undo', () => {
    const document = golden()
    let state = createFbdEditorState(document)
    const andNode = document.networks[0].nodes[2]
    state = fbdEditorReducer(state, {
      type: 'SELECT', selection: { kind: 'node', networkId: document.networks[0].id, nodeId: andNode.id },
    })
    state = fbdEditorReducer(state, { type: 'DELETE_SELECTION' })
    expect(state.document.networks[0].nodes).toHaveLength(3)
    expect(state.document.networks[0].wires).toHaveLength(0)
    state = fbdEditorReducer(state, { type: 'UNDO' })
    expect(state.document.networks[0].nodes).toHaveLength(4)
    expect(state.document.networks[0].wires).toHaveLength(3)

    state = fbdEditorReducer(state, {
      type: 'SELECT', selection: { kind: 'node', networkId: document.networks[0].id, nodeId: andNode.id },
    })
    state = fbdEditorReducer(state, { type: 'MOVE_NODE', delta: -1 })
    expect(state.document.networks[0].nodes.find((node) => node.id === andNode.id)?.executionOrder).toBe(1)
    state = fbdEditorReducer(state, { type: 'UNDO' })
    expect(state.document.networks[0].nodes.find((node) => node.id === andNode.id)?.executionOrder).toBe(2)
  })

  it('giới hạn lịch sử ở đúng 50 bản', () => {
    let state = createFbdEditorState(golden())
    for (let index = 1; index <= FBD_HISTORY_LIMIT + 5; index += 1) {
      state = fbdEditorReducer(state, { type: 'ADD_NETWORK', network: network(index) })
    }
    expect(state.past).toHaveLength(FBD_HISTORY_LIMIT)
    expect(state.document.networks).toHaveLength(FBD_HISTORY_LIMIT + 6)
  })

  it('đồng bộ Draft ngoài và xóa lịch sử cũ', () => {
    let state = createFbdEditorState(golden())
    state = fbdEditorReducer(state, { type: 'ADD_NETWORK', network: network(1) })
    expect(state.past).toHaveLength(1)
    const external = golden()
    external.name = 'EXTERNAL_DRAFT'
    state = fbdEditorReducer(state, { type: 'REPLACE_DOCUMENT', document: external })
    expect(state.document.name).toBe('EXTERNAL_DRAFT')
    expect(state.past).toEqual([])
    expect(state.future).toEqual([])
  })

  it('từ chối identity payload trùng hoặc không canonical trước mutation', () => {
    const document = golden()
    let state = createFbdEditorState(document)
    state = fbdEditorReducer(state, {
      type: 'ADD_NETWORK',
      network: { ...network(1), id: document.networks[0].id },
    })
    expect(state.document.networks).toHaveLength(1)
    expect(state.announcement.code).toBe('network-uuid-invalid')

    state = fbdEditorReducer(state, {
      type: 'ADD_NETWORK',
      network: { ...network(2), id: 'NOT-A-UUID' },
    })
    expect(state.document.networks).toHaveLength(1)
    expect(state.announcement.code).toBe('network-uuid-invalid')
  })
})

describe('SET_NODE_* (WP-05/06/07, FBD_EDITOR_DESIGN.md §3)', () => {
  const networkId = '20000000-0000-4000-8000-000000000001'

  it('SET_NODE_VARIABLE đổi tên + đơn vị của INPUT/OUTPUT, từ chối tên không hợp lệ', () => {
    const document = golden()
    let state = createFbdEditorState(document)
    const inputNode = document.networks[0].nodes[0]
    state = fbdEditorReducer(state, {
      type: 'SET_NODE_VARIABLE', networkId, nodeId: inputNode.id, variable: 'ZONE_OCCUPIED', unit: 'bool',
    })
    const updated = state.document.networks[0].nodes.find((node) => node.id === inputNode.id)
    expect(updated?.parameters.variable).toBe('ZONE_OCCUPIED')
    expect(updated?.ports[0].unit).toBe('bool')

    state = fbdEditorReducer(state, {
      type: 'SET_NODE_VARIABLE', networkId, nodeId: inputNode.id, variable: '1-bad-name', unit: null,
    })
    expect(state.announcement.code).toBe('invalid-variable-name')

    const andNode = document.networks[0].nodes[2]
    state = fbdEditorReducer(state, {
      type: 'SET_NODE_VARIABLE', networkId, nodeId: andNode.id, variable: 'X', unit: null,
    })
    expect(state.announcement.code).toBe('node-not-found')
  })

  it('SET_NODE_VALUE đổi giá trị CONSTANT, từ chối giá trị sai kiểu', () => {
    const document = golden()
    document.networks[0].nodes.push({
      id: '20000000-0000-4000-8000-0000000000c1',
      kind: 'CONSTANT', typeRef: 'REAL', executionOrder: 4, parameters: { value: 0 },
      ports: [{ id: '20000000-0000-4000-8000-0000000000c2', name: 'OUT', direction: 'OUTPUT', dataType: 'REAL', unit: null, order: 0 }],
    })
    let state = createFbdEditorState(document)
    state = fbdEditorReducer(state, {
      type: 'SET_NODE_VALUE', networkId, nodeId: '20000000-0000-4000-8000-0000000000c1', value: 21.5,
    })
    expect(state.document.networks[0].nodes.find((node) => node.typeRef === 'REAL' && node.kind === 'CONSTANT')?.parameters.value).toBe(21.5)

    state = fbdEditorReducer(state, {
      type: 'SET_NODE_VALUE', networkId, nodeId: '20000000-0000-4000-8000-0000000000c1', value: 'not-a-number',
    })
    expect(state.announcement.code).toBe('invalid-constant-value')
  })

  it('SET_NODE_TYPE đổi kiểu INPUT/OUTPUT và toán hạng T của FUNCTION đa hình, giữ port id', () => {
    const document = golden()
    let state = createFbdEditorState(document)
    const inputNode = document.networks[0].nodes[0]
    const originalPortId = inputNode.ports[0].id
    state = fbdEditorReducer(state, { type: 'SET_NODE_TYPE', networkId, nodeId: inputNode.id, dataType: 'REAL' })
    const updatedInput = state.document.networks[0].nodes.find((node) => node.id === inputNode.id)
    expect(updatedInput?.typeRef).toBe('REAL')
    expect(updatedInput?.ports[0].dataType).toBe('REAL')
    expect(updatedInput?.ports[0].id).toBe(originalPortId)

    document.networks[0].nodes.push({
      id: '20000000-0000-4000-8000-0000000000d1', kind: 'FUNCTION', typeRef: 'ADD', executionOrder: 4, parameters: {},
      ports: [
        { id: '20000000-0000-4000-8000-0000000000d2', name: 'IN1', direction: 'INPUT', dataType: 'REAL', unit: null, order: 0 },
        { id: '20000000-0000-4000-8000-0000000000d3', name: 'IN2', direction: 'INPUT', dataType: 'REAL', unit: null, order: 1 },
        { id: '20000000-0000-4000-8000-0000000000d4', name: 'OUT', direction: 'OUTPUT', dataType: 'REAL', unit: null, order: 2 },
      ],
    })
    state = createFbdEditorState(document)
    state = fbdEditorReducer(state, { type: 'SET_NODE_TYPE', networkId, nodeId: '20000000-0000-4000-8000-0000000000d1', dataType: 'DINT' })
    const addNode = state.document.networks[0].nodes.find((node) => node.id === '20000000-0000-4000-8000-0000000000d1')
    expect(addNode?.ports.every((port) => port.dataType === 'DINT')).toBe(true)
    expect(addNode?.ports.map((port) => port.id)).toEqual(['20000000-0000-4000-8000-0000000000d2', '20000000-0000-4000-8000-0000000000d3', '20000000-0000-4000-8000-0000000000d4'])

    state = fbdEditorReducer(state, { type: 'SET_NODE_TYPE', networkId, nodeId: '20000000-0000-4000-8000-0000000000d1', dataType: 'BOOL' })
    expect(state.announcement.code).toBe('invalid-data-type')
  })

  it('SET_NODE_TYPE trên MOD chỉ cho phép kiểu nguyên (giữ OUT:BOOL cố định cho compare)', () => {
    const document = golden()
    document.networks[0].nodes.push({
      id: '20000000-0000-4000-8000-0000000000e1', kind: 'FUNCTION', typeRef: 'EQ', executionOrder: 4, parameters: {},
      ports: [
        { id: '20000000-0000-4000-8000-0000000000e2', name: 'IN1', direction: 'INPUT', dataType: 'REAL', unit: null, order: 0 },
        { id: '20000000-0000-4000-8000-0000000000e3', name: 'IN2', direction: 'INPUT', dataType: 'REAL', unit: null, order: 1 },
        { id: '20000000-0000-4000-8000-0000000000e4', name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL', unit: null, order: 2 },
      ],
    })
    let state = createFbdEditorState(document)
    state = fbdEditorReducer(state, { type: 'SET_NODE_TYPE', networkId, nodeId: '20000000-0000-4000-8000-0000000000e1', dataType: 'DINT' })
    const eqNode = state.document.networks[0].nodes.find((node) => node.id === '20000000-0000-4000-8000-0000000000e1')
    expect(eqNode?.ports.find((port) => port.name === 'IN1')?.dataType).toBe('DINT')
    expect(eqNode?.ports.find((port) => port.name === 'OUT')?.dataType).toBe('BOOL')
  })

  it('SET_NODE_FB_PARAMS gán instance/retained cho FUNCTION_BLOCK, từ chối tên instance sai và node không phải FB', () => {
    const document = golden()
    document.networks[0].nodes.push({
      id: '20000000-0000-4000-8000-0000000000f1', kind: 'FUNCTION_BLOCK', typeRef: 'TON', executionOrder: 4, parameters: {},
      ports: [
        { id: '20000000-0000-4000-8000-0000000000f2', name: 'IN', direction: 'INPUT', dataType: 'BOOL', unit: null, order: 0 },
        { id: '20000000-0000-4000-8000-0000000000f3', name: 'PT', direction: 'INPUT', dataType: 'TIME', unit: null, order: 1 },
        { id: '20000000-0000-4000-8000-0000000000f4', name: 'Q', direction: 'OUTPUT', dataType: 'BOOL', unit: null, order: 2 },
        { id: '20000000-0000-4000-8000-0000000000f5', name: 'ET', direction: 'OUTPUT', dataType: 'TIME', unit: null, order: 3 },
      ],
    })
    let state = createFbdEditorState(document)
    state = fbdEditorReducer(state, {
      type: 'SET_NODE_FB_PARAMS', networkId, nodeId: '20000000-0000-4000-8000-0000000000f1', instance: 'FanDelay', retained: true,
    })
    const fb = state.document.networks[0].nodes.find((node) => node.id === '20000000-0000-4000-8000-0000000000f1')
    expect(fb?.parameters).toEqual({ instance: 'FanDelay', retained: true })

    state = fbdEditorReducer(state, {
      type: 'SET_NODE_FB_PARAMS', networkId, nodeId: '20000000-0000-4000-8000-0000000000f1', instance: '1-bad', retained: false,
    })
    expect(state.announcement.code).toBe('invalid-instance-name')

    const andNode = document.networks[0].nodes[2]
    state = fbdEditorReducer(state, {
      type: 'SET_NODE_FB_PARAMS', networkId, nodeId: andNode.id, instance: null, retained: false,
    })
    expect(state.announcement.code).toBe('node-not-found')
  })
})

describe('translateFbdAnnouncement (BUG-012)', () => {
  const pick = (vi: string, _en: string) => vi
  const pickEn = (_vi: string, en: string) => en

  it('dịch mã có tham số đúng locale', () => {
    expect(translateFbdAnnouncement(pick, { code: 'block-added', params: { type: 'AND' } })).toBe('Đã thêm block AND')
    expect(translateFbdAnnouncement(pickEn, { code: 'block-added', params: { type: 'AND' } })).toBe('Added block AND')
  })

  it('dịch mã không tham số', () => {
    expect(translateFbdAnnouncement(pick, { code: 'undone' })).toBe('Đã hoàn tác')
    expect(translateFbdAnnouncement(pickEn, { code: 'undone' })).toBe('Undone')
  })

  it('mã idle hoặc lạ trả về chuỗi rỗng', () => {
    expect(translateFbdAnnouncement(pick, { code: 'idle' })).toBe('')
    expect(translateFbdAnnouncement(pick, { code: 'unknown-code' })).toBe('')
  })
})

/* `T59-806` — kéo block chỉ đổi HÌNH HỌC. Bộ test này khoá đúng ranh giới đó:
 * vị trí đi vào `layout`, và không một trường ngữ nghĩa nào đổi theo. */
describe('SET_NODE_POSITION (T59-806)', () => {
  function nodeOf(state: ReturnType<typeof createFbdEditorState>) {
    return state.document.networks[0].nodes[0]
  }

  it('ghi toạ độ vào layout và KHÔNG đụng executionOrder', () => {
    const before = createFbdEditorState(golden(), true)
    const node = nodeOf(before)
    const order = node.executionOrder
    const after = fbdEditorReducer(before, { type: 'SET_NODE_POSITION', networkId: before.document.networks[0].id, nodeId: node.id, x: 320, y: 140 })

    expect(after.document.layout?.nodes[node.id]).toEqual({ x: 320, y: 140 })
    expect(after.document.networks[0].nodes[0].executionOrder).toBe(order)
    expect(after.announcement.code).toBe('block-moved')
  })

  it('làm tròn về số nguyên — pixel lẻ chỉ làm Draft bẩn thêm', () => {
    const before = createFbdEditorState(golden(), true)
    const node = nodeOf(before)
    const after = fbdEditorReducer(before, { type: 'SET_NODE_POSITION', networkId: before.document.networks[0].id, nodeId: node.id, x: 100.4, y: 99.6 })
    expect(after.document.layout?.nodes[node.id]).toEqual({ x: 100, y: 100 })
  })

  it.each([
    ['ngoài trần dương', 1e9],
    ['ngoài trần âm', -1e9],
    ['NaN', Number.NaN],
    ['vô hạn', Number.POSITIVE_INFINITY],
  ])('TỪ CHỐI toạ độ %s thay vì kẹp về biên', (_label, x) => {
    const before = createFbdEditorState(golden(), true)
    const node = nodeOf(before)
    const after = fbdEditorReducer(before, { type: 'SET_NODE_POSITION', networkId: before.document.networks[0].id, nodeId: node.id, x, y: 0 })
    expect(after.announcement.code).toBe('invalid-position')
    expect(after.document.layout).toBeUndefined()
  })

  it('chỉ đọc thì không kéo được', () => {
    const before = createFbdEditorState(golden(), false)
    const node = nodeOf(before)
    const after = fbdEditorReducer(before, { type: 'SET_NODE_POSITION', networkId: before.document.networks[0].id, nodeId: node.id, x: 10, y: 10 })
    expect(after.announcement.code).toBe('no-edit-permission')
    expect(after.document.layout).toBeUndefined()
  })

  it('node không tồn tại thì từ chối, không tạo entry layout mồ côi', () => {
    const before = createFbdEditorState(golden(), true)
    const after = fbdEditorReducer(before, { type: 'SET_NODE_POSITION', networkId: before.document.networks[0].id, nodeId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', x: 10, y: 10 })
    expect(after.announcement.code).toBe('node-not-found')
    expect(after.document.layout).toBeUndefined()
  })

  it('kéo xong hoàn tác được về đúng vị trí cũ', () => {
    const before = createFbdEditorState(golden(), true)
    const node = nodeOf(before)
    const moved = fbdEditorReducer(before, { type: 'SET_NODE_POSITION', networkId: before.document.networks[0].id, nodeId: node.id, x: 320, y: 140 })
    const undone = fbdEditorReducer(moved, { type: 'UNDO' })
    expect(undone.document.layout).toBeUndefined()
  })
})

/* `AC-FBD-006` — "invalid typed connection is blocked immediately". Chặn NGAY
 * lúc nối, không đợi Check: một wire sai kiểu nằm trong Draft là một lần Check
 * đỏ mà người dùng phải tự lần ngược lại xem mình đã nối nhầm ở đâu. */
describe('nối sai kiểu bị chặn ngay (AC-FBD-006)', () => {
  function typedGraph(sourceType: string, targetType: string, sourceUnit: string | null = null, targetUnit: string | null = null): FbdDocument {
    const document = golden()
    const network = document.networks[0]
    network.wires = []
    const source = network.nodes[0]
    const target = network.nodes[2]
    source.ports = [{ id: uuid(0x70000000, 1), name: 'OUT', direction: 'OUTPUT', dataType: sourceType as never, unit: sourceUnit, order: 0 }]
    target.ports = [{ id: uuid(0x70000000, 2), name: 'IN', direction: 'INPUT', dataType: targetType as never, unit: targetUnit, order: 0 }]
    return document
  }

  function attempt(document: FbdDocument) {
    let state = createFbdEditorState(document, true)
    state = fbdEditorReducer(state, { type: 'BEGIN_OR_COMMIT_CONNECTION', portId: uuid(0x70000000, 1) })
    expect(state.connectionFromPortId).toBe(uuid(0x70000000, 1))
    return fbdEditorReducer(state, {
      type: 'BEGIN_OR_COMMIT_CONNECTION',
      portId: uuid(0x70000000, 2),
      wire: { id: uuid(0x80000000, 1), from: { nodeId: '', portId: uuid(0x70000000, 1) }, to: { nodeId: '', portId: uuid(0x70000000, 2) } },
    })
  }

  it('khác kiểu dữ liệu ⇒ từ chối, không tạo wire', () => {
    const after = attempt(typedGraph('BOOL', 'REAL'))
    expect(after.announcement.code).toBe('connect-incompatible')
    expect(after.document.networks[0].wires).toHaveLength(0)
  })

  it('cùng kiểu nhưng khác đơn vị ⇒ từ chối', () => {
    const after = attempt(typedGraph('REAL', 'REAL', 'degC', 'kPa'))
    expect(after.announcement.code).toBe('connect-incompatible')
    expect(after.document.networks[0].wires).toHaveLength(0)
  })

  it('nối vào port OUTPUT (sai hướng) ⇒ từ chối', () => {
    const document = typedGraph('BOOL', 'BOOL')
    document.networks[0].nodes[2].ports[0].direction = 'OUTPUT'
    const after = attempt(document)
    expect(after.announcement.code).toBe('connect-incompatible')
    expect(after.document.networks[0].wires).toHaveLength(0)
  })

  it('TC-FBD-NET-003: dây xuyên network bị reducer chặn và không đổi canonical graph', () => {
    const document = typedGraph('BOOL', 'BOOL')
    const target = document.networks[0].nodes.splice(2, 1)[0]
    document.networks[0].wires = []
    document.networks.push({
      id: uuid(0x90000000, 1),
      name: 'network_2',
      order: 1,
      nodes: [target],
      wires: [],
    })
    const before = canonicalFbdJson(document)

    const after = attempt(document)

    expect(after.announcement.code).toBe('connect-incompatible')
    expect(canonicalFbdJson(after.document)).toBe(before)
    expect(after.document.networks.every((network) => network.wires.length === 0)).toBe(true)
  })
})

/* `WP-05` AC: "Save/reload reproduces layout; port `order` unchanged". Hình học
 * chỉ có ích nếu nó sống qua một vòng lưu–đọc lại; và nó không được phép làm
 * xê dịch `order` của port, vì `order` là thứ compiler dùng để xếp toán hạng. */
describe('layout sống qua vòng lưu và đọc lại (T59-806)', () => {
  it('toạ độ và port order giữ nguyên sau canonical hoá + parse lại', () => {
    const start = createFbdEditorState(golden(), true)
    const node = start.document.networks[0].nodes[1]
    const moved = fbdEditorReducer(start, {
      type: 'SET_NODE_POSITION',
      networkId: start.document.networks[0].id,
      nodeId: node.id,
      x: 480,
      y: 260,
    })

    const saved = canonicalFbdJson(moved.document)
    const reloaded = createFbdEditorState(JSON.parse(saved) as FbdDocument, true)

    expect(reloaded.document.layout?.nodes[node.id]).toEqual({ x: 480, y: 260 })
    for (const [index, network] of reloaded.document.networks.entries()) {
      for (const [nodeIndex, reloadedNode] of network.nodes.entries()) {
        const original = moved.document.networks[index].nodes[nodeIndex]
        expect(reloadedNode.ports.map((port) => port.order)).toEqual(original.ports.map((port) => port.order))
        expect(reloadedNode.executionOrder).toBe(original.executionOrder)
      }
    }
  })
})

describe('Task 3: selectionRevision, multi-node, and atomic actions', () => {
  it('selectionRevision khởi tạo = 0, tăng 1 khi commit hoặc SELECT thay đổi', () => {
    const doc = golden()
    let state = createFbdEditorState(doc)
    expect(state.selectionRevision).toBe(0)

    // Action SELECT đổi selection => selectionRevision tăng 1
    const netId = doc.networks[0].id
    const n1 = doc.networks[0].nodes[0].id
    state = fbdEditorReducer(state, {
      type: 'SELECT',
      selection: { kind: 'node', networkId: netId, nodeId: n1 },
    })
    expect(state.selectionRevision).toBe(1)

    // Action SELECT trùng selection cũ => no-op => không tăng
    state = fbdEditorReducer(state, {
      type: 'SELECT',
      selection: { kind: 'node', networkId: netId, nodeId: n1 },
    })
    expect(state.selectionRevision).toBe(1)

    // SELECT null => đổi selection => tăng
    state = fbdEditorReducer(state, { type: 'SELECT', selection: null })
    expect(state.selectionRevision).toBe(2)

    // Mutation commit (ADD_NETWORK) => tăng selectionRevision
    state = fbdEditorReducer(state, { type: 'ADD_NETWORK', network: network(2) })
    expect(state.selectionRevision).toBe(3)

    // Action bị reject => không tăng selectionRevision
    state = fbdEditorReducer(state, {
      type: 'SET_NODE_POSITION',
      networkId: netId,
      nodeId: 'non-existent',
      x: 10,
      y: 10,
    })
    expect(state.selectionRevision).toBe(3)
  })

  it('DELETE_SELECTION với multi-node: xóa toàn bộ node trong nodeIds và wire nối tới chúng', () => {
    const doc = golden()
    const netId = doc.networks[0].id
    const n0 = doc.networks[0].nodes[0].id
    const n2 = doc.networks[0].nodes[2].id
    let state = createFbdEditorState(doc)

    state = fbdEditorReducer(state, {
      type: 'SELECT',
      selection: { kind: 'multi-node', networkId: netId, nodeIds: [n0, n2] },
    })
    state = fbdEditorReducer(state, { type: 'DELETE_SELECTION' })

    // Ban đầu có 4 nodes, xóa 2 (n0 và n2) còn 2 (n1 và n3)
    expect(state.document.networks[0].nodes).toHaveLength(2)
    expect(state.document.networks[0].nodes.map((n) => n.id)).not.toContain(n0)
    expect(state.document.networks[0].nodes.map((n) => n.id)).not.toContain(n2)
    // Toàn bộ 3 wire trong ahu_fan_enable đều chạm vào n0 hoặc n2, nên bị xóa sạch
    expect(state.document.networks[0].wires).toHaveLength(0)
    expect(state.selection).toBeNull()
  })

  it('MULTI_MOVE: cập nhật toạ độ nhiều node trong 1 commit duy nhất, kiểm tra bounds và expectedSelectionRevision', () => {
    const doc = golden()
    const netId = doc.networks[0].id
    const n0 = doc.networks[0].nodes[0].id
    const n1 = doc.networks[0].nodes[1].id
    let state = createFbdEditorState(doc)

    // expectedSelectionRevision lệch => reject
    const rejected = fbdEditorReducer(state, {
      type: 'MULTI_MOVE',
      networkId: netId,
      moves: [{ nodeId: n0, x: 100, y: 100 }],
      expectedSelectionRevision: 999,
    })
    expect(rejected.announcement.code).toBe('selection-revision-mismatch')
    expect(rejected.selectionRevision).toBe(0)

    // Toạ độ ngoài bounds [-100000..100000] => reject
    const outOfBounds = fbdEditorReducer(state, {
      type: 'MULTI_MOVE',
      networkId: netId,
      moves: [{ nodeId: n0, x: 200000, y: 0 }],
    })
    expect(outOfBounds.announcement.code).toBe('invalid-position')

    // MULTI_MOVE hợp lệ => 1 commit duy nhất
    state = fbdEditorReducer(state, {
      type: 'MULTI_MOVE',
      networkId: netId,
      moves: [
        { nodeId: n0, x: 120.4, y: 130.6 },
        { nodeId: n1, x: 200, y: 220 },
      ],
      expectedSelectionRevision: 0,
    })
    expect(state.document.layout?.nodes[n0]).toEqual({ x: 120, y: 131 })
    expect(state.document.layout?.nodes[n1]).toEqual({ x: 200, y: 220 })
    expect(state.selectionRevision).toBe(1)
    expect(state.past).toHaveLength(1)

    // No-op (không toạ độ nào đổi) => return state cũ, không tăng revision
    const noop = fbdEditorReducer(state, {
      type: 'MULTI_MOVE',
      networkId: netId,
      moves: [
        { nodeId: n0, x: 120, y: 131 },
        { nodeId: n1, x: 200, y: 220 },
      ],
    })
    expect(noop).toBe(state)
  })

  it('SET_LAYOUT_BATCH: cập nhật layout hàng loạt', () => {
    const doc = golden()
    const netId = doc.networks[0].id
    const n0 = doc.networks[0].nodes[0].id
    let state = createFbdEditorState(doc)

    state = fbdEditorReducer(state, {
      type: 'SET_LAYOUT_BATCH',
      networkId: netId,
      positions: {
        [n0]: { x: 300, y: 400 },
      },
      expectedSelectionRevision: 0,
    })
    expect(state.document.layout?.nodes[n0]).toEqual({ x: 300, y: 400 })
    expect(state.selectionRevision).toBe(1)
  })

  it('PASTE_SUBGRAPH: ghép node, wire, layout và cập nhật multi-node selection', () => {
    const doc = golden()
    const netId = doc.networks[0].id
    let state = createFbdEditorState(doc)

    const newNodeId = '70000000-0000-4000-8000-000000000001'
    const newPortId = '70000000-0000-4000-8000-000000000002'
    const newNodes = [
      {
        id: newNodeId,
        kind: 'CONSTANT' as const,
        typeRef: 'BOOL',
        executionOrder: 0,
        parameters: { value: true },
        ports: [{ id: newPortId, name: 'OUT', direction: 'OUTPUT' as const, dataType: 'BOOL' as const, unit: null, order: 0 }],
      },
    ]

    state = fbdEditorReducer(state, {
      type: 'PASTE_SUBGRAPH',
      targetNetworkId: netId,
      nodes: newNodes,
      wires: [],
      layoutNodes: { [newNodeId]: { x: 500, y: 600 } },
    })

    expect(state.document.networks[0].nodes.some((n) => n.id === newNodeId)).toBe(true)
    expect(state.document.layout?.nodes[newNodeId]).toEqual({ x: 500, y: 600 })
    expect(state.selection).toEqual({
      kind: 'multi-node',
      networkId: netId,
      nodeIds: [newNodeId],
    })
    expect(state.selectionRevision).toBe(1)
  })

  it('UPDATE_NODE_ATTRIBUTES: cập nhật đồng thời type + variable nguyên tử, past.length chỉ tăng 1 và 1 lần Undo phục hồi toàn bộ', () => {
    const doc = golden()
    const netId = doc.networks[0].id
    const node = doc.networks[0].nodes.find((n) => n.kind === 'INPUT')!
    let state = createFbdEditorState(doc)
    const initialPastLength = state.past.length
    const originalType = node.typeRef
    const originalVar = node.parameters.variable

    state = fbdEditorReducer(state, {
      type: 'UPDATE_NODE_ATTRIBUTES',
      networkId: netId,
      nodeId: node.id,
      dataType: 'REAL',
      variable: 'TempSensor',
      unit: 'degC',
    })

    // past.length chỉ tăng đúng 1
    expect(state.past.length).toBe(initialPastLength + 1)

    // Node được cập nhật đầy đủ cả kiểu, biến, và đơn vị
    const updatedNode = state.document.networks[0].nodes.find((n) => n.id === node.id)!
    expect(updatedNode.typeRef).toBe('REAL')
    expect(updatedNode.parameters.variable).toBe('TempSensor')
    expect(updatedNode.ports[0].dataType).toBe('REAL')
    expect(updatedNode.ports[0].unit).toBe('degC')

    // Đúng 1 lần UNDO hoàn nguyên cả type và variable về ban đầu
    state = fbdEditorReducer(state, { type: 'UNDO' })
    expect(state.past.length).toBe(initialPastLength)
    const revertedNode = state.document.networks[0].nodes.find((n) => n.id === node.id)!
    expect(revertedNode.typeRef).toBe(originalType)
    expect(revertedNode.parameters.variable).toBe(originalVar)
  })

  it('UPDATE_NODE_ATTRIBUTES: cập nhật đồng thời type + value của CONSTANT nguyên tử, 1 lần Undo phục hồi toàn bộ', () => {
    const doc = golden()
    const netId = doc.networks[0].id
    let state = createFbdEditorState(doc)

    // Thêm một CONSTANT node
    const constId = '80000000-0000-4000-8000-000000000001'
    const constPortId = '80000000-0000-4000-8000-000000000002'
    state = fbdEditorReducer(state, {
      type: 'ADD_NODE',
      networkId: netId,
      node: {
        id: constId,
        kind: 'CONSTANT',
        typeRef: 'INT',
        executionOrder: 0,
        parameters: { value: 10 },
        ports: [{ id: constPortId, name: 'OUT', direction: 'OUTPUT', dataType: 'INT', unit: null, order: 0 }],
      },
    })

    const pastBeforeUpdate = state.past.length

    state = fbdEditorReducer(state, {
      type: 'UPDATE_NODE_ATTRIBUTES',
      networkId: netId,
      nodeId: constId,
      dataType: 'REAL',
      value: 99.5,
    })

    expect(state.past.length).toBe(pastBeforeUpdate + 1)
    const updated = state.document.networks[0].nodes.find((n) => n.id === constId)!
    expect(updated.typeRef).toBe('REAL')
    expect(updated.parameters.value).toBe(99.5)
    expect(updated.ports[0].dataType).toBe('REAL')

    // 1 lần Undo phục hồi lại INT và 10
    state = fbdEditorReducer(state, { type: 'UNDO' })
    expect(state.past.length).toBe(pastBeforeUpdate)
    const reverted = state.document.networks[0].nodes.find((n) => n.id === constId)!
    expect(reverted.typeRef).toBe('INT')
    expect(reverted.parameters.value).toBe(10)
    expect(reverted.ports[0].dataType).toBe('INT')
  })
})
