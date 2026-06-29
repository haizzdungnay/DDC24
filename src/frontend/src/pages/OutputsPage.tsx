import { Activity, ChevronLeft, ChevronRight, Power, RotateCcw, Save, SlidersHorizontal, Wand2, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { apiClient } from '../api/client'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { Panel } from '../components/Panel'
import { useToast } from '../components/Toast'
import { TrendChart } from '../components/TrendChart'
import { useApi } from '../hooks/useApi'
import { useI18n } from '../i18n'
import type { AoConfig, AoSignalMode, DoConfig, DoSafeState, OutputsConfig, Point, TrendSample } from '../types'
import { cn, formatValue, pointNumber } from '../utils'

type OutputTab = 'summary' | 'wizard' | 'advanced'
type OutputKind = 'AO' | 'DO'
type OutputConfig = AoConfig | DoConfig
type Translate = ReturnType<typeof useI18n>['t']
type LiveSample = TrendSample & { raw: number }

const emptyOutputs: OutputsConfig = { ao: [], do: [] }
const outputTrendLimit = 60
const aoWizardKeys: Array<keyof AoConfig> = ['source', 'loopConfig', 'mode', 'minHeatOutput', 'maxHeatOutput', 'minCoolOutput', 'maxCoolOutput', 'alarm100', 'alarm0', 'piSeqLowerFan1', 'fanSpeed2', 'piSeqUpperFan3', 'setbackAlarm', 'safeValue', 'manualValue']
const doWizardKeys: Array<keyof DoConfig> = ['floatingMode', 'source', 'notInUse02', 'sequence', 'switchOffDelay', 'switchOnDelay', 'pwmCycleTime', 'alarmOn', 'alarmOff', 'runtimeCounter', 'runtimeAlarmHours', 'usePiSequence', 'safeState', 'manualValue']

export function OutputsPage() {
  const { t, pick } = useI18n()
  const toast = useToast()
  const [config, setConfig] = useState<OutputsConfig>(emptyOutputs)
  const [selectedId, setSelectedId] = useState('AO-01')
  const [tab, setTab] = useState<OutputTab>('summary')
  const [wizardIndex, setWizardIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const pointsState = useApi(apiClient.getPoints, [], { refreshMs: 1000 })

  useEffect(() => {
    let active = true
    setLoading(true)
    apiClient.getOutputs()
      .then((items) => {
        if (!active) return
        setConfig(items)
        if (!items.ao.some((item) => item.id === selectedId) && !items.do.some((item) => item.id === selectedId)) {
          setSelectedId(items.ao[0]?.id ?? items.do[0]?.id ?? 'AO-01')
        }
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
  }, [selectedId, t, toast])

  const outputs = useMemo<OutputConfig[]>(() => [...config.ao, ...config.do], [config])
  const selected = outputs.find((item) => item.id === selectedId) ?? outputs[0]
  const wizardKeys = selected?.kind === 'DO' ? doWizardKeys : aoWizardKeys
  const currentKey = wizardKeys[Math.min(wizardIndex, wizardKeys.length - 1)]

  useEffect(() => {
    setWizardIndex((index) => Math.min(index, wizardKeys.length - 1))
  }, [wizardKeys.length])

  function updateOutput(id: string, patch: Partial<AoConfig> | Partial<DoConfig>) {
    setConfig((current) => ({
      ao: current.ao.map((item) => item.id === id ? { ...item, ...(patch as Partial<AoConfig>) } : item),
      do: current.do.map((item) => item.id === id ? { ...item, ...(patch as Partial<DoConfig>) } : item)
    }))
  }

  async function saveOutputs(next = config) {
    setSaving(true)
    try {
      await apiClient.putOutputs(next)
      setConfig(next)
      toast.push('success', t('outputsSaveSuccess'))
    } catch (error) {
      toast.push('error', `${t('outputsSaveError')}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  async function forceSelected(release = false) {
    if (!selected) return
    setSaving(true)
    try {
      const value = selected.kind === 'AO' ? selected.manualValue : selected.manualValue
      await apiClient.forceOutput(selected.id, value, release)
      toast.push('success', release ? pick('Đã gỡ manual output', 'Manual output released') : pick('Đã gửi manual output', 'Manual output forced'))
    } catch (error) {
      toast.push('error', `${t('outputsForceError')}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--c-text)]">{t('outputsTitle')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{t('outputsSubtitle')}</p>
        </div>
        <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={saving} onClick={() => void saveOutputs()} disabled={loading || outputs.length === 0}>
          {t('save')}
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[276px_minmax(0,1fr)]">
        <Panel title={t('outputsChannels')}>
          <div className="space-y-4">
            <OutputList title="AO" items={config.ao} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setWizardIndex(0) }} />
            <OutputList title="DO" items={config.do} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setWizardIndex(0) }} />
            {loading && <div className="rounded-[var(--radius)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">{t('loading')}</div>}
          </div>
        </Panel>

        <Panel
          title={selected ? `${selected.id} - ${selected.label}` : t('empty')}
          subtitle={selected?.kind === 'AO' ? t('outputsAoSubtitle') : t('outputsDoSubtitle')}
          action={
            <div className="flex rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-1">
              <ModeButton active={tab === 'summary'} icon={<Activity className="h-4 w-4" />} label={t('summary')} onClick={() => setTab('summary')} />
              <ModeButton active={tab === 'wizard'} icon={<Wand2 className="h-4 w-4" />} label={t('wizard')} onClick={() => setTab('wizard')} />
              <ModeButton active={tab === 'advanced'} icon={<SlidersHorizontal className="h-4 w-4" />} label={t('advanced')} onClick={() => setTab('advanced')} />
            </div>
          }
        >
          {selected && (
            <div className="space-y-5">
              <OutputBasics output={selected} onChange={(patch) => updateOutput(selected.id, patch)} />
              {tab === 'summary' && (
                <OutputSummary
                  output={selected}
                  points={pointsState.data ?? []}
                  saving={saving}
                  onChange={(patch) => updateOutput(selected.id, patch)}
                  onForce={() => void forceSelected(false)}
                  onRelease={() => void forceSelected(true)}
                />
              )}
              {tab === 'wizard' && (
                <WizardPanel
                  output={selected}
                  fieldKey={currentKey}
                  keys={wizardKeys}
                  index={Math.min(wizardIndex, wizardKeys.length - 1)}
                  onChange={(patch) => updateOutput(selected.id, patch)}
                  onStepSelect={setWizardIndex}
                  onPrevious={() => setWizardIndex((value) => Math.max(0, value - 1))}
                  onNext={() => setWizardIndex((value) => Math.min(wizardKeys.length - 1, value + 1))}
                  onFinish={() => setConfirmOpen(true)}
                />
              )}
              {tab === 'advanced' && <AdvancedPanel output={selected} onChange={(patch) => updateOutput(selected.id, patch)} />}
            </div>
          )}
        </Panel>
      </div>

      <Modal
        open={confirmOpen}
        title={t('outputsSaveTitle')}
        confirmLabel="OK"
        cancelLabel="Cancel"
        onConfirm={() => {
          setConfirmOpen(false)
          setTab('advanced')
          void saveOutputs()
        }}
        onClose={() => setConfirmOpen(false)}
      >
        {t('outputsSaveBody')}
      </Modal>
    </div>
  )
}

