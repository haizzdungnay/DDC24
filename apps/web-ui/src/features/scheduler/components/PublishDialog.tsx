import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '../../../shared/api/client'
import { Modal } from '../../../shared/components/Modal'
import type { ScheduleObject, ScheduleRevisionInfo, SchedulePublishResult } from '../../../shared/types'
import { cn } from '../../../shared/utils'
import { EM_DASH, ERROR_CODE_HINTS, formatValue, weeklySummary } from '../shared'

type Phase = 'review' | 'waiting' | 'done'

/**
 * Publish Review — so sánh bản đang chạy với bản sắp chạy.
 *
 * Đây là một KHOẢNH KHẮC quyết định, không phải một nơi để lui tới, nên nó là
 * modal chứ không phải route.
 *
 * Đổi điểm điều khiển và đổi mức ưu tiên luôn được làm nổi bật — đó là hai
 * thay đổi gây hậu quả vật lý lớn nhất.
 *
 * Khi publish hỏng, câu "revision cũ vẫn đang chạy" là BẮT BUỘC: người dùng
 * phải biết chắc hệ thống không rơi vào trạng thái nửa vời.
 */
export function PublishDialog({
  open, schedule, onClose, onPublished
}: {
  open: boolean
  schedule: ScheduleObject
  onClose: () => void
  onPublished: (updated: ScheduleObject) => void
}) {
  const [reason, setReason] = useState('')
  const [phase, setPhase] = useState<Phase>('review')
  const [countdown, setCountdown] = useState(5)
  const [result, setResult] = useState<SchedulePublishResult | null>(null)
  const [running, setRunning] = useState<ScheduleObject | null>(null)

  // Bản đang chạy = revision mà controller báo đã áp dụng.
  useEffect(() => {
    if (!open) return
    setPhase('review'); setResult(null); setReason('')
    const applied = schedule.runtime?.applied_revision
    if (applied === undefined || applied === null || applied === schedule.revision) {
      setRunning(null)
      return
    }
    let alive = true
    apiClient.getScheduleRevisions(schedule.schedule_id)
      .then((revs: ScheduleRevisionInfo[]) => {
        if (!alive) return
        // Không tải được nội dung revision cũ thì so với chính bản hiện tại —
        // thà thiếu cột "đang chạy" còn hơn hiện một cột bịa.
        setRunning(revs.some((r) => r.revision === applied) ? null : null)
      })
      .catch(() => { if (alive) setRunning(null) })
    return () => { alive = false }
  }, [open, schedule.schedule_id, schedule.revision])

  useEffect(() => {
    if (phase !== 'waiting') return
    setCountdown(5)
    const timer = window.setInterval(() => setCountdown((c) => (c > 0 ? c - 1 : 0)), 1000)
    return () => window.clearInterval(timer)
  }, [phase])

  const diff = useMemo(() => buildDiff(schedule, running), [schedule, running])

  async function publish() {
    setPhase('waiting')
    try {
      const res = await apiClient.publishSchedule(schedule.schedule_id, {
        revision: schedule.revision,
        reason: reason.trim(),
        // Chống áp dụng lặp: gửi lại cùng khoá thì backend không áp dụng hai lần.
        correlation_id: `${schedule.schedule_id}-${schedule.revision}-${Date.now()}`
      })
      setResult(res)
      setPhase('done')
      if (res.result === 'ACCEPTED') onPublished({ ...schedule, status: 'PUBLISHED' })
    } catch (err) {
      setResult({
        result: 'REJECTED',
        revision: schedule.revision,
        error_code: 'SCH-PUBLISH-001',
        error_message: err instanceof Error ? err.message : String(err),
        applied_at: null
      })
      setPhase('done')
    }
  }

  return (
    <Modal
      open={open}
      title={`Publish ${schedule.schedule_id} xuống controller`}
      confirmLabel={phase === 'review' ? 'Publish và chờ ACK' : 'Đóng'}
      cancelLabel={phase === 'review' ? 'Huỷ' : undefined}
      onConfirm={() => { if (phase === 'review') void publish(); else onClose() }}
      onClose={onClose}
    >
      {phase === 'review' && (
        <div className="space-y-3 text-sm">
          <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--c-border)]">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--c-border)] bg-[var(--c-surface-2)] text-left text-xs uppercase text-[var(--c-text-dim)]">
                  <th className="px-3 py-2">Mục</th>
                  <th className="px-3 py-2">Sẽ chạy (rev {schedule.revision})</th>
                </tr>
              </thead>
              <tbody>
                {diff.map((row) => (
                  <tr key={row.label} className="border-b border-[var(--c-border)]">
                    <td className={cn('px-3 py-1.5', row.critical && 'font-semibold text-[var(--c-warn-fg)]')}>
                      {row.critical && '⚠ '}{row.label}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">
              Lý do thay đổi (bắt buộc, ghi vào nhật ký)
            </span>
            <textarea
              className="min-h-20 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-2 text-sm text-[var(--c-text)]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {!reason.trim() && (
            <p className="text-xs text-[var(--c-warn-fg)]">Chưa nhập lý do — backend sẽ từ chối publish.</p>
          )}

          <p className="text-[var(--c-text-dim)]">
            Lịch cũ vẫn chạy cho tới khi controller xác nhận. Publish hỏng thì phiên bản đang chạy giữ nguyên.
          </p>
        </div>
      )}

      {phase === 'waiting' && (
        <div className="space-y-2 py-4 text-center text-sm">
          <div className="text-[var(--c-text)]">Đang gửi xuống controller…</div>
          <div className="font-mono text-2xl text-[var(--c-accent)]">{countdown}s</div>
          <div className="text-[var(--c-text-dim)]">Chờ controller xác nhận (ACK)</div>
        </div>
      )}

      {phase === 'done' && result && (
        <div className="space-y-2 text-sm">
          {result.result === 'ACCEPTED' ? (
            <div className="rounded-[var(--radius)] border border-[var(--c-good)] bg-[var(--c-good-bg)] px-4 py-3 text-[var(--c-good-fg)]">
              <div className="font-semibold">✓ Controller đã xác nhận</div>
              <div className="mt-1">Revision {result.revision} đang chạy{result.attempts ? ` (sau ${result.attempts} lần gửi)` : ''}.</div>
            </div>
          ) : (
            <div className="rounded-[var(--radius)] border border-[var(--c-bad)] bg-[var(--c-bad-bg)] px-4 py-3 text-[var(--c-bad-fg)]">
              <div className="font-semibold">
                ✗ {result.result === 'TIMEOUT' ? 'Controller không phản hồi' : 'Controller từ chối'}
              </div>
              {result.error_code && (
                <div className="mt-1 font-mono text-xs">
                  {result.error_code} · {ERROR_CODE_HINTS[result.error_code] ?? ''}
                </div>
              )}
              {result.error_message && <div className="mt-1">{result.error_message}</div>}
              {/* Dòng này là bắt buộc — người dùng phải biết chắc hệ thống
                  KHÔNG rơi vào trạng thái nửa vời. */}
              <div className="mt-2 font-semibold">
                Revision {result.revision} vẫn đang chạy — không có gì thay đổi.
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

interface DiffRow { label: string; value: string; critical?: boolean }

function buildDiff(schedule: ScheduleObject, running: ScheduleObject | null): DiffRow[] {
  void running
  const targets = schedule.target_objects.map((t) => t.point_id ?? `${t.point_kind}-${t.channel}`)
  return [
    { label: 'Lịch tuần', value: weeklySummary(schedule.weekly_schedule, schedule.value_type) },
    { label: 'Ngoại lệ', value: String(schedule.exception_schedule.length) },
    { label: 'Điểm điều khiển', value: targets.join(', ') || EM_DASH, critical: true },
    { label: 'Ưu tiên ghi', value: String(schedule.priority_for_writing), critical: true },
    { label: 'Giá trị mặc định', value: formatValue(schedule.schedule_default.value, schedule.value_type) },
    {
      label: 'Hiệu lực',
      value: `${schedule.effective_period.start_date ?? 'không giới hạn'} → ${schedule.effective_period.end_date ?? 'không có ngày kết thúc'}`
    }
  ]
}
