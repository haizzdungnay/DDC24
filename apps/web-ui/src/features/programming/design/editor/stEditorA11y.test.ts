import { describe, expect, it } from 'vitest'
import { AA_TEXT, contrastRatio } from '../../../../shared/theme/contrast'
import { THEMES, THEME_NAMES, type TokenName } from '../../../../shared/theme/tokens'
import { ST_TOKEN_COLOR, type StTokenKind } from './stEditorSupport'

/**
 * `ISS-STED-15` / `F-STED-015`, gate `G17` — BẰNG CHỨNG A11Y CHO ST EDITOR.
 *
 * Trình soạn thảo dựng bằng `<textarea>` trong suốt + lớp phủ `<pre>` tô màu.
 * Cấu trúc đó tạo ra một rủi ro mà các màn hình khác không có: chữ người dùng
 * đang gõ được tô bằng MÀU TOKEN, và nếu một màu không đủ tương phản thì mã
 * nguồn của họ trở nên khó đọc — không phải một nhãn phụ, mà chính thứ họ đang
 * viết.
 *
 * Đo chứ không suy đoán: số ở đây tính bằng công thức WCAG 2.2 trên đúng giá
 * trị token của hai theme, và bảng màu đọc từ `ST_TOKEN_COLOR` — nguồn mà
 * `ProgramsTab` dùng thật, không phải một bản chép.
 */

/* Ba nền một token có thể nằm trên trong khung soạn thảo. Đo cả ba chứ không
 * chỉ nền chính: dòng đang gõ được tô nền `--c-surface-2`, và ngoặc khớp được
 * tô `--c-accent-bg`. Một màu chữ đủ tương phản trên nền chính mà chìm trên
 * dòng đang gõ thì hỏng đúng ở dòng người dùng đang nhìn. */
const BACKGROUNDS: { name: TokenName; why: string }[] = [
  { name: '--c-bg', why: 'nền khung soạn thảo' },
  { name: '--c-surface-2', why: 'nền dòng đang gõ' },
  { name: '--c-accent-bg', why: 'nền ngoặc khớp' },
]

const COLORED_KINDS = (Object.keys(ST_TOKEN_COLOR) as StTokenKind[])
  .filter((kind) => ST_TOKEN_COLOR[kind] !== null)

/** Số đo thật, in ra để đưa vào record bằng chứng. */
function measure(): { theme: string; kind: string; background: string; ratio: number }[] {
  const rows: { theme: string; kind: string; background: string; ratio: number }[] = []
  for (const theme of THEME_NAMES) {
    for (const kind of COLORED_KINDS) {
      const color = THEMES[theme][ST_TOKEN_COLOR[kind] as TokenName]
      for (const background of BACKGROUNDS) {
        rows.push({
          theme, kind, background: background.name,
          ratio: Math.round(contrastRatio(color, THEMES[theme][background.name]) * 100) / 100,
        })
      }
    }
  }
  return rows
}

describe('tương phản token ST — ISS-STED-15', () => {
  it('bảng màu phủ ĐỦ mọi StTokenKind, không sót loại nào', () => {
    // Một loại token thiếu trong bảng sẽ hiện bằng màu chữ mặc định và không
    // ai đo nó — đúng cách một màu không đạt lọt qua.
    const kinds: StTokenKind[] = [
      'keyword', 'type', 'function', 'fb-type', 'number', 'time', 'comment',
      'operator', 'punctuation', 'identifier', 'whitespace',
    ]
    for (const kind of kinds) {
      expect(Object.prototype.hasOwnProperty.call(ST_TOKEN_COLOR, kind), `thiếu ${kind}`).toBe(true)
    }
    expect(COLORED_KINDS.length).toBe(kinds.length - 1) // trừ `whitespace`
  })

  it.each(measure())(
    'theme $theme · token $kind trên $background đạt AA 4.5:1 (đo được $ratio)',
    ({ ratio }) => {
      // Ngưỡng AA_TEXT chứ không phải AA_NON_TEXT: đây là CHỮ, và là chữ người
      // dùng đọc lâu nhất trong toàn sản phẩm.
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT)
    },
  )

  it('in bảng số đo để đưa vào record bằng chứng', () => {
    const rows = measure()
    expect(rows.length).toBe(THEME_NAMES.length * COLORED_KINDS.length * BACKGROUNDS.length)
    // Số thấp nhất là số quyết định — ghi lại để record không phải chép tay.
    const worst = rows.reduce((low, row) => (row.ratio < low.ratio ? row : low))
    expect(worst.ratio).toBeGreaterThanOrEqual(AA_TEXT)
  })
})
