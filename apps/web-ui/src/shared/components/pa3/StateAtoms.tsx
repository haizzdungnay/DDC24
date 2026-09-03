import { AlertOctagon, AlertTriangle, CheckCircle2, CircleHelp, Info, Lock, WifiOff } from 'lucide-react'
import type { ComponentType } from 'react'
import type { AttentionSeverity, OverviewHealthState, PointQuality } from '../../types'
import { cn } from '../../utils'

/**
 * Primitive trạng thái PA3 — PA3-201.
 *
 * LUẬT CHUNG (UX-REQ §9.1, §11 và WCAG 2.2 AA)
 *
 *  1. Màu KHÔNG BAO GIỜ là dấu hiệu duy nhất: mỗi trạng thái luôn có nhãn chữ
 *     và một icon riêng hình dạng khác nhau.
 *  2. `unknown` là một trạng thái RIÊNG, không phải `good` và cũng không phải
 *     `fault`. Gộp nó vào đâu cũng là nói dối: một là "ổn" khi ta không biết,
 *     hai là "hỏng" khi có thể chỉ là chưa cấu hình.
 *  3. `stale`, `offline`, `bad`, `unknown` có bốn cách trình bày khác nhau —
 *     đúng yêu cầu §22 "không dùng cùng một visual cho cả 4 state".
 */

type Visual = {
  label: string
  icon: ComponentType<{ className?: string }>
  fg: string
  bg: string
  border: string
}

const healthVisuals: Record<OverviewHealthState, Visual> = {
  good: { label: 'GOOD', icon: CheckCircle2, fg: 'var(--c-good-fg)', bg: 'var(--c-good-bg)', border: 'var(--c-good)' },
  degraded: { label: 'DEGRADED', icon: AlertTriangle, fg: 'var(--c-warn-fg)', bg: 'var(--c-warn-bg)', border: 'var(--c-warn)' },
  fault: { label: 'FAULT', icon: AlertOctagon, fg: 'var(--c-fault-fg)', bg: 'var(--c-fault-bg)', border: 'var(--c-fault)' },
  offline: { label: 'OFFLINE', icon: WifiOff, fg: 'var(--c-text-dim)', bg: 'var(--c-off-bg)', border: 'var(--c-off)' },
  unknown: { label: 'UNKNOWN', icon: CircleHelp, fg: 'var(--c-text-dim)', bg: 'var(--c-off-bg)', border: 'var(--c-border)' }
}

const severityVisuals: Record<AttentionSeverity, Visual> = {
  critical: { label: 'CRITICAL', icon: AlertOctagon, fg: 'var(--c-critical)', bg: 'var(--c-critical-bg)', border: 'var(--c-critical)' },
  high: { label: 'HIGH', icon: AlertTriangle, fg: 'var(--c-fault-fg)', bg: 'var(--c-fault-bg)', border: 'var(--c-fault)' },
  medium: { label: 'MEDIUM', icon: AlertTriangle, fg: 'var(--c-warn-fg)', bg: 'var(--c-warn-bg)', border: 'var(--c-warn)' },
  low: { label: 'LOW', icon: Info, fg: 'var(--c-info)', bg: 'var(--c-accent-bg)', border: 'var(--c-accent)' },
  info: { label: 'INFO', icon: Info, fg: 'var(--c-text-dim)', bg: 'var(--c-off-bg)', border: 'var(--c-border)' }
}

const qualityVisuals: Record<PointQuality, Visual> = {
  good: { label: 'GOOD', icon: CheckCircle2, fg: 'var(--c-good-fg)', bg: 'var(--c-good-bg)', border: 'var(--c-good)' },
  uncertain: { label: 'UNCERTAIN', icon: CircleHelp, fg: 'var(--c-warn-fg)', bg: 'var(--c-warn-bg)', border: 'var(--c-warn)' },
  bad: { label: 'BAD', icon: AlertOctagon, fg: 'var(--c-fault-fg)', bg: 'var(--c-fault-bg)', border: 'var(--c-fault)' },
  stale: { label: 'STALE', icon: AlertTriangle, fg: 'var(--c-warn-fg)', bg: 'var(--c-warn-bg)', border: 'var(--c-warn)' },
  offline: { label: 'OFFLINE', icon: WifiOff, fg: 'var(--c-text-dim)', bg: 'var(--c-off-bg)', border: 'var(--c-off)' },
  /* `ISS-PIO-35`: hai mức mà FE trước đây hạ về GOOD.
   *
   * `config_error` mang màu fault vì nó là một lỗi CÓ THẬT và sửa được — cấu
   * hình sai nên chưa từng hỏi thiết bị. `unknown` mang màu "tắt/không biết"
   * chứ không phải màu tốt: nó không khẳng định hỏng, nhưng cũng tuyệt đối
   * không được trông giống một số đo tin được. */
  config_error: { label: 'CONFIG ERROR', icon: AlertOctagon, fg: 'var(--c-fault-fg)', bg: 'var(--c-fault-bg)', border: 'var(--c-fault)' },
  unknown: { label: 'UNKNOWN', icon: CircleHelp, fg: 'var(--c-text-dim)', bg: 'var(--c-off-bg)', border: 'var(--c-off)' }
}

const chipClass = 'inline-flex items-center gap-1.5 rounded-[var(--radius)] border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide'

