import { AlertTriangle, Ban, CheckCircle2, HelpCircle, History, RefreshCw, XCircle } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'

/**
 * `T60-104` — bảy trạng thái ngữ nghĩa dùng chung của FE Handoff v2.1 (README
 * §3, mục *Shared semantic states*).
 *
 * VÌ SAO CẦN MỘT MODULE RIÊNG
 * ---------------------------
 * `StatusBadge` (`shared/components/StatusBadge.tsx`) đang mang một tập trạng
 * thái KHÁC, sinh ra từ nhu cầu của trang Point/Alarm: `online/off/on/fault/
 * stale/unknown/degraded/uncertain/inactive/…`. Tập đó không có `reconciling`
 * (đang đối soát) và không có `disabled` (bị tắt CÓ CHỦ ĐÍCH) — hai trạng thái
 * mà Programming bắt buộc phải nói được:
 *
 * - `reconciling`: theo README §5.5 và Plan 59 §1.2, **timeout không bao giờ
 *   được suy thành thành công**. Không có trạng thái này thì một mutation hết
 *   giờ chỉ còn hai chỗ để rơi vào — "lỗi" (sai, vì lệnh có thể đã tới nơi)
 *   hoặc "xong" (sai nguy hiểm).
 * - `disabled`: một Program bị tắt có chủ đích KHÔNG phải lỗi và cũng không
 *   phải "mất tín hiệu". Gộp nó vào `unknown`/`fault` là dạy người vận hành
 *   một thông tin sai.
 *
 * Module này KHÔNG mở rộng `StatusBadge` — nó ánh xạ bảy trạng thái ngữ nghĩa
 * lên tập badge sẵn có, để một lần sửa bảng màu vẫn là một nguồn duy nhất.
 *
 * MÀU KHÔNG BAO GIỜ LÀ TÍN HIỆU DUY NHẤT (README §3)
 * --------------------------------------------------
 * Mỗi trạng thái ở đây bắt buộc mang CẢ icon lẫn chữ. `semanticState.test.ts`
 * ép điều đó: thiếu một trong hai là test đỏ, không phải là một thiếu sót phát
 * hiện được bằng mắt lúc review.
 */
export const SEMANTIC_STATES = ['good', 'warning', 'fault', 'unknown', 'stale', 'disabled', 'reconciling'] as const

export type SemanticState = typeof SEMANTIC_STATES[number]

/** Tập con của `BadgeState` mà `StatusBadge` đã hiểu sẵn — không thêm giá trị mới. */
export type SemanticBadgeState = 'good' | 'warning' | 'fault' | 'unknown' | 'stale' | 'inactive' | 'uncertain'

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

export interface SemanticStateDescriptor {
  state: SemanticState
  /** State truyền thẳng cho `<StatusBadge state={…} />`. */
  badgeState: SemanticBadgeState
  /** Icon bắt buộc — tín hiệu thứ hai bên cạnh màu. */
  icon: IconComponent
  /** Nhãn `[vi, en]`; dùng với `useI18n().pick` để giữ một ngôn ngữ tại một thời điểm (D-06). */
  label: readonly [string, string]
  /** Mô tả ngắn `[vi, en]` cho `title`/`aria-label` khi chỉ có chỗ cho icon. */
  hint: readonly [string, string]
}

/**
 * Ánh xạ chốt. Ba lựa chọn đáng giải thích:
 *
 * - `disabled → 'inactive'`: `inactive` đã nằm trong nhóm màu `off` của
 *   `statusBucket`, đúng nghĩa "không chạy nhưng không có gì sai".
 * - `reconciling → 'uncertain'`: nhóm màu `warn`, đúng nghĩa "chưa kết luận
 *   được" — khác hẳn `fault` (đã kết luận là hỏng).
 * - `stale` giữ nguyên `stale`: badge đã có sẵn, không cần ánh xạ chéo.
 */
const DESCRIPTORS: Readonly<Record<SemanticState, SemanticStateDescriptor>> = {
  good: {
    state: 'good',
    badgeState: 'good',
    icon: CheckCircle2,
    label: ['Bình thường', 'Good'],
    hint: ['Đang hoạt động đúng, không có dấu hiệu bất thường.', 'Operating normally with no abnormal signal.']
  },
  warning: {
    state: 'warning',
    badgeState: 'warning',
    icon: AlertTriangle,
    label: ['Cảnh báo', 'Warning'],
    hint: ['Vẫn chạy nhưng có dấu hiệu cần xem lại.', 'Still running but showing a signal worth reviewing.']
  },
  fault: {
    state: 'fault',
    badgeState: 'fault',
    icon: XCircle,
    label: ['Lỗi', 'Fault'],
    hint: ['Đã kết luận là lỗi; cần xử lý.', 'Concluded as a fault; action is required.']
  },
  unknown: {
    state: 'unknown',
    badgeState: 'unknown',
    icon: HelpCircle,
    label: ['Chưa rõ', 'Unknown'],
    hint: ['Không đọc được trạng thái từ nguồn có thẩm quyền.', 'The authoritative source did not provide a state.']
  },
  stale: {
    state: 'stale',
    badgeState: 'stale',
    icon: History,
    label: ['Dữ liệu cũ', 'Stale'],
    hint: ['Giá trị đang xem là lần đọc trước, không phải giá trị sống.', 'The value shown is a previous read, not a live one.']
  },
  disabled: {
    state: 'disabled',
    badgeState: 'inactive',
    icon: Ban,
    label: ['Đã tắt', 'Disabled'],
    hint: ['Bị tắt có chủ đích — không phải lỗi.', 'Intentionally turned off — this is not a fault.']
  },
  reconciling: {
    state: 'reconciling',
    badgeState: 'uncertain',
    icon: RefreshCw,
    label: ['Đang đối soát', 'Reconciling'],
    hint: ['Chưa xác định kết quả; không suy thành thành công.', 'The result is undetermined; it is not assumed to have succeeded.']
  }
}

export function semanticStateDescriptor(state: SemanticState): SemanticStateDescriptor {
  return DESCRIPTORS[state]
}

/** Nhãn theo đúng ngôn ngữ đang chọn — D-06, không in song ngữ cứng. */
export function semanticStateLabel(pick: (vi: string, en: string) => string, state: SemanticState): string {
  const [vi, en] = DESCRIPTORS[state].label
  return pick(vi, en)
}

export function semanticStateHint(pick: (vi: string, en: string) => string, state: SemanticState): string {
  const [vi, en] = DESCRIPTORS[state].hint
  return pick(vi, en)
}

/**
 * Props sẵn sàng trải vào `<StatusBadge {...semanticBadgeProps(pick, state)} />`.
 * `label` luôn có chữ, nên badge không bao giờ chỉ còn màu — `StatusBadge` tự
 * kèm icon của nó; `icon` trong descriptor dành cho chỗ nào cần vẽ riêng
 * (bảng, hero) mà không dùng badge.
 */
export function semanticBadgeProps(
  pick: (vi: string, en: string) => string,
  state: SemanticState,
  overrideLabel?: string
): { state: SemanticBadgeState; label: string; title: string } {
  return {
    state: DESCRIPTORS[state].badgeState,
    label: overrideLabel ?? semanticStateLabel(pick, state),
    title: semanticStateHint(pick, state)
  }
}