function OutputList({ title, items, selectedId, onSelect }: { title: string; items: OutputConfig[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <section className="space-y-1">
      <div className="px-2 text-xs font-semibold uppercase text-[var(--c-text-dim)]">{title}</div>
      {items.map((item) => {
        const Icon = item.kind === 'AO' ? Activity : Zap
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={cn(
              'flex min-h-12 w-full items-center gap-3 rounded-[var(--radius)] border px-3 py-2 text-left text-sm transition',
              selectedId === item.id
                ? 'border-[var(--c-accent)] bg-[var(--c-surface-2)] text-[var(--c-text)]'
                : 'border-transparent text-[var(--c-text-dim)] hover:border-[var(--c-border)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]'
            )}
          >
            <Icon className="h-4 w-4 shrink-0 text-[var(--c-accent)]" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block font-semibold">{item.id}</span>
              <span className="block truncate text-xs">{item.label}</span>
            </span>
          </button>
        )
      })}
    </section>
  )
}

function OutputBasics({ output, onChange }: { output: OutputConfig; onChange: (patch: Partial<AoConfig> | Partial<DoConfig>) => void }) {
  const { t } = useI18n()
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{t('channelLabel')}</span>
        <input className={controlClass()} value={output.label} onChange={(event) => onChange({ label: event.target.value })} />
      </label>
      <label className="flex items-end gap-2 pb-2 text-sm font-semibold text-[var(--c-text-dim)]">
        <input className="h-4 w-4 accent-[var(--c-accent)]" type="checkbox" checked={output.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
        {t('enableChannel')}
      </label>
    </div>
  )
}

