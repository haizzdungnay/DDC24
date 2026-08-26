import { describe, expect, it } from 'vitest'
import goldenJson from '../../../../../../contracts/programming/fbd/golden/ahu_fan_enable.json'
import { fbdIssueTarget, fbdIssueTargets } from './issueTargets'
import type { FbdDocument } from './model'

function golden(): FbdDocument {
  return JSON.parse(JSON.stringify(goldenJson)) as FbdDocument
}

describe('fbdIssueTarget (AC-FBD-007)', () => {
  it('neo lỗi node vào đúng block, kèm nhãn đọc được', () => {
    const document = golden()
    const target = fbdIssueTarget(document, { code: 'FBD-SEM-TYPE-REF-001', path: '$.networks[0].nodes[2].typeRef' })
    expect(target.selection).toEqual({
      kind: 'node',
      networkId: document.networks[0].id,
      nodeId: document.networks[0].nodes[2].id,
    })
    expect(target.label).toBe(`ENABLE_LOGIC › #${document.networks[0].nodes[2].executionOrder} ${document.networks[0].nodes[2].typeRef}`)
  })

  it('neo lỗi wire vào đúng dây', () => {
    const document = golden()
    const target = fbdIssueTarget(document, { code: 'FBD-SEM-WIRE-001', path: '$.networks[0].wires[1]' })
    expect(target.selection).toEqual({
      kind: 'wire',
      networkId: document.networks[0].id,
      wireId: document.networks[0].wires[1].id,
    })
  })

  it('lỗi mức network neo vào network', () => {
    const document = golden()
    const target = fbdIssueTarget(document, { code: 'FBD-SEM-ORDER-001', path: '$.networks[0].nodes' })
    expect(target.selection).toEqual({ kind: 'network', networkId: document.networks[0].id })
  })

  it.each([
    ['lỗi mức tài liệu', '$'],
    ['network ngoài phạm vi', '$.networks[9].nodes[0]'],
    ['node ngoài phạm vi', '$.networks[0].nodes[99]'],
    ['wire ngoài phạm vi', '$.networks[0].wires[99]'],
    ['đường dẫn lạ', '$.layout.nodes'],
  ])('KHÔNG đoán khi %s', (_label, path) => {
    const target = fbdIssueTarget(golden(), { code: 'FBD-SCHEMA-ROOT-001', path })
    expect(target.selection).toBeNull()
    expect(target.label).toBeNull()
  })

  it('giữ nguyên thứ tự và số lượng issue khi dịch cả danh sách', () => {
    const issues = [
      { code: 'A', path: '$.networks[0].nodes[0]' },
      { code: 'B', path: '$' },
      { code: 'C', path: '$.networks[0].wires[0]' },
    ]
    const targets = fbdIssueTargets(golden(), issues)
    expect(targets.map((item) => item.issue.code)).toEqual(['A', 'B', 'C'])
    expect(targets.map((item) => item.selection?.kind ?? null)).toEqual(['node', null, 'wire'])
  })
})
