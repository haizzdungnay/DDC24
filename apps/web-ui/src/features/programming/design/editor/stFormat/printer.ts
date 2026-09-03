import type {
  StArg, StCaseBranch, StComment, StExpr, StPou, StStmt, StTrivia, StUnit, StVarBlock, StVarDecl,
} from './ast'

/**
 * `DEV-PROG-019` — in lại cây ST theo **DDC-24 ST Coding Style**.
 *
 * ```text
 * Indent               = 4 spaces (không Tab)
 * Max line             = 120
 * Keyword case         = UPPERCASE
 * Identifier case      = GIỮ NGUYÊN
 * FB parameters        = xuống dòng khi dài, căn `:=`
 * Boolean dài          = mỗi điều kiện một dòng
 * Blank lines          = chuẩn hoá còn tối đa 1
 * Semantic changes     = NEVER
 * ```
 *
 * Bộ in này **không bao giờ** thêm/bớt ngoặc, đảo thứ tự, hay đổi literal: nó
 * chỉ đi trên cây mà parser đã dựng. Mọi phép "làm cho dễ đọc hơn" đụng tới
 * ngữ nghĩa (ví dụ `A OR B AND C` → `(A OR B) AND C`) là việc của Kiểm tra
 * cảnh báo, không phải của formatter sửa.
 */

export const ST_INDENT = '    '
export const ST_MAX_LINE = 120

/** Tên kiểu chuẩn được viết hoa; kiểu do người dùng đặt GIỮ NGUYÊN. */
const STANDARD_TYPES = new Set([
  'BOOL', 'BYTE', 'WORD', 'DWORD', 'LWORD', 'SINT', 'INT', 'DINT', 'LINT',
  'USINT', 'UINT', 'UDINT', 'ULINT', 'REAL', 'LREAL', 'TIME', 'LTIME',
  'DATE', 'TIME_OF_DAY', 'DATE_AND_TIME', 'STRING', 'WSTRING',
  'TON', 'TOF', 'TP', 'R_TRIG', 'F_TRIG', 'CTU', 'CTD', 'CTUD',
])

class Printer {
  private readonly lines: string[] = []

  emit(indent: number, text: string): void {
    this.lines.push(text.length === 0 ? '' : ST_INDENT.repeat(indent) + text)
  }

  /** Nối chú thích vào cuối dòng ĐÃ in gần nhất. */
  appendToLast(text: string): void {
    if (this.lines.length === 0) return
    if (this.lines[this.lines.length - 1].endsWith(text)) return
    this.lines[this.lines.length - 1] += `  ${text}`
  }

  blank(): void {
    // Không mở đầu bằng dòng trống, và không bao giờ hai dòng trống liền nhau:
    // "Multiple blank lines → thu về tối đa 1".
    if (this.lines.length === 0) return
    if (this.lines[this.lines.length - 1] === '') return
    this.lines.push('')
  }

  text(): string {
    while (this.lines.length > 0 && this.lines[this.lines.length - 1] === '') this.lines.pop()
    return this.lines.length === 0 ? '' : `${this.lines.join('\n')}\n`
  }
}

function printComments(out: Printer, indent: number, comments: readonly StComment[], allowBlank: boolean): void {
  for (const comment of comments) {
    if (allowBlank && comment.blankBefore) out.blank()
    // Chú thích khối nhiều dòng: chỉ thụt lề DÒNG ĐẦU. Thụt lề các dòng sau sẽ
    // đổi nội dung chú thích — bảng vẽ ASCII và khối chữ căn tay sẽ vỡ.
    out.emit(indent, comment.text)
  }
}

function withTrailing(text: string, trivia: StTrivia): string {
  return trivia.trailing ? `${text}  ${trivia.trailing}` : text
}

/* ---------- biểu thức ---------- */