function OutputSummary({ output, points, saving, onChange, onForce, onRelease }: {
  output: OutputConfig
  points: Point[]
  saving: boolean
  onChange: (patch: Partial<AoConfig> | Partial<DoConfig>) => void
  onForce: () => void
  onRelease: () => void
}) {
  const { t, pick } = useI18n()
  const point = findOutputPoint(points, output)
  const { data, reset } = useOutputTrend(output.id, point)
  const values = data.map((sample) => sample.raw)
  const stats = values.length ? {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((sum, value) => sum + value, 0) / values.length
  } : null
  const unit = point?.unit ?? (output.kind === 'AO' ? '%' : '')

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--c-text)]">{t('outputsLiveData')}</h3>
            <Button size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={reset}>{pick('Đặt lại', 'Reset')}</Button>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <LiveDataItem label={t('currentvalue')} value={point ? formatValue(point.value, unit) : '--'} />
            <LiveDataItem label={pick('Nhỏ nhất', 'Min')} value={stats ? formatStat(stats.min, unit) : '--'} />
            <LiveDataItem label={pick('Lớn nhất', 'Max')} value={stats ? formatStat(stats.max, unit) : '--'} />
            <LiveDataItem label={pick('Trung bình', 'Avg')} value={stats ? formatStat(stats.avg, unit) : '--'} />
          </dl>
        </section>

        <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--c-text)]">{t('outputsLiveTrend')}</h3>
            <span className="text-xs font-semibold text-[var(--c-text-dim)]">{output.id}</span>
          </div>
          <TrendChart data={data} height={250} series={[{ key: output.id, label: output.label, color: 'var(--c-accent)', unit }]} />
        </section>
      </div>

      <section className="space-y-4 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
        <h3 className="text-sm font-semibold text-[var(--c-text)]">{t('outputsManual')}</h3>
        {output.kind === 'AO' ? (
          <NumberField label="AO SP" value={output.manualValue} min={0} max={100} onChange={(manualValue) => onChange({ manualValue })} wired />
        ) : (
          <SelectField label="DO SP" value={output.manualValue ? '1' : '0'} options={[['0', 'OFF'], ['1', 'ON']]} onChange={(value) => onChange({ manualValue: value === '1' })} wired />
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="primary" icon={<Power className="h-4 w-4" />} loading={saving} onClick={onForce}>{t('force')}</Button>
          <Button icon={<RotateCcw className="h-4 w-4" />} loading={saving} onClick={onRelease}>{pick('Gỡ', 'Release')}</Button>
        </div>
        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{t('notes')}</span>
          <textarea className="min-h-28 w-full resize-y rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]" value={output.note} onChange={(event) => onChange({ note: event.target.value })} />
        </label>
      </section>
    </div>
  )
}

