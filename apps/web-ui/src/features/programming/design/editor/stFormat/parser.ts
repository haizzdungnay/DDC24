import type {
  StArg, StCaseBranch, StComment, StExpr, StIfBranch, StPou, StStmt, StTrivia, StUnit, StVarBlock, StVarDecl,
} from './ast'
import { emptyTrivia } from './ast'
import { lexSt, StLexError, type StFormatToken } from './lexer'

/**
 * `DEV-PROG-019` — bộ phân tích cú pháp ST cho formatter.
 *
 * FAIL-CLOSED là luật số một: gặp bất cứ thứ gì không phân tích được thì NÉM,
 * và bề mặt gọi **không format gì cả**. Formatter viết lại mã điều khiển; một
 * bản "format được một nửa" là mã mà không ai từng viết và không ai từng đọc.
 *
 * Ngữ pháp bám `ST_SUBSET_SPEC §10`, mở rộng thêm `CASE`/`FOR`/`WHILE`/`REPEAT`
 * vì chương trình thật trên bo có dùng `CASE` (máy trạng thái AHU). Formatter
 * phải xử lý được thứ người dùng ĐANG viết, kể cả khi compiler chưa nhận —
 * việc nói construct nào được hỗ trợ là của Kiểm tra, không phải của formatter.
 */
export class StParseError extends Error {
  constructor(message: string, readonly line: number) {
    super(message)
    this.name = 'StParseError'
  }
}

/** Toán tử nhị phân theo mức ưu tiên TĂNG dần (đúng §10). */
const BINARY_LEVELS: readonly (readonly string[])[] = [
  ['OR'],
  ['XOR'],
  ['AND', '&'],
  ['=', '<>'],
  ['<', '>', '<=', '>='],
  ['+', '-'],
  ['*', '/', 'MOD'],
]

const POU_OPENERS: Record<string, string> = {
  PROGRAM: 'END_PROGRAM',
  FUNCTION: 'END_FUNCTION',
  FUNCTION_BLOCK: 'END_FUNCTION_BLOCK',
}

const VAR_OPENERS = new Set(['VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_TEMP', 'VAR_GLOBAL'])

class Parser {
  private at = 0
  private pending: StComment[] = []
  /** Dòng của token có nghĩa vừa tiêu thụ — dùng để nhận chú thích cuối dòng. */
  private lastLine = 0

  constructor(private readonly tokens: StFormatToken[]) {}

  /* ---------- tầng token ---------- */

  private collectComments(): void {
    while (this.at < this.tokens.length && this.tokens[this.at].kind === 'comment') {
      const token = this.tokens[this.at]
      this.pending.push({ text: token.text, blankBefore: token.blankLinesBefore > 0 })
      this.lastLine = token.line + token.text.split('\n').length - 1
      this.at += 1
    }
  }

  private peek(): StFormatToken | null {
    this.collectComments()
    return this.tokens[this.at] ?? null
  }

  private next(): StFormatToken {
    const token = this.peek()
    if (!token) throw new StParseError('Hết nguồn giữa chừng — thiếu từ khoá kết thúc?', this.lastLine)
    this.at += 1
    this.lastLine = token.line
    return token
  }

  private takeTrivia(): StTrivia {
    const token = this.peek()
    const leading = this.pending
    this.pending = []
    return {
      leading,
      trailing: null,
      blankBefore: leading.length > 0 ? leading[0].blankBefore : (token?.blankLinesBefore ?? 0) > 0,
    }
  }

  /**
   * Chú thích nằm CÙNG dòng, ngay sau câu lệnh vừa đọc.
   *
   * Nó phải được lấy TRƯỚC khi `takeTrivia` của câu lệnh kế tiếp chạy, nếu
   * không nó sẽ trôi lên thành chú thích dẫn của câu sau — tức formatter đã dời
   * một chú thích sang chỗ nó không nói về, đúng điều đề bài cấm.
   */
  private attachTrailing(trivia: StTrivia): void {
    const token = this.tokens[this.at]
    if (!token || token.kind !== 'comment' || !token.hasCodeBefore) return
    if (token.text.includes('\n')) return
    trivia.trailing = token.text
    this.lastLine = token.line
    this.at += 1
  }

  private isKeyword(token: StFormatToken | null, ...words: string[]): boolean {
    if (!token || token.kind !== 'keyword') return false
    return words.includes(token.text.toUpperCase())
  }

  private isPunct(token: StFormatToken | null, ...chars: string[]): boolean {
    if (!token) return false
    return (token.kind === 'punct' || token.kind === 'operator') && chars.includes(token.text)
  }

