/**
 * Bảng màu — nguồn chân lý duy nhất (WEB-UX-008 + WEB-UX-012).
 *
 * ## Vì sao token nằm ở TypeScript chứ không phải trong `styles.css`
 *
 * Hai lý do, cả hai đều cụ thể:
 *
 * 1. **Kiểm được bằng test.** Yêu cầu của plan 45 §8.1 là test tương phản chạy
 *    trên *token thật*, không phải trên một bản chép tay. Nếu token nằm trong
 *    CSS thì test buộc phải đọc file — mà `?raw` bị plugin Tailwind nuốt, còn
 *    `node:fs` thì kéo theo `@types/node`. Để token ở TS là bỏ hẳn lớp trung
 *    gian: test import đúng đối tượng mà ứng dụng dùng.
 * 2. **Hai theme dùng chung một hình dạng.** `ThemeTokens` là `Record` có khoá
 *    cố định, nên thiếu một token ở theme tối là lỗi biên dịch chứ không phải
 *    một ô màu trống phát hiện ra lúc chạy.
 *
 * ## Hai luật màu (kiểm tự động ở `contrast.test.ts`)
 *
 * - Token dùng làm **chữ** → ≥ 4.5:1 với cả ba nền (`bg`, `surface`, `surface-2`)
 *   *và* với nền badge cùng màu — WCAG 2.2 §1.4.3.
 * - Token dùng làm **đồ hoạ** (viền, icon, chấm chỉ báo) → ≥ 3:1 — WCAG 2.2 §1.4.11.
 *
 * ## `--c-*-bg` và `--c-on-*`
 *
 * `--c-*-bg` là nền tô của badge/callout, và là **màu đặc**, không phải `rgba()`
 * phủ lên nền. Bản trước dùng `rgba(213,32,42,0.10)` kiểu này và tự bắn vào chân
 * mình: phủ một màu tối lên nền xám làm nền TỐI ĐI, kéo tụt tương phản của đúng
 * dòng chữ đặt trên đó — 13/14 biến thể `StatusBadge` trượt 4.5:1. Ở theme sáng
 * nền tô pha về phía trắng, ở theme tối pha về phía nền trang; cả hai trường hợp
 * chữ đều còn dư khoảng.
 *
 * `--c-on-accent` / `--c-on-fault` là màu chữ đặt TRÊN nền đặc của nút primary
 * và badge đếm cảnh báo. Không thể gán cứng `text-white`: ở theme tối `--c-accent`
 * sáng lên để đọc được trên nền tối, và khi đó chữ trắng trên nó chỉ còn 3.03:1.
 */

export const THEME_NAMES = ['light', 'dark'] as const
export type ThemeName = typeof THEME_NAMES[number]

export const TOKEN_NAMES = [
  '--c-bg', '--c-surface', '--c-surface-2', '--c-border', '--c-line-strong',
  '--c-text', '--c-text-dim',
  '--c-accent', '--c-accent-2', '--c-info',
  '--c-good', '--c-good-fg', '--c-warn', '--c-warn-fg', '--c-fault', '--c-fault-fg',
  '--c-critical', '--c-force', '--c-off',
  '--c-indicator-ok', '--c-indicator-off',
  '--c-good-bg', '--c-warn-bg', '--c-fault-bg', '--c-critical-bg', '--c-force-bg', '--c-off-bg', '--c-accent-bg',
  '--c-on-accent', '--c-on-fault'
] as const

export type TokenName = typeof TOKEN_NAMES[number]
export type ThemeTokens = Record<TokenName, string>

const LIGHT: ThemeTokens = {
  '--c-bg': '#C8CCD0',
  '--c-surface': '#D8DBDE',
  '--c-surface-2': '#C2C6CA',
  '--c-border': '#636970',
  '--c-line-strong': '#4C5056',
  '--c-text': '#1C1F23',
  '--c-text-dim': '#4A4F55',
  '--c-accent': '#26527C',
  '--c-accent-2': '#26527C',
  '--c-info': '#26527C',
  '--c-good': '#227742',
  '--c-good-fg': '#165B2E',
  '--c-warn': '#826500',
  '--c-warn-fg': '#634D00',
  '--c-fault': '#CC1F28',
  '--c-fault-fg': '#A01017',
  '--c-critical': '#901380',
  '--c-force': '#693797',
  '--c-off': '#4B505A',
  '--c-indicator-ok': '#227742',
  '--c-indicator-off': '#636976',
  '--c-good-bg': '#E0ECE5',
  '--c-warn-bg': '#EEE9DB',
  '--c-fault-bg': '#F7E0E1',
  '--c-critical-bg': '#EFDDED',
  '--c-force-bg': '#E9E3F1',
  '--c-off-bg': '#E5E6E8',
  '--c-accent-bg': '#E0E6EC',
  '--c-on-accent': '#FFFFFF',
  '--c-on-fault': '#FFFFFF'
}

