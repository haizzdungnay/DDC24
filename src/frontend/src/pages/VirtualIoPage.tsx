import { Activity, ChevronLeft, ChevronRight, Database, Plus, Save, SlidersHorizontal, Trash2, Wand2, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { apiClient } from '../api/client'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { Panel } from '../components/Panel'
import { useToast } from '../components/Toast'
import { useApi } from '../hooks/useApi'
import { useI18n } from '../i18n'
import type { Point, VirtualPoint, VirtualPointSignalType } from '../types'
import { cn, formatValue } from '../utils'

type ViewMode = 'summary' | 'wizard' | 'advanced'
type WizardStep = 'signal' | 'min' | 'max' | 'range' | 'unit' | 'filter' | 'cal' | 'math'
type Translate = ReturnType<typeof useI18n>['t']

const signalTypes: VirtualPointSignalType[] = ['boolean', 'integer', 'float', 'string', 'datetime']
const unitOptions = [0, 1, 2, 3, 4]
const rangeMultiplierOptions = [0, 1, 2, 3, 4, 5]
const mathFunctionOptions = [0, 1, 2, 3]
const wizardSteps: WizardStep[] = ['signal', 'min', 'max', 'range', 'unit', 'filter', 'cal', 'math']
const logOptions = [
  { value: 0, label: 'Off', capacity: 256 },
  { value: 1000, label: '1s', capacity: 128 },
  { value: 100, label: '100ms', capacity: 64 },
  { value: 10, label: '10ms diagnostic', capacity: 16 }
] as const

export function VirtualPointsPage() {
  const { t, pick } = useI18n()
  const toast = useToast()
  const pointsState = useApi(apiClient.getPoints, [], { refreshMs: 1000 })
  const [items, setItems] = useState<VirtualPoint[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [mode, setMode] = useState<ViewMode>('summary')
  const [wizardIndex, setWizardIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    apiClient.getVirtualPoints()
      .then((next) => {
        if (!active) return
        const normalized = next.map(normalizeVirtualPoint)
        setItems(normalized)
        setSelectedId((current) => current || normalized[0]?.id || '')
      })
      .catch((error) => active && toast.push('error', error instanceof Error ? error.message : String(error)))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [toast])

  const selected = items.find((item) => item.id === selectedId) ?? items[0]
  const livePoint = selected ? findLivePoint(pointsState.data ?? [], selected.id) : undefined
  const quotas = useMemo(() => quotaUsage(items), [items])
  const currentStep = wizardSteps[Math.min(wizardIndex, wizardSteps.length - 1)]

  function updateSelected(patch: Partial<VirtualPoint>) {
    if (!selected) return
    setItems((current) => current.map((item) => item.id === selected.id ? normalizeVirtualPoint({ ...item, ...patch }) : item))
  }

  async function saveSelected() {
    if (!selected) return
    setSaving(true)
    try {
      const saved = normalizeVirtualPoint(await apiClient.updateVirtualPoint(normalizeVirtualPoint(selected)))
      setItems((current) => current.map((item) => item.id === saved.id ? saved : item))
      toast.push('success', pick('Da luu Virtual Point', 'Virtual Point saved'))
    } catch (error) {
      toast.push('error', error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function createItem(input: Partial<VirtualPoint>) {
    setSaving(true)
    try {
      const created = normalizeVirtualPoint(await apiClient.createVirtualPoint(normalizeVirtualPoint({ ...defaultVirtualPoint(), ...input })))
      setItems((current) => [...current, created])
      setSelectedId(created.id)
      setWizardIndex(0)
      setAddOpen(false)
      toast.push('success', pick('Da tao VP', 'Virtual Point created'))
    } catch (error) {
      toast.push('error', error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function deleteSelected() {
    if (!selected) return
    setSaving(true)
    try {
      await apiClient.deleteVirtualPoint(selected.id)
      const next = items.filter((item) => item.id !== selected.id)
      setItems(next)
      setSelectedId(next[0]?.id ?? '')
      setWizardIndex(0)
      setDeleteOpen(false)
      toast.push('success', pick('Da xoa VP', 'Virtual Point deleted'))
    } catch (error) {
      toast.push('error', error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function writeValue(raw: string) {
    if (!selected) return
    setSaving(true)
    try {
      const value = parseValue(selected.signalType, raw)
      await apiClient.forcePoint(selected.id, value)
      updateSelected({ value, updatedAt: new Date().toISOString() })
      toast.push('success', pick(`Da ghi ${selected.id}`, `Wrote ${selected.id}`))
      await pointsState.refetch()
    } catch (error) {
      toast.push('error', error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--c-text)]">{pick('Virtual Points', 'Virtual Points')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('VP backend-only, chi hien khi da tao.', 'Backend-only Virtual Points, visible only after creation.')}</p>
        </div>
        <div className="flex gap-2">
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAddOpen(true)}>{pick('Tao VP', 'Add VP')}</Button>
          <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={saving} disabled={!selected || loading} onClick={() => void saveSelected()}>{t('save')}</Button>
        </div>
      </div>

      <QuotaStrip quotas={quotas} />

      <div className="grid gap-5 lg:grid-cols-[276px_minmax(0,1fr)]">
        <Panel title={pick('VP da tao', 'Created VP')}>
          <div className="space-y-2">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedId(item.id)
                  setWizardIndex(0)
                }}
                className={cn('flex min-h-12 w-full items-center gap-3 rounded-[var(--radius)] border px-3 py-2 text-left text-sm transition', selected?.id === item.id ? 'border-[var(--c-accent)] bg-[var(--c-surface-2)] text-[var(--c-text)]' : 'border-transparent text-[var(--c-text-dim)] hover:border-[var(--c-border)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]')}
              >
                <Database className="h-4 w-4 shrink-0 text-[var(--c-accent)]" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{item.id}</span>
                  <span className="block truncate text-xs">{item.label}</span>
                </span>
                <span className="text-xs font-mono uppercase text-[var(--c-text-dim)]">{item.signalType}</span>
              </button>
            ))}
            {!items.length && <div className="rounded-[var(--radius)] border border-dashed border-[var(--c-border)] p-4 text-sm text-[var(--c-text-dim)]">{loading ? t('loading') : pick('Chua co VP nao.', 'No VP created.')}</div>}
          </div>
        </Panel>

        <Panel
          title={selected ? `${selected.id} - ${selected.label}` : t('empty')}
          subtitle={selected ? `${selected.signalType.toUpperCase()} | ${selected.logEnabled ? `${selected.logIntervalMs}ms log` : 'no log'}` : undefined}
          action={selected && (
            <div className="flex items-center gap-2">
              <div className="flex rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-1">
                <ModeButton active={mode === 'summary'} icon={<Activity className="h-4 w-4" />} label={t('summary')} onClick={() => setMode('summary')} />
                <ModeButton active={mode === 'wizard'} icon={<Wand2 className="h-4 w-4" />} label={t('wizard')} onClick={() => setMode('wizard')} />
                <ModeButton active={mode === 'advanced'} icon={<SlidersHorizontal className="h-4 w-4" />} label={t('advanced')} onClick={() => setMode('advanced')} />
              </div>
              <Button icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleteOpen(true)}>{pick('Xoa', 'Delete')}</Button>
            </div>
          )}
        >
          {selected ? (
            <div className="space-y-5">
              <Basics item={selected} onChange={updateSelected} />
              {mode === 'summary' && <Summary item={selected} livePoint={livePoint} saving={saving} onWrite={(raw) => void writeValue(raw)} />}
              {mode === 'wizard' && (
                <WizardPanel
                  item={selected}
                  step={currentStep}
                  stepIndex={Math.min(wizardIndex, wizardSteps.length - 1)}
                  stepCount={wizardSteps.length}
                  onChange={updateSelected}
                  onStepSelect={setWizardIndex}
                  onPrevious={() => setWizardIndex((index) => Math.max(index - 1, 0))}
                  onNext={() => setWizardIndex((index) => Math.min(index + 1, wizardSteps.length - 1))}
                  onFinish={() => void saveSelected()}
                />
              )}
              {mode === 'advanced' && <Advanced item={selected} onChange={updateSelected} />}
            </div>
          ) : (
            <div className="rounded-[var(--radius)] border border-dashed border-[var(--c-border)] p-6 text-sm text-[var(--c-text-dim)]">
              {pick('Bam Tao VP de tao bien ao.', 'Use Add VP to create a virtual point.')}
            </div>
          )}
        </Panel>
      </div>

      <AddVirtualPointModal open={addOpen} saving={saving} onCreate={createItem} onClose={() => setAddOpen(false)} />
      <Modal open={deleteOpen} danger title={pick('Xoa VP?', 'Delete Virtual Point?')} confirmLabel="OK" cancelLabel="Cancel" onConfirm={() => void deleteSelected()} onClose={() => setDeleteOpen(false)}>
        {selected ? `${selected.id} - ${selected.label}` : ''}
      </Modal>
    </div>
  )
}

export const VirtualIoPage = VirtualPointsPage

function QuotaStrip({ quotas }: { quotas: ReturnType<typeof quotaUsage> }) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {logOptions.map((option) => (
        <div key={option.value} className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3">
          <div className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{option.label}</div>
          <div className="mono mt-2 text-2xl font-bold text-[var(--c-text)]">{quotas[option.value]}/{option.capacity}</div>
        </div>
      ))}
    </div>
  )
}

function Basics({ item, onChange }: { item: VirtualPoint; onChange: (patch: Partial<VirtualPoint>) => void }) {
  const { t } = useI18n()
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_120px_120px]">
      <TextInput label={t('channelLabel')} value={item.label} onChange={(label) => onChange({ label })} />
      <SignalTypeSelect value={item.signalType} label onChange={(signalType) => onChange(signalTypePatch(item, signalType))} />
      <CheckField label="Enabled" checked={item.enabled} onChange={(enabled) => onChange({ enabled })} />
      <CheckField label="Writable" checked={item.writable} onChange={(writable) => onChange({ writable })} />
    </div>
  )
}

