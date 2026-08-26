import type { CatalogEntry } from '../library/libraryCatalog'

/**
 * `T59-805` / `AC-ST-002` — chèn một FUNCTION_BLOCK có trạng thái vào nguồn ST
 * mà KHÔNG bắt người dùng thuộc lòng cú pháp khai báo.
 *
 * Vì sao module này tồn tại: grammar ST của thiết bị
 * (`ST_SUBSET_SPEC_MK-DDC-24_VI.md` §10) là
 *
 *     program = "PROGRAM" identifier { var_block } statement_list "END_PROGRAM"
 *
 * và parser thật (`apps/core/application/st/st_parser.cpp`, `parse_pou()`) đọc
 * HẾT các khối `VAR` **trước** rồi mới đọc danh sách câu lệnh. Nghĩa là một
 * khối `VAR ... END_VAR` xuất hiện giữa thân chương trình là lỗi cú pháp,
 * không phải "kiểu viết khác". Bản chèn trước đây sinh đúng thứ đó ngay tại
 * con trỏ, nên mỗi lần chèn một FB có trạng thái là một lần Check chắc chắn
 * đỏ — UI chào một khả năng mà compiler không nhận.
 *
 * Module này tách hai phần của cùng một thao tác về đúng chỗ của chúng:
 * khai báo instance đi vào vùng khai báo, lời gọi đi vào thân. Cả hai là MỘT
 * lần sửa buffer nên vẫn đúng `AC-ST-003` (một bước hoàn tác).
 */

export interface StDeclaredInstance {
  name: string
  typeName: string
  /** Offset của tên trong nguồn gốc — đủ để nhảy tới khai báo. */
  offset: number
}

export interface StInsertionPlan {
  text: string
  selectionStart: number
  selectionEnd: number
  /** Tên instance đã dùng; `null` cho FUNCTION (không có trạng thái). */
  instanceName: string | null
  /** `true` khi kế hoạch có thêm một dòng khai báo mới. */
  declarationAdded: boolean
  /**
   * `true` khi lời gọi bị DỜI khỏi vị trí con trỏ vì con trỏ đang nằm trong
   * vùng khai báo. Người dùng cần biết vì sao chữ không hiện ra chỗ họ đang
   * nhìn, thay vì tưởng thao tác trượt.
   */
  callRelocated: boolean
}

interface VarBlock {
  keyword: string
  bodyStart: number
  endVarStart: number
  end: number
  /** Parser chỉ cho khai instance FB trong `VAR` và `VAR RETAIN`. */
  hostsInstances: boolean
}

const POU_HEADER = /\b(?:PROGRAM|FUNCTION_BLOCK|FUNCTION)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*[A-Za-z_][A-Za-z0-9_]*)?/i
const VAR_OPEN = /\bVAR(?:_INPUT|_OUTPUT|_IN_OUT|_TEMP)?\b(?:[ \t]*\r?\n?[ \t]*RETAIN\b)?/gi
const VAR_DECL = /([A-Za-z_][A-Za-z0-9_]*)[ \t\r\n]*:[ \t\r\n]*([A-Za-z_][A-Za-z0-9_]*)[ \t\r\n]*;/g

/**
 * Thay nội dung chú thích `(* ... *)` bằng khoảng trắng nhưng GIỮ NGUYÊN độ
 * dài, nên mọi offset tìm được trên bản che vẫn trỏ đúng vào nguồn gốc. Không
 * làm bước này thì một chú thích chứa chữ `END_VAR` đủ để cắt nhầm vùng khai
 * báo.
 */
export function maskStComments(source: string): string {
  let out = ''
  let index = 0
  while (index < source.length) {
    if (source.startsWith('(*', index)) {
      const close = source.indexOf('*)', index + 2)
      const end = close === -1 ? source.length : close + 2
      for (let k = index; k < end; k += 1) out += source[k] === '\n' ? '\n' : ' '
      index = end
      continue
    }
    out += source[index]
    index += 1
  }
  return out
}

function findVarBlocks(masked: string): VarBlock[] {
  const blocks: VarBlock[] = []
  const open = new RegExp(VAR_OPEN.source, VAR_OPEN.flags)
  let match: RegExpExecArray | null
  while ((match = open.exec(masked)) !== null) {
    const rest = masked.slice(match.index)
    const relativeClose = rest.search(/\bEND_VAR\b/i)
    if (relativeClose === -1) break
    const endVarStart = match.index + relativeClose
    const end = endVarStart + 'END_VAR'.length
    const keyword = match[0].replace(/\s+/g, ' ').trim().toUpperCase()
    blocks.push({
      keyword,
      bodyStart: match.index + match[0].length,
      endVarStart,
      end,
      hostsInstances: keyword === 'VAR' || keyword === 'VAR RETAIN',
    })
    open.lastIndex = end
  }
  return blocks
}

