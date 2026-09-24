import { describe, expect, it } from 'vitest'
import { createFbdEditorState, fbdEditorReducer } from './commands'
import { canonicalFbdJson, type FbdDocument } from './model'

function createSampleDoc(): FbdDocument {
  return {
    $schema: '../../fbd_v1.schema.json',
    schemaVersion: 1,
    profileId: 'revA-1t-1-5-30',
    graphId: 'a0000000-0000-4000-8000-000000000000',
    name: 'TEST_REF_PROG',
    networks: [
      {
        id: 'b0000000-0000-4000-8000-000000000000',
        name: 'NW1',
        order: 0,
        nodes: [
          {
            id: 'c0000000-0000-4000-8000-000000000001',
            kind: 'INPUT',
            typeRef: 'BOOL',
            executionOrder: 0,
            parameters: { variable: 'AI_TEMP' },
            ports: [
              { id: 'd0000000-0000-4000-8000-000000000001', name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL', unit: null, order: 0 }
            ]
          },
          {
            id: 'c0000000-0000-4000-8000-000000000002',
            kind: 'FUNCTION',
            typeRef: 'AND',
            executionOrder: 1,
            parameters: {},
            ports: [
              { id: 'd0000000-0000-4000-8000-000000000002', name: 'IN1', direction: 'INPUT', dataType: 'BOOL', unit: null, order: 0 },
              { id: 'd0000000-0000-4000-8000-000000000003', name: 'IN2', direction: 'INPUT', dataType: 'BOOL', unit: null, order: 1 },
              { id: 'd0000000-0000-4000-8000-000000000004', name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL', unit: null, order: 2 }
            ]
          },
          {
            id: 'c0000000-0000-4000-8000-000000000003',
            kind: 'OUTPUT',
            typeRef: 'BOOL',
            executionOrder: 2,
            parameters: { variable: 'AO_VALVE' },
            ports: [
              { id: 'd0000000-0000-4000-8000-000000000005', name: 'IN', direction: 'INPUT', dataType: 'BOOL', unit: null, order: 0 }
            ]
          }
        ],
        wires: [
          {
            id: 'e0000000-0000-4000-8000-000000000001',
            from: { nodeId: 'c0000000-0000-4000-8000-000000000001', portId: 'd0000000-0000-4000-8000-000000000001' },
            to: { nodeId: 'c0000000-0000-4000-8000-000000000002', portId: 'd0000000-0000-4000-8000-000000000002' }
          },
          {
            id: 'e0000000-0000-4000-8000-000000000002',
            from: { nodeId: 'c0000000-0000-4000-8000-000000000002', portId: 'd0000000-0000-4000-8000-000000000004' },
            to: { nodeId: 'c0000000-0000-4000-8000-000000000003', portId: 'd0000000-0000-4000-8000-000000000005' }
          }
        ]
      }
    ]
  }
}

describe('Module R: Reducer Reference Actions & Undo/Redo', () => {
  it('TEST-R-001: CUT_WIRE chuyển wire sang reference, canonical document không đổi', () => {
    const doc = createSampleDoc()
    const initialCanonical = canonicalFbdJson(doc)
    let state = createFbdEditorState(doc, true)

    state = fbdEditorReducer(state, {
      type: 'CUT_WIRE',
      networkId: doc.networks[0].id,
      wireId: 'e0000000-0000-4000-8000-000000000001',
      customSignalName: 'TEMP_SIGNAL'
    })

    expect(state.wireReferences['e0000000-0000-4000-8000-000000000001']).toBeDefined()
    expect(state.wireReferences['e0000000-0000-4000-8000-000000000001']?.signalName).toBe('TEMP_SIGNAL')
    expect(state.announcement.code).toBe('wire-cut-to-reference')
    expect(canonicalFbdJson(state.document)).toBe(initialCanonical)
  })

  it('TEST-R-002: JOIN_WIRE phục hồi reference về direct wire', () => {
    const doc = createSampleDoc()
    let state = createFbdEditorState(doc, true)
    state = fbdEditorReducer(state, {
      type: 'CUT_WIRE',
      networkId: doc.networks[0].id,
      wireId: 'e0000000-0000-4000-8000-000000000001'
    })
    expect(state.wireReferences['e0000000-0000-4000-8000-000000000001']).toBeDefined()

    state = fbdEditorReducer(state, {
      type: 'JOIN_WIRE',
      networkId: doc.networks[0].id,
      wireId: 'e0000000-0000-4000-8000-000000000001'
    })
    expect(state.wireReferences['e0000000-0000-4000-8000-000000000001']).toBeUndefined()
    expect(state.announcement.code).toBe('reference-joined-to-wire')
  })

  it('TEST-R-003: Undo / Redo bảo toàn đồng bộ wireReferences và document', () => {
    const doc = createSampleDoc()
    let state = createFbdEditorState(doc, true)

    state = fbdEditorReducer(state, {
      type: 'CUT_WIRE',
      networkId: doc.networks[0].id,
      wireId: 'e0000000-0000-4000-8000-000000000001',
      customSignalName: 'SIG_A'
    })
    expect(state.wireReferences['e0000000-0000-4000-8000-000000000001']).toBeDefined()
    expect(state.past).toHaveLength(1)

    // Undo -> quay lại DIRECT
    state = fbdEditorReducer(state, { type: 'UNDO' })
    expect(state.wireReferences['e0000000-0000-4000-8000-000000000001']).toBeUndefined()
    expect(state.future).toHaveLength(1)

    // Redo -> phục hồi REFERENCE
    state = fbdEditorReducer(state, { type: 'REDO' })
    expect(state.wireReferences['e0000000-0000-4000-8000-000000000001']).toBeDefined()
    expect(state.wireReferences['e0000000-0000-4000-8000-000000000001']?.signalName).toBe('SIG_A')
  })

  it('TEST-R-004: Tự động dọn sạch reference khi xoá dây hoặc xoá khối', () => {
    const doc = createSampleDoc()
    let state = createFbdEditorState(doc, true)
    state = fbdEditorReducer(state, {
      type: 'CUT_WIRE',
      networkId: doc.networks[0].id,
      wireId: 'e0000000-0000-4000-8000-000000000001'
    })
    expect(state.wireReferences['e0000000-0000-4000-8000-000000000001']).toBeDefined()

    // Xoá dây qua DELETE_WIRES
    state = fbdEditorReducer(state, {
      type: 'DELETE_WIRES',
      networkId: doc.networks[0].id,
      wireIds: ['e0000000-0000-4000-8000-000000000001']
    })
    expect(state.wireReferences['e0000000-0000-4000-8000-000000000001']).toBeUndefined()
  })

  it('TEST-R-005: BATCH_CUT_NODE_WIRES và BATCH_JOIN_NODE_WIRES', () => {
    const doc = createSampleDoc()
    let state = createFbdEditorState(doc, true)

    // Batch cut mọi dây nối vào AND node
    state = fbdEditorReducer(state, {
      type: 'BATCH_CUT_NODE_WIRES',
      networkId: doc.networks[0].id,
      nodeId: 'c0000000-0000-4000-8000-000000000002',
      direction: 'ALL'
    })
    expect(state.wireReferences['e0000000-0000-4000-8000-000000000001']).toBeDefined()
    expect(state.wireReferences['e0000000-0000-4000-8000-000000000002']).toBeDefined()

    // Batch join lại
    state = fbdEditorReducer(state, {
      type: 'BATCH_JOIN_NODE_WIRES',
      networkId: doc.networks[0].id,
      nodeId: 'c0000000-0000-4000-8000-000000000002',
      direction: 'ALL'
    })
    expect(state.wireReferences['e0000000-0000-4000-8000-000000000001']).toBeUndefined()
    expect(state.wireReferences['e0000000-0000-4000-8000-000000000002']).toBeUndefined()
  })

  it('Fan-out & RENAME_REFERENCE: đổi tên đồng bộ toàn bộ nhánh cùng cổng nguồn', () => {
    const doc = createSampleDoc()
    // Thêm dây thứ 3 cùng xuất phát từ AI_TEMP.OUT
    doc.networks[0].wires.push({
      id: 'e0000000-0000-4000-8000-000000000003',
      from: { nodeId: 'c0000000-0000-4000-8000-000000000001', portId: 'd0000000-0000-4000-8000-000000000001' },
      to: { nodeId: 'c0000000-0000-4000-8000-000000000002', portId: 'd0000000-0000-4000-8000-000000000003' }
    })
    let state = createFbdEditorState(doc, true)

    // Cut dây 1
    state = fbdEditorReducer(state, {
      type: 'CUT_WIRE',
      networkId: doc.networks[0].id,
      wireId: 'e0000000-0000-4000-8000-000000000001',
      customSignalName: 'TEMP_FANOUT'
    })

    // Cut dây 3 cùng nguồn -> tự động thừa hưởng signalName TEMP_FANOUT
    state = fbdEditorReducer(state, {
      type: 'CUT_WIRE',
      networkId: doc.networks[0].id,
      wireId: 'e0000000-0000-4000-8000-000000000003'
    })
    expect(state.wireReferences['e0000000-0000-4000-8000-000000000003']?.signalName).toBe('TEMP_FANOUT')

    // Đổi tên qua RENAME_REFERENCE -> cả 2 dây cùng đổi sang tên mới
    state = fbdEditorReducer(state, {
      type: 'RENAME_REFERENCE',
      networkId: doc.networks[0].id,
      wireId: 'e0000000-0000-4000-8000-000000000001',
      newSignalName: 'TEMP_ZONE_1'
    })
    expect(state.wireReferences['e0000000-0000-4000-8000-000000000001']?.signalName).toBe('TEMP_ZONE_1')
    expect(state.wireReferences['e0000000-0000-4000-8000-000000000003']?.signalName).toBe('TEMP_ZONE_1')
  })

  it("TEST-R-006: Fan-out 3 sinks hon hop (1 ref, 2 direct wire). Doi ten ref, cat tiep day 2 -> thua huong ten moi", () => {
    const doc = createSampleDoc()
    doc.networks[0].wires.push({
      id: "e0000000-0000-4000-8000-000000000003",
      from: { nodeId: "c0000000-0000-4000-8000-000000000001", portId: "d0000000-0000-4000-8000-000000000001" },
      to: { nodeId: "c0000000-0000-4000-8000-000000000002", portId: "d0000000-0000-4000-8000-000000000003" }
    })
    let state = createFbdEditorState(doc, true)

    state = fbdEditorReducer(state, {
      type: "CUT_WIRE",
      networkId: doc.networks[0].id,
      wireId: "e0000000-0000-4000-8000-000000000001",
      customSignalName: "SIG_ORIGINAL"
    })
    expect(state.wireReferences["e0000000-0000-4000-8000-000000000001"]?.signalName).toBe("SIG_ORIGINAL")

    state = fbdEditorReducer(state, {
      type: "RENAME_REFERENCE",
      networkId: doc.networks[0].id,
      wireId: "e0000000-0000-4000-8000-000000000001",
      newSignalName: "SIG_UPDATED"
    })
    expect(state.wireReferences["e0000000-0000-4000-8000-000000000001"]?.signalName).toBe("SIG_UPDATED")

    state = fbdEditorReducer(state, {
      type: "CUT_WIRE",
      networkId: doc.networks[0].id,
      wireId: "e0000000-0000-4000-8000-000000000003"
    })
    expect(state.wireReferences["e0000000-0000-4000-8000-000000000003"]?.signalName).toBe("SIG_UPDATED")
  })

  it("TEST-R-007: Xoa node chua ref (DELETE_SELECTION) -> don sach map. Undo -> phuc hoi du offsets. Redo -> don sach lai", () => {
    const doc = createSampleDoc()
    let state = createFbdEditorState(doc, true)
    state = fbdEditorReducer(state, {
      type: "CUT_WIRE",
      networkId: doc.networks[0].id,
      wireId: "e0000000-0000-4000-8000-000000000001",
      customSignalName: "SIG_VAL"
    })
    state = fbdEditorReducer(state, {
      type: "SET_REFERENCE_OFFSET",
      networkId: doc.networks[0].id,
      wireId: "e0000000-0000-4000-8000-000000000001",
      target: "source",
      offset: 48,
    })
    expect(state.wireReferences["e0000000-0000-4000-8000-000000000001"]?.sourceOffset).toBe(48)

    state = fbdEditorReducer(state, {
      type: "SELECT",
      selection: { kind: "node", networkId: doc.networks[0].id, nodeId: "c0000000-0000-4000-8000-000000000001" },
    })
    state = fbdEditorReducer(state, { type: "DELETE_SELECTION" })
    expect(state.wireReferences["e0000000-0000-4000-8000-000000000001"]).toBeUndefined()

    state = fbdEditorReducer(state, { type: "UNDO" })
    expect(state.wireReferences["e0000000-0000-4000-8000-000000000001"]).toBeDefined()
    expect(state.wireReferences["e0000000-0000-4000-8000-000000000001"]?.sourceOffset).toBe(48)

    state = fbdEditorReducer(state, { type: "REDO" })
    expect(state.wireReferences["e0000000-0000-4000-8000-000000000001"]).toBeUndefined()
  })

  it("TEST-R-008: Undo/Redo cho SET_REFERENCE_OFFSET (tu 8 len 48px)", () => {
    const doc = createSampleDoc()
    let state = createFbdEditorState(doc, true)
    state = fbdEditorReducer(state, {
      type: "CUT_WIRE",
      networkId: doc.networks[0].id,
      wireId: "e0000000-0000-4000-8000-000000000001"
    })
    state = fbdEditorReducer(state, {
      type: "SET_REFERENCE_OFFSET",
      networkId: doc.networks[0].id,
      wireId: "e0000000-0000-4000-8000-000000000001",
      target: "sink",
      offset: 48,
    })
    expect(state.wireReferences["e0000000-0000-4000-8000-000000000001"]?.sinkOffset).toBe(48)

    state = fbdEditorReducer(state, { type: "UNDO" })
    expect(state.wireReferences["e0000000-0000-4000-8000-000000000001"]?.sinkOffset).toBeUndefined()

    state = fbdEditorReducer(state, { type: "REDO" })
    expect(state.wireReferences["e0000000-0000-4000-8000-000000000001"]?.sinkOffset).toBe(48)
  })

})
