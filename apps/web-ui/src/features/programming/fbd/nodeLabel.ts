import type { FbdDataType, FbdNodeKind, FbdParameterValue } from './model'
import { FBD_NODE_WIDTH } from './geometry'

/**
 * `T59-806` / `CB-5` — Cắt ngắn nhãn node và port để chống tràn khung node trên canvas FBD.
 *
 * Cách tính ngưỡng từ `FBD_NODE_WIDTH`:
 * - `FBD_NODE_WIDTH` = 168 px.
 * - Trừ khoảng đệm tâm port và vòng tròn port ở hai bên:
 *   10 px bên trái (port INPUT cx + 10) và 10 px bên phải (port OUTPUT cx - 10).
 * - Bề rộng khả dụng tối đa cho text trong node: `168 - 20 = 148 px`.
 * - Ở kích thước chữ 10px (`text-[10px]` sans-serif), độ rộng trung bình ~6.5 px/ký tự.
 * - Ngưỡng ký tự an toàn: `Math.floor(148 / 6.5) = 22` ký tự.
 */
export const FBD_LABEL_INNER_WIDTH = FBD_NODE_WIDTH - 20
export const FBD_LABEL_APPROX_CHAR_WIDTH = 6.5
export const FBD_LABEL_MAX_CHARS = Math.floor(FBD_LABEL_INNER_WIDTH / FBD_LABEL_APPROX_CHAR_WIDTH)

/**
 * Cắt chuỗi thuần túy nếu vượt quá số ký tự tối đa.
 * ponytail: Cắt ngắn đơn giản theo số ký tự; nâng cấp lên đo pixel DOM thật nếu mở rộng FBD_NODE_WIDTH động ở Task sau.
 */
export function truncateText(text: string, maxChars: number = FBD_LABEL_MAX_CHARS): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`
}

/**
 * `C1` / `CB-5` — Định dạng nhãn port dạng `name : TYPE (unit)`.
 * Giữ nguyên `name` đầy đủ; phần ` : TYPE (unit)` chỉ vẽ khi tổng ký tự <= ngưỡng.
 * Vượt ngưỡng thì cắt bằng dấu `…` sau `name`.
 */
export function formatPortLabel(
  name: string,
  dataType?: FbdDataType | string | null,
  unit?: string | null,
  maxChars: number = FBD_LABEL_MAX_CHARS,
): string {
  if (!dataType) return name
  const cleanUnit = unit?.trim()
  const suffix = cleanUnit ? ` : ${dataType} (${cleanUnit})` : ` : ${dataType}`
  const full = `${name}${suffix}`
  if (full.length <= maxChars) return full
  return `${name}…`
}

/**
 * `C2` / `CB-5` — Tóm tắt parameter của node hiển thị dưới `kind`:
 * - `INPUT`/`OUTPUT` => `parameters.variable`
 * - `CONSTANT` => `parameters.value`
 * - `FUNCTION_BLOCK` => `parameters.instance`
 * Thiếu hoặc kind khác => trả về null (để trống, không render chuỗi mẫu).
 */
export function formatNodeParameterSummary(
  kind: FbdNodeKind,
  parameters?: Record<string, FbdParameterValue> | null,
  maxChars: number = FBD_LABEL_MAX_CHARS,
): string | null {
  if (!parameters) return null

  let raw: string | null = null
  if (kind === 'INPUT' || kind === 'OUTPUT') {
    const v = parameters.variable
    if (typeof v === 'string' && v.trim() !== '') {
      raw = v.trim()
    }
  } else if (kind === 'CONSTANT') {
    const v = parameters.value
    if (v !== undefined && v !== null) {
      const s = String(v).trim()
      if (s !== '') raw = s
    }
  } else if (kind === 'FUNCTION_BLOCK') {
    const v = parameters.instance
    if (typeof v === 'string' && v.trim() !== '') {
      raw = v.trim()
    }
  }

  if (!raw) return null
  return truncateText(raw, maxChars)
}