function Summary({ item, livePoint, saving, onWrite }: { item: VirtualPoint; livePoint?: Point; saving: boolean; onWrite: (raw: string) => void }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(String(livePoint?.value ?? item.value ?? defaultValue(item.signalType)))
  useEffect(() => {
    setDraft(String(livePoint?.value ?? item.value ?? defaultValue(item.signalType)))
  }, [item.id, item.signalType, item.value, livePoint?.value])
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--c-text)]">Live Data</h3>
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <LiveDataItem label="Value" value={formatValue(livePoint?.value ?? item.value ?? defaultValue(item.signalType), item.unit)} />
          <LiveDataItem label="Quality" value={livePoint?.quality ?? 'good'} />
          <LiveDataItem label={t('unitsLabel')} value={unitLabel(unitFromString(item.unit), t)} />
          <LiveDataItem label="Log" value={item.logEnabled ? `${item.logIntervalMs}ms` : 'Off'} />
        </dl>
      </section>
      <section className="space-y-4 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
        <h3 className="text-sm font-semibold text-[var(--c-text)]">Write Value</h3>
        {item.writable ? (
          <>
            <ValueInput signalType={item.signalType} value={draft} onChange={setDraft} />
            <Button variant="primary" icon={<Zap className="h-4 w-4" />} loading={saving} onClick={() => onWrite(draft)}>Write</Button>
          </>
        ) : (
          <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">Read only</div>
        )}
      </section>
    </div>
  )
}

