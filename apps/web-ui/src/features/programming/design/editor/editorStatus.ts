/**
 * `T59-821` / `PGM02-V22-WP-15` — mô hình thanh trạng thái editor.
 *
 * Bất biến số 1 của gói handoff áp rất nặng ở đây: **FE không chế dữ liệu**.
 * Thanh trạng thái là chỗ dễ vi phạm nhất vì mọi trường của nó đều có một giá
 * trị "trông hợp lý" để điền bừa — và hai trường tệ nhất là `encoding` với
 * `EOL`.
 *
 * `UTF-8` và `LF` đúng trong đa số trường hợp, nên một giá trị mặc định sẽ
 * **không bao giờ trông sai**. Đó chính là lý do cấm: nó là một lời khẳng định
 * về tệp mà không ai kiểm, và nó sẽ vẫn hiện `UTF-8` cho đúng cái tệp
 * `Windows-1258` đang làm hỏng ký tự tiếng Việt của người dùng. Trường nào chưa
 * đọc được thì hiện `—`.
 *
 * `EOL` thì khác `encoding` ở một điểm: nó **suy ra được** từ chính chuỗi đang
 * có trong buffer, nên nó là giá trị ĐỌC ĐƯỢC chứ không phải giá trị đoán.
 */

export type EditorEol = 'LF' | 'CRLF' | 'CR' | 'MIXED' | 'UNKNOWN'

/**
 * Kiểu xuống dòng thật sự có trong buffer.
 *
 * `UNKNOWN` khi tài liệu chưa có dòng nào — chưa có bằng chứng thì không kết
 * luận. `MIXED` là một câu trả lời THẬT và phải nói ra: nó thường là dấu hiệu
 * một tệp đã đi qua hai hệ điều hành, và nó làm mọi phép so dòng lệch.
 */
export function detectEol(source: string): EditorEol {
  const crlf = (source.match(/\r\n/g) ?? []).length
  const withoutCrlf = source.replace(/\r\n/g, '')
  const lf = (withoutCrlf.match(/\n/g) ?? []).length
  const cr = (withoutCrlf.match(/\r/g) ?? []).length
  const kinds = [crlf > 0, lf > 0, cr > 0].filter(Boolean).length
  if (kinds === 0) return 'UNKNOWN'
  if (kinds > 1) return 'MIXED'
  if (crlf > 0) return 'CRLF'
  return lf > 0 ? 'LF' : 'CR'
}

export interface EditorStatusField {
  /** Khoá i18n-độc lập để test bám vào, không bám vào chuỗi hiển thị. */
  id: string
  /** `null` = chưa đọc được ⇒ giao diện hiện `—`. */
  value: string | null
}

export interface StStatusInput {
  line: number
  column: number
  /** `true` = chèn, `false` = đè. Trình duyệt không cho đọc phím Insert đáng tin cậy. */
  overwrite?: boolean | null
  source: string
  dirty: boolean
  /**
   * Bảng mã do NGUỒN thật cung cấp. Không có ⇒ `—`.
   * Trình duyệt đã giải mã tệp trước khi FE thấy nó, nên FE không có cách nào
   * biết bảng mã gốc — nói `UTF-8` ở đây là đoán, không phải đo.
   */
  encoding?: string | null
}

export function stStatusFields(input: StStatusInput): EditorStatusField[] {
  const eol = detectEol(input.source)
  return [
    { id: 'position', value: `${input.line}:${input.column}` },
    {
      id: 'insertMode',
      value: typeof input.overwrite === 'boolean'
        ? (input.overwrite ? 'OVERWRITE' : 'INSERT')
        : null,
    },
    { id: 'eol', value: eol === 'UNKNOWN' ? null : eol },
    // Không có `?? 'UTF-8'`. Xem lý do ở đầu tệp.
    { id: 'encoding', value: input.encoding ?? null },
    { id: 'dirty', value: input.dirty ? 'DIRTY' : 'SAVED' },
  ]
}

export interface FbdStatusInput {
  /** Tỉ lệ thu phóng canvas, 1 = 100%. `null` khi canvas chưa báo. */
  zoom?: number | null
  language: 'ST' | 'FBD'
  dirty: boolean
  /**
   * Trạng thái kết nối tới thiết bị. `null` = chưa đọc được.
   * `DISCONNECTED` và "chưa biết" là hai câu khác nhau: câu đầu nói thiết bị
   * mất kết nối, câu sau nói ta chưa hỏi. Gộp chúng là báo mất kết nối cho một
   * thiết bị đang khoẻ.
   */
  connection?: 'ONLINE' | 'DEGRADED' | 'OFFLINE' | null
}

export function fbdStatusFields(input: FbdStatusInput): EditorStatusField[] {
  return [
    {
      id: 'zoom',
      value: typeof input.zoom === 'number' && Number.isFinite(input.zoom) && input.zoom > 0
        ? `${Math.round(input.zoom * 100)}%`
        : null,
    },
    { id: 'language', value: input.language },
    { id: 'connection', value: input.connection ?? null },
    { id: 'dirty', value: input.dirty ? 'DIRTY' : 'SAVED' },
  ]
}