function Chip({ visual, text, className, title }: { visual: Visual; text?: string; className?: string; title?: string }) {
  const Glyph = visual.icon
  return (
    <span className={cn(chipClass, className)} style={{ color: visual.fg, backgroundColor: visual.bg, borderColor: visual.border }} title={title}>
      <Glyph className="h-3.5 w-3.5" aria-hidden="true" />
      {text ?? visual.label}
    </span>
  )
}

export function healthStateLabel(state: OverviewHealthState): string {
  return healthVisuals[state]?.label ?? healthVisuals.unknown.label
}

export function HealthChip({ state, className, title }: { state: OverviewHealthState; className?: string; title?: string }) {
  return <Chip visual={healthVisuals[state] ?? healthVisuals.unknown} className={className} title={title} />
}

export function SeverityBadge({ severity, count, className }: { severity: AttentionSeverity; count?: number; className?: string }) {
  const visual = severityVisuals[severity] ?? severityVisuals.info
  return <Chip visual={visual} text={count === undefined ? visual.label : `${visual.label} ${count}`} className={className} />
}

export function QualityBadge({ quality, reason, className }: { quality: PointQuality; reason?: string; className?: string }) {
  const visual = qualityVisuals[quality] ?? qualityVisuals.uncertain
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Chip visual={visual} className={className} />
      {/* Lý do đến TỪ producer và hiện nguyên văn (D-07): không dịch, không suy diễn. */}
      {reason && <span className="text-[11px] text-[var(--c-text-dim)]">{reason}</span>}
    </span>
  )
}

export function ForcedBadge({ remainingLabel }: { remainingLabel?: string }) {
  return (
    <span
      className={chipClass}
      style={{ color: 'var(--c-force)', backgroundColor: 'var(--c-force-bg)', borderColor: 'var(--c-force)' }}
    >
      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
      {remainingLabel ? `ÉP TAY · ${remainingLabel}` : 'ÉP TAY'}
    </span>
  )
}

export const HEALTH_DOMAIN_LABELS: Record<string, { vi: string; en: string }> = {
  controller: { vi: 'Bộ điều khiển', en: 'Controller' },
  local_io: { vi: 'I/O tại chỗ', en: 'Local I/O' },
  modbus: { vi: 'Modbus RTU', en: 'Modbus RTU' },
  network: { vi: 'Mạng', en: 'Network' },
  historian: { vi: 'Lịch sử dữ liệu', en: 'Historian' }
}

/** Diễn giải `reasonCode` sang tiếng Việt cho người vận hành.
 *
 *  Mã nào chưa có bản dịch thì HIỆN NGUYÊN MÃ, không nuốt: một mã lạ trên màn
 *  hình còn dẫn được về source, còn một ô trống thì không. */
export const HEALTH_REASON_LABELS: Record<string, string> = {
  ok: 'Bình thường',
  core_unreachable: 'Không liên lạc được với core',
  core_partial_read: 'Đọc core không đầy đủ',
  points_unreadable: 'Không đọc được bảng điểm',
  no_points_reported: 'Authority không trả điểm nào',
  no_local_points: 'Không có điểm I/O tại chỗ',
  bad_quality_points: 'Có điểm chất lượng BAD',
  stale_points: 'Có điểm stale/offline',
  not_configured: 'Chưa cấu hình',
  telemetry_unpublished: 'iobus chưa publish telemetry',
  bus_not_open: 'Bus không mở được',
  slave_offline: 'Thiết bị slave offline',
  no_ipv4_address: 'Chưa có địa chỉ IPv4',
  historian_disabled: 'Historian chưa bật',
  policy_unreadable: 'Không đọc được cấu hình historian',
  no_logged_points: 'Chưa bật ghi lịch sử',
  policy_unhealthy: 'Có điểm ghi lịch sử lỗi',
  critical_alarm_active: 'Đang có cảnh báo Critical',
  high_alarm_active: 'Đang có cảnh báo High',
  point_quality_degraded: 'Chất lượng điểm suy giảm'
}

export const HEALTH_REASON_LABELS_EN: Record<string, string> = {
  ok: 'Normal',
  core_unreachable: 'Cannot reach core',
  core_partial_read: 'Incomplete core read',
  points_unreadable: 'Could not read the point table',
  no_points_reported: 'Authority reported no points',
  no_local_points: 'No local I/O points',
  bad_quality_points: 'Some points have BAD quality',
  stale_points: 'Some points are stale/offline',
  not_configured: 'Not configured',
  telemetry_unpublished: 'iobus has not published telemetry',
  bus_not_open: 'Bus could not open',
  slave_offline: 'Slave device offline',
  no_ipv4_address: 'No IPv4 address yet',
  historian_disabled: 'Historian is disabled',
  policy_unreadable: 'Could not read historian config',
  no_logged_points: 'History logging not enabled',
  policy_unhealthy: 'Some logged points are unhealthy',
  critical_alarm_active: 'A Critical alarm is active',
  high_alarm_active: 'A High alarm is active',
  point_quality_degraded: 'Point quality is degraded'
}

export function healthReasonLabel(reasonCode: string, lang: 'vi' | 'en' = 'vi'): string {
  if (!reasonCode) return '—'
  const labels = lang === 'en' ? HEALTH_REASON_LABELS_EN : HEALTH_REASON_LABELS
  return labels[reasonCode] ?? reasonCode
}
