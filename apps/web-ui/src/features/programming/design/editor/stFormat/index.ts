import type { StComment, StExpr, StStmt, StUnit } from './ast'
import { parseSt, StParseError } from './parser'
import { printSt } from './printer'

/**
 * `DEV-PROG-019` — nút **Định dạng** của trình soạn thảo ST.
 *
 * ```text
 * Nguồn ST → Lexer → Parser → AST → Printer → Nguồn đã format
 *                                       ↓
 *                                 Parse lần 2
 *                                       ↓
 *                            AST trước == AST sau ?
 *                              ├─ ĐÚNG → thay buffer
 *                              └─ SAI  → KHÔNG format, báo lỗi
 * ```
 *
 * Vì sao KHÔNG làm bằng regex: bản trước làm đúng như vậy, và nó **phá chú
 * thích**. Kiểm được bằng một dòng:
 *
 * ```text
 * nguồn : (* chú thích có dấu ; và chữ IF bên trong *)
 * kết quả: (* chú thích có dấu ;\n và chữ \nIF\n bên trong *)
 * ```
 *
 * `.replace(/;/g, ';\\n')` không biết mình đang ở trong chú thích, và
 * `ST_KEYWORD_SPLIT` khớp cả chữ `IF` nằm trong câu tiếng Việt. Với ST thật —
 * `IF` lồng, `CASE`, chuỗi, chú thích khối — một formatter regex phá mã điều
 * khiển, và người dùng chỉ phát hiện ra ở lần Kiểm tra sau đó.
 *
 * Nút này **không tự Lưu, không tự Kiểm tra, không tự Commission**: nó chỉ đổi
 * buffer trong trình soạn thảo.
 */

export type StFormatResult =
  | { ok: true; text: string; changed: boolean }
  | { ok: false; reason: string; line: number | null }

/** Cây đã bỏ mọi thông tin TRÌNH BÀY — phần còn lại là ngữ nghĩa thuần. */
type Semantic = unknown

function semanticExpr(node: StExpr): Semantic {
  switch (node.kind) {
    case 'Literal':
      /* Literal so theo VĂN BẢN, không theo giá trị: `1.50` và `1.5` bằng nhau
       * về số nhưng khác nhau về nguồn, và formatter không được phép viết lại
       * một literal người dùng đã gõ. */
      return [node.kind, node.literal, node.text]
    case 'Ident': return [node.kind, node.name]
    case 'Member': return [node.kind, semanticExpr(node.object), node.name]
    case 'Index': return [node.kind, semanticExpr(node.object), semanticExpr(node.index)]
    case 'Paren': return [node.kind, semanticExpr(node.inner)]
    case 'Unary': return [node.kind, node.operator, semanticExpr(node.operand)]
    case 'Binary': return [node.kind, node.operator, semanticExpr(node.left), semanticExpr(node.right)]
    case 'Call':
      return [node.kind, semanticExpr(node.callee),
        node.args.map((arg) => [arg.name, arg.output, semanticExpr(arg.value)])]
  }
}

function semanticStmt(statement: StStmt): Semantic {
  switch (statement.kind) {
    case 'Assign': return ['Assign', semanticExpr(statement.target), semanticExpr(statement.value)]
    case 'CallStmt':
      return ['CallStmt', semanticExpr(statement.callee),
        statement.args.map((arg) => [arg.name, arg.output, semanticExpr(arg.value)])]
    case 'If':
      return ['If',
        statement.branches.map((branch) => [semanticExpr(branch.condition), branch.body.map(semanticStmt)]),
        statement.elseBody ? statement.elseBody.map(semanticStmt) : null]
    case 'Case':
      return ['Case', semanticExpr(statement.selector),
        statement.branches.map((branch) => [branch.labels, branch.body.map(semanticStmt)]),
        statement.elseBody ? statement.elseBody.map(semanticStmt) : null]
    case 'For':
      return ['For', statement.variable, semanticExpr(statement.from), semanticExpr(statement.to),
        statement.by ? semanticExpr(statement.by) : null, statement.body.map(semanticStmt)]
    case 'While': return ['While', semanticExpr(statement.condition), statement.body.map(semanticStmt)]
    case 'Repeat': return ['Repeat', statement.body.map(semanticStmt), semanticExpr(statement.condition)]
    case 'Jump': return ['Jump', statement.keyword]
  }
}