function WizardPanel({ output, fieldKey, keys, index, onChange, onStepSelect, onPrevious, onNext, onFinish }: {
  output: OutputConfig
  fieldKey: keyof AoConfig | keyof DoConfig
  keys: Array<keyof AoConfig | keyof DoConfig>
  index: number
  onChange: (patch: Partial<AoConfig> | Partial<DoConfig>) => void
  onStepSelect: (index: number) => void
  onPrevious: () => void
  onNext: () => void
  onFinish: () => void
}) {
  const { t } = useI18n()
  const atEnd = index === keys.length - 1
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{index + 1} / {keys.length}</div>
        <div className="h-2 flex-1 rounded-full bg-[var(--c-surface-2)]">
          <div className="h-2 rounded-full bg-[var(--c-accent)]" style={{ width: `${((index + 1) / keys.length) * 100}%` }} />
        </div>
      </div>
      <div className="mb-4 overflow-x-auto border-b border-[var(--c-border)]">
        <div className="flex min-w-max gap-1">
          {keys.map((key, itemIndex) => (
            <button
              key={String(key)}
              type="button"
              title={fieldLabel(output.kind, key, t)}
              onClick={() => onStepSelect(itemIndex)}
              className={cn(
                'min-w-24 border-b-2 px-3 py-2 text-left text-xs font-semibold transition',
                itemIndex === index ? 'border-[var(--c-accent)] bg-[var(--c-surface-2)] text-[var(--c-text)]' : 'border-transparent text-[var(--c-text-dim)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]'
              )}
            >
              <span className="block font-mono">{registerFor(output.kind, output.channel, key)}</span>
              <span className="block max-w-28 truncate">{fieldLabel(output.kind, key, t)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-36">{renderOutputField(output, fieldKey, onChange, true, t)}</div>
      <div className="mt-5 flex justify-between gap-2">
        <Button icon={<ChevronLeft className="h-4 w-4" />} onClick={onPrevious} disabled={index === 0}>{t('previous')}</Button>
        <Button variant="primary" icon={!atEnd ? <ChevronRight className="h-4 w-4" /> : undefined} onClick={atEnd ? onFinish : onNext}>{atEnd ? t('finish') : t('next')}</Button>
      </div>
    </div>
  )
}

function AdvancedPanel({ output, onChange }: { output: OutputConfig; onChange: (patch: Partial<AoConfig> | Partial<DoConfig>) => void }) {
  const { t } = useI18n()
  const keys = output.kind === 'AO'
    ? ['source', 'loopConfig', 'mode', 'minHeatOutput', 'maxHeatOutput', 'minCoolOutput', 'maxCoolOutput', 'alarm100', 'alarm0', 'input', 'notUsed10', 'notUsed11', 'piSeqLowerFan1', 'fanSpeed2', 'piSeqUpperFan3', 'setbackAlarm', 'notInUse16', 'safeValue', 'manualValue'] as Array<keyof AoConfig>
    : ['floatingMode', 'source', 'notInUse02', 'sequence', 'switchOffDelay', 'switchOnDelay', 'pwmCycleTime', 'alarmOn', 'alarmOff', 'runtimeCounter', 'runtimeAlarmHours', 'usePiSequence', 'activationLimitPi', 'deactivationLimitPi', 'notUsed14', 'notUsed15', 'notInUse16', 'safeState', 'manualValue'] as Array<keyof DoConfig>

  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)]">
      <div className="grid grid-cols-[96px_minmax(0,1fr)_minmax(190px,280px)_82px] bg-[var(--c-surface-2)] px-3 py-2 text-xs font-semibold uppercase text-[var(--c-text-dim)]">
        <span>{t('register')}</span>
        <span>{t('channelLabel')}</span>
        <span>{t('value')}</span>
        <span>Mode</span>
      </div>
      {keys.map((key) => (
        <div key={String(key)} className="grid grid-cols-[96px_minmax(0,1fr)_minmax(190px,280px)_82px] items-center gap-3 border-t border-[var(--c-border)] px-3 py-3 text-sm">
          <span className="font-mono text-[var(--c-text-dim)]">{registerFor(output.kind, output.channel, key)}</span>
          <span className="font-medium text-[var(--c-text)]">{fieldLabel(output.kind, key, t)}</span>
          {renderOutputField(output, key, onChange, false, t)}
          <span className={cn('rounded-[var(--radius)] border px-2 py-1 text-center text-[10px] font-bold uppercase', isWiredKey(key) ? 'border-[rgba(31,122,74,0.35)] bg-[rgba(31,122,74,0.10)] text-[var(--c-good-fg)]' : 'border-[var(--c-border)] bg-[var(--c-surface-2)] text-[var(--c-text-dim)]')}>
            {isWiredKey(key) ? 'wired' : 'demo'}
          </span>
        </div>
      ))}
    </div>
  )
}

