/**
 * Tính tương phản theo đúng công thức WCAG 2.2 — WEB-UX-008.
 *
 * Nguồn: WCAG 2.2, định nghĩa "relative luminance" và "contrast ratio".
 * Không dùng thư viện ngoài: công thức chỉ vài dòng, và một dependency mới trong
 * bundle của thiết bị nhúng phải trả giá bằng dung lượng eMMC.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

export function parseHex(value: string): Rgb {
  const hex = value.trim().replace(/^#/, '')
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Không phải mã màu hex hợp lệ: "${value}"`)
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16)
  }
}

/** WCAG 2.2 — relative luminance. */
export function relativeLuminance(color: Rgb): number {
  const channel = (raw: number) => {
    const c = raw / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

/** WCAG 2.2 — contrast ratio, trả về giá trị trong [1, 21]. */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const first = typeof a === 'string' ? parseHex(a) : a
  const second = typeof b === 'string' ? parseHex(b) : b
  const la = relativeLuminance(first)
  const lb = relativeLuminance(second)
  const light = Math.max(la, lb)
  const dark = Math.min(la, lb)
  return (light + 0.05) / (dark + 0.05)
}

/** Ngưỡng WCAG 2.2 AA. */
export const AA_TEXT = 4.5
export const AA_NON_TEXT = 3.0
