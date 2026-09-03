/**
 * `ISS-STED-18` — Diagnostic Provenance Contract.
 *
 * Trả lời đúng một câu hỏi: **diagnostic này có còn nói về thứ người dùng đang
 * nhìn không?**
 *
 * Vì sao câu hỏi này phải được trả lời TRƯỚC khi gạch lỗi (`ISS-STED-04`):
 * gạch một chỗ trên buffer đã đổi là chỉ vào dòng **không còn** là dòng sinh ra
 * lỗi đó. Người dùng không có cách nào tự biết mình đang bị chỉ sai, nên họ sẽ
 * sửa đúng chỗ bị chỉ — tức sửa một chỗ không hỏng, và tin rằng đã xong.
 * Một dấu lỗi sai chỗ nguy hiểm hơn không có dấu lỗi nào.
 *
 * Ba nguyên tắc:
 *
 * 1. **So theo POU, không theo gói.** Sửa POU A không được làm lỗi của POU B
 *    thành cũ — người dùng sẽ mất luôn kết quả còn đúng.
 * 2. **Thiếu bằng chứng ≠ khớp.** Diagnostic không mang provenance thì trạng
 *    thái là `UNVERIFIABLE`, không phải `FRESH`. Coi "không kiểm được" là
 *    "khớp" chính là cách một phép so khớp trở thành phép so luôn đúng.
 * 3. **Cũ thì không im lặng.** Trạng thái cũ phải nói ĐƯỢC LÝ DO; ẩn nó đi làm
 *    người dùng tưởng lỗi đã hết.
 */
import { ST_LANGUAGE_PROFILE_VERSION } from '../api/generated/stLanguageProfile'
import type { ProgrammingDiagnostic } from '../model/types'

export type DiagnosticFreshness = 'FRESH' | 'STALE' | 'UNVERIFIABLE'

/** Lý do một diagnostic không còn nói về buffer đang mở. Thứ tự khai báo là
 * thứ tự ưu tiên khi nhiều lý do cùng đúng: cái nào khiến người đọc phải làm
 * việc khác nhau nhất thì đứng trước. */
export type StaleReason =
  | 'REVISION_MISMATCH'
  | 'POU_MISMATCH'
  | 'SOURCE_CHANGED'
  | 'PROFILE_CHANGED'

export interface DiagnosticFreshnessResult {
  freshness: DiagnosticFreshness
  reason?: StaleReason
  /** Revision mà diagnostic thuộc về — để thông điệp nói được "revision nào". */
  diagnosticRevisionId?: string
}

/** Bối cảnh của thứ người dùng ĐANG MỞ, không phải của kết quả Check. */
export interface OpenBufferContext {
  revisionId?: string
  pouId?: string
  /** sha256 hex của nội dung buffer hiện tại. Vắng mặt = chưa băm được. */
  sourceSha256?: string
  /** Mặc định là phiên bản hồ sơ FE đang chạy; tham số hoá để test. */
  languageProfileVersion?: string
}

export function diagnosticFreshness(
  diagnostic: ProgrammingDiagnostic,
  buffer: OpenBufferContext
): DiagnosticFreshnessResult {
  const location = diagnostic.location
  const revisionId = location?.revisionId
  const pouId = location?.pouId
  const sourceSha256 = location?.sourceSha256
  const profileVersion = location?.stLanguageProfileVersion

  /* Thiếu BẤT KỲ trường nào ⇒ không kiểm được. Không suy đoán từ phần có: một
   * diagnostic mang revision đúng nhưng thiếu hash vẫn có thể thuộc về một
   * nội dung đã đổi. */
  if (!revisionId || !pouId || !sourceSha256 || !profileVersion) {
    return { freshness: 'UNVERIFIABLE', diagnosticRevisionId: revisionId }
  }

  /* Bối cảnh buffer thiếu thì cũng không kiểm được — lỗi ở phía người hỏi,
   * không phải ở diagnostic. */
  if (!buffer.revisionId || !buffer.pouId || !buffer.sourceSha256) {
    return { freshness: 'UNVERIFIABLE', diagnosticRevisionId: revisionId }
  }

  if (revisionId !== buffer.revisionId) {
    return { freshness: 'STALE', reason: 'REVISION_MISMATCH', diagnosticRevisionId: revisionId }
  }
  if (pouId !== buffer.pouId) {
    return { freshness: 'STALE', reason: 'POU_MISMATCH', diagnosticRevisionId: revisionId }
  }
  if (sourceSha256 !== buffer.sourceSha256) {
    return { freshness: 'STALE', reason: 'SOURCE_CHANGED', diagnosticRevisionId: revisionId }
  }
  const currentProfile = buffer.languageProfileVersion ?? ST_LANGUAGE_PROFILE_VERSION
  if (profileVersion !== currentProfile) {
    return { freshness: 'STALE', reason: 'PROFILE_CHANGED', diagnosticRevisionId: revisionId }
  }
  return { freshness: 'FRESH', diagnosticRevisionId: revisionId }
}

/** Băm nội dung buffer đúng cách backend băm nguồn POU (SHA-256, hex thường).
 *
 * Dùng WebCrypto nên là bất đồng bộ; caller băm một lần mỗi lần buffer đổi chứ
 * không băm trong lượt render. */
export async function hashBufferSource(source: string): Promise<string> {
  const bytes = new TextEncoder().encode(source)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
