import { FBD_DATA_TYPES, type FbdDataType } from '../../fbd/model'
import { FBD_PALETTE } from '../../fbd/palette'
import { PROGRAMMING_REVIEW_GATED_FEATURES } from '../../api/generated/profile'

/* WP-10 (Technical Selection Record §A, CTO/Owner approval 2026-08-15) dựng
 * danh sách này từ `ST_SUBSET_SPEC_MK-DDC-24_VI.md` §10 và CỐ Ý bỏ `CASE`,
 * `FOR`, `WHILE`, `FUNCTION_BLOCK` — vì bản Rev A.0 của spec nói compiler chưa
 * hỗ trợ chúng.
 *
 * `DEV-PROG-022` — mệnh đề đó KHÔNG còn đúng, và không ai quay lại sửa danh
 * sách. `apps/core/application/st/st_parser.cpp` có `parse_case()` đầy đủ (nhãn
 * rời, dải `1..3`, `ELSE`, `END_CASE`) và `test_st_lang.cpp` §7.3.3.2 nhận
 * chương trình `CASE s OF … END_CASE;` là HỢP LỆ. Chính spec §10 cũng đã tự mâu
 * thuẫn với mình: nó liệt kê `CASE` ở mục "chưa hỗ trợ" trong khi chương trình
 * AHU thật trên bo dùng `CASE AhuState OF`.
 *
 * Hệ quả người dùng báo trực tiếp 2026-08-29: trong trình soạn thảo, `CASE`,
 * `OF`, `END_CASE` — và cả `FUNCTION_BLOCK`/`END_FUNCTION_BLOCK` của MỌI FB —
 * không được tô như từ khoá. Chúng hiện y hệt một biến chưa khai báo, nên một
 * máy trạng thái đúng cú pháp trông như đang hỏng; thụt lề tự động cũng không
 * mở/đóng khối cho chúng.
 *
 * Nay tách làm HAI danh sách, vì chúng trả lời hai câu hỏi khác nhau:
 *
 *  - `ST_KEYWORDS` = từ mà compiler GIỮ CHỖ (`is_keyword()` trong
 *    `st_parser.cpp`). Dùng để tô màu và để loại khỏi bảng tham chiếu. Thiếu
 *    một từ ở đây là người dùng thấy từ khoá hiện như biến — đúng lỗi này.
 *    `stKeywordMirror.test.ts` đọc THẲNG tệp C++ và bắt lệch; chỗ này đã trôi
 *    một lần rồi nên nó không được canh bằng lời hứa trong chú thích.
 *  - `ST_COMPLETION_KEYWORDS` = từ compiler THỰC SỰ dịch được ở Rev A. Gợi ý
 *    `FOR`/`GOTO` là mời người ta viết một câu lệnh mà parser sẽ từ chối ngay
 *    bằng "'FOR' is a keyword and cannot start a statement".
 *
 * Tên kiểu (`BOOL`…`TIME`) và tên FB chuẩn (`TON`, `PID`…) cũng nằm trong
 * `is_keyword()` nhưng CỐ Ý không có mặt dưới đây: chúng đã có `ST_TYPE_NAMES`/
 * `ST_FB_TYPE_NAMES` với màu riêng, mà `tokenizeSt` hỏi `KEYWORD_SET` TRƯỚC —
 * thêm vào đây là cướp mất màu kiểu của chúng. Danh sách hàm/FB vẫn dùng lại
 * đúng `FBD_PALETTE` (WP-05), không khai tay lần hai. */

export const ST_KEYWORDS = [
  'PROGRAM', 'END_PROGRAM',
  'FUNCTION', 'END_FUNCTION', 'FUNCTION_BLOCK', 'END_FUNCTION_BLOCK',
  'VAR_INPUT', 'VAR_OUTPUT', 'VAR_GLOBAL', 'VAR_EXTERNAL', 'VAR', 'RETAIN', 'END_VAR',
  'IF', 'THEN', 'ELSIF', 'ELSE', 'END_IF',
  'CASE', 'OF', 'END_CASE',
  'FOR', 'END_FOR', 'WHILE', 'END_WHILE', 'REPEAT', 'UNTIL', 'END_REPEAT',
  'EXIT', 'CONTINUE', 'RETURN', 'GOTO',
  'NATIVE', 'POINTER', 'REFERENCE', 'AT', 'ARRAY', 'STRUCT', 'STRING', 'WSTRING',
  'OR', 'XOR', 'AND', 'NOT', 'MOD',
  'TRUE', 'FALSE',
] as const

