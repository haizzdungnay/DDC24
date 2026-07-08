import { Activity, ChevronLeft, ChevronRight, Plus, RotateCcw, Save, SlidersHorizontal, Trash2, Wand2, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { apiClient } from '../api/client'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { Panel } from '../components/Panel'
import { useToast } from '../components/Toast'
import { TrendChart } from '../components/TrendChart'
import { useApi } from '../hooks/useApi'
import { useI18n } from '../i18n'
import type { Point, TrendSample, VirtualIoDirection, VirtualIoPoint, VirtualIoValueType } from '../types'
import { cn, formatValue, pointNumber } from '../utils'

type ViewMode = 'summary' | 'wizard' | 'advanced'
type WizardStep = 'signal' | 'range' | 'min' | 'max' | 'unit' | 'cal' | 'math' | 'timeout'
type LiveSample = TrendSample & { raw: number }

const steps: WizardStep[] = ['signal', 'range', 'min', 'max', 'unit', 'cal', 'math', 'timeout']
const valueTypes: VirtualIoValueType[] = ['analog', 'binary', 'multistate']
const directions: VirtualIoDirection[] = ['input', 'output']

export function VirtualIoPage() {
  const { pick } = useI18n()
  const toast = useToast()
  const [items, setItems] = useState<VirtualIoPoint[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [mode, setMode] = useState<ViewMode>('summary')
  const [wizardIndex, setWizardIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const pointsState = useApi(apiClient.getPoints, [], { refreshMs: 1000 })

  useEffect(() => {
    let active = true
    setLoading(true)
    apiClient.getVirtualIo()
      .then((next) => {
        if (!active) return
        setItems(next)
        setSelectedId((current) => current || next[0]?.id || '')
      })
      .catch((error) => {
        if (active) toast.push('error', error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [toast])

  const selected = items.find((item) => item.id === selectedId) ?? items[0]
  const grouped = useMemo(() => ({
    input: items.filter((item) => item.direction === 'input'),
    output: items.filter((item) => item.direction === 'output')
  }), [items])

  function updateSelected(patch: Partial<VirtualIoPoint>) {
    if (!selected) return
    setItems((current) => current.map((item) => item.id === selected.id ? normalizeVirtualIo({ ...item, ...patch }) : item))
  }

  function requestSave() {
    setConfirmOpen(true)
  }

  async function confirmSave() {
    if (!selected) return
    setSaving(true)
    try {
      const saved = await apiClient.updateVirtualIo(normalizeVirtualIo(selected))
      setItems((current) => current.map((item) => item.id === saved.id ? saved : item))
      toast.push('success', pick('Da luu Virtual I/O', 'Virtual I/O saved'))
      setConfirmOpen(false)
      setMode('advanced')
    } catch (error) {
      toast.push('error', error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function createItem(input: Pick<VirtualIoPoint, 'direction' | 'valueType' | 'label'>) {
    setSaving(true)
    try {
      const created = await apiClient.createVirtualIo(input)
      setItems((current) => [...current, created])
      setSelectedId(created.id)
      setAddOpen(false)
      setWizardIndex(0)
      toast.push('success', pick('Da tao bien ao', 'Virtual variable created'))
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
      await apiClient.deleteVirtualIo(selected.id)
      const next = items.filter((item) => item.id !== selected.id)
      setItems(next)
      setSelectedId(next[0]?.id ?? '')
      setDeleteOpen(false)
      toast.push('success', pick('Da xoa bien ao', 'Virtual variable deleted'))
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
          <h1 className="text-2xl font-semibold text-[var(--c-text)]">{pick('Virtual I/O', 'Virtual I/O')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Tao va quan ly VI/VO bang core virtual points.', 'Create and manage VI/VO backed by core virtual points.')}</p>
        </div>
        <div className="flex gap-2">
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAddOpen(true)}>{pick('Tao bien ao', 'Add virtual')}</Button>
          <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={saving} disabled={!selected || loading} onClick={requestSave}>{pick('Luu', 'Save')}</Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[276px_minmax(0,1fr)]">
        <Panel title={pick('VI/VO Channels', 'VI/VO Channels')}>
          <div className="space-y-4">
            <VirtualList title="VI" items={grouped.input} selectedId={selected?.id} onSelect={(id) => { setSelectedId(id); setWizardIndex(0) }} />
            <VirtualList title="VO" items={grouped.output} selectedId={selected?.id} onSelect={(id) => { setSelectedId(id); setWizardIndex(0) }} />
            {loading && <div className="rounded-[var(--radius)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">{pick('Dang tai', 'Loading')}</div>}
          </div>
        </Panel>

        <Panel
          title={selected ? `${selected.id} - ${selected.label}` : pick('Chua co bien ao', 'No virtual variable')}
          subtitle={selected ? `${selected.backingPoint} | ${selected.direction.toUpperCase()} | ${selected.valueType.toUpperCase()}` : undefined}
          action={selected && (
            <div className="flex items-center gap-2">
              <div className="flex rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-1">
                <ModeButton active={mode === 'summary'} icon={<Activity className="h-4 w-4" />} label="Summary" onClick={() => setMode('summary')} />
                <ModeButton active={mode === 'wizard'} icon={<Wand2 className="h-4 w-4" />} label="Wizard" onClick={() => setMode('wizard')} />
                <ModeButton active={mode === 'advanced'} icon={<SlidersHorizontal className="h-4 w-4" />} label="Advanced" onClick={() => setMode('advanced')} />
              </div>
              <Button icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleteOpen(true)}>{pick('Xoa', 'Delete')}</Button>
            </div>
          )}
        >
          {selected ? (
            <div className="space-y-5">
              <Basics item={selected} onChange={updateSelected} />
              {mode === 'summary' && (
                <VirtualSummary item={selected} points={pointsState.data ?? []} saving={saving} onChange={updateSelected} onForce={(release) => void forceVirtual(selected, release, setSaving, toast.push)} />
              )}
              {mode === 'wizard' && (
                <WizardPanel
                  item={selected}
                  index={Math.min(wizardIndex, steps.length - 1)}
                  onChange={updateSelected}
                  onStepSelect={setWizardIndex}
                  onPrevious={() => setWizardIndex((value) => Math.max(0, value - 1))}
                  onNext={() => setWizardIndex((value) => Math.min(steps.length - 1, value + 1))}
                  onFinish={requestSave}
                />
              )}
              {mode === 'advanced' && <AdvancedPanel item={selected} onChange={updateSelected} />}
            </div>
          ) : (
            <div className="rounded-[var(--radius)] border border-dashed border-[var(--c-border)] p-6 text-sm text-[var(--c-text-dim)]">
              {pick('Bam Tao bien ao de them VI hoac VO.', 'Use Add virtual to create a VI or VO.')}
            </div>
          )}
        </Panel>
      </div>

      <AddVirtualModal open={addOpen} saving={saving} onCreate={createItem} onClose={() => setAddOpen(false)} />
      <Modal open={deleteOpen} danger title={pick('Xoa bien ao?', 'Delete virtual variable?')} confirmLabel="OK" cancelLabel="Cancel" onConfirm={() => void deleteSelected()} onClose={() => setDeleteOpen(false)}>
        {selected ? `${selected.id} - ${selected.label}` : ''}
      </Modal>
      <Modal open={confirmOpen} title={pick('Lưu cấu hình UI?', 'Save UI config?')} confirmLabel="OK" cancelLabel="Cancel" onConfirm={() => { void confirmSave() }} onClose={() => setConfirmOpen(false)}>
        {pick('Bạn có muốn lưu thay đổi không?', 'Do you want to save the changes?')}
      </Modal>
    </div>
  )
}

function VirtualList({ title, items, selectedId, onSelect }: { title: string; items: VirtualIoPoint[]; selectedId?: string; onSelect: (id: string) => void }) {
  return (
    <section className="space-y-1">
      <div className="px-2 text-xs font-semibold uppercase text-[var(--c-text-dim)]">{title}</div>
      {items.map((item) => {
        const Icon = item.direction === 'input' ? Activity : Zap
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={cn('flex min-h-12 w-full items-center gap-3 rounded-[var(--radius)] border px-3 py-2 text-left text-sm transition', selectedId === item.id ? 'border-[var(--c-accent)] bg-[var(--c-surface-2)] text-[var(--c-text)]' : 'border-transparent text-[var(--c-text-dim)] hover:border-[var(--c-border)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]')}
          >
            <Icon className="h-4 w-4 shrink-0 text-[var(--c-accent)]" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block font-semibold">{item.id}</span>
              <span className="block truncate text-xs">{item.label}</span>
            </span>
            <span className="ml-auto text-xs font-mono text-[var(--c-text-dim)]">{item.backingPoint}</span>
          </button>
        )
      })}
    </section>
  )
}

function Basics({ item, onChange }: { item: VirtualIoPoint; onChange: (patch: Partial<VirtualIoPoint>) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_160px]">
      <label className="block text-sm font-medium text-[var(--c-text)]">
        Label
        <input className={controlClass()} value={item.label} onChange={(event) => onChange({ label: event.target.value })} />
      </label>
      <label className="block text-sm font-medium text-[var(--c-text)]">
        Backing
        <input className={controlClass()} value={item.backingPoint} onChange={(event) => onChange({ backingPoint: event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })} />
      </label>
      <label className="flex items-end gap-2 text-sm font-medium text-[var(--c-text)]">
        <input type="checkbox" checked={item.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
        Enabled
      </label>
    </div>
  )
}

function VirtualSummary({ item, points, saving, onChange, onForce }: { item: VirtualIoPoint; points: Point[]; saving: boolean; onChange: (patch: Partial<VirtualIoPoint>) => void; onForce: (release: boolean) => void }) {
  const { pick } = useI18n()
  const point = findVirtualPoint(points, item)
  const { data, reset } = useVirtualTrend(item, point)
  const values = data.map((sample) => sample.raw)
  const stats = values.length ? {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((sum, value) => sum + value, 0) / values.length
  } : null
  const unit = item.unit || point?.unit

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--c-text)]">{pick('Live Data', 'Live Data')}</h3>
            <Button size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={reset}>Reset</Button>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <LiveDataItem label="Value" value={point ? formatValue(point.value, unit) : '--'} />
            <LiveDataItem label="Min" value={stats ? formatStat(stats.min, unit) : '--'} />
            <LiveDataItem label="Max" value={stats ? formatStat(stats.max, unit) : '--'} />
            <LiveDataItem label="Avg" value={stats ? formatStat(stats.avg, unit) : '--'} />
          </dl>
        </section>
        <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--c-text)]">{pick('Live Graphing', 'Live Graphing')}</h3>
            <span className="text-xs font-semibold text-[var(--c-text-dim)]">{item.backingPoint}</span>
          </div>
          <TrendChart data={data} height={250} series={[{ key: item.backingPoint, label: item.label, color: 'var(--c-accent)', unit }]} />
        </section>
      </div>
      <section className="space-y-4 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
        <h3 className="text-sm font-semibold text-[var(--c-text)]">Notes</h3>
        <textarea className="min-h-28 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-3 text-sm outline-none focus:border-[var(--c-accent)]" value={item.note ?? ''} onChange={(event) => onChange({ note: event.target.value })} />
        {item.direction === 'output' && (
          <>
            {item.valueType === 'binary'
              ? <SelectField label="Manual value" value={String(Boolean(item.manualValue))} options={[['false', 'OFF'], ['true', 'ON']]} onChange={(value) => onChange({ manualValue: value === 'true' })} />
              : <NumberField label="Manual value" value={Number(item.manualValue ?? 0)} min={item.displayMin} max={item.displayMax} step={item.valueType === 'multistate' ? 1 : 0.1} onChange={(manualValue) => onChange({ manualValue })} />}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="primary" loading={saving} onClick={() => onForce(false)}>Force</Button>
              <Button loading={saving} onClick={() => onForce(true)}>Release</Button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function WizardPanel({ item, index, onChange, onStepSelect, onPrevious, onNext, onFinish }: { item: VirtualIoPoint; index: number; onChange: (patch: Partial<VirtualIoPoint>) => void; onStepSelect: (index: number) => void; onPrevious: () => void; onNext: () => void; onFinish: () => void }) {
  const atEnd = index === steps.length - 1
  const step = steps[index]
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{index + 1} / {steps.length}</div>
        <div className="h-2 flex-1 rounded-full bg-[var(--c-surface-2)]"><div className="h-2 rounded-full bg-[var(--c-accent)]" style={{ width: `${((index + 1) / steps.length) * 100}%` }} /></div>
      </div>
      <div className="mb-4 overflow-x-auto border-b border-[var(--c-border)]">
        <div className="flex min-w-max gap-1">
          {steps.map((name, stepIndex) => (
            <button key={name} type="button" onClick={() => onStepSelect(stepIndex)} className={cn('min-w-24 border-b-2 px-3 py-2 text-left text-xs font-semibold transition', stepIndex === index ? 'border-[var(--c-accent)] bg-[var(--c-surface-2)] text-[var(--c-text)]' : 'border-transparent text-[var(--c-text-dim)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]')}>
              <span className="block font-mono">{wizardRegister(name)}</span>
              <span className="block max-w-28 truncate">{wizardLabel(name)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-44">{renderField(item, step, onChange, true)}</div>
      <div className="mt-5 flex justify-between gap-2">
        <Button icon={<ChevronLeft className="h-4 w-4" />} disabled={index === 0} onClick={onPrevious}>Previous</Button>
        <Button variant="primary" icon={!atEnd ? <ChevronRight className="h-4 w-4" /> : undefined} onClick={atEnd ? onFinish : onNext}>{atEnd ? 'Finish' : 'Next'}</Button>
      </div>
    </div>
  )
}

function AdvancedPanel({ item, onChange }: { item: VirtualIoPoint; onChange: (patch: Partial<VirtualIoPoint>) => void }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)]">
      <div className="grid grid-cols-[90px_minmax(0,1fr)_minmax(160px,240px)_82px] bg-[var(--c-surface-2)] px-3 py-2 text-xs font-semibold uppercase text-[var(--c-text-dim)]">
        <span>Register</span><span>Parameter</span><span>Value</span><span>Mode</span>
      </div>
      {steps.map((step) => (
        <div key={step} className="grid grid-cols-[90px_minmax(0,1fr)_minmax(160px,240px)_82px] items-center gap-3 border-t border-[var(--c-border)] px-3 py-3 text-sm">
          <span className="font-mono text-[var(--c-text-dim)]">{item.id} {wizardRegister(step)}</span>
          <span className="font-medium text-[var(--c-text)]">{wizardLabel(step)}</span>
          {renderField(item, step, onChange, false)}
          <span className="rounded-[var(--radius)] border border-[rgba(42,92,138,0.35)] bg-[rgba(42,92,138,0.10)] px-2 py-1 text-center text-[10px] font-bold uppercase text-[var(--c-accent)]">virtual</span>
        </div>
      ))}
    </div>
  )
}

function renderField(item: VirtualIoPoint, step: WizardStep, onChange: (patch: Partial<VirtualIoPoint>) => void, large: boolean): React.ReactNode {
  if (step === 'signal') return <SelectField label="Signal Type" value={String(item.signalType)} options={signalOptions(item.valueType)} large={large} onChange={(signalType) => onChange({ signalType: Number(signalType) })} />
  if (step === 'range') return <SelectField label="Range Multiplier" value={String(item.rangeMultiplier)} options={[['0', '0 = x 1'], ['1', '1 = x 10'], ['2', '2 = x 100'], ['3', '3 = x 1000'], ['4', '4 = x 10000'], ['5', '5 = x 100000']]} large={large} onChange={(rangeMultiplier) => onChange({ rangeMultiplier: Number(rangeMultiplier) })} />
  if (step === 'min') return <NumberField label="Display Minimum" value={item.displayMin} min={-5000} max={20500} step={0.1} large={large} onChange={(displayMin) => onChange({ displayMin })} />
  if (step === 'max') return <NumberField label="Display Maximum" value={item.displayMax} min={-5000} max={20500} step={0.1} large={large} onChange={(displayMax) => onChange({ displayMax })} />
  if (step === 'unit') return <SelectField label="Units" value={item.unit ?? ''} options={[['', '0 = No units shown'], ['%', '1 = % Percentage'], ['C', '2 = C / F'], ['Pa', '3 = Pascals'], ['ppm', '4 = ppm']]} large={large} onChange={(unit) => onChange({ unit })} />
  if (step === 'cal') return <NumberField label="Sensor Calibration" value={item.sensorCal} min={-12.7} max={12.8} step={0.1} large={large} onChange={(sensorCal) => onChange({ sensorCal })} />
  if (step === 'math') return <SelectField label="Math Function" value={String(item.mathFunction)} options={[['0', '0 = Not Active'], ['1', '1 = Average'], ['2', '2 = Minimum'], ['3', '3 = Maximum']]} large={large} onChange={(mathFunction) => onChange({ mathFunction: Number(mathFunction) })} />
  return <NumberField label="Connection Timeout (s)" value={item.connectionTimeoutS} min={0} max={54000} step={1} large={large} onChange={(connectionTimeoutS) => onChange({ connectionTimeoutS })} />
}

function AddVirtualModal({ open, saving, onCreate, onClose }: { open: boolean; saving: boolean; onCreate: (input: Pick<VirtualIoPoint, 'direction' | 'valueType' | 'label'>) => void; onClose: () => void }) {
  const [direction, setDirection] = useState<VirtualIoDirection>('input')
  const [valueType, setValueType] = useState<VirtualIoValueType>('analog')
  const [label, setLabel] = useState('Virtual Input')

  useEffect(() => {
    if (!open) return
    setLabel(direction === 'input' ? 'Virtual Input' : 'Virtual Output')
  }, [direction, open])

  return (
    <Modal open={open} title="Add Virtual I/O" confirmLabel="Create" cancelLabel="Cancel" onConfirm={() => onCreate({ direction, valueType, label })} onClose={onClose}>
      <div className="space-y-4">
        <SelectField label="Direction" value={direction} options={directions.map((item) => [item, item === 'input' ? 'Virtual Input' : 'Virtual Output'])} onChange={(value) => setDirection(value as VirtualIoDirection)} />
        <SelectField label="Value Type" value={valueType} options={valueTypes.map((item) => [item, item])} onChange={(value) => setValueType(value as VirtualIoValueType)} />
        <label className="block text-sm font-medium text-[var(--c-text)]">Label<input className={controlClass()} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
        {saving && <div className="text-xs text-[var(--c-text-dim)]">Saving...</div>}
      </div>
    </Modal>
  )
}

function SelectField({ label, value, options, large, onChange }: { label: string; value: string; options: Array<[string, string]>; large?: boolean; onChange: (value: string) => void }) {
  return (
    <label className={large ? 'block space-y-2' : 'block'}>
      {large && <FieldHeader label={label} />}
      <select aria-label={label} className={controlClass()} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  )
}

function NumberField({ label, value, min, max, step = 1, large, onChange }: { label: string; value: number; min: number; max: number; step?: number; large?: boolean; onChange: (value: number) => void }) {
  return (
    <label className={large ? 'block space-y-2' : 'block'}>
      {large && <FieldHeader label={label} />}
      <input aria-label={label} className={controlClass()} type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}

function FieldHeader({ label }: { label: string }) {
  return <span className="text-sm font-semibold text-[var(--c-text)]">{label}</span>
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
  return <button type="button" className={cn('inline-flex h-8 items-center gap-2 rounded-[calc(var(--radius)-4px)] px-3 text-xs font-semibold transition', active ? 'bg-[var(--c-surface-2)] text-[var(--c-text)]' : 'text-[var(--c-text-dim)] hover:text-[var(--c-text)]')} onClick={onClick}>{icon}{label}</button>
}

function useVirtualTrend(item: VirtualIoPoint, point?: Point): { data: LiveSample[]; reset: () => void } {
  const [data, setData] = useState<LiveSample[]>([])

  useEffect(() => {
    setData([])
  }, [item.id, item.backingPoint, item.valueType, point?.id])

  useEffect(() => {
    if (!point || item.valueType === 'binary') return
    const value = pointNumber(point)
    const time = new Date(point.updatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setData((current) => {
      const last = current[current.length - 1]
      if (last?.time === time && last.raw === value) return current
      return [...current, { time, raw: value, [item.backingPoint]: value }].slice(-60)
    })
  }, [item.backingPoint, item.valueType, point])

  return { data, reset: () => setData([]) }
}

async function forceVirtual(item: VirtualIoPoint, release: boolean, setSaving: (value: boolean) => void, pushToast: (kind: 'success' | 'error' | 'info', message: string) => void) {
  setSaving(true)
  try {
    await apiClient.forcePoint(canonicalVirtualBackingPoint(item.backingPoint), item.manualValue ?? 0, release)
    pushToast('success', release ? 'Virtual point released' : 'Virtual point forced')
  } catch (error) {
    pushToast('error', error instanceof Error ? error.message : String(error))
  } finally {
    setSaving(false)
  }
}

function findVirtualPoint(points: Point[], item: VirtualIoPoint): Point | undefined {
  const target = canonicalVirtualBackingPoint(item.backingPoint)
  return points.find((point) => canonicalVirtualBackingPoint(point.id) === target)
}

function normalizeVirtualIo(item: VirtualIoPoint): VirtualIoPoint {
  return {
    ...item,
    backingPoint: canonicalVirtualBackingPoint(item.backingPoint),
    displayMax: Math.max(item.displayMin + 0.1, item.displayMax),
    manualValue: item.valueType === 'binary' ? Boolean(item.manualValue) : Number(item.manualValue ?? 0)
  }
}

function canonicalVirtualBackingPoint(id: string): string {
  const match = id.trim().toUpperCase().match(/^(AV|BV|MSV)[-_]?0*(\d+)$/)
  return match ? `${match[1]}${Number(match[2])}` : id.trim().toUpperCase()
}

function signalOptions(type: VirtualIoValueType): Array<[string, string]> {
  if (type === 'binary') return [['0', '0 = Not Active'], ['4', '4 = Contact open/closed'], ['5', '5 = Contact closed/open']]
  if (type === 'multistate') return [['0', '0 = Not Active'], ['3', '3 = Special function']]
  return [['0', '0 = Not Active'], ['1', '1 = 0-10V / scaled'], ['2', '2 = Communication module'], ['3', '3 = Special function']]
}

function wizardLabel(step: WizardStep): string {
  const labels: Record<WizardStep, string> = {
    signal: 'Signal Type',
    range: 'Range Multiplier',
    min: 'Display Minimum',
    max: 'Display Maximum',
    unit: 'Units',
    cal: 'Sensor Calibration',
    math: 'Math Function',
    timeout: 'Connection Timeout'
  }
  return labels[step]
}

function wizardRegister(step: WizardStep): string {
  return `u${steps.indexOf(step)}`
}

function formatStat(value: number, unit?: string): string {
  const fixed = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)
  return `${fixed}${unit ? ` ${unit}` : ''}`
}

function controlClass(): string {
  return 'mt-2 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm outline-none focus:border-[var(--c-accent)]'
}