function WizardPanel({ item, step, stepIndex, stepCount, onChange, onStepSelect, onPrevious, onNext, onFinish }: {
  item: VirtualPoint
  step: WizardStep
  stepIndex: number
  stepCount: number
  onChange: (patch: Partial<VirtualPoint>) => void
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
        <div className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{stepIndex + 1} / {stepCount}</div>
        <div className="h-2 flex-1 rounded-full bg-[var(--c-surface-2)]">
          <div className="h-2 rounded-full bg-[var(--c-accent)]" style={{ width: `${((stepIndex + 1) / stepCount) * 100}%` }} />
        </div>
      </div>

      <div className="mb-4 overflow-x-auto border-b border-[var(--c-border)]">
        <div className="flex min-w-max gap-1">
          {wizardSteps.map((candidate, index) => (
            <button
              key={candidate}
              type="button"
              title={`${wizardStepLabel(candidate, t)}: ${wizardStepValue(candidate, item, t)}`}
              onClick={() => onStepSelect(index)}
              className={cn(
                'min-w-20 border-b-2 px-3 py-2 text-left text-xs font-semibold transition',
                index === stepIndex
                  ? 'border-[var(--c-accent)] bg-[var(--c-surface-2)] text-[var(--c-text)]'
                  : 'border-transparent text-[var(--c-text-dim)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]'
              )}
            >
              <span className="block font-mono">{wizardStepRegister(candidate)}</span>
              <span className="block max-w-28 truncate">{wizardStepLabel(candidate, t)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-44">{renderWizardField(item, step, onChange, t)}</div>

      <div className="mt-5 flex justify-between gap-2">
        <Button icon={<ChevronLeft className="h-4 w-4" />} onClick={onPrevious} disabled={stepIndex === 0}>{t('previous')}</Button>
        <Button variant="primary" icon={!atEnd ? <ChevronRight className="h-4 w-4" /> : undefined} onClick={atEnd ? onFinish : onNext}>{atEnd ? t('finish') : t('next')}</Button>
      </div>
    </div>
  )
}

function Advanced({ item, onChange }: { item: VirtualPoint; onChange: (patch: Partial<VirtualPoint>) => void }) {
  const { t } = useI18n()
  const logValue = item.logEnabled ? item.logIntervalMs ?? 1000 : 0
  const rows = [
    { register: 'u0', label: t('signalTypeLabel'), control: <SignalTypeSelect value={item.signalType} onChange={(signalType) => onChange(signalTypePatch(item, signalType))} /> },
    { register: 'u1', label: t('displayMinLabel'), control: <SmallNumberInput value={numberOr(item.displayMin, 0)} min={-50} max={205} onChange={(displayMin) => onChange({ displayMin })} /> },
    { register: 'u2', label: t('displayMaxLabel'), control: <SmallNumberInput value={numberOr(item.displayMax, 100)} min={-50} max={205} onChange={(displayMax) => onChange({ displayMax })} /> },
    { register: 'u3', label: t('rangeMultiplierLabel'), control: <RangeMultiplierSelect value={numberOr(item.rangeMultiplier, 0)} onChange={(rangeMultiplier) => onChange({ rangeMultiplier })} /> },
    { register: 'u4', label: t('unitsLabel'), control: <UnitSelect value={unitFromString(item.unit)} onChange={(unit) => onChange({ unit: unitToString(unit) })} /> },
    { register: 'u5', label: t('filterSamplesLabel'), control: <SmallNumberInput value={numberOr(item.filterSamples, 3)} min={0} max={100} onChange={(filterSamples) => onChange({ filterSamples })} /> },
    { register: 'u6', label: t('sensorCalibrationLabel'), control: <SmallNumberInput value={numberOr(item.sensorCal, 0)} min={-12.7} max={12.8} step={0.1} onChange={(sensorCal) => onChange({ sensorCal })} /> },
    { register: 'u7', label: t('mathFunctionLabel'), control: <MathFunctionSelect value={numberOr(item.mathFunction, 0)} onChange={(mathFunction) => onChange({ mathFunction })} /> },
    { register: 'LOG', label: 'Log mode', control: <SelectField value={String(logValue)} options={logOptions.map((option) => [String(option.value), option.label])} onChange={(raw) => {
      const value = Number(raw)
      onChange({ logEnabled: value !== 0, logIntervalMs: value === 0 ? undefined : value, retentionS: value === 0 ? undefined : defaultRetention(value) })
    }} /> },
    { register: 'RET', label: 'Retention (s)', control: <SmallNumberInput value={item.retentionS ?? 0} min={0} max={defaultRetention(logValue)} disabled={!item.logEnabled} onChange={(retentionS) => onChange({ retentionS })} /> },
    { register: 'VAL', label: 'Initial value', control: <ValueInput signalType={item.signalType} value={String(item.value ?? defaultValue(item.signalType))} onChange={(raw) => onChange({ value: parseValue(item.signalType, raw) })} compact /> }
  ]
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)]">
        <div className="grid grid-cols-[96px_minmax(0,1fr)_minmax(190px,280px)_82px] bg-[var(--c-surface-2)] px-3 py-2 text-xs font-semibold uppercase text-[var(--c-text-dim)]">
          <span>{t('register')}</span>
          <span>{t('channelLabel')}</span>
          <span>{t('value')}</span>
          <span>Mode</span>
        </div>
        {rows.map((row) => (
          <div key={row.register} className="grid grid-cols-[96px_minmax(0,1fr)_minmax(190px,280px)_82px] items-center gap-3 border-t border-[var(--c-border)] px-3 py-3 text-sm">
            <span className="font-mono text-[var(--c-text-dim)]">{row.register}</span>
            <span className="font-medium text-[var(--c-text)]">{row.label}</span>
            {row.control}
            <ModeBadge wired />
          </div>
        ))}
      </div>
      <label className="block space-y-2">
        <span className="text-sm font-semibold text-[var(--c-text)]">Note</span>
        <textarea className="min-h-24 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-3 text-sm outline-none focus:border-[var(--c-accent)]" value={item.note ?? ''} onChange={(event) => onChange({ note: event.target.value })} />
      </label>
    </div>
  )
}

function renderWizardField(item: VirtualPoint, step: WizardStep, onChange: (patch: Partial<VirtualPoint>) => void, t: Translate): React.ReactNode {
  if (step === 'signal') return <WizardField label={t('signalTypeLabel')}><SignalTypeSelect value={item.signalType} onChange={(signalType) => onChange(signalTypePatch(item, signalType))} /></WizardField>
  if (step === 'min') return <WizardField label={t('displayMinLabel')}><SmallNumberInput value={numberOr(item.displayMin, 0)} min={-50} max={205} onChange={(displayMin) => onChange({ displayMin })} /></WizardField>
  if (step === 'max') return <WizardField label={t('displayMaxLabel')}><SmallNumberInput value={numberOr(item.displayMax, 100)} min={-50} max={205} onChange={(displayMax) => onChange({ displayMax })} /></WizardField>
  if (step === 'range') return <WizardField label={t('rangeMultiplierLabel')}><RangeMultiplierSelect value={numberOr(item.rangeMultiplier, 0)} onChange={(rangeMultiplier) => onChange({ rangeMultiplier })} /></WizardField>
  if (step === 'unit') return <WizardField label={t('unitsLabel')}><UnitSelect value={unitFromString(item.unit)} onChange={(unit) => onChange({ unit: unitToString(unit) })} /></WizardField>
  if (step === 'filter') return <WizardField label={t('filterSamplesLabel')}><SmallNumberInput value={numberOr(item.filterSamples, 3)} min={0} max={100} onChange={(filterSamples) => onChange({ filterSamples })} /></WizardField>
  if (step === 'cal') return <WizardField label={t('sensorCalibrationLabel')}><SmallNumberInput value={numberOr(item.sensorCal, 0)} min={-12.7} max={12.8} step={0.1} onChange={(sensorCal) => onChange({ sensorCal })} /></WizardField>
  return <WizardField label={t('mathFunctionLabel')}><MathFunctionSelect value={numberOr(item.mathFunction, 0)} onChange={(mathFunction) => onChange({ mathFunction })} /></WizardField>
}

function WizardField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <FieldHeader label={label} wired />
      {children}
    </div>
  )
}

