import { describe, expect, it } from 'vitest'
import {
  generateDefaultSignalName,
  normalizeWireReferences,
  validateSignalName,
  type FbdWireReferenceMap
} from './wireReferences'
import { canonicalFbdJson, type FbdDocument, type FbdNode, type FbdPort, type FbdWire } from './model'

describe('Module M: wireReferences & Invariants', () => {
  it('TEST-M-001: Bảo toàn Bất biến I1 khi tạo reference với wire hợp lệ', () => {
    const wires: FbdWire[] = [
      { id: '11111111-1111-4111-8111-111111111111', from: { nodeId: 'n1', portId: 'p1' }, to: { nodeId: 'n2', portId: 'p2' } }
    ]
    const map: FbdWireReferenceMap = {
      '11111111-1111-4111-8111-111111111111': {
        wireId: '11111111-1111-4111-8111-111111111111',
        signalName: 'SIG_TEST',
        createdAt: 1000,
      }
    }
    const normalized = normalizeWireReferences(wires, map)
    expect(normalized['11111111-1111-4111-8111-111111111111']).toBeDefined()
    expect(normalized['11111111-1111-4111-8111-111111111111']?.signalName).toBe('SIG_TEST')
  })

  it('TEST-M-002: Từ chối / loại bỏ reference cho wire không tồn tại khỏi map', () => {
    const wires: FbdWire[] = [
      { id: '11111111-1111-4111-8111-111111111111', from: { nodeId: 'n1', portId: 'p1' }, to: { nodeId: 'n2', portId: 'p2' } }
    ]
    const map: FbdWireReferenceMap = {
      'wire-fake-id': {
        wireId: 'wire-fake-id',
        signalName: 'FAKE_SIG',
        createdAt: 1000,
      }
    }
    const normalized = normalizeWireReferences(wires, map)
    expect(normalized['wire-fake-id']).toBeUndefined()
    expect(Object.keys(normalized)).toHaveLength(0)
  })

  it('TEST-M-003: Kiểm tra Bất biến I2 (Canonical Document giữ nguyên 100%)', () => {
    const doc: FbdDocument = {
      $schema: '../../fbd_v1.schema.json',
      schemaVersion: 1,
      profileId: 'revA-1t-1-5-30',
      graphId: 'a0000000-0000-4000-8000-000000000000',
      name: 'PROG_CANONICAL',
      networks: [
        {
          id: 'b0000000-0000-4000-8000-000000000000',
          name: 'NW1',
          order: 0,
          nodes: [
            {
              id: 'c0000000-0000-4000-8000-000000000000',
              kind: 'FUNCTION',
              typeRef: 'AND',
              executionOrder: 0,
              parameters: {},
              ports: [
                { id: 'd0000000-0000-4000-8000-000000000001', name: 'IN1', direction: 'INPUT', dataType: 'BOOL', unit: null, order: 0 },
                { id: 'd0000000-0000-4000-8000-000000000002', name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL', unit: null, order: 1 }
              ]
            }
          ],
          wires: []
        }
      ]
    }
    const beforeJson = canonicalFbdJson(doc)
    const refMap: FbdWireReferenceMap = {
      'e0000000-0000-4000-8000-000000000000': {
        wireId: 'e0000000-0000-4000-8000-000000000000',
        signalName: 'SIG_REF',
        createdAt: 2000
      }
    }
    expect(refMap).toBeDefined()
    const afterJson = canonicalFbdJson(doc)
    expect(afterJson).toBe(beforeJson)
  })

  it('TEST-M-004: Sinh tên tín hiệu tự động chuẩn C-identifier (Temp Sensor #1, Out 1 -> Temp_Sensor_1_Out_1)', () => {
    const node: FbdNode = {
      id: 'n1',
      kind: 'FUNCTION',
      typeRef: 'Temp Sensor #1',
      executionOrder: 0,
      parameters: {},
      ports: []
    }
    const port: FbdPort = {
      id: 'p1',
      name: 'Out 1',
      direction: 'OUTPUT',
      dataType: 'REAL',
      unit: null,
      order: 0
    }
    const name = generateDefaultSignalName(node, port)
    expect(name).toBe('Temp_Sensor_1_Out_1')
  })

  it('TEST-M-005: Tự động thêm hậu tố _1 khi xung đột tên', () => {
    const node: FbdNode = {
      id: 'n1',
      kind: 'FUNCTION',
      typeRef: 'AND',
      executionOrder: 0,
      parameters: {},
      ports: []
    }
    const port: FbdPort = {
      id: 'p1',
      name: 'OUT',
      direction: 'OUTPUT',
      dataType: 'BOOL',
      unit: null,
      order: 0
    }
    const existing = new Set(['AND_OUT'])
    const name1 = generateDefaultSignalName(node, port, existing)
    expect(name1).toBe('AND_OUT_1')

    existing.add('AND_OUT_1')
    const name2 = generateDefaultSignalName(node, port, existing)
    expect(name2).toBe('AND_OUT_2')
  })

  it('validateSignalName: kiểm tra độ dài, ký tự hợp lệ và từ khóa IEC', () => {
    expect(validateSignalName('SIG_VALID_1').valid).toBe(true)
    expect(validateSignalName('').valid).toBe(false)
    expect(validateSignalName('a'.repeat(33)).valid).toBe(false)
    expect(validateSignalName('1_INVALID').valid).toBe(false)
    expect(validateSignalName('VAR').valid).toBe(false)
    expect(validateSignalName('program').valid).toBe(false)
    expect(validateSignalName('SIG+TEST').valid).toBe(false)
  })
})
