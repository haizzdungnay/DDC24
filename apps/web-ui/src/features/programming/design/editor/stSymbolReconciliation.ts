/**
 * `ISS-STED-13` / `F-STED-011` — ĐỐI CHIẾU CHỈ MỤC KÝ HIỆU CỦA FE VỚI COMPILER.
 *
 * TRIỆU CHỨNG
 * -----------
 * FE có **ba** bộ đọc ST độc lập với compiler: bộ tô màu, chỉ mục ký hiệu bằng
 * regex, và một parser đầy đủ cho nút Định dạng. Chống trôi trước đây chỉ phủ
 * **danh sách từ khoá**; văn phạm, hệ kiểu và quy tắc scope không có gì canh.
 * Nghĩa là chỉ mục có thể đọc lệch — và không ai, kể cả chính nó, biết.
 *
 * NGUỒN ĐỐI CHIẾU
 * ---------------
 * CLI compile **đã** phát mảng `symbols[{name, direction, type, slot}]` từ lâu,
 * và runner Go đã đọc nó vào struct. Nhưng nó dừng ở đó: không ai dùng. Đem nó
 * ra tới FE cho phép hỏi một câu mà trước đây không hỏi được: *"thứ tôi đọc
 * được có khớp thứ compiler thấy không?"*
 *
 * BA ĐIỀU KIỆN PHẢI ĐÚNG TRƯỚC KHI SO
 * -----------------------------------
 * Một phép so trên dữ liệu không cùng thời điểm còn tệ hơn không so, vì nó sẽ
 * báo lệch giả và người dùng học cách bỏ qua cảnh báo:
 *
 * 1. **Check phải PASSED.** Check hỏng nghĩa là compiler chưa dựng xong bảng
 *    ký hiệu; so với một bảng dở dang là tự tạo ra lệch.
 * 2. **Buffer phải chưa đổi kể từ lần Check đó** — dùng đúng cơ chế provenance
 *    của `ISS-STED-18`, không dựng phép so tươi/cũ thứ hai.
 * 3. **Chỉ so tập biến GIAO DIỆN.** Compiler chỉ công bố `VAR_INPUT`/
 *    `VAR_OUTPUT`; chỉ mục FE thấy cả biến cục bộ. So toàn bộ sẽ báo mọi biến
 *    `VAR` là "FE thừa" — một cổng kêu oan mỗi lần chạy là một cổng sắp bị tắt.
 *
 * KHI LỆCH
 * --------
 * FE **hạ cấp** chỉ mục xuống "không xác định được" kèm thông báo, chứ không
 * im lặng hiển thị thông tin sai. Đây là cùng một nguyên tắc mà Inspector đang
 * theo: một suy đoán trông giống sự thật là thứ nguy hiểm nhất, vì người đọc
 * không có cách nào phân biệt.
 */

import type { ProgrammingCheckSymbol } from '../../model/types'
import type { StReferenceIndex } from './stReferenceIndex'

export type StReconciliationState =
  /** Đã so và khớp — chỉ mục dùng được như bình thường. */
  | 'MATCHED'
  /** Đã so và LỆCH — hạ cấp chỉ mục. */
  | 'DRIFTED'
  /** Chưa đủ điều kiện để so (chưa Check, Check hỏng, buffer đã đổi). */
  | 'UNVERIFIED'

export interface StReconciliationMismatch {
  name: string
  /** Chỉ mục FE nói gì; `null` = FE không thấy biến này. */
  frontend: string | null
  /** Compiler nói gì; `null` = compiler không thấy biến này. */
  compiler: string | null
}

export interface StReconciliationResult {
  state: StReconciliationState
  mismatches: StReconciliationMismatch[]
  /** Lý do đọc được, luôn nói rõ vì sao chưa so được hoặc lệch ở đâu. */
  reason: string
  /** `true` khi chỉ mục KHÔNG còn đáng tin và phải hạ cấp. */
  degraded: boolean
}

