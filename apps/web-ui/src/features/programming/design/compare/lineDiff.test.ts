import { describe, expect, it } from 'vitest'
import { MAX_DIFF_LINES, diffCounts, diffLines } from './lineDiff'

describe('DEV-PROG-018 — so khác biệt theo dòng', () => {
  it('dòng giống nhau được đánh dấu SAME và giữ số dòng của CẢ HAI phía', () => {
    const result = diffLines(['A', 'B'], ['A', 'B'], 10, 20)
    expect(result.coarse).toBe(false)
    expect(result.rows).toEqual([
      { kind: 'SAME', beforeLine: 10, afterLine: 20, text: 'A' },
      { kind: 'SAME', beforeLine: 11, afterLine: 21, text: 'B' },
    ])
  })

  it('chỉ có THÊM và BỚT, không có "dòng đã sửa"', () => {
    // Ghép một dòng bớt với một dòng thêm thành "một dòng đã sửa" là đoán ý định
    // người viết, và nó sai ngay khi hai dòng chỉ tình cờ đứng cạnh nhau.
    const result = diffLines(['A', 'CU'], ['A', 'MOI'])
    expect(result.rows.map((row) => row.kind)).toEqual(['SAME', 'REMOVED', 'ADDED'])
    expect(diffCounts(result)).toEqual({ added: 1, removed: 1 })
  })

  it('giữ được phần chung ở giữa hai đoạn đổi', () => {
    const result = diffLines(['A', 'B', 'C'], ['A', 'X', 'C'])
    expect(result.rows.filter((row) => row.kind === 'SAME').map((row) => row.text)).toEqual(['A', 'C'])
  })

  it('một phía rỗng ⇒ toàn bộ phía kia là thêm (hoặc bớt)', () => {
    expect(diffLines([], ['A', 'B']).rows.every((row) => row.kind === 'ADDED')).toBe(true)
    expect(diffLines(['A', 'B'], []).rows.every((row) => row.kind === 'REMOVED')).toBe(true)
  })

  it('quá lớn ⇒ kết luận THÔ có cờ, không phải kết luận sai và cũng không treo', () => {
    // O(n·m) trên hai phía 401 dòng là 160 nghìn ô; trên bo, một hunk lớn hơn
    // nữa sẽ làm tab đứng hình. Nói ra là thô còn hơn im lặng mà treo.
    const big = Array.from({ length: MAX_DIFF_LINES + 1 }, (_, index) => `L${index}`)
    const result = diffLines(big, big)
    expect(result.coarse).toBe(true)
    expect(result.rows).toHaveLength(2 * big.length)
  })
})
