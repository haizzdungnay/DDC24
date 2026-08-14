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
