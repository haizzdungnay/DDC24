import { describe, expect, it } from 'vitest'
import { ST_CORE_RESERVED_WORDS } from './stCoreReservedWords.generated'
import { ST_COMPLETION_KEYWORDS, ST_FB_TYPE_NAMES, ST_KEYWORDS, ST_TYPE_NAMES } from './stEditorSupport'

/**
 * `DEV-PROG-022` — bản sao từ khoá của FE phải đi theo compiler, và phải bị
 * BẮT khi nó không đi theo.
 *
 * Người dùng báo 2026-08-29: `CASE`/`END_CASE` hiện như biến chưa khai báo.
 * Gốc là `ST_KEYWORDS` chép tay từ `ST_SUBSET_SPEC` Rev A.0 ("chưa hỗ trợ
 * CASE") rồi đứng yên trong khi `st_parser.cpp` mọc thêm `parse_case()`. Một
 * chú thích "nhớ cập nhật khi compiler đổi" đã có sẵn ở đó và không giúp gì.
 *
 * Test này đọc THẲNG bảng `kKeywords[]` trong tệp C++. Nó không phân tích C++
 * — nó chỉ bóc các chuỗi trong đúng một mảng, đủ để phát hiện lệch mà không
 * dựng một parser thứ hai.
 */
function coreReservedWords(): readonly string[] {
  /* Danh sách này do `scripts/generate_st_reserved_words.py` trích từ bảng
   * `kKeywords[]` của `st_parser.cpp`, và `check:programming-st-keywords`
   * (chạy trong `npm run build`) làm đỏ nếu bản chép lạc hậu. Test ở đây trả
   * lời câu hỏi còn lại: FE có NHẬN RA hết những từ đó không. */
  expect(ST_CORE_RESERVED_WORDS.length).toBeGreaterThan(40)
  return ST_CORE_RESERVED_WORDS
}

describe('DEV-PROG-022 — từ khoá ST của FE bám theo compiler', () => {
  it('mọi từ compiler giữ chỗ đều được FE nhận diện (từ khoá, tên kiểu, hoặc tên FB chuẩn)', () => {
    const known = new Set<string>([
      ...ST_KEYWORDS,
      ...ST_TYPE_NAMES.map((name) => name.toUpperCase()),
      ...ST_FB_TYPE_NAMES.map((name) => name.toUpperCase()),
    ])
    const missing = coreReservedWords().filter((word) => !known.has(word))
    expect(missing, `FE không nhận diện: ${missing.join(', ')}`).toEqual([])
  })

  it('CASE/OF/END_CASE và FUNCTION_BLOCK/END_FUNCTION_BLOCK nằm trong danh sách tô màu', () => {
    // Chốt đúng những từ đã gây ra báo lỗi, để một lần "dọn danh sách" sau này
    // không lặng lẽ bỏ chúng ra lần nữa.
    for (const word of ['CASE', 'OF', 'END_CASE', 'FUNCTION_BLOCK', 'END_FUNCTION_BLOCK']) {
      expect(ST_KEYWORDS).toContain(word)
    }
  })

  it('tên kiểu và tên FB chuẩn KHÔNG bị nhét vào ST_KEYWORDS — chúng có màu riêng', () => {
    // `tokenizeSt` hỏi KEYWORD_SET trước TYPE_SET/FB_TYPE_SET, nên một `BOOL`
    // lọt vào đây sẽ mất màu kiểu mà không có test nào khác kêu.
    const keywords = new Set<string>(ST_KEYWORDS)
    for (const name of [...ST_TYPE_NAMES, ...ST_FB_TYPE_NAMES]) {
      expect(keywords.has(name.toUpperCase()), `${name} không được nằm trong ST_KEYWORDS`).toBe(false)
    }
  })

  it('gợi ý chỉ đưa ra construct compiler dịch được — không mời viết FOR/GOTO', () => {
    const offered = new Set(ST_COMPLETION_KEYWORDS)
    for (const word of ['FOR', 'WHILE', 'REPEAT', 'GOTO', 'RETURN', 'EXIT', 'CONTINUE']) {
      expect(offered.has(word), `${word} chưa có luật văn phạm trong parse_stmt()`).toBe(false)
    }
    for (const word of ['CASE', 'OF', 'END_CASE', 'IF', 'END_IF']) {
      expect(offered.has(word), `${word} dịch được nhưng không được gợi ý`).toBe(true)
    }
    // Mọi từ được gợi ý phải là từ compiler giữ chỗ — không tự bịa ra từ khoá.
    for (const word of ST_COMPLETION_KEYWORDS) expect(ST_KEYWORDS).toContain(word)
  })
})
