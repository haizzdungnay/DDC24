import { Plus, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { Button } from '../../../shared/components/Button'
import { useOptionalRealtime } from '../../../shared/realtime'
import type { Point, ScheduleObject, ScheduleTargetObject, SchedulePointKind } from '../../../shared/types'
import { cn } from '../../../shared/utils'
import {
  ALL_TARGET_KINDS, EM_DASH, ERROR_CODE_HINTS, MAX_TARGETS_PER_SCHEDULE,
  POINT_KIND_LIMITS, formatValue, overrideSourceLabel
} from '../shared'

function getPointLabel(kind: SchedulePointKind, channel: number, pointsById: Map<string, Point>): string {
  const pid = `${kind}-${String(channel).padStart(2, '0')}`
  const pt = pointsById.get(pid)
  if (pt?.name) return `${pid} — ${pt.name}`
  if (pt?.tag) return `${pid} — ${pt.tag}`
  return pid
}

/**
 * Điểm điều khiển của một lịch.
 * Cho phép chọn loại điểm (DO, AO, BV, AV, MSV, EXT), chọn điểm gán cụ thể và cấu hình
 * mức giá trị khi sự kiện bắt đầu (Active) và kết thúc (Inactive).
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
  const realtime = useOptionalRealtime()
  const points = realtime?.allPoints ?? []
  const pointsById = useMemo(() => {
    const map = new Map<string, Point>()
    for (const p of points) map.set(p.id, p)
    return map
  }, [points])

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
    const defaultActive = chosenKind === 'AO' ? 100 : 1
    const defaultInactive = chosenKind === 'MSV' ? 1 : 0
    onChange({
      target_objects: [...draft.target_objects, {
        target_id: 'TGT-' + String(n).padStart(3, '0'),
        target_type: 'INTERNAL_POINT',
        point_kind: chosenKind,
        channel: chosenChannel,
        point_id: `${chosenKind}-${String(chosenChannel).padStart(2, '0')}`,
        active_value: defaultActive,
        inactive_value: defaultInactive,
      }]
    })
  }

  function update(index: number, changes: Partial<ScheduleTargetObject>) {
    const list = [...draft.target_objects]
    const cur = list[index]
    const next = { ...cur, ...changes }
    if (changes.point_kind && changes.point_kind !== cur.point_kind) {
      next.channel = 1
      next.point_id = `${changes.point_kind}-01`
      next.active_value = changes.point_kind === 'AO' ? 100 : 1
      next.inactive_value = changes.point_kind === 'MSV' ? 1 : 0
    } else if (next.point_kind && next.channel !== undefined) {
      next.point_id = `${next.point_kind}-${String(next.channel).padStart(2, '0')}`
    }
    list[index] = next
    onChange({ target_objects: list })
  }

  const anyFailed = (saved.runtime?.targets ?? []).some((t) => t.write_result === 'FAILED' || t.write_result === 'TIMEOUT')

  return (
    <div className="space-y-3">
      <h2 className="sr-only">Điểm đích</h2>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--c-text-dim)]">
          Danh sách loại điểm điều khiển: {ALL_TARGET_KINDS.join(', ')}
        </p>
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
          <table className="w-full min-w-[800px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--c-border)] bg-[var(--c-surface-2)] text-left text-xs uppercase text-[var(--c-text-dim)]">
                <th className="px-3 py-2 w-20">Mã</th>
                <th className="px-3 py-2 w-24">Loại</th>
                <th className="px-3 py-2 min-w-[200px]">Điểm gán</th>
                <th className="px-3 py-2 min-w-[130px]">Khi bắt đầu</th>
                <th className="px-3 py-2 min-w-[130px]">Khi kết thúc</th>
                <th className="px-3 py-2 w-28">Giá trị thật</th>
                <th className="px-3 py-2 w-32">Kết quả ghi</th>
                <th className="w-10 px-3 py-2"><span className="sr-only">Xoá</span></th>
              </tr>
            </thead>
            <tbody>
              {draft.target_objects.map((t, i) => {
                const rt = runtimeByTarget.get(t.target_id)
                const limit = POINT_KIND_LIMITS[t.point_kind ?? 'DO'] ?? 1
                return (
                  <tr key={t.target_id + i} className="border-b border-[var(--c-border)]">
                    <td className="px-3 py-2 font-mono text-xs">{t.target_id}</td>
                    <td className="px-3 py-2">
                      <select
                        className={cellClass + ' font-medium'}
                        value={t.point_kind ?? 'DO'}
                        disabled={!canEdit}
                        aria-label="Loại điểm"
                        onChange={(e) => update(i, { point_kind: e.target.value as SchedulePointKind })}
                      >
                        {allowedKinds.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {limit <= 32 ? (
                        <select
                          className={cellClass + ' w-full max-w-[240px] font-mono text-xs'}
                          value={t.channel ?? 1}
                          disabled={!canEdit}
                          aria-label="Điểm gán"
                          onChange={(e) => update(i, { channel: Number(e.target.value) })}
                        >
                          {Array.from({ length: limit }, (_, idx) => idx + 1).map((ch) => (
                            <option key={ch} value={ch}>
                              {getPointLabel(t.point_kind ?? 'DO', ch, pointsById)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="flex items-center gap-1 font-mono text-xs">
                          <input
                            type="number"
                            min={1}
                            max={limit}
                            className={cellClass + ' w-20'}
                            value={t.channel ?? 1}
                            disabled={!canEdit}
                            aria-label="Kênh EXT"
                            onChange={(e) => update(i, { channel: Math.max(1, Math.min(limit, Number(e.target.value))) })}
                          />
                          <span className="text-xs text-[var(--c-text-dim)]">/{limit} ({t.point_id})</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {(t.point_kind === 'DO' || t.point_kind === 'BV') ? (
                        <select
                          className={cellClass + ' w-28 text-xs font-medium'}
                          value={(t.active_value ?? 1) === 0 ? 0 : 1}
                          disabled={!canEdit}
                          aria-label="Giá trị khi bắt đầu"
                          onChange={(e) => update(i, { active_value: Number(e.target.value) })}
                        >
                          <option value={1}>BẬT (1)</option>
                          <option value={0}>TẮT (0)</option>
                        </select>
                      ) : t.point_kind === 'AO' ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            className={cellClass + ' w-20 font-mono text-xs text-right'}
                            value={t.active_value ?? 100}
                            disabled={!canEdit}
                            aria-label="Giá trị AO khi bắt đầu"
                            onChange={(e) => update(i, { active_value: Math.max(0, Math.min(100, Number(e.target.value))) })}
                          />
                          <span className="text-xs font-semibold text-[var(--c-text-dim)]">%</span>
                        </div>
                      ) : t.point_kind === 'MSV' ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-[var(--c-text-dim)]">Trạng thái</span>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            className={cellClass + ' w-16 font-mono text-xs text-center'}
                            value={t.active_value ?? 1}
                            disabled={!canEdit}
                            aria-label="Trạng thái khi bắt đầu"
                            onChange={(e) => update(i, { active_value: Math.max(1, Math.round(Number(e.target.value))) })}
                          />
                        </div>
                      ) : (
                        <input
                          type="number"
                          step="any"
                          className={cellClass + ' w-24 font-mono text-xs text-right'}
                          value={t.active_value ?? 1}
                          disabled={!canEdit}
                          aria-label="Giá trị khi bắt đầu"
                          onChange={(e) => update(i, { active_value: Number(e.target.value) })}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {(t.point_kind === 'DO' || t.point_kind === 'BV') ? (
                        <select
                          className={cellClass + ' w-28 text-xs font-medium'}
                          value={(t.inactive_value ?? 0) === 1 ? 1 : 0}
                          disabled={!canEdit}
                          aria-label="Giá trị khi kết thúc"
                          onChange={(e) => update(i, { inactive_value: Number(e.target.value) })}
                        >
                          <option value={0}>TẮT (0)</option>
                          <option value={1}>BẬT (1)</option>
                        </select>
                      ) : t.point_kind === 'AO' ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            className={cellClass + ' w-20 font-mono text-xs text-right'}
                            value={t.inactive_value ?? 0}
                            disabled={!canEdit}
                            aria-label="Giá trị AO khi kết thúc"
                            onChange={(e) => update(i, { inactive_value: Math.max(0, Math.min(100, Number(e.target.value))) })}
                          />
                          <span className="text-xs font-semibold text-[var(--c-text-dim)]">%</span>
                        </div>
                      ) : t.point_kind === 'MSV' ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-[var(--c-text-dim)]">Trạng thái</span>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            className={cellClass + ' w-16 font-mono text-xs text-center'}
                            value={t.inactive_value ?? 1}
                            disabled={!canEdit}
                            aria-label="Trạng thái khi kết thúc"
                            onChange={(e) => update(i, { inactive_value: Math.max(1, Math.round(Number(e.target.value))) })}
                          />
                        </div>
                      ) : (
                        <input
                          type="number"
                          step="any"
                          className={cellClass + ' w-24 font-mono text-xs text-right'}
                          value={t.inactive_value ?? 0}
                          disabled={!canEdit}
                          aria-label="Giá trị khi kết thúc"
                          onChange={(e) => update(i, { inactive_value: Number(e.target.value) })}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {(() => {
                        const pt = pointsById.get(t.point_id ?? '')
                        let disp = EM_DASH
                        if (pt && pt.value !== undefined) {
                          if (typeof pt.value === 'boolean') {
                            disp = pt.value ? 'BẬT' : 'TẮT'
                          } else if (t.point_kind === 'DO' || t.point_kind === 'BV') {
                            disp = Number(pt.value) !== 0 ? 'BẬT' : 'TẮT'
                          } else if (t.point_kind === 'AO') {
                            disp = `${pt.value} %`
                          } else {
                            disp = `${pt.value}${pt.unit ? ' ' + pt.unit : ''}`
                          }
                        } else if (rt?.actual_value !== undefined && rt.actual_value !== null) {
                          disp = formatValue(rt.actual_value, draft.value_type)
                        }
                        return (
                          <div>
                            <span className="font-mono text-xs">{disp}</span>
                            {rt?.overridden_by && (
                              <div className="text-xs text-[var(--c-warn-fg)]">
                                bị {overrideSourceLabel(rt.overridden_by)} giữ
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </td>
                    <td className="px-3 py-2">
                      <WriteResult
                        result={rt?.write_result ?? null}
                        errorCode={rt?.error_code ?? null}
                        writtenValue={rt?.written_value}
                        pointKind={t.point_kind}
                      />
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

function WriteResult({
  result, errorCode, writtenValue, pointKind
}: {
  result: string | null
  errorCode: string | null
  writtenValue?: unknown
  pointKind?: SchedulePointKind
}) {
  if (!result) return <span className="text-[var(--c-text-dim)]">{EM_DASH}</span>
  const tone =
    result === 'OK' ? 'text-[var(--c-good-fg)]'
      : result === 'SKIPPED' ? 'text-[var(--c-text-dim)]'
        : 'text-[var(--c-bad-fg)]'
  const label =
    result === 'OK' ? 'OK'
      : result === 'SKIPPED' ? 'Thua ở phân xử priority'
        : result === 'TIMEOUT' ? 'Quá hạn' : 'Thất bại'

  let writtenText = ''
  if (writtenValue !== undefined && writtenValue !== null && result === 'OK') {
    if (pointKind === 'DO' || pointKind === 'BV') {
      writtenText = (writtenValue === 'ACTIVE' || writtenValue === 1 || writtenValue === true) ? 'BẬT' : 'TẮT'
    } else if (pointKind === 'AO') {
      writtenText = `${writtenValue} %`
    } else {
      writtenText = String(writtenValue)
    }
  }

  return (
    <span className={cn('inline-flex flex-col', tone)}>
      <span className="font-medium text-xs">{label}{writtenText ? ` (${writtenText})` : ''}</span>
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