/** Offset kết thúc vùng khai báo: sau khối `VAR` cuối, hoặc sau đầu đề POU. */
function declarationSectionEnd(source: string, masked: string, blocks: readonly VarBlock[]): number {
  if (blocks.length > 0) return blocks[blocks.length - 1].end
  const header = POU_HEADER.exec(masked)
  if (header) return header.index + header[0].length
  void source
  return 0
}

/** Mọi định danh đã khai trong các khối VAR, cộng tên POU. */
function declaredNames(masked: string, blocks: readonly VarBlock[]): string[] {
  const names: string[] = []
  const header = POU_HEADER.exec(masked)
  if (header) names.push(header[1])
  for (const block of blocks) {
    const body = masked.slice(block.bodyStart, block.endVarStart)
    const decl = new RegExp(VAR_DECL.source, VAR_DECL.flags)
    let match: RegExpExecArray | null
    while ((match = decl.exec(body)) !== null) names.push(match[1])
  }
  return names
}

/**
 * Các instance FB đã khai trong nguồn. Lọc theo `typeName` để hỏi "đã có
 * instance nào của TON chưa" — nền cho phần **chọn** của `AC-ST-002`.
 */
export function collectDeclaredInstances(source: string, typeName?: string): StDeclaredInstance[] {
  const masked = maskStComments(source)
  const blocks = findVarBlocks(masked)
  const wanted = typeName?.toUpperCase()
  const found: StDeclaredInstance[] = []
  for (const block of blocks) {
    if (!block.hostsInstances) continue
    const body = masked.slice(block.bodyStart, block.endVarStart)
    const decl = new RegExp(VAR_DECL.source, VAR_DECL.flags)
    let match: RegExpExecArray | null
    while ((match = decl.exec(body)) !== null) {
      const declaredType = match[2]
      if (wanted && declaredType.toUpperCase() !== wanted) continue
      found.push({
        name: match[1],
        typeName: declaredType,
        offset: block.bodyStart + match.index,
      })
    }
  }
  return found
}

/**
 * Tên instance mới không đụng bất kỳ định danh nào đang có.
 *
 * Định danh ST **có** phân biệt hoa thường (§10), nhưng sinh ra `TON_1` khi
 * nguồn đã có `ton_1` là một cái bẫy đọc: hai biến khác nhau trông như một.
 * Nên phép so ở đây cố ý bỏ qua hoa thường — chặt hơn grammar, không lỏng hơn.
 */
