import { describe, expect, it } from 'vitest'

import { ST_LANGUAGE_PROFILE_VERSION } from '../api/generated/stLanguageProfile'
import type { ProgrammingDiagnostic } from '../model/types'
import { diagnosticFreshness, type OpenBufferContext } from './diagnosticFreshness'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

function diagnostic(overrides: Record<string, unknown> = {}): ProgrammingDiagnostic {
  return {
    code: 'PRG-ERR-CHECK-001',
    detailCode: 'ST-SEM-002',
    severity: 'ERROR',
    messageKey: 'programming.error.check',
    location: {
      programId: 'P_ahu',
      line: 4,
      column: 3,
      revisionId: 'rev-1',
      pouId: 'P_ahu',
      sourceSha256: HASH_A,
      stLanguageProfileVersion: ST_LANGUAGE_PROFILE_VERSION,
      ...overrides
    }
  }
}

const openBuffer: OpenBufferContext = {
  revisionId: 'rev-1',
  pouId: 'P_ahu',
  sourceSha256: HASH_A
}

describe('diagnosticFreshness — ISS-STED-18', () => {
  it('khớp cả bốn trường ⇒ FRESH', () => {
    expect(diagnosticFreshness(diagnostic(), openBuffer)).toEqual({
      freshness: 'FRESH',
      diagnosticRevisionId: 'rev-1'
    })
  })

  /* Tiêu chí chấp nhận: sửa MỘT ký tự sau Kiểm tra ⇒ chuyển STALE ngay, không
   * còn dấu nào ở trạng thái "lỗi hiện tại". Một ký tự đổi làm hash đổi hoàn
   * toàn, nên phép so hash bắt được mọi mức chỉnh sửa, kể cả nhỏ nhất. */
  it('buffer đổi một ký tự ⇒ STALE với lý do SOURCE_CHANGED', () => {
    const result = diagnosticFreshness(diagnostic(), { ...openBuffer, sourceSha256: HASH_B })
    expect(result.freshness).toBe('STALE')
    expect(result.reason).toBe('SOURCE_CHANGED')
  })

  it('kết quả của revision khác ⇒ STALE và nêu rõ revision nào', () => {
    const result = diagnosticFreshness(diagnostic({ revisionId: 'rev-0' }), openBuffer)
    expect(result.freshness).toBe('STALE')
    expect(result.reason).toBe('REVISION_MISMATCH')
    expect(result.diagnosticRevisionId).toBe('rev-0')
  })

  /* Tiêu chí chấp nhận: hash so theo POU, không theo cả gói — sửa POU A không
   * được làm lỗi POU B thành STALE. */
  it('sửa POU khác KHÔNG làm lỗi của POU này thành STALE', () => {
    const errorInB = diagnostic({ pouId: 'P_boiler', programId: 'P_boiler', sourceSha256: HASH_B })
    const bufferOnB: OpenBufferContext = {
      revisionId: 'rev-1',
      pouId: 'P_boiler',
      sourceSha256: HASH_B
    }
    // POU A vừa bị sửa (hash A -> khác), nhưng ta đang mở POU B và hash của B
    // không đổi: lỗi của B phải còn nguyên giá trị.
    expect(diagnosticFreshness(errorInB, bufferOnB).freshness).toBe('FRESH')
  })

  it('mở POU khác với POU của diagnostic ⇒ STALE vì POU_MISMATCH', () => {
    const result = diagnosticFreshness(diagnostic(), { ...openBuffer, pouId: 'P_boiler' })
    expect(result.freshness).toBe('STALE')
    expect(result.reason).toBe('POU_MISMATCH')
  })

  it('hồ sơ ngôn ngữ đã đổi ⇒ STALE vì PROFILE_CHANGED', () => {
    const result = diagnosticFreshness(diagnostic({ stLanguageProfileVersion: '0.9.0' }), openBuffer)
    expect(result.freshness).toBe('STALE')
    expect(result.reason).toBe('PROFILE_CHANGED')
  })

  /* Thiếu bằng chứng KHÔNG được coi là khớp: đó chính là cách một phép so khớp
   * biến thành phép so luôn đúng, và khi đó cổng tự tắt chính nó. */
  it.each([
    ['revisionId', { revisionId: undefined }],
    ['pouId', { pouId: undefined }],
    ['sourceSha256', { sourceSha256: undefined }],
    ['stLanguageProfileVersion', { stLanguageProfileVersion: undefined }]
  ])('thiếu %s ⇒ UNVERIFIABLE chứ không phải FRESH', (_name, missing) => {
    expect(diagnosticFreshness(diagnostic(missing), openBuffer).freshness).toBe('UNVERIFIABLE')
  })

  it('không có provenance nào (diagnostic scope/worker) ⇒ UNVERIFIABLE', () => {
    const scoped: ProgrammingDiagnostic = {
      code: 'PRG-ERR-SCOPE-001',
      severity: 'ERROR',
      messageKey: 'programming.error.scope'
    }
    expect(diagnosticFreshness(scoped, openBuffer).freshness).toBe('UNVERIFIABLE')
  })

  it('chưa băm được buffer ⇒ UNVERIFIABLE, không đoán là FRESH', () => {
    expect(
      diagnosticFreshness(diagnostic(), { ...openBuffer, sourceSha256: undefined }).freshness
    ).toBe('UNVERIFIABLE')
  })
})
