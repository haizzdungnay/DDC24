import type { ProgrammingProgram } from '../../model/types'

/** Kết quả một phép biến đổi buffer: text mới + vùng chọn mới (khớp chữ ký
 *  `applyEdit(next, newCursor)` đã có ở `SourceEditor`, mở rộng thêm
 *  `selectionEnd` cho các thao tác tạo ra một VÙNG chọn thay vì một điểm). */
export interface EditResult {
  text: string
  selectionStart: number
  selectionEnd: number
}

const COMMENT_OPEN = '(* '
const COMMENT_CLOSE = ' *)'

/** Bọc/gỡ `(* … *)` quanh đúng vùng đang chọn — toggle theo việc vùng chọn
 *  ĐÃ khớp định dạng gói `(* ${nội dung} *)` hay chưa (round-trip đối xứng,
 *  không đoán khoảng trắng). ST không hỗ trợ comment lồng nhau (tokenizer
 *  `tokenizeStSource` dừng ở `*)` ĐẦU TIÊN) nên không cố xử lý trường hợp
 *  vùng chọn tự chứa comment con — ngoài phạm vi MVP. */
export function toggleComment(source: string, start: number, end: number): EditResult {
  if (start === end) return { text: source, selectionStart: start, selectionEnd: end }
  const selected = source.slice(start, end)
  if (selected.startsWith(COMMENT_OPEN) && selected.endsWith(COMMENT_CLOSE)) {
    const inner = selected.slice(COMMENT_OPEN.length, selected.length - COMMENT_CLOSE.length)
    return { text: source.slice(0, start) + inner + source.slice(end), selectionStart: start, selectionEnd: start + inner.length }
  }
  const wrapped = `${COMMENT_OPEN}${selected}${COMMENT_CLOSE}`
  return { text: source.slice(0, start) + wrapped + source.slice(end), selectionStart: start, selectionEnd: start + wrapped.length }
}

/** Khối được compiler hỗ trợ để "Bọc khối" có thể tạo — CHỈ `IF`.
 *  `FOR`/`WHILE`/`REPEAT`/`CASE` bị loại khỏi Rev A.0 theo
 *  `ST_SUBSET_SPEC_MK-DDC-24_VI.md` §5.5, lý do P1 (§2): "Không có
 *  WHILE/REPEAT/FOR với biên động" — vòng lặp không biên tĩnh có thể khiến
 *  một scan không kết thúc trong thời gian chặn trên, vi phạm yêu cầu an
 *  toàn thời gian thực. Đề xuất "Quick Control" ban đầu liệt kê cả FOR/WHILE
 *  — đã bỏ khi cắm dây thật vì mọi mã sinh ra từ đó sẽ luôn bị Check từ chối
 *  100% (không phải một cạnh hiếm), đánh lừa người dùng nghĩ ST dialect này
 *  hỗ trợ vòng lặp. Giữ dạng mảng (không hard-code một literal) để mai sau
 *  compiler hỗ trợ thêm khối nào thì chỉ cần thêm một dòng ở đây. */
export const SUPPORTED_WRAP_BLOCK_KINDS = ['IF'] as const
export type WrapBlockKind = (typeof SUPPORTED_WRAP_BLOCK_KINDS)[number]

const WRAP_BLOCK_TEMPLATE: Record<WrapBlockKind, { open: (indent: string) => string; close: (indent: string) => string; placeholder: string }> = {
  IF: {
    open: (indent) => `${indent}IF TRUE THEN\n`,
    close: (indent) => `${indent}END_IF;\n`,
    placeholder: 'TRUE',
  },
}

/** Bọc các DÒNG TRỌN VẸN chứa vùng chọn trong một khối `IF …THEN` /
 *  `END_IF;`, thụt lề thêm 2 khoảng trắng (khớp quy ước `computeAutoIndent`/
 *  `formatStSource`) — không phân tích ranh giới câu lệnh (không viết ST
 *  parser thứ hai ở FE); nếu vùng chọn cắt giữa một câu lệnh, kết quả vẫn là
 *  text hợp lệ về mặt từ vựng, đúng/sai cú pháp do Kiểm tra (Check) quyết
 *  định như mọi chỉnh sửa tay khác. Điều kiện `TRUE` được CHỌN SẴN sau khi
 *  bọc để người dùng gõ đè ngay thành điều kiện thật. */
export function wrapInBlock(source: string, start: number, end: number, kind: WrapBlockKind): EditResult {
  const lineStart = source.lastIndexOf('\n', start - 1) + 1
  const nextNewline = source.indexOf('\n', end)
  const lineEnd = nextNewline === -1 ? source.length : nextNewline + 1
  const before = source.slice(0, lineStart)
  const body = source.slice(lineStart, lineEnd)
  const after = source.slice(lineEnd)

  const indentMatch = /^[ \t]*/.exec(body)
  const baseIndent = indentMatch ? indentMatch[0] : ''
  const bodyIndent = `${baseIndent}  `
  const bodyLines = body.split('\n')
  const reindentedBody = bodyLines
    .map((line, index) => {
      const isTrailingEmptyFromSplit = index === bodyLines.length - 1 && line.length === 0
      if (isTrailingEmptyFromSplit || line.trim().length === 0) return line
      return `${bodyIndent}${line.replace(/^[ \t]*/, '')}`
    })
    .join('\n')

  const template = WRAP_BLOCK_TEMPLATE[kind]
  const openLine = template.open(baseIndent)
  const closeLine = template.close(baseIndent)
  const text = `${before}${openLine}${reindentedBody}${closeLine}${after}`
  const placeholderStart = before.length + openLine.lastIndexOf(template.placeholder)
  const placeholderEnd = placeholderStart + template.placeholder.length
  return { text, selectionStart: placeholderStart, selectionEnd: placeholderEnd }
}

