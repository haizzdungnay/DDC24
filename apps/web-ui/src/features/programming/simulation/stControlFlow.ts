/**
 * Trình phân tích luồng điều khiển và đánh giá điều kiện chạy của mã ST
 * (IEC 61131-3 Structured Text) trong chế độ Gỡ lỗi (Debug Mode).
 *
 * Thiết kế bằng TypeScript native Tokenizer & AST/Statement Parser:
 * - Hỗ trợ chuẩn xác Single-line IF, Multi-line IF/ELSIF/ELSE, lồng nhau đa cấp.
 * - Hỗ trợ CASE OF với nhãn số, danh sách nhãn, dải nhãn (1..5), và nhãn cùng dòng với lệnh.
 * - Hỗ trợ gán và gọi hàm/FB nhiều dòng (executable line range bao phủ toàn bộ lệnh).
 * - Đánh giá biểu thức ST (evaluateStExpression) với phân biệt Bitwise (&, |, ~) vs Boolean.
 * - Hỗ trợ hằng thời gian T#..., hàm SEL/LIMIT lồng nhau, và các hàm chuẩn/người dùng.
 * - Trích xuất Function/FB Call và thuộc tính FB cho giao diện Debugger.
 */

// ============================================================================
// 1. Types & Interfaces
// ============================================================================

export type StTokenType =
  | 'KEYWORD'
  | 'IDENTIFIER'
  | 'NUMBER'
  | 'TIME'
  | 'STRING'
  | 'OPERATOR'
  | 'PUNCTUATION'
  | 'EOF'

export interface StToken {
  type: StTokenType
  value: string
  line: number // 0-based index
  col: number
  endLine: number
  endCol: number
}

export interface StBaseStatement {
  startLine: number
  endLine: number
}

export interface StIfStatement extends StBaseStatement {
  kind: 'if'
  condition: string
  condStartLine: number
  condEndLine: number
  thenStatements: StStatement[]
  elsifBranches: Array<{
    condition: string
    condStartLine: number
    condEndLine: number
    statements: StStatement[]
    startLine: number
    endLine: number
  }>
  elseBranch?: {
    line: number
    statements: StStatement[]
    endLine: number
  }
}

export interface StCaseLabel {
  type: 'single' | 'range' | 'else'
  value?: number | string
  min?: number
  max?: number
  raw: string
}

export interface StCaseBranch {
  labels: StCaseLabel[]
  labelStartLine: number
  labelEndLine: number
  statements: StStatement[]
  startLine: number
  endLine: number
}

export interface StCaseStatement extends StBaseStatement {
  kind: 'case'
  selector: string
  selectorStartLine: number
  selectorEndLine: number
  branches: StCaseBranch[]
  elseBranch?: {
    line: number
    statements: StStatement[]
    endLine: number
  }
}

export interface StCallArg {
  name?: string
  value: string
}

export interface StCallInfo {
  name: string
  args: StCallArg[]
  targetVar?: string
  line: number
  isFb: boolean
}

export interface StAssignmentStatement extends StBaseStatement {
  kind: 'assignment'
  target: string
  value: string
  call?: StCallInfo
}

export interface StCallStatement extends StBaseStatement {
  kind: 'call'
  callee: string
  args: StCallArg[]
  raw: string
}

export interface StSimpleStatement extends StBaseStatement {
  kind: 'simple'
  raw: string
}

export type StStatement =
  | StIfStatement
  | StCaseStatement
  | StAssignmentStatement
  | StCallStatement
  | StSimpleStatement

export interface StAssignmentInfo {
  target: string
  value: string
  line: number
  endLine: number
}

export interface StMemberAccessInfo {
  object: string
  member: string
  full: string
  line: number
}

export interface StLineExpressions {
  line: number
  assignments: StAssignmentInfo[]
  calls: StCallInfo[]
  memberAccesses: StMemberAccessInfo[]
  identifiers: string[]
}

// ============================================================================
// 2. Constants & Standard Function/FB Sets
// ============================================================================

const ST_KEYWORDS = new Set([
  'IF', 'THEN', 'ELSIF', 'ELSE', 'END_IF',
  'CASE', 'OF', 'END_CASE',
  'FOR', 'TO', 'BY', 'DO', 'END_FOR',
  'WHILE', 'END_WHILE',
  'REPEAT', 'UNTIL', 'END_REPEAT',
  'PROGRAM', 'END_PROGRAM',
  'FUNCTION', 'END_FUNCTION',
  'FUNCTION_BLOCK', 'END_FUNCTION_BLOCK',
  'VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_TEMP', 'VAR_GLOBAL', 'VAR_EXTERNAL',
  'VAR_RETAIN', 'VAR_CONSTANT', 'RETAIN', 'CONSTANT', 'END_VAR',
  'AND', 'OR', 'XOR', 'NOT', 'MOD',
  'TRUE', 'FALSE',
  'RETURN', 'EXIT',
])

const KNOWN_IEC_FBS = new Set([
  'TON', 'TOF', 'TP', 'R_TRIG', 'F_TRIG', 'CTU', 'CTD', 'CTUD',
  'PID', 'HYSTERESIS', 'SCALE', 'DEADBAND',
])

const BUILTIN_CONSTANTS: Record<string, number> = {
  MASK_ODD: 21845,
  MASK_EVEN: 43690,
  MASK_LOW_NIBBLES: 3855,
  MASK_HIGH_NIBBLES: 61680,
}

// ============================================================================
// 3. Time & Number Helpers
// ============================================================================

