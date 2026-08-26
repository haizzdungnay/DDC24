import { describe, expect, it } from 'vitest'

import goldenJson from '../../../../../../contracts/programming/fbd/golden/ahu_fan_enable.json'

import { canonicalFbdJson, canonicalizeFbdDocument, collectFbdInterfaceVariables, validateFbdDocument, type FbdDocument } from './model'

function golden(): FbdDocument {
  return JSON.parse(JSON.stringify(goldenJson)) as FbdDocument
}

describe('collectFbdInterfaceVariables (Mapping tab phải chọn từ đây, không gõ tay)', () => {
  it('lấy đúng tên biến từ parameters.variable của node INPUT/OUTPUT', () => {
    expect(collectFbdInterfaceVariables(golden())).toEqual([
      { name: 'OCCUPIED', type: 'BOOL', direction: 'INPUT' },
      { name: 'ENABLE', type: 'BOOL', direction: 'INPUT' },
      { name: 'FAN_CMD', type: 'BOOL', direction: 'OUTPUT' }
    ])
  })

  it('bỏ qua node FUNCTION/FUNCTION_BLOCK và node INPUT/OUTPUT thiếu parameters.variable', () => {
    const document = golden()
    document.networks[0].nodes[0].parameters = {}
    expect(collectFbdInterfaceVariables(document)).toEqual([
      { name: 'ENABLE', type: 'BOOL', direction: 'INPUT' },
      { name: 'FAN_CMD', type: 'BOOL', direction: 'OUTPUT' }
    ])
  })
})

describe('mô hình FBD canonical', () => {
  it('chấp nhận golden và ổn định byte sau khi đổi thứ tự mảng', () => {
    const first = golden()
    expect(validateFbdDocument(first)).toEqual([])
    const reordered = golden()
    reordered.networks[0].nodes.reverse()
    reordered.networks[0].wires.reverse()
    reordered.networks[0].nodes.forEach((node) => node.ports.reverse())
    expect(canonicalFbdJson(reordered)).toBe(canonicalFbdJson(first))
    expect(canonicalizeFbdDocument(reordered).networks[0].nodes.map((node) => node.executionOrder)).toEqual([0, 1, 2, 3])
  })

  it('từ chối typeRef không khớp kind, type wire và nhiều driver', () => {
    const wrongTypeRef = golden()
    wrongTypeRef.networks[0].nodes[2].typeRef = 'TON'
    expect(validateFbdDocument(wrongTypeRef)).toContainEqual(expect.objectContaining({ code: 'FBD-SEM-TYPE-REF-001' }))

    const wrongType = golden()
    wrongType.networks[0].nodes[2].ports[0].dataType = 'REAL'
    expect(validateFbdDocument(wrongType)).toContainEqual(expect.objectContaining({ code: 'FBD-SEM-WIRE-001' }))

    const duplicateDriver = golden()
    duplicateDriver.networks[0].wires.push({
      ...duplicateDriver.networks[0].wires[0],
      id: '50000000-0000-4000-8000-000000000004',
      from: { ...duplicateDriver.networks[0].wires[1].from },
    })
    expect(validateFbdDocument(duplicateDriver)).toContainEqual(expect.objectContaining({ code: 'FBD-SEM-WIRE-001' }))
  })

  it('từ chối thứ tự combinational ngược và UUID không canonical', () => {
    const backward = golden()
    backward.networks[0].nodes[2].executionOrder = 3
    backward.networks[0].nodes[3].executionOrder = 2
    expect(validateFbdDocument(backward)).toContainEqual(expect.objectContaining({ code: 'FBD-SEM-ORDER-001' }))

    const uuid = golden()
    uuid.graphId = `${uuid.graphId.slice(0, -1)}A`
    expect(validateFbdDocument(uuid)).toContainEqual(expect.objectContaining({ code: 'FBD-SCHEMA-ROOT-001' }))
  })

  it('từ chối parameter không hữu hạn hoặc vượt biên contract', () => {
    const nonFinite = golden()
    nonFinite.networks[0].nodes[2].parameters.gain = Number.POSITIVE_INFINITY
    expect(validateFbdDocument(nonFinite)).toContainEqual(expect.objectContaining({ code: 'FBD-SEM-PARAMETER-001' }))

    const longString = golden()
    longString.networks[0].nodes[2].parameters.label = 'x'.repeat(129)
    expect(validateFbdDocument(longString)).toContainEqual(expect.objectContaining({ code: 'FBD-SEM-PARAMETER-001' }))
  })
})

/* `T59-806` — hình học trình bày. Parity với `is_valid_layout()` của compiler
 * (`st_fbd_model.cpp`): hình học sai bị TỪ CHỐI ở biên chứ không im lặng bỏ
 * qua, và hình học đúng không bao giờ đổi phần ngữ nghĩa của tài liệu. */
describe('FBD layout (T59-806)', () => {
  const NODE = '30000000-0000-4000-8000-000000000001'

  function withLayout(layout: unknown): FbdDocument {
    return { ...golden(), layout } as FbdDocument
  }

  it('tài liệu không có layout vẫn hợp lệ', () => {
    expect(validateFbdDocument(golden())).toEqual([])
  })

  it('layout hợp lệ không sinh issue nào', () => {
    const document = withLayout({ schemaVersion: 1, nodes: { [NODE]: { x: -17.5, y: 99999 } } })
    expect(validateFbdDocument(document)).toEqual([])
  })

  it.each([
    ['phiên bản lạ', { schemaVersion: 2, nodes: {} }],
    ['thiếu nodes', { schemaVersion: 1 }],
    ['khoá lạ', { schemaVersion: 1, nodes: {}, viewport: 1 }],
    ['khoá node không phải uuid', { schemaVersion: 1, nodes: { 'not-a-uuid': { x: 0, y: 0 } } }],
    ['toạ độ ngoài trần', { schemaVersion: 1, nodes: { [NODE]: { x: 1e9, y: 0 } } }],
    ['toạ độ NaN', { schemaVersion: 1, nodes: { [NODE]: { x: Number.NaN, y: 0 } } }],
    ['điểm thiếu trục', { schemaVersion: 1, nodes: { [NODE]: { x: 1 } } }],
    ['điểm có khoá thừa', { schemaVersion: 1, nodes: { [NODE]: { x: 1, y: 2, z: 3 } } }],
    ['layout là mảng', []],
  ])('từ chối %s', (_label, layout) => {
    expect(validateFbdDocument(withLayout(layout)))
      .toContainEqual(expect.objectContaining({ code: 'FBD-SCHEMA-LAYOUT-001' }))
  })

  it('canonical JSON sắp khoá layout nên thứ tự kéo block không đổi byte', () => {
    const second = '30000000-0000-4000-8000-000000000002'
    const forward = withLayout({ schemaVersion: 1, nodes: { [NODE]: { x: 1, y: 2 }, [second]: { x: 3, y: 4 } } })
    const backward = withLayout({ schemaVersion: 1, nodes: { [second]: { x: 3, y: 4 }, [NODE]: { x: 1, y: 2 } } })
    expect(canonicalFbdJson(forward)).toBe(canonicalFbdJson(backward))
  })
})