/** Từ khoá được GỢI Ý. Hẹp hơn `ST_KEYWORDS` một cách có chủ đích: xem lý do ở
 *  khối chú thích phía trên. `FOR`/`WHILE`/`REPEAT`/`GOTO`/`RETURN` được giữ
 *  chỗ nhưng KHÔNG có luật văn phạm nào trong `parse_stmt()`. */
export const ST_COMPLETION_KEYWORDS: readonly string[] = [
  'PROGRAM', 'END_PROGRAM',
  'VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'RETAIN', 'END_VAR',
  'IF', 'THEN', 'ELSIF', 'ELSE', 'END_IF',
  'CASE', 'OF', 'END_CASE',
  'AND', 'OR', 'XOR', 'NOT', 'MOD',
  'TRUE', 'FALSE',
]

export const ST_TYPE_NAMES: readonly FbdDataType[] = FBD_DATA_TYPES

const INFIX_OPERATOR_TYPE_REFS = new Set([
  'AND', 'OR', 'XOR', 'NOT', 'EQ', 'NE', 'LT', 'LE', 'GT', 'GE',
  'ADD', 'SUB', 'MUL', 'DIV', 'MOD',
])

/** Hàm gọi kiểu `NAME(...)` — arity/tên đúng `kFuncs[]` (st_program.cpp),
 *  lọc khỏi FBD_PALETTE bằng cách loại các typeRef là toán tử trung tố (ST
 *  viết `a AND b`, không viết `AND(a,b)`). */
export const ST_FUNCTION_NAMES: readonly string[] = FBD_PALETTE
  .filter((entry) => entry.kind !== 'FUNCTION_BLOCK' && !INFIX_OPERATOR_TYPE_REFS.has(entry.typeRef))
  .map((entry) => entry.typeRef)

/** Kiểu FB khai được trong `VAR` (TON/TOF/R_TRIG/F_TRIG/PID) — đúng
 *  `st_fb_type_from_name`. */
export const ST_FB_TYPE_NAMES: readonly string[] = FBD_PALETTE
  .filter((entry) => entry.kind === 'FUNCTION_BLOCK')
  .map((entry) => entry.typeRef)

const KEYWORD_SET = new Set<string>(ST_KEYWORDS)
const TYPE_SET = new Set<string>(ST_TYPE_NAMES)
const FUNCTION_SET = new Set<string>(ST_FUNCTION_NAMES)
const FB_TYPE_SET = new Set<string>(ST_FB_TYPE_NAMES)

export type StTokenKind =
  | 'keyword' | 'type' | 'function' | 'fb-type' | 'number' | 'time' | 'comment'
  | 'operator' | 'punctuation' | 'identifier' | 'whitespace'

export interface StToken {
  start: number
  end: number
  kind: StTokenKind
  text: string
}

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*/
const TIME_RE = /^T#(?:\d+(?:ms|d|h|m|s))+/i
const REAL_RE = /^\d+\.\d+/
const INT_RE = /^\d+/
const OPERATORS = [':=', '<=', '>=', '<>', '<', '>', '=', '+', '-', '*', '/', '.']
const PUNCTUATION = ['(', ')', ',', ';']

/** Tokenizer 1-pass cho mục đích hiển thị (syntax highlight/bracket match/
 *  autocomplete) — KHÔNG phải parser: không xây AST, không báo lỗi cú
 *  pháp (đó là việc của Check/compiler thật, đơn nguồn sự thật). */