function renderOutputField(output: OutputConfig, key: keyof AoConfig | keyof DoConfig, onChange: (patch: Partial<AoConfig> | Partial<DoConfig>) => void, large: boolean, t: Translate): React.ReactNode {
  const label = fieldLabel(output.kind, key, t)
  if (output.kind === 'AO') {
    const ao = output
    if (key === 'mode') return <SelectField label={label} value={ao.mode} options={[['0-10V', '0-10V'], ['4-20mA', '4-20mA']]} onChange={(mode) => onChange({ mode: mode as AoSignalMode })} wired large={large} />
    if (key === 'source') return <SelectField label={label} value={String(ao.source)} options={aoSourceOptions(t)} onChange={(source) => onChange({ source: Number(source) })} large={large} />
    if (key === 'loopConfig') return <SelectField label={label} value={String(ao.loopConfig)} options={aoLoopOptions(t)} onChange={(loopConfig) => onChange({ loopConfig: Number(loopConfig) })} large={large} />
    if (key === 'safeValue') return <NumberField label={label} value={ao.safeValue} min={0} max={100} onChange={(safeValue) => onChange({ safeValue })} wired large={large} />
    if (key === 'manualValue') return <NumberField label={label} value={ao.manualValue} min={0} max={100} onChange={(manualValue) => onChange({ manualValue })} wired large={large} />
    if (key === 'input') return <SelectField label={label} value={String(ao.input)} options={inputOptions(t)} onChange={(input) => onChange({ input: Number(input) })} large={large} />
    if (key === 'alarm100') return <SelectField label={label} value={String(ao.alarm100)} options={alarmOptions(t)} onChange={(alarm100) => onChange({ alarm100: Number(alarm100) })} large={large} />
    if (key === 'alarm0') return <SelectField label={label} value={String(ao.alarm0)} options={alarmOptions(t)} onChange={(alarm0) => onChange({ alarm0: Number(alarm0) })} large={large} />
    return <NumberField label={label} value={Number(ao[key as keyof AoConfig] ?? 0)} min={0} max={100} onChange={(value) => onChange({ [key]: value } as Partial<AoConfig>)} large={large} />
  }
  const digital = output
  if (key === 'safeState') return <SelectField label={label} value={digital.safeState} options={[['open', 'open'], ['closed', 'closed']]} onChange={(safeState) => onChange({ safeState: safeState as DoSafeState })} wired large={large} />
  if (key === 'manualValue') return <SelectField label={label} value={digital.manualValue ? '1' : '0'} options={[['0', 'OFF'], ['1', 'ON']]} onChange={(manualValue) => onChange({ manualValue: manualValue === '1' })} wired large={large} />
  if (key === 'floatingMode' || key === 'runtimeCounter' || key === 'usePiSequence') return <SelectField label={label} value={digital[key] ? '1' : '0'} options={[['0', t('off')], ['1', t('on')]]} onChange={(value) => onChange({ [key]: value === '1' } as Partial<DoConfig>)} large={large} />
  if (key === 'source') return <SelectField label={label} value={String(digital.source)} options={doSourceOptions(t)} onChange={(source) => onChange({ source: Number(source) })} large={large} />
  if (key === 'sequence') return <SelectField label={label} value={String(digital.sequence)} options={sequenceOptions(t)} onChange={(sequence) => onChange({ sequence: Number(sequence) })} large={large} />
  if (key === 'alarmOn') return <SelectField label={label} value={String(digital.alarmOn)} options={alarmOptions(t)} onChange={(alarmOn) => onChange({ alarmOn: Number(alarmOn) })} large={large} />
  if (key === 'alarmOff') return <SelectField label={label} value={String(digital.alarmOff)} options={alarmOptions(t)} onChange={(alarmOff) => onChange({ alarmOff: Number(alarmOff) })} large={large} />
  if (key === 'switchOffDelay' || key === 'switchOnDelay' || key === 'pwmCycleTime') return <TextField label={label} value={String(digital[key])} onChange={(value) => onChange({ [key]: value } as Partial<DoConfig>)} large={large} />
  return <NumberField label={label} value={Number(digital[key as keyof DoConfig] ?? 0)} min={key === 'runtimeAlarmHours' ? 0 : -50} max={key === 'runtimeAlarmHours' ? 12750 : 205} onChange={(value) => onChange({ [key]: value } as Partial<DoConfig>)} large={large} />
}

