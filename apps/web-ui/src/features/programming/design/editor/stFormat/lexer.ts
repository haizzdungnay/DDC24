/**
 * `DEV-PROG-019` — bộ tách token cho **formatter** ST.
 *
 * Vì sao KHÔNG dùng lại `tokenizeSt` của `stEditorSupport`: bộ đó phục vụ TÔ
 * MÀU, nên nó được phép gộp/đơn giản hoá những thứ mà formatter bắt buộc phải
 * phân biệt (dấu `:=` với `:`, `T#5s` với `T` rồi `#`, chú thích `//` tới hết
 * dòng). Một formatter đọc sai ranh giới token sẽ viết lại sai mã điều khiển.
 *
 * Bộ này giữ **mọi** ký tự: chú thích và khoảng trắng cũng là token. Formatter
 * cần biết dòng nào có dòng trống phía trên và chú thích nào nằm cuối dòng —
 * hai thứ đó không suy được sau khi đã vứt khoảng trắng.
 *
 * `MK`: đây là quyết định thiết kế của Mekong, không phải yêu cầu của IEC.
 */

export type StTokenKind =
  | 'ident'
  | 'keyword'
  | 'number'
  | 'time'
  | 'string'
  | 'comment'
  | 'operator'
  | 'punct'

export interface StFormatToken {
  kind: StTokenKind
  /** Văn bản NGUYÊN VĂN như trong nguồn. Chú thích và chuỗi giữ từng ký tự. */
  text: string
  start: number
  end: number
  /** Dòng (1-based) chứa ký tự đầu của token. */
  line: number
  /** Số dòng trống ngay TRƯỚC token này (đã bỏ khoảng trắng). */
  blankLinesBefore: number
  /** Token này có ký tự nào đứng trước nó trên CÙNG dòng không. */
  hasCodeBefore: boolean
}

export class StLexError extends Error {
  constructor(message: string, readonly offset: number, readonly line: number) {
    super(message)
    this.name = 'StLexError'
  }
}

/**
 * Từ khoá được viết hoa khi in.
 *
 * Danh sách này RỘNG HƠN `ST_KEYWORDS` của `stEditorSupport` — nó gồm cả `CASE`,
 * `OF`, `END_CASE`, `FUNCTION`… Lý do: `ST_KEYWORDS` phục vụ GỢI Ý, nên nó cố ý
 * chỉ liệt kê thứ compiler đã hỗ trợ (§10); còn formatter phải xử lý đúng thứ
 * người dùng ĐANG viết. Chương trình AHU thật trên bo có `CASE AhuState OF`, và
 * một formatter không biết `CASE` sẽ thụt lề sai toàn bộ máy trạng thái đó.
 */
export const ST_FORMAT_KEYWORDS: ReadonlySet<string> = new Set([
  'PROGRAM', 'END_PROGRAM', 'FUNCTION', 'END_FUNCTION', 'FUNCTION_BLOCK', 'END_FUNCTION_BLOCK',
  'VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_TEMP', 'VAR_GLOBAL', 'RETAIN', 'CONSTANT', 'END_VAR',
  'IF', 'THEN', 'ELSIF', 'ELSE', 'END_IF',
  'CASE', 'OF', 'END_CASE',
  'FOR', 'TO', 'BY', 'DO', 'END_FOR',
  'WHILE', 'END_WHILE', 'REPEAT', 'UNTIL', 'END_REPEAT',
  'AND', 'OR', 'XOR', 'NOT', 'MOD',
  'TRUE', 'FALSE', 'RETURN', 'EXIT', 'CONTINUE',
])

/** Toán tử hai ký tự phải nhận diện TRƯỚC bản một ký tự, nếu không `:=` thành `:`. */
const TWO_CHAR_OPERATORS = ['<=', '>=', '<>', ':=', '**']
const ONE_CHAR_OPERATORS = ['+', '-', '*', '/', '<', '>', '=']
const PUNCTUATION = ['(', ')', '[', ']', ',', ';', ':', '.', '#']