function AddVirtualPointModal({ open, saving, onCreate, onClose }: { open: boolean; saving: boolean; onCreate: (input: Partial<VirtualPoint>) => void; onClose: () => void }) {
  const [label, setLabel] = useState('Virtual Point')
  const [signalType, setSignalType] = useState<VirtualPointSignalType>('float')
  const [unit, setUnit] = useState(0)
  const [writable, setWritable] = useState(true)
  const [logMode, setLogMode] = useState(0)
  const [value, setValue] = useState('0')

  useEffect(() => {
    if (!open) return
    setLabel('Virtual Point')
    setSignalType('float')
    setUnit(0)
    setWritable(true)
    setLogMode(0)
    setValue('0')
  }, [open])

  return (
    <Modal open={open} title="Add Virtual Point" confirmLabel="Create" cancelLabel="Cancel" onConfirm={() => onCreate({ label, signalType, unit: unitToString(unit), writable, logEnabled: logMode !== 0, logIntervalMs: logMode || undefined, retentionS: logMode ? defaultRetention(logMode) : undefined, value: parseValue(signalType, value), enabled: true })} onClose={onClose}>
      <div className="space-y-4">
        <TextInput label="Label" value={label} onChange={setLabel} />
        <SignalTypeSelect value={signalType} label onChange={(type) => { setSignalType(type); setValue(String(defaultValue(type))) }} />
        <UnitSelect value={unit} label onChange={setUnit} />
        <ValueInput signalType={signalType} value={value} onChange={setValue} />
        <SelectField label="Log mode" value={String(logMode)} options={logOptions.map((option) => [String(option.value), option.label])} onChange={(raw) => setLogMode(Number(raw))} />
        <CheckField label="Writable" checked={writable} onChange={setWritable} />
        {saving && <div className="text-xs text-[var(--c-text-dim)]">Saving...</div>}
      </div>
    </Modal>
  )
}

