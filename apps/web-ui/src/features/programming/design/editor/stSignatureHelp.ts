/**
 * `ISS-STED-11` / `F-STED-008` — GỢI Ý CHỮ KÝ khi gõ lời gọi hàm và Function Block.
 *
 * TRIỆU CHỨNG
 * -----------
 * Người dùng gõ `LIMIT(` phải tự nhớ thứ tự `(MN, IN, MX)`; gõ `PID_1(` phải
 * tự nhớ sáu tham số **và** quy tắc chỉ-gọi-theo-tên (khác biệt cố ý `D4` của
 * `ST_SUBSET_SPEC` §9). Nhớ sai thì phải chờ hết một vòng Kiểm tra mới biết.
 *
 * NGHỊCH LÝ
 * ---------
 * Dữ liệu đã có sẵn và đã được dùng ở chỗ khác: `PROGRAMMING_LIBRARY_ENTRIES`
 * mang đủ `ports: [{name, direction, dataType}]` cho cả 46 entry, sinh tự động
 * từ `contracts/programming/pou_library_registry_v1.json`, và Quick Library đã
 * vẽ bảng cổng từ chính dữ liệu đó. Chỉ trình soạn thảo là không dùng.
 *
 * Vì vậy module này **không khai tay danh sách tham số thứ hai**. Khai tay sẽ
 * tạo một nguồn sự thật song song, và nó sẽ lệch khỏi registry đúng vào lúc
 * người dùng tin nó nhất — lúc họ đang gõ dở một lời gọi.
 *
 * PHẠM VI
 * -------
 * Đây là bộ máy thuần logic: nhận `source` + vị trí con trỏ, trả về chữ ký cần
 * hiện. Không đụng DOM, không tự sửa buffer, không chèn dấu đóng ngoặc. Việc
 * hiển thị nằm ở `SourceEditor`.
 */

import {
  PROGRAMMING_LIBRARY_ENTRIES,
  type LibraryEntry,
  type LibraryPort,
} from '../../api/generated/library_registry'
import { PROGRAMMING_REVIEW_GATED_FEATURES } from '../../api/generated/profile'

export interface StSignatureParameter {
  name: string
  dataType: string
  direction: LibraryPort['direction']
}

export interface StSignatureHelp {
  /** Tên xuất hiện trong mã: tên hàm, hoặc tên **instance** với FB. */
  calleeName: string
  /** Tên kiểu trong registry — với FB thì khác `calleeName` (`PID_1` : `PID`). */
  typeRef: string
  kind: 'function' | 'function-block'
  /** Tham số đầu vào theo đúng thứ tự registry. */
  parameters: StSignatureParameter[]
  /** Cổng đầu ra — hiện để đọc, không phải thứ gõ vào lời gọi. */
  outputs: StSignatureParameter[]
  /** Chỉ số tham số đang nhập; `-1` khi không xác định được. */
  activeParameter: number
  /** FB **phải** gọi theo tên (`IN := `). Xem `D4`, `ST_SUBSET_SPEC` §9. */
  namedArgumentsRequired: boolean
  /** Offset của dấu `(` mở lời gọi — để UI neo popup. */
  openParenOffset: number
  /** Khối đang chờ review Controls/Safety: Kiểm tra sẽ từ chối. */
  reviewGated: boolean
}

const ENTRY_BY_ID = new Map<string, LibraryEntry>(
  PROGRAMMING_LIBRARY_ENTRIES.map((entry) => [entry.id.toUpperCase(), entry]),
)

/* Nguồn là profile sinh ra, không phải danh sách viết tay — cùng lối với
 * `stEditorSupport.ts`. Thêm một feature vào cổng mà đây không biết sẽ tạo ra
 * một chữ ký hứa nhiều hơn sự thật. */
const REVIEW_GATED_NAMES = new Set<string>(
  PROGRAMMING_REVIEW_GATED_FEATURES.filter((item) => !item.approved).map((item) => item.featureId),
)

/**
 * Quét từ đầu buffer tới `offset`, bỏ qua chú thích `(* *)` và `//`, và trả về
 * ngăn xếp các lời gọi còn mở.
 *
 * Phải quét XUÔI chứ không lùi. Quét lùi từ con trỏ không phân biệt được `(`
 * của lời gọi với `(` mở chú thích `(*`, cũng không biết mình đang ở trong
 * chú thích hay không — và một chữ ký hiện lên giữa dòng chú thích thì tệ hơn
 * là không hiện gì.
 */
interface OpenCall {
  openParenOffset: number
  /** Offset của dấu phẩy cấp cao nhất, để đếm tham số. */
  commaOffsets: number[]
}

function openCallStack(source: string, offset: number): OpenCall[] {
  const stack: OpenCall[] = []
  let index = 0
  while (index < offset) {
    const char = source[index]

    // Chú thích khối `(* ... *)` — KHÔNG lồng nhau (ST_SUBSET_SPEC §10).
    if (char === '(' && source[index + 1] === '*') {
      const end = source.indexOf('*)', index + 2)
      index = end === -1 ? offset : end + 2
      continue
    }
    // Chú thích dòng `// ...`
    if (char === '/' && source[index + 1] === '/') {
      const end = source.indexOf('\n', index)
      index = end === -1 ? offset : end + 1
      continue
    }
    if (char === '(') {
      stack.push({ openParenOffset: index, commaOffsets: [] })
      index += 1
      continue
    }
    if (char === ')') {
      stack.pop()
      index += 1
      continue
    }
    if (char === ',' && stack.length > 0) {
      stack[stack.length - 1].commaOffsets.push(index)
      index += 1
      continue
    }
    index += 1
  }
  return stack
}