function NumberField({ label, value, min, max, wired, large, onChange }: { label: string; value: number; min: number; max: number; wired?: boolean; large?: boolean; onChange: (value: number) => void }) {
  return (
    <label className={large ? 'block space-y-2' : 'block'}>
      {large && <FieldHeader label={label} wired={wired} />}
      <input className={controlClass()} type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      {large && !wired && <DemoNote />}
    </label>
  )
}

function TextField({ label, value, large, onChange }: { label: string; value: string; large?: boolean; onChange: (value: string) => void }) {
  return (
    <label className={large ? 'block space-y-2' : 'block'}>
      {large && <FieldHeader label={label} />}
      <input className={controlClass()} value={value} onChange={(event) => onChange(event.target.value)} />
      {large && <DemoNote />}
    </label>
  )
}

function SelectField({ label, value, options, wired, large, onChange }: { label: string; value: string; options: Array<[string, string]>; wired?: boolean; large?: boolean; onChange: (value: string) => void }) {
  return (
    <label className={large ? 'block space-y-2' : 'block'}>
      {large && <FieldHeader label={label} wired={wired} />}
      <select className={controlClass()} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
      {large && !wired && <DemoNote />}
    </label>
  )
}

function FieldHeader({ label, wired }: { label: string; wired?: boolean }) {
  return (
    <span className="flex items-center gap-2 text-sm font-semibold text-[var(--c-text)]">
      {label}
      <span className={cn('rounded-[var(--radius)] border px-2 py-0.5 text-[10px] uppercase', wired ? 'border-[rgba(31,122,74,0.35)] text-[var(--c-good-fg)]' : 'border-[var(--c-border)] text-[var(--c-text-dim)]')}>
        {wired ? 'wired' : 'demo'}
      </span>
    </span>
  )
}

function DemoNote() {
  const { t } = useI18n()
  return <div className="text-xs text-[var(--c-text-dim)]">{t('outputsDemoNote')}</div>
}

function LiveDataItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3">
      <dt className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{label}</dt>
      <dd className="mt-1 font-mono text-xl font-semibold text-[var(--c-text)]">{value}</dd>
    </div>
  )
}

function ModeButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={cn('inline-flex h-8 items-center gap-2 rounded-[calc(var(--radius)-4px)] px-3 text-xs font-semibold transition', active ? 'bg-[var(--c-surface-2)] text-[var(--c-text)]' : 'text-[var(--c-text-dim)] hover:text-[var(--c-text)]')}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
}

