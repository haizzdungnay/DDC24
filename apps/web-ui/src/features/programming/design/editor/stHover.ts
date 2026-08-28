import { ST_NON_SYMBOL_KEYWORDS, stSymbolAt, type StCursorSymbol, type StReferenceIndex } from './stReferenceIndex'

/**
 * `T59-820` / `PGM02-V22-WP-04` (phần còn nợ) — hover ký hiệu cho editor ST.
 *
 * `PGM-02A §4` liệt `hover symbol/type/signature` là **Required**.
 * `UD-PROG-013` hoãn nó ở R1 vì lý do NGÂN SÁCH của CodeMirror 6 (110,07 KiB
 * gzip, vượt cả trần R3), rồi lời hứa "mở lại từ R2" hết hạn mà không ai làm.
 *
 * Điều mấu chốt là AC đòi **hành vi**, không đòi thư viện: hover chỉ cần biết
 * ký hiệu nào nằm dưới con trỏ chuột. Ba lớp gutter/overlay/textarea của editor
 * này đã dùng chung một lưới đơn khoảng cố định (`EDITOR_TEXT_METRICS`), nên
 * toạ độ → offset là số học thuần, không cần một editor engine thứ hai.
 *
 * Hai luật của module này:
 *
 * 1. **Đo được thì mới trả lời.** Bề rộng ký tự phải do người gọi đo THẬT từ
 *    DOM. Không đo được (chưa layout, font chưa tải) ⇒ `null` ⇒ không hover.
 *    Đoán một bề rộng sẽ làm tooltip chỉ vào một ký hiệu KHÁC thứ chuột đang
 *    trỏ — sai còn tệ hơn không có.
 * 2. **Không tra được ≠ đoán.** Việc phân giải ký hiệu dùng ĐÚNG chỉ mục mà
 *    Inspector dùng (`stReferenceIndex` + catalog thư viện), nên hover và
 *    Inspector không thể nói khác nhau về cùng một định danh.
 */

export interface StEditorTextMetrics {
  /** Chiều cao một dòng, px. */
  rowHeightPx: number
  /** Đệm trên của vùng chữ, px. */
  padTopPx: number
  /** Đệm trái của vùng chữ, px. */
  padLeftPx: number
  /**
   * Bề rộng MỘT ký tự, px — người gọi phải ĐO từ DOM.
   * `<= 0` nghĩa là chưa đo được và mọi phép tra sẽ trả `null`.
   */
  charWidthPx: number
  /** Số cột một ký tự tab chiếm. */
  tabSize: number
}

export interface StHoverPoint {
  /** Toạ độ chuột so với mép trái/trên hộp viền của vùng chữ. */
  x: number
  y: number
  scrollLeft: number
  scrollTop: number
}

/**
 * Offset ký tự nằm dưới một điểm chuột, hoặc `null` khi không có ký tự nào ở đó.
 *
 * Trả `null` — chứ không phải kẹp về ký tự gần nhất — cho mọi điểm nằm ngoài
 * chữ thật: quá lề trái, dưới dòng cuối, hoặc bên phải ký tự cuối của dòng.
 * Kẹp lại sẽ làm rê chuột qua khoảng trắng cuối dòng bật lên tooltip của định
 * danh cuối cùng, tức nói rằng chuột đang trỏ vào thứ nó không trỏ vào.
 */
export function stOffsetAtPoint(
  source: string,
  point: StHoverPoint,
  metrics: StEditorTextMetrics,
): number | null {
  if (!(metrics.charWidthPx > 0) || !(metrics.rowHeightPx > 0)) return null

  const textY = point.y + point.scrollTop - metrics.padTopPx
  if (textY < 0) return null
  const row = Math.floor(textY / metrics.rowHeightPx)

  const lines = source.split('\n')
  if (row < 0 || row >= lines.length) return null
  const line = lines[row]

  const textX = point.x + point.scrollLeft - metrics.padLeftPx
  if (textX < 0) return null
  const visualColumn = Math.floor(textX / metrics.charWidthPx)

  const column = characterIndexAtVisualColumn(line, visualColumn, metrics.tabSize)
  if (column === null) return null

  let offset = 0
  for (let index = 0; index < row; index += 1) offset += lines[index].length + 1
  return offset + column
}

/**
 * Chỉ số ký tự trong `line` tại một cột hiển thị, có tính bề rộng tab.
 *
 * `null` khi cột nằm SAU ký tự cuối cùng của dòng — chỗ đó không có ký tự nào.
 */
function characterIndexAtVisualColumn(line: string, visualColumn: number, tabSize: number): number | null {
  if (visualColumn < 0) return null
  const width = tabSize > 0 ? tabSize : 1
  let column = 0
  for (let index = 0; index < line.length; index += 1) {
    // Một tab đẩy con trỏ tới mốc dừng kế tiếp, nên nó KHÔNG rộng cố định
    // `tabSize` cột; coi nó cố định sẽ làm mọi dòng sau tab lệch dần.
    const next = line[index] === '\t' ? column + (width - (column % width)) : column + 1
    if (visualColumn < next) return index
    column = next
  }
  return null
}