const TIME_LITERAL = /^(T|TIME|LT|LTIME)#[0-9_]+(\.[0-9]+)?(d|h|ms|m|s|us|ns)?([0-9_]+(\.[0-9]+)?(d|h|ms|m|s|us|ns)?)*/i
const NUMBER = /^[0-9][0-9_]*(\.[0-9][0-9_]*)?([eE][+-]?[0-9]+)?/
const IDENT = /^[A-Za-z_À-ɏḀ-ỿ][A-Za-z0-9_À-ɏḀ-ỿ]*/

/**
 * Tách nguồn thành token.
 *
 * Ném `StLexError` khi gặp chú thích/chuỗi KHÔNG ĐÓNG. Đây là lựa chọn
 * fail-closed có chủ ý: một chú thích chưa đóng nghĩa là phần còn lại của tệp có
 * thể là chú thích hoặc có thể là mã — formatter không được đoán, vì đoán sai là
 * viết lại mã điều khiển theo một cách hiểu khác.
 */
export function lexSt(source: string): StFormatToken[] {
  const tokens: StFormatToken[] = []
  let index = 0
  let line = 1
  let pendingBlankLines = 0
  let lineHasCode = false

  const push = (kind: StTokenKind, start: number, end: number) => {
    tokens.push({
      kind,
      text: source.slice(start, end),
      start,
      end,
      line,
      blankLinesBefore: pendingBlankLines,
      hasCodeBefore: lineHasCode,
    })
    pendingBlankLines = 0
    lineHasCode = true
    // Token nhiều dòng (chú thích khối) đẩy bộ đếm dòng theo đúng số `\n` của nó.
    const breaks = source.slice(start, end).split('\n').length - 1
    if (breaks > 0) {
      line += breaks
      lineHasCode = true
    }
    index = end
  }

  while (index < source.length) {
    const char = source[index]

    if (char === '\n') {
      line += 1
      // Một dòng KHÔNG có mã nào phía trước `\n` là một dòng trống.
      if (!lineHasCode) pendingBlankLines += 1
      lineHasCode = false
      index += 1
      continue
    }
    if (char === '\r' || char === ' ' || char === '\t') {
      index += 1
      continue
    }

    if (char === '(' && source[index + 1] === '*') {
      const close = source.indexOf('*)', index + 2)
      if (close === -1) throw new StLexError('Chú thích (* *) không được đóng', index, line)
      push('comment', index, close + 2)
      continue
    }
    if (char === '/' && source[index + 1] === '/') {
      const eol = source.indexOf('\n', index)
      push('comment', index, eol === -1 ? source.length : eol)
      continue
    }
    if (char === "'" || char === '"') {
      let cursor = index + 1
      while (cursor < source.length && source[cursor] !== char) {
        if (source[cursor] === '\n') throw new StLexError('Chuỗi không được đóng trước hết dòng', index, line)
        cursor += source[cursor] === '$' ? 2 : 1
      }
      if (cursor >= source.length) throw new StLexError('Chuỗi không được đóng', index, line)
      push('string', index, cursor + 1)
      continue
    }

    const rest = source.slice(index)

    const time = TIME_LITERAL.exec(rest)
    if (time) {
      push('time', index, index + time[0].length)
      continue
    }

    const identifier = IDENT.exec(rest)
    if (identifier) {
      const word = identifier[0]
      push(ST_FORMAT_KEYWORDS.has(word.toUpperCase()) ? 'keyword' : 'ident', index, index + word.length)
      continue
    }

    const number = NUMBER.exec(rest)
    if (number) {
      push('number', index, index + number[0].length)
      continue
    }

    const twoChar = TWO_CHAR_OPERATORS.find((operator) => rest.startsWith(operator))
    if (twoChar) {
      push('operator', index, index + twoChar.length)
      continue
    }
    if (ONE_CHAR_OPERATORS.includes(char)) {
      push('operator', index, index + 1)
      continue
    }
    if (PUNCTUATION.includes(char)) {
      push('punct', index, index + 1)
      continue
    }

    throw new StLexError(`Ký tự không thuộc subset ST: ${JSON.stringify(char)}`, index, line)
  }

  return tokens
}