/** Bề rộng của biểu thức khi in trên MỘT dòng. */
export function flatExpr(node: StExpr): string {
  switch (node.kind) {
    case 'Literal': return node.text
    case 'Ident': return node.name
    case 'Member': return `${flatExpr(node.object)}.${node.name}`
    case 'Paren': return `(${flatExpr(node.inner)})`
    case 'Unary': return node.operator === 'NOT' ? `NOT ${flatExpr(node.operand)}` : `-${flatExpr(node.operand)}`
    case 'Binary': return `${flatExpr(node.left)} ${node.operator} ${flatExpr(node.right)}`
    case 'Call': return `${flatExpr(node.callee)}(${node.args.map(flatArg).join(', ')})`
  }
}

function flatArg(arg: StArg): string {
  if (!arg.name) return flatExpr(arg.value)
  return `${arg.name} ${arg.output ? '=>' : ':='} ${flatExpr(arg.value)}`
}

/** Toán tử luận lý — chỉ những mức này mới được tách dòng khi câu quá dài. */
const SPLITTABLE = new Set(['OR', 'XOR', 'AND', '&'])

/**
 * Chuỗi toán hạng của một dãy toán tử CÙNG mức, theo đúng thứ tự nguồn.
 *
 * `A AND B AND C` cho ra ba toán hạng chứ không phải cây lồng hai tầng — nếu
 * không, câu điều kiện dài sẽ in thành bậc thang lệch dần thay vì một danh
 * sách phẳng đọc được.
 */
function chainOf(node: StExpr, operator: string): StExpr[] {
  if (node.kind === 'Binary' && node.operator === operator) {
    return [...chainOf(node.left, operator), node.right]
  }
  return [node]
}

/**
 * In một biểu thức, xuống dòng khi vượt `ST_MAX_LINE`.
 *
 * Trả về mảng dòng ĐÃ thụt lề. Dòng đầu KHÔNG mang tiền tố của người gọi —
 * người gọi tự ghép (`X :=` hoặc `IF `).
 */
function printExpr(node: StExpr, indent: number, firstLineUsed: number): string[] {
  const flat = flatExpr(node)
  if (firstLineUsed + flat.length <= ST_MAX_LINE) return [flat]

  if (node.kind === 'Paren') {
    const inner = printExpr(node.inner, indent + 1, ST_INDENT.length * (indent + 1))
    if (inner.length === 1) return [`(${inner[0]})`]
    return ['(', ...inner.map((line) => ST_INDENT + line), ')']
  }

  if (node.kind === 'Binary' && SPLITTABLE.has(node.operator)) {
    const operands = chainOf(node, node.operator)
    const out: string[] = []
    operands.forEach((operand, position) => {
      const prefix = position === 0 ? '' : `${node.operator} `
      const printed = printExpr(operand, indent, ST_INDENT.length * indent + prefix.length)
      printed.forEach((line, lineIndex) => out.push(lineIndex === 0 ? `${prefix}${line}` : line))
    })
    return out
  }

  if (node.kind === 'Call') {
    return printCallLines(flatExpr(node.callee), node.args, indent)
  }

  /* Không tách được (một lời gọi hàm dài, một phép so sánh dài): in một dòng và
   * để nó dài. Cắt bừa một biểu thức số học ở chỗ không có nghĩa làm nó KHÓ đọc
   * hơn, mà `Max line` là hướng dẫn trình bày chứ không phải bất biến. */
  return [flat]
}

/**
 * Lời gọi in nhiều dòng, `:=` được CĂN CỘT.
 *
 * Căn cột là lựa chọn có chủ ý cho ST: FB automation thường có 10–30 I/O, và
 * một cột `:=` thẳng hàng cho phép đọc lướt danh sách tham số theo chiều dọc.
 */
function printCallLines(callee: string, args: readonly StArg[], indent: number): string[] {
  if (args.length === 0) return [`${callee}()`]
  const named = args.filter((arg) => arg.name !== null)
  const width = named.length === args.length
    ? Math.max(...named.map((arg) => (arg.name as string).length))
    : 0
  const lines: string[] = [`${callee}(`]
  args.forEach((arg, position) => {
    const comma = position === args.length - 1 ? '' : ','
    if (arg.name === null) {
      lines.push(`${ST_INDENT}${flatExpr(arg.value)}${comma}`)
      return
    }
    const label = width > 0 ? arg.name.padEnd(width) : arg.name
    const head = `${label} ${arg.output ? '=>' : ':='} `
    const printed = printExpr(arg.value, indent + 1, ST_INDENT.length * (indent + 1) + head.length)
    printed.forEach((line, lineIndex) => {
      lines.push(lineIndex === 0 ? `${ST_INDENT}${head}${line}` : `${ST_INDENT}${line}`)
    })
    lines[lines.length - 1] += comma
  })
  lines.push(')')
  return lines
}

