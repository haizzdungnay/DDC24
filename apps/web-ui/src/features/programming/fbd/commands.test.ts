import { describe, expect, it } from 'vitest'

import goldenJson from '../../../../../../contracts/programming/fbd/golden/ahu_fan_enable.json'

import {
  FBD_HISTORY_LIMIT,
  createFbdEditorState,
  fbdEditorReducer,
  resolveFbdKeyboardCommand,
  translateFbdAnnouncement,
} from './commands'
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