/** Identifier ngay trước `(`, bỏ qua khoảng trắng. `null` nếu không có. */
function calleeBefore(source: string, openParen: number): string | null {
  let end = openParen
  while (end > 0 && /\s/.test(source[end - 1])) end -= 1
  let start = end
  while (start > 0 && /[A-Za-z0-9_]/.test(source[start - 1])) start -= 1
  if (start === end) return null
  return source.slice(start, end)
}

/**
 * Tham số đang nhập.
 *
 * Với lời gọi **theo tên** (`TON_1(IN := x, PT := T#5s)`) thì đếm dấu phẩy là
 * sai: người dùng có thể viết các cặp theo thứ tự bất kỳ, nên đoạn thứ hai
 * không nhất thiết là tham số thứ hai. Đọc tên bên trái `:=` của chính đoạn
 * đang gõ mới đúng.
 */
function activeParameterIndex(
  source: string,
  call: OpenCall,
  offset: number,
  parameters: StSignatureParameter[],
  named: boolean,
): number {
  const lastComma = call.commaOffsets.length > 0
    ? call.commaOffsets[call.commaOffsets.length - 1]
    : call.openParenOffset
  const segment = source.slice(lastComma + 1, offset)

  if (named) {
    const assign = segment.indexOf(':=')
    const label = (assign === -1 ? segment : segment.slice(0, assign)).trim().toUpperCase()
    if (label.length === 0) return -1
    const index = parameters.findIndex((parameter) => parameter.name.toUpperCase() === label)
    // Tên chưa khớp cổng nào (đang gõ dở, hoặc gõ sai): không làm nổi bừa một
    // tham số — làm nổi sai còn tệ hơn không làm nổi, vì nó khẳng định một
    // điều sai.
    return index
  }
  const index = call.commaOffsets.length
  return index < parameters.length ? index : -1
}

function toParameters(ports: readonly LibraryPort[], direction: LibraryPort['direction']) {
  return ports
    .filter((port) => port.direction === direction)
    .map((port) => ({ name: port.name, dataType: port.dataType, direction: port.direction }))
}

/**
 * Chữ ký cần hiện tại vị trí con trỏ, hoặc `null` khi con trỏ không nằm trong
 * một lời gọi mà registry biết.
 *
 * @param declaredSymbols biến đã khai trong chính buffer (từ `collectStSymbols`).
 *   Cần để phân giải `PID_1(` → kiểu `PID`: tên instance là do người dùng đặt,
 *   registry không thể biết trước.
 */
export function stSignatureHelp(
  source: string,
  offset: number,
  declaredSymbols: readonly { name: string; type: string }[],
): StSignatureHelp | null {
  if (offset < 0 || offset > source.length) return null
  const stack = openCallStack(source, offset)
  if (stack.length === 0) return null
  const call = stack[stack.length - 1]

  const callee = calleeBefore(source, call.openParenOffset)
  if (callee === null) return null

  // Instance FB trước: `TON_1` là tên người dùng đặt, và nếu trùng tên một
  // hàm chuẩn thì khai báo trong buffer phải thắng — nó cụ thể hơn.
  const symbol = declaredSymbols.find(
    (item) => item.name.toUpperCase() === callee.toUpperCase(),
  )
  const typeRef = symbol ? symbol.type : callee
  const entry = ENTRY_BY_ID.get(typeRef.toUpperCase())
  if (entry === undefined) return null

  const isFunctionBlock = entry.kind === 'FUNCTION_BLOCK'
  // Gọi một KIỂU FB trực tiếp (`TON(...)`) không hợp lệ: FB phải qua instance
  // đã khai báo. Không hiện chữ ký cho dạng đó, vì hiện lên là ngầm bảo rằng
  // viết vậy được.
  if (isFunctionBlock && symbol === undefined) return null

  const parameters = toParameters(entry.ports, 'INPUT')
  if (parameters.length === 0 && !isFunctionBlock) return null

  return {
    calleeName: callee,
    typeRef: entry.id,
    kind: isFunctionBlock ? 'function-block' : 'function',
    parameters,
    outputs: toParameters(entry.ports, 'OUTPUT'),
    activeParameter: activeParameterIndex(source, call, offset, parameters, isFunctionBlock),
    namedArgumentsRequired: isFunctionBlock,
    openParenOffset: call.openParenOffset,
    reviewGated: REVIEW_GATED_NAMES.has(entry.id),
  }
}

/** Chuỗi hiển thị một tham số. FB dùng dạng gọi theo tên vì đó là dạng DUY
 *  NHẤT hợp lệ (`D4`); gợi ý dạng theo vị trí sẽ dạy người dùng viết sai. */
export function stSignatureParameterLabel(
  parameter: StSignatureParameter,
  namedArgumentsRequired: boolean,
): string {
  return namedArgumentsRequired
    ? `${parameter.name} := ${parameter.dataType}`
    : `${parameter.name}: ${parameter.dataType}`
}

/** Chuỗi chữ ký đầy đủ, dùng cho nhãn a11y và cho tiêu đề popup. */
export function stSignatureLabel(help: StSignatureHelp): string {
  const params = help.parameters
    .map((parameter) => stSignatureParameterLabel(parameter, help.namedArgumentsRequired))
    .join(', ')
  return `${help.calleeName}(${params})`
}
