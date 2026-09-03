import { describe, expect, it } from 'vitest'

import { ST_LANGUAGE_PROFILE_VERSION } from '../../api/generated/stLanguageProfile'
import type { ProgrammingDiagnostic } from '../../model/types'
import { stCheckProvenance } from './stCheckProvenance'

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

const buffer = { revisionId: 'rev-1', pouId: 'P_ahu', sourceSha256: HASH_A }

describe('stCheckProvenance — ISS-STED-04', () => {
  /* Tiêu chí chấp nhận: Draft chưa từng Kiểm tra ⇒ trạng thái "chưa kiểm tra",
   * KHÔNG hiện "không có lỗi". Hai câu đó nói hai điều khác hẳn nhau, và nhầm
   * lẫn chúng làm người dùng tin rằng chương trình đã được kiểm và sạch. */
  it('chưa từng Kiểm tra ⇒ NEVER_CHECKED, không gạch gì', () => {
    const state = stCheckProvenance({ hasCheckResult: false, diagnostics: [], buffer })
    expect(state.freshness).toBe('NEVER_CHECKED')
    expect(state.markable).toHaveLength(0)
  })

  it('đã Kiểm tra và POU sạch ⇒ FRESH, khác hẳn NEVER_CHECKED', () => {
    const state = stCheckProvenance({ hasCheckResult: true, diagnostics: [], buffer })
    expect(state.freshness).toBe('FRESH')
    expect(state.markable).toHaveLength(0)
  })

  it('kết quả khớp buffer ⇒ FRESH và diagnostic được phép gạch', () => {
    const state = stCheckProvenance({
      hasCheckResult: true,
      diagnostics: [diagnostic()],
      buffer
    })
    expect(state.freshness).toBe('FRESH')
    expect(state.markable).toHaveLength(1)
    expect(state.revisionId).toBe('rev-1')
  })

  /* Tiêu chí chấp nhận cốt lõi: buffer đã đổi ⇒ KHÔNG gạch. Gạch một chỗ trên
   * buffer đã đổi là chỉ vào dòng không còn là dòng sinh ra lỗi. */
  it('buffer đã đổi ⇒ STALE, KHÔNG gạch mục nào, và nêu rõ buffer đã đổi', () => {
    const state = stCheckProvenance({
      hasCheckResult: true,
      diagnostics: [diagnostic()],
      buffer: { ...buffer, sourceSha256: HASH_B }
    })
    expect(state.freshness).toBe('STALE')
    expect(state.markable).toHaveLength(0)
    expect(state.bufferChanged).toBe(true)
    expect(state.revisionId).toBe('rev-1')
  })

  it('kết quả thuộc revision khác ⇒ STALE và nhãn nêu revision đó, bufferChanged=false', () => {
    const state = stCheckProvenance({
      hasCheckResult: true,
      diagnostics: [diagnostic({ revisionId: 'rev-0' })],
      buffer
    })
    expect(state.freshness).toBe('STALE')
    expect(state.revisionId).toBe('rev-0')
    // Không phải buffer đổi — chạy lại Kiểm tra sẽ không giúp gì; nhãn phải
    // phân biệt hai tình huống này.
    expect(state.bufferChanged).toBe(false)
  })

  /* Thiếu bằng chứng KHÔNG phải bằng chứng khớp. */
  it('diagnostic không mang provenance ⇒ không được gạch', () => {
    const state = stCheckProvenance({
      hasCheckResult: true,
      diagnostics: [{ code: 'PRG-ERR-CHECK-001', severity: 'ERROR', messageKey: '' }],
      buffer
    })
    expect(state.markable).toHaveLength(0)
  })

  it('một mục STALE làm cả POU thành STALE, không gạch nửa vời', () => {
    const state = stCheckProvenance({
      hasCheckResult: true,
      diagnostics: [diagnostic(), diagnostic({ sourceSha256: HASH_B })],
      buffer
    })
    expect(state.freshness).toBe('STALE')
    expect(state.markable).toHaveLength(0)
  })
})
