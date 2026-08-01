import { Activity, CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw, Save, SlidersHorizontal, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { apiClient } from '../api/client'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { Panel } from '../components/Panel'
import { useToast } from '../components/Toast'
import { useI18n } from '../i18n'
import type { ScheduleRow, ScheduleTarget, ScheduleType, VirtualPoint } from '../types'
import { cn } from '../utils'

type ViewMode = 'summary' | 'wizard' | 'parameters'
type WizardStep = 'type' | 'time' | 'weekdays' | 'target' | 'value' | 'notes'
type TargetOption = { value: string; label: string }

const maxSchedules = 64
const scheduleTypes: ScheduleType[] = ['not_active', 'controller_operation_mode', 'control_loop_setpoint', 'analog_output_value', 'fan_state_value', 'digital_output_value', 'holiday_period']
const weekdays = [
  { value: 'monday', label: 'T2' },
  { value: 'tuesday', label: 'T3' },
  { value: 'wednesday', label: 'T4' },
  { value: 'thursday', label: 'T5' },
  { value: 'friday', label: 'T6' },
  { value: 'saturday', label: 'T7' },
  { value: 'sunday', label: 'CN' }
]
const presetKey = 'mkddc:scheduler-local-preset:v1'
const wizardSteps: WizardStep[] = ['type', 'time', 'weekdays', 'target', 'value', 'notes']

export function SchedulerPage() {
  const toast = useToast()
  const { pick, t } = useI18n()
  const [rows, setRows] = useState<ScheduleRow[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('summary')
  const [wizardIndex, setWizardIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [virtualPoints, setVirtualPoints] = useState<VirtualPoint[]>([])

  useEffect(() => { void reloadSchedules() }, [])

  const selected = rows.find((row) => row.id === selectedId) ?? rows[0]
  const currentWizardStep = wizardSteps[Math.min(wizardIndex, wizardSteps.length - 1)]
  const validation = useMemo(() => validateSchedules(rows), [rows])

  async function reloadSchedules() {
    setLoading(true)
    try {
      const [items, virtualItems] = await Promise.all([apiClient.getSchedules(), apiClient.getVirtualPoints()])
      setVirtualPoints(virtualItems)
      setRows(items.map((item) => normalizeSchedulePatch(item, virtualItems)))
      setSelectedId((current) => items.some((item) => item.id === current) ? current : items[0]?.id ?? '')
    } catch (error) {
      toast.push('error', `${t('error')}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  function requestSave() {
    if (validation) return
    setConfirmOpen(true)
  }

  async function confirmSave() {
    setSaving(true)
    try {
      const result = await apiClient.putSchedules(rows)
      if (result.applied) {
        toast.push('success', t('saveSuccess'))
        setConfirmOpen(false)
        setViewMode('parameters')
      } else {
        toast.push('error', `${t('saveError')}: core reload failed`)
      }
    } catch (error) {
      toast.push('error', `${t('saveError')}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  function addSchedule() {
    if (rows.length >= maxSchedules) return
    const id = nextScheduleId(rows)
    const next = normalizeSchedulePatch({
      id,
      label: 'New Schedule',
      notes: '',
      enabled: false,
      scheduleType: 'not_active',
      timeOfDay: '08:00',
      startTime: '08:00',
      endTime: '17:00',
      startDate: '01-01',
      endDate: '01-01',
      weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      value: 0
    })
    setRows((current) => [...current, next])
    setSelectedId(id)
    setWizardIndex(0)
    setViewMode('wizard')
  }

  function updateSelected(patch: Partial<ScheduleRow>) {
    if (!selected) return
    const next = normalizeSchedulePatch({ ...selected, ...patch }, virtualPoints)
    setRows((current) => current.map((row) => row.id === selected.id ? next : row))
    if (patch.id !== undefined) setSelectedId(next.id)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--c-text)]">{pick('Lich van hanh', 'Scheduler')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Cau hinh Time Schedule toi da 64 muc.', 'Time Schedule configuration, up to 64 rows.')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={<RefreshCw className="h-4 w-4" />} loading={loading} onClick={() => { void reloadSchedules() }}>{pick('Tai lai', 'Reload')}</Button>
          <Button icon={<Plus className="h-4 w-4" />} onClick={addSchedule} disabled={rows.length >= maxSchedules}>{pick('Them lich', 'Add Schedule')}</Button>
          <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={saving} onClick={requestSave} disabled={loading || Boolean(validation)} title={validation ?? undefined}>{t('save')}</Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Panel title={pick('Danh sach lich', 'Schedules')} subtitle={`${rows.length}/${maxSchedules}`}>
          <div className="flex max-h-[calc(100vh-250px)] flex-col gap-1 overflow-y-auto pr-2">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => {
                  setSelectedId(row.id)
                  setWizardIndex(0)
                }}
                className={cn(
                  'flex min-h-14 items-center gap-3 rounded-[var(--radius)] border px-3 py-2 text-left text-sm transition',
                  selected?.id === row.id
                    ? 'border-[var(--c-accent)] bg-[var(--c-surface-2)] text-[var(--c-text)]'
                    : 'border-transparent text-[var(--c-text-dim)] hover:border-[var(--c-border)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]'
                )}
              >
                <CalendarDays className="h-4 w-4 shrink-0 text-[var(--c-accent)]" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block font-semibold">{row.id}</span>
                  <span className="block truncate text-xs">{row.label}</span>
                </span>
              </button>
            ))}
            {loading && <div className="rounded-[var(--radius)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">{t('loading')}</div>}
            {!loading && rows.length === 0 && <div className="rounded-[var(--radius)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">{t('empty')}</div>}
          </div>
        </Panel>

        <Panel
          title={selected ? `${selected.id} - ${selected.label || 'Untitled'}` : t('empty')}
          action={
            <div className="flex rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-1">
              <ModeButton active={viewMode === 'summary'} icon={<Activity className="h-4 w-4" />} label="Summary" onClick={() => setViewMode('summary')} />
              <ModeButton active={viewMode === 'wizard'} icon={<Wand2 className="h-4 w-4" />} label={t('wizard')} onClick={() => setViewMode('wizard')} />
              <ModeButton active={viewMode === 'parameters'} icon={<SlidersHorizontal className="h-4 w-4" />} label="Parameters" onClick={() => setViewMode('parameters')} />
            </div>
          }
        >
          {selected ? (
            <div className="space-y-5">
              <ScheduleBasics row={selected} onChange={updateSelected} />
              {viewMode === 'summary' && <SummaryPanel row={selected} onChange={updateSelected} />}
              {viewMode === 'wizard' && (
                <SchedulerWizardPanel
                  row={selected}
                  virtualPoints={virtualPoints}
                  step={currentWizardStep}
                  steps={wizardSteps}
                  stepIndex={Math.min(wizardIndex, wizardSteps.length - 1)}
                  onChange={updateSelected}
                  onStepSelect={setWizardIndex}
                  onPrevious={() => setWizardIndex((index) => Math.max(index - 1, 0))}
                  onNext={() => setWizardIndex((index) => Math.min(index + 1, wizardSteps.length - 1))}
                  onFinish={requestSave}
                  onSavePreset={() => savePreset(selected, toast, pick)}
                  onLoadPreset={() => loadPreset(updateSelected, toast, pick, virtualPoints)}
                />
              )}
              {viewMode === 'parameters' && <ParametersPanel row={selected} virtualPoints={virtualPoints} onChange={updateSelected} />}
              {validation && <div className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-sm text-[var(--c-warn-fg)]">{validation}</div>}
            </div>
          ) : (
            <div className="rounded-[var(--radius)] bg-[var(--c-surface-2)] p-4 text-sm text-[var(--c-text-dim)]">{pick('Them lich dau tien de cau hinh.', 'Add the first schedule to configure.')}</div>
          )}
        </Panel>
      </div>
      <Modal
        open={confirmOpen}
        title={pick('Lưu cấu hình Time Schedule?', 'Save Time Schedule config?')}
        confirmLabel="OK"
        cancelLabel="Cancel"
        onConfirm={() => { void confirmSave() }}
        onClose={() => setConfirmOpen(false)}
      >
        {pick('Bạn có muốn lưu thay đổi không?', 'Do you want to save the changes?')}
      </Modal>
    </div>
  )
}

function ScheduleBasics({ row, onChange }: { row: ScheduleRow; onChange: (patch: Partial<ScheduleRow>) => void }) {
  const { pick } = useI18n()
  return (
    <div className="grid gap-4 md:grid-cols-[160px_minmax(0,1fr)_160px]">
      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">ID</span>
        <input className={controlClass()} value={row.id} onChange={(event) => onChange({ id: event.target.value.trim().toUpperCase() })} />
      </label>
      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Ten lich', 'Label')}</span>
        <input className={controlClass()} value={row.label} onChange={(event) => onChange({ label: event.target.value })} />
      </label>
      <label className="flex items-end gap-2 pb-2 text-sm font-semibold text-[var(--c-text-dim)]">
        <input className="h-4 w-4 accent-[var(--c-accent)]" type="checkbox" checked={row.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
        {pick('Bat lich', 'Enabled')}
      </label>
    </div>
  )
}

function SummaryPanel({ row, onChange }: { row: ScheduleRow; onChange: (patch: Partial<ScheduleRow>) => void }) {
  const { pick } = useI18n()
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
        <h3 className="text-sm font-semibold text-[var(--c-text)]">{pick('Trang thai / muc tieu', 'Status / Target')}</h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <SummaryItem label={<ScheduleTypeNameBadge type={row.scheduleType} />} value={scheduleTypeLabel(row.scheduleType)} />
          <SummaryItem label={pick('Thoi gian', 'Time')} value={row.scheduleType === 'holiday_period' ? `${row.startDate ?? '--'} -> ${row.endDate ?? '--'}` : `${row.startTime} -> ${row.endTime}`} />
          <SummaryItem label={pick('Ngay', 'Weekdays')} value={formatWeekdays(row.weekdays) || '--'} />
          <SummaryItem label={pick('Muc tieu', 'Target')} value={targetKey(row.target) || '--'} />
          <SummaryItem label={pick('Gia tri', 'Value')} value={String(row.value)} />
          <SummaryItem label={pick('Trang thai', 'Status')} value={row.enabled ? 'Enabled' : 'Disabled'} />
        </dl>
      </section>
      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
        <h3 className="text-sm font-semibold text-[var(--c-text)]">{pick('Ghi chu', 'Notes')}</h3>
        <textarea
          className="mt-3 min-h-40 w-full resize-y rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
          value={row.notes ?? ''}
          onChange={(event) => onChange({ notes: event.target.value })}
        />
      </section>
    </div>
  )
}

function SchedulerWizardPanel({
  row,
  virtualPoints,
  step,
  steps,
  stepIndex,
  onChange,
  onStepSelect,
  onPrevious,
  onNext,
  onFinish,
  onSavePreset,
  onLoadPreset
}: {
  row: ScheduleRow
  virtualPoints: VirtualPoint[]
  step: WizardStep
  steps: WizardStep[]
  stepIndex: number
  onChange: (patch: Partial<ScheduleRow>) => void
  onStepSelect: (index: number) => void
  onPrevious: () => void
  onNext: () => void
  onFinish: () => void
  onSavePreset: () => void
  onLoadPreset: () => void
}) {
  const { pick, t } = useI18n()
  const targets = targetOptions(row.scheduleType, virtualPoints)
  const bounds = valueBounds(row.scheduleType)
  const atEnd = stepIndex === steps.length - 1

  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">
          {stepIndex + 1} / {steps.length}
        </div>
        <div className="h-2 flex-1 rounded-full bg-[var(--c-surface-2)]">
          <div className="h-2 rounded-full bg-[var(--c-accent)]" style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} />
        </div>
      </div>

      <div className="mb-4 overflow-x-auto border-b border-[var(--c-border)]">
        <div className="flex min-w-max gap-1">
          {steps.map((item, index) => (
            <button
              key={item}
              type="button"
              title={`${wizardStepLabel(item, pick)}: ${wizardStepValue(item, row)}`}
              onClick={() => onStepSelect(index)}
              className={cn(
                'min-w-24 border-b-2 px-3 py-2 text-left text-xs font-semibold transition',
                index === stepIndex
                  ? 'border-[var(--c-accent)] bg-[var(--c-surface-2)] text-[var(--c-text)]'
                  : 'border-transparent text-[var(--c-text-dim)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]'
              )}
            >
              <span className="block font-mono">{wizardStepRegister(item)}</span>
              <span className="block max-w-32 truncate">{wizardStepLabel(item, pick)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-44">
        {step === 'type' && (
          <ScheduleTypeField value={row.scheduleType} onChange={(value) => onChange(scheduleTypePatch(value, row, virtualPoints))} />
        )}
        {step === 'time' && (
          row.scheduleType === 'holiday_period' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Ngay bat dau', 'Start Date')}</span>
                <input className={controlClass()} placeholder="MM-DD" value={row.startDate ?? ''} onChange={(event) => onChange({ startDate: event.target.value })} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Ngay ket thuc', 'End Date')}</span>
                <input className={controlClass()} placeholder="MM-DD" value={row.endDate ?? ''} onChange={(event) => onChange({ endDate: event.target.value })} />
              </label>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Gio bat dau', 'Start Time')}</span>
                <input className={controlClass()} type="time" value={row.startTime} onChange={(event) => onChange({ startTime: event.target.value, timeOfDay: event.target.value })} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Gio ket thuc', 'End Time')}</span>
                <input className={controlClass()} type="time" value={row.endTime} onChange={(event) => onChange({ endTime: event.target.value })} />
              </label>
            </div>
          )
        )}
        {step === 'weekdays' && (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Ngay trong tuan', 'Weekdays')}</div>
            <div className="flex flex-wrap gap-2">
              {weekdays.map((day) => (
                <button
                  key={day.value}
                  type="button"
                  onClick={() => onChange({ weekdays: toggleWeekday(row.weekdays, day.value) })}
                  className={cn(
                    'h-9 min-w-11 rounded-[var(--radius)] border px-3 text-sm font-semibold transition',
                    row.weekdays.includes(day.value) ? 'border-[var(--c-accent)] bg-[var(--c-surface-2)] text-[var(--c-text)]' : 'border-[var(--c-border)] text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
                  )}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {step === 'target' && (
          <SelectField label={pick('Muc tieu', 'Target')} value={targetKey(row.target)} disabled={targets.length === 0} onChange={(value) => onChange({ target: targetFromKey(value) })}>
            {targets.length === 0 ? <option value="">--</option> : targets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}
          </SelectField>
        )}
        {step === 'value' && (
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Gia tri', 'Value')}</span>
          <input className={controlClass()} type="number" min={bounds.min} max={bounds.max} step={bounds.step} value={row.value} onChange={(event) => onChange({ value: Number(event.target.value) })} />
        </label>
        )}
        {step === 'notes' && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={onLoadPreset}>{pick('Tai mau', 'Load')}</Button>
              <Button size="sm" onClick={onSavePreset}>{pick('Luu mau', 'Save as')}</Button>
            </div>
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Ghi chu', 'Notes')}</span>
              <textarea
                className="min-h-28 w-full resize-y rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
                value={row.notes ?? ''}
                onChange={(event) => onChange({ notes: event.target.value })}
              />
            </label>
          </div>
        )}
      </div>

      <div className="mt-5 flex justify-between gap-2">
        <Button icon={<ChevronLeft className="h-4 w-4" />} onClick={onPrevious} disabled={stepIndex === 0}>
          {t('previous')}
        </Button>
        <Button variant="primary" icon={!atEnd ? <ChevronRight className="h-4 w-4" /> : undefined} onClick={atEnd ? onFinish : onNext}>
          {atEnd ? t('finish') : t('next')}
        </Button>
      </div>
    </div>
  )
}

function ParametersPanel({ row, virtualPoints, onChange }: { row: ScheduleRow; virtualPoints: VirtualPoint[]; onChange: (patch: Partial<ScheduleRow>) => void }) {
  const targets = targetOptions(row.scheduleType, virtualPoints)
  const rows: { register: string; name: React.ReactNode; control: React.ReactNode }[] = [
    { register: 'TSx 0', name: 'ID', control: <input className={controlClass()} value={row.id} onChange={(event) => onChange({ id: event.target.value.trim().toUpperCase() })} /> },
    { register: 'TSx 1', name: 'Label', control: <input className={controlClass()} value={row.label} onChange={(event) => onChange({ label: event.target.value })} /> },
    { register: 'TSx 2', name: 'Enabled', control: <select className={controlClass()} value={row.enabled ? 1 : 0} onChange={(event) => onChange({ enabled: event.target.value === '1' })}><option value={1}>1</option><option value={0}>0</option></select> },
    { register: 'TSx 3', name: <ScheduleTypeNameBadge type={row.scheduleType} />, control: <select className={controlClass()} value={row.scheduleType} onChange={(event) => onChange(scheduleTypePatch(event.target.value as ScheduleType, row, virtualPoints))}>{scheduleTypes.map((type) => <option key={type} value={type}>{scheduleTypeLabel(type)}</option>)}</select> },
    { register: 'TSx 4', name: 'Start Time', control: <input className={controlClass()} type="time" value={row.startTime} disabled={row.scheduleType === 'holiday_period'} onChange={(event) => onChange({ startTime: event.target.value, timeOfDay: event.target.value })} /> },
    { register: 'TSx 5', name: 'End Time', control: <input className={controlClass()} type="time" value={row.endTime} disabled={row.scheduleType === 'holiday_period'} onChange={(event) => onChange({ endTime: event.target.value })} /> },
    { register: 'TSx 6', name: 'Weekdays', control: <select className={controlClass()} value="" disabled={row.scheduleType === 'holiday_period'} onChange={(event) => event.target.value && onChange({ weekdays: toggleWeekday(row.weekdays, event.target.value) })}><option value="">{formatWeekdays(row.weekdays) || '--'}</option>{weekdays.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}</select> },
    { register: 'TSx 7', name: 'Target', control: <select className={controlClass()} value={targetKey(row.target)} disabled={targets.length === 0} onChange={(event) => onChange({ target: targetFromKey(event.target.value) })}>{targets.length === 0 ? <option value="">--</option> : targets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</select> },
    { register: 'TSx 8', name: 'Value', control: <input className={controlClass()} type="number" value={row.value} disabled={row.scheduleType === 'not_active' || row.scheduleType === 'holiday_period'} onChange={(event) => onChange({ value: Number(event.target.value) })} /> },
    { register: 'TSx 9', name: 'Holiday Start', control: <input className={controlClass()} placeholder="MM-DD" value={row.startDate ?? ''} disabled={row.scheduleType !== 'holiday_period'} onChange={(event) => onChange({ startDate: event.target.value })} /> },
    { register: 'TSx 10', name: 'Holiday End', control: <input className={controlClass()} placeholder="MM-DD" value={row.endDate ?? ''} disabled={row.scheduleType !== 'holiday_period'} onChange={(event) => onChange({ endDate: event.target.value })} /> },
    { register: 'TSx 11', name: 'Notes', control: <input className={controlClass()} value={row.notes ?? ''} onChange={(event) => onChange({ notes: event.target.value })} /> }
  ]
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)]">
      <div className="grid grid-cols-[90px_minmax(0,1fr)_minmax(180px,300px)] bg-[var(--c-surface-2)] px-3 py-2 text-xs font-semibold uppercase text-[var(--c-text-dim)]">
        <span>Register</span>
        <span>Name</span>
        <span>Value</span>
      </div>
      {rows.map((item) => (
        <div key={item.register} className="grid grid-cols-[90px_minmax(0,1fr)_minmax(180px,300px)] items-center gap-3 border-t border-[var(--c-border)] px-3 py-3 text-sm">
          <span className="font-mono text-[var(--c-text-dim)]">{item.register}</span>
          <span className="font-medium text-[var(--c-text)]">{item.name}</span>
          {item.control}
        </div>
      ))}
    </div>
  )
}

function SelectField({ label, value, disabled, children, onChange }: { label: string; value: string; disabled?: boolean; children: React.ReactNode; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{label}</span>
      <select className={controlClass()} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  )
}

function SummaryItem({ label, value }: { label: React.ReactNode; value: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3">
      <dt className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{label}</dt>
      <dd className="mt-1 truncate font-mono text-lg font-semibold text-[var(--c-text)]">{value}</dd>
    </div>
  )
}

function ModeButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" className={cn('inline-flex h-8 items-center gap-2 rounded-[calc(var(--radius)-4px)] px-3 text-xs font-semibold transition', active ? 'bg-[var(--c-surface-2)] text-[var(--c-text)]' : 'text-[var(--c-text-dim)] hover:text-[var(--c-text)]')} onClick={onClick}>
      {icon}
      {label}
    </button>
  )
}

function targetOptions(type: ScheduleType, virtualPoints: VirtualPoint[] = []): TargetOption[] {
  if (type === 'controller_operation_mode') return virtualTargetOptions(virtualPoints)
  if (type === 'control_loop_setpoint') return virtualTargetOptions(virtualPoints)
  if (type === 'analog_output_value') return mergeTargets(numbered('AO', 4, 'wired'), virtualTargetOptions(virtualPoints))
  if (type === 'fan_state_value') return numbered('DO', 4, 'wired')
  if (type === 'digital_output_value') return numbered('DO', 4, 'wired')
  return []
}

function numbered(prefix: string, count: number, capability: string): TargetOption[] {
  return Array.from({ length: count }, (_, index) => {
    const value = `${prefix}-${String(index + 1).padStart(2, '0')}`
    return { value, label: `${value} (${capability})` }
  })
}

function virtualTargetOptions(virtualPoints: VirtualPoint[]): TargetOption[] {
  return virtualPoints
    .filter(isSchedulableVirtualPoint)
    .map((item) => {
      const value = dashedVirtualPointId(item.id)
      return { value, label: item.tag }
    })
    .filter((item) => item.value !== '')
}

function mergeTargets(base: TargetOption[], extra: TargetOption[]): TargetOption[] {
  const byValue = new Map(base.map((item) => [item.value, item]))
  for (const item of extra) byValue.set(item.value, item)
  return [...byValue.values()]
}

function normalizeSchedulePatch(row: ScheduleRow, virtualPoints: VirtualPoint[] = []): ScheduleRow {
  const targets = targetOptions(row.scheduleType, virtualPoints)
  const normalizedTarget = row.target ? targetFromKey(targetKey(row.target)) : undefined
  const currentTarget = targetKey(normalizedTarget)
  const target = targets.some((item) => item.value === currentTarget) ? normalizedTarget : targetFromKey(targets[0]?.value ?? '')
  const startTime = row.startTime || row.timeOfDay || '08:00'
  return {
    ...row,
    enabled: row.scheduleType === 'not_active' ? false : row.enabled,
    timeOfDay: startTime,
    startTime,
    endTime: row.endTime || '17:00',
    startDate: row.startDate || '01-01',
    endDate: row.endDate || '01-01',
    target
  }
}

function valueBounds(type: ScheduleType): { min: number; max: number; step: number } {
  if (type === 'controller_operation_mode') return { min: 0, max: 2, step: 1 }
  if (type === 'fan_state_value' || type === 'digital_output_value') return { min: 0, max: 1, step: 1 }
  if (type === 'analog_output_value') return { min: 0, max: 100, step: 0.1 }
  return { min: -999, max: 999, step: 0.1 }
}

function scheduleTypeLabel(type: ScheduleType): string {
  return type.split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ')
}

function capabilityLabel(type: ScheduleType): string {
  if (type === 'not_active') return 'STORED'
  if (type === 'holiday_period') return 'OVERRIDE'
  if (type === 'analog_output_value' || type === 'fan_state_value' || type === 'digital_output_value') return 'WIRED'
  return 'VIRTUAL'
}

function CapabilityBadge({ type }: { type: ScheduleType }) {
  const label = capabilityLabel(type)
  const tone = label === 'WIRED'
    ? 'border-[var(--c-good)] bg-[var(--c-good-bg)] text-[var(--c-good-fg)]'
    : label === 'OVERRIDE'
      ? 'border-[var(--c-warn)] bg-[var(--c-warn-bg)] text-[var(--c-warn-fg)]'
      : label === 'VIRTUAL'
        ? 'border-[var(--c-accent)] bg-[var(--c-accent-bg)] text-[var(--c-accent)]'
        : 'border-[var(--c-border)] bg-[var(--c-surface-2)] text-[var(--c-text-dim)]'
  return <span className={cn('inline-flex items-center rounded-[var(--radius)] border px-2 py-0.5 text-[10px] font-bold uppercase', tone)}>{label}</span>
}

function ScheduleTypeField({ value, onChange }: { value: ScheduleType; onChange: (value: ScheduleType) => void }) {
  const { pick } = useI18n()
  return (
    <label className="block space-y-2">
      <span className="flex items-center gap-2 text-sm font-semibold text-[var(--c-text)]">
        {pick('Loai lich', 'Schedule Type')}
        <CapabilityBadge type={value} />
      </span>
      <select className={controlClass()} value={value} onChange={(event) => onChange(event.target.value as ScheduleType)}>
        {scheduleTypes.map((type) => <option key={type} value={type}>{scheduleTypeLabel(type)}</option>)}
      </select>
    </label>
  )
}

function ScheduleTypeNameBadge({ type }: { type: ScheduleType }) {
  return (
    <span className="flex items-center gap-2 font-medium text-[var(--c-text)]">
      Schedule Type
      <CapabilityBadge type={type} />
    </span>
  )
}

function scheduleTypePatch(type: ScheduleType, row: ScheduleRow, virtualPoints: VirtualPoint[] = []): Partial<ScheduleRow> {
  const firstTarget = targetFromKey(targetOptions(type, virtualPoints)[0]?.value ?? '')
  return {
    scheduleType: type,
    enabled: type === 'not_active' ? false : row.enabled,
    target: firstTarget,
    value: type === 'controller_operation_mode' ? 1 : type === 'fan_state_value' || type === 'digital_output_value' ? 0 : row.value
  }
}

function wizardStepLabel(step: WizardStep, pick: ReturnType<typeof useI18n>['pick']): string {
  if (step === 'type') return pick('Loai lich', 'Schedule Type')
  if (step === 'time') return pick('Khoang thoi gian', 'Time Range')
  if (step === 'weekdays') return pick('Ngay trong tuan', 'Weekdays')
  if (step === 'target') return pick('Muc tieu', 'Target')
  if (step === 'value') return pick('Gia tri', 'Value')
  return pick('Ghi chu', 'Notes')
}

function wizardStepRegister(step: WizardStep): string {
  if (step === 'type') return 'TSx 3'
  if (step === 'time') return 'TSx 4-5'
  if (step === 'weekdays') return 'TSx 6'
  if (step === 'target') return 'TSx 7'
  if (step === 'value') return 'TSx 8'
  return 'TSx 11'
}

function wizardStepValue(step: WizardStep, row: ScheduleRow): string {
  if (step === 'type') return scheduleTypeLabel(row.scheduleType)
  if (step === 'time') return row.scheduleType === 'holiday_period' ? `${row.startDate ?? '--'} -> ${row.endDate ?? '--'}` : `${row.startTime} -> ${row.endTime}`
  if (step === 'weekdays') return formatWeekdays(row.weekdays) || '--'
  if (step === 'target') return targetKey(row.target) || '--'
  if (step === 'value') return String(row.value)
  return row.notes || '--'
}

function toggleWeekday(current: string[], day: string): string[] {
  return current.includes(day) ? current.filter((item) => item !== day) : [...current, day].sort((a, b) => weekdayIndex(a) - weekdayIndex(b))
}

function nextScheduleId(rows: ScheduleRow[]): string {
  const used = new Set(rows.map((row) => row.id))
  for (let index = 1; index <= maxSchedules; index += 1) {
    const id = `SCH-${String(index).padStart(3, '0')}`
    if (!used.has(id)) return id
  }
  return 'SCH-064'
}

function validateSchedules(rows: ScheduleRow[]): string | null {
  if (rows.length > maxSchedules) return 'Maximum 64 schedules.'
  const ids = new Set<string>()
  for (const row of rows) {
    if (!row.id.trim()) return 'Schedule ID is required.'
    if (!/^SCH-[A-Za-z0-9_-]+$/.test(row.id)) return `Invalid schedule ID: ${row.id}`
    if (ids.has(row.id)) return `Duplicate schedule ID: ${row.id}`
    ids.add(row.id)
    if (!row.label.trim()) return `Label is required for ${row.id}.`
    const executable = row.scheduleType !== 'not_active' && row.scheduleType !== 'holiday_period'
    if (executable && !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.startTime)) return `Start time HH:MM required for ${row.id}.`
    if (executable && !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.endTime)) return `End time HH:MM required for ${row.id}.`
    if (executable && row.startTime === row.endTime) return `Start and end time must differ for ${row.id}.`
    if (executable && row.weekdays.length === 0) return `Weekdays required for ${row.id}.`
    if (executable && !row.target) return `Target required for ${row.id}.`
    if (executable && !Number.isFinite(row.value)) return `Value required for ${row.id}.`
    if (row.scheduleType === 'holiday_period' && !validHolidayDate(row.startDate ?? '')) return `Holiday start date MM-DD required for ${row.id}.`
    if (row.scheduleType === 'holiday_period' && !validHolidayDate(row.endDate ?? '')) return `Holiday end date MM-DD required for ${row.id}.`
  }
  return null
}