function SignalTypeSelect({ value, label, onChange }: { value: VirtualPointSignalType; label?: boolean; onChange: (value: VirtualPointSignalType) => void }) {
  return <SelectField label={label ? 'Signal Type' : undefined} value={value} options={signalTypes.map((type) => [type, virtualSignalLabel(type)])} onChange={(raw) => onChange(raw as VirtualPointSignalType)} />
}

function UnitSelect({ value, label, onChange }: { value: number; label?: boolean; onChange: (value: number) => void }) {
  const { t } = useI18n()
  return <SelectField label={label ? t('unitsLabel') : undefined} value={String(value)} options={unitOptions.map((option) => [String(option), unitLabel(option, t)])} onChange={(raw) => onChange(Number(raw))} />
}

function RangeMultiplierSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useI18n()
  return <SelectField value={String(value)} options={rangeMultiplierOptions.map((option) => [String(option), rangeLabel(option, t)])} onChange={(raw) => onChange(Number(raw))} />
}

function MathFunctionSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useI18n()
  return <SelectField value={String(value)} options={mathFunctionOptions.map((option) => [String(option), mathFunctionLabel(option, t)])} onChange={(raw) => onChange(Number(raw))} />
}

function ValueInput({ signalType, value, compact, onChange }: { signalType: VirtualPointSignalType; value: string; compact?: boolean; onChange: (value: string) => void }) {
  if (signalType === 'boolean') {
    return <SelectField label={compact ? undefined : 'Value'} value={value === 'true' ? 'true' : 'false'} options={[['false', 'False'], ['true', 'True']]} onChange={onChange} />
  }
  const type = signalType === 'integer' || signalType === 'float' ? 'number' : 'text'
  return <TextInput label={compact ? '' : 'Value'} value={value} type={type} onChange={onChange} />
}