  private expectPunct(char: string): StFormatToken {
    const token = this.next()
    if (!this.isPunct(token, char)) {
      throw new StParseError(`Cần "${char}" nhưng gặp "${token.text}"`, token.line)
    }
    return token
  }

  private expectKeyword(...words: string[]): StFormatToken {
    const token = this.next()
    if (!this.isKeyword(token, ...words)) {
      throw new StParseError(`Cần ${words.join('/')} nhưng gặp "${token.text}"`, token.line)
    }
    return token
  }

  private expectIdent(): StFormatToken {
    const token = this.next()
    if (token.kind !== 'ident') throw new StParseError(`Cần một định danh nhưng gặp "${token.text}"`, token.line)
    return token
  }

  /* ---------- đơn vị biên dịch ---------- */

  parseUnit(): StUnit {
    const pous: StPou[] = []
    while (this.peek() !== null) pous.push(this.parsePou())
    this.collectComments()
    const trailingComments = this.pending
    this.pending = []
    if (pous.length === 0 && trailingComments.length === 0) {
      throw new StParseError('Nguồn rỗng', 1)
    }
    return { kind: 'Unit', pous, trailingComments }
  }

  private parsePou(): StPou {
    const trivia = this.takeTrivia()
    const opener = this.next()
    const keyword = opener.text.toUpperCase()
    const closer = POU_OPENERS[keyword]
    if (!closer) throw new StParseError(`Cần PROGRAM/FUNCTION/FUNCTION_BLOCK nhưng gặp "${opener.text}"`, opener.line)
    const name = this.expectIdent().text

    let returnType: string | null = null
    if (this.isPunct(this.peek(), ':')) {
      this.next()
      returnType = this.next().text
    }
    this.attachTrailing(trivia)

    const varBlocks: StVarBlock[] = []
    while (this.isKeyword(this.peek(), ...VAR_OPENERS)) varBlocks.push(this.parseVarBlock())

    const body = this.parseStatements(new Set([closer]))
    const endTrivia = this.takeTrivia()
    this.expectKeyword(closer)
    if (this.isPunct(this.peek(), ';')) this.next()
    this.attachTrailing(endTrivia)

    return { kind: 'Pou', keyword, name, returnType, varBlocks, body, trivia, endTrivia }
  }

  private parseVarBlock(): StVarBlock {
    const trivia = this.takeTrivia()
    const keywords = [this.next().text.toUpperCase()]
    while (this.isKeyword(this.peek(), 'RETAIN', 'CONSTANT')) keywords.push(this.next().text.toUpperCase())
    this.attachTrailing(trivia)

    const decls: StVarDecl[] = []
    while (!this.isKeyword(this.peek(), 'END_VAR')) {
      if (this.peek() === null) throw new StParseError('Khối VAR thiếu END_VAR', this.lastLine)
      decls.push(this.parseVarDecl())
    }
    const endTrivia = this.takeTrivia()
    this.expectKeyword('END_VAR')
    this.attachTrailing(endTrivia)
    return { kind: 'VarBlock', keywords, decls, trivia, endTrivia }
  }

  private parseVarDecl(): StVarDecl {
    const trivia = this.takeTrivia()
    const names = [this.expectIdent().text]
    while (this.isPunct(this.peek(), ',')) {
      this.next()
      names.push(this.expectIdent().text)
    }
    this.expectPunct(':')
    const typeToken = this.next()
    if (typeToken.kind !== 'ident' && typeToken.kind !== 'keyword') {
      throw new StParseError(`Cần tên kiểu nhưng gặp "${typeToken.text}"`, typeToken.line)
    }
    const typeName = typeToken.text

    /* Phần đuôi kiểu (`[1..10] OF INT`, `(1..5)`) giữ NGUYÊN VĂN. Formatter
     * không hiểu nó, nên nó chỉ được chép lại — hiểu một nửa rồi in lại theo
     * cách mình đoán là cách nhanh nhất để đổi nghĩa một khai báo. */
    let typeSuffix: string | null = null
    if (this.isPunct(this.peek(), '[') || this.isKeyword(this.peek(), 'OF')) {
      const parts: string[] = []
      let depth = 0
      while (this.peek() !== null) {
        const token = this.peek() as StFormatToken
        if (depth === 0 && (this.isPunct(token, ';') || this.isPunct(token, ':='))) break
        if (this.isPunct(token, '[')) depth += 1
        if (this.isPunct(token, ']')) depth -= 1
        parts.push(this.next().text)
      }
      typeSuffix = parts.join(' ')
    }

    let initial: StExpr | null = null
    if (this.isPunct(this.peek(), ':=')) {
      this.next()
      initial = this.parseExpression()
    }
    this.expectPunct(';')
    this.attachTrailing(trivia)
    return { kind: 'VarDecl', names, typeName, typeSuffix, initial, trivia }
  }

