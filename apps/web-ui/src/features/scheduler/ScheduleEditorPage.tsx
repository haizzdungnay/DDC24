import { ArrowLeft, CheckCircle2, Lock, Save, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiClient } from '../../shared/api/client'
import { Button } from '../../shared/components/Button'
import { Modal } from '../../shared/components/Modal'
import { StateBlock } from '../../shared/components/StateBlock'
import { useToast } from '../../shared/components/Toast'
import type { ScheduleObject, ScheduleValidationFinding, ScheduleValueType } from '../../shared/types'
import { cn } from '../../shared/utils'
import { roleAtLeast, useAuth } from '../auth'
import { RuntimeStrip, StatusDot } from './components/StatusDot'
import { ExceptionTab } from './tabs/ExceptionTab'
import { AuditTab, RevisionTab } from './tabs/HistoryTabs'
import { SimulateTab } from './tabs/SimulateTab'
import { TargetTab } from './tabs/TargetTab'
import { WeeklyTab } from './tabs/WeeklyTab'
import { PublishDialog } from './components/PublishDialog'
import { EM_DASH, ERROR_CODE_HINTS, formatValue, restingValue } from './shared'
import { useScheduler } from './useScheduler'

type TabKey = 'weekly' | 'exceptions' | 'targets' | 'simulate' | 'revisions' | 'audit'

/**
 * Editor một Schedule Object — 6 tab dùng chung một bản nháp.
 *
 * Dải runtime nằm dưới cùng và hiện ở MỌI tab: người dùng không bao giờ sửa
 * lịch mà không thấy lịch đang làm gì (nguyên tắc S2).
 */