function TextInput({ label, value, type = 'text', disabled, onChange }: { label: string; value: string; type?: string; disabled?: boolean; onChange: (value: string) => void }) {
  return (
    <label className="block space-y-2">
      {label && <span className="text-sm font-semibold text-[var(--c-text)]">{label}</span>}
      <input type={type} disabled={disabled} className={controlClass()} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function SmallNumberInput({ value, min, max, step = 1, disabled, onChange }: { value: number; min: number; max: number; step?: number; disabled?: boolean; onChange: (value: number) => void }) {
  return (
    <input
      className={controlClass()}
      type="number"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={clampNumber(value, min, max)}
      onChange={(event) => onChange(clampNumber(event.currentTarget.valueAsNumber, min, max))}
    />
  )
}

function SelectField({ label, value, options, onChange }: { label?: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return (
    <label className={label ? 'block space-y-2' : 'block'}>
      {label && <span className="text-sm font-semibold text-[var(--c-text)]">{label}</span>}
      <select aria-label={label ?? 'value'} className={controlClass()} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  )
}

function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-[var(--c-text)]">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  )
}

function LiveDataItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3">
      <dt className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{label}</dt>
      <dd className="mt-1 min-h-8 break-words font-mono text-xl font-semibold text-[var(--c-text)]">{value}</dd>
    </div>
  )
}

function ModeButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button type="button" className={cn('inline-flex h-8 items-center gap-2 rounded-[calc(var(--radius)-4px)] px-3 text-xs font-semibold transition', active ? 'bg-[var(--c-surface-2)] text-[var(--c-text)]' : 'text-[var(--c-text-dim)] hover:text-[var(--c-text)]')} onClick={onClick}>{icon}{label}</button>
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

function quotaUsage(items: VirtualPoint[]): Record<(typeof logOptions)[number]['value'], number> {
  return {
    0: items.filter((item) => !item.logEnabled).length,
    1000: items.filter((item) => item.logEnabled && item.logIntervalMs === 1000).length,
    100: items.filter((item) => item.logEnabled && item.logIntervalMs === 100).length,
    10: items.filter((item) => item.logEnabled && item.logIntervalMs === 10).length
  }
}

function normalizeVirtualPoint(item: VirtualPoint): VirtualPoint {
  const signalType = signalTypes.includes(item.signalType) ? item.signalType : 'float'
  const logEnabled = canLog(signalType) && item.logEnabled
  const logIntervalMs = logEnabled ? item.logIntervalMs ?? 1000 : undefined
  const unit = unitToString(unitFromString(item.unit))
  return {
    ...item,
    id: canonicalVirtualPointId(item.id),
    label: item.label.trim() || 'Virtual Point',
    signalType,
    unit,
    displayMin: clampNumber(numberOr(item.displayMin, 0), -50, 205),
    displayMax: clampNumber(numberOr(item.displayMax, 100), -50, 205),
    rangeMultiplier: clampOption(numberOr(item.rangeMultiplier, 0), 0, 5),
    filterSamples: clampOption(numberOr(item.filterSamples, 3), 0, 100),
    sensorCal: clampNumber(numberOr(item.sensorCal, 0), -12.7, 12.8),
    mathFunction: clampOption(numberOr(item.mathFunction, 0), 0, 3),
    logEnabled,
    logIntervalMs,
    retentionS: logEnabled ? item.retentionS ?? defaultRetention(logIntervalMs ?? 1000) : undefined,
    value: parseValue(signalType, String(item.value ?? defaultValue(signalType)))
  }
}

function defaultVirtualPoint(): VirtualPoint {
  return { id: '', label: 'Virtual Point', signalType: 'float', enabled: true, writable: true, logEnabled: false, value: 0, unit: '', displayMin: 0, displayMax: 100, rangeMultiplier: 0, filterSamples: 3, sensorCal: 0, mathFunction: 0, note: '' }
}