function validHolidayDate(value: string): boolean {
  const match = value.match(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  if (!match) return false
  const month = Number(match[1])
  const day = Number(match[2])
  const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= days[month - 1]
}

function savePreset(row: ScheduleRow, toast: ReturnType<typeof useToast>, pick: ReturnType<typeof useI18n>['pick']) {
  window.localStorage.setItem(presetKey, JSON.stringify(row))
  toast.push('success', pick('Da luu mau', 'Preset saved'))
}

function loadPreset(onChange: (patch: Partial<ScheduleRow>) => void, toast: ReturnType<typeof useToast>, pick: ReturnType<typeof useI18n>['pick'], virtualPoints: VirtualPoint[]) {
  const raw = window.localStorage.getItem(presetKey)
  if (!raw) {
    toast.push('info', pick('Chua co mau da luu', 'No saved preset'))
    return
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ScheduleRow>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !scheduleTypes.includes(parsed.scheduleType as ScheduleType)) {
      throw new Error('invalid preset')
    }
    const preset = normalizeSchedulePatch({
      id: 'SCH-PRESET',
      label: 'Preset',
      notes: '',
      enabled: false,
      scheduleType: 'not_active',
      timeOfDay: '08:00',
      startTime: '08:00',
      endTime: '17:00',
      startDate: '01-01',
      endDate: '01-01',
      weekdays: [],
      value: 0,
      ...parsed
    }, virtualPoints)
    onChange({ notes: preset.notes, enabled: preset.enabled, scheduleType: preset.scheduleType, timeOfDay: preset.timeOfDay, startTime: preset.startTime, endTime: preset.endTime, startDate: preset.startDate, endDate: preset.endDate, weekdays: preset.weekdays, target: preset.target ? { ...preset.target } : undefined, value: preset.value })
  } catch {
    window.localStorage.removeItem(presetKey)
    toast.push('error', pick('Mau da luu bi loi, da xoa mau cu', 'Saved preset was invalid and was cleared'))
    return
  }
  toast.push('success', pick('Da tai mau', 'Preset loaded'))
}

