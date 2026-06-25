import { Activity, ChevronLeft, ChevronRight, Save, SlidersHorizontal, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { apiClient } from '../api/client'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { Panel } from '../components/Panel'
import { useToast } from '../components/Toast'
import { useI18n } from '../i18n'
import type { AiInputConfig, AiSignalType } from '../types'
import { cn } from '../utils'

type ViewMode = 'wizard' | 'advanced'
type WizardStep = 'signal' | 'unit' | 'range' | 'min' | 'max' | 'math' | 'finish'
type Translate = ReturnType<typeof useI18n>['t']

const signalOptions: AiSignalType[] = [0, 1, 2, 3, 4, 5, 6, 7, 8]
const unitOptions = [0, 1, 2, 3]
const rangeMultiplierOptions = [0, 1, 2, 3, 4, 5]
const mathFunctionOptions = [0, 1, 2, 3]

export function InputsPage() {
  const { t, pick } = useI18n()
  const toast = useToast()
  const [configs, setConfigs] = useState<AiInputConfig[]>([])
  const [selectedChannel, setSelectedChannel] = useState(1)
  const [viewMode, setViewMode] = useState<ViewMode>('wizard')
  const [wizardIndex, setWizardIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    apiClient.getAiInputs()
      .then((items) => {
        if (active) setConfigs(items)
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

  const selected = configs.find((config) => config.channel === selectedChannel) ?? configs[0]
  const steps = useMemo(() => wizardSteps(selected?.signalType ?? 0), [selected?.signalType])
  const currentStep = steps[Math.min(wizardIndex, steps.length - 1)] ?? 'signal'

  useEffect(() => {
    setWizardIndex((index) => Math.min(index, steps.length - 1))
  }, [steps.length])

  function updateChannel(channel: number, patch: Partial<AiInputConfig>) {
    setConfigs((current) => current.map((config) => {
      if (config.channel !== channel) return config
      const next = { ...config, ...patch }
      return next.signalType === 0 ? { ...next, unit: 0, mathFunction: 0 } : next
    }))
  }

  function requestSave() {
    setConfirmOpen(true)
  }

  async function confirmSave() {
    setSaving(true)
    try {
      await apiClient.putAiInputs(configs)
      toast.push('success', t('saveSuccess'))
      setConfirmOpen(false)
      setViewMode('advanced')
    } catch (error) {
      toast.push('error', `${t('saveError')}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--c-text)]">{t('aiConfigTitle')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{t('aiConfigSubtitle')}</p>
        </div>
        <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={saving} onClick={requestSave} disabled={loading || configs.length === 0}>
          {t('save')}
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Panel title="AI Channels">
          <div className="flex flex-col gap-1">
            {configs.map((config) => (
              <button
                key={config.channel}
                type="button"
                onClick={() => {
                  setSelectedChannel(config.channel)
                  setWizardIndex(0)
                }}
                className={cn(
                  'flex min-h-12 items-center gap-3 rounded-[var(--radius)] border px-3 py-2 text-left text-sm transition',
                  selectedChannel === config.channel
                    ? 'border-[var(--c-accent)] bg-[var(--c-surface-2)] text-[var(--c-text)]'
                    : 'border-transparent text-[var(--c-text-dim)] hover:border-[var(--c-border)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]'
                )}
              >
                <Activity className="h-4 w-4 shrink-0 text-[var(--c-accent)]" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block font-semibold">{aiNode(config.channel)}</span>
                  <span className="block truncate text-xs">{config.label}</span>
                </span>
              </button>
            ))}
            {loading && <div className="rounded-[var(--radius)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">{t('loading')}</div>}
          </div>
        </Panel>

        <Panel
          title={selected ? `${aiNode(selected.channel)} - ${selected.label}` : t('empty')}
          action={
            <div className="flex rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-1">
              <ModeButton active={viewMode === 'wizard'} icon={<Wand2 className="h-4 w-4" />} label={t('wizard')} onClick={() => setViewMode('wizard')} />
              <ModeButton active={viewMode === 'advanced'} icon={<SlidersHorizontal className="h-4 w-4" />} label={t('advanced')} onClick={() => setViewMode('advanced')} />
            </div>
          }
        >
          {selected && (
            <div className="space-y-5">
              <ChannelBasics config={selected} onChange={(patch) => updateChannel(selected.channel, patch)} />
              {viewMode === 'wizard' ? (
                <WizardPanel
                  config={selected}
                  step={currentStep}
                  steps={steps}
                  stepIndex={Math.min(wizardIndex, steps.length - 1)}
                  stepCount={steps.length}
                  onChange={(patch) => updateChannel(selected.channel, patch)}
                  onStepSelect={setWizardIndex}
                  onPrevious={() => setWizardIndex((index) => Math.max(index - 1, 0))}
                  onNext={() => setWizardIndex((index) => Math.min(index + 1, steps.length - 1))}
                  onFinish={requestSave}
                />
              ) : (
                <AdvancedPanel config={selected} onChange={(patch) => updateChannel(selected.channel, patch)} />
              )}
            </div>
          )}
        </Panel>
      </div>
      <Modal
        open={confirmOpen}
        title={pick('Lưu cấu hình AI?', 'Save AI config?')}
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

function ChannelBasics({ config, onChange }: { config: AiInputConfig; onChange: (patch: Partial<AiInputConfig>) => void }) {
  const { t } = useI18n()
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{t('channelLabel')}</span>
        <input
          className="h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
          value={config.label}
          onChange={(event) => onChange({ label: event.target.value })}
        />
      </label>
      <label className="flex items-end gap-2 pb-2 text-sm font-semibold text-[var(--c-text-dim)]">
        <input
          className="h-4 w-4 accent-[var(--c-accent)]"
          type="checkbox"
          checked={config.enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        {t('enableChannel')}
      </label>
    </div>
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
  config: AiInputConfig
  step: WizardStep
  steps: WizardStep[]
  stepIndex: number
  stepCount: number
  onChange: (patch: Partial<AiInputConfig>) => void
  onStepSelect: (index: number) => void
  onPrevious: () => void
  onNext: () => void
  onFinish: () => void
}) {
  const { t } = useI18n()
  const atEnd = stepIndex === stepCount - 1

  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">
          {stepIndex + 1} / {stepCount}
        </div>
        <div className="h-2 flex-1 rounded-full bg-[var(--c-surface-2)]">
          <div className="h-2 rounded-full bg-[var(--c-accent)]" style={{ width: `${((stepIndex + 1) / stepCount) * 100}%` }} />
        </div>
      </div>

      <div className="mb-4 grid gap-2 md:grid-cols-2">
        {steps.map((item, index) => (
          <button
            key={`${item}-${index}`}
            type="button"
            onClick={() => onStepSelect(index)}
            className={cn(
              'min-h-14 rounded-[var(--radius)] border px-3 py-2 text-left text-xs transition',
              index === stepIndex
                ? 'border-[var(--c-accent)] bg-[var(--c-surface-2)] text-[var(--c-text)]'
                : 'border-[var(--c-border)] bg-[var(--c-surface)] text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
            )}
          >
            <span className="block font-semibold">{wizardStepLabel(item, t)}</span>
            <span className="mt-1 block truncate">{wizardStepValue(item, config, t)}</span>
          </button>
        ))}
      </div>

      <div className="min-h-44">
        {step === 'signal' && <SignalTypeField value={config.signalType} onChange={(signalType) => onChange({ signalType })} />}
        {step === 'unit' && <UnitField value={config.unit} onChange={(unit) => onChange({ unit })} />}
        {step === 'range' && <RangeMultiplierField value={config.rangeMultiplier} onChange={(rangeMultiplier) => onChange({ rangeMultiplier })} />}
        {step === 'min' && <NumberField label={t('displayMinLabel')} value={config.displayMin} min={-50} max={205} onChange={(displayMin) => onChange({ displayMin })} />}
        {step === 'max' && <NumberField label={t('displayMaxLabel')} value={config.displayMax} min={-50} max={205} onChange={(displayMax) => onChange({ displayMax })} />}
        {step === 'math' && <MathFunctionField value={config.mathFunction} onChange={(mathFunction) => onChange({ mathFunction })} />}
        {step === 'finish' && (
          <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4 text-sm text-[var(--c-text)]">
            <div className="font-semibold">{t('completed')}</div>
            <div className="mt-2 text-[var(--c-text-dim)]">
              {signalLabel(config.signalType, t)} / {unitLabel(config.unit, t)}
            </div>
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

function AdvancedPanel({ config, onChange }: { config: AiInputConfig; onChange: (patch: Partial<AiInputConfig>) => void }) {
  const { t } = useI18n()
  const rows = [
    { register: 'u0', name: t('signalTypeLabel'), control: <SignalTypeSelect value={config.signalType} onChange={(signalType) => onChange({ signalType })} /> },
    { register: 'u1', name: t('displayMinLabel'), control: <SmallNumberInput value={config.displayMin} min={-50} max={205} onChange={(displayMin) => onChange({ displayMin })} /> },
    { register: 'u2', name: t('displayMaxLabel'), control: <SmallNumberInput value={config.displayMax} min={-50} max={205} onChange={(displayMax) => onChange({ displayMax })} /> },
    { register: 'u3', name: t('rangeMultiplierLabel'), control: <RangeMultiplierSelect value={config.rangeMultiplier} onChange={(rangeMultiplier) => onChange({ rangeMultiplier })} /> },
    { register: 'u4', name: t('unitsLabel'), control: <UnitSelect value={config.unit} onChange={(unit) => onChange({ unit })} /> },
    { register: 'u5', name: t('filterSamplesLabel'), control: <SmallNumberInput value={config.filterSamples} min={0} max={100} onChange={(filterSamples) => onChange({ filterSamples })} /> },
    { register: 'u6', name: t('sensorCalibrationLabel'), control: <SmallNumberInput value={config.sensorCal} min={-12.7} max={12.8} step={0.1} onChange={(sensorCal) => onChange({ sensorCal })} /> },
    { register: 'u7', name: t('mathFunctionLabel'), control: <MathFunctionSelect value={config.mathFunction} onChange={(mathFunction) => onChange({ mathFunction })} /> },
    { register: 'u8', name: t('notUsed'), control: <DisabledSelect label={`0 = ${t('off')}`} /> },
    { register: 'u9', name: t('notUsed'), control: <DisabledSelect label={t('signalType0')} /> }
  ]

  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)]">
      <div className="grid grid-cols-[90px_minmax(0,1fr)_minmax(160px,240px)] bg-[var(--c-surface-2)] px-3 py-2 text-xs font-semibold uppercase text-[var(--c-text-dim)]">
        <span>{t('register')}</span>
        <span>{t('channelLabel')}</span>
        <span>{t('value')}</span>
      </div>
      {rows.map((row) => (
        <div key={row.register} className="grid grid-cols-[90px_minmax(0,1fr)_minmax(160px,240px)] items-center gap-3 border-t border-[var(--c-border)] px-3 py-3 text-sm">
          <span className="font-mono text-[var(--c-text-dim)]">{String(config.channel).padStart(2, '0')} {row.register}</span>
          <span className="font-medium text-[var(--c-text)]">{row.name}</span>
          {row.control}
        </div>
      ))}
    </div>
  )
}

function SignalTypeField({ value, onChange }: { value: AiSignalType; onChange: (value: AiSignalType) => void }) {
  const { t } = useI18n()
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-[var(--c-text)]">{t('signalTypeLabel')}</div>
      <SignalTypeSelect value={value} onChange={onChange} />
    </div>
  )
}

function UnitField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useI18n()
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-[var(--c-text)]">{t('unitsLabel')}</div>
      <UnitSelect value={value} onChange={onChange} />
    </div>
  )
}

function RangeMultiplierField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useI18n()
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-[var(--c-text)]">{t('rangeMultiplierLabel')}</div>
      <RangeMultiplierSelect value={value} onChange={onChange} />
    </div>
  )
}

function MathFunctionField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useI18n()
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-[var(--c-text)]">{t('mathFunctionLabel')}</div>
      <MathFunctionSelect value={value} onChange={onChange} />
    </div>
  )
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-semibold text-[var(--c-text)]">{label}</span>
      <SmallNumberInput value={value} min={min} max={max} onChange={onChange} />
    </label>
  )
}

function SignalTypeSelect({ value, onChange }: { value: AiSignalType; onChange: (value: AiSignalType) => void }) {
  const { t } = useI18n()
  return (
    <select className={controlClass()} value={value} onChange={(event) => onChange(Number(event.target.value) as AiSignalType)}>
      {signalOptions.map((option) => <option key={option} value={option}>{signalLabel(option, t)}</option>)}
    </select>
  )
}

function UnitSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useI18n()
  return (
    <select className={controlClass()} value={value} onChange={(event) => onChange(Number(event.target.value))}>
      {unitOptions.map((option) => <option key={option} value={option}>{unitLabel(option, t)}</option>)}
    </select>
  )
}

function RangeMultiplierSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useI18n()
  return (
    <select className={controlClass()} value={value} onChange={(event) => onChange(Number(event.target.value))}>
      {rangeMultiplierOptions.map((option) => <option key={option} value={option}>{rangeLabel(option, t)}</option>)}
    </select>
  )
}

function MathFunctionSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useI18n()
  return (
    <select className={controlClass()} value={value} onChange={(event) => onChange(Number(event.target.value))}>
      {mathFunctionOptions.map((option) => <option key={option} value={option}>{mathFunctionLabel(option, t)}</option>)}
    </select>
  )
}

function DisabledSelect({ label }: { label: string }) {
  return (
    <select className={controlClass()} value={0} disabled>
      <option value={0}>{label}</option>
    </select>
  )
}

function SmallNumberInput({ value, min, max, step = 1, onChange }: { value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return (
    <input
      className={controlClass()}
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  )
}

function ModeButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-8 items-center gap-2 rounded-[calc(var(--radius)-4px)] px-3 text-xs font-semibold transition',
        active ? 'bg-[var(--c-surface-2)] text-[var(--c-text)]' : 'text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
}

function wizardSteps(_signalType: AiSignalType): WizardStep[] {
  return ['signal', 'unit', 'range', 'min', 'max', 'math', 'finish']
}

function wizardStepLabel(step: WizardStep, t: Translate): string {
  if (step === 'signal') return t('signalTypeLabel')
  if (step === 'unit') return t('unitsLabel')
  if (step === 'range') return t('rangeMultiplierLabel')
  if (step === 'min') return t('displayMinLabel')
  if (step === 'max') return t('displayMaxLabel')
  if (step === 'math') return t('mathFunctionLabel')
  return t('finish')
}

function wizardStepValue(step: WizardStep, config: AiInputConfig, t: Translate): string {
  if (step === 'signal') return signalLabel(config.signalType, t)
  if (step === 'unit') return unitLabel(config.unit, t)
  if (step === 'range') return rangeLabel(config.rangeMultiplier, t)
  if (step === 'min') return String(config.displayMin)
  if (step === 'max') return String(config.displayMax)
  if (step === 'math') return mathFunctionLabel(config.mathFunction, t)
  return `${signalLabel(config.signalType, t)} / ${unitLabel(config.unit, t)}`
}

function aiNode(channel: number): string {
  return `AI-${String(channel).padStart(2, '0')}`
}

function signalLabel(value: AiSignalType, t: Translate): string {
  if (value === 1) return t('signalType1')
  if (value === 2) return t('signalType2')
  if (value === 3) return t('signalType3')
  if (value === 4) return t('signalType4')
  if (value === 5) return t('signalType5')
  if (value === 6) return t('signalType6')
  if (value === 7) return t('signalType7')
  if (value === 8) return t('signalType8')
  return t('signalType0')
}

function unitLabel(value: number, t: Translate): string {
  if (value === 1) return t('unit1')
  if (value === 2) return t('unit2')
  if (value === 3) return t('unit3')
  return t('unit0')
}

function rangeLabel(value: number, t: Translate): string {
  if (value === 1) return t('rangeMultiplier1')
  if (value === 2) return t('rangeMultiplier2')
  if (value === 3) return t('rangeMultiplier3')
  if (value === 4) return t('rangeMultiplier4')
  if (value === 5) return t('rangeMultiplier5')
  return t('rangeMultiplier0')
}

function mathFunctionLabel(value: number, t: Translate): string {
  if (value === 1) return t('mathFunction1')
  if (value === 2) return t('mathFunction2')
  if (value === 3) return t('mathFunction3')
  return t('mathFunction0')
}

function controlClass(): string {
  return 'h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]'
}