function signalTypePatch(item: VirtualPoint, signalType: VirtualPointSignalType): Partial<VirtualPoint> {
  return {
    signalType,
    value: defaultValue(signalType),
    logEnabled: canLog(signalType) ? item.logEnabled : false,
    logIntervalMs: canLog(signalType) ? item.logIntervalMs : undefined,
    retentionS: canLog(signalType) ? item.retentionS : undefined
  }
}

function canonicalVirtualPointId(id: string): string {
  const match = id.trim().toUpperCase().match(/^(?:VP|AV)[-_]?0*(\d+)$/)
  return match ? `VP${Number(match[1])}` : id.trim().toUpperCase()
}

function findLivePoint(points: Point[], id: string): Point | undefined {
  const target = canonicalVirtualPointId(id)
  return points.find((point) => point.kind === 'virtual' && canonicalVirtualPointId(point.id) === target)
}

function canLog(signalType: VirtualPointSignalType): boolean {
  return signalType === 'boolean' || signalType === 'integer' || signalType === 'float'
}

function defaultValue(signalType: VirtualPointSignalType): number | boolean | string {
  if (signalType === 'boolean') return false
  if (signalType === 'integer' || signalType === 'float') return 0
  if (signalType === 'datetime') return new Date().toISOString()
  return ''
}

function parseValue(signalType: VirtualPointSignalType, raw: string): number | boolean | string {
  if (signalType === 'boolean') return raw === 'true' || raw === '1' || raw.toUpperCase() === 'ON'
  if (signalType === 'integer') {
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new Error('Value must be an integer')
    return Math.trunc(value)
  }
  if (signalType === 'float') {
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new Error('Value must be a number')
    return value
  }
  if (signalType === 'datetime') {
    const value = raw.trim()
    if (Number.isNaN(new Date(value).getTime())) throw new Error('Value must be RFC3339 datetime')
    return new Date(value).toISOString()
  }
  return raw
}

function defaultRetention(intervalMs: number): number {
  if (intervalMs === 10) return 60 * 60
  if (intervalMs === 100) return 7 * 24 * 60 * 60
  return 30 * 24 * 60 * 60
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

function wizardStepValue(step: WizardStep, item: VirtualPoint, t: Translate): string {
  if (step === 'signal') return virtualSignalLabel(item.signalType)
  if (step === 'min') return String(numberOr(item.displayMin, 0))
  if (step === 'max') return String(numberOr(item.displayMax, 100))
  if (step === 'range') return rangeLabel(numberOr(item.rangeMultiplier, 0), t)
  if (step === 'unit') return unitLabel(unitFromString(item.unit), t)
  if (step === 'filter') return String(numberOr(item.filterSamples, 3))
  if (step === 'cal') return String(numberOr(item.sensorCal, 0))
  return mathFunctionLabel(numberOr(item.mathFunction, 0), t)
}

function virtualSignalLabel(value: VirtualPointSignalType): string {
  if (value === 'boolean') return 'Boolean'
  if (value === 'integer') return 'Integer'
  if (value === 'float') return 'Float'
  if (value === 'datetime') return 'DateTime'
  return 'String'
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

function unitFromString(unit?: string): number {
  const text = String(unit ?? '').toLowerCase()
  if (text === 'percent' || text === '%' || text === '%rh') return 1
  if (text === 'degc' || text === 'degf' || text === 'c' || text === 'f') return 2
  if (text === 'pa' || text === 'pascal') return 3
  if (text === 'ppm') return 4
  return 0
}

function unitToString(unit: number): string {
  if (unit === 1) return 'percent'
  if (unit === 2) return 'degC'
  if (unit === 3) return 'Pa'
  if (unit === 4) return 'ppm'
  return ''
}

function numberOr(value: unknown, fallback: number): number {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

function clampOption(value: number, min: number, max: number): number {
  return Math.round(clampNumber(value, min, max))
}

function clampNumber(value: number, min: number, max: number): number {
  const finite = Number.isFinite(value) ? value : min
  return Math.min(max, Math.max(min, finite))
}

function controlClass(): string {
  return 'h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)] disabled:cursor-not-allowed disabled:opacity-60'
}
