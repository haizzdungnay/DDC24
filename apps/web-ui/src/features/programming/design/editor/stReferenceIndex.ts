import { maskStComments } from './stInstanceInsertion'

/**
 * `T59-805` / `AC-ST-005` — chỉ mục tham chiếu cho editor ST.
 *
 * **Phạm vi thẩm quyền, nói trước:** chỉ mục này dựng từ NGUỒN đang gõ, không
 * phải từ compiler. Nó phục vụ điều hướng (nhảy tới khai báo, đếm nơi đọc/ghi)
 * chứ KHÔNG phán xét nguồn đúng hay sai — việc đó vẫn của Check ở Core. Vì vậy
 * khi không tra được một định danh, câu trả lời đúng là **"không xác định
 * được"**, không phải một suy đoán trông giống câu trả lời. WP-04 vẫn còn phần
 * chỉ mục do compiler sinh; nó là nguồn thẩm quyền khi có, chỉ mục này là thứ
 * dùng được ngay và tự khai đúng giới hạn của mình.
 */

export type StSymbolKind = 'VARIABLE' | 'FB_INSTANCE'

export interface StSymbolOccurrence {
  offset: number
  /** `WRITE` = đứng bên trái `:=` ở mức câu lệnh; tham số `IN := x` KHÔNG tính. */
  role: 'READ' | 'WRITE'
}

export interface StSymbolEntry {
  name: string
  typeName: string
  kind: StSymbolKind
  /** Offset của TÊN trong khai báo. */
  declarationOffset: number
  occurrences: readonly StSymbolOccurrence[]
}

export interface StReferenceIndex {
  symbols: readonly StSymbolEntry[]
  byName: ReadonlyMap<string, StSymbolEntry>
}

export interface StCursorSymbol {
  /** Định danh nằm dưới con trỏ, kể cả khi nó không tra được. */
  identifier: string
  start: number
  end: number
  /** `null` = không có khai báo nào khớp — hiển thị "không xác định được". */
  entry: StSymbolEntry | null
}

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/g
const VAR_OPEN = /\bVAR(?:_INPUT|_OUTPUT|_IN_OUT|_TEMP)?\b(?:[ \t]*\r?\n?[ \t]*RETAIN\b)?/gi
const DECLARATION = /([A-Za-z_][A-Za-z0-9_]*)[ \t\r\n]*:[ \t\r\n]*([A-Za-z_][A-Za-z0-9_]*)[ \t\r\n]*;/g

/** Kiểu dữ liệu cơ bản của subset ST (§10). Còn lại trong khối VAR là instance FB. */
const BASE_TYPES = new Set(['BOOL', 'INT', 'DINT', 'UINT', 'SINT', 'USINT', 'REAL', 'LREAL', 'TIME', 'STRING', 'BYTE', 'WORD', 'DWORD'])

const KEYWORDS = new Set([
  'PROGRAM', 'END_PROGRAM', 'FUNCTION', 'END_FUNCTION', 'FUNCTION_BLOCK', 'END_FUNCTION_BLOCK',
  'VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_TEMP', 'END_VAR', 'RETAIN',
  'IF', 'THEN', 'ELSIF', 'ELSE', 'END_IF', 'CASE', 'OF', 'END_CASE',
  'FOR', 'TO', 'BY', 'DO', 'END_FOR', 'WHILE', 'END_WHILE', 'REPEAT', 'UNTIL', 'END_REPEAT',
  'AND', 'OR', 'XOR', 'NOT', 'MOD', 'TRUE', 'FALSE', 'RETURN', 'EXIT',
])

interface DeclarationSpan {
  start: number
  end: number
}

/** Vùng của các khối VAR, để phân biệt "khai báo" với "dùng". */
function declarationSpans(masked: string): DeclarationSpan[] {
  const spans: DeclarationSpan[] = []
  const open = new RegExp(VAR_OPEN.source, VAR_OPEN.flags)
  let match: RegExpExecArray | null
  while ((match = open.exec(masked)) !== null) {
    const relativeClose = masked.slice(match.index).search(/\bEND_VAR\b/i)
    if (relativeClose === -1) break
    const end = match.index + relativeClose + 'END_VAR'.length
    spans.push({ start: match.index + match[0].length, end: match.index + relativeClose })
    open.lastIndex = end
  }
  return spans
}

