import { AlertTriangle, Download, Plus, RefreshCw, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiClient } from '../../shared/api/client'
import { Button } from '../../shared/components/Button'
import { Panel } from '../../shared/components/Panel'
import { StateBlock } from '../../shared/components/StateBlock'
import { useToast } from '../../shared/components/Toast'
import { useI18n } from '../../shared/i18n'
import { useUrlFilters } from '../../shared/hooks/useUrlFilters'
import type { ScheduleObject, ScheduleStatus } from '../../shared/types'
import { cn } from '../../shared/utils'
import { useAuth, roleAtLeast } from '../auth'
import { useScheduler } from './useScheduler'
import { StatusDot } from './components/StatusDot'
import {
  EM_DASH, MAX_SCHEDULES, blankSchedule, capacityUsage, formatValue,
  nextScheduleId, weeklySummary
} from './shared'

/**
 * Grid 64 lịch — màn hình gốc của feature (Mode 2 của đặc tả §16.2).
 *
 * Cột `Tuần` là CHỮ tóm tắt chứ không phải mini-chart: `T2-T6 08-18` đọc được
 * ngay, còn một biểu đồ 7 ô rộng 4 mm thì không.
 *
 * Cột `Hiện tại`/`Kế tiếp` đến từ khối `runtime` của controller. Chưa publish
 * thì hiện gạch ngang — KHÔNG tính giá trị ở trình duyệt (nguyên tắc S2/S3).
 */
/** Tiêu đề trang — dùng chung cho cả trạng thái bình thường lẫn hai nhánh lỗi,
 *  để `<h1>` không biến mất khi trang không dựng được nội dung (`T57-0.4`). */
function SchedulerHeading() {
  const { pick } = useI18n()
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-[var(--c-text)]">{pick('Lịch vận hành', 'Scheduler')}</h1>
        <p className="mt-1 text-sm text-[var(--c-text-dim)]">
          {pick('Lịch tuần · ngoại lệ · publish có kiểm chứng', 'Weekly schedule · exceptions · verified publish')}
        </p>
      </div>
    </header>
  )
}

const SCHEDULER_FILTER_DEFAULTS = { q: '', status: 'all', outOfSync: '' }

