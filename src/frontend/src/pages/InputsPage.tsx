import { Activity, ChevronLeft, ChevronRight, Save, SlidersHorizontal, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { apiClient } from '../api/client'
import { Button } from '../components/Button'
import { Panel } from '../components/Panel'
import { useToast } from '../components/Toast'
import { useI18n } from '../i18n'
import { isAnalogSignal, type AiInputConfig, type AiSignalType } from '../types'
import { cn } from '../utils'

type ViewMode = 'wizard' | 'advanced'
type WizardStep = 'signal' | 'unit' | 'range' | 'min' | 'max' | 'finish'
type Translate = ReturnType<typeof useI18n>['t']

const signalOptions: AiSignalType[] = [0, 1, 2, 3, 4]
const unitOptions = [0, 1, 2, 3]
const rangeMultiplierOptions = [0, 1, 2, 3, 4, 5]

export function InputsPage() {
  const { t } = useI18n()
  const toast = useToast()
  const [configs, setConfigs] = useState<AiInputConfig[]>([])
  const [selectedChannel, setSelectedChannel] = useState(1)
  const [viewMode, setViewMode] = useState<ViewMode>('wizard')
  const [wizardIndex, setWizardIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

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
      return isAnalogSignal(next.signalType) ? next : { ...next, unit: 0 }
    }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      await apiClient.putAiInputs(configs)
      toast.push('success', t('saveSuccess'))
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
        <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={saving} onClick={handleSave} disabled={loading || configs.length === 0}>
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
                  stepIndex={Math.min(wizardIndex, steps.length - 1)}
                  stepCount={steps.length}
                  onChange={(patch) => updateChannel(selected.channel, patch)}
                  onPrevious={() => setWizardIndex((index) => Math.max(index - 1, 0))}
                  onNext={() => setWizardIndex((index) => Math.min(index + 1, steps.length - 1))}
                />
              ) : (
                <AdvancedPanel config={selected} onChange={(patch) => updateChannel(selected.channel, patch)} />
              )}
            </div>
          )}
        </Panel>
      </div>
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
  stepIndex,
  stepCount,
  onChange,
  onPrevious,
  onNext
}: {
  config: AiInputConfig
  step: WizardStep
  stepIndex: number
  stepCount: number
  onChange: (patch: Partial<AiInputConfig>) => void
  onPrevious: () => void
  onNext: () => void
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

      <div className="min-h-44">
        {step === 'signal' && <SignalTypeField value={config.signalType} onChange={(signalType) => onChange({ signalType })} />}
        {step === 'unit' && <UnitField value={config.unit} onChange={(unit) => onChange({ unit })} />}
        {step === 'range' && isAnalogSignal(config.signalType) && <RangeMultiplierField value={config.rangeMultiplier} onChange={(rangeMultiplier) => onChange({ rangeMultiplier })} />}
        {step === 'min' && isAnalogSignal(config.signalType) && <NumberField label={t('displayMinLabel')} value={config.displayMin} onChange={(displayMin) => onChange({ displayMin })} />}
        {step === 'max' && isAnalogSignal(config.signalType) && <NumberField label={t('displayMaxLabel')} value={config.displayMax} onChange={(displayMax) => onChange({ displayMax })} />}
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
        <Button variant="primary" icon={!atEnd ? <ChevronRight className="h-4 w-4" /> : undefined} onClick={atEnd ? undefined : onNext}>
          {atEnd ? t('finish') : t('next')}
        </Button>
      </div>
    </div>
  )
}

function AdvancedPanel({ config, onChange }: { config: AiInputConfig; onChange: (patch: Partial<AiInputConfig>) => void }) {
  const { t } = useI18n()
  const analog = isAnalogSignal(config.signalType)
  const rows = [
    { register: 'u0', name: t('signalTypeLabel'), control: <SignalTypeSelect value={config.signalType} onChange={(signalType) => onChange({ signalType })} /> },
    ...(analog ? [
      { register: 'u1', name: t('displayMinLabel'), control: <SmallNumberInput value={config.displayMin} onChange={(displayMin) => onChange({ displayMin })} /> },
      { register: 'u2', name: t('displayMaxLabel'), control: <SmallNumberInput value={config.displayMax} onChange={(displayMax) => onChange({ displayMax })} /> },
      { register: 'u3', name: t('rangeMultiplierLabel'), control: <RangeMultiplierSelect value={config.rangeMultiplier} onChange={(rangeMultiplier) => onChange({ rangeMultiplier })} /> }
    ] : []),
    { register: 'u4', name: t('unitsLabel'), control: <UnitSelect value={config.unit} onChange={(unit) => onChange({ unit })} /> }
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
      <div className="grid gap-2 md:grid-cols-2">
        {signalOptions.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={cn(
              'rounded-[var(--radius)] border px-3 py-3 text-left text-sm transition',
              value === option ? 'border-[var(--c-accent)] bg-[var(--c-surface-2)] text-[var(--c-text)]' : 'border-[var(--c-border)] bg-[var(--c-surface)] text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
            )}
          >
            {signalLabel(option, t)}
          </button>
        ))}
      </div>
    </div>
  )
}

function UnitField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useI18n()
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-[var(--c-text)]">{t('unitsLabel')}</div>
      <div className="grid gap-2 md:grid-cols-2">
        {unitOptions.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={cn(
              'rounded-[var(--radius)] border px-3 py-3 text-left text-sm transition',
              value === option ? 'border-[var(--c-accent)] bg-[var(--c-surface-2)] text-[var(--c-text)]' : 'border-[var(--c-border)] bg-[var(--c-surface)] text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
            )}
          >
            {unitLabel(option, t)}
          </button>
        ))}
      </div>
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

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-semibold text-[var(--c-text)]">{label}</span>
      <SmallNumberInput value={value} onChange={onChange} />
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

function SmallNumberInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <input
      className={controlClass()}
      type="number"
      min={-50}
      max={205}
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

function wizardSteps(signalType: AiSignalType): WizardStep[] {
  return isAnalogSignal(signalType) ? ['signal', 'unit', 'range', 'min', 'max', 'finish'] : ['signal', 'unit', 'finish']
}

function aiNode(channel: number): string {
  return `AI-${String(channel).padStart(2, '0')}`
}

function signalLabel(value: AiSignalType, t: Translate): string {
  if (value === 1) return t('signalType1')
  if (value === 2) return t('signalType2')
  if (value === 3) return t('signalType3')
  if (value === 4) return t('signalType4')
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

function controlClass(): string {
  return 'h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]'
}