export function tokenizeStSource(source: string): StToken[] {
  const tokens: StToken[] = []
  let i = 0
  const n = source.length
  while (i < n) {
    const ch = source[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      let j = i + 1
      while (j < n && /\s/.test(source[j])) j += 1
      tokens.push({ start: i, end: j, kind: 'whitespace', text: source.slice(i, j) })
      i = j
      continue
    }
    if (ch === '(' && source[i + 1] === '*') {
      const close = source.indexOf('*)', i + 2)
      const end = close === -1 ? n : close + 2
      tokens.push({ start: i, end, kind: 'comment', text: source.slice(i, end) })
      i = end
      continue
    }
    if (ch === '/' && source[i + 1] === '/') {
      let j = i + 2
      while (j < n && source[j] !== '\n') j += 1
      tokens.push({ start: i, end: j, kind: 'comment', text: source.slice(i, j) })
      i = j
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      const timeMatch = TIME_RE.exec(source.slice(i))
      if (timeMatch) {
        tokens.push({ start: i, end: i + timeMatch[0].length, kind: 'time', text: timeMatch[0] })
        i += timeMatch[0].length
        continue
      }
      const match = IDENTIFIER_RE.exec(source.slice(i))!
      const word = match[0]
      const upper = word.toUpperCase()
      let kind: StTokenKind = 'identifier'
      if (KEYWORD_SET.has(upper)) kind = 'keyword'
      else if (TYPE_SET.has(upper)) kind = 'type'
      else if (FB_TYPE_SET.has(upper)) kind = 'fb-type'
      else if (FUNCTION_SET.has(upper)) kind = 'function'
      tokens.push({ start: i, end: i + word.length, kind, text: word })
      i += word.length
      continue
    }
    if (/[0-9]/.test(ch)) {
      const rest = source.slice(i)
      const realMatch = REAL_RE.exec(rest)
      const numberMatch = realMatch ?? INT_RE.exec(rest)!
      tokens.push({ start: i, end: i + numberMatch[0].length, kind: 'number', text: numberMatch[0] })
      i += numberMatch[0].length
      continue
    }
    const rest = source.slice(i, i + 2)
    const twoChar = OPERATORS.find((op) => op.length === 2 && rest === op)
    if (twoChar) {
      tokens.push({ start: i, end: i + 2, kind: 'operator', text: twoChar })
      i += 2
      continue
    }
    if (PUNCTUATION.includes(ch)) {
      tokens.push({ start: i, end: i + 1, kind: 'punctuation', text: ch })
      i += 1
      continue
    }
    if (OPERATORS.includes(ch)) {
      tokens.push({ start: i, end: i + 1, kind: 'operator', text: ch })
      i += 1
      continue
    }
    tokens.push({ start: i, end: i + 1, kind: 'identifier', text: ch })
    i += 1
  }
  return tokens
}

/** Tìm ngoặc khớp `(`/`)` gần offset con trỏ (đứng ngay trước hoặc ngay sau
 *  một ngoặc) — quét tuyến tính theo độ sâu, bỏ qua ngoặc bên trong
 *  comment. */
export function findMatchingBracket(source: string, offset: number): { open: number; close: number } | null {
  const tokens = tokenizeStSource(source)
  const brackets = tokens.filter((token) => token.kind === 'punctuation' && (token.text === '(' || token.text === ')'))
  const anchor = brackets.find((token) => token.start === offset || token.end === offset)
  if (!anchor) return null
  if (anchor.text === '(') {
    let depth = 0
    for (const token of brackets) {
      if (token.start < anchor.start) continue
      if (token.text === '(') depth += 1
      else depth -= 1
      if (depth === 0) return { open: anchor.start, close: token.start }
    }
    return null
  }
  let depth = 0
  for (let index = brackets.length - 1; index >= 0; index -= 1) {
    const token = brackets[index]
    if (token.start > anchor.start) continue
    if (token.text === ')') depth += 1
    else depth -= 1
    if (depth === 0) return { open: token.start, close: anchor.start }
  }
  return null
}

/* `DEV-PROG-022` — hai tập này phải đi cùng `ST_KEYWORDS`. Trước lát này chúng
 * chỉ biết `IF`/`VAR`/`PROGRAM`, nên gõ trong một `CASE … OF` hay trong bất kỳ
 * FUNCTION_BLOCK nào thì Enter trả về đúng thụt lề cũ — người dùng phải tự gõ
 * hai dấu cách cho từng dòng của cả máy trạng thái. */
const OPEN_BLOCK_KEYWORDS = new Set([
  'PROGRAM', 'FUNCTION', 'FUNCTION_BLOCK',
  'VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_GLOBAL', 'VAR_EXTERNAL',
  'IF', 'THEN', 'ELSIF', 'ELSE',
  'CASE', 'FOR', 'WHILE', 'REPEAT',
])
const CLOSE_BLOCK_KEYWORDS = new Set([
  'END_PROGRAM', 'END_FUNCTION', 'END_FUNCTION_BLOCK', 'END_VAR',
  'END_IF', 'END_CASE', 'END_FOR', 'END_WHILE', 'END_REPEAT', 'UNTIL',
  'ELSIF', 'ELSE',
])