export function ScheduleEditorPage() {
  const { id } = useParams<{ id: string }>()
  const { schedules, loading, error, upsert, remove, reload } = useScheduler()
  const { session } = useAuth()
  const canEdit = roleAtLeast(session?.role, 'admin')
  const toast = useToast()
  const navigate = useNavigate()

  const saved = useMemo(() => schedules.find((s) => s.schedule_id === id), [schedules, id])
  const [draft, setDraft] = useState<ScheduleObject | null>(null)
  const [tab, setTab] = useState<TabKey>('weekly')
  const [findings, setFindings] = useState<ScheduleValidationFinding[]>([])
  const [busy, setBusy] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Nạp bản nháp từ bản đã lưu khi mở lịch khác, hoặc khi revision đổi.
  useEffect(() => {
    if (saved) setDraft(structuredClone(saved))
  }, [saved?.schedule_id, saved?.revision])

  const dirty = useMemo(
    () => Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved)),
    [draft, saved]
  )

  if (loading && !saved) return <div className="p-6 text-sm text-[var(--c-text-dim)]">Đang tải…</div>
  if (error && !saved) {
    return <StateBlock state="error" title="Không tải được lịch" detail={error.message} onRetry={() => { void reload() }} />
  }
  if (!saved || !draft) {
    return (
      <StateBlock
        state="empty"
        title={`Không tìm thấy lịch ${id ?? ''}`}
        detail="Lịch có thể đã bị xoá. Quay lại danh sách để xem các lịch còn lại."
      />
    )
  }

  const patch = (changes: Partial<ScheduleObject>) => setDraft((d) => (d ? { ...d, ...changes } : d))

  async function save() {
    if (!draft) return
    setBusy(true)
    try {
      const updated = await apiClient.updateSchedule(draft.schedule_id, draft)
      upsert(updated)
      setFindings([])
      toast.push('success', `Đã lưu ${updated.schedule_id} — revision ${updated.revision}`)
    } catch (err) {
      applyApiError(err, setFindings, toast)
    } finally {
      setBusy(false)
    }
  }

  async function validate() {
    if (!draft) return
    setBusy(true)
    try {
      if (dirty) {
        const updated = await apiClient.updateSchedule(draft.schedule_id, draft)
        upsert(updated)
      }
      const result = await apiClient.validateSchedule(draft.schedule_id)
      setFindings(result.findings)
      if (result.valid) toast.push('success', 'Cấu hình hợp lệ — có thể publish')
      else toast.push('error', `${result.findings.length} vấn đề cần sửa`)
      await reload()
    } catch (err) {
      applyApiError(err, setFindings, toast)
    } finally {
      setBusy(false)
    }
  }

  async function setEnabled(enabled: boolean) {
    setBusy(true)
    try {
      const updated = enabled
        ? await apiClient.enableSchedule(saved!.schedule_id)
        : await apiClient.disableSchedule(saved!.schedule_id)
      upsert(updated)
      toast.push(
        updated.status === 'OUT_OF_SYNC' ? 'info' : 'success',
        updated.status === 'OUT_OF_SYNC'
          ? 'Đã ghi cấu hình nhưng controller chưa nạp lại — lịch cũ còn chạy'
          : enabled ? 'Đã bật lịch' : 'Đã tắt lịch, các điểm điều khiển được nhả'
      )
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function doDelete() {
    setBusy(true)
    try {
      await apiClient.deleteSchedule(saved!.schedule_id)
      remove(saved!.schedule_id)
      toast.push('success', `Đã xoá ${saved!.schedule_id}; nhật ký audit được lưu trữ, không xoá`)
      navigate('/eng/scheduler')
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setDeleteOpen(false)
    }
  }

  const valueTypeLocked = draft.target_objects.length > 0
  const tabs: { key: TabKey; label: string; badge?: number }[] = [
    { key: 'weekly', label: 'Tuần' },
    { key: 'exceptions', label: 'Ngoại lệ', badge: draft.exception_schedule.length },
    { key: 'targets', label: 'Điểm điều khiển', badge: draft.target_objects.length },
    { key: 'simulate', label: 'Mô phỏng' },
    { key: 'revisions', label: 'Phiên bản' },
    { key: 'audit', label: 'Nhật ký' }
  ]

  return (
    <div className="space-y-4">
      <header className="space-y-3">
        <Link className="inline-flex items-center gap-1.5 text-sm text-[var(--c-accent)] hover:underline" to="/eng/scheduler">
          <ArrowLeft className="h-4 w-4" /> Danh sách lịch
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold text-[var(--c-text)]">
              <span className="font-mono text-[var(--c-text-dim)]">{draft.schedule_id}</span>{' '}
              {draft.schedule_name || 'Chưa đặt tên'}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
              <StatusDot schedule={saved} />
              <span className="font-mono text-xs text-[var(--c-text-dim)]">rev {saved.revision}</span>
              {dirty && <span className="rounded bg-[var(--c-warn-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--c-warn-fg)]">Có thay đổi chưa lưu</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || !roleAtLeast(session?.role, 'operator')}
              onClick={() => { void setEnabled(!saved.enabled) }}
            >
              {saved.enabled ? 'Tắt lịch' : 'Bật lịch'}
            </Button>
            <Button size="sm" icon={<CheckCircle2 className="h-4 w-4" />} disabled={busy || !canEdit} onClick={() => { void validate() }}>
              Kiểm tra
            </Button>
            <Button size="sm" variant="primary" icon={<Save className="h-4 w-4" />} disabled={busy || !canEdit || !dirty} onClick={() => { void save() }}>
              Lưu
            </Button>
            <Button size="sm" icon={<Upload className="h-4 w-4" />} disabled={busy || !canEdit || dirty}
                    title={dirty ? 'Lưu thay đổi trước khi publish' : undefined}
                    onClick={() => setPublishOpen(true)}>
              Publish
            </Button>
            <Button size="sm" icon={<Trash2 className="h-4 w-4" />} disabled={busy || !canEdit} onClick={() => setDeleteOpen(true)}>
              Xoá
            </Button>
          </div>
        </div>
      </header>

      <ScheduleBasics
        draft={draft}
        canEdit={canEdit}
        valueTypeLocked={valueTypeLocked}
        onChange={patch}
      />

      {findings.length > 0 && <FindingList findings={findings} />}

      <nav className="flex flex-wrap gap-1 border-b border-[var(--c-border)]" aria-label="Phần của lịch">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium transition',
              tab === t.key
                ? 'border-[var(--c-accent)] text-[var(--c-text)]'
                : 'border-transparent text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
            )}
          >
            {t.label}
            {t.badge !== undefined && t.badge > 0 && (
              <span className="ml-1.5 rounded-full bg-[var(--c-surface-2)] px-1.5 text-xs">{t.badge}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="min-h-[24rem]">
        {tab === 'weekly' && <WeeklyTab draft={draft} canEdit={canEdit} onChange={patch} />}
        {tab === 'exceptions' && <ExceptionTab draft={draft} canEdit={canEdit} onChange={patch} />}
        {tab === 'targets' && <TargetTab draft={draft} saved={saved} canEdit={canEdit} onChange={patch} />}
        {tab === 'simulate' && <SimulateTab schedule={saved} dirty={dirty} />}
        {tab === 'revisions' && <RevisionTab schedule={saved} canEdit={canEdit} onRestored={upsert} />}
        {tab === 'audit' && <AuditTab schedule={saved} />}
      </div>

      {/* Dải runtime luôn hiện diện — S2. */}
      <RuntimeStrip
        runtime={saved.runtime}
        valueLabel={formatValue(saved.runtime?.effective_value ?? null, saved.value_type)}
      />

      <PublishDialog
        open={publishOpen}
        schedule={saved}
        onClose={() => setPublishOpen(false)}
        onPublished={(updated) => { upsert(updated); void reload() }}
      />

      <Modal
        open={deleteOpen}
        title={`Xoá ${saved.schedule_id}?`}
        confirmLabel="Xoá lịch"
        cancelLabel="Huỷ"
        onConfirm={() => { void doDelete() }}
        onClose={() => setDeleteOpen(false)}
      >
        <div className="space-y-2 text-sm">
          <p>Trình tự thực hiện, theo đúng thứ tự:</p>
          <ol className="list-decimal space-y-1 pl-5 text-[var(--c-text-dim)]">
            <li>Nhả toàn bộ {saved.target_objects.length} điểm điều khiển đang bị lịch này giữ</li>
            <li>Xác nhận không còn lệnh nào giữ ở mức priority của lịch</li>
            <li>Lưu phiên bản cuối vào nhật ký audit</li>
            <li>Xoá lịch khỏi cấu hình</li>
          </ol>
          <p className="text-[var(--c-text)]">
            Nhật ký audit <strong>được giữ lại</strong> trong vùng lưu trữ, không bị xoá.
          </p>
        </div>
      </Modal>
    </div>
  )
}

function ScheduleBasics({
  draft, canEdit, valueTypeLocked, onChange
}: {
  draft: ScheduleObject
  canEdit: boolean
  valueTypeLocked: boolean
  onChange: (changes: Partial<ScheduleObject>) => void
}) {
  return (
    <section className="grid gap-3 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4 md:grid-cols-2 lg:grid-cols-4">
      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">Tên lịch</span>
        <input
          className={inputClass}
          value={draft.schedule_name}
          disabled={!canEdit}
          maxLength={64}
          onChange={(e) => onChange({ schedule_name: e.target.value })}
        />
      </label>

      <label className="space-y-1">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase text-[var(--c-text-dim)]">
          Kiểu giá trị
          {valueTypeLocked && <Lock className="h-3 w-3" aria-label="Đã khoá" />}
        </span>
        <select
          className={inputClass}
          value={draft.value_type}
          disabled={!canEdit || valueTypeLocked}
          title={valueTypeLocked
            ? 'Đã có điểm điều khiển nên không đổi được kiểu giá trị. Gỡ hết điểm ở tab Điểm điều khiển rồi mới đổi được.'
            : undefined}
          onChange={(e) => {
            const vt = e.target.value as ScheduleValueType
            // Đổi kiểu thì giá trị mặc định cũ không còn hợp lệ.
            onChange({ value_type: vt, schedule_default: { value: restingValue(vt) } })
          }}
        >
          {(['BINARY', 'BOOLEAN', 'REAL', 'UNSIGNED', 'ENUMERATED'] as ScheduleValueType[]).map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </label>

      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">Giá trị mặc định</span>
        <DefaultValueInput draft={draft} canEdit={canEdit} onChange={onChange} />
        <span className="block text-xs text-[var(--c-text-dim)]">Dùng khi không sự kiện nào đang hiệu lực</span>
      </label>

      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">Múi giờ</span>
        <input
          className={inputClass}
          value={draft.timezone}
          disabled={!canEdit}
          onChange={(e) => onChange({ timezone: e.target.value })}
        />
      </label>

      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">Hiệu lực từ</span>
        <input
          type="date"
          className={inputClass}
          value={draft.effective_period.start_date ?? ''}
          disabled={!canEdit}
          onChange={(e) => onChange({
            effective_period: { ...draft.effective_period, start_date: e.target.value || null }
          })}
        />
      </label>

      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">Hiệu lực đến</span>
        <input
          type="date"
          className={inputClass}
          value={draft.effective_period.end_date ?? ''}
          disabled={!canEdit}
          onChange={(e) => onChange({
            effective_period: { ...draft.effective_period, end_date: e.target.value || null }
          })}
        />
        {/* Ô trống là mập mờ; nói bằng chữ. */}
        <span className="block text-xs text-[var(--c-text-dim)]">
          {draft.effective_period.end_date ? EM_DASH : 'Không có ngày kết thúc'}
        </span>
      </label>

      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">Ưu tiên ghi</span>
        <input
          type="number"
          min={1}
          max={16}
          className={inputClass}
          value={draft.priority_for_writing}
          disabled={!canEdit}
          onChange={(e) => onChange({ priority_for_writing: Number(e.target.value) })}
        />
        {/* Không có câu này thì "Priority 16" là con số vô nghĩa với người vận
            hành đứng trước bo (ADR-023 QĐ-1). */}
        <span className="block text-xs text-[var(--c-text-dim)]">
          Phân xử giữa các lịch cùng ghi một điểm. Mọi lịch đều ở mức{' '}
          <strong>{draft.core_priority_level}</strong> của controller, nên lệnh tay tại chỗ vẫn thắng.
        </span>
        {draft.priority_for_writing <= 2 && (
          <span className="block text-xs font-semibold text-[var(--c-warn-fg)]">
            Ưu tiên rất cao — lịch này sẽ đè mọi lịch khác trên cùng một điểm.
          </span>
        )}
      </label>

      <label className="space-y-1 md:col-span-2 lg:col-span-1">
        <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">Mô tả</span>
        <input
          className={inputClass}
          value={draft.description ?? ''}
          disabled={!canEdit}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </label>
    </section>
  )
}

function DefaultValueInput({
  draft, canEdit, onChange
}: { draft: ScheduleObject; canEdit: boolean; onChange: (c: Partial<ScheduleObject>) => void }) {
  const v = draft.schedule_default.value
  if (draft.value_type === 'BINARY' || draft.value_type === 'BOOLEAN') {
    const on = draft.value_type === 'BINARY' ? v === 'ACTIVE' : v === true
    return (
      <select
        className={inputClass}
        value={on ? 'on' : 'off'}
        disabled={!canEdit}
        onChange={(e) => {
          const next = e.target.value === 'on'
          onChange({ schedule_default: { value: draft.value_type === 'BINARY' ? (next ? 'ACTIVE' : 'INACTIVE') : next } })
        }}
      >
        <option value="off">TẮT</option>
        <option value="on">BẬT</option>
      </select>
    )
  }
  return (
    <input
      type="number"
      className={inputClass}
      value={Number(v)}
      disabled={!canEdit}
      onChange={(e) => onChange({ schedule_default: { value: Number(e.target.value) } })}
    />
  )
}

function FindingList({ findings }: { findings: ScheduleValidationFinding[] }) {
  const errors = findings.filter((f) => f.severity !== 'warning')
  const warnings = findings.filter((f) => f.severity === 'warning')
  return (
    <section className="space-y-2">
      {[...errors, ...warnings].map((f, i) => (
        <div
          key={`${f.code}-${f.path}-${i}`}
          className={cn(
            'rounded-[var(--radius)] border px-4 py-2.5 text-sm',
            f.severity === 'warning'
              ? 'border-[var(--c-warn)] bg-[var(--c-warn-bg)] text-[var(--c-warn-fg)]'
              : 'border-[var(--c-bad)] bg-[var(--c-bad-bg)] text-[var(--c-bad-fg)]'
          )}
        >
          <span className="font-mono text-xs font-bold">{f.code}</span>
          <span className="ml-2">{ERROR_CODE_HINTS[f.code] ?? ''}</span>
          <div className="mt-0.5">{f.message}</div>
          <div className="mt-0.5 font-mono text-xs opacity-80">{f.path}</div>
        </div>
      ))}
    </section>
  )
}

/** Lỗi validate từ backend có cấu trúc; lỗi khác thì hiện nguyên văn. */
function applyApiError(
  err: unknown,
  setFindings: (f: ScheduleValidationFinding[]) => void,
  toast: ReturnType<typeof useToast>
) {
  const body = (err as { body?: { findings?: ScheduleValidationFinding[] } })?.body
  if (body?.findings?.length) {
    setFindings(body.findings)
    toast.push('error', `${body.findings.length} vấn đề cần sửa`)
    return
  }
  toast.push('error', err instanceof Error ? err.message : String(err))
}

const inputClass =
  'h-9 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)] disabled:cursor-not-allowed disabled:opacity-60'