export function parseTimeToMs(s: string): number {
  if (!s) return 0
  const clean = s.trim()
  const m = clean.match(/(?:T|TIME)#(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+)s)?(?:(\d+)ms)?/i)
  if (!m) return 0
  const d = parseInt(m[1] || '0', 10)
  const h = parseInt(m[2] || '0', 10)
  const min = parseInt(m[3] || '0', 10)
  const sec = parseInt(m[4] || '0', 10)
  const ms = parseInt(m[5] || '0', 10)
  return (d * 86400 + h * 3600 + min * 60 + sec) * 1000 + ms
}

function parseNumberLiteral(s: string): number {
  if (s.startsWith('16#') || s.startsWith('16#')) {
    return parseInt(s.slice(3).replace(/_/g, ''), 16)
  }
  if (s.startsWith('2#')) {
    return parseInt(s.slice(2).replace(/_/g, ''), 2)
  }
  return Number(s.replace(/_/g, ''))
}

// ============================================================================
// 4. Tokenizer
// ============================================================================

export function tokenizeSt(source: string): StToken[] {
  const tokens: StToken[] = []
  let i = 0
  const len = source.length
  let line = 0
  let col = 0

  while (i < len) {
    const c = source[i]
    const next = i + 1 < len ? source[i + 1] : ''

    // 1. Whitespace
    if (c === '\r') {
      i++
      col++
      continue
    }
    if (c === '\n') {
      i++
      line++
      col = 0
      continue
    }
    if (c === ' ' || c === '\t') {
      i++
      col++
      continue
    }

    // 2. Comments
    if (c === '(' && next === '*') {
      let depth = 1
      i += 2
      col += 2
      while (i < len && depth > 0) {
        if (source[i] === '(' && source[i + 1] === '*') {
          depth++
          i += 2
          col += 2
        } else if (source[i] === '*' && source[i + 1] === ')') {
          depth--
          i += 2
          col += 2
        } else if (source[i] === '\n') {
          line++
          col = 0
          i++
        } else {
          col++
          i++
        }
      }
      continue
    }

    if (c === '/' && next === '/') {
      i += 2
      col += 2
      while (i < len && source[i] !== '\n') {
        i++
        col++
      }
      continue
    }

    // 3. String literal
    if (c === "'") {
      const startLine = line
      const startCol = col
      let strVal = ''
      i++
      col++
      while (i < len) {
        if (source[i] === "'" && source[i + 1] === "'") {
          strVal += "'"
          i += 2
          col += 2
        } else if (source[i] === "'") {
          i++
          col++
          break
        } else if (source[i] === '\n') {
          strVal += '\n'
          line++
          col = 0
          i++
        } else {
          strVal += source[i]
          col++
          i++
        }
      }
      tokens.push({
        type: 'STRING',
        value: strVal,
        line: startLine,
        col: startCol,
        endLine: line,
        endCol: col,
      })
      continue
    }

    // 4. Time literal (T#... or TIME#...)
    const rest = source.slice(i)
    const timeMatch = rest.match(/^(?:T|TIME)#[0-9a-zA-Z_]+/i)
    if (timeMatch) {
      const matchStr = timeMatch[0]
      tokens.push({
        type: 'TIME',
        value: matchStr,
        line,
        col,
        endLine: line,
        endCol: col + matchStr.length,
      })
      i += matchStr.length
      col += matchStr.length
      continue
    }

    // 5. Numbers (16#..., 2#..., or decimal/float, handling 1..5 range correctly)
    const hexOrBinMatch = rest.match(/^(?:16#[0-9a-fA-F_]+|2#[01_]+)/i)
    if (hexOrBinMatch) {
      const matchStr = hexOrBinMatch[0]
      tokens.push({
        type: 'NUMBER',
        value: matchStr,
        line,
        col,
        endLine: line,
        endCol: col + matchStr.length,
      })
      i += matchStr.length
      col += matchStr.length
      continue
    }

    if (/[0-9]/.test(c)) {
      const startCol = col
      let numStr = ''
      while (i < len && /[0-9_]/.test(source[i])) {
        numStr += source[i]
        i++
        col++
      }
      if (i < len && source[i] === '.' && source[i + 1] !== '.') {
        numStr += '.'
        i++
        col++
        while (i < len && /[0-9_]/.test(source[i])) {
          numStr += source[i]
          i++
          col++
        }
      }
      if (i < len && (source[i] === 'e' || source[i] === 'E')) {
        let expStr = source[i]
        let tempI = i + 1
        if (source[tempI] === '+' || source[tempI] === '-') {
          expStr += source[tempI]
          tempI++
        }
        if (tempI < len && /[0-9]/.test(source[tempI])) {
          while (tempI < len && /[0-9]/.test(source[tempI])) {
            expStr += source[tempI]
            tempI++
          }
          i = tempI
          col += expStr.length
          numStr += expStr
        }
      }
      tokens.push({
        type: 'NUMBER',
        value: numStr,
        line,
        col: startCol,
        endLine: line,
        endCol: col,
      })
      continue
    }

    // 6. Two-character operators & punctuation
    if (c === ':' && next === '=') {
      tokens.push({ type: 'OPERATOR', value: ':=', line, col, endLine: line, endCol: col + 2 })
      i += 2
      col += 2
      continue
    }
    if (c === '<' && next === '=') {
      tokens.push({ type: 'OPERATOR', value: '<=', line, col, endLine: line, endCol: col + 2 })
      i += 2
      col += 2
      continue
    }
    if (c === '>' && next === '=') {
      tokens.push({ type: 'OPERATOR', value: '>=', line, col, endLine: line, endCol: col + 2 })
      i += 2
      col += 2
      continue
    }
    if (c === '<' && next === '>') {
      tokens.push({ type: 'OPERATOR', value: '<>', line, col, endLine: line, endCol: col + 2 })
      i += 2
      col += 2
      continue
    }
    if (c === '.' && next === '.') {
      tokens.push({ type: 'OPERATOR', value: '..', line, col, endLine: line, endCol: col + 2 })
      i += 2
      col += 2
      continue
    }

    // 7. Single-character operators & punctuation
    if ('=<>+-*/&'.includes(c)) {
      tokens.push({ type: 'OPERATOR', value: c, line, col, endLine: line, endCol: col + 1 })
      i++
      col++
      continue
    }

    if (';:(),[].'.includes(c)) {
      tokens.push({ type: 'PUNCTUATION', value: c, line, col, endLine: line, endCol: col + 1 })
      i++
      col++
      continue
    }

    // 8. Identifiers & Keywords
    if (/[A-Za-z_]/.test(c)) {
      const startCol = col
      let ident = ''
      while (i < len && /[A-Za-z0-9_]/.test(source[i])) {
        ident += source[i]
        i++
        col++
      }
      const upper = ident.toUpperCase()
      const isKeyword = ST_KEYWORDS.has(upper)
      tokens.push({
        type: isKeyword ? 'KEYWORD' : 'IDENTIFIER',
        value: ident,
        line,
        col: startCol,
        endLine: line,
        endCol: col,
      })
      continue
    }

    // Unknown char, advance
    i++
    col++
  }

  tokens.push({
    type: 'EOF',
    value: '',
    line,
    col,
    endLine: line,
    endCol: col,
  })

  return tokens
}

// ============================================================================
// 5. Expression Parser & Evaluator (Bitwise vs Boolean)
// ============================================================================

class ExprParser {
  private tokens: StToken[]
  private lookupVar: (name: string) => unknown
  private pos = 0

  constructor(
    tokens: StToken[],
    lookupVar: (name: string) => unknown,
  ) {
    this.tokens = tokens
    this.lookupVar = lookupVar
  }

  private peek(): StToken {
    return this.tokens[this.pos] || { type: 'EOF', value: '', line: 0, col: 0, endLine: 0, endCol: 0 }
  }

  private next(): StToken {
    const t = this.peek()
    if (this.pos < this.tokens.length) this.pos++
    return t
  }

  parse(): unknown {
    if (this.peek().type === 'EOF') return null
    return this.parseOr()
  }

  private parseOr(): unknown {
    let left = this.parseAnd()
    while (true) {
      const t = this.peek()
      const upper = t.value.toUpperCase()
      if (t.type === 'KEYWORD' && (upper === 'OR' || upper === 'XOR')) {
        this.next()
        const right = this.parseAnd()
        if (upper === 'XOR') {
          if (typeof left === 'number' && typeof right === 'number') {
            left = (left ^ right) & 0xFFFF
          } else {
            left = Boolean(left) !== Boolean(right)
          }
        } else {
          if (typeof left === 'number' && typeof right === 'number') {
            left = (left | right) & 0xFFFF
          } else {
            left = Boolean(left) || Boolean(right)
          }
        }
      } else {
        break
      }
    }
    return left
  }

  private parseAnd(): unknown {
    let left = this.parseEquality()
    while (true) {
      const t = this.peek()
      const upper = t.value.toUpperCase()
      if ((t.type === 'KEYWORD' && upper === 'AND') || (t.type === 'OPERATOR' && t.value === '&')) {
        this.next()
        const right = this.parseEquality()
        if (typeof left === 'number' && typeof right === 'number') {
          left = (left & right) & 0xFFFF
        } else {
          left = Boolean(left) && Boolean(right)
        }
      } else {
        break
      }
    }
    return left
  }

  private parseEquality(): unknown {
    let left = this.parseRelational()
    while (true) {
      const t = this.peek()
      if (t.type === 'OPERATOR' && (t.value === '=' || t.value === '<>')) {
        const op = this.next().value
        const right = this.parseRelational()
        const eq = this.compareEqual(left, right)
        left = op === '=' ? eq : !eq
      } else {
        break
      }
    }
    return left
  }

  private compareEqual(a: unknown, b: unknown): boolean {
    if (typeof a === 'boolean' || typeof b === 'boolean') {
      return Boolean(a) === Boolean(b)
    }
    if (typeof a === 'number' || typeof b === 'number') {
      return Number(a) === Number(b)
    }
    return String(a).toLowerCase() === String(b).toLowerCase()
  }

  private parseRelational(): unknown {
    let left = this.parseAdditive()
    while (true) {
      const t = this.peek()
      if (t.type === 'OPERATOR' && ['<', '<=', '>', '>='].includes(t.value)) {
        const op = this.next().value
        const right = this.parseAdditive()
        const lNum = Number(left)
        const rNum = Number(right)
        if (op === '<') left = lNum < rNum
        else if (op === '<=') left = lNum <= rNum
        else if (op === '>') left = lNum > rNum
        else if (op === '>=') left = lNum >= rNum
      } else {
        break
      }
    }
    return left
  }

  private parseAdditive(): unknown {
    let left = this.parseMultiplicative()
    while (true) {
      const t = this.peek()
      if (t.type === 'OPERATOR' && (t.value === '+' || t.value === '-')) {
        const op = this.next().value
        const right = this.parseMultiplicative()
        if (op === '+') {
          if (typeof left === 'string' || typeof right === 'string') {
            left = String(left) + String(right)
          } else {
            left = Number(left) + Number(right)
          }
        } else {
          left = Number(left) - Number(right)
        }
      } else {
        break
      }
    }
    return left
  }

  private parseMultiplicative(): unknown {
    let left = this.parseUnary()
    while (true) {
      const t = this.peek()
      const upper = t.value.toUpperCase()
      if (t.type === 'OPERATOR' && (t.value === '*' || t.value === '/')) {
        const op = this.next().value
        const right = this.parseUnary()
        left = op === '*' ? Number(left) * Number(right) : Number(left) / Number(right)
      } else if (t.type === 'KEYWORD' && upper === 'MOD') {
        this.next()
        const right = this.parseUnary()
        left = Number(left) % Number(right)
      } else {
        break
      }
    }
    return left
  }

  private parseUnary(): unknown {
    const t = this.peek()
    const upper = t.value.toUpperCase()
    if (t.type === 'KEYWORD' && upper === 'NOT') {
      this.next()
      const operand = this.parseUnary()
      if (typeof operand === 'number') {
        return (~operand) & 0xFFFF
      }
      return !Boolean(operand)
    }
    if (t.type === 'OPERATOR' && t.value === '-') {
      this.next()
      return -Number(this.parseUnary())
    }
    if (t.type === 'OPERATOR' && t.value === '+') {
      this.next()
      return Number(this.parseUnary())
    }
    return this.parsePrimary()
  }

  private parsePrimary(): unknown {
    const t = this.peek()

    if (t.type === 'PUNCTUATION' && t.value === '(') {
      this.next()
      const val = this.parseOr()
      if (this.peek().value === ')') this.next()
      return val
    }

    if (t.type === 'NUMBER') {
      this.next()
      return parseNumberLiteral(t.value)
    }

    if (t.type === 'TIME') {
      this.next()
      return parseTimeToMs(t.value)
    }

    if (t.type === 'STRING') {
      this.next()
      return t.value
    }

    if (t.type === 'KEYWORD') {
      const upper = t.value.toUpperCase()
      if (upper === 'TRUE') {
        this.next()
        return true
      }
      if (upper === 'FALSE') {
        this.next()
        return false
      }
    }

    if (t.type === 'IDENTIFIER' || t.type === 'KEYWORD') {
      let name = this.next().value
      // Collect dotted access (e.g. AutoTmr.ET, PermitLost.Q, Ch01.Waiting)
      while (this.peek().value === '.' && this.tokens[this.pos + 1]?.type === 'IDENTIFIER') {
        this.next() // consume '.'
        name += '.' + this.next().value
      }

      // Check if function call
      if (this.peek().value === '(') {
        this.next() // consume '('
        const args: unknown[] = []
        if (this.peek().value !== ')') {
          while (true) {
            args.push(this.parseOr())
            if (this.peek().value === ',') {
              this.next()
            } else {
              break
            }
          }
        }
        if (this.peek().value === ')') this.next()
        return this.callFunction(name, args)
      }

      // Identifier variable lookup
      return this.resolveIdentifier(name)
    }

    // Fallback
    this.next()
    return null
  }

  private resolveIdentifier(name: string): unknown {
    const upper = name.toUpperCase()
    if (upper in BUILTIN_CONSTANTS) {
      return BUILTIN_CONSTANTS[upper]
    }
    const raw = this.lookupVar(name)
    if (raw === undefined || raw === null) return 0
    if (typeof raw === 'boolean') return raw
    if (typeof raw === 'number') return isFinite(raw) ? raw : 0
    const s = String(raw).trim()
    const sUpper = s.toUpperCase()
    if (sUpper === 'TRUE') return true
    if (sUpper === 'FALSE') return false
    if (/^(?:T|TIME)#[0-9a-zA-Z_]+$/i.test(s)) return parseTimeToMs(s)
    if (!isNaN(Number(s)) && s !== '') return Number(s)
    return s
  }

  private callFunction(name: string, args: unknown[]): unknown {
    const upper = name.toUpperCase()
    switch (upper) {
      case 'SEL': {
        const g = Boolean(args[0])
        return g ? args[2] : args[1]
      }
      case 'LIMIT': {
        const min = Number(args[0])
        const val = Number(args[1])
        const max = Number(args[2])
        return Math.min(Math.max(val, min), max)
      }
      case 'MIN':
        return Math.min(Number(args[0]), Number(args[1]))
      case 'MAX':
        return Math.max(Number(args[0]), Number(args[1]))
      case 'ABS':
        return Math.abs(Number(args[0]))
      case 'SQRT':
        return Math.sqrt(Number(args[0]))
      case 'FN_FIRST_N': {
        const n = Number(args[0]) || 0
        if (n <= 0) return 0
        if (n >= 16) return 65535
        return (1 << n) - 1
      }
      case 'FN_ONE_HOT': {
        const n = Number(args[0]) || 0
        if (n >= 1 && n <= 16) return 1 << (n - 1)
        return 0
      }
      case 'FN_NEXT_STEP': {
        const curr = Number(args[0]) || 1
        const maxSteps = Number(args[1]) || 16
        const rev = Boolean(args[2])
        if (rev) {
          return curr <= 1 ? maxSteps : curr - 1
        }
        return curr >= maxSteps ? 1 : curr + 1
      }
      case 'FN_MASK_FROM_REAL':
        return Math.floor(Number(args[0]) || 0) & 0xFFFF
      case 'FN_SEC_TO_TIME': {
        const sec = Number(args[0]) || 0
        const minS = Number(args[1]) || 0
        const maxS = Number(args[2]) || 3600
        const clamped = Math.min(Math.max(sec, minS), maxS)
        return Math.round(clamped * 1000)
      }
      case 'DEADBAND': {
        const val = Number(args[0]) || 0
        const band = Number(args[1]) || 0
        const oldVal = Number(args[2]) || 0
        return Math.abs(val - oldVal) < band ? oldVal : val
      }
      case 'INT_TO_REAL':
      case 'DINT_TO_REAL':
        return Number(args[0]) || 0
      case 'REAL_TO_INT':
        return Math.round(Number(args[0]) || 0)
      case 'REAL_TO_UINT':
        return Math.max(0, Math.round(Number(args[0]) || 0)) & 0xFFFF
      case 'BOOL_TO_INT':
        return args[0] ? 1 : 0
      default: {
        const val = this.resolveIdentifier(name)
        return val !== 0 ? val : args[0] ?? null
      }
    }
  }
}

export function evaluateStExpression(
  expr: string,
  lookupVar: (name: string) => unknown,
): unknown {
  if (!expr || !expr.trim()) return null
  const tokens = tokenizeSt(expr.trim())
  const parser = new ExprParser(tokens, lookupVar)
  try {
    return parser.parse()
  } catch {
    return null
  }
}

export function evaluateStCondition(
  expr: string,
  lookupVar: (name: string) => unknown,
): boolean {
  const val = evaluateStExpression(expr, lookupVar)
  return Boolean(val)
}

// ============================================================================
// 6. AST & Statement Parser
// ============================================================================

class StatementParser {
  private tokens: StToken[]
  private pos = 0

  constructor(tokens: StToken[]) {
    this.tokens = tokens
  }

  private peek(): StToken {
    return this.tokens[this.pos] || { type: 'EOF', value: '', line: 0, col: 0, endLine: 0, endCol: 0 }
  }

  private peekAt(offset: number): StToken {
    return this.tokens[this.pos + offset] || { type: 'EOF', value: '', line: 0, col: 0, endLine: 0, endCol: 0 }
  }

  private next(): StToken {
    const t = this.peek()
    if (this.pos < this.tokens.length) this.pos++
    return t
  }

  private isEof(): boolean {
    return this.pos >= this.tokens.length || this.tokens[this.pos].type === 'EOF'
  }

  parseProgramStatements(): StStatement[] {
    return this.parseStatements([])
  }

  parseStatements(stopKeywords: string[]): StStatement[] {
    const stmts: StStatement[] = []
    const stopSet = new Set(stopKeywords.map((k) => k.toUpperCase()))

    while (!this.isEof()) {
      const tok = this.peek()

      if (tok.type === 'PUNCTUATION' && tok.value === ';') {
        this.next()
        continue
      }

      if (tok.type === 'KEYWORD') {
        const upper = tok.value.toUpperCase()
        if (stopSet.has(upper)) {
          break
        }
        if (upper === 'END_PROGRAM') {
          break
        }
        if (upper === 'IF') {
          stmts.push(this.parseIfStatement())
          continue
        }
        if (upper === 'CASE') {
          stmts.push(this.parseCaseStatement())
          continue
        }
      }

      // Check for Case Branch header if inside CASE
      if (stopSet.has('__CASE_BRANCH__') && this.isCaseBranchHeader()) {
        break
      }

      const stmt = this.parseSimpleOrAssignmentOrCall()
      if (stmt) {
        stmts.push(stmt)
      } else {
        this.next()
      }
    }

    return stmts
  }

  private parseIfStatement(): StIfStatement {
    const ifTok = this.next() // consume 'IF'
    const startLine = ifTok.line
    const condStartLine = ifTok.line

    const condTokens: StToken[] = []
    while (!this.isEof() && !(this.peek().type === 'KEYWORD' && this.peek().value.toUpperCase() === 'THEN')) {
      condTokens.push(this.next())
    }
    const condEndLine = condTokens.length > 0 ? condTokens[condTokens.length - 1].endLine : condStartLine

    if (!this.isEof() && this.peek().value.toUpperCase() === 'THEN') {
      this.next() // consume 'THEN'
    }

    const thenStatements = this.parseStatements(['ELSIF', 'ELSE', 'END_IF'])
    const elsifBranches: StIfStatement['elsifBranches'] = []

    while (!this.isEof() && this.peek().value.toUpperCase() === 'ELSIF') {
      const elsifTok = this.next() // consume 'ELSIF'
      const eCondStart = elsifTok.line
      const eCondTokens: StToken[] = []
      while (!this.isEof() && !(this.peek().type === 'KEYWORD' && this.peek().value.toUpperCase() === 'THEN')) {
        eCondTokens.push(this.next())
      }
      const eCondEnd = eCondTokens.length > 0 ? eCondTokens[eCondTokens.length - 1].endLine : eCondStart
      if (!this.isEof() && this.peek().value.toUpperCase() === 'THEN') {
        this.next()
      }
      const eStmts = this.parseStatements(['ELSIF', 'ELSE', 'END_IF'])
      elsifBranches.push({
        condition: eCondTokens.map((t) => t.value).join(' '),
        condStartLine: eCondStart,
        condEndLine: eCondEnd,
        statements: eStmts,
        startLine: elsifTok.line,
        endLine: eStmts.length > 0 ? eStmts[eStmts.length - 1].endLine : eCondEnd,
      })
    }

    let elseBranch: StIfStatement['elseBranch'] | undefined
    if (!this.isEof() && this.peek().value.toUpperCase() === 'ELSE') {
      const elseTok = this.next() // consume 'ELSE'
      const elseStmts = this.parseStatements(['END_IF'])
      elseBranch = {
        line: elseTok.line,
        statements: elseStmts,
        endLine: elseStmts.length > 0 ? elseStmts[elseStmts.length - 1].endLine : elseTok.endLine,
      }
    }

    let endLine = lineOf(this.peek())
    if (!this.isEof() && this.peek().value.toUpperCase() === 'END_IF') {
      const endIfTok = this.next()
      endLine = endIfTok.endLine
      if (this.peek().value === ';') {
        endLine = this.next().endLine
      }
    }

    return {
      kind: 'if',
      condition: condTokens.map((t) => t.value).join(' '),
      condStartLine,
      condEndLine,
      thenStatements,
      elsifBranches,
      elseBranch,
      startLine,
      endLine,
    }
  }

  private parseCaseStatement(): StCaseStatement {
    const caseTok = this.next() // consume 'CASE'
    const startLine = caseTok.line
    const selectorStartLine = caseTok.line

    const selTokens: StToken[] = []
    while (!this.isEof() && !(this.peek().type === 'KEYWORD' && this.peek().value.toUpperCase() === 'OF')) {
      selTokens.push(this.next())
    }
    const selectorEndLine = selTokens.length > 0 ? selTokens[selTokens.length - 1].endLine : selectorStartLine

    if (!this.isEof() && this.peek().value.toUpperCase() === 'OF') {
      this.next() // consume 'OF'
    }

    const branches: StCaseBranch[] = []
    let elseBranch: StCaseStatement['elseBranch'] | undefined

    while (!this.isEof()) {
      const tok = this.peek()
      const upper = tok.value.toUpperCase()

      if (tok.type === 'KEYWORD' && upper === 'END_CASE') {
        break
      }

      if (tok.type === 'KEYWORD' && upper === 'ELSE') {
        const elseTok = this.next()
        if (this.peek().value === ':') {
          this.next()
        }
        const elseStmts = this.parseStatements(['END_CASE'])
        elseBranch = {
          line: elseTok.line,
          statements: elseStmts,
          endLine: elseStmts.length > 0 ? elseStmts[elseStmts.length - 1].endLine : elseTok.endLine,
        }
        break
      }

      // Parse Case branch labels: e.g. 1:, 1, 2, 3:, 1..5:, STATE_A:
      const labels: StCaseLabel[] = []
      const labelStartLine = tok.line

      while (!this.isEof()) {
        const itemTok = this.next()
        if (this.peek().value === '..') {
          this.next() // consume '..'
          const maxTok = this.next()
          labels.push({
            type: 'range',
            min: parseNumberLiteral(itemTok.value),
            max: parseNumberLiteral(maxTok.value),
            raw: `${itemTok.value}..${maxTok.value}`,
          })
        } else {
          labels.push({
            type: 'single',
            value: itemTok.type === 'NUMBER' ? parseNumberLiteral(itemTok.value) : itemTok.value,
            raw: itemTok.value,
          })
        }

        if (this.peek().value === ',') {
          this.next()
          continue
        }
        if (this.peek().value === ':') {
          this.next()
          break
        }
        break
      }

      const labelEndLine = this.tokens[this.pos - 1]?.endLine ?? labelStartLine
      // Parse branch body statements until next branch header or END_CASE
      const branchStmts = this.parseStatements(['END_CASE', '__CASE_BRANCH__'])
      const bEndLine = branchStmts.length > 0 ? branchStmts[branchStmts.length - 1].endLine : labelEndLine

      branches.push({
        labels,
        labelStartLine,
        labelEndLine,
        statements: branchStmts,
        startLine: labelStartLine,
        endLine: bEndLine,
      })
    }

    let endLine = lineOf(this.peek())
    if (!this.isEof() && this.peek().value.toUpperCase() === 'END_CASE') {
      const endCaseTok = this.next()
      endLine = endCaseTok.endLine
      if (this.peek().value === ';') {
        endLine = this.next().endLine
      }
    }

    return {
      kind: 'case',
      selector: selTokens.map((t) => t.value).join(' '),
      selectorStartLine,
      selectorEndLine,
      branches,
      elseBranch,
      startLine,
      endLine,
    }
  }

  private isCaseBranchHeader(): boolean {
    const t0 = this.peek()
    if (t0.type === 'KEYWORD') {
      const u = t0.value.toUpperCase()
      if (u === 'ELSE' || u === 'END_CASE') return true
    }

    // A label starts with NUMBER or IDENTIFIER followed eventually by ':'
    if (t0.type === 'NUMBER' || t0.type === 'IDENTIFIER') {
      let look = 0
      while (look < 10) {
        const t = this.peekAt(look)
        if (t.type === 'EOF') return false
        if (t.type === 'OPERATOR' && t.value === ':=') return false
        if (t.type === 'PUNCTUATION' && t.value === ';') return false
        if (t.type === 'PUNCTUATION' && t.value === ':') return true
        look++
      }
    }
    return false
  }

  private parseSimpleOrAssignmentOrCall(): StStatement | null {
    const startTok = this.peek()
    const startLine = startTok.line

    // Check for Assignment: target := value;
    let target = ''
    let isAssignment = false
    let callStatement: StCallStatement | null = null

    // Peek ahead to detect target := ...
    if (startTok.type === 'IDENTIFIER') {
      let look = 0
      let fullTarget = ''
      while (this.peekAt(look).type === 'IDENTIFIER') {
        fullTarget += (fullTarget ? '.' : '') + this.peekAt(look).value
        look++
        if (this.peekAt(look).value === '.') {
          look++
        } else {
          break
        }
      }
      if (this.peekAt(look).value === ':=') {
        isAssignment = true
        target = fullTarget
      } else if (this.peekAt(look).value === '(') {
        // Potential FB Call statement
        callStatement = this.tryParseCallStatement()
        if (callStatement) return callStatement
      }
    }

    if (isAssignment) {
      // Consume target tokens
      while (this.peek().value !== ':=') {
        this.next()
      }
      this.next() // consume ':='

      const valTokens: StToken[] = []
      while (!this.isEof() && this.peek().value !== ';') {
        valTokens.push(this.next())
      }
      let endLine = valTokens.length > 0 ? valTokens[valTokens.length - 1].endLine : startLine
      if (this.peek().value === ';') {
        endLine = this.next().endLine
      }

      const valStr = valTokens.map((t) => t.value).join(' ')
      let callInfo: StCallInfo | undefined

      // Check if assignment value is a call: e.g. SEL(...)
      const firstValTok = valTokens[0]
      if (firstValTok && valTokens[1]?.value === '(') {
        const cName = firstValTok.value
        callInfo = {
          name: cName,
          args: extractArgsFromTokens(valTokens.slice(2)),
          targetVar: target,
          line: startLine,
          isFb: KNOWN_IEC_FBS.has(cName.toUpperCase()) || isFbInstanceName(cName),
        }
      }

      return {
        kind: 'assignment',
        target,
        value: valStr,
        call: callInfo,
        startLine,
        endLine,
      }
    }

    // Default statement: collect until ';'
    const rawTokens: StToken[] = []
    while (!this.isEof() && this.peek().value !== ';') {
      rawTokens.push(this.next())
    }
    let endLine = rawTokens.length > 0 ? rawTokens[rawTokens.length - 1].endLine : startLine
    if (this.peek().value === ';') {
      endLine = this.next().endLine
    }

    return {
      kind: 'simple',
      raw: rawTokens.map((t) => t.value).join(' '),
      startLine,
      endLine,
    }
  }

  private tryParseCallStatement(): StCallStatement | null {
    const startTok = this.peek()
    const startLine = startTok.line
    const callee = this.next().value // consume identifier
    this.next() // consume '('

    const argTokens: StToken[] = []
    let parenDepth = 1

    while (!this.isEof()) {
      const t = this.peek()
      if (t.value === '(') parenDepth++
      else if (t.value === ')') {
        parenDepth--
        if (parenDepth === 0) {
          this.next() // consume ')'
          break
        }
      }
      argTokens.push(this.next())
    }

    let endLine = argTokens.length > 0 ? argTokens[argTokens.length - 1].endLine : startLine
    if (this.peek().value === ';') {
      endLine = this.next().endLine
    }

    const args = extractArgsFromTokens(argTokens)
    return {
      kind: 'call',
      callee,
      args,
      raw: `${callee}(${argTokens.map((t) => t.value).join(' ')})`,
      startLine,
      endLine,
    }
  }
}

function lineOf(tok?: StToken): number {
  return tok ? tok.line : 0
}

function extractArgsFromTokens(tokens: StToken[]): StCallArg[] {
  const args: StCallArg[] = []
  let currentTokens: StToken[] = []
  let parenDepth = 0

  for (const t of tokens) {
    if (t.value === '(') parenDepth++
    else if (t.value === ')') parenDepth--

    if (t.value === ',' && parenDepth === 0) {
      args.push(parseOneArg(currentTokens))
      currentTokens = []
    } else {
      currentTokens.push(t)
    }
  }

  if (currentTokens.length > 0) {
    args.push(parseOneArg(currentTokens))
  }

  return args
}

function parseOneArg(tokens: StToken[]): StCallArg {
  if (tokens.length >= 2 && tokens[0].type === 'IDENTIFIER' && tokens[1].value === ':=') {
    const name = tokens[0].value
    const val = tokens.slice(2).map((t) => t.value).join(' ')
    return { name, value: val }
  }
  return { value: tokens.map((t) => t.value).join(' ') }
}

function isFbInstanceName(name: string): boolean {
  return (
    name.startsWith('FB_') ||
    /^(?:Ch\d+|AutoTmr|StepClk|Blinker|Stager|DemandOn|ModeDwell|PulseAll|TestTrig|PermitLost|TestStep|Req|LockBits)/i.test(name)
  )
}

export function parseStProgram(sourceOrTokens: string | StToken[]): StStatement[] {
  const tokens = typeof sourceOrTokens === 'string' ? tokenizeSt(sourceOrTokens) : sourceOrTokens
  const parser = new StatementParser(tokens)
  return parser.parseProgramStatements()
}

// ============================================================================
// 7. Control Flow Tracer & Executed Line Sequence
// ============================================================================

export function findBodyStartIndex(maskedLines: string[]): number {
  let lastEndVar = -1
  for (let i = 0; i < maskedLines.length; i++) {
    if (/\bEND_VAR\b/i.test(maskedLines[i])) {
      lastEndVar = i
    }
  }
  return lastEndVar !== -1 ? lastEndVar + 1 : 0
}

function pushLineRange(out: number[], startLine: number, endLine: number) {
  for (let l = startLine; l <= endLine; l++) {
    if (out.length === 0 || out[out.length - 1] !== l) {
      out.push(l)
    }
  }
}

function traceStatementsAst(
  statements: StStatement[],
  lookupVar: (name: string) => unknown,
  outLines: number[],
) {
  for (const stmt of statements) {
    if (stmt.kind === 'if') {
      // 1. Dòng IF condition luôn được thăm
      pushLineRange(outLines, stmt.startLine, stmt.condEndLine)

      if (evaluateStCondition(stmt.condition, lookupVar)) {
        traceStatementsAst(stmt.thenStatements, lookupVar, outLines)
      } else {
        let branchHandled = false
        for (const elsif of stmt.elsifBranches) {
          pushLineRange(outLines, elsif.startLine, elsif.condEndLine)
          if (evaluateStCondition(elsif.condition, lookupVar)) {
            traceStatementsAst(elsif.statements, lookupVar, outLines)
            branchHandled = true
            break
          }
        }
        if (!branchHandled && stmt.elseBranch) {
          pushLineRange(outLines, stmt.elseBranch.line, stmt.elseBranch.line)
          traceStatementsAst(stmt.elseBranch.statements, lookupVar, outLines)
        }
      }
      continue
    }

    if (stmt.kind === 'case') {
      // Dòng CASE ... OF luôn được thăm
      pushLineRange(outLines, stmt.startLine, stmt.selectorEndLine)

      const selectorVal = evaluateStExpression(stmt.selector, lookupVar)
      const selectorNum =
        typeof selectorVal === 'number'
          ? selectorVal
          : !isNaN(Number(selectorVal))
          ? Number(selectorVal)
          : -999999

      let matchingBranch: StCaseBranch | undefined
      for (const branch of stmt.branches) {
        const matches = branch.labels.some((l) => {
          if (l.type === 'range') {
            return l.min !== undefined && l.max !== undefined && selectorNum >= l.min && selectorNum <= l.max
          }
          if (l.type === 'single') {
            return selectorNum === Number(l.value) || String(selectorVal).toLowerCase() === String(l.value).toLowerCase()
          }
          return false
        })
        if (matches) {
          matchingBranch = branch
          break
        }
      }

      if (matchingBranch) {
        pushLineRange(outLines, matchingBranch.labelStartLine, matchingBranch.labelEndLine)
        traceStatementsAst(matchingBranch.statements, lookupVar, outLines)
      } else if (stmt.elseBranch) {
        pushLineRange(outLines, stmt.elseBranch.line, stmt.elseBranch.line)
        traceStatementsAst(stmt.elseBranch.statements, lookupVar, outLines)
      }
      continue
    }

    // Các lệnh thông thường (gán, gọi hàm/FB, lệnh đơn) bao phủ toàn bộ vùng dòng
    pushLineRange(outLines, stmt.startLine, stmt.endLine)
  }
}

export function computeExecutedLineSequence(
  rawLines: string[],
  maskedLines: string[],
  lookupVar: (name: string) => unknown,
): number[] {
  const out: number[] = []
  const bodyStart = findBodyStartIndex(maskedLines)

  // 1. Khai báo biến trước thân chương trình
  for (let i = 0; i < bodyStart; i++) {
    const t = maskedLines[i]?.trim() ?? ''
    if (t.length > 0 && !/^\s*(?:PROGRAM|VAR|VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_RETAIN|VAR_TEMP|VAR_CONSTANT|END_VAR)\b/i.test(t)) {
      out.push(i)
    }
  }

  // 2. Phân tích AST của thân chương trình
  // Cắt các dòng từ bodyStart tới hết để parse
  const bodyLines = rawLines.slice(bodyStart)
  const bodySource = bodyLines.join('\n')
  const bodyTokens = tokenizeSt(bodySource)

  // Dịch chuyển số dòng token theo bodyStart
  for (const tok of bodyTokens) {
    tok.line += bodyStart
    tok.endLine += bodyStart
  }

  const parser = new StatementParser(bodyTokens)
  const statements = parser.parseProgramStatements()

  // 3. Lần theo luồng thực thi AST
  traceStatementsAst(statements, lookupVar, out)

  return out
}

export function findFirstUsageLine(
  rawLines: string[],
  maskedLines: string[],
  varName: string,
): number {
  const bodyStart = findBodyStartIndex(maskedLines)
  const regex = new RegExp('\\b' + varName + '\\b', 'i')

  // 1. Thân lệnh thực thi
  for (let i = bodyStart; i < rawLines.length; i++) {
    if (regex.test(maskedLines[i])) {
      return i
    }
  }

  // 2. Dự phòng: khai báo
  for (let i = 0; i < bodyStart; i++) {
    if (regex.test(maskedLines[i])) {
      return i
    }
  }

  return -1
}

// ============================================================================
// 8. Function & FB Extraction for UI / Badges / Hover
// ============================================================================

export function extractLineAssignments(lineCode: string, lineNumber = 0): StAssignmentInfo[] {
  const assignments: StAssignmentInfo[] = []
  const tokens = tokenizeSt(lineCode)

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'OPERATOR' && tokens[i].value === ':=') {
      // Target is immediately preceding identifier or dotted identifier
      let target = ''
      let k = i - 1
      while (k >= 0 && (tokens[k].type === 'IDENTIFIER' || (tokens[k].type === 'PUNCTUATION' && tokens[k].value === '.'))) {
        target = tokens[k].value + target
        k--
      }

      if (target) {
        // Collect value until ';' or next ':=' or EOF
        const valTokens: StToken[] = []
        let j = i + 1
        while (j < tokens.length && tokens[j].value !== ';' && tokens[j].value !== ':=') {
          valTokens.push(tokens[j])
          j++
        }
        assignments.push({
          target,
          value: valTokens.map((t) => t.value).join(' '),
          line: lineNumber,
          endLine: lineNumber,
        })
      }
    }
  }

  return assignments
}

export function extractLineCalls(lineCode: string, lineNumber = 0): StCallInfo[] {
  const calls: StCallInfo[] = []
  const tokens = tokenizeSt(lineCode)

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if ((t.type === 'IDENTIFIER' || t.type === 'KEYWORD') && tokens[i + 1]?.value === '(') {
      const name = t.value
      if (ST_KEYWORDS.has(name.toUpperCase()) && !['SEL', 'LIMIT', 'MIN', 'MAX'].includes(name.toUpperCase())) {
        continue
      }

      // Check if assignment target precedes: target := Call(...)
      let targetVar: string | undefined
      if (i >= 2 && tokens[i - 1].value === ':=') {
        let k = i - 2
        let tgt = ''
        while (k >= 0 && (tokens[k].type === 'IDENTIFIER' || tokens[k].value === '.')) {
          tgt = tokens[k].value + tgt
          k--
        }
        if (tgt) targetVar = tgt
      }

      // Collect arguments
      let parenDepth = 0
      const argTokens: StToken[] = []
      let j = i + 1
      while (j < tokens.length) {
        if (tokens[j].value === '(') parenDepth++
        else if (tokens[j].value === ')') {
          parenDepth--
          if (parenDepth === 0) {
            j++
            break
          }
        }
        if (parenDepth > 0 && !(parenDepth === 1 && tokens[j].value === '(')) {
          argTokens.push(tokens[j])
        }
        j++
      }

      const args = extractArgsFromTokens(argTokens)
      const hasNamedArgs = args.some((a) => a.name !== undefined)
      const isFb = KNOWN_IEC_FBS.has(name.toUpperCase()) || hasNamedArgs || isFbInstanceName(name)

      calls.push({
        name,
        args,
        targetVar,
        line: lineNumber,
        isFb,
      })
    }
  }

  return calls
}

export function extractLineExpressions(lineCode: string, lineNumber = 0): StLineExpressions {
  const assignments = extractLineAssignments(lineCode, lineNumber)
  const calls = extractLineCalls(lineCode, lineNumber)
  const memberAccesses: StMemberAccessInfo[] = []
  const identifiers: string[] = []
  const tokens = tokenizeSt(lineCode)

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type === 'IDENTIFIER') {
      if (!ST_KEYWORDS.has(t.value.toUpperCase()) && !identifiers.includes(t.value)) {
        identifiers.push(t.value)
      }
      if (tokens[i + 1]?.value === '.' && tokens[i + 2]?.type === 'IDENTIFIER') {
        const full = `${t.value}.${tokens[i + 2].value}`
        memberAccesses.push({
          object: t.value,
          member: tokens[i + 2].value,
          full,
          line: lineNumber,
        })
      }
    }
  }

  return {
    line: lineNumber,
    assignments,
    calls,
    memberAccesses,
    identifiers,
  }
}

export function getStatementAtLine(statements: StStatement[], lineNumber: number): StStatement | undefined {
  for (const s of statements) {
    if (lineNumber >= s.startLine && lineNumber <= s.endLine) {
      if (s.kind === 'if') {
        const sub = getStatementAtLine(s.thenStatements, lineNumber)
        if (sub) return sub
        for (const eb of s.elsifBranches) {
          const eSub = getStatementAtLine(eb.statements, lineNumber)
          if (eSub) return eSub
        }
        if (s.elseBranch) {
          const elSub = getStatementAtLine(s.elseBranch.statements, lineNumber)
          if (elSub) return elSub
        }
      } else if (s.kind === 'case') {
        for (const b of s.branches) {
          const bSub = getStatementAtLine(b.statements, lineNumber)
          if (bSub) return bSub
        }
        if (s.elseBranch) {
          const elSub = getStatementAtLine(s.elseBranch.statements, lineNumber)
          if (elSub) return elSub
        }
      }
      return s
    }
  }
  return undefined
}