/** Indent gợi ý cho dòng MỚI khi bấm Enter tại `offset` — 2 khoảng trắng
 *  mỗi mức, tăng sau từ khoá mở khối, giảm nếu dòng vừa gõ TỰ nó là từ
 *  khoá đóng (ELSIF/ELSE cũng giảm rồi tăng lại vì vừa đóng nhánh trước
 *  vừa mở nhánh mới). Chỉ nhìn dòng hiện tại — không quét lại toàn văn bản
 *  như `formatStSource` (đắt và không cần cho một lần Enter). */
export function computeAutoIndent(source: string, offset: number): string {
  const before = source.slice(0, offset)
  const lines = before.split('\n')
  const currentLine = lines[lines.length - 1] ?? ''
  const currentIndentMatch = /^[ \t]*/.exec(currentLine)
  let indent = currentIndentMatch ? currentIndentMatch[0] : ''
  const trimmed = currentLine.trim().toUpperCase()
  const firstWord = /^[A-Za-z_][A-Za-z0-9_]*/.exec(trimmed)?.[0] ?? ''
  if (OPEN_BLOCK_KEYWORDS.has(firstWord)) indent += '  '
  else if (CLOSE_BLOCK_KEYWORDS.has(firstWord) && indent.length >= 2) indent = indent.slice(2)
  return indent
}

/**
 * `DEV-PROG-023` — `scrollTop` mới để dòng `line` (đánh số từ 1) thực sự nằm
 * trong tầm nhìn.
 *
 * Vì sao cần: `textarea.setSelectionRange()` KHÔNG cuộn. Trình duyệt cuộn tới
 * con trỏ khi CHÍNH NÓ di chuyển con trỏ (gõ phím, bấm chuột), không khi mã
 * lệnh đặt vùng chọn trên một textarea đang có tiêu điểm. Mọi đường "nhảy tới
 * một chỗ trong nguồn" của editor đều đi qua `selectRange`, nên tất cả cùng
 * hỏng một kiểu: bấm một mục trên Bản đồ mã, bấm một kết quả Tìm kiếm, "Tiếp",
 * `Ctrl+G`, bấm một diagnostic — vùng chọn đổi, khay Dòng/cột đổi, còn màn hình
 * đứng yên. Người dùng báo đúng triệu chứng đó ngày 2026-08-29.
 *
 * Hàm để riêng và thuần tuý vì hình học này không kiểm được trong jsdom:
 * `clientHeight`/`scrollHeight` của một textarea ở đó luôn là 0.
 */
export interface StRevealOptions {
  /** Dòng đích, đánh số từ 1. */
  line: number
  scrollTop: number
  viewportHeightPx: number
  contentHeightPx: number
  rowHeightPx: number
  padTopPx: number
}

export function scrollTopForLine(options: StRevealOptions): number {
  const { line, scrollTop, viewportHeightPx, contentHeightPx, rowHeightPx, padTopPx } = options
  /* Không có khung nhìn thì không có khái niệm "nhìn thấy được". Trả về 0 ở đây
   * sẽ làm mọi lần nhảy trong jsdom và ở lần render đầu tiên tự cuộn về đầu
   * tệp — một hành vi sai, và sai âm thầm. */
  if (viewportHeightPx <= 0 || rowHeightPx <= 0) return scrollTop
  const rowTop = padTopPx + (line - 1) * rowHeightPx
  const maxScroll = Math.max(0, contentHeightPx - viewportHeightPx)
  /* Lề an toàn hai hàng: một dòng dính sát mép trên hoặc mép dưới là "thấy
   * được" theo toạ độ nhưng không đọc được theo ngữ cảnh. Khung nhìn quá thấp
   * thì lề co lại chứ không nuốt mất cả vùng hợp lệ. */
  const margin = Math.min(2 * rowHeightPx, Math.floor(viewportHeightPx / 4))
  const alreadyVisible =
    rowTop >= scrollTop + margin && rowTop <= scrollTop + viewportHeightPx - margin - rowHeightPx
  /* Đã thấy rõ thì ĐỨNG YÊN. Căn giữa vô điều kiện làm màn hình giật mỗi lần
   * bấm một mục Bản đồ mã ngay cạnh chỗ đang đứng. */
  if (alreadyVisible) return scrollTop
  // Đặt dòng đích ở khoảng một phần ba trên: chỗ mắt tìm tới, còn giữ ngữ cảnh phía trên.
  return Math.max(0, Math.min(maxScroll, rowTop - Math.floor(viewportHeightPx / 3)))
}