function useOutputTrend(pointId: string, point?: Point): { data: LiveSample[]; reset: () => void } {
  const [buffers, setBuffers] = useState<Record<string, LiveSample[]>>({})
  const lastKeyRef = useRef('')

  useEffect(() => {
    if (!point) return
    const value = pointNumber(point)
    const time = new Date(point.updatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const nextKey = `${pointId}:${time}:${value}`
    if (lastKeyRef.current === nextKey) return
    lastKeyRef.current = nextKey
    setBuffers((current) => {
      const existing = current[pointId] ?? seedTrend(pointId, point)
      return { ...current, [pointId]: [...existing, { time, raw: value, [pointId]: value }].slice(-outputTrendLimit) }
    })
  }, [pointId, point])

  function reset() {
    setBuffers((current) => ({ ...current, [pointId]: [] }))
  }

  return { data: buffers[pointId] ?? seedTrend(pointId, point), reset }
}

function seedTrend(pointId: string, point?: Point): LiveSample[] {
  if (!point?.trend?.length) return []
  const now = Date.now()
  return point.trend.slice(-outputTrendLimit).map((value, index, items) => ({
    time: new Date(now - (items.length - index - 1) * 1000).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    raw: value,
    [pointId]: value
  }))
}

function findOutputPoint(points: Point[], output: OutputConfig): Point | undefined {
  const ids = new Set([output.id, output.id.replace('-', ''), `${output.kind}${output.channel}`].map((id) => id.toUpperCase()))
  return points.find((point) => point.kind === output.kind && ids.has(point.id.trim().toUpperCase()))
}

function formatStat(value: number, unit?: string): string {
  const fixed = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)
  return `${fixed}${unit ? ` ${unit}` : ''}`
}

function registerFor(kind: OutputKind, channel: number, key: keyof AoConfig | keyof DoConfig): string {
  const prefix = kind === 'AO' ? `${channel}A` : `${channel}d`
  if (key === 'manualValue') return `${prefix} SP`
  if (key === 'safeValue' || key === 'safeState') return 'SAFE'
  const index = registerIndex(key)
  return `${prefix} ${String(index).padStart(2, '0')}`
}

function registerIndex(key: keyof AoConfig | keyof DoConfig): number {
  const map: Record<string, number> = {
    source: 0,
    floatingMode: 0,
    loopConfig: 1,
    notInUse02: 2,
    mode: 2,
    sequence: 3,
    minHeatOutput: 3,
    switchOffDelay: 4,
    maxHeatOutput: 4,
    switchOnDelay: 5,
    minCoolOutput: 5,
    pwmCycleTime: 6,
    maxCoolOutput: 6,
    alarm100: 7,
    alarmOn: 7,
    alarm0: 8,
    alarmOff: 8,
    input: 9,
    runtimeCounter: 9,
    notUsed10: 10,
    runtimeAlarmHours: 10,
    notUsed11: 11,
    usePiSequence: 11,
    piSeqLowerFan1: 12,
    activationLimitPi: 12,
    fanSpeed2: 13,
    deactivationLimitPi: 13,
    piSeqUpperFan3: 14,
    notUsed14: 14,
    setbackAlarm: 15,
    notUsed15: 15,
    notInUse16: 16
  }
  return map[String(key)] ?? 0
}

