import { Plus, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { Button } from '../../../shared/components/Button'
import type { ScheduleObject, ScheduleTargetObject, SchedulePointKind } from '../../../shared/types'
import { cn } from '../../../shared/utils'
import {
  ALL_TARGET_KINDS, EM_DASH, ERROR_CODE_HINTS, MAX_TARGETS_PER_SCHEDULE,
  POINT_KIND_LIMITS, formatValue, overrideSourceLabel
} from '../shared'

/**
 * Điểm điều khiển của một lịch.
 *
 * Danh sách chọn LỌC SẴN theo `value_type` và cờ ghi được, thay vì cho chọn tự
 * do rồi báo `SCH-TARGET-002`/`003` sau. Chặn sớm tại chỗ nhập rẻ hơn nhiều so
 * với để người dùng phát hiện lúc publish.
 *
 * Cột kết quả ghi lấy từ `runtime` của controller, và dải thông tin dưới cùng
 * nói rõ một điểm lỗi không chặn các điểm khác (đặc tả §11).
 */
export function TargetTab({
  draft, saved, canEdit, onChange
}: {
  draft: ScheduleObject
  saved: ScheduleObject
  canEdit: boolean
  onChange: (changes: Partial<ScheduleObject>) => void
}) {
  const allowedKinds = ALL_TARGET_KINDS
  const used = useMemo(
    () => new Set(draft.target_objects.map((t) => `${t.point_kind}-${t.channel}`)),
    [draft.target_objects]
  )

  const runtimeByTarget = useMemo(() => {
    const map = new Map<string, NonNullable<ScheduleObject['runtime']>['targets'][number]>()
    for (const t of saved.runtime?.targets ?? []) map.set(t.target_id, t)
    return map
  }, [saved.runtime])

  function add() {
    let chosenKind: SchedulePointKind = 'DO'
    let chosenChannel = 1
    let found = false

    for (const k of ALL_TARGET_KINDS) {
      const limit = POINT_KIND_LIMITS[k] ?? 1
      for (let ch = 1; ch <= limit; ch++) {
        if (!used.has(k + '-' + ch)) {
          chosenKind = k
          chosenChannel = ch
          found = true
          break
        }
      }
      if (found) break
    }
    if (!found) return

    const n = draft.target_objects.length + 1
    onChange({
      target_objects: [...draft.target_objects, {
        target_id: 'TGT-' + String(n).padStart(3, '0'),
        target_type: 'INTERNAL_POINT',
        point_kind: chosenKind,
        channel: chosenChannel,
        point_id: chosenKind + '-' + String(chosenChannel).padStart(2, '0')
      }]
    })
  }

  function update(index: number, changes: Partial<ScheduleTargetObject>) {
    const list = [...draft.target_objects]
    const next = { ...list[index], ...changes }
    if (next.point_kind && next.channel !== undefined) {
      next.point_id = `${next.point_kind}-${String(next.channel).padStart(2, '0')}`
    }
    list[index] = next
    onChange({ target_objects: list })
  }

  const anyFailed = (saved.runtime?.targets ?? []).some((t) => t.write_result === 'FAILED' || t.write_result === 'TIMEOUT')

  return (
    <div className="space-y-3">
      {/* N-08: tab nằm trong `ScheduleEditorPage` vốn đã giữ `<h1>`, nên đây là
          `<h2>` — và `sr-only` vì tên tab đã hiện trên thanh tab, lặp lại bằng
          mắt là nhiễu. Cây heading vẫn phải liền mạch cho trình đọc màn hình
          (WCAG 2.2 §2.4.6). */}
      <h2 className="sr-only">Điểm đích</h2>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--c-text-dim)]">
          Danh sách loại điểm điều khiển: {ALL_TARGET_KINDS.join(', ')}</p>
        <Button
          size="sm"
          icon={<Plus className="h-4 w-4" />}
          disabled={!canEdit || draft.target_objects.length >= MAX_TARGETS_PER_SCHEDULE}
          onClick={add}
        >
          Thêm điểm
        </Button>
      </div>

      {draft.target_objects.length === 0 ? (
        <p className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-4 py-6 text-sm text-[var(--c-text-dim)]">
          Chưa có điểm điều khiển nào — lịch này sẽ không điều khiển gì cả.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--c-border)]">
          <table className="w-full min-w-[680px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--c-border)] bg-[var(--c-surface-2)] text-left text-xs uppercase text-[var(--c-text-dim)]">
                <th className="px-3 py-2">Mã</th>
                <th className="px-3 py-2">Loại điểm</th>
                <th className="px-3 py-2">Kênh</th>
                <th className="px-3 py-2">Điểm</th>
                <th className="px-3 py-2">Giá trị thật</th>
                <th className="px-3 py-2">Kết quả ghi</th>
                <th className="w-10 px-3 py-2"><span className="sr-only">Xoá</span></th>
              </tr>
            </thead>
            <tbody>
              {draft.target_objects.map((t, i) => {
                const rt = runtimeByTarget.get(t.target_id)
                const limit = POINT_KIND_LIMITS[t.point_kind ?? ''] ?? 1
                return (
                  <tr key={t.target_id + i} className="border-b border-[var(--c-border)]">
                    <td className="px-3 py-2 font-mono text-xs">{t.target_id}</td>
                    <td className="px-3 py-2">
                      <select
                        className={cellClass}
                        value={t.point_kind ?? ''}
                        disabled={!canEdit}
                        aria-label="Loại điểm"
                        onChange={(e) => update(i, { point_kind: e.target.value as SchedulePointKind, channel: 1 })}
                      >
                        {allowedKinds.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number" min={1} max={limit}
                        className={cellClass + ' w-20'}
                        value={t.channel ?? 1}
                        disabled={!canEdit}
                        aria-label="Kênh"
                        onChange={(e) => update(i, { channel: Number(e.target.value) })}
                      />
                      <span className="ml-1 text-xs text-[var(--c-text-dim)]">/{limit}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{t.point_id ?? EM_DASH}</td>
                    <td className="px-3 py-2">
                      {rt ? formatValue(rt.actual_value, draft.value_type) : EM_DASH}
                      {rt?.overridden_by && (
                        <div className="text-xs text-[var(--c-warn-fg)]">
                          bị {overrideSourceLabel(rt.overridden_by)} giữ
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <WriteResult result={rt?.write_result ?? null} errorCode={rt?.error_code ?? null} />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="rounded p-1 text-[var(--c-text-dim)] hover:text-[var(--c-bad-fg)] disabled:opacity-40"
                        disabled={!canEdit}
                        aria-label={`Xoá ${t.target_id}`}
                        onClick={() => onChange({ target_objects: draft.target_objects.filter((_, idx) => idx !== i) })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {anyFailed && (
        <p className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-4 py-2.5 text-sm text-[var(--c-text-dim)]">
          Một điểm ghi lỗi không chặn các điểm khác — {saved.schedule_id} vẫn đang chạy.
        </p>
      )}

      <p className="text-xs text-[var(--c-text-dim)]">
        Tối đa {MAX_TARGETS_PER_SCHEDULE} điểm trên một lịch. Bo chỉ có{' '}
        {Object.entries(POINT_KIND_LIMITS).filter(([k]) => k !== 'EXT').map(([k, v]) => `${v} ${k}`).join(' · ')}{' '}
        nội bộ, cộng {POINT_KIND_LIMITS.EXT} điểm Modbus mở rộng.
      </p>
    </div>
  )
}

function WriteResult({ result, errorCode }: { result: string | null; errorCode: string | null }) {
  if (!result) return <span className="text-[var(--c-text-dim)]">{EM_DASH}</span>
  const tone =
    result === 'OK' ? 'text-[var(--c-good-fg)]'
      : result === 'SKIPPED' ? 'text-[var(--c-text-dim)]'
        : 'text-[var(--c-bad-fg)]'
  const label =
    result === 'OK' ? 'OK'
      : result === 'SKIPPED' ? 'Thua ở phân xử priority'
        : result === 'TIMEOUT' ? 'Quá hạn' : 'Thất bại'
  return (
    <span className={cn('inline-flex flex-col', tone)}>
      <span className="font-medium">{label}</span>
      {errorCode && (
        <span className="font-mono text-xs">
          {errorCode} · {ERROR_CODE_HINTS[errorCode] ?? ''}
        </span>
      )}
    </span>
  )
}

const cellClass =
  'h-8 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)] disabled:cursor-not-allowed disabled:opacity-60'
