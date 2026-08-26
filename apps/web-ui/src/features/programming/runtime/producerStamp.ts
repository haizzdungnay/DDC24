import type { ProgrammingProducerStamp } from '../model/types'

/**
 * `T59-810` / `PGM02-V22-WP-09` — luật thứ tự cho snapshot runtime.
 *
 * Bài toán: `activeRevisionId` chỉ trả lời "snapshot này thuộc Revision nào".
 * Nó KHÔNG trả lời "snapshot này mới hơn hay cũ hơn cái vừa vẽ". Hai poll chồng
 * nhau hoặc một lần retry là đủ để một snapshot cũ tới sau — và người vận hành
 * thấy giá trị **đi lùi** mà không có gì báo.
 *
 * `capturedMonotonicNs` là mốc monotonic lúc Core chụp. Nó tăng nghiêm ngặt
 * trong một lần chạy của Core, và **giảm** khi Core khởi động lại. Hai tình
 * huống đó cần hai cách xử lý khác nhau, và gộp chúng lại là sai:
 *
 * - **cũ hơn** ⇒ bỏ qua, giữ nguyên thứ đang hiện. Vẽ lại số cũ là nói dối.
 * - **producer restart** ⇒ KHÔNG được im lặng nối tiếp. Giá trị trước và sau
 *   một lần restart không thuộc cùng một mạch: bộ đếm, trạng thái FB và LKG đều
 *   có thể đã khác. Người vận hành phải biết mạch đã đứt.
 *
 * So sánh bằng **BigInt**, không phải `Number`: nanosecond kể từ boot vượt
 * `Number.MAX_SAFE_INTEGER` sau ~104 ngày uptime, và phép so sai đúng lúc thiết
 * bị chạy lâu nhất là phép so tệ nhất có thể có.
 */

export type ProducerVerdict =
  /** Mới hơn mốc đã vẽ — nhận. */
  | { kind: 'ACCEPT'; capturedMonotonicNs: bigint }
  /** Cũ hơn hoặc bằng — bỏ qua, giữ nguyên thứ đang hiện. */
  | { kind: 'STALE'; capturedMonotonicNs: bigint }
  /** Mốc lùi lại ⇒ Core đã khởi động lại; mạch đứt, không nối tiếp im lặng. */
  | { kind: 'PRODUCER_RESTARTED'; capturedMonotonicNs: bigint }
  /** Không đọc được dấu ⇒ fail-closed, coi như chưa có số liệu. */
  | { kind: 'UNAVAILABLE'; reason: 'MISSING' | 'MALFORMED' }

const DECIMAL = /^[0-9]{1,20}$/

export function parseCapturedMonotonicNs(stamp: ProgrammingProducerStamp | undefined): bigint | null {
  if (!stamp || typeof stamp.capturedMonotonicNs !== 'string') return null
  if (!DECIMAL.test(stamp.capturedMonotonicNs)) return null
  try {
    return BigInt(stamp.capturedMonotonicNs)
  } catch {
    return null
  }
}

/**
 * `previous === null` nghĩa là chưa vẽ gì — snapshot đầu tiên luôn được nhận,
 * kể cả khi mốc của nó là 0 (chưa có Revision active).
 */
export function judgeProducerStamp(
  stamp: ProgrammingProducerStamp | undefined,
  previous: bigint | null,
): ProducerVerdict {
  if (!stamp) return { kind: 'UNAVAILABLE', reason: 'MISSING' }
  const captured = parseCapturedMonotonicNs(stamp)
  if (captured === null) return { kind: 'UNAVAILABLE', reason: 'MALFORMED' }
  if (previous === null) return { kind: 'ACCEPT', capturedMonotonicNs: captured }
  if (captured > previous) return { kind: 'ACCEPT', capturedMonotonicNs: captured }
  if (captured === previous) return { kind: 'STALE', capturedMonotonicNs: captured }
  return { kind: 'PRODUCER_RESTARTED', capturedMonotonicNs: captured }
}