function semanticUnit(unit: StUnit): Semantic {
  return unit.pous.map((pou) => [
    pou.keyword,
    pou.name,
    pou.returnType,
    pou.varBlocks.map((block) => [
      block.keywords,
      block.decls.map((decl) => [
        decl.names, decl.typeName, decl.typeSuffix,
        decl.initial ? semanticExpr(decl.initial) : null,
      ]),
    ]),
    pou.body.map(semanticStmt),
  ])
}

/** Mọi chú thích theo ĐÚNG thứ tự nguồn — formatter không được đánh rơi cái nào. */
function commentSequence(unit: StUnit): string[] {
  const out: string[] = []
  const push = (comments: readonly StComment[]) => { for (const item of comments) out.push(item.text) }
  const walkStmts = (body: readonly StStmt[]) => {
    for (const statement of body) {
      push(statement.trivia.leading)
      if (statement.trivia.trailing) out.push(statement.trivia.trailing)
      if (statement.kind === 'If') {
        statement.branches.forEach((branch, position) => {
          if (position > 0) {
            push(branch.trivia.leading)
            if (branch.trivia.trailing) out.push(branch.trivia.trailing)
          }
          walkStmts(branch.body)
        })
        push(statement.elseTrivia.leading)
        if (statement.elseTrivia.trailing) out.push(statement.elseTrivia.trailing)
        if (statement.elseBody) walkStmts(statement.elseBody)
        push(statement.endTrivia.leading)
        if (statement.endTrivia.trailing) out.push(statement.endTrivia.trailing)
      }
      if (statement.kind === 'Case') {
        for (const branch of statement.branches) {
          push(branch.trivia.leading)
          if (branch.trivia.trailing) out.push(branch.trivia.trailing)
          walkStmts(branch.body)
        }
        push(statement.elseTrivia.leading)
        if (statement.elseTrivia.trailing) out.push(statement.elseTrivia.trailing)
        if (statement.elseBody) walkStmts(statement.elseBody)
        push(statement.endTrivia.leading)
        if (statement.endTrivia.trailing) out.push(statement.endTrivia.trailing)
      }
      if (statement.kind === 'For' || statement.kind === 'While' || statement.kind === 'Repeat') {
        walkStmts(statement.body)
        push(statement.endTrivia.leading)
        if (statement.endTrivia.trailing) out.push(statement.endTrivia.trailing)
      }
    }
  }
  for (const pou of unit.pous) {
    push(pou.trivia.leading)
    if (pou.trivia.trailing) out.push(pou.trivia.trailing)
    for (const block of pou.varBlocks) {
      push(block.trivia.leading)
      if (block.trivia.trailing) out.push(block.trivia.trailing)
      for (const decl of block.decls) {
        push(decl.trivia.leading)
        if (decl.trivia.trailing) out.push(decl.trivia.trailing)
      }
      push(block.endTrivia.leading)
      if (block.endTrivia.trailing) out.push(block.endTrivia.trailing)
    }
    walkStmts(pou.body)
    push(pou.endTrivia.leading)
    if (pou.endTrivia.trailing) out.push(pou.endTrivia.trailing)
  }
  push(unit.trailingComments)
  return out
}

/**
 * Định dạng CẢ tài liệu.
 *
 * Không parse được ⇒ trả `ok:false` và **không đổi một byte nào**. Đây không
 * phải sự thận trọng thừa: nguồn ngoài subset (`ARRAY`, khai báo lạ, chú thích
 * chưa đóng) là thứ có thật trong tay người dùng, và một formatter "cố gắng
 * hết sức" trên nguồn nó không hiểu là một formatter viết lại mã điều khiển
 * theo phỏng đoán.
 */