export interface StDiagnosticRange {
  start: number
  end: number
  index: number
}

export interface StRenderSegment extends StToken {
  diagnosticIndex: number | null
}

/** Gộp ranh giới token (tô màu) và ranh giới diagnostic (gạch chân) thành
 *  một dãy đoạn phẳng không chồng lấn — mỗi đoạn có ĐÚNG MỘT kind tô màu và
 *  biết có nằm trong diagnostic nào không, để overlay chỉ cần render một
 *  lớp `<pre>` duy nhất thay vì hai lớp chồng nhau. */
export function mergeDiagnosticRanges(tokens: StToken[], ranges: readonly StDiagnosticRange[]): StRenderSegment[] {
  if (ranges.length === 0) return tokens.map((token) => ({ ...token, diagnosticIndex: null }))
  const boundaries = new Set<number>()
  for (const token of tokens) { boundaries.add(token.start); boundaries.add(token.end) }
  for (const range of ranges) { boundaries.add(range.start); boundaries.add(range.end) }
  const points = [...boundaries].sort((a, b) => a - b)
  const segments: StRenderSegment[] = []
  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i]
    const end = points[i + 1]
    if (start >= end) continue
    const token = tokens.find((candidate) => candidate.start <= start && candidate.end >= end)
    if (!token) continue
    const range = ranges.find((candidate) => candidate.start <= start && candidate.end >= end)
    segments.push({
      start, end, kind: token.kind, text: token.text.slice(start - token.start, end - token.start),
      diagnosticIndex: range ? range.index : null,
    })
  }
  return segments
}

export interface StCompletionItem {
  label: string
  kind: 'keyword' | 'type' | 'function' | 'fb-type' | 'symbol'
  detail: string
  /**
   * `T61-407` — khối này có cổng Controls/Safety chưa mở.
   *
   * Nó CÓ THẬT trong compiler và gõ được ở đây, nhưng `st_review_gate_check`
   * sẽ chặn ở bước Kiểm tra cho tới khi profile mang approval token. Trước lát
   * này gợi ý không nói gì: người dùng viết xong cả một chương trình quanh
   * `PID` rồi mới biết ở Kiểm tra — và lúc ấy chi phí đã bỏ ra rồi. Cổng phải
   * hiện ở chỗ người ta CHỌN, không phải chỗ người ta bị từ chối.
   */
  reviewGated?: true
}

/** Tên FB mà profile đang chặn ở Kiểm tra. Nguồn là profile sinh ra, không
 *  phải danh sách viết tay: thêm một feature vào cổng mà đây không biết sẽ tạo
 *  ra một gợi ý hứa nhiều hơn sự thật. */
const REVIEW_GATED_NAMES = new Set<string>(
  PROGRAMMING_REVIEW_GATED_FEATURES.filter((item) => !item.approved).map((item) => item.featureId)
)

/**
 * T59-506 — lịch sử của ST editor phải thuộc editor, không được phụ thuộc vào
 * native undo stack của `<textarea>`. Các đường sửa bằng autocomplete, Format,
 * Replace hoặc quick action đều ghi `.value` có kiểm soát, nên native stack có
 * thể mất hoặc chỉ hoàn tác một phần. Snapshot giữ cả hai đầu selection để undo/
 * redo trả người dùng về đúng ngữ cảnh đang sửa.
 */
export const ST_EDITOR_HISTORY_LIMIT = 50

export interface StEditorSnapshot {
  source: string
  selectionStart: number
  selectionEnd: number
}

export interface StEditorHistory {
  past: StEditorSnapshot[]
  current: StEditorSnapshot
  future: StEditorSnapshot[]
}

function normalizedSnapshot(snapshot: StEditorSnapshot): StEditorSnapshot {
  const start = Math.max(0, Math.min(snapshot.source.length, snapshot.selectionStart))
  const end = Math.max(start, Math.min(snapshot.source.length, snapshot.selectionEnd))
  return { ...snapshot, selectionStart: start, selectionEnd: end }
}

export function createStEditorHistory(
  source: string,
  selectionStart = 0,
  selectionEnd = selectionStart,
): StEditorHistory {
  return {
    past: [],
    current: normalizedSnapshot({ source, selectionStart, selectionEnd }),
    future: [],
  }
}

