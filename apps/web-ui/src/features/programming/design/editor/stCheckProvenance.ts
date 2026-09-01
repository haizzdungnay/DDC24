/**
 * `ISS-STED-04` × `ISS-STED-18` — trạng thái kết quả Check gần nhất cho một POU
 * đang mở trong PGM-02.
 *
 * Tách khỏi component vì đây là **quyết định**, không phải cách vẽ: nó trả lời
 * "được phép gạch lỗi lên buffer này không, và nếu không thì vì sao". Để logic
 * ấy nằm trong JSX thì không test được cái quan trọng nhất — trường hợp **không**
 * được gạch.
 *
 * Ba trạng thái, và ranh giới giữa chúng là điểm mấu chốt của issue:
 *
 * - `NEVER_CHECKED` — chưa từng Kiểm tra. **Không** được nói "không có lỗi":
 *   người dùng sẽ hiểu là đã kiểm và sạch, trong khi thực ra chưa ai kiểm.
 * - `STALE` — có kết quả nhưng nó không còn nói về nội dung đang mở. **Không**
 *   gạch, vì gạch sai chỗ nguy hiểm hơn không gạch (xem `ISS-STED-18`).
 * - `FRESH` — kết quả khớp buffer; gạch lỗi và tooltip mới có nghĩa.
 */
import {
  diagnosticFreshness,
  type OpenBufferContext
} from '../../shared/diagnosticFreshness'
import type { ProgrammingDiagnostic } from '../../model/types'

export type StCheckFreshness = 'NEVER_CHECKED' | 'FRESH' | 'STALE'

export interface StCheckProvenanceInput {
  /** Đã từng có một lần Kiểm tra nào trên Draft này chưa. */
  hasCheckResult: boolean
  /** Diagnostic của ĐÚNG POU đang mở (caller đã lọc theo `programId`). */
  diagnostics: ProgrammingDiagnostic[]
  buffer: OpenBufferContext
}

export interface StCheckProvenanceState {
  freshness: StCheckFreshness
  /** Diagnostic ĐƯỢC PHÉP gạch lên buffer. Rỗng ở mọi trạng thái trừ `FRESH`. */
  markable: ProgrammingDiagnostic[]
  /** Revision mà kết quả thuộc về — nhãn bắt buộc phải nêu được. */
  revisionId?: string
  /** Buffer đã đổi kể từ lần Kiểm tra đó chưa. */
  bufferChanged: boolean
}

export function stCheckProvenance(input: StCheckProvenanceInput): StCheckProvenanceState {
  if (!input.hasCheckResult) {
    return { freshness: 'NEVER_CHECKED', markable: [], bufferChanged: false }
  }

  /* Không có diagnostic nào cho POU này mà VẪN đã Kiểm tra là một kết quả hợp
   * lệ ("POU này sạch"), khác hẳn "chưa kiểm tra". Nhưng khi đó cũng không có
   * provenance nào để đối chiếu, nên trạng thái bám vào chính buffer: caller
   * truyền `checkRevisionId`/`checkSourceSha256` qua `buffer` để so. */
  const results = input.diagnostics.map((item) => ({
    item,
    verdict: diagnosticFreshness(item, input.buffer)
  }))

  const stale = results.find((entry) => entry.verdict.freshness === 'STALE')
  if (stale) {
    return {
      freshness: 'STALE',
      markable: [],
      revisionId: stale.verdict.diagnosticRevisionId,
      bufferChanged: stale.verdict.reason === 'SOURCE_CHANGED'
    }
  }

  /* Chỉ gạch những mục ĐÃ CHỨNG MINH được là khớp. `UNVERIFIABLE` không được
   * gạch: thiếu bằng chứng không phải là bằng chứng khớp, và một dấu gạch sai
   * chỗ tệ hơn không có dấu nào. */
  const fresh = results.filter((entry) => entry.verdict.freshness === 'FRESH')
  return {
    freshness: 'FRESH',
    markable: fresh.map((entry) => entry.item),
    revisionId: fresh[0]?.verdict.diagnosticRevisionId ?? input.buffer.revisionId,
    bufferChanged: false
  }
}