function emitExpr(out: Printer, indent: number, prefix: string, node: StExpr, suffix: string): void {
  const used = ST_INDENT.length * indent + prefix.length
  const printed = printExpr(node, indent, used)
  if (printed.length === 1) {
    out.emit(indent, `${prefix}${printed[0]}${suffix}`)
    return
  }
  /* Gán DÀI xuống dòng SAU `:=` (đúng bảng quy tắc), rồi thân biểu thức thụt
   * thêm một cấp. Giữ toán hạng đầu trên cùng dòng với `:=` sẽ làm mọi dòng sau
   * lệch một khoảng bằng độ dài tên biến — mỗi biến một kiểu lệch. */
  if (prefix.trimEnd().endsWith(':=')) {
    out.emit(indent, prefix.trimEnd())
    printed.forEach((line, position) => {
      out.emit(indent + 1, position === printed.length - 1 ? `${line}${suffix}` : line)
    })
    return
  }
  printed.forEach((line, position) => {
    const text = position === 0 ? `${prefix}${line}` : line
    out.emit(indent, position === printed.length - 1 ? `${text}${suffix}` : text)
  })
}

/* ---------- khai báo ---------- */

function declText(decl: StVarDecl, nameWidth: number): string {
  const names = decl.names.join(', ')
  const typeName = STANDARD_TYPES.has(decl.typeName.toUpperCase()) ? decl.typeName.toUpperCase() : decl.typeName
  const suffix = decl.typeSuffix ? ` ${decl.typeSuffix}` : ''
  const initial = decl.initial ? ` := ${flatExpr(decl.initial)}` : ''
  return `${names.padEnd(nameWidth)} : ${typeName}${suffix}${initial};`
}

function printVarBlock(out: Printer, indent: number, block: StVarBlock): void {
  printComments(out, indent, block.trivia.leading, true)
  if (block.trivia.blankBefore) out.blank()
  out.emit(indent, withTrailing(block.keywords.join(' '), block.trivia))

  /* Căn cột `:` theo từng CỤM khai báo liền nhau. Cắt cụm ở dòng trống hoặc ở
   * chú thích riêng dòng: căn cả khối theo tên dài nhất sẽ đẩy mọi khai báo
   * ngắn ra xa, và một khối 60 biến chỉ cần một tên 30 ký tự là hỏng. */
  let run: StVarDecl[] = []
  const flushRun = () => {
    if (run.length === 0) return
    const width = Math.max(...run.map((decl) => decl.names.join(', ').length))
    for (const decl of run) out.emit(indent + 1, withTrailing(declText(decl, width), decl.trivia))
    run = []
  }
  for (const decl of block.decls) {
    if (decl.trivia.blankBefore || decl.trivia.leading.length > 0) {
      flushRun()
      if (decl.trivia.blankBefore) out.blank()
      printComments(out, indent + 1, decl.trivia.leading, false)
    }
    run.push(decl)
  }
  flushRun()

  printComments(out, indent + 1, block.endTrivia.leading, true)
  out.emit(indent, withTrailing('END_VAR', block.endTrivia))
}

/* ---------- câu lệnh ---------- */

function printBody(out: Printer, indent: number, body: readonly StStmt[]): void {
  for (const statement of body) printStatement(out, indent, statement)
}