  /* ---------- câu lệnh ---------- */

  private parseStatements(stopKeywords: ReadonlySet<string>, stopAtCaseLabel = false): StStmt[] {
    const body: StStmt[] = []
    for (;;) {
      const token = this.peek()
      if (token === null) break
      if (token.kind === 'keyword' && stopKeywords.has(token.text.toUpperCase())) break
      if (stopAtCaseLabel && this.looksLikeCaseLabel()) break
      body.push(this.parseStatement())
    }
    return body
  }

  /**
   * Token hiện tại có mở đầu một NHÃN `CASE` không (`10:`, `1..5:`, `A, B:`)?
   *
   * Cần thiết vì thân một nhánh `CASE` kết thúc ở nhãn kế tiếp chứ không ở một
   * từ khoá. Không có phép nhìn trước này thì `10:` bị đọc như một câu lệnh, và
   * parser báo lỗi trên một tệp hoàn toàn hợp lệ — formatter khi đó từ chối
   * format cả POU vì một thứ nó đáng lẽ hiểu được.
   *
   * Quét tới `:` ở độ sâu 0. Gặp `;` hoặc `:=` trước ⇒ đây là câu lệnh, không
   * phải nhãn.
   */
  private looksLikeCaseLabel(): boolean {
    let cursor = this.at
    let depth = 0
    while (cursor < this.tokens.length) {
      const token = this.tokens[cursor]
      if (token.kind === 'comment') { cursor += 1; continue }
      if (token.text === '(' || token.text === '[') depth += 1
      if (token.text === ')' || token.text === ']') depth -= 1
      if (depth === 0) {
        if (token.text === ':') return true
        if (token.text === ';' || token.text === ':=') return false
      }
      if (token.kind === 'keyword' && token.text.toUpperCase() !== 'TRUE' && token.text.toUpperCase() !== 'FALSE') {
        return false
      }
      cursor += 1
    }
    return false
  }

  private parseStatement(): StStmt {
    const token = this.peek()
    if (!token) throw new StParseError('Cần một câu lệnh', this.lastLine)
    if (token.kind === 'keyword') {
      const keyword = token.text.toUpperCase()
      if (keyword === 'IF') return this.parseIf()
      if (keyword === 'CASE') return this.parseCase()
      if (keyword === 'FOR') return this.parseFor()
      if (keyword === 'WHILE') return this.parseWhile()
      if (keyword === 'REPEAT') return this.parseRepeat()
      if (keyword === 'RETURN' || keyword === 'EXIT' || keyword === 'CONTINUE') {
        const trivia = this.takeTrivia()
        this.next()
        if (this.isPunct(this.peek(), ';')) this.next()
        this.attachTrailing(trivia)
        return { kind: 'Jump', keyword: keyword as 'RETURN' | 'EXIT' | 'CONTINUE', trivia }
      }
      throw new StParseError(`Từ khoá "${token.text}" không mở đầu một câu lệnh nào formatter hiểu`, token.line)
    }

    const trivia = this.takeTrivia()
    const target = this.parseExpression()
    if (this.isPunct(this.peek(), ':=')) {
      this.next()
      const value = this.parseExpression()
      this.expectPunct(';')
      this.attachTrailing(trivia)
      return { kind: 'Assign', target, value, trivia }
    }
    this.expectPunct(';')
    this.attachTrailing(trivia)
    if (target.kind !== 'Call') {
      throw new StParseError('Câu lệnh phải là gán hoặc lời gọi', token.line)
    }
    return { kind: 'CallStmt', callee: target.callee, args: target.args, trivia }
  }

