import { describe, expect, it } from 'vitest'
import type { ProgrammingBindingPreview } from '../../api/generated/client'
import { bindingPreviewDecision } from './bindingPreviewModel'

function preview(overrides: Partial<ProgrammingBindingPreview> = {}): ProgrammingBindingPreview {
  return {
    schemaVersion: '1.0', verdict: 'ALLOW', issues: [],
    projectId: '11111111-1111-4111-8111-111111111111',
    draftRevisionId: '22222222-2222-4222-8222-222222222222',
    baseRevisionId: '22222222-2222-4222-8222-222222222222', etag: '"draft:1"',
    ...overrides,
  }
}

const expected = preview()

describe('binding preview authority', () => {
  it('chỉ mở Assign theo ALLOW/WARN mà server trả', () => {
    expect(bindingPreviewDecision(preview(), expected)).toMatchObject({ status: 'ALLOW', assignable: true })
    expect(bindingPreviewDecision(preview({ verdict: 'WARN', issues: [{
      code: 'PRG-ERR-MAP-004', detailCode: 'PGM-MAP-UNIT-001', severity: 'WARNING', field: 'binding.unit',
    }] }), expected)).toMatchObject({ status: 'WARN', assignable: true })
    expect(bindingPreviewDecision(preview({ verdict: 'BLOCK', issues: [{
      code: 'PRG-ERR-MAP-003', detailCode: 'PGM-MAP-POINT-001', severity: 'ERROR', field: 'binding.point',
    }] }), expected)).toMatchObject({ status: 'BLOCK', assignable: false })
  })

  it('server đời cũ hoặc payload thiếu/mâu thuẫn đều fail-closed', () => {
    expect(bindingPreviewDecision(undefined, expected)).toEqual({
      status: 'UNAVAILABLE', assignable: false, issues: [], reason: 'MISSING_OR_OLD_SERVER',
    })
    expect(bindingPreviewDecision(preview({ verdict: 'ALLOW', issues: [{
      code: 'PRG-ERR-MAP-004', detailCode: 'PGM-MAP-UNIT-001', severity: 'WARNING', field: 'binding.unit',
    }] }), expected)).toMatchObject({ status: 'UNAVAILABLE', assignable: false, reason: 'MALFORMED_RESPONSE' })
    expect(bindingPreviewDecision({ schemaVersion: '1.0', verdict: 'ALLOW', issues: [] }, expected))
      .toMatchObject({ status: 'UNAVAILABLE', assignable: false, reason: 'MALFORMED_RESPONSE' })
  })

  it('context hoặc ETag khác request bị coi là phản hồi stale', () => {
    expect(bindingPreviewDecision(preview({ etag: '"draft:2"' }), expected))
      .toMatchObject({ status: 'UNAVAILABLE', assignable: false, reason: 'STALE_RESPONSE' })
    expect(bindingPreviewDecision(preview({ projectId: '99999999-9999-4999-8999-999999999999' }), expected))
      .toMatchObject({ status: 'UNAVAILABLE', assignable: false, reason: 'STALE_RESPONSE' })
  })

  it('reason code server mới mà FE chưa biết vẫn hiện trong issues nhưng khóa Assign', () => {
    const decision = bindingPreviewDecision(preview({ verdict: 'WARN', issues: [{
      code: 'PRG-ERR-MAP-004', detailCode: 'PGM-MAP-FUTURE-999', severity: 'WARNING', field: 'binding.point',
    }] }), expected)
    expect(decision).toMatchObject({ status: 'BLOCK', assignable: false, reason: 'UNKNOWN_REASON_CODE' })
    expect(decision.issues[0].detailCode).toBe('PGM-MAP-FUTURE-999')
  })

  it('mã public không khớp detail code bị khóa như payload sai', () => {
    const decision = bindingPreviewDecision(preview({ verdict: 'BLOCK', issues: [{
      code: 'PRG-ERR-MAP-004', detailCode: 'PGM-MAP-POINT-001', severity: 'ERROR', field: 'binding.point',
    }] }), expected)
    expect(decision).toMatchObject({ status: 'UNAVAILABLE', assignable: false, reason: 'MALFORMED_RESPONSE' })
  })
})