/** Cập nhật selection hiện tại mà không tạo một bước undo giả. */
export function updateStEditorSelection(
  history: StEditorHistory,
  selectionStart: number,
  selectionEnd = selectionStart,
): StEditorHistory {
  return {
    ...history,
    current: normalizedSnapshot({ ...history.current, selectionStart, selectionEnd }),
  }
}

/** Ghi một edit mới và cắt nhánh redo, bounded giống FBD editor. */
export function recordStEditorEdit(history: StEditorHistory, next: StEditorSnapshot): StEditorHistory {
  const current = normalizedSnapshot(history.current)
  const normalizedNext = normalizedSnapshot(next)
  if (current.source === normalizedNext.source) {
    return { ...history, current: normalizedNext }
  }
  return {
    past: [...history.past, current].slice(-ST_EDITOR_HISTORY_LIMIT),
    current: normalizedNext,
    future: [],
  }
}

export function undoStEditorEdit(history: StEditorHistory): StEditorHistory {
  const previous = history.past[history.past.length - 1]
  if (!previous) return history
  return {
    past: history.past.slice(0, -1),
    current: previous,
    future: [history.current, ...history.future].slice(0, ST_EDITOR_HISTORY_LIMIT),
  }
}

export function redoStEditorEdit(history: StEditorHistory): StEditorHistory {
  const next = history.future[0]
  if (!next) return history
  return {
    past: [...history.past, history.current].slice(-ST_EDITOR_HISTORY_LIMIT),
    current: next,
    future: history.future.slice(1),
  }
}

/** Từ tại vị trí `offset` (đang gõ dở, không tính khoảng trắng) — trả
 *  `null` nếu con trỏ không nằm ngay sau một identifier prefix (ví dụ vừa
 *  gõ dấu cách/toán tử). */
export function currentWordPrefix(source: string, offset: number): { start: number; prefix: string } | null {
  let start = offset
  while (start > 0 && /[A-Za-z0-9_]/.test(source[start - 1])) start -= 1
  if (start === offset) return null
  return { start, prefix: source.slice(start, offset) }
}

/** Gợi ý autocomplete — nguồn: keyword ST hỗ trợ thật, 6 kiểu dữ liệu, hàm/
 *  FB đúng registry `FBD_PALETTE`, và biến đã khai báo trong chính buffer
 *  đang sửa (qua `collectStSymbols`, truyền vào để tránh phụ thuộc vòng
 *  giữa hai module). Lọc theo prefix không phân biệt hoa/thường, không
 *  trùng, giới hạn 20 mục để danh sách còn dùng được bằng bàn phím. */
export function buildStCompletions(
  prefix: string,
  declaredSymbols: readonly { name: string; type: string }[],
): StCompletionItem[] {
  if (prefix.length === 0) return []
  const upperPrefix = prefix.toUpperCase()
  const items: StCompletionItem[] = []
  const seen = new Set<string>()
  const push = (label: string, kind: StCompletionItem['kind'], detail: string) => {
    const key = `${kind}:${label}`
    if (seen.has(key)) return
    seen.add(key)
    const gated = REVIEW_GATED_NAMES.has(label)
    items.push({
      label,
      kind,
      detail: gated ? 'chờ review Controls/Safety — Kiểm tra sẽ từ chối' : detail,
      ...(gated ? { reviewGated: true as const } : {}),
    })
  }
  for (const symbol of declaredSymbols) {
    if (symbol.name.toUpperCase().startsWith(upperPrefix)) push(symbol.name, 'symbol', symbol.type)
  }
  for (const keyword of ST_COMPLETION_KEYWORDS) {
    if (keyword.startsWith(upperPrefix)) push(keyword, 'keyword', 'keyword')
  }
  for (const type of ST_TYPE_NAMES) {
    if (type.startsWith(upperPrefix)) push(type, 'type', 'kiểu dữ liệu')
  }
  for (const name of ST_FUNCTION_NAMES) {
    if (name.startsWith(upperPrefix)) push(name, 'function', 'hàm chuẩn')
  }
  for (const name of ST_FB_TYPE_NAMES) {
    if (name.startsWith(upperPrefix)) push(name, 'fb-type', 'kiểu function block')
  }
  return items.slice(0, 20)
}
