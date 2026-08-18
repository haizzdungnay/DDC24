import { BellRing } from 'lucide-react'
import type { Alarm } from '../types'
import { formatDateTime } from '../utils'
import { Button } from './Button'
import { StatusBadge } from './StatusBadge'

function formatAlarmText(str?: string): string {
  if (!str) return ''
  return str.replace(/\b(\d+\.\d{3,})\b/g, (match) => {
    const num = Number(match)
    return Number.isFinite(num) ? num.toFixed(2) : match
  })
}

function triggerText(alarm: Alarm): string {
  if (!alarm.triggerLevel) return ''
  const formattedThreshold = alarm.threshold ? formatAlarmText(String(alarm.threshold)) : ''
  return formattedThreshold ? `${alarm.triggerLevel} ${formattedThreshold}` : alarm.triggerLevel
}

/**
 * Một dòng cảnh báo — UX-DES §12.3.
 *
 * PA3-F10: bản trước bày đủ ba nút Ack/Off/Return cho MỌI vai trò, kể cả
 * `viewer` — bấm vào thì backend trả 403 và người dùng nhận một thông báo lỗi
 * kỹ thuật. Đó là bắt người dùng tự dò ra giới hạn quyền bằng cách va vào nó.
 *
 * Nay các nút vẫn HIỆN (để `viewer` biết hệ thống có những hành động này) nhưng
 * bị khoá kèm `title` nói rõ vai trò cần có — đúng §12.3 "Viewer thấy action
 * disabled nếu cần giữ discoverability" và §10 "disable + giải thích quyền".
 */
export function AlarmRow({
  alarm,
  canAct = true,
  bulkSelected,
  onBulkToggle,
  onAck,
  onSuppress,
  onReturn
}: {
  alarm: Alarm
  canAct?: boolean
  /** `undefined` = không hiện cột chọn (vai trò dưới `operator`). */
  bulkSelected?: boolean
  onBulkToggle?: (alarm: Alarm) => void
  onAck?: (alarm: Alarm) => void
  onSuppress?: (alarm: Alarm) => void
  onReturn?: (alarm: Alarm) => void
}) {
  const state = alarm.severity === 'critical' || alarm.severity === 'high' ? 'fault' : alarm.severity === 'medium' ? 'uncertain' : 'ok'
  const trigger = triggerText(alarm)
  const ackAvailable = alarm.status !== 'acked' && alarm.status !== 'cleared' && alarm.status !== 'shelved'
  const suppressAvailable = alarm.returnable !== false && alarm.status !== 'cleared' && alarm.status !== 'shelved'
  const returnAvailable = alarm.status === 'acked' && alarm.active !== false && alarm.returnable !== false
  const deniedReason = canAct ? undefined : 'Cần vai trò operator trở lên'
  return (
    <div className={`grid items-center gap-3 border-b border-[var(--c-border)] px-3 py-3 text-xs last:border-0 max-lg:grid-cols-1 ${bulkSelected === undefined ? 'grid-cols-[140px_96px_1fr_180px]' : 'grid-cols-[28px_140px_96px_1fr_180px]'}`}>
      {/* T57-1.6 — ô chọn cho xác nhận hàng loạt. Chỉ cảnh báo CHƯA xác nhận
          mới chọn được: ack một cảnh báo đã acked là một request chắc chắn bị
          từ chối, và bày nút cho nó là mời người dùng vào một lỗi. */}
      {bulkSelected !== undefined && (
        <input
          type="checkbox"
          checked={bulkSelected}
          disabled={!ackAvailable || !canAct}
          onChange={() => onBulkToggle?.(alarm)}
          aria-label={`Chọn cảnh báo ${alarm.id} để xác nhận hàng loạt`}
          title={ackAvailable ? undefined : 'Cảnh báo này không ở trạng thái xác nhận được'}
          className="h-4 w-4 accent-[var(--c-accent)] disabled:cursor-not-allowed disabled:opacity-40"
        />
      )}
      <span className="mono text-[var(--c-text-dim)]">{formatDateTime(alarm.time)}</span>
      <StatusBadge state={state} label={alarm.severity.toUpperCase()} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 font-semibold">
          <BellRing className="h-4 w-4 text-[var(--c-accent)]" />
          <span className="min-w-0 truncate">{formatAlarmText(alarm.message)}</span>
          {trigger && (
            <span className="mono shrink-0 rounded border border-[var(--c-warn)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--c-warn-fg)]" title="Triggered threshold">
              TRIP {trigger}
            </span>
          )}
        </div>
        <div className="mt-1 truncate text-[var(--c-text-dim)]">{alarm.source} · {formatAlarmText(alarm.value) || 'n/a'} · {formatAlarmText(alarm.detail)}</div>
      </div>
      <div className="flex flex-wrap justify-end gap-2 max-lg:justify-start">
        <Button size="sm" variant={ackAvailable && canAct ? 'secondary' : 'ghost'} disabled={!ackAvailable || !canAct} title={deniedReason} onClick={() => onAck?.(alarm)}>
          {alarm.status === 'acked' ? 'Acked' : alarm.status === 'cleared' ? 'Cleared' : alarm.status === 'shelved' ? 'Shelved' : 'Ack'}
        </Button>
        {suppressAvailable && <Button size="sm" variant={canAct ? 'danger' : 'ghost'} disabled={!canAct} title={deniedReason} onClick={() => onSuppress?.(alarm)}>Off</Button>}
        {returnAvailable && <Button size="sm" variant="secondary" disabled={!canAct} title={deniedReason} onClick={() => onReturn?.(alarm)}>Return</Button>}
      </div>
    </div>
  )
}
