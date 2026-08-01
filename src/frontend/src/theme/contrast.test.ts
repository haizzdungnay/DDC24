import { describe, expect, it } from 'vitest'
import { AA_NON_TEXT, AA_TEXT, contrastRatio, parseHex, relativeLuminance } from './contrast'
import {
  BADGE_VARIANTS,
  GRAPHIC_TOKENS,
  SURFACE_TOKENS,
  TEXT_TOKENS,
  THEMES,
  THEME_NAMES,
  TOKEN_NAMES,
  type ThemeName,
  type ThemeTokens,
  type TokenName
} from './tokens'

function color(theme: ThemeTokens, token: TokenName): string {
  const value = theme[token]
  if (!value) throw new Error(`thiếu token ${token}`)
  return value
}

describe('công thức WCAG 2.2', () => {
  it('khớp các mốc đã biết', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5)
    // Mốc tham chiếu quen thuộc: trên nền trắng, #767676 vừa đủ đạt 4.5:1 còn
    // #777777 — sáng hơn đúng một bậc — thì trượt. Cặp này chứng minh công thức
    // nhạy đúng chỗ chứ không chỉ trả về một số lớn.
    expect(contrastRatio('#767676', '#FFFFFF')).toBeGreaterThanOrEqual(AA_TEXT)
    expect(contrastRatio('#777777', '#FFFFFF')).toBeLessThan(AA_TEXT)
    expect(relativeLuminance(parseHex('#FFFFFF'))).toBeCloseTo(1, 5)
    expect(relativeLuminance(parseHex('#000000'))).toBeCloseTo(0, 5)
  })

  it('chấp nhận hex 3 ký tự và từ chối chuỗi không hợp lệ', () => {
    expect(parseHex('#FFF')).toEqual({ r: 255, g: 255, b: 255 })
    expect(() => parseHex('rgb(1,2,3)')).toThrow()
  })
})

describe('hình dạng bảng token', () => {
  it.each(THEME_NAMES)('theme "%s" định nghĩa đủ mọi token dưới dạng hex', (name: ThemeName) => {
    const theme = THEMES[name]
    for (const token of TOKEN_NAMES) {
      expect(theme[token], `theme ${name} thiếu ${token}`).toBeTruthy()
      expect(() => parseHex(theme[token])).not.toThrow()
    }
  })
})

/**
 * WEB-UX-008 / WEB-UX-012 — đo trên token THẬT, cho CẢ HAI theme.
 *
 * Bộ token cũ trượt ở diện rộng: `--c-border` chỉ 1.64:1 (yêu cầu 3:1 cho ranh
 * giới thành phần giao diện) và `--c-warn` 1.18:1 khi dùng làm chữ. Trên một HMI
 * đặt trong phòng máy — ánh sáng gắt, màn hình bám bụi, người trực nhìn chéo —
 * chữ FAULT đọc không ra là một cảnh báo bị bỏ lỡ, không phải chuyện thẩm mỹ.
 *
 * Test này tồn tại để chặn đúng một loại thay đổi: "làm nhạt lại cho đẹp".
 */
describe.each(THEME_NAMES)('theme "%s" đạt WCAG 2.2 AA', (name: ThemeName) => {
  const theme = THEMES[name]

  it.each(TEXT_TOKENS)('%s — chữ, đạt 4.5:1 với mọi nền', (token) => {
    for (const surface of SURFACE_TOKENS) {
      const ratio = contrastRatio(color(theme, token), color(theme, surface))
      expect(ratio, `${token} trên ${surface} chỉ đạt ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })

  it.each(GRAPHIC_TOKENS)('%s — đồ hoạ, đạt 3:1 với mọi nền', (token) => {
    for (const surface of SURFACE_TOKENS) {
      const ratio = contrastRatio(color(theme, token), color(theme, surface))
      expect(ratio, `${token} trên ${surface} chỉ đạt ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_NON_TEXT)
    }
  })

  /* Nút primary và badge đếm cảnh báo đặt chữ trên nền ĐẶC. Không thể gán cứng
     `text-white`: ở theme tối `--c-accent` phải sáng lên để đọc được trên nền
     tối, và khi đó chữ trắng trên nó chỉ còn ~3:1. */
  it('chữ trên nền đặc (--c-on-accent / --c-on-fault) đạt 4.5:1', () => {
    for (const [fill, on] of [['--c-accent', '--c-on-accent'], ['--c-fault', '--c-on-fault']] as Array<[TokenName, TokenName]>) {
      const ratio = contrastRatio(color(theme, fill), color(theme, on))
      expect(ratio, `${on} trên ${fill} chỉ đạt ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })

  it.each(BADGE_VARIANTS)('badge "$state"', ({ fg, fill, bg }) => {
    const textRatio = contrastRatio(color(theme, fg), color(theme, bg))
    expect(textRatio, `chữ ${fg} trên ${bg} chỉ đạt ${textRatio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_TEXT)

    const fillRatio = contrastRatio(color(theme, fill), color(theme, bg))
    expect(fillRatio, `viền/icon ${fill} trên ${bg} chỉ đạt ${fillRatio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_NON_TEXT)
  })

  /**
   * Nền badge phải lệch RA XA chữ, chứ không phải xích lại gần.
   *
   * Đây là lỗi gốc của bản cũ và là lý do 13/14 biến thể trượt: nó tô nền badge
   * bằng `rgba()` của màu tối phủ lên nền xám sáng, nên nền badge tối đi — xích
   * về phía màu chữ — và kéo tụt tương phản của đúng dòng chữ nằm trên nó. Luật
   * đúng: ở theme sáng nền badge phải SÁNG hơn nền trang; ở theme tối phải TỐI
   * hơn màu chữ chính, tức là vẫn nằm ở nửa tối của thang.
   */
  it('nền badge lệch ra xa màu chữ chứ không xích lại gần', () => {
    const page = relativeLuminance(parseHex(color(theme, '--c-bg')))
    const bodyText = relativeLuminance(parseHex(color(theme, '--c-text')))
    for (const variant of BADGE_VARIANTS) {
      const badge = relativeLuminance(parseHex(color(theme, variant.bg)))
      // Nhìn thấy được là badge, không lẫn vào nền trang.
      expect(contrastRatio(color(theme, variant.bg), color(theme, '--c-bg')), `nền badge "${variant.state}" lẫn vào nền trang`).toBeGreaterThan(1.05)
      // Và luôn ở phía đối diện màu chữ chính.
      if (bodyText < page) expect(badge, `nền badge "${variant.state}" tối hơn nền trang trong theme sáng`).toBeGreaterThan(page)
      else expect(badge, `nền badge "${variant.state}" quá sáng, xích về phía màu chữ`).toBeLessThan(bodyText / 2)
    }
  })
})

describe('phủ đủ phạm vi audit đã đo', () => {
  it('kiểm cả 14 biến thể StatusBadge', () => {
    expect(BADGE_VARIANTS).toHaveLength(14)
  })

  it('kiểm cả hai theme', () => {
    expect(THEME_NAMES).toEqual(['light', 'dark'])
  })
})