export interface StReconciliationInput {
  /** Chỉ mục dựng từ buffer đang mở. */
  index: StReferenceIndex
  /** Bảng cổng compiler công bố, đã lọc theo POU đang xem. */
  compilerSymbols: readonly ProgrammingCheckSymbol[] | null | undefined
  /** Trạng thái Check gần nhất. */
  checkState: string | null | undefined
  /** Buffer có đổi kể từ lần Check đó không (`ISS-STED-18`). */
  bufferChanged: boolean
  /**
   * Tên các biến GIAO DIỆN mà FE đọc được (`VAR_INPUT`/`VAR_OUTPUT`), lấy từ
   * `collectStInterfaceVariables`. Truyền vào thay vì tự phân tích lại: chỉ
   * mục không ghi biến thuộc khối `VAR` nào, và dựng đường phân tích thứ hai ở
   * đây là tạo ra đúng loại trôi mà module này sinh ra để bắt.
   */
  interfaceVariables: readonly { name: string; type: string; direction: 'INPUT' | 'OUTPUT' }[]
}

function unverified(reason: string): StReconciliationResult {
  return { state: 'UNVERIFIED', mismatches: [], reason, degraded: false }
}

export function reconcileStSymbols(input: StReconciliationInput): StReconciliationResult {
  if (input.checkState !== 'PASSED') {
    return unverified(
      'Chưa có kết quả Kiểm tra hợp lệ để đối chiếu bảng ký hiệu; ' +
      'giao diện đang dùng chỉ mục đọc tại chỗ.',
    )
  }
  if (input.bufferChanged) {
    return unverified(
      'Mã nguồn đã đổi kể từ lần Kiểm tra gần nhất, nên bảng ký hiệu của trình biên dịch ' +
      'không còn nói về đúng đoạn mã này.',
    )
  }
  if (!input.compilerSymbols) {
    return unverified('Kết quả Kiểm tra không kèm bảng ký hiệu của trình biên dịch.')
  }

  const compilerByName = new Map<string, ProgrammingCheckSymbol>(
    input.compilerSymbols.map((symbol) => [symbol.name.toUpperCase(), symbol]),
  )
  const frontendByName = new Map<string, { name: string; type: string; direction: 'INPUT' | 'OUTPUT' }>(
    input.interfaceVariables.map((variable) => [variable.name.toUpperCase(), variable]),
  )

  /* Chuẩn hoá hướng về một cách viết TRƯỚC khi so và trước khi in ra. CLI
   * phát `input`/`output` chữ thường, còn FE dùng `INPUT`/`OUTPUT`; trộn hai
   * cách viết trong cùng một thông báo lệch làm người đọc tưởng đó là hai thứ
   * khác nhau — trong khi chúng là một. */
  const normalizeDirection = (direction: string) => direction.toUpperCase()

  const mismatches: StReconciliationMismatch[] = []
  /* Duyệt HỢP của hai tập tên chứ không duyệt một tập: thiếu ở FE và thừa ở FE
   * là hai chế độ hỏng khác nhau, và chỉ duyệt một phía sẽ mù với một trong
   * hai. Sắp xếp để thông điệp ổn định giữa các lần chạy. */
  const names = [...new Set([...compilerByName.keys(), ...frontendByName.keys()])].sort()
  for (const name of names) {
    const compiler = compilerByName.get(name)
    const frontend = frontendByName.get(name)
    if (!compiler) {
      mismatches.push({ name: frontend!.name, frontend: `${frontend!.direction} ${frontend!.type}`, compiler: null })
      continue
    }
    if (!frontend) {
      mismatches.push({
        name: compiler.name, frontend: null,
        compiler: `${normalizeDirection(compiler.direction)} ${compiler.type}`,
      })
      continue
    }
    const compilerDirection = normalizeDirection(compiler.direction)
    if (compilerDirection !== frontend.direction || compiler.type.toUpperCase() !== frontend.type.toUpperCase()) {
      mismatches.push({
        name: frontend.name,
        frontend: `${frontend.direction} ${frontend.type}`,
        compiler: `${compilerDirection} ${compiler.type}`,
      })
    }
  }

  if (mismatches.length === 0) {
    return {
      state: 'MATCHED',
      mismatches: [],
      reason: `Chỉ mục ký hiệu khớp bảng của trình biên dịch (${names.length} biến giao diện).`,
      degraded: false,
    }
  }

  return {
    state: 'DRIFTED',
    mismatches,
    degraded: true,
    reason:
      'Chỉ mục ký hiệu của giao diện LỆCH khỏi bảng của trình biên dịch: ' +
      mismatches
        .map((item) => `${item.name} — giao diện ${item.frontend ?? 'không thấy'}, ` +
                       `trình biên dịch ${item.compiler ?? 'không thấy'}`)
        .join('; ') +
      '. Giao diện hạ các thông tin suy ra từ chỉ mục xuống "không xác định được" ' +
      'thay vì hiển thị thông tin sai.',
  }
}