const DARK: ThemeTokens = {
  '--c-bg': '#14171A',
  '--c-surface': '#1D2125',
  '--c-surface-2': '#262B30',
  '--c-border': '#7C838B',
  '--c-line-strong': '#9AA0A6',
  '--c-text': '#EDEFF2',
  '--c-text-dim': '#9AA0A6',
  '--c-accent': '#5698DC',
  '--c-accent-2': '#5698DC',
  '--c-info': '#5698DC',
  '--c-good': '#2FA45A',
  '--c-good-fg': '#30A85C',
  '--c-warn': '#E8B500',
  '--c-warn-fg': '#E8B500',
  '--c-fault': '#E5484D',
  '--c-fault-fg': '#EA6A6E',
  '--c-critical': '#D96FC8',
  '--c-force': '#B084E8',
  '--c-off': '#9AA0A6',
  '--c-indicator-ok': '#2FA45A',
  '--c-indicator-off': '#7C838B',
  '--c-good-bg': '#193026',
  '--c-warn-bg': '#3A3315',
  '--c-fault-bg': '#3A2023',
  '--c-critical-bg': '#372739',
  '--c-force-bg': '#302B3F',
  '--c-off-bg': '#2C3033',
  '--c-accent-bg': '#1E2D3C',
  '--c-on-accent': '#0E1114',
  '--c-on-fault': '#14171A'
}

export const THEMES: Record<ThemeName, ThemeTokens> = { light: LIGHT, dark: DARK }

/** Nền mà nội dung có thể nằm lên. Mọi token phải đạt ngưỡng với cả ba. */
export const SURFACE_TOKENS: TokenName[] = ['--c-bg', '--c-surface', '--c-surface-2']

export const TEXT_TOKENS: TokenName[] = [
  '--c-text', '--c-text-dim', '--c-accent', '--c-accent-2', '--c-info',
  '--c-good-fg', '--c-warn-fg', '--c-fault-fg', '--c-critical', '--c-force', '--c-off', '--c-line-strong'
]

export const GRAPHIC_TOKENS: TokenName[] = [
  '--c-border', '--c-good', '--c-warn', '--c-fault', '--c-indicator-ok', '--c-indicator-off'
]

/**
 * 14 biến thể `StatusBadge`, ánh xạ đúng như `badgeBackground()` trong
 * components/StatusBadge.tsx và `statusColor()` / `statusFill()` trong utils.ts.
 * Đây là bảng mà audit UI/UX đo được 13/14 trượt AA.
 */
export const BADGE_VARIANTS: Array<{ state: string; fg: TokenName; fill: TokenName; bg: TokenName }> = [
  { state: 'normal', fg: '--c-good-fg', fill: '--c-good', bg: '--c-good-bg' },
  { state: 'ok', fg: '--c-good-fg', fill: '--c-good', bg: '--c-good-bg' },
  { state: 'online', fg: '--c-good-fg', fill: '--c-good', bg: '--c-good-bg' },
  { state: 'live', fg: '--c-good-fg', fill: '--c-good', bg: '--c-good-bg' },
  { state: 'connected', fg: '--c-good-fg', fill: '--c-good', bg: '--c-good-bg' },
  { state: 'degraded', fg: '--c-warn-fg', fill: '--c-warn', bg: '--c-warn-bg' },
  { state: 'uncertain', fg: '--c-warn-fg', fill: '--c-warn', bg: '--c-warn-bg' },
  { state: 'stale', fg: '--c-warn-fg', fill: '--c-warn', bg: '--c-warn-bg' },
  { state: 'fault', fg: '--c-fault-fg', fill: '--c-fault', bg: '--c-fault-bg' },
  { state: 'offline', fg: '--c-fault-fg', fill: '--c-fault', bg: '--c-fault-bg' },
  { state: 'alarm', fg: '--c-fault-fg', fill: '--c-fault', bg: '--c-fault-bg' },
  { state: 'critical', fg: '--c-critical', fill: '--c-critical', bg: '--c-critical-bg' },
  { state: 'forced', fg: '--c-force', fill: '--c-force', bg: '--c-force-bg' },
  { state: 'unknown', fg: '--c-off', fill: '--c-off', bg: '--c-off-bg' }
]

/** Ghi toàn bộ token của một theme lên `:root`. */
export function applyTheme(theme: ThemeName, root: HTMLElement = document.documentElement): void {
  const tokens = THEMES[theme]
  for (const name of TOKEN_NAMES) root.style.setProperty(name, tokens[name])
  // `color-scheme` để trình duyệt vẽ scrollbar và form control gốc theo đúng
  // theme; thiếu nó, ô nhập ở theme tối vẫn ra nền trắng chói.
  root.style.setProperty('color-scheme', theme)
  root.dataset.theme = theme
}