  private parseIf(): StStmt {
    const trivia = this.takeTrivia()
    this.expectKeyword('IF')
    const branches: StIfBranch[] = []
    let branchTrivia = trivia
    for (;;) {
      const condition = this.parseExpression()
      this.expectKeyword('THEN')
      this.attachTrailing(branchTrivia)
      const body = this.parseStatements(new Set(['ELSIF', 'ELSE', 'END_IF']))
      branches.push({ condition, body, trivia: branchTrivia })
      if (!this.isKeyword(this.peek(), 'ELSIF')) break
      branchTrivia = this.takeTrivia()
      this.next()
    }

    let elseBody: StStmt[] | null = null
    let elseTrivia = emptyTrivia()
    if (this.isKeyword(this.peek(), 'ELSE')) {
      elseTrivia = this.takeTrivia()
      this.next()
      this.attachTrailing(elseTrivia)
      elseBody = this.parseStatements(new Set(['END_IF']))
    }
    const endTrivia = this.takeTrivia()
    this.expectKeyword('END_IF')
    if (this.isPunct(this.peek(), ';')) this.next()
    this.attachTrailing(endTrivia)
    return { kind: 'If', branches, elseBody, elseTrivia, trivia, endTrivia }
  }

  private parseCase(): StStmt {
    const trivia = this.takeTrivia()
    this.expectKeyword('CASE')
    const selector = this.parseExpression()
    this.expectKeyword('OF')
    this.attachTrailing(trivia)

    const branches: StCaseBranch[] = []
    while (!this.isKeyword(this.peek(), 'ELSE', 'END_CASE')) {
      if (this.peek() === null) throw new StParseError('CASE thiếu END_CASE', this.lastLine)
      branches.push(this.parseCaseBranch())
    }

    let elseBody: StStmt[] | null = null
    let elseTrivia = emptyTrivia()
    if (this.isKeyword(this.peek(), 'ELSE')) {
      elseTrivia = this.takeTrivia()
      this.next()
      this.attachTrailing(elseTrivia)
      elseBody = this.parseStatements(new Set(['END_CASE']))
    }
    const endTrivia = this.takeTrivia()
    this.expectKeyword('END_CASE')
    if (this.isPunct(this.peek(), ';')) this.next()
    this.attachTrailing(endTrivia)
    return { kind: 'Case', selector, branches, elseBody, elseTrivia, trivia, endTrivia }
  }

  private parseCaseBranch(): StCaseBranch {
    const trivia = this.takeTrivia()
    /* Nhãn giữ NGUYÊN VĂN: `1..5`, `0`, `A, B` đều là những thứ formatter chỉ
     * cần chép lại. Tính lại một dải nhãn là đổi ngữ nghĩa. */
    const labels: string[] = []
    let current: string[] = []
    for (;;) {
      const token = this.peek()
      if (!token) throw new StParseError('Nhãn CASE thiếu ":"', this.lastLine)
      if (this.isPunct(token, ':') ) { this.next(); break }
      if (this.isPunct(token, ',')) {
        this.next()
        labels.push(current.join(''))
        current = []
        continue
      }
      current.push(this.next().text)
    }
    labels.push(current.join(''))
    this.attachTrailing(trivia)
    /* Thân nhánh dừng ở `ELSE`/`END_CASE` HOẶC ở nhãn kế tiếp — xem
     * `looksLikeCaseLabel`. */
    const body = this.parseStatements(new Set(['ELSE', 'END_CASE']), true)
    return { labels, body, trivia }
  }

  private parseFor(): StStmt {
    const trivia = this.takeTrivia()
    this.expectKeyword('FOR')
    const variable = this.expectIdent().text
    this.expectPunct(':=')
    const from = this.parseExpression()
    this.expectKeyword('TO')
    const to = this.parseExpression()
    let by: StExpr | null = null
    if (this.isKeyword(this.peek(), 'BY')) {
      this.next()
      by = this.parseExpression()
    }
    this.expectKeyword('DO')
    this.attachTrailing(trivia)
    const body = this.parseStatements(new Set(['END_FOR']))
    const endTrivia = this.takeTrivia()
    this.expectKeyword('END_FOR')
    if (this.isPunct(this.peek(), ';')) this.next()
    this.attachTrailing(endTrivia)
    return { kind: 'For', variable, from, to, by, body, trivia, endTrivia }
  }

  private parseWhile(): StStmt {
    const trivia = this.takeTrivia()
    this.expectKeyword('WHILE')
    const condition = this.parseExpression()
    this.expectKeyword('DO')
    this.attachTrailing(trivia)
    const body = this.parseStatements(new Set(['END_WHILE']))
    const endTrivia = this.takeTrivia()
    this.expectKeyword('END_WHILE')
    if (this.isPunct(this.peek(), ';')) this.next()
    this.attachTrailing(endTrivia)
    return { kind: 'While', condition, body, trivia, endTrivia }
  }

