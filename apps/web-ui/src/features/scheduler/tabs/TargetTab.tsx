import { Eye, Layers, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../../../shared/components/Button'
import { Modal } from '../../../shared/components/Modal'
import { useOptionalRealtime } from '../../../shared/realtime'
import type { Point, ScheduleObject, ScheduleTargetObject, SchedulePointKind } from '../../../shared/types'
import { cn } from '../../../shared/utils'
import {
  ALL_TARGET_KINDS, EM_DASH, ERROR_CODE_HINTS, MAX_TARGETS_PER_SCHEDULE,
  POINT_KIND_LIMITS, formatValue, overrideSourceLabel
} from '../shared'

function getPointLabel(kind: SchedulePointKind, channel: number, pointsById: Map<string, Point>): string {
  const pad2 = String(channel).padStart(2, '0')
  const pid = `${kind}-${pad2}`
  const pt = pointsById.get(pid) || pointsById.get(`${kind}-${channel}`)
  const name = pt?.display_name || pt?.name || pt?.tag
  if (name && name !== pid && name !== `${kind}-${channel}`) return `${pid} — ${name}`
  return pid
}

/**
 * Điểm điều khiển của một lịch (Heterogeneous Target Points).
 * Hỗ trợ chọn điểm, cấu hình giá trị Active, Inactive (kèm tuỳ chọn Relinquish / Set NULL),
 * cấu hình độ trễ so le (Staggered Start Delay) và Modal soi 16 mức BACnet Priority Array.
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

  const [inspectTarget, setInspectTarget] = useState<ScheduleTargetObject | null>(null)

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
        inactive_action: 'WRITE_VALUE',
        staggered_delay_seconds: 0
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
      next.inactive_action = 'WRITE_VALUE'
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
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--c-border)] bg-[var(--c-surface-2)] text-left text-xs uppercase text-[var(--c-text-dim)]">
                <th className="px-3 py-2 w-16">Mã</th>
                <th className="px-3 py-2 w-20">Loại</th>
                <th className="px-3 py-2 min-w-[190px]">Điểm gán</th>
                <th className="px-3 py-2 min-w-[120px]">Khi bắt đầu</th>
                <th className="px-3 py-2 min-w-[150px]">Khi kết thúc</th>
                <th className="px-3 py-2 w-24" title="Độ trễ khởi động so le (chống sốc lưới điện)">Trễ so le</th>
                <th className="px-3 py-2 min-w-[130px]">Giá trị thật</th>
                <th className="px-3 py-2 min-w-[130px]">Kết quả ghi</th>
                <th className="w-10 px-3 py-2"><span className="sr-only">Xoá</span></th>
              </tr>
            </thead>
            <tbody>
              {draft.target_objects.map((t, i) => {
                const rt = runtimeByTarget.get(t.target_id)
                const limit = POINT_KIND_LIMITS[t.point_kind ?? 'DO'] ?? 1
                const isRelinquish = t.inactive_action === 'RELINQUISH'

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
                            className={cellClass + ' w-16 font-mono text-xs text-right'}
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
                            className={cellClass + ' w-14 font-mono text-xs text-center'}
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
                          className={cellClass + ' w-20 font-mono text-xs text-right'}
                          value={t.active_value ?? 1}
                          disabled={!canEdit}
                          aria-label="Giá trị khi bắt đầu"
                          onChange={(e) => update(i, { active_value: Number(e.target.value) })}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="space-y-1">
                        <select
                          className={cellClass + ' w-36 text-xs font-medium'}
                          value={isRelinquish ? 'RELINQUISH' : String(t.inactive_value ?? 0)}
                          disabled={!canEdit}
                          aria-label="Hành động khi kết thúc"
                          onChange={(e) => {
                            const val = e.target.value
                            if (val === 'RELINQUISH') {
                              update(i, { inactive_action: 'RELINQUISH', inactive_value: null })
                            } else {
                              update(i, { inactive_action: 'WRITE_VALUE', inactive_value: Number(val) })
                            }
                          }}
                        >
                          {(t.point_kind === 'DO' || t.point_kind === 'BV') ? (
                            <>
                              <option value="0">TẮT (0)</option>
                              <option value="1">BẬT (1)</option>
                            </>
                          ) : t.point_kind === 'AO' ? (
                            <>
                              <option value="0">0 % (Đóng van)</option>
                              <option value="20">20 %</option>
                              <option value="50">50 %</option>
                              <option value="100">100 %</option>
                            </>
                          ) : (
                            <>
                              <option value="0">0 (Mặc định)</option>
                              <option value="1">1</option>
                            </>
                          )}
                          <option value="RELINQUISH">Nhả lệnh (NULL / Trả quyền)</option>
                        </select>
                        {isRelinquish && (
                          <div className="text-[10px] text-[var(--c-accent)] font-medium">
                            ✓ Trả quyền cho FBD / Logic
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={300}
                            step={5}
                            className={cn(
                              cellClass,
                              'w-16 font-mono text-xs text-right',
                              ((t.staggered_delay_seconds ?? 0) < 0 || (t.staggered_delay_seconds ?? 0) > 300) && 'border-[var(--c-bad-fg)] ring-1 ring-[var(--c-bad-fg)]'
                            )}
                            value={t.staggered_delay_seconds ?? 0}
                            disabled={!canEdit}
                            aria-label="Độ trễ khởi động so le"
                            onChange={(e) => update(i, { staggered_delay_seconds: Number(e.target.value) })}
                          />
                          <span className="text-xs text-[var(--c-text-dim)]">s</span>
                        </div>
                        {((t.staggered_delay_seconds ?? 0) < 0 || (t.staggered_delay_seconds ?? 0) > 300) && (
                          <span className="text-[10px] text-[var(--c-bad-fg)] font-medium">Dải 0..300s</span>
                        )}
                      </div>
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
                          } else {
                            const unit = pt.unit || pt.rawUnit || (t.point_kind === 'AO' ? 'V' : '')
                            disp = `${pt.value}${unit ? ' ' + unit : ''}`
                          }
                        } else if (rt?.actual_value !== undefined && rt.actual_value !== null) {
                          disp = formatValue(rt.actual_value, draft.value_type)
                        }
                        return (
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5 font-mono text-xs font-semibold">
                              <span>{disp}</span>
                              <button
                                type="button"
                                className="rounded p-0.5 text-[var(--c-text-dim)] hover:text-[var(--c-accent)]"
                                title="Soi Mảng Ưu Tiên BACnet (Priority Stack)"
                                aria-label="Soi mảng mức độ ưu tiên BACnet"
                                onClick={() => setInspectTarget(t)}
                              >
                                <Layers className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            {rt?.overridden_by && (
                              <button
                                type="button"
                                className="text-[10px] font-medium text-[var(--c-warn-fg)] hover:underline flex items-center gap-0.5"
                                onClick={() => setInspectTarget(t)}
                              >
                                bị {overrideSourceLabel(rt.overridden_by)} giữ
                              </button>
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
                        delayRemaining={rt?.delay_remaining_sec}
                        onInspect={() => setInspectTarget(t)}
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

      {inspectTarget && (
        <PriorityStackModal
          target={inspectTarget}
          runtime={runtimeByTarget.get(inspectTarget.target_id)}
          point={pointsById.get(inspectTarget.point_id ?? '')}
          scheduleId={draft.schedule_id}
          onClose={() => setInspectTarget(null)}
        />
      )}
    </div>
  )
}

function WriteResult({
  result, errorCode, writtenValue, pointKind, delayRemaining, onInspect
}: {
  result: string | null
  errorCode: string | null
  writtenValue?: unknown
  pointKind?: SchedulePointKind
  delayRemaining?: number | null
  onInspect?: () => void
}) {
  if (!result) return <span className="text-[var(--c-text-dim)]">{EM_DASH}</span>

  if (result === 'DELAYED') {
    return (
      <span className="inline-flex flex-col text-[var(--c-warn-fg)]">
        <span className="font-medium text-xs">Đang trễ so le</span>
        {delayRemaining !== undefined && delayRemaining !== null && delayRemaining > 0 && (
          <span className="text-[10px] text-[var(--c-text-dim)] font-mono">còn ~{delayRemaining}s</span>
        )}
      </span>
    )
  }

  if (result === 'RELINQUISHED') {
    return (
      <span className="inline-flex flex-col text-[var(--c-text-dim)]">
        <span className="font-medium text-xs italic">Nhả lệnh (NULL)</span>
        <span className="text-[10px] text-[var(--c-good-fg)]">Logic FBD tự do</span>
      </span>
    )
  }

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

/**
 * Modal Soi Mảng Mức Độ Ưu Tiên BACnet (Priority Stack Inspector).
 * Minh bạch hoá toàn bộ 16 khe cắm BACnet Command Priority Array.
 */
function PriorityStackModal({
  target, runtime, point, scheduleId, onClose
}: {
  target: ScheduleTargetObject
  runtime?: NonNullable<ScheduleObject['runtime']>['targets'][number]
  point?: Point
  scheduleId: string
  onClose: () => void
}) {
  const overridden = runtime?.overridden_by
  const isOk = runtime?.write_result === 'OK'
  const isRelinquished = runtime?.write_result === 'RELINQUISHED'
  const isDelayed = runtime?.write_result === 'DELAYED'
  const isManual = point?.priority === 'manual' || point?.forced || overridden === 'LOCAL_MANUAL'
  const isSafety = point?.priority === 'safety' || overridden === 'FIRE_SAFETY'
  const isBacnet = overridden === 'BACNET'
  const isLogic = overridden === 'LOCAL_LOGIC' || point?.source === 'logic'

  const unit = point?.unit || point?.rawUnit || (target.point_kind === 'AO' ? 'V' : '')

  // Xác định mức ưu tiên Core Resolver (1..6) đang thắng (D-01 & D-03)
  let winningCoreLevel = 6
  let winningDesc = 'Mặc định sàn (Relinquish Default)'

  if (isSafety) {
    winningCoreLevel = 1
    winningDesc = 'Mức 1: Báo cháy / An toàn tính mạng cưỡng bức'
  } else if (isManual) {
    winningCoreLevel = 2
    winningDesc = 'Mức 2: Lệnh chỉnh tay người vận hành (Manual Override)'
  } else if (isBacnet) {
    winningCoreLevel = 3
    winningDesc = 'Mức 3: Lệnh mạng BACnet trung tâm ghi đè'
  } else if (isOk && !isRelinquished && !isDelayed) {
    winningCoreLevel = 4
    winningDesc = 'Mức 4: Lịch vận hành làm chủ (Schedule)'
  } else if (isLogic) {
    winningCoreLevel = 5
    winningDesc = 'Mức 5: Chương trình logic FBD / POU nội bộ'
  } else {
    winningCoreLevel = 6
    winningDesc = isRelinquished ? 'Mức 6: Mặc định sàn (Lịch đã nhả lệnh NULL)' : 'Mức 6: Mặc định sàn'
  }

  const formatPointVal = (val: any) => {
    if (val === undefined || val === null) return 'NULL'
    if (typeof val === 'boolean') return val ? 'BẬT (1)' : 'TẮT (0)'
    if (target.point_kind === 'DO' || target.point_kind === 'BV') {
      return Number(val) !== 0 ? 'BẬT (1)' : 'TẮT (0)'
    }
    return `${val}${unit ? ' ' + unit : ''}`
  }

  const CORE_PRIORITY_SLOTS = [
    {
      coreLevel: 1,
      bacnetLevels: 'P1 / P2',
      name: 'Life Safety (Báo cháy / Khẩn cấp)',
      desc: 'Ngắt an toàn tính mạng & liên động báo cháy tự động',
      val: isSafety ? (point?.value !== undefined ? formatPointVal(point.value) : 'ACTIVE') : null,
      isWinner: winningCoreLevel === 1
    },
    {
      coreLevel: 2,
      bacnetLevels: 'P8',
      name: 'Manual Operator (Chỉnh tay / HOA)',
      desc: 'Công tắc HOA tại tủ hoặc lệnh can thiệp thủ công từ web/HMI',
      val: isManual ? (point?.value !== undefined ? formatPointVal(point.value) : 'ACTIVE') : null,
      isWinner: winningCoreLevel === 2
    },
    {
      coreLevel: 3,
      bacnetLevels: 'P3 / P10',
      name: 'BACnet Network (Lệnh mạng trung tâm)',
      desc: 'Hệ thống SCADA / BMS cấp trên ghi đè qua giao thức mạng',
      val: isBacnet ? (point?.value !== undefined ? formatPointVal(point.value) : 'CMD') : null,
      isWinner: winningCoreLevel === 3
    },
    {
      coreLevel: 4,
      bacnetLevels: 'P16 (hoặc P14)',
      name: `Schedule (${scheduleId})`,
      desc: 'Lệnh điều phối từ Lịch vận hành thiết bị',
      val: isRelinquished
        ? 'NULL (Nhả lệnh)'
        : isDelayed
          ? `DELAYED (~ ${runtime?.delay_remaining_sec ?? 0}s)`
          : (runtime?.written_value !== undefined && runtime.written_value !== null
            ? `${runtime.written_value}${target.point_kind === 'AO' ? ' %' : ''}`
            : target.active_value !== undefined
              ? `${target.active_value}${target.point_kind === 'AO' ? ' %' : ''}`
              : 'NULL'),
      isWinner: winningCoreLevel === 4
    },
    {
      coreLevel: 5,
      bacnetLevels: 'P15',
      name: 'Local Logic (POU / FBD nội bộ)',
      desc: 'Thuật toán điều khiển tự động lập trình trong Core',
      val: isLogic ? (point?.value !== undefined ? formatPointVal(point.value) : 'RUN') : null,
      isWinner: winningCoreLevel === 5
    },
    {
      coreLevel: 6,
      bacnetLevels: 'Relinquish Default',
      name: 'Relinquish Default (Mặc định sàn)',
      desc: 'Giá trị sàn an toàn khi tất cả các mức ưu tiên trên đều nhả NULL',
      val: point?.default_value !== undefined
        ? formatPointVal(point.default_value)
        : (target.point_kind === 'DO' || target.point_kind === 'BV' ? 'TẮT (0)' : `0${unit ? ' ' + unit : ''}`),
      isWinner: winningCoreLevel === 6
    }
  ]

  return (
    <Modal
      open={true}
      title={`Mảng Trọng Tài Ưu Tiên (Priority Resolver) — ${target.point_id}`}
      size="lg"
      cancelLabel="Đóng"
      onClose={onClose}
    >
      <div className="space-y-4 text-sm">
        {/* Banner tóm tắt hiện trạng */}
        <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-semibold text-base">{target.point_id} — {point?.name || point?.tag || target.target_id}</div>
              <div className="text-xs text-[var(--c-text-dim)]">Loại điểm: {target.point_kind} · Kênh: {target.channel}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-[var(--c-text-dim)]">Giá trị thực tế:</div>
              <div className="font-mono text-base font-bold text-[var(--c-good-fg)]">
                {point?.value !== undefined ? `${point.value}${unit ? ' ' + unit : ''}` : EM_DASH}
              </div>
            </div>
          </div>
          <div className="mt-2 text-xs pt-2 border-t border-[var(--c-border)]">
            <span className="font-medium text-[var(--c-text-dim)]">Mức thắng hiện hành: </span>
            <span className={cn('font-bold', winningCoreLevel <= 2 ? 'text-[var(--c-warn-fg)]' : winningCoreLevel === 4 ? 'text-[var(--c-good-fg)]' : 'text-[var(--c-accent)]')}>
              {winningDesc}
            </span>
          </div>
        </div>

        {/* Bảng 6 mức ưu tiên Core Resolver */}
        <div className="max-h-[380px] overflow-y-auto rounded-[var(--radius)] border border-[var(--c-border)]">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--c-border)] bg-[var(--c-surface-2)] text-left uppercase text-[var(--c-text-dim)]">
                <th className="px-3 py-2 w-20">Mức Core</th>
                <th className="px-3 py-2 w-24">Chuẩn BACnet</th>
                <th className="px-3 py-2">Nguồn điều khiển & Mô tả</th>
                <th className="px-3 py-2 min-w-[120px]">Giá trị slot</th>
                <th className="px-3 py-2 w-28 text-right">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {CORE_PRIORITY_SLOTS.map((s) => {
                const isWinning = s.isWinner
                const isSched = s.coreLevel === 4
                const rowBg = isWinning
                  ? (s.coreLevel <= 2 ? 'bg-amber-500/10' : s.coreLevel === 4 ? 'bg-emerald-500/10' : 'bg-blue-500/10')
                  : isSched ? 'bg-[var(--c-surface-2)]/60' : ''

                return (
                  <tr key={s.coreLevel} className={cn('border-b border-[var(--c-border)] hover:bg-[var(--c-surface-2)]/40', rowBg)}>
                    <td className="px-3 py-2 font-mono font-bold">
                      Mức {s.coreLevel}
                    </td>
                    <td className="px-3 py-2 font-mono text-[var(--c-text-dim)] font-medium">
                      {s.bacnetLevels}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{s.name}</div>
                      <div className="text-[10px] text-[var(--c-text-dim)]">{s.desc}</div>
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {s.val ? (
                        <span className={cn('font-semibold', isWinning ? 'text-[var(--c-good-fg)]' : '')}>
                          {String(s.val)}
                        </span>
                      ) : (
                        <span className="text-[var(--c-text-dim)] italic">NULL (Trống)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isWinning ? (
                        <span className="inline-flex rounded-full bg-[var(--c-good-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--c-good-fg)] border border-[var(--c-good)]">
                          WINNING
                        </span>
                      ) : s.val && s.val !== 'NULL (Nhả lệnh)' ? (
                        <span className="text-[10px] text-[var(--c-text-dim)]">Thua ưu tiên</span>
                      ) : (
                        <span className="text-[10px] text-[var(--c-text-dim)] opacity-40">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Chú giải phân xử trọng tài */}
        <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-1)] p-2.5 text-[11px] text-[var(--c-text-dim)] space-y-1">
          <div className="font-semibold text-[var(--c-text)]">Quy tắc trọng tài (Core Priority Resolver):</div>
          <div>Số nhỏ hơn thắng: <strong>Mức 1</strong> (An toàn) &gt; <strong>Mức 2</strong> (Chỉnh tay) &gt; <strong>Mức 3</strong> (Mạng BACnet) &gt; <strong>Mức 4</strong> (Lịch) &gt; <strong>Mức 5</strong> (Logic POU) &gt; <strong>Mức 6</strong> (Mặc định).</div>
          <div>Khi hết sự kiện lịch, nếu chọn <em>Nhả lệnh (RELINQUISH)</em>, Mức 4 trả về NULL và giải phóng quyền kiểm soát cho Mức 5 (Logic FBD) hoặc Mức 6.</div>
        </div>
      </div>
    </Modal>
  )
}

const cellClass =
  'h-8 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)] disabled:cursor-not-allowed disabled:opacity-60'
