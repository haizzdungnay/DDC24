/**
 * `DEV-PROG-018` — so khác biệt THEO DÒNG giữa hai phía của một hunk ST.
 *
 * Khay So sánh đã hiện hai phía cạnh nhau, nhưng cả hai đều là chữ trơn: người
 * đọc phải tự dò xem dòng nào đổi. Với một hunk vài chục dòng, đó là chính công
 * việc mà máy làm được và làm đúng.
 *
 * Hai luật:
 *
 * 1. **Không đoán khi quá lớn.** Trên `MAX_DIFF_LINES` dòng mỗi phía, thuật
 *    toán LCS tốn O(n·m) ô nhớ và làm treo tab trên bo. Khi đó module trả
 *    `coarse: true` và đánh dấu toàn bộ hai phía — kết luận thô, và bề mặt gọi
 *    NÓI RA rằng nó thô, đúng như backend đã làm với cờ `coarse` của chính hunk.
 * 2. **Không có "dòng sửa".** Chỉ có thêm và bớt. Ghép một dòng bị bớt với một
 *    dòng được thêm thành "một dòng đã sửa" là một phép đoán về ý định của
 *    người viết, và nó sai ngay khi hai dòng chỉ tình cờ đứng cạnh nhau.
 */

export type LineDiffKind = 'SAME' | 'REMOVED' | 'ADDED'

export interface LineDiffRow {
  kind: LineDiffKind
  /** Số dòng ở phía tương ứng; `null` khi phía đó không có dòng này. */
  beforeLine: number | null
  afterLine: number | null
  text: string
}

export interface LineDiffResult {
  rows: LineDiffRow[]
  /** `true` = quá lớn để so từng dòng; hai phía bị đánh dấu nguyên khối. */
  coarse: boolean
}

/** Trần mỗi phía. Trên ngưỡng này thì kết luận thô, không phải kết luận sai. */
export const MAX_DIFF_LINES = 400

export function diffLines(
  before: readonly string[],
  after: readonly string[],
  beforeStartLine = 1,
  afterStartLine = 1,
): LineDiffResult {
  if (before.length > MAX_DIFF_LINES || after.length > MAX_DIFF_LINES) {
    return {
      coarse: true,
      rows: [
        ...before.map((text, index) => ({
          kind: 'REMOVED' as const, beforeLine: beforeStartLine + index, afterLine: null, text,
        })),
        ...after.map((text, index) => ({
          kind: 'ADDED' as const, beforeLine: null, afterLine: afterStartLine + index, text,
        })),
      ],
    }
  }

  /* Bảng LCS cổ điển. `lengths[i][j]` = độ dài dãy chung dài nhất của
   * `before[i..]` và `after[j..]`; truy ngược từ (0,0) cho ra thứ tự gốc. */
  const lengths: number[][] = Array.from(
    { length: before.length + 1 },
    () => new Array<number>(after.length + 1).fill(0),
  )
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = before[i] === after[j]
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }

  const rows: LineDiffRow[] = []
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      rows.push({ kind: 'SAME', beforeLine: beforeStartLine + i, afterLine: afterStartLine + j, text: before[i] })
      i += 1
      j += 1
      continue
    }
    /* Hoà nhau thì ưu tiên BỚT trước THÊM: nó giữ thứ tự đọc "cái cũ mất đi rồi
     * cái mới xuất hiện", giống mọi công cụ diff mà người dùng đã quen. */
    if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      rows.push({ kind: 'REMOVED', beforeLine: beforeStartLine + i, afterLine: null, text: before[i] })
      i += 1
    } else {
      rows.push({ kind: 'ADDED', beforeLine: null, afterLine: afterStartLine + j, text: after[j] })
      j += 1
    }
  }
  while (i < before.length) {
    rows.push({ kind: 'REMOVED', beforeLine: beforeStartLine + i, afterLine: null, text: before[i] })
    i += 1
  }
  while (j < after.length) {
    rows.push({ kind: 'ADDED', beforeLine: null, afterLine: afterStartLine + j, text: after[j] })
    j += 1
  }
  return { rows, coarse: false }
}

/** Số dòng thêm/bớt — dùng cho nhãn tóm tắt của mỗi hunk. */
export function diffCounts(result: LineDiffResult): { added: number; removed: number } {
  return {
    added: result.rows.filter((row) => row.kind === 'ADDED').length,
    removed: result.rows.filter((row) => row.kind === 'REMOVED').length,
  }
}