export function nextInstanceName(source: string, typeName: string): string {
  const masked = maskStComments(source)
  const used = new Set(declaredNames(masked, findVarBlocks(masked)).map((name) => name.toLowerCase()))
  for (let index = 1; ; index += 1) {
    const candidate = `${typeName}_${index}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}

/** Lời gọi (chỉ THÂN, không kèm khai báo) cho một mục catalog. */
export function stCallStatement(entry: CatalogEntry, instanceName?: string): string {
  const inputs = entry.ports.filter((port) => port.direction === 'INPUT')
  const outputs = entry.ports.filter((port) => port.direction === 'OUTPUT')
  if (!entry.stateful) {
    const args = inputs.map((port) => port.name).join(', ')
    const target = outputs[0]?.name ?? 'OUT'
    return `${target} := ${entry.name}(${args});`
  }
  const instance = instanceName ?? `${entry.name}_1`
  const assignments = inputs.map((port) => `${port.name} := ${port.name}`).join(', ')
  return `${instance}(${assignments});`
}

function lineStartOf(source: string, offset: number): number {
  return source.lastIndexOf('\n', offset - 1) + 1
}

function indentOfLine(source: string, lineStart: number): string {
  return /^[ \t]*/.exec(source.slice(lineStart))?.[0] ?? ''
}

interface Edit {
  at: number
  text: string
}

/** Chỗ đặt và hình dạng của dòng khai báo mới. */
function planDeclaration(
  source: string,
  blocks: readonly VarBlock[],
  declEnd: number,
  instanceName: string,
  typeName: string,
): Edit {
  const host = [...blocks].reverse().find((block) => block.hostsInstances)
  if (host) {
    const lineStart = lineStartOf(source, host.endVarStart)
    if (lineStart > host.bodyStart) {
      /* `END_VAR` đứng riêng một dòng: chèn một dòng khai báo phía trên nó,
       * thụt lề theo đúng khai báo đang có trong khối. */
      const existing = collectDeclaredInstances(source).find((item) => item.offset > host.bodyStart && item.offset < host.endVarStart)
      const indent = existing ? indentOfLine(source, lineStartOf(source, existing.offset)) : `${indentOfLine(source, lineStartOf(source, host.endVarStart))}  `
      return { at: lineStart, text: `${indent}${instanceName} : ${typeName};\n` }
    }
    /* Khối viết gọn trên MỘT dòng (`VAR X : INT; END_VAR`): chèn ngay trước
     * `END_VAR` và giữ nguyên kiểu viết một dòng, không tự bẻ dòng nguồn của
     * người khác. */
    const needsSpace = !/\s$/.test(source.slice(0, host.endVarStart))
    return { at: host.endVarStart, text: `${needsSpace ? ' ' : ''}${instanceName} : ${typeName}; ` }
  }
  /* Chưa có khối nào nhận được instance: dựng một khối `VAR` mới ngay sau
   * vùng khai báo hiện tại (sau đầu đề POU nếu chưa có khối nào). */
  const prefix = declEnd > 0 && source[declEnd - 1] !== '\n' ? '\n' : ''
  const suffix = declEnd < source.length && source[declEnd] !== '\n' ? '\n' : ''
  return { at: declEnd, text: `${prefix}VAR\n  ${instanceName} : ${typeName};\nEND_VAR${suffix}` }
}

/**
 * Kế hoạch chèn một mục catalog vào nguồn ST tại con trỏ.
 *
 * `options.instanceName` cho phép **chọn** một instance đã khai thay vì tạo
 * mới — hai nhánh của `AC-ST-002`. Chọn một instance đã có thì không sinh
 * thêm khai báo; hai lời gọi dùng chung một instance là quyết định của người
 * dùng, không phải mặc định của công cụ.
 */
export function planLibraryInsertion(
  source: string,
  entry: CatalogEntry,
  cursorOffset: number,
  options: { instanceName?: string } = {},
): StInsertionPlan {
  const masked = maskStComments(source)
  const blocks = findVarBlocks(masked)
  const declEnd = declarationSectionEnd(source, masked, blocks)

  const rawCursor = Math.max(0, Math.min(cursorOffset, source.length))
  /* Con trỏ đang trong vùng khai báo thì lời gọi KHÔNG được đặt ở đó: statement
   * nằm giữa các khối VAR là lỗi cú pháp theo đúng thứ tự parser đọc. */
  const callOffset = Math.max(rawCursor, declEnd)
  const callRelocated = callOffset !== rawCursor

  let instanceName: string | null = null
  let declarationAdded = false
  let declEdit: Edit | null = null

  if (entry.stateful) {
    const existing = collectDeclaredInstances(source, entry.name)
    const chosen = options.instanceName
    if (chosen && existing.some((item) => item.name === chosen)) {
      instanceName = chosen
    } else {
      instanceName = chosen ?? nextInstanceName(source, entry.name)
      declarationAdded = true
      declEdit = planDeclaration(source, blocks, declEnd, instanceName, entry.name)
    }
  }

  const statement = stCallStatement(entry, instanceName ?? undefined)
  const callLineStart = lineStartOf(source, callOffset)
  const beforeOnLine = source.slice(callLineStart, callOffset)
  const atLineStart = beforeOnLine.trim() === ''
  const callPrefix = atLineStart ? '' : '\n'
  const callIndent = atLineStart ? '' : indentOfLine(source, callLineStart)
  const callSuffix = callOffset < source.length && source[callOffset] === '\n' ? '' : '\n'
  const callInsert = `${callPrefix}${callIndent}${statement}${callSuffix}`
  const caretWithinCall = callPrefix.length + callIndent.length + statement.length

  const declText = declEdit ? declEdit.text : ''
  const declAt = declEdit ? declEdit.at : 0
  const text = declEdit
    ? source.slice(0, declAt) + declText + source.slice(declAt, callOffset) + callInsert + source.slice(callOffset)
    : source.slice(0, callOffset) + callInsert + source.slice(callOffset)
  const caret = callOffset + declText.length + caretWithinCall

  return {
    text,
    selectionStart: caret,
    selectionEnd: caret,
    instanceName,
    declarationAdded,
    callRelocated,
  }
}