function insideAny(spans: readonly DeclarationSpan[], offset: number): boolean {
  return spans.some((span) => offset >= span.start && offset < span.end)
}

/**
 * Vai trò của một lần xuất hiện.
 *
 * `X := 1;` là GHI vào `X`. Nhưng `TON_1(IN := X)` thì `IN` là TÊN THAM SỐ của
 * lời gọi, không phải biến bị ghi — phân biệt bằng độ sâu ngoặc: ở trong ngoặc
 * thì `ident :=` là gán tham số, ở mức câu lệnh mới là phép gán thật.
 */
function roleAt(masked: string, start: number, end: number, parenDepth: number): 'READ' | 'WRITE' {
  if (parenDepth > 0) return 'READ'
  if (!/^[ \t\r\n]*:=/.test(masked.slice(end))) return 'READ'
  /* `TON_1.Q := 1` ghi vào THÀNH VIÊN; bản thân instance vẫn chỉ là một lần
   * đọc — không ai gán đè cả instance. (`TON_1` không lọt vào nhánh này vì
   * ngay sau nó là dấu chấm, không phải `:=`.) */
  if (masked[start - 1] === '.') return 'READ'
  return 'WRITE'
}

export function buildStReferenceIndex(source: string): StReferenceIndex {
  const masked = maskStComments(source)
  const spans = declarationSpans(masked)

  const entries = new Map<string, StSymbolEntry & { occurrences: StSymbolOccurrence[] }>()
  for (const span of spans) {
    const body = masked.slice(span.start, span.end)
    const decl = new RegExp(DECLARATION.source, DECLARATION.flags)
    let match: RegExpExecArray | null
    while ((match = decl.exec(body)) !== null) {
      const typeName = match[2].toUpperCase()
      const name = match[1]
      if (entries.has(name)) continue
      entries.set(name, {
        name,
        typeName,
        kind: BASE_TYPES.has(typeName) ? 'VARIABLE' : 'FB_INSTANCE',
        declarationOffset: span.start + match.index,
        occurrences: [],
      })
    }
  }

  /* Quét toàn nguồn MỘT lượt, giữ độ sâu ngoặc để phân biệt gán tham số với
   * phép gán thật. Lần xuất hiện trong chính khối VAR không tính là dùng. */
  let parenDepth = 0
  let cursor = 0
  const identifier = new RegExp(IDENTIFIER.source, IDENTIFIER.flags)
  let match: RegExpExecArray | null
  while ((match = identifier.exec(masked)) !== null) {
    for (let index = cursor; index < match.index; index += 1) {
      if (masked[index] === '(') parenDepth += 1
      else if (masked[index] === ')') parenDepth = Math.max(0, parenDepth - 1)
    }
    cursor = match.index
    const name = match[0]
    if (KEYWORDS.has(name.toUpperCase())) continue
    if (insideAny(spans, match.index)) continue
    const entry = entries.get(name)
    if (!entry) continue
    entry.occurrences.push({ offset: match.index, role: roleAt(masked, match.index, match.index + name.length, parenDepth) })
  }

  const symbols = [...entries.values()]
  return { symbols, byName: new Map(symbols.map((entry) => [entry.name, entry])) }
}

/** Định danh nằm dưới một offset, kèm entry nếu tra được. */
export function stSymbolAt(source: string, offset: number, index?: StReferenceIndex): StCursorSymbol | null {
  const clamped = Math.max(0, Math.min(offset, source.length))
  const isIdentChar = (char: string | undefined) => char !== undefined && /[A-Za-z0-9_]/.test(char)
  if (!isIdentChar(source[clamped]) && !isIdentChar(source[clamped - 1])) return null

  let start = clamped
  while (start > 0 && isIdentChar(source[start - 1])) start -= 1
  let end = clamped
  while (end < source.length && isIdentChar(source[end])) end += 1
  const identifier = source.slice(start, end)
  if (identifier.length === 0 || /^[0-9]/.test(identifier)) return null

  const resolved = index ?? buildStReferenceIndex(source)
  return { identifier, start, end, entry: resolved.byName.get(identifier) ?? null }
}