function printStatement(out: Printer, indent: number, statement: StStmt): void {
  const trivia = statement.trivia
  if (trivia.blankBefore) out.blank()
  printComments(out, indent, trivia.leading, false)

  switch (statement.kind) {
    case 'Assign': {
      const target = flatExpr(statement.target)
      emitExpr(out, indent, `${target} := `, statement.value, ';')
      appendTrailing(out, trivia)
      return
    }
    case 'CallStmt': {
      const callee = flatExpr(statement.callee)
      const flat = `${callee}(${statement.args.map(flatArg).join(', ')});`
      if (ST_INDENT.length * indent + flat.length <= ST_MAX_LINE) {
        out.emit(indent, withTrailing(flat, trivia))
        return
      }
      const lines = printCallLines(callee, statement.args, indent)
      lines.forEach((line, position) => {
        out.emit(indent, position === lines.length - 1 ? `${line};` : line)
      })
      appendTrailing(out, trivia)
      return
    }
    case 'If': {
      statement.branches.forEach((branch, position) => {
        if (position > 0) {
          if (branch.trivia.blankBefore) out.blank()
          printComments(out, indent, branch.trivia.leading, false)
        }
        emitExpr(out, indent, position === 0 ? 'IF ' : 'ELSIF ', branch.condition, ' THEN')
        appendTrailing(out, branch.trivia)
        printBody(out, indent + 1, branch.body)
      })
      if (statement.elseBody) {
        printComments(out, indent, statement.elseTrivia.leading, false)
        out.emit(indent, withTrailing('ELSE', statement.elseTrivia))
        printBody(out, indent + 1, statement.elseBody)
      }
      printComments(out, indent, statement.endTrivia.leading, false)
      // `END_IF;` LUÔN cùng một dòng — dấu `;` không bao giờ đứng riêng.
      out.emit(indent, withTrailing('END_IF;', statement.endTrivia))
      return
    }
    case 'Case': {
      emitExpr(out, indent, 'CASE ', statement.selector, ' OF')
      appendTrailing(out, trivia)
      statement.branches.forEach((branch) => printCaseBranch(out, indent, branch))
      if (statement.elseBody) {
        out.blank()
        printComments(out, indent + 1, statement.elseTrivia.leading, false)
        out.emit(indent + 1, withTrailing('ELSE', statement.elseTrivia))
        printBody(out, indent + 2, statement.elseBody)
      }
      out.blank()
      printComments(out, indent, statement.endTrivia.leading, false)
      out.emit(indent, withTrailing('END_CASE;', statement.endTrivia))
      return
    }
  }
}

/**
 * Chú thích cuối dòng của một câu lệnh ĐÃ in nhiều dòng.
 *
 * Nó đi vào cuối dòng CUỐI, không phải dòng đầu: dòng đầu của một lời gọi nhiều
 * dòng chỉ là `fbFanPI(`, và treo chú thích ở đó khiến nó trông như nói về tên
 * hàm chứ không về cả lời gọi.
 */
function appendTrailing(out: Printer, trivia: StTrivia): void {
  if (trivia.trailing) out.appendToLast(trivia.trailing)
}

function printCaseBranch(out: Printer, indent: number, branch: StCaseBranch): void {
  out.blank()
  printComments(out, indent + 1, branch.trivia.leading, false)
  out.emit(indent + 1, withTrailing(`${branch.labels.join(', ')}:`, branch.trivia))
  printBody(out, indent + 2, branch.body)
}

/* ---------- đơn vị ---------- */

function printPou(out: Printer, pou: StPou): void {
  printComments(out, 0, pou.trivia.leading, true)
  const returnType = pou.returnType ? ` : ${pou.returnType}` : ''
  out.emit(0, withTrailing(`${pou.keyword} ${pou.name}${returnType}`, pou.trivia))
  for (const block of pou.varBlocks) printVarBlock(out, 1, block)
  if (pou.varBlocks.length > 0 && pou.body.length > 0) out.blank()
  printBody(out, 1, pou.body)
  printComments(out, 0, pou.endTrivia.leading, true)
  out.emit(0, withTrailing(pou.keyword === 'PROGRAM' ? 'END_PROGRAM' : `END_${pou.keyword}`, pou.endTrivia))
}

export function printSt(unit: StUnit): string {
  const out = new Printer()
  unit.pous.forEach((pou, position) => {
    if (position > 0) out.blank()
    printPou(out, pou)
  })
  for (const comment of unit.trailingComments) {
    if (comment.blankBefore) out.blank()
    out.emit(0, comment.text)
  }
  return out.text()
}
