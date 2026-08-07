import { RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { apiClient } from '../../../shared/api/client'
import { Button } from '../../../shared/components/Button'
import { Modal } from '../../../shared/components/Modal'
import { useToast } from '../../../shared/components/Toast'
import type { ScheduleAuditEntry, ScheduleObject, ScheduleRevisionInfo } from '../../../shared/types'
import { EM_DASH, ERROR_CODE_HINTS } from '../shared'

/**
 * Lịch sử phiên bản + rollback.
 *
 * Rollback tạo một revision MỚI và không bao giờ viết lại lịch sử; lý do là
 * bắt buộc vì sáu tháng sau không ai nhớ vì sao đã quay lui.
 */
export function RevisionTab({
  schedule, canEdit, onRestored
}: {
  schedule: ScheduleObject
  canEdit: boolean
  onRestored: (s: ScheduleObject) => void
}) {
  const [rows, setRows] = useState<ScheduleRevisionInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<ScheduleRevisionInfo | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  useEffect(() => {
    let alive = true
    apiClient.getScheduleRevisions(schedule.schedule_id)
      .then((r) => { if (alive) { setRows(r); setError(null) } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [schedule.schedule_id, schedule.revision])

  async function rollback() {
    if (!target || !reason.trim()) return
    setBusy(true)
    try {
      const restored = await apiClient.rollbackSchedule(schedule.schedule_id, target.revision, reason.trim())
      onRestored(restored)
      toast.push('success', `Đã quay về revision ${target.revision}; bản mới là revision ${restored.revision}`)
      setTarget(null)
      setReason('')
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (error) return <ErrorBox message={error} />
  if (!rows) return <Loading />
  if (rows.length === 0) {
    return <Empty text="Chưa có phiên bản nào được lưu. Phiên bản được ghi lại mỗi lần publish hoặc rollback." />
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--c-text-dim)]">
        Giữ tối thiểu 10 phiên bản gần nhất. Quay lui tạo một phiên bản <strong>mới</strong>, không xoá lịch sử.
      </p>
      <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--c-border)]">
        <table className="w-full min-w-[600px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--c-border)] bg-[var(--c-surface-2)] text-left text-xs uppercase text-[var(--c-text-dim)]">
              <th className="px-3 py-2">Rev</th>
              <th className="px-3 py-2">Thời điểm</th>
              <th className="px-3 py-2">Người thực hiện</th>
              <th className="px-3 py-2">Lý do</th>
              <th className="px-3 py-2">Đã publish</th>
              <th className="w-28 px-3 py-2"><span className="sr-only">Quay lui</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.revision} className="border-b border-[var(--c-border)]">
                <td className="px-3 py-2 font-mono">{r.revision}</td>
                <td className="px-3 py-2 font-mono text-xs">{formatStamp(r.created_at)}</td>
                <td className="px-3 py-2">{r.created_by || EM_DASH}</td>
                <td className="max-w-[16rem] truncate px-3 py-2 text-[var(--c-text-dim)]" title={r.reason}>
                  {r.reason || EM_DASH}
                  {r.rollback_of !== null && (
                    <span className="ml-1 font-mono text-xs">(quay lui từ rev {r.rollback_of})</span>
                  )}
                </td>
                <td className="px-3 py-2">{r.published ? 'Có' : EM_DASH}</td>
                <td className="px-3 py-2">
                  <Button
                    size="sm"
                    icon={<RotateCcw className="h-3.5 w-3.5" />}
                    disabled={!canEdit || r.revision === schedule.revision}
                    onClick={() => setTarget(r)}
                  >
                    Quay lui
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={target !== null}
        title={`Quay về revision ${target?.revision ?? ''}?`}
        confirmLabel={busy ? 'Đang quay lui…' : 'Quay lui'}
        cancelLabel="Huỷ"
        onConfirm={() => { void rollback() }}
        onClose={() => { setTarget(null); setReason('') }}
      >
        <div className="space-y-3 text-sm">
          <p>
            Thao tác này tạo một phiên bản <strong>mới</strong> mang nội dung của revision{' '}
            {target?.revision}. Lịch sử hiện có không bị xoá.
          </p>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">
              Lý do quay lui (bắt buộc, ghi vào nhật ký)
            </span>
            <textarea
              className="min-h-20 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-2 text-sm text-[var(--c-text)]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {!reason.trim() && (
            <p className="text-xs text-[var(--c-warn-fg)]">Chưa nhập lý do — nút quay lui sẽ không có tác dụng.</p>
          )}
        </div>
      </Modal>
    </div>
  )
}