function fieldLabel(kind: OutputKind, key: keyof AoConfig | keyof DoConfig, t: Translate): string {
  const labels: Record<string, string> = {
    source: kind === 'AO' ? 'Source' : 'Output signal source',
    loopConfig: 'Loop Configuration',
    mode: 'Output Signal',
    minHeatOutput: 'Minimum Heat Output',
    maxHeatOutput: 'Maximum Heat Output',
    minCoolOutput: 'Minimum Cool Output',
    maxCoolOutput: 'Maximum Cool Output',
    alarm100: '100% Alarm',
    alarm0: '0% Alarm',
    input: 'Input',
    notUsed10: t('notUsed'),
    notUsed11: t('notUsed'),
    piSeqLowerFan1: 'PI Seq Lower / Fan 1',
    fanSpeed2: 'Fan speed 2',
    piSeqUpperFan3: 'PI Seq Upper / Fan 3',
    setbackAlarm: 'Setback alarm',
    notInUse16: 'Not in use',
    manualValue: kind === 'AO' ? 'Analog output manual value' : 'Digital output manual value',
    safeValue: 'Safe value',
    safeState: 'Safe state',
    floatingMode: 'Enable Floating Output Mode',
    notInUse02: 'Not in use',
    sequence: 'Select Sequence',
    switchOffDelay: 'Switch Off Delay',
    switchOnDelay: 'Switch On Delay',
    pwmCycleTime: 'PWM Cycle Time',
    alarmOn: 'Alarm sets ON',
    alarmOff: 'Alarm sets OFF',
    runtimeCounter: 'Runtime Counter',
    runtimeAlarmHours: 'Hours before Runtime Alarm',
    usePiSequence: 'Use PI Sequence',
    activationLimitPi: 'Activation Limit PI',
    deactivationLimitPi: 'Deactivation Limit PI',
    notUsed14: t('notUsed'),
    notUsed15: t('notUsed')
  }
  return labels[String(key)] ?? String(key)
}

function isWiredKey(key: keyof AoConfig | keyof DoConfig): boolean {
  return key === 'mode' || key === 'safeValue' || key === 'safeState' || key === 'manualValue'
}

function aoSourceOptions(t: Translate): Array<[string, string]> {
  return [['0', `0 = ${t('off')}`], ['1', '1 = Control Loop 1'], ['2', '2 = Control Loop 2'], ['3', '3 = Control Loop 3'], ['4', '4 = Control Loop 4'], ['5', '5 = Auxiliary Functions'], ['6', '6 = Manual Positioning & Time Schedules'], ['7', '7 = Transmit value of an Input'], ['8', '8 = Maximum of Loop 1&2']]
}

function doSourceOptions(t: Translate): Array<[string, string]> {
  return [['0', `0 = ${t('off')}`], ['1', '1 = Control Loop 1'], ['5', '5 = Special Functions'], ['6', '6 = Manual Positioning & Time Schedule'], ['7', '7 = Controller State Functions'], ['8', '8 = Max of Loop 1&2'], ['9', '9 = Assigned to an Input'], ['10', '10 = Lead-Lag Module']]
}

function aoLoopOptions(_t: Translate): Array<[string, string]> {
  return [['0', '0 = Heating / Reverse'], ['1', '1 = Cooling / Direct'], ['2', '2 = Change-over'], ['3', '3 = Heating sequence'], ['4', '4 = Cooling sequence'], ['5', '5 = Step mode Heating'], ['6', '6 = Step mode Change-over'], ['7', '7 = Step mode Cooling']]
}

function sequenceOptions(_t: Translate): Array<[string, string]> {
  return [['0', '0 = Operation mode'], ['1', '1 = Binary Stage 1'], ['2', '2 = Binary Stage 2'], ['3', '3 = Binary Stage 3'], ['4', '4 = Binary Stage 4'], ['5', '5 = Binary Stage 5'], ['6', '6 = Binary Stage 6']]
}

function alarmOptions(t: Translate): Array<[string, string]> {
  return [['0', `0 = ${t('off')}`], ['1', 'Alarm 1'], ['2', 'Alarm 2'], ['3', 'Alarm 3'], ['4', 'Alarm 4'], ['5', 'Alarm 5'], ['6', 'Alarm 6'], ['7', 'Alarm 7'], ['8', 'Alarm 8']]
}

function inputOptions(t: Translate): Array<[string, string]> {
  return [['0', `0 = ${t('notUsed')}`], ['1', 'Input 1'], ['2', 'Input 2'], ['3', 'Input 3'], ['4', 'Input 4'], ['5', 'Input 5'], ['6', 'Input 6'], ['7', 'Input 7'], ['8', 'Input 8']]
}

function controlClass(): string {
  return 'h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]'
}