export function SchedulerGridPage() {
  const { pick } = useI18n()
  const { schedules, loading, error, legacyFormat, reload, upsert } = useScheduler()
  const { session } = useAuth()
  const canEdit = roleAtLeast(session?.role, 'admin')
  const toast = useToast()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  /* `T57-2.2` — bộ lọc vào URL, cùng lý do với trang Cảnh báo: grid 64 lịch mà
     không chia sẻ được "đang xem cái nào" thì mọi trao đổi giữa hai người trực
     phải mô tả bằng lời cách bấm lại. */
  const filters = useUrlFilters(SCHEDULER_FILTER_DEFAULTS)
  const query = filters.values.q
  const statusFilter = filters.values.status as 'all' | ScheduleStatus
  const onlyOutOfSync = filters.values.outOfSync === '1'
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const capacity = useMemo(() => capacityUsage(schedules), [schedules])
  const migratedCount = useMemo(
    () => schedules.filter((s) => s.migrated_from_v1).length,
    [schedules]
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return schedules.filter((s) => {
      if (onlyOutOfSync && s.status !== 'OUT_OF_SYNC') return false
      if (statusFilter !== 'all' && s.status !== statusFilter) return false
      if (!q) return true
      return s.schedule_id.toLowerCase().includes(q) || s.schedule_name.toLowerCase().includes(q)
    })
  }, [schedules, query, statusFilter, onlyOutOfSync])

  /* Hai nhánh trả về sớm dưới đây GIỮ tiêu đề trang — `T57-0.4` (`F-UX-15`).
   *
   * Trả về một `StateBlock` trần làm trang mất `<h1>`: người dùng trình đọc màn
   * hình nghe thấy một thông báo lỗi mà không biết mình đang ở màn hình nào,
   * và cây heading của tài liệu rỗng (WCAG 2.2 §2.4.6). `MonitorPage` và
   * `AlarmsPage` đã sửa đúng lỗi này từ PA3-603; trang Lịch vận hành bị bỏ sót
   * vì nhánh lỗi của nó nằm TRƯỚC chỗ dựng tiêu đề, không phải sau. */
  // Tệp còn định dạng cũ là một bước quản trị chưa chạy, không phải hỏng hóc.
  if (legacyFormat) {
    return (
      <div className="space-y-4">
      <SchedulerHeading />
      <StateBlock
        state="error"
        title={pick('Cấu hình lịch còn ở định dạng cũ', 'Schedule config is still in the legacy format')}
        detail={pick(
          'Di trú sang mô hình Schedule Object v3.1 chạy lúc khởi động dịch vụ. ' +
            'Hãy khởi động lại mkddc-web rồi mở lại trang này. Bản cũ được giữ nguyên tại ' +
            'schedule.conf.v1.bak nên không mất gì.',
          'Migration to the Schedule Object v3.1 model runs at service startup. ' +
            'Restart mkddc-web and reopen this page. The old file is kept at ' +
            'schedule.conf.v1.bak so nothing is lost.'
        )}
        onRetry={() => { void reload() }}
      />
      </div>
    )
  }
  if (error && schedules.length === 0) {
    return (
      <div className="space-y-4">
        <SchedulerHeading />
        <StateBlock
          state="error"
          title={pick('Không tải được danh sách lịch', 'Could not load the schedule list')}
          detail={error.message}
          onRetry={() => { void reload() }}
        />
      </div>
    )
  }

  async function createSchedule() {
    const id = nextScheduleId(schedules)
    if (!id) {
      toast.push('error', pick(`Đã đạt trần ${MAX_SCHEDULES} lịch`, `Reached the ${MAX_SCHEDULES}-schedule limit`))
      return
    }
    setBusy(true)
    try {
      const draft = blankSchedule(id)
      draft.schedule_name = pick(`Lịch ${id}`, `Schedule ${id}`)
      const created = await apiClient.createSchedule(draft)
      upsert(created)
      navigate(`/eng/scheduler/${created.schedule_id}`)
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function bulkSetEnabled(enabled: boolean) {
    setBusy(true)
    // Kết quả hiện TỪNG lịch một, không gộp thành một dòng "thành công".
    const results: string[] = []
    for (const id of selected) {
      try {
        const updated = enabled ? await apiClient.enableSchedule(id) : await apiClient.disableSchedule(id)
        upsert(updated)
        results.push(`${id}: ${updated.status}`)
      } catch (err) {
        results.push(`${id}: ${pick('LỖI', 'ERROR')} ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    setBusy(false)
    toast.push('info', results.join(' · '))
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(schedules, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `schedules-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function importJson(file: File) {
    setBusy(true)
    try {
      const parsed = JSON.parse(await file.text()) as ScheduleObject[]
      if (!Array.isArray(parsed)) throw new Error(pick('Tệp phải chứa một mảng Schedule Object', 'File must contain an array of Schedule Object'))
      const existing = new Set(schedules.map((s) => s.schedule_id))
      let created = 0
      for (const item of parsed) {
        // Xung đột ID: cấp ID mới thay vì ghi đè im lặng.
        if (existing.has(item.schedule_id)) {
          const fresh = nextScheduleId([...schedules])
          if (!fresh) break
          item.schedule_id = fresh
        }
        const saved = await apiClient.createSchedule({ ...item, revision: 1, status: 'DRAFT' })
        upsert(saved)
        existing.add(saved.schedule_id)
        created++
      }
      toast.push('success', pick(`Đã nhập ${created}/${parsed.length} lịch, tất cả ở trạng thái nháp`, `Imported ${created}/${parsed.length} schedule(s), all set to draft`))
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--c-text)]">{pick('Lịch vận hành', 'Scheduler')}</h1>
          <p className="mt-1 text-sm text-[var(--c-text-dim)]">
            {pick('Lịch tuần · ngoại lệ · publish có kiểm chứng', 'Weekly schedule · exceptions · verified publish')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CapacityMeter
            label={pick('lịch', 'schedules')}
            used={capacity.schedules}
            max={capacity.maxSchedules}
          />
          <CapacityMeter
            label={pick('điểm ghi', 'write points')}
            used={capacity.points}
            max={capacity.maxPoints}
            hint={pick('Số điểm ghi nội bộ đang bị lịch chiếm', 'Internal write points currently claimed by schedules')}
          />
          {capacity.contested > 0 && (
            <span className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--c-warn-fg)]">
              {pick(`${capacity.contested} điểm bị nhiều lịch cùng ghi`, `${capacity.contested} point(s) written by multiple schedules`)}
            </span>
          )}
        </div>
      </header>

      {migratedCount > 0 && (
        /* Băng di trú: người dùng phải review trước khi bật lại lịch. Cảnh báo
           hành vi ở đây là bản rút gọn của R-01-B. */
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-4 py-3 text-sm text-[var(--c-warn-fg)]">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            <strong>{pick(`${migratedCount} lịch`, `${migratedCount} schedule(s)`)}</strong>{' '}
            {pick('đã chuyển từ định dạng cũ và đang', 'were migrated from the legacy format and are currently')}{' '}
            <strong>{pick('tắt', 'disabled')}</strong>.{' '}
            {pick(
              'Mô hình mới giữ điểm ở giá trị mặc định ngoài khung giờ, khác mô hình cũ vốn nhả quyền — điểm nào dùng chung với logic nội bộ sẽ đổi hành vi sau khi bật lại. Hãy kiểm tra rồi publish.',
              'The new model holds points at their default value outside the scheduled window, unlike the legacy model which released control — points shared with internal logic will change behaviour once re-enabled. Review then publish.'
            )}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="h-9 w-56 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
          placeholder={pick('Tìm theo mã hoặc tên…', 'Search by ID or name…')}
          value={query}
          onChange={(e) => filters.set('q', e.target.value)}
          aria-label={pick('Tìm lịch', 'Search schedules')}
        />
        <select
          className="h-9 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)]"
          value={statusFilter}
          onChange={(e) => filters.set('status', e.target.value)}
          aria-label={pick('Lọc theo trạng thái', 'Filter by status')}
        >
          <option value="all">{pick('Mọi trạng thái', 'All statuses')}</option>
          {(['DRAFT', 'VALIDATED', 'PUBLISHED', 'ACTIVE', 'INACTIVE', 'DISABLED', 'ERROR', 'OUT_OF_SYNC'] as ScheduleStatus[]).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-[var(--c-text-dim)]">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--c-accent)]"
            checked={onlyOutOfSync}
            onChange={(e) => filters.set('outOfSync', e.target.checked ? '1' : '')}
          />
          {pick('Chỉ lịch lệch revision', 'Only out-of-sync revisions')}
        </label>

        <div className="ml-auto flex flex-wrap gap-2">
          <Button icon={<RefreshCw className="h-4 w-4" />} loading={loading} onClick={() => { void reload() }}>
            {pick('Tải lại', 'Reload')}
          </Button>
          <Button
            icon={<Upload className="h-4 w-4" />}
            disabled={!canEdit || busy}
            title={canEdit ? undefined : pick('Cần quyền admin', 'Requires admin role')}
            onClick={() => fileRef.current?.click()}
          >
            {pick('Nhập', 'Import')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = '' }}
          />
          <Button icon={<Download className="h-4 w-4" />} onClick={exportJson} disabled={schedules.length === 0}>
            {pick('Xuất', 'Export')}
          </Button>
          <Button
            variant="primary"
            icon={<Plus className="h-4 w-4" />}
            disabled={!canEdit || busy || schedules.length >= MAX_SCHEDULES}
            title={canEdit ? undefined : pick('Cần quyền admin', 'Requires admin role')}
            onClick={() => { void createSchedule() }}
          >
            {pick('Lịch mới', 'New schedule')}
          </Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-[var(--c-accent)] bg-[var(--c-surface-2)] px-4 py-2 text-sm">
          <span className="text-[var(--c-text)]">{pick(`Đã chọn ${selected.size} lịch`, `${selected.size} schedule(s) selected`)}</span>
          <Button size="sm" disabled={!canEdit || busy} onClick={() => { void bulkSetEnabled(true) }}>{pick('Bật', 'Enable')}</Button>
          <Button size="sm" disabled={!canEdit || busy} onClick={() => { void bulkSetEnabled(false) }}>{pick('Tắt', 'Disable')}</Button>
          <Button size="sm" onClick={() => setSelected(new Set())}>{pick('Bỏ chọn', 'Clear selection')}</Button>
        </div>
      )}

      <Panel title={pick('Danh sách lịch', 'Schedule list')} subtitle={`${visible.length}/${schedules.length}`}>
        {loading && schedules.length === 0 ? (
          <div className="p-6 text-sm text-[var(--c-text-dim)]">{pick('Đang tải…', 'Loading…')}</div>
        ) : visible.length === 0 ? (
          <div className="p-6 text-sm text-[var(--c-text-dim)]">
            {schedules.length === 0
              ? pick(
                'Chưa có lịch nào. Một Schedule Object gồm lịch tuần, ngoại lệ, giá trị mặc định và danh sách điểm điều khiển.',
                'No schedules yet. A Schedule Object has a weekly schedule, exceptions, a default value and a list of controlled points.'
              )
              : pick('Không có lịch nào khớp bộ lọc.', 'No schedules match the filter.')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--c-border)] text-left text-xs uppercase text-[var(--c-text-dim)]">
                  <th className="w-8 px-2 py-2"><span className="sr-only">{pick('Chọn', 'Select')}</span></th>
                  <th className="px-2 py-2">{pick('Mã', 'ID')}</th>
                  <th className="px-2 py-2">{pick('Tên', 'Name')}</th>
                  <th className="px-2 py-2">{pick('Trạng thái', 'Status')}</th>
                  <th className="px-2 py-2">{pick('Tuần', 'Week')}</th>
                  <th className="px-2 py-2 text-right">{pick('Ngoại lệ', 'Exceptions')}</th>
                  <th className="px-2 py-2 text-right">{pick('Điểm', 'Points')}</th>
                  <th className="px-2 py-2">{pick('Hiện tại', 'Current')}</th>
                  <th className="px-2 py-2">{pick('Kế tiếp', 'Next')}</th>
                  <th className="px-2 py-2 text-right">Rev</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <ScheduleRowView
                    key={s.schedule_id}
                    schedule={s}
                    checked={selected.has(s.schedule_id)}
                    onToggle={() => {
                      setSelected((cur) => {
                        const next = new Set(cur)
                        if (next.has(s.schedule_id)) next.delete(s.schedule_id)
                        else next.add(s.schedule_id)
                        return next
                      })
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

function ScheduleRowView({
  schedule, checked, onToggle
}: { schedule: ScheduleObject; checked: boolean; onToggle: () => void }) {
  const { pick, locale, lang } = useI18n()
  const rt = schedule.runtime
  return (
    <tr className="border-b border-[var(--c-border)] align-top hover:bg-[var(--c-surface-2)]">
      <td className="px-2 py-2">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[var(--c-accent)]"
          checked={checked}
          onChange={onToggle}
          aria-label={pick(`Chọn ${schedule.schedule_id}`, `Select ${schedule.schedule_id}`)}
        />
      </td>
      <td className="px-2 py-2 font-mono">
        <Link className="text-[var(--c-accent)] hover:underline" to={`/eng/scheduler/${schedule.schedule_id}`}>
          {schedule.schedule_id}
        </Link>
      </td>
      <td className="max-w-[16rem] truncate px-2 py-2 text-[var(--c-text)]" title={schedule.schedule_name}>
        {schedule.schedule_name || EM_DASH}
      </td>
      <td className="px-2 py-2"><StatusDot schedule={schedule} /></td>
      <td className="max-w-[14rem] truncate px-2 py-2 font-mono text-xs text-[var(--c-text-dim)]"
          title={weeklySummary(schedule.weekly_schedule, schedule.value_type, lang)}>
        {weeklySummary(schedule.weekly_schedule, schedule.value_type, lang)}
      </td>
      <td className="px-2 py-2 text-right">{schedule.exception_schedule.length || EM_DASH}</td>
      <td className="px-2 py-2 text-right">{schedule.target_objects.length || EM_DASH}</td>
      {/* Hai cột dưới đây đến từ controller. Chưa publish ⇒ gạch ngang. */}
      <td className="px-2 py-2 font-semibold text-[var(--c-text)]">
        {rt ? formatValue(rt.effective_value, schedule.value_type, lang) : EM_DASH}
      </td>
      <td className="px-2 py-2 font-mono text-xs">
        {rt?.next_transition_at ? new Date(rt.next_transition_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : EM_DASH}
      </td>
      <td className="px-2 py-2 text-right font-mono text-xs">{schedule.revision}</td>
    </tr>
  )
}

function CapacityMeter({
  label, used, max, hint
}: { label: string; used: number; max: number; hint?: string }) {
  const ratio = max === 0 ? 0 : used / max
  const tone = ratio >= 1 ? 'border-[var(--c-bad)] text-[var(--c-bad-fg)]'
    : ratio >= 0.8 ? 'border-[var(--c-warn)] text-[var(--c-warn-fg)]'
      : 'border-[var(--c-border)] text-[var(--c-text-dim)]'
  return (
    <span
      className={cn('rounded-[var(--radius)] border px-2.5 py-1 font-mono text-xs', tone)}
      title={hint}
    >
      {used}/{max} {label}
    </span>
  )
}