/** Nhật ký thao tác — chỉ đọc; đặc tả §20 cấm mọi vai trò sửa hoặc xoá. */
export function AuditTab({ schedule }: { schedule: ScheduleObject }) {
  const [rows, setRows] = useState<ScheduleAuditEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actor, setActor] = useState('')

  useEffect(() => {
    let alive = true
    apiClient.getScheduleAudit(schedule.schedule_id)
      .then((r) => { if (alive) { setRows(r); setError(null) } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [schedule.schedule_id, schedule.revision])

  if (error) return <ErrorBox message={error} />
  if (!rows) return <Loading />

  const visible = actor.trim()
    ? rows.filter((r) => r.actor.toLowerCase().includes(actor.trim().toLowerCase()))
    : rows

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="h-9 w-56 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)]"
          placeholder="Lọc theo người thực hiện…"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          aria-label="Lọc nhật ký theo người thực hiện"
        />
        <span className="text-xs text-[var(--c-text-dim)]">
          Chỉ đọc — nhật ký không sửa hay xoá được, kể cả bởi quản trị viên.
        </span>
      </div>

      {visible.length === 0 ? (
        <Empty text="Chưa có thao tác nào được ghi." />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--c-border)]">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--c-border)] bg-[var(--c-surface-2)] text-left text-xs uppercase text-[var(--c-text-dim)]">
                <th className="px-3 py-2">Thời điểm</th>
                <th className="px-3 py-2">Người</th>
                <th className="px-3 py-2">Thao tác</th>
                <th className="px-3 py-2">Rev</th>
                <th className="px-3 py-2">Lý do / thay đổi</th>
                <th className="px-3 py-2">Kết quả</th>
                <th className="px-3 py-2">Nguồn</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => (
                <tr key={`${r.at}-${i}`} className="border-b border-[var(--c-border)] align-top">
                  <td className="px-3 py-2 font-mono text-xs">{formatStamp(r.at)}</td>
                  <td className="px-3 py-2">{r.actor}</td>
                  <td className="px-3 py-2 font-medium">{r.action}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.revision_before ?? EM_DASH} → {r.revision_after ?? EM_DASH}
                  </td>
                  <td className="max-w-[20rem] px-3 py-2 text-[var(--c-text-dim)]">
                    {r.reason && <div className="text-[var(--c-text)]">{r.reason}</div>}
                    {r.changes && <div className="text-xs">{r.changes}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={r.result === 'success' ? 'text-[var(--c-good-fg)]' : 'text-[var(--c-bad-fg)]'}>
                      {r.result ?? EM_DASH}
                    </span>
                    {r.error_code && (
                      <div className="font-mono text-xs text-[var(--c-bad-fg)]">
                        {r.error_code} · {ERROR_CODE_HINTS[r.error_code] ?? ''}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--c-text-dim)]">{r.source_ip ?? EM_DASH}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Loading() {
  return <div className="px-4 py-6 text-sm text-[var(--c-text-dim)]">Đang tải…</div>
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-4 py-6 text-sm text-[var(--c-text-dim)]">
      {text}
    </p>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-bad)] bg-[var(--c-bad-bg)] px-4 py-3 text-sm text-[var(--c-bad-fg)]">
      {message}
    </div>
  )
}

function formatStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