function targetKey(target?: ScheduleTarget): string {
  if (!target) return ''
  if (target.channel !== undefined) return target.kind === 'VP' ? `VP${target.channel}` : `${target.kind}-${String(target.channel).padStart(2, '0')}`
  if (target.pointId) return target.pointId
  return target.kind
}

function targetFromKey(key: string): ScheduleTarget | undefined {
  const match = key.match(/^([A-Z]+)[-_]?(\d+)$/)
  if (!match) return undefined
  const kind = (match[1] === 'AV' ? 'VP' : match[1]) as ScheduleTarget['kind']
  const channel = Number(match[2])
  return { kind, channel, pointId: kind === 'VP' ? `VP${channel}` : `${kind}-${String(channel).padStart(2, '0')}` }
}

function dashedVirtualPointId(point: string): string {
  const match = point.trim().toUpperCase().match(/^(?:VP|AV)[-_]?0*(\d+)$/)
  return match ? `VP${Number(match[1])}` : ''
}

function isSchedulableVirtualPoint(item: VirtualPoint): boolean {
  return item.enabled && item.writable && (item.signalType === 'integer' || item.signalType === 'float')
}

function formatWeekdays(values: string[]): string {
  return values.map((value) => weekdays.find((day) => day.value === value)?.label ?? value).join(', ')
}

function weekdayIndex(value: string): number {
  const index = weekdays.findIndex((day) => day.value === value)
  return index < 0 ? 99 : index
}

function controlClass(): string {
  return 'h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)] disabled:cursor-not-allowed disabled:opacity-60'
}
