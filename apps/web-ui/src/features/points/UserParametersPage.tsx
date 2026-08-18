import { Activity, ChevronLeft, ChevronRight, Save, SlidersHorizontal, Wand2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type React from 'react'
import { apiClient } from '../../shared/api/client'
import { Button } from '../../shared/components/Button'
import { DirtyGuardModal } from '../../shared/components/DirtyGuardModal'
import { Modal } from '../../shared/components/Modal'
import { Panel } from '../../shared/components/Panel'
import { useToast } from '../../shared/components/Toast'
import { useDirtyGuard } from '../../shared/hooks/useDirtyGuard'
import { useI18n } from '../../shared/i18n'
import type { UserParamKey, UserParamValue, UserParamsConfig } from '../../shared/types'
import { cn } from '../../shared/utils'

type ViewMode = 'summary' | 'wizard' | 'advanced'
type CopyKey = Parameters<ReturnType<typeof useI18n>['t']>[0]
type ControlKind = 'bool' | 'select' | 'number' | 'time' | 'disabled'

interface UserParamOption {
  value: UserParamValue
  label: string
}

interface UserParamDef {
  key: UserParamKey
  register: string
  labelKey: CopyKey
  control: ControlKind
  min?: number
  max?: number
  options?: (ctx: LabelContext) => UserParamOption[]
}

interface LabelContext {
  t: ReturnType<typeof useI18n>['t']
  pick: ReturnType<typeof useI18n>['pick']
}

const wizardKeys: UserParamKey[] = ['UP05', 'UP07', 'UP19', 'UPSP', 'UPTS', 'LOCK1']

const paramDefs: UserParamDef[] = [
  { key: 'UP00', register: 'UP 00', labelKey: 'upParam00', control: 'bool' },
  { key: 'UP01', register: 'UP 01', labelKey: 'upParam01', control: 'bool' },
  { key: 'UP02', register: 'UP 02', labelKey: 'upParam02', control: 'bool' },
  { key: 'UP03', register: 'UP 03', labelKey: 'upParam03', control: 'bool' },
  { key: 'UP04', register: 'UP 04', labelKey: 'upParam04', control: 'bool' },
  { key: 'UP05', register: 'UP 05', labelKey: 'upParam05', control: 'select', options: powerFailureOptions },
  { key: 'UP06', register: 'UP 06', labelKey: 'upParam06', control: 'bool' },
  { key: 'UP07', register: 'UP 07', labelKey: 'upParam07', control: 'bool' },
  { key: 'UP08', register: 'UP 08', labelKey: 'upParam08', control: 'bool' },
  { key: 'UP09', register: 'UP 09', labelKey: 'upParam09', control: 'select', options: displayContentOptions },
  { key: 'UP10', register: 'UP 10', labelKey: 'upParam10', control: 'select', options: universalInputOptions },
  { key: 'UP11', register: 'UP 11', labelKey: 'upParam11', control: 'select', options: displayContentOptions },
  { key: 'UP12', register: 'UP 12', labelKey: 'upParam12', control: 'select', options: controlLoopOptions },
  { key: 'UP13', register: 'UP 13', labelKey: 'upParam13', control: 'select', options: displayContentOptions },
  { key: 'UP14', register: 'UP 14', labelKey: 'upParam14', control: 'select', options: analogOutputOptions },
  { key: 'UP15', register: 'UP 15', labelKey: 'upParam15', control: 'bool' },
  { key: 'UP16', register: 'UP 16', labelKey: 'upParam16', control: 'bool' },
  { key: 'UP17', register: 'UP 17', labelKey: 'upParam17', control: 'bool' },
  { key: 'UP18', register: 'UP 18', labelKey: 'upParam18', control: 'time' },
  { key: 'UP19', register: 'UP 19', labelKey: 'upParam19', control: 'bool' },
  { key: 'UP20', register: 'UP 20', labelKey: 'upParam20', control: 'bool' },
  { key: 'UP21', register: 'UP 21', labelKey: 'upParam21', control: 'bool' },
  { key: 'UP22', register: 'UP 22', labelKey: 'upParam22', control: 'bool' },
  { key: 'UP23', register: 'UP 23', labelKey: 'upParam23', control: 'bool' },
  { key: 'UP24', register: 'UP 24', labelKey: 'upParam24', control: 'bool' },
  { key: 'UP25', register: 'UP 25', labelKey: 'upParam25', control: 'disabled' },
  { key: 'UP26', register: 'UP 26', labelKey: 'upParam26', control: 'number', min: 0, max: 10 },
  { key: 'UP27', register: 'UP 27', labelKey: 'upParam27', control: 'number', min: 0, max: 255 },
  { key: 'UP28', register: 'UP 28', labelKey: 'upParam28', control: 'disabled' },
  { key: 'UP29', register: 'UP 29', labelKey: 'upParam29', control: 'number', min: 0, max: 4250 },
  { key: 'UPSP', register: 'UP SP', labelKey: 'upParamSP', control: 'bool' },
  { key: 'UPTS', register: 'UP TS', labelKey: 'upParamTS', control: 'select', options: disabledEnabledOptions },
  { key: 'UPHT', register: 'UP HT', labelKey: 'upParamHT', control: 'select', options: heatCoolOptions },
  { key: 'UPSB', register: 'UP SB', labelKey: 'upParamSB', control: 'select', options: occupancyOptions },
  { key: 'UPFAN', register: 'UP FAN', labelKey: 'upParamFAN', control: 'bool' },
  { key: 'LOCK1', register: 'LOCK 1', labelKey: 'lockParam1', control: 'bool' },
  { key: 'LOCK2', register: 'LOCK 2', labelKey: 'lockParam2', control: 'number', min: 0, max: 255 },
  { key: 'LOCK3', register: 'LOCK 3', labelKey: 'lockParam3', control: 'number', min: 0, max: 255 }
]

const wizardDefs = wizardKeys.map((key) => paramDefs.find((def) => def.key === key)).filter(Boolean) as UserParamDef[]

export function UserParametersPage() {
  const { t, pick } = useI18n()
  const toast = useToast()
  const [config, setConfig] = useState<UserParamsConfig | null>(null)
  /* F-UX-12: bản chụp lần cuối đã tải/đã lưu, làm mốc so sánh "chưa lưu".
   * Trang này chỉnh tham số vận hành của MCU (UP00..LOCK3) — mất bản nháp mà
   * không báo là mất cả một lượt cấu hình gõ tay. */
  const [savedConfig, setSavedConfig] = useState<UserParamsConfig | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('summary')
  const [wizardIndex, setWizardIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    apiClient.getUserParams()
      .then((item) => {
        if (!active) return
        setConfig(item)
        setSavedConfig(item)
      })
      .catch((error) => {
        if (active) toast.push('error', `${t('error')}: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [t, toast])

  const currentStep = wizardDefs[Math.min(wizardIndex, wizardDefs.length - 1)]
  const dirty = JSON.stringify(config) !== JSON.stringify(savedConfig)
  const dirtyGuard = useDirtyGuard(dirty)

  function updateParam(key: UserParamKey, value: UserParamValue) {
    setConfig((current) => current ? { ...current, [key]: value } : current)
  }

  function updateNote(note: string) {
    setConfig((current) => current ? { ...current, note } : current)
  }

  /* Trả `true` chỉ khi backend đã nhận; `DirtyGuardModal` dùng giá trị này để
   * quyết định có rời trang hay không (F-UX-12). */
  async function saveConfig(nextMode?: ViewMode): Promise<boolean> {
    if (!config) return false
    setSaving(true)
    try {
      await apiClient.putUserParams(config)
      setSavedConfig(config)
      toast.push('success', t('saveDemoSuccess'))
      if (nextMode) setViewMode(nextMode)
      return true
    } catch (error) {
      toast.push('error', `${t('error')}: ${error instanceof Error ? error.message : String(error)}`)
      return false
    } finally {
      setSaving(false)
    }
  }

  async function confirmSave() {
    await saveConfig('advanced')
    setConfirmOpen(false)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-[var(--c-text)]">{t('userParamsTitle')}</h1>
            <span className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-2 py-1 text-xs font-bold uppercase text-[var(--c-text-dim)]">{t('demo')}</span>
          </div>
          <p className="text-sm text-[var(--c-text-dim)]">{t('userParamsSubtitle')}</p>
        </div>
        <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={saving} disabled={loading || !config} onClick={() => setConfirmOpen(true)}>
          {t('save')}
        </Button>
      </div>

      <Panel
        title={t('userParamsTitle')}
        action={
          <div className="flex rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-1">
            <ModeButton active={viewMode === 'summary'} icon={<Activity className="h-4 w-4" />} label={t('summary')} onClick={() => setViewMode('summary')} />
            <ModeButton active={viewMode === 'wizard'} icon={<Wand2 className="h-4 w-4" />} label={t('wizard')} onClick={() => setViewMode('wizard')} />
            <ModeButton active={viewMode === 'advanced'} icon={<SlidersHorizontal className="h-4 w-4" />} label={t('advanced')} onClick={() => setViewMode('advanced')} />
          </div>
        }
      >
        {loading && <div className="rounded-[var(--radius)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">{t('loading')}</div>}
        {config && (
          <div className="space-y-5">
            {viewMode === 'summary' ? (
              <SummaryPanel config={config} saving={saving} onNoteChange={updateNote} onSave={() => { void saveConfig() }} />
            ) : viewMode === 'wizard' ? (
              <WizardPanel
                config={config}
                step={currentStep}
                steps={wizardDefs}
                stepIndex={Math.min(wizardIndex, wizardDefs.length - 1)}
                stepCount={wizardDefs.length}
                onChange={updateParam}
                onStepSelect={setWizardIndex}
                onPrevious={() => setWizardIndex((index) => Math.max(index - 1, 0))}
                onNext={() => setWizardIndex((index) => Math.min(index + 1, wizardDefs.length - 1))}
                onFinish={() => setConfirmOpen(true)}
              />
            ) : (
              <AdvancedPanel config={config} onChange={updateParam} />
            )}
          </div>
        )}
      </Panel>

      <Modal
        open={confirmOpen}
        title={t('saveUserParamsTitle')}
        confirmLabel="OK"
        cancelLabel="Cancel"
        onConfirm={() => { void confirmSave() }}
        onClose={() => setConfirmOpen(false)}
      >
        {t('saveUserParamsBody')}
      </Modal>
      <DirtyGuardModal
        guard={dirtyGuard}
        saving={saving}
        title={pick('Tham số người dùng chưa lưu', 'Unsaved user parameters')}
        message={pick(
          'Bạn có thay đổi tham số người dùng chưa lưu. Rời trang sẽ mất các thay đổi này trừ khi lưu trước.',
          'You have unsaved user parameter changes. Leaving this page will discard them unless you save first.'
        )}
        onSave={() => saveConfig()}
        onDiscard={() => setConfig(savedConfig)}
      />
    </div>
  )
}

function SummaryPanel({ config, saving, onNoteChange, onSave }: { config: UserParamsConfig; saving: boolean; onNoteChange: (note: string) => void; onSave: () => void }) {
  const { t } = useI18n()
  return (
    <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
      <h3 className="text-sm font-semibold text-[var(--c-text)]">{t('notes')}</h3>
      <textarea
        className="mt-3 min-h-40 w-full resize-y rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
        value={config.note}
        onChange={(event) => onNoteChange(event.target.value)}
      />
      <Button className="mt-3" variant="primary" icon={<Save className="h-4 w-4" />} loading={saving} onClick={onSave}>
        {t('save')}
      </Button>
    </section>
  )
}

function WizardPanel({
  config,
  step,
  steps,
  stepIndex,
  stepCount,
  onChange,
  onStepSelect,
  onPrevious,
  onNext,
  onFinish
}: {
  config: UserParamsConfig
  step: UserParamDef
  steps: UserParamDef[]
  stepIndex: number
  stepCount: number
  onChange: (key: UserParamKey, value: UserParamValue) => void
  onStepSelect: (index: number) => void
  onPrevious: () => void
  onNext: () => void
  onFinish: () => void
}) {
  const { t, pick } = useI18n()
  const atEnd = stepIndex === stepCount - 1
  const ctx = { t, pick }

  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{stepIndex + 1} / {stepCount}</div>
        <div className="h-2 flex-1 rounded-full bg-[var(--c-surface-2)]">
          <div className="h-2 rounded-full bg-[var(--c-accent)]" style={{ width: `${((stepIndex + 1) / stepCount) * 100}%` }} />
        </div>
      </div>

      <div className="mb-4 overflow-x-auto border-b border-[var(--c-border)]">
        <div className="flex min-w-max gap-1">
          {steps.map((item, index) => (
            <button
              key={item.key}
              type="button"
              title={`${t(item.labelKey)}: ${formatParamValue(item, config[item.key], ctx)}`}
              onClick={() => onStepSelect(index)}
              className={cn(
                'min-w-24 border-b-2 px-3 py-2 text-left text-xs font-semibold transition',
                index === stepIndex
                  ? 'border-[var(--c-accent)] bg-[var(--c-surface-2)] text-[var(--c-text)]'
                  : 'border-transparent text-[var(--c-text-dim)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]'
              )}
            >
              <span className="block font-mono">{item.register}</span>
              <span className="block max-w-36 truncate">{formatParamValue(item, config[item.key], ctx)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-44">
        <div className="space-y-3">
          <div>
            <div className="font-mono text-xs font-semibold uppercase text-[var(--c-text-dim)]">{step.register}</div>
            <div className="text-sm font-semibold text-[var(--c-text)]">{t(step.labelKey)}</div>
          </div>
          <ParamControl def={step} value={config[step.key]} onChange={(value) => onChange(step.key, value)} />
        </div>
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

function AdvancedPanel({ config, onChange }: { config: UserParamsConfig; onChange: (key: UserParamKey, value: UserParamValue) => void }) {
  const { t } = useI18n()
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)]">
      <div className="grid grid-cols-[90px_minmax(0,1fr)_minmax(180px,280px)] bg-[var(--c-surface-2)] px-3 py-2 text-xs font-semibold uppercase text-[var(--c-text-dim)]">
        <span>{t('register')}</span>
        <span>{t('channelLabel')}</span>
        <span>{t('value')}</span>
      </div>
      {paramDefs.map((def) => (
        <div key={def.key} className="grid grid-cols-[90px_minmax(0,1fr)_minmax(180px,280px)] items-center gap-3 border-t border-[var(--c-border)] px-3 py-3 text-sm">
          <span className="font-mono text-[var(--c-text-dim)]">{def.register}</span>
          <span className="font-medium text-[var(--c-text)]">{t(def.labelKey)}</span>
          <ParamControl def={def} value={config[def.key]} onChange={(value) => onChange(def.key, value)} />
        </div>
      ))}
    </div>
  )
}

function ParamControl({ def, value, onChange }: { def: UserParamDef; value: UserParamValue; onChange: (value: UserParamValue) => void }) {
  const { t, pick } = useI18n()
  const ctx = { t, pick }

  if (def.control === 'disabled') return <DisabledSelect label={t('notUsed')} />
  if (def.control === 'number') {
    return (
      <input
        className={controlClass()}
        type="number"
        min={def.min}
        max={def.max}
        value={Number(value)}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    )
  }
  if (def.control === 'time') {
    return (
      <input
        className={controlClass()}
        type="time"
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }

  const options = getOptions(def, ctx)
  return (
    <select
      className={controlClass()}
      value={optionValue(value)}
      onChange={(event) => {
        const option = options.find((item) => optionValue(item.value) === event.target.value)
        if (option) onChange(option.value)
      }}
    >
      {options.map((option) => <option key={optionValue(option.value)} value={optionValue(option.value)}>{option.label}</option>)}
    </select>
  )
}

function ModeButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-[var(--radius)] px-3 text-sm font-semibold transition',
        active ? 'bg-[var(--c-surface-2)] text-[var(--c-text)] shadow-sm' : 'text-[var(--c-text-dim)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]'
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function DisabledSelect({ label }: { label: string }) {
  return <div className="flex h-10 items-center rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-sm text-[var(--c-text-dim)]">{label}</div>
}

function controlClass(): string {
  return 'h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]'
}

function getOptions(def: UserParamDef, ctx: LabelContext): UserParamOption[] {
  if (def.control === 'bool') return boolOptions(ctx)
  return def.options?.(ctx) ?? []
}

function formatParamValue(def: UserParamDef, value: UserParamValue, ctx: LabelContext): string {
  if (def.control === 'disabled') return ctx.t('notUsed')
  const option = getOptions(def, ctx).find((item) => item.value === value)
  return option?.label ?? String(value)
}

function optionValue(value: UserParamValue): string {
  return typeof value === 'number' ? `n:${value}` : `s:${value}`
}

function boolOptions({ t }: LabelContext): UserParamOption[] {
  return [
    { value: 0, label: `0 = ${t('off')}` },
    { value: 1, label: `1 = ${t('on')}` }
  ]
}

function powerFailureOptions({ pick }: LabelContext): UserParamOption[] {
  return [
    { value: 0, label: `0 = ${pick('Tắt', 'Off')}` },
    { value: 1, label: `1 = ${pick('Bật', 'On')}` },
    { value: 2, label: `2 = ${pick('Trạng thái trước khi mất điện', 'State before power failure')}` }
  ]
}

function displayContentOptions({ pick }: LabelContext): UserParamOption[] {
  return [
    { value: 0, label: `0 = ${pick('Không có', 'None')}` },
    { value: 1, label: `1 = ${pick('Ngõ vào', 'Input')}` },
    { value: 2, label: `2 = ${pick('Điểm đặt vòng điều khiển', 'Control Loop Setpoint')}` },
    { value: 3, label: `3 = ${pick('Ngõ ra analog', 'Analog Output')}` }
  ]
}

function universalInputOptions(): UserParamOption[] {
  return Array.from({ length: 8 }, (_, index) => {
    const label = `Universal Input ${index + 1}`
    return { value: label, label }
  })
}

function controlLoopOptions(): UserParamOption[] {
  return Array.from({ length: 8 }, (_, index) => ({ value: index + 1, label: `${index + 1} = Control Loop ${index + 1}` }))
}

function analogOutputOptions(): UserParamOption[] {
  return Array.from({ length: 4 }, (_, index) => {
    const label = `Analog Output ${index + 1}`
    return { value: label, label }
  })
}

function disabledEnabledOptions({ pick }: LabelContext): UserParamOption[] {
  return [
    { value: 0, label: `0 = ${pick('Tắt', 'Disabled')}` },
    { value: 1, label: `1 = ${pick('Bật', 'Enabled')}` }
  ]
}

function heatCoolOptions(): UserParamOption[] {
  return ['Auto', 'Heat', 'Cool', 'Off'].map((label) => ({ value: label, label }))
}

function occupancyOptions(): UserParamOption[] {
  return ['Occupied', 'Unoccupied'].map((label) => ({ value: label, label }))
}
