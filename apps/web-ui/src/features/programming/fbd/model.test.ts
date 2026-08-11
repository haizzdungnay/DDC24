import { describe, expect, it } from 'vitest'

import goldenJson from '../../../../../../contracts/programming/fbd/golden/ahu_fan_enable.json'

import { canonicalFbdJson, canonicalizeFbdDocument, validateFbdDocument, type FbdDocument } from './model'

function golden(): FbdDocument {
  return JSON.parse(JSON.stringify(goldenJson)) as FbdDocument
}

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