/** Một mục trong Bảng lệnh nhanh (`CommandPalette`) — ba loại đúng phạm vi đã
 *  duyệt. KHÔNG có loại "diagnostic": `DesignWorkspacePage` (D-01) không còn
 *  truyền diagnostic thật nào vào `ProgramsTab` nữa — Check/Problems đã
 *  chuyển hẳn sang PGM-03 (`CheckCommissionPage`); một mục Bảng lệnh chỉ để
 *  hiển thị danh sách LUÔN RỖNG là tính năng giả, không phải thu hẹp phạm vi
 *  một cách an toàn. */
export interface PaletteProgramEntry {
  kind: 'program'
  programId: string
  label: string
  detail: string
}

export interface PaletteVariableEntry {
  kind: 'variable'
  programId: string
  programName: string
  label: string
  detail: string
  offset: number
  length: number
}

export type PaletteCommandId = 'format' | 'save' | 'check'

export interface PaletteCommandEntry {
  kind: 'command'
  commandId: PaletteCommandId
  label: string
  detail: string
}

export type PaletteEntry = PaletteProgramEntry | PaletteVariableEntry | PaletteCommandEntry

export function paletteEntryKey(entry: PaletteEntry): string {
  if (entry.kind === 'program') return `program:${entry.programId}`
  if (entry.kind === 'variable') return `variable:${entry.programId}:${entry.offset}`
  return `command:${entry.commandId}`
}

export interface ProgramSymbolLike { name: string; type: string; offset: number }

/** Chỉ mục toàn Draft cho Bảng lệnh nhanh. Nhận `symbolsByProgramId` ĐÃ TÍNH
 *  SẴN (gọi `collectStSymbols` ở phía `ProgramsTab.tsx` — module này không tự
 *  import `collectStSymbols` để tránh vòng phụ thuộc `ProgramsTab.tsx` ↔
 *  `quickControl.ts`) từ một `useMemo` phụ thuộc `buffers`/`document.programs`,
 *  KHÔNG phụ thuộc chuỗi tìm kiếm. Gõ trong ô tìm chỉ lọc mảng đã dựng sẵn (so
 *  khớp chuỗi rẻ), không tokenize lại — chỉ Program nào có `source` đổi mới bị
 *  tính lại vì `useMemo` so sánh reference theo từng lần render, không phải
 *  theo từng phím gõ ở ô tìm. */
export function buildCommandPaletteEntries(
  programs: readonly Pick<ProgrammingProgram, 'programId' | 'name' | 'language'>[],
  symbolsByProgramId: Record<string, readonly ProgramSymbolLike[]>,
  pick: (vi: string, en: string) => string,
): PaletteEntry[] {
  const entries: PaletteEntry[] = []
  for (const program of programs) {
    entries.push({
      kind: 'program',
      programId: program.programId,
      label: program.name,
      detail: program.language,
    })
    if (program.language !== 'ST') continue
    for (const symbol of symbolsByProgramId[program.programId] ?? []) {
      entries.push({
        kind: 'variable',
        programId: program.programId,
        programName: program.name,
        label: symbol.name,
        detail: `${symbol.type} · ${program.name}`,
        offset: symbol.offset,
        length: symbol.name.length,
      })
    }
  }
  entries.push(
    { kind: 'command', commandId: 'format', label: pick('Định dạng mã nguồn', 'Format source'), detail: pick('Chương trình đang mở', 'Currently open program') },
    { kind: 'command', commandId: 'save', label: pick('Lưu', 'Save'), detail: pick('Lưu Draft', 'Save the draft') },
    { kind: 'command', commandId: 'check', label: pick('Kiểm tra', 'Check'), detail: pick('Mở Kiểm tra & Đưa vào vận hành', 'Open Check & Commission') },
  )
  return entries
}

/** So khớp không phân biệt hoa/thường, không dấu phân cách bắt buộc — khớp
 *  theo LABEL trước, rồi DETAIL (vd tìm "AHU" khớp cả Program tên "AHU-01"
 *  lẫn biến có detail "REAL · AHU-01"). */
export function filterPaletteEntries(entries: readonly PaletteEntry[], query: string): PaletteEntry[] {
  const trimmed = query.trim().toLocaleLowerCase()
  if (trimmed.length === 0) return [...entries]
  return entries.filter((entry) => entry.label.toLocaleLowerCase().includes(trimmed) || entry.detail.toLocaleLowerCase().includes(trimmed))
}