/**
 * `DEV-PROG-016` — offset cho thao tác THẢ, có KẸP về ký tự gần nhất.
 *
 * Khác `stOffsetAtPoint` đúng ở luật biên, và khác một cách có chủ ý. Rê chuột
 * qua khoảng trắng cuối dòng KHÔNG được bật tooltip của định danh cuối cùng —
 * nên hover trả `null`. Nhưng thả một khối vào khoảng trắng cuối dòng là một
 * thao tác rõ nghĩa ("chèn ở cuối dòng này"), và trả `null` ở đó biến một cú
 * thả hợp lệ thành một cú thả im lặng không có gì xảy ra.
 */
export function stDropOffsetAtPoint(
  source: string,
  point: StHoverPoint,
  metrics: StEditorTextMetrics,
): number {
  const exact = stOffsetAtPoint(source, point, metrics)
  if (exact !== null) return exact
  if (!(metrics.rowHeightPx > 0)) return source.length

  const lines = source.split('\n')
  const textY = point.y + point.scrollTop - metrics.padTopPx
  const row = Math.min(lines.length - 1, Math.max(0, Math.floor(textY / metrics.rowHeightPx)))
  let offset = 0
  for (let index = 0; index < row; index += 1) offset += lines[index].length + 1
  /* Thả bên trái lề ⇒ đầu dòng; thả sau ký tự cuối ⇒ cuối dòng. Hai đầu của
   * cùng một dòng, không phải một giá trị mặc định chung. */
  const textX = point.x + point.scrollLeft - metrics.padLeftPx
  return textX < 0 ? offset : offset + lines[row].length
}

/**
 * Vị trí (dòng, cột hiển thị) của một offset — phép nghịch của `stOffsetAtPoint`.
 *
 * Tooltip neo vào chính KÝ HIỆU chứ không vào con chuột: neo vào chuột làm hộp
 * chú giải trôi theo từng pixel rê tay và che mất đúng thứ nó đang giải thích.
 * Cột phải là cột HIỂN THỊ, có tính bề rộng tab — dùng chỉ số ký tự sẽ làm
 * tooltip lệch dần trên mọi dòng có tab.
 */
export function stVisualPositionAt(source: string, offset: number, tabSize: number): { row: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, source.length))
  const before = source.slice(0, clamped)
  const row = before.split('\n').length - 1
  const lineStart = before.lastIndexOf('\n') + 1
  const width = tabSize > 0 ? tabSize : 1
  let column = 0
  for (let index = lineStart; index < clamped; index += 1) {
    column = source[index] === '\t' ? column + (width - (column % width)) : column + 1
  }
  return { row, column }
}

/**
 * Ký hiệu ST dưới một điểm chuột.
 *
 * `null` khi không có ký tự nào ở đó, khi ký tự đó không thuộc một định danh,
 * hoặc khi định danh đó là **từ khoá** ngôn ngữ — `IF`/`THEN`/`END_IF` không
 * phải ký hiệu và một tooltip "không xác định được" cho chúng chỉ là nhiễu.
 */
export function stHoverSymbolAtPoint(
  source: string,
  point: StHoverPoint,
  metrics: StEditorTextMetrics,
  index?: StReferenceIndex,
): StCursorSymbol | null {
  const offset = stOffsetAtPoint(source, point, metrics)
  if (offset === null) return null
  const symbol = stSymbolAt(source, offset, index)
  if (!symbol) return null
  // `stSymbolAt` nhận cả hai phía của một biên định danh để phục vụ con trỏ gõ.
  // Chuột thì khác: nó trỏ vào ĐÚNG một ký tự, nên ký tự đó phải nằm TRONG
  // định danh — nếu không, rê qua dấu `;` ngay sau một tên sẽ bật tooltip của
  // tên đó.
  if (offset < symbol.start || offset >= symbol.end) return null
  if (isStKeyword(symbol.identifier)) return null
  return symbol
}

/**
 * Từ khoá của subset ST (§10) và hằng dựng sẵn.
 *
 * Danh sách này TỪNG được khai riêng ở đây với lý do "hai mục đích khác nhau"
 * (loại từ khoá khỏi chỉ mục khai báo vs. im lặng khi rê chuột). `DEV-PROG-004`
 * bác lý do đó bằng một lỗi thật: hai bản đã lệch, chỉ mục dùng bản HẸP hơn, và
 * mở một POU kind `FUNCTION` làm Inspector nhảy sang ngữ cảnh "Ký hiệu ST" với
 * bốn dòng "không xác định được". Cả hai chỗ hỏi CÙNG một câu — *"định danh này
 * có phải ký hiệu người dùng khai không"* — nên chúng phải đọc cùng một danh
 * sách. Danh sách sống ở `stReferenceIndex` vì đó là nơi phân giải ký hiệu.
 */
export function isStKeyword(identifier: string): boolean {
  return ST_NON_SYMBOL_KEYWORDS.has(identifier.toUpperCase())
}