  private parseRepeat(): StStmt {
    const trivia = this.takeTrivia()
    this.expectKeyword('REPEAT')
    this.attachTrailing(trivia)
    const body = this.parseStatements(new Set(['UNTIL']))
    const endTrivia = this.takeTrivia()
    this.expectKeyword('UNTIL')
    const condition = this.parseExpression()
    this.expectKeyword('END_REPEAT')
    if (this.isPunct(this.peek(), ';')) this.next()
    this.attachTrailing(endTrivia)
    return { kind: 'Repeat', body, condition, trivia, endTrivia }
  }

  /* ---------- biểu thức ---------- */

  parseExpression(level = 0): StExpr {
    if (level >= BINARY_LEVELS.length) return this.parseUnary()
    let left = this.parseExpression(level + 1)
    for (;;) {
      const token = this.peek()
      if (!token) break
      const text = token.text.toUpperCase()
      const matches = (token.kind === 'keyword' || token.kind === 'operator') && BINARY_LEVELS[level].includes(text)
      if (!matches) break
      this.next()
      const right = this.parseExpression(level + 1)
      /* Giữ NGUYÊN cây trái-kết-hợp mà nguồn đã viết. Không gom, không đảo, và
       * tuyệt đối không tự thêm ngoặc cho `A OR B AND C` — đó là việc của
       * Kiểm tra/Linter cảnh báo, không phải của formatter sửa. */
      left = { kind: 'Binary', operator: text, left, right }
    }
    return left
  }

  private parseUnary(): StExpr {
    const token = this.peek()
    if (token && ((token.kind === 'operator' && token.text === '-') || this.isKeyword(token, 'NOT'))) {
      this.next()
      return { kind: 'Unary', operator: token.text.toUpperCase(), operand: this.parseUnary() }
    }
    return this.parsePostfix()
  }

  private parsePostfix(): StExpr {
    let node = this.parsePrimary()
    for (;;) {
      const token = this.peek()
      if (this.isPunct(token, '.')) {
        this.next()
        node = { kind: 'Member', object: node, name: this.next().text }
        continue
      }
      if (this.isPunct(token, '[')) {
        this.next()
        const index = this.parseExpression()
        this.expectPunct(']')
        node = { kind: 'Index', object: node, index }
        continue
      }
      if (this.isPunct(token, '(')) {
        this.next()
        node = { kind: 'Call', callee: node, args: this.parseArgs() }
        continue
      }
      break
    }
    return node
  }

  private parseArgs(): StArg[] {
    const args: StArg[] = []
    if (this.isPunct(this.peek(), ')')) {
      this.next()
      return args
    }
    for (;;) {
      const token = this.peek()
      if (!token) throw new StParseError('Lời gọi thiếu ")"', this.lastLine)
      let name: string | null = null
      let output = false
      const after = this.tokens[this.at + 1]
      if (token.kind === 'ident' && after && (after.text === ':=' || after.text === '=>')) {
        name = this.next().text
        output = this.next().text === '=>'
      }
      args.push({ name, output, value: this.parseExpression() })
      if (this.isPunct(this.peek(), ',')) {
        this.next()
        continue
      }
      this.expectPunct(')')
      break
    }
    return args
  }

  private parsePrimary(): StExpr {
    const token = this.next()
    if (this.isPunct(token, '(')) {
      const inner = this.parseExpression()
      this.expectPunct(')')
      return { kind: 'Paren', inner }
    }
    if (token.kind === 'number') return { kind: 'Literal', literal: 'number', text: token.text }
    if (token.kind === 'time') return { kind: 'Literal', literal: 'time', text: token.text }
    if (token.kind === 'string') return { kind: 'Literal', literal: 'string', text: token.text }
    if (token.kind === 'keyword' && (token.text.toUpperCase() === 'TRUE' || token.text.toUpperCase() === 'FALSE')) {
      return { kind: 'Literal', literal: 'bool', text: token.text.toUpperCase() }
    }
    if (token.kind === 'ident') return { kind: 'Ident', name: token.text }
    /* Tên kiểu dùng như hàm ép kiểu (`REAL_TO_INT`) đã là `ident`; còn một từ
     * khoá đứng ở vị trí biểu thức thì formatter KHÔNG hiểu — và không hiểu thì
     * không được in lại. */
    throw new StParseError(`Không đọc được biểu thức tại "${token.text}"`, token.line)
  }
}

export function parseSt(source: string): StUnit {
  let tokens: StFormatToken[]
  try {
    tokens = lexSt(source)
  } catch (error) {
    if (error instanceof StLexError) throw new StParseError(error.message, error.line)
    throw error
  }
  return new Parser(tokens).parseUnit()
}

export { StLexError }
