/**
 * `ISS-PGUI-02` — LÝ DO không map được, dưới dạng MÃ ỔN ĐỊNH thay vì câu chữ.
 *
 * ## Lỗi mà mô-đun này tồn tại để chặn
 *
 * `mappingViewModel` là một tầng THUẦN, không có `pick`, nên mọi lý do nó tự
 * dựng đều bị viết cứng bằng tiếng Việt: "Kiểu dữ liệu không khớp", "Point
 * không có quyền ghi", "Đơn vị không khớp". Ba bề mặt (Catalog, Inspector,
 * Worklist) in thẳng chuỗi ấy ra, nên giao diện English hiện tiếng Việt ngay ở
 * chỗ nói vì sao KHÔNG gán được — đúng chỗ người dùng cần hiểu nhất
 * (`PM-006`).
 *
 * Nhét `pick` xuống tầng thuần sẽ sửa được triệu chứng nhưng hỏng kiến trúc:
 * mô hình dữ liệu sẽ phụ thuộc ngôn ngữ đang chọn, và cùng một hàng Point sẽ
 * cho hai giá trị khác nhau tuỳ locale — không so sánh, không snapshot, không
 * test được. Tách MÃ (dữ liệu) khỏi CÂU (trình bày) giữ cả hai đúng chỗ.
 *
 * ## Vì sao có nhánh `server`
 *
 * `ISS-PIO-32` chốt rằng NGUYÊN NHÂN của quyết định eligibility lấy **nguyên
 * văn từ máy chủ** — FE không được đoán hộ. Chuỗi ấy hiện do
 * `application/point_eligibility.go` dựng và đang là tiếng Việt. Nó KHÔNG được
 * ép vào bảng mã dưới đây: bịa một mã cho một câu mình không kiểm soát là
 * dựng lại đúng bản luật thứ hai mà `ISS-PIO-32` vừa gỡ. Nó đi qua nhánh
 * `server` như một chuỗi chẩn đoán đục, và việc mã hoá nó thuộc về chủ sở hữu
 * của module đó (xem mục "cần làn A đổi giúp" của PR).
 */

/** Lý do do CHÍNH FE kết luận từ dữ liệu catalog — mã đóng, dịch được. */
export type MappingReasonCode =
  /** `VAR_IN_OUT` chưa được Core Rev A hỗ trợ. */
  | 'UNSUPPORTED_INOUT'
  /** Máy chủ chưa trả quyết định eligibility cho điểm này. */
  | 'SERVER_DECISION_MISSING'
  /** Catalog chưa đọc xong/đã stale nên chưa kết luận được. */
  | 'CATALOG_UNVERIFIED'
  /** Point đã biến mất khỏi catalog authority. */
  | 'POINT_NOT_IN_CATALOG'
  /** Kiểu dữ liệu của biến và của Point khác nhau. */
  | 'TYPE_MISMATCH'
  /** Biến ghi ra nhưng Point không cho ghi. */
  | 'NOT_WRITABLE'
  /** Biến đọc vào nhưng Point không cho đọc. */
  | 'NOT_READABLE'
  /** Đơn vị khai báo khác đơn vị của Point. */
  | 'UNIT_MISMATCH'
  /** `REQUIRE_GOOD` không đạt; `quality` mang giá trị thật đọc được. */
  | 'QUALITY_NOT_GOOD'

export type MappingReason =
  | { kind: 'code'; code: MappingReasonCode; quality?: string }
  /**
   * Câu nguyên văn của máy chủ (`ISS-PIO-32`). Đục với FE: hiển thị y nguyên,
   * không dịch, không diễn giải.
   */
  | { kind: 'server'; text: string }

export function codeReason(code: MappingReasonCode, quality?: string): MappingReason {
  return quality === undefined ? { kind: 'code', code } : { kind: 'code', code, quality }
}

export function serverReasons(texts: readonly string[]): MappingReason[] {
  return texts.map((text) => ({ kind: 'server', text }))
}

/**
 * Câu đọc được của một lý do.
 *
 * Mã lạ KHÔNG được nuốt: nó ra một câu trung tính KÈM chính mã đó, để một mã
 * mới thêm ở nơi khác hiện lên xấu nhưng truy vết được — thay vì biến mất và
 * làm hàng Point trông như không có lý do nào.
 */
export function mappingReasonText(
  reason: MappingReason,
  pick: (vi: string, en: string) => string,
): string {
  if (reason.kind === 'server') return reason.text
  switch (reason.code) {
    case 'UNSUPPORTED_INOUT':
      return pick('Core Rev A chưa hỗ trợ VAR_IN_OUT', 'Core Rev A does not support VAR_IN_OUT yet')
    case 'SERVER_DECISION_MISSING':
      return pick(
        'Máy chủ chưa trả quyết định eligibility cho điểm này nên chưa map được',
        'The server returned no eligibility decision for this point, so it cannot be mapped',
      )
    case 'CATALOG_UNVERIFIED':
      return pick(
        'Catalog Point chưa xác minh đầy đủ hoặc đã stale',
        'The Point Catalog is not fully verified or has gone stale',
      )
    case 'POINT_NOT_IN_CATALOG':
      return pick('Point không còn trong catalog authority', 'The point is no longer in the authoritative catalog')
    case 'TYPE_MISMATCH':
      return pick('Kiểu dữ liệu không khớp', 'Data type does not match')
    case 'NOT_WRITABLE':
      return pick('Point không có quyền ghi', 'The point is not writable')
    case 'NOT_READABLE':
      return pick('Point không có quyền đọc', 'The point is not readable')
    case 'UNIT_MISMATCH':
      return pick('Đơn vị không khớp', 'Units do not match')
    case 'QUALITY_NOT_GOOD':
      /* `quality` là giá trị enum TRÊN DÂY (`BAD`/`STALE`/…) và `REQUIRE_GOOD`
         là tên luật trong hợp đồng — cả hai giữ nguyên, không dịch. */
      return pick(
        `Quality ${reason.quality ?? '—'} không đạt REQUIRE_GOOD`,
        `Quality ${reason.quality ?? '—'} does not meet REQUIRE_GOOD`,
      )
    default:
      return unknownReasonText(reason.code, pick)
  }
}

function unknownReasonText(code: string, pick: (vi: string, en: string) => string): string {
  return pick(`Chưa map được (mã ${code})`, `Cannot be mapped (code ${code})`)
}

/** Một dòng lý do gộp, đúng cách ba bề mặt đang hiển thị. */
export function mappingReasonsText(
  reasons: readonly MappingReason[],
  pick: (vi: string, en: string) => string,
): string {
  return reasons.map((reason) => mappingReasonText(reason, pick)).join(' · ')
}
