import { useEffect, useState } from 'react'
import { apiClient } from '../../../shared/api/client'
import { Button } from '../../../shared/components/Button'
import { StateBlock } from '../../../shared/components/StateBlock'
import type { ScheduleEffectiveResponse, ScheduleObject } from '../../../shared/types'
import { formatDateTime } from '../../../shared/utils'

/**
 * Tab "Hiệu lực thực tế" — `T57-3.5`, `T57-3.6`, `T57-3.7` (`ADR-045`).
 *
 * BA CÂU HỎI, MỘT NGUỒN DỮ LIỆU
 *
 *  · `T57-3.5` — "điểm này thực tế nghe lịch nào?" khi nhiều lịch cùng chạm nó.
 *  · `T57-3.6` — "lịch tôi đang soạn có đè lên lịch khác không?" Cùng dữ liệu,
 *    chỉ khác cách trình bày: phần `conflicts` của cùng một phản hồi.
 *  · `T57-3.7` — "lịch này đã tác động những gì trong 7 ngày?" Cùng endpoint,
 *    khoảng thời gian lùi về quá khứ.
 *
 * Mở endpoint thứ hai cho cùng một câu hỏi là tự tạo hai đường sẽ trôi khỏi
 * nhau (`ADR-045` điều 2), nên cả ba dùng chung `GET /schedules/effective`.
 *
 * Phần tính toán nằm ở Core (`mkddc-schedule-sim --point`). Thiếu binary thì
 * backend trả 503 và tab này hiện nguyên văn lý do — **không** tự phân xử
 * priority trong giao diện, vì một bản phân xử thứ hai sẽ sai đúng vào ca trực
 * mà các lịch chồng nhau.
 */
export function EffectiveTab({ schedule }: { schedule: ScheduleObject }) {
  const targets = schedule.target_objects
    .map((target) => target.point_id?.trim())
    .filter((id): id is string => Boolean(id))

  const [pointId, setPointId] = useState(targets[0] ?? '')
  const [direction, setDirection] = useState<'next' | 'past'>('next')
  const [data, setData] = useState<ScheduleEffectiveResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!pointId) return
    let alive = true
    setLoading(true)
    setError(null)
    const now = Date.now()
    // Quá khứ 7 ngày trả lời `T57-3.7`; tương lai 24 giờ trả lời `T57-3.5`.
    const from = direction === 'past' ? new Date(now - 7 * 24 * 3600_000) : new Date(now)
    const to = direction === 'past' ? new Date(now) : new Date(now + 24 * 3600_000)
    apiClient.getScheduleEffective(pointId, from.toISOString(), to.toISOString())
      .then((result) => { if (alive) setData(result) })
      .catch((err) => { if (alive) { setData(null); setError(err instanceof Error ? err.message : String(err)) } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [pointId, direction, schedule.revision])

  if (targets.length === 0) {
    return (
      <StateBlock
        state="empty"
        title="Lịch này chưa có điểm điều khiển nào"
        detail="Hiệu lực thực tế được tính theo TỪNG ĐIỂM, vì phân xử ưu tiên xảy ra ở điểm chứ không ở lịch."
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-[var(--c-text-dim)]">
          Điểm
          <select
            aria-label="Chọn điểm để xem hiệu lực thực tế"
            className="ml-2 h-9 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-sm text-[var(--c-text)]"
            value={pointId}
            onChange={(event) => setPointId(event.target.value)}
          >
            {targets.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
        <Button size="sm" variant={direction === 'next' ? 'primary' : 'secondary'} onClick={() => setDirection('next')}>
          24 giờ tới
        </Button>
        <Button size="sm" variant={direction === 'past' ? 'primary' : 'secondary'} onClick={() => setDirection('past')}>
          7 ngày qua
        </Button>
      </div>

      {loading && <StateBlock state="loading" title="Đang hỏi engine của bộ điều khiển" />}

      {/* Thiếu engine là tình huống thật trên bo chưa cài đủ gói. Hiện nguyên
          văn lý do, và KHÔNG dựng một bản phân xử thay thế trong giao diện. */}
      {error && !loading && (
        <StateBlock
          state="error"
          title="Không tính được hiệu lực thực tế"
          detail={`${error} — phân xử ưu tiên thuộc bộ điều khiển, giao diện không tự tính thay.`}
        />
      )}

      {data && !loading && !error && (
        <>
          {data.conflicts.length > 0 && (
            <div className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-sm">
              <div className="font-bold uppercase text-[var(--c-warn-fg)]">
                {data.conflicts.length} thời điểm có nhiều lịch cùng ghi
              </div>
              <ul className="mt-1 space-y-1 text-xs">
                {data.conflicts.map((conflict, index) => (
                  <li key={`${conflict.at}-${index}`}>
                    <span className="font-mono">{formatDateTime(conflict.at)}</span>{' '}
                    {conflict.scheduleIds.join(' · ')} → thắng: <span className="font-semibold">{conflict.winnerId}</span>
                    {conflict.detail ? ` (${conflict.detail})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.segments.length === 0
            ? <StateBlock state="empty" title="Không có lịch nào ghi lên điểm này trong khoảng đã chọn" />
            : (
              <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--c-border)]">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[var(--c-border)] bg-[var(--c-surface-2)] text-left text-xs uppercase text-[var(--c-text-dim)]">
                      <th className="px-3 py-2">Từ</th>
                      <th className="px-3 py-2">Đến</th>
                      <th className="px-3 py-2">Giá trị</th>
                      <th className="px-3 py-2">Lịch thắng</th>
                      <th className="px-3 py-2">Vì sao</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.segments.map((segment, index) => (
                      <tr key={`${segment.from}-${index}`} className="border-b border-[var(--c-border)]">
                        <td className="px-3 py-2 font-mono text-xs">{formatDateTime(segment.from)}</td>
                        <td className="px-3 py-2 font-mono text-xs">{formatDateTime(segment.to)}</td>
                        <td className="px-3 py-2 font-mono">{segment.value === null || segment.value === undefined ? '—' : String(segment.value)}</td>
                        <td className="px-3 py-2">
                          {segment.scheduleId
                            ? <>
                              <span className="font-semibold">{segment.scheduleName || segment.scheduleId}</span>
                              {segment.priority ? <span className="ml-1 text-xs text-[var(--c-text-dim)]">P{segment.priority}</span> : null}
                            </>
                            : <span className="text-[var(--c-text-dim)]">Không lịch nào</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-[var(--c-text-dim)]">{segment.reason ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          <p className="text-xs text-[var(--c-text-dim)]">
            Tính bằng {data.engine} — cùng engine mà bộ điều khiển dùng khi chạy thật.
          </p>
        </>
      )}
    </div>
  )
}
