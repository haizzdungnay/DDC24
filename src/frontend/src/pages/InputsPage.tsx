import { Activity, ChevronLeft, ChevronRight, Save, SlidersHorizontal, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { apiClient } from '../api/client'
import { normalizePointTag, pointTagFieldErrors, validatePointName, validatePointTag } from '../api/pointTags'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { Panel } from '../components/Panel'
import { useToast } from '../components/Toast'
import { TrendChart } from '../components/TrendChart'
import { getDemoPoints } from '../demo/simulator'
import { useApi } from '../hooks/useApi'
import { useI18n } from '../i18n'
import { isDigitalContact, type AiInputConfig, type AiSignalType, type Point, type TrendSample } from '../types'
import { cn, formatValue, isVisibleUniversalInput, pointNumber, uiNode } from '../utils'

type ViewMode = 'summary' | 'wizard' | 'advanced'
type WizardStep = 'signal' | 'min' | 'max' | 'range' | 'unit' | 'filter' | 'cal' | 'math'
type Translate = ReturnType<typeof useI18n>['t']
type LiveTrendSample = TrendSample & { raw: number }

const signalOptions: AiSignalType[] = [0, 1, 2, 3, 4, 5, 6, 7, 8]
const unitOptions = [0, 1, 2, 3, 4]
const rangeMultiplierOptions = [0, 1, 2, 3, 4, 5]
const mathFunctionOptions = [0, 1, 2, 3]

export function InputsPage() {
  const { t, pick } = useI18n()
  const toast = useToast()
  const [configs, setConfigs] = useState<AiInputConfig[]>([])
  const [selectedChannel, setSelectedChannel] = useState(1)
  const [viewMode, setViewMode] = useState<ViewMode>('summary')
  const [wizardIndex, setWizardIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [tagErrors, setTagErrors] = useState<Record<string, string>>({})
  const pointsState = useApi(apiClient.getPoints, [], { refreshMs: 2000 })

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
      const normalized = next.signalType === 2 ? next : { ...next, analogCurrent: false }
      return normalized.signalType === 0 ? { ...normalized, unit: 0, mathFunction: 0 } : normalized
    }))
  }

  function requestSave() {
    setConfirmOpen(true)
  }

  function validateTags(nextConfigs: AiInputConfig[]): boolean {
    const errors = Object.fromEntries(nextConfigs.flatMap((config, index) => {
      const tagError = validatePointTag(config.tag)
      const nameError = validatePointName(config.label)
      return [
        ...(tagError ? [[`ui[${index}].tag`, tagError]] : []),
        ...(nameError ? [[`ui[${index}].name`, nameError]] : [])
      ]
    }))
    setTagErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function confirmSave() {
    if (!validateTags(configs)) return
    setSaving(true)
    try {
      const normalized = configs.map((config) => ({ ...config, tag: normalizePointTag(config.tag) }))
      await apiClient.putAiInputs(normalized)
      setConfigs(normalized)
      setTagErrors({})
      toast.push('success', t('saveSuccess'))
      setConfirmOpen(false)
      setViewMode('advanced')
    } catch (error) {
      setTagErrors(pointTagFieldErrors(error))
      toast.push('error', `${t('saveError')}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  async function saveConfigs(nextConfigs = configs) {
    if (!validateTags(nextConfigs)) return
    setSaving(true)
    try {
      const normalized = nextConfigs.map((config) => ({ ...config, tag: normalizePointTag(config.tag) }))
      await apiClient.putAiInputs(normalized)
      setTagErrors({})
      toast.push('success', t('saveSuccess'))
      setConfigs(normalized)
    } catch (error) {
      setTagErrors(pointTagFieldErrors(error))
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
        <Panel title="UI Channels">
          <div className="flex flex-col gap-1 max-h-[calc(100vh-250px)] overflow-y-auto pr-2">
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
              <ModeButton active={viewMode === 'summary'} icon={<Activity className="h-4 w-4" />} label={pick('Summary', 'Summary')} onClick={() => setViewMode('summary')} />
              <ModeButton active={viewMode === 'wizard'} icon={<Wand2 className="h-4 w-4" />} label={t('wizard')} onClick={() => setViewMode('wizard')} />
              <ModeButton active={viewMode === 'advanced'} icon={<SlidersHorizontal className="h-4 w-4" />} label={t('advanced')} onClick={() => setViewMode('advanced')} />
            </div>
          }
        >
          {selected && (
            <div className="space-y-5">
              <ChannelBasics
                config={selected}
                tagError={tagErrors[`ui[${configs.findIndex((config) => config.channel === selected.channel)}].tag`]}
                nameError={tagErrors[`ui[${configs.findIndex((config) => config.channel === selected.channel)}].name`]}
                onChange={(patch) => updateChannel(selected.channel, patch)}
              />
              {viewMode === 'summary' ? (
                <AiSummary
                  config={selected}
                  configs={configs}
                  points={pointsState.data ?? []}
                  onChange={(patch) => updateChannel(selected.channel, patch)}
                  onSave={(nextConfigs) => { void saveConfigs(nextConfigs) }}
                  saving={saving}
                />
              ) : viewMode === 'wizard' ? (
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
        title={pick('Lưu cấu hình UI?', 'Save UI config?')}
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

function AiSummary({
  config,
  configs,
  points,
  onChange,
  onSave,
  saving
}: {
  config: AiInputConfig
  configs: AiInputConfig[]
  points: Point[]
  onChange: (patch: Partial<AiInputConfig>) => void
  onSave: (nextConfigs: AiInputConfig[]) => void
  saving: boolean
}) {
  const { pick, t } = useI18n()
  const livePoint = findAiPoint(points, config.channel)
  const demoPoint = livePoint ? undefined : findAiPoint(getDemoPoints(), config.channel)
  const point = livePoint ?? demoPoint
  const pointId = point?.id ?? aiNode(config.channel)
  const displayPointId = aiNode(config.channel)
  const { data, reset } = useAiLiveTrend(pointId, point)
  const booleanInput = isDigitalContact(config.signalType) || typeof point?.value === 'boolean'
  const values = booleanInput ? [] : data.map((sample) => sample.raw)
  const stats = values.length > 0
    ? {
        min: Math.min(...values),
        max: Math.max(...values),
        avg: values.reduce((sum, value) => sum + value, 0) / values.length
      }
    : null
  const unit = point?.unit
  const rawUnit = String(point?.rawUnit ?? '').toLowerCase()
  const rawVolts = !booleanInput && typeof point?.raw === 'number' && rawUnit === 'v' ? formatStat(point.raw) : '--'
  const rawMilliamps = !booleanInput && typeof point?.raw === 'number' && rawUnit === 'ma' ? formatStat(point.raw) : '--'

  function saveNote() {
    const nextConfigs = configs.map((item) => item.channel === config.channel ? { ...item, note: config.note } : item)
    onSave(nextConfigs)
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--c-text)]">{pick('Dữ liệu trực tiếp', 'Live Data')}</h3>
            <Button size="sm" onClick={() => reset()}>{pick('Đặt lại', 'Reset')}</Button>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            <LiveDataItem label={pick('Giá trị', 'Value')} value={point ? formatLiveValue(point, unit, booleanInput) : '--'} />
            {!booleanInput && (
              <>
                <LiveDataItem label={t('rawVolts')} value={rawVolts} />
                <LiveDataItem label={t('rawMilliamps')} value={rawMilliamps} />
              </>
            )}
            <LiveDataItem label={pick('Nhỏ nhất', 'Minimum')} value={stats ? formatStat(stats.min, unit) : '--'} />
            <LiveDataItem label={pick('Lớn nhất', 'Maximum')} value={stats ? formatStat(stats.max, unit) : '--'} />
            <LiveDataItem label={pick('Trung bình', 'Average')} value={stats ? formatStat(stats.avg, unit) : '--'} />
          </dl>
        </section>

        <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--c-text)]">{pick('Biểu đồ trực tiếp', 'Live Chart')}</h3>
            <span className="text-xs font-semibold text-[var(--c-text-dim)]">{displayPointId}</span>
          </div>
          <TrendChart
            data={data}
            height={260}
            series={[{ key: pointId, label: config.label || pointId, color: 'var(--c-accent)', unit }]}
          />
          {data.length === 0 && <div className="mt-2 text-xs text-[var(--c-text-dim)]">{pick('Chưa có dữ liệu live cho kênh này.', 'No live data for this channel yet.')}</div>}
        </section>
      </div>

      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
        <h3 className="text-sm font-semibold text-[var(--c-text)]">{pick('Ghi chú', 'Notes')}</h3>
        <textarea
          className="mt-3 min-h-40 w-full resize-y rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
          value={config.note}
          onChange={(event) => onChange({ note: event.target.value })}
          placeholder={pick('Nhập ghi chú riêng cho kênh UI này...', 'Enter notes for this UI channel...')}
        />
        <Button className="mt-3 w-full" variant="primary" icon={<Save className="h-4 w-4" />} loading={saving} onClick={saveNote}>
          {pick('Lưu ghi chú', 'Save')}
        </Button>
      </section>
    </div>
  )
}

function LiveDataItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3">
      <dt className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{label}</dt>
      <dd className="mt-1 font-mono text-xl font-semibold text-[var(--c-text)]">{value}</dd>
    </div>
  )
}

function useAiLiveTrend(pointId: string, point?: Point): { data: LiveTrendSample[]; reset: () => void } {
  const [buffers, setBuffers] = useState<Record<string, LiveTrendSample[]>>({})

  useEffect(() => {
    if (!point) return
    const value = pointNumber(point)
    const time = new Date(point.updatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setBuffers((current) => {
      const existing = current[pointId] ?? []
      const last = existing[existing.length - 1]
      if (last && last.time === time && last.raw === value) return current
      const next = [...existing, { time, raw: value, [pointId]: value }].slice(-60)
      return { ...current, [pointId]: next }
    })
  }, [pointId, point])

  function reset() {
    if (!point) {
      setBuffers((current) => ({ ...current, [pointId]: [] }))
      return
    }
    const value = pointNumber(point)
    const time = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setBuffers((current) => ({ ...current, [pointId]: [{ time, raw: value, [pointId]: value }] }))
  }

  return { data: buffers[pointId] ?? [], reset }
}

function formatStat(value: number, unit?: string): string {
  const fixed = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)
  return `${fixed}${unit ? ` ${unit}` : ''}`
}

function formatLiveValue(point: Point, unit: string | undefined, booleanInput: boolean): string {
  if (booleanInput) return formatValue(pointNumber(point) > 0.5, undefined)
  return formatValue(point.value, unit)
}

function ChannelBasics({ config, tagError, nameError, onChange }: { config: AiInputConfig; tagError?: string; nameError?: string; onChange: (patch: Partial<AiInputConfig>) => void }) {
  const { t } = useI18n()
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px]">
      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">Tag</span>
        <input
          aria-invalid={Boolean(tagError)}
          aria-describedby={tagError ? `ui-${config.channel}-tag-error` : undefined}
          className="h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
          value={config.tag}
          onChange={(event) => onChange({ tag: event.target.value })}
        />
        {tagError && <span id={`ui-${config.channel}-tag-error`} role="alert" className="block text-xs text-[var(--c-fault-fg)]">{tagError}</span>}
      </label>
      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{t('channelLabel')}</span>
        <input
          aria-invalid={Boolean(nameError)}
          aria-describedby={nameError ? `ui-${config.channel}-name-error` : undefined}
          className="h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
          value={config.label}
          onChange={(event) => onChange({ label: event.target.value })}
        />
        {nameError && <span id={`ui-${config.channel}-name-error`} role="alert" className="block text-xs text-[var(--c-fault-fg)]">{nameError}</span>}
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

      <div className="mb-4 overflow-x-auto border-b border-[var(--c-border)]">
        <div className="flex min-w-max gap-1">
          {steps.map((item, index) => (
            <button
              key={item}
              type="button"
              title={`${wizardStepLabel(item, t)}: ${wizardStepValue(item, config, t)}`}
              onClick={() => onStepSelect(index)}
              className={cn(
                'min-w-20 border-b-2 px-3 py-2 text-left text-xs font-semibold transition',
                index === stepIndex
                  ? 'border-[var(--c-accent)] bg-[var(--c-surface-2)] text-[var(--c-text)]'
                  : 'border-transparent text-[var(--c-text-dim)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]'
              )}
            >
              <span className="block font-mono">{wizardStepRegister(item)}</span>
              <span className="block max-w-28 truncate">{wizardStepLabel(item, t)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-44">
        {step === 'signal' && <SignalTypeField config={config} onChange={onChange} />}
        {step === 'min' && <NumberField label={t('displayMinLabel')} value={config.displayMin} min={-50} max={205} onChange={(displayMin) => onChange({ displayMin })} />}
        {step === 'max' && <NumberField label={t('displayMaxLabel')} value={config.displayMax} min={-50} max={205} onChange={(displayMax) => onChange({ displayMax })} />}
        {step === 'range' && <RangeMultiplierField value={config.rangeMultiplier} onChange={(rangeMultiplier) => onChange({ rangeMultiplier })} />}
        {step === 'unit' && <UnitField value={config.unit} onChange={(unit) => onChange({ unit })} />}
        {step === 'filter' && <NumberField label={t('filterSamplesLabel')} value={config.filterSamples} min={0} max={100} onChange={(filterSamples) => onChange({ filterSamples })} />}
        {step === 'cal' && <NumberField label={t('sensorCalibrationLabel')} value={config.sensorCal} min={-12.7} max={12.8} step={0.1} onChange={(sensorCal) => onChange({ sensorCal })} />}
        {step === 'math' && <MathFunctionField value={config.mathFunction} onChange={(mathFunction) => onChange({ mathFunction })} />}
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
    { register: 'u0', name: t('signalTypeLabel'), wired: true, control: <SignalTypeSelect value={config.signalType} onChange={(signalType) => onChange(signalTypePatch(signalType, config.analogCurrent))} /> },
    ...(config.signalType === 2 ? [{ register: 'u0', name: t('signalModeLabel'), wired: true, control: <AnalogSignalModeSelect value={Boolean(config.analogCurrent)} onChange={(analogCurrent) => onChange({ analogCurrent })} /> }] : []),
    { register: 'u1', name: t('displayMinLabel'), wired: true, control: <SmallNumberInput value={config.displayMin} min={-50} max={205} onChange={(displayMin) => onChange({ displayMin })} /> },
    { register: 'u2', name: t('displayMaxLabel'), wired: true, control: <SmallNumberInput value={config.displayMax} min={-50} max={205} onChange={(displayMax) => onChange({ displayMax })} /> },
    { register: 'u3', name: t('rangeMultiplierLabel'), wired: true, control: <RangeMultiplierSelect value={config.rangeMultiplier} onChange={(rangeMultiplier) => onChange({ rangeMultiplier })} /> },
    { register: 'u4', name: t('unitsLabel'), wired: true, control: <UnitSelect value={config.unit} onChange={(unit) => onChange({ unit })} /> },
    { register: 'u5', name: t('filterSamplesLabel'), wired: true, control: <SmallNumberInput value={config.filterSamples} min={0} max={100} onChange={(filterSamples) => onChange({ filterSamples })} /> },
    { register: 'u6', name: t('sensorCalibrationLabel'), wired: true, control: <SmallNumberInput value={config.sensorCal} min={-12.7} max={12.8} step={0.1} onChange={(sensorCal) => onChange({ sensorCal })} /> },
    { register: 'u7', name: t('mathFunctionLabel'), wired: true, control: <MathFunctionSelect value={config.mathFunction} onChange={(mathFunction) => onChange({ mathFunction })} /> }
  ]

  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)]">
      <div className="grid grid-cols-[90px_minmax(0,1fr)_minmax(160px,240px)_82px] bg-[var(--c-surface-2)] px-3 py-2 text-xs font-semibold uppercase text-[var(--c-text-dim)]">
        <span>{t('register')}</span>
        <span>{t('channelLabel')}</span>
        <span>{t('value')}</span>
        <span>Mode</span>
      </div>
      {rows.map((row) => (
        <div key={`${row.register}-${row.name}`} className="grid grid-cols-[90px_minmax(0,1fr)_minmax(160px,240px)_82px] items-center gap-3 border-t border-[var(--c-border)] px-3 py-3 text-sm">
          <span className="font-mono text-[var(--c-text-dim)]">{String(config.channel).padStart(2, '0')} {row.register}</span>
          <span className="font-medium text-[var(--c-text)]">{row.name}</span>
          {row.control}
          <ModeBadge wired={row.wired} />
        </div>
      ))}
    </div>
  )
}

function SignalTypeField({ config, onChange }: { config: AiInputConfig; onChange: (patch: Partial<AiInputConfig>) => void }) {
  const { t } = useI18n()
  return (
    <div className="space-y-3">
      <FieldHeader label={t('signalTypeLabel')} wired />
      <SignalTypeSelect value={config.signalType} onChange={(signalType) => onChange(signalTypePatch(signalType, config.analogCurrent))} />
      {config.signalType === 2 && <AnalogSignalModeField value={Boolean(config.analogCurrent)} onChange={(analogCurrent) => onChange({ analogCurrent })} />}
    </div>
  )
}

function AnalogSignalModeField({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  const { t } = useI18n()
  return (
    <label className="block space-y-2">
      <FieldHeader label={t('signalModeLabel')} wired />
      <AnalogSignalModeSelect value={value} onChange={onChange} />
    </label>
  )
}

function UnitField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useI18n()
  return (
    <div className="space-y-3">
      <FieldHeader label={t('unitsLabel')} wired />
      <UnitSelect value={value} onChange={onChange} />
    </div>
  )
}

function RangeMultiplierField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useI18n()
  return (
    <div className="space-y-3">
      <FieldHeader label={t('rangeMultiplierLabel')} wired />
      <RangeMultiplierSelect value={value} onChange={onChange} />
    </div>
  )
}

function MathFunctionField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useI18n()
  return (
    <div className="space-y-3">
      <FieldHeader label={t('mathFunctionLabel')} wired />
      <MathFunctionSelect value={value} onChange={onChange} />
    </div>
  )
}

function NumberField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return (
    <label className="block space-y-2">
      <FieldHeader label={label} wired />
      <SmallNumberInput value={value} min={min} max={max} step={step} onChange={onChange} />
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

function AnalogSignalModeSelect({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  const { t } = useI18n()
  return (
    <select className={controlClass()} value={value ? 'current' : 'volt'} onChange={(event) => onChange(event.target.value === 'current')}>
      <option value="volt">{t('signalModeVolt')}</option>
      <option value="current">{t('signalModeCurrent')}</option>
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

function FieldHeader({ label, wired }: { label: string; wired?: boolean }) {
  return (
    <span className="flex items-center gap-2 text-sm font-semibold text-[var(--c-text)]">
      {label}
      <ModeBadge wired={wired} />
    </span>
  )
}

function ModeBadge({ wired }: { wired?: boolean }) {
  return (
    <span className={cn('rounded-[var(--radius)] border px-2 py-0.5 text-center text-[10px] font-bold uppercase', wired ? 'border-[rgba(31,122,74,0.35)] bg-[rgba(31,122,74,0.10)] text-[var(--c-good-fg)]' : 'border-[var(--c-border)] bg-[var(--c-surface-2)] text-[var(--c-text-dim)]')}>
      {wired ? 'wired' : 'demo'}
    </span>
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
  return ['signal', 'min', 'max', 'range', 'unit', 'filter', 'cal', 'math']
}

function wizardStepLabel(step: WizardStep, t: Translate): string {
  if (step === 'signal') return t('signalTypeLabel')
  if (step === 'min') return t('displayMinLabel')
  if (step === 'max') return t('displayMaxLabel')
  if (step === 'range') return t('rangeMultiplierLabel')
  if (step === 'unit') return t('unitsLabel')
  if (step === 'filter') return t('filterSamplesLabel')
  if (step === 'cal') return t('sensorCalibrationLabel')
  return t('mathFunctionLabel')
}

function wizardStepRegister(step: WizardStep): string {
  if (step === 'signal') return 'u0'
  if (step === 'min') return 'u1'
  if (step === 'max') return 'u2'
  if (step === 'range') return 'u3'
  if (step === 'unit') return 'u4'
  if (step === 'filter') return 'u5'
  if (step === 'cal') return 'u6'
  return 'u7'
}

function wizardStepValue(step: WizardStep, config: AiInputConfig, t: Translate): string {
  if (step === 'signal') return config.signalType === 2 ? `${signalLabel(config.signalType, t)} / ${config.analogCurrent ? t('signalModeCurrent') : t('signalModeVolt')}` : signalLabel(config.signalType, t)
  if (step === 'min') return String(config.displayMin)
  if (step === 'max') return String(config.displayMax)
  if (step === 'range') return rangeLabel(config.rangeMultiplier, t)
  if (step === 'unit') return unitLabel(config.unit, t)
  if (step === 'filter') return String(config.filterSamples)
  if (step === 'cal') return String(config.sensorCal)
  return mathFunctionLabel(config.mathFunction, t)
}

function aiNode(channel: number): string {
  return uiNode(channel)
}

function signalTypePatch(signalType: AiSignalType, analogCurrent?: boolean): Partial<AiInputConfig> {
  return { signalType, analogCurrent: signalType === 2 ? Boolean(analogCurrent) : false }
}

function findAiPoint(points: Point[], channel: number): Point | undefined {
  const ids = new Set(aiPointIds(channel).map((id) => id.toUpperCase()))
  return points.find((point) => isVisibleUniversalInput(point) && ids.has(point.id.trim().toUpperCase()))
}

function aiPointIds(channel: number): string[] {
  const padded = String(channel).padStart(2, '0')
  return [aiNode(channel), `UI${channel}`, `UI${padded}`, `AI${channel}`, `AI${padded}`, `DI${channel}`, `DI${padded}`]
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
  if (value === 4) return t('unit4')
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