export function formatStDocument(source: string): StFormatResult {
  if (source.trim().length === 0) return { ok: true, text: source, changed: false }
  let unit: StUnit
  try {
    unit = parseSt(source)
  } catch (error) {
    if (error instanceof StParseError) {
      return { ok: false, reason: error.message, line: error.line }
    }
    throw error
  }

  const text = printSt(unit)

  let reparsed: StUnit
  try {
    reparsed = parseSt(text)
  } catch (error) {
    /* Bản in ra không đọc lại được: đó là lỗi CỦA FORMATTER, không phải của
     * người dùng. Nói thẳng như vậy thay vì đổ cho nguồn. */
    const detail = error instanceof StParseError ? `${error.message} (dòng ${error.line})` : String(error)
    return { ok: false, reason: `Bản định dạng không đọc lại được — lỗi của formatter: ${detail}`, line: null }
  }

  if (JSON.stringify(semanticUnit(unit)) !== JSON.stringify(semanticUnit(reparsed))) {
    return {
      ok: false,
      reason: 'Cây cú pháp sau khi định dạng KHÁC cây trước — đã huỷ, không đổi mã nguồn.',
      line: null,
    }
  }
  const before = commentSequence(unit)
  const after = commentSequence(reparsed)
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    return {
      ok: false,
      reason: `Chú thích bị đổi khi định dạng (${before.length} → ${after.length}) — đã huỷ, không đổi mã nguồn.`,
      line: null,
    }
  }

  return { ok: true, text, changed: text !== source }
}

export interface StRangeFormatResult {
  result: StFormatResult
  /** Vùng chọn MỚI sau khi thay, để con trỏ không nhảy đi chỗ khác. */
  selectionStart: number
  selectionEnd: number
}

/**
 * Định dạng VÙNG CHỌN.
 *
 * Cách làm: format cả tài liệu rồi chỉ lấy lại phần dòng tương ứng — KHÔNG parse
 * riêng đoạn chọn. Một đoạn cắt giữa `IF ... END_IF` không phải một chương trình
 * hợp lệ, nên parse riêng nó sẽ luôn hỏng; còn thụt lề đúng của đoạn đó chỉ
 * biết được khi biết nó nằm trong khối nào.
 *
 * Ánh xạ theo SỐ DÒNG: dòng thứ n của bản gốc tương ứng dòng thứ n của bản
 * format chỉ khi số dòng không đổi — nên khi số dòng đổi, hàm này format cả tài
 * liệu và nói rõ điều đó qua `selectionStart/End` bao trọn tài liệu.
 */
export function formatStRange(source: string, start: number, end: number): StRangeFormatResult {
  const result = formatStDocument(source)
  if (!result.ok) return { result, selectionStart: start, selectionEnd: end }

  const originalLines = source.split('\n')
  const formattedLines = result.text.split('\n')
  const startLine = source.slice(0, start).split('\n').length - 1
  const endLine = source.slice(0, end).split('\n').length - 1

  if (originalLines.length !== formattedLines.length) {
    return { result, selectionStart: 0, selectionEnd: result.text.length }
  }

  const head = originalLines.slice(0, startLine)
  const middle = formattedLines.slice(startLine, endLine + 1)
  const tail = originalLines.slice(endLine + 1)
  const merged = [...head, ...middle, ...tail].join('\n')
  const offsetStart = head.join('\n').length + (head.length > 0 ? 1 : 0)
  const offsetEnd = offsetStart + middle.join('\n').length
  return {
    result: { ok: true, text: merged, changed: merged !== source },
    selectionStart: offsetStart,
    selectionEnd: offsetEnd,
  }
}

export { StParseError }
