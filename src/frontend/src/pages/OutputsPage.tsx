import { Activity, ChevronLeft, ChevronRight, LayoutGrid, Pencil, Power, RotateCcw, Save, SlidersHorizontal, Wand2, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { apiClient } from '../api/client'
import { displayPointName, focusPointField, normalizePointName, pointFieldFocusPath, pointFieldLocation, pointNameConflicts, pointTagFieldErrors, validatePointName, validatePointTag } from '../api/pointTags'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { Panel } from '../components/Panel'
import { PointNameConflictNotice } from '../components/PointNameConflictNotice'
import { PointLoggingSection } from '../components/PointLoggingSection'
import { useToast } from '../components/Toast'
import { TrendChart } from '../components/TrendChart'
import { useApi } from '../hooks/useApi'
import { useI18n } from '../i18n'
import type { AoConfig, AoEngineeringUnit, AoSignalMode, DoConfig, DoSafeState, OutputsConfig, Point, TrendSample } from '../types'
import { cn, formatValue, pointNumber } from '../utils'

type OutputTab = 'summary' | 'wizard' | 'advanced'
type OutputKind = 'AO' | 'DO'
type OutputConfig = AoConfig | DoConfig
type Translate = ReturnType<typeof useI18n>['t']
type LiveSample = TrendSample & { raw: number }

const emptyOutputs: OutputsConfig = { ao: [], do: [] }
const outputTrendLimit = 60
const aoWizardKeys: Array<keyof AoConfig> = ['mode', 'units', 'minPv', 'maxPv', 'safeValue', 'manualValue']
const doWizardKeys: Array<keyof DoConfig> = ['safeState', 'manualValue']

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
  const [overviewOpen, setOverviewOpen] = useState(false)
  const [tagErrors, setTagErrors] = useState<Record<string, string>>({})
  const [errorFocusPath, setErrorFocusPath] = useState<string>()
  const pointsState = useApi(apiClient.getPoints, [], { refreshMs: 1000 })
  const virtualPointsState = useApi(apiClient.getVirtualPoints, [], { refreshMs: 2000 })
  const persistedNameConflicts = useMemo(() => pointNameConflicts([
    ...(pointsState.data ?? []).map((point) => ({ id: point.id, name: point.name, kind: point.kind })),
    ...(virtualPointsState.data ?? []).map((point) => ({ id: point.id, name: point.name ?? point.label, kind: 'virtual' }))
  ]), [pointsState.data, virtualPointsState.data])
  const namespaceEntries = useMemo(() => [
    ...(pointsState.data ?? []).map((point) => ({ id: point.id, name: point.name, kind: point.kind })),
    ...(virtualPointsState.data ?? []).map((point) => ({ id: point.id, name: point.name ?? point.label, kind: 'virtual' })),
    ...outputsEntries(config).map((output) => ({ id: output.id, name: output.label, kind: output.kind }))
  ], [config, pointsState.data, virtualPointsState.data])
  const nameConflicts = useMemo(() => pointNameConflicts(namespaceEntries), [namespaceEntries])

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

  useEffect(() => {
    const first = errorFocusPath ?? Object.keys(tagErrors)[0]
    if (!first) return
    const location = pointFieldLocation(first)
    if (location?.collection === 'ao' && config.ao[location.index]) setSelectedId(config.ao[location.index].id)
    if (location?.collection === 'do' && config.do[location.index]) setSelectedId(config.do[location.index].id)
    const frame = window.requestAnimationFrame(() => focusPointField(Object.keys(tagErrors)))
    return () => window.cancelAnimationFrame(frame)
  }, [config.ao, config.do, errorFocusPath, tagErrors])

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

  async function saveOutputs(next = config, closeConfirm = false) {
    const recovery = outputsEntries(next).find((output) => output.id === selectedId)
    const recoveringName = Boolean(recovery && persistedNameConflicts.has(recovery.id))
    if (recoveringName && recovery) {
      const nameError = validatePointName(recovery.label)
      const errors = nameError ? { [`${recovery.kind.toLowerCase()}[${(recovery.kind === 'AO' ? next.ao : next.do).findIndex((item) => item.id === recovery.id)}].name`]: nameError } : {}
      setTagErrors(errors)
      setErrorFocusPath(Object.keys(errors)[0])
      if (nameError) return
    }
    const errors = outputTagErrors(next)
    if (!recoveringName) {
      setTagErrors(errors)
      setErrorFocusPath(Object.keys(errors)[0])
      if (Object.keys(errors).length > 0) return
    }
    const normalized = normalizeOutputs(next)
    setSaving(true)
    try {
      if (recoveringName && recovery) {
        const name = normalizePointName(recovery.label)
        await apiClient.updatePointName(recovery.id, name)
        setConfig({
          ao: next.ao.map((item) => item.id === recovery.id ? { ...item, label: name } : item),
          do: next.do.map((item) => item.id === recovery.id ? { ...item, label: name } : item)
        })
        void pointsState.refetch()
      } else {
        await apiClient.putOutputs(normalized)
        setConfig(normalized)
      }
      setTagErrors({})
      setErrorFocusPath(undefined)
      toast.push('success', t('outputsSaveSuccess'))
      if (closeConfirm) {
        setConfirmOpen(false)
        setTab('advanced')
      }
    } catch (error) {
      const fieldErrors = pointTagFieldErrors(error)
      setTagErrors(fieldErrors)
      setErrorFocusPath(pointFieldFocusPath(error, recovery?.id ?? selectedId, ['ao', 'do']) ?? Object.keys(fieldErrors)[0])
      toast.push('error', `${t('outputsSaveError')}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  async function forceSelected(release = false) {
    if (!selected) return
    setSaving(true)
    try {
      const value = selected.kind === 'AO' ? clampNumber(selected.manualValue, 0, 100, true) : selected.manualValue
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
        <div className="flex gap-2">
          <Button icon={<LayoutGrid className="h-4 w-4" />} disabled={loading || outputs.length === 0} onClick={() => setOverviewOpen(true)}>{pick('Tổng quan', 'Overview')}</Button>
          <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={saving} onClick={() => setConfirmOpen(true)} disabled={loading || outputs.length === 0}>
            {t('save')}
          </Button>
        </div>
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
              <OutputBasics
                output={selected}
                rawValue={findOutputPoint(pointsState.data ?? [], selected)?.raw}
                rawUnit={findOutputPoint(pointsState.data ?? [], selected)?.rawUnit ?? (selected.kind === 'AO' ? aoSafeUnit(selected.mode) : undefined)}
                tagError={tagErrors[outputTagPath(config, selected)]}
                nameError={tagErrors[outputTagPath(config, selected).replace('.tag', '.name')]}
                onChange={(patch) => updateOutput(selected.id, patch)}
              />
              <PointNameConflictNotice pointId={selected.id} conflictIds={nameConflicts.get(selected.id)} />
              <PointLoggingSection pointId={selected.id} label={selected.label} kind={selected.kind} />
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
        onConfirm={() => { void saveOutputs(config, true) }}
        onClose={() => setConfirmOpen(false)}
      >
        {pick('Bạn có muốn lưu thay đổi không?', 'Do you want to save the changes?')}
      </Modal>
      <OutputsOverviewModal
        open={overviewOpen}
        outputs={outputs}
        livePoints={pointsState.data ?? []}
        onEdit={(id) => {
          setSelectedId(id)
          setWizardIndex(0)
          setTab('advanced')
          setOverviewOpen(false)
        }}
        onClose={() => setOverviewOpen(false)}
      />
    </div>
  )
}

function OutputsOverviewModal({ open, outputs, livePoints, onEdit, onClose }: { open: boolean; outputs: OutputConfig[]; livePoints: Point[]; onEdit: (id: string) => void; onClose: () => void }) {
  const { pick } = useI18n()
  return (
    <Modal open={open} size="xl" title={pick('Tổng quan Outputs', 'Outputs Overview')} onClose={onClose}>
      <div className="max-h-[70vh] overflow-auto rounded-[var(--radius)] border border-[var(--c-border)]">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--c-surface-2)] text-xs uppercase text-[var(--c-text-dim)]">
            <tr>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-left">Ch</th>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-left">Tag / Name</th>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-left">Kind</th>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-left">Mode</th>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-left">Value</th>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-left">Safe</th>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-right" />
            </tr>
          </thead>
          <tbody>
            {outputs.map((output) => {
              const live = findOutputPoint(livePoints, output)
              const unit = live?.unit ?? (output.kind === 'AO' ? engineeringUnitLabel(output.units) : '')
              return (
                <tr key={output.id} className="border-t border-[var(--c-border)] hover:bg-[var(--c-surface-2)]">
                  <td className="px-3 py-2 font-mono text-xs">{output.kind === 'AO' ? 16 + output.channel : 20 + output.channel}</td>
                  <td className="px-3 py-2">
                    <span className="block font-semibold text-[var(--c-text)]">{output.id}</span>
                    <span className="block text-xs text-[var(--c-text-dim)]">{output.label}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{output.kind}</td>
                  <td className="px-3 py-2 text-xs">{output.kind === 'AO' ? output.mode : 'Digital'}</td>
                  <td className="px-3 py-2">
                    <span className="font-mono font-semibold">{live ? formatValue(live.value, unit) : '--'}</span>
                    <span className="ml-2 text-xs text-[var(--c-text-dim)]">{live?.quality ?? '--'}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {output.kind === 'AO' ? output.safeValue : output.safeState}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => onEdit(output.id)}>{pick('Sửa', 'Edit')}</Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}

function OutputBasics({ output, rawValue, rawUnit, tagError, nameError, onChange }: { output: OutputConfig; rawValue?: number; rawUnit?: string; tagError?: string; nameError?: string; onChange: (patch: Partial<AoConfig> | Partial<DoConfig>) => void }) {
  const isAo = output.kind === 'AO'
  return (
    <div className={isAo ? 'grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_120px_140px]' : 'grid gap-4 md:grid-cols-3'}>
      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">Tag</span>
        <input
          aria-invalid={Boolean(tagError)}
          aria-describedby={tagError ? `${output.id}-tag-error` : undefined}
          className={`${controlClass()} bg-[var(--c-surface-2)] text-[var(--c-text-dim)]`}
          data-point-field={`${output.kind.toLowerCase()}[${output.channel - 1}].tag`}
          value={output.id}
          readOnly
        />
        {tagError && <span id={`${output.id}-tag-error`} role="alert" className="block text-xs text-[var(--c-fault-fg)]">{tagError}</span>}
      </label>
      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">Channel</span>
        <input className={`${controlClass()} bg-[var(--c-surface-2)] font-mono text-[var(--c-text-dim)]`} value={output.kind === 'AO' ? 16 + output.channel : 20 + output.channel} readOnly />
      </label>
      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">Label</span>
        <input data-point-field={`${output.kind.toLowerCase()}[${output.channel - 1}].name`} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? `${output.id}-name-error` : undefined} className={controlClass()} value={output.label} onChange={(event) => onChange({ label: event.target.value })} />
        {nameError && <span id={`${output.id}-name-error`} role="alert" className="block text-xs text-[var(--c-fault-fg)]">{nameError}</span>}
      </label>
      {isAo && (
        <div className="space-y-1">
          <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">Mode</span>
          <div className="flex h-10 items-center rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 font-mono text-sm text-[var(--c-text-dim)]">
            {output.mode}
          </div>
        </div>
      )}
      {isAo && (
        <div className="space-y-1">
          <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">Raw</span>
          <div className="flex h-10 items-center rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 font-mono text-sm text-[var(--c-text-dim)]">
            {typeof rawValue === 'number' && rawUnit ? formatStat(rawValue, rawUnit) : '--'}
          </div>
        </div>
      )}
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
  const unit = point?.unit ?? (output.kind === 'AO' ? engineeringUnitLabel(output.units) : '')
  const modeRawUnit = output.kind === 'AO' ? aoSafeUnit(output.mode) : undefined
  const rawOutput = output.kind === 'AO' && typeof point?.raw === 'number'
    ? { value: point.raw, unit: point.rawUnit ?? modeRawUnit ?? '' }
    : undefined

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
            {output.kind === 'AO' && <LiveDataItem label="Raw output" value={rawOutput ? formatStat(rawOutput.value, rawOutput.unit) : '--'} />}
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
          <TrendChart data={data} height={250} series={[{ key: output.id, label: output.label, color: 'var(--c-accent)', unit }]} rawUnit={modeRawUnit} />
        </section>
      </div>

      <section className="space-y-4 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
        <h3 className="text-sm font-semibold text-[var(--c-text)]">{t('outputsManual')}</h3>
        {output.kind === 'AO' ? (
          <NumberField label="Analog output manual value (%)" value={output.manualValue} min={0} max={100} step={1} integer onChange={(manualValue) => onChange({ manualValue })} wired />
        ) : (
          <SelectField label="DO SP" value={output.manualValue ? '1' : '0'} options={[['0', 'OFF'], ['1', 'ON']]} onChange={(value) => onChange({ manualValue: value === '1' })} wired />
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="primary" icon={<Power className="h-4 w-4" />} loading={saving} onClick={onForce}>{t('force')}</Button>
          <Button icon={<RotateCcw className="h-4 w-4" />} loading={saving} onClick={onRelease}>{pick('Gỡ', 'Release')}</Button>
        </div>
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
    ? ['mode', 'units', 'minPv', 'maxPv', 'safeValue', 'manualValue'] as Array<keyof AoConfig>
    : ['safeState', 'manualValue'] as Array<keyof DoConfig>

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
          <span className="rounded-[var(--radius)] border border-[var(--c-good)] bg-[var(--c-good-bg)] px-2 py-1 text-center text-[10px] font-bold uppercase text-[var(--c-good-fg)]">
            wired
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
    if (key === 'mode') return <SelectField label={label} value={ao.mode} options={[['0-10V', '0-10V'], ['4-20mA', '4-20mA']]} onChange={(mode) => {
      const nextMode = mode as AoSignalMode
      onChange({ mode: nextMode, safeValue: clampNumber(ao.safeValue, 0, aoSafeMax(nextMode)) })
    }} wired large={large} />
    if (key === 'units') return <SelectField label={label} value={ao.units} options={aoEngineeringUnits.map((unit) => [unit, engineeringUnitLabel(unit)])} onChange={(units) => onChange({ units: units as AoEngineeringUnit })} wired large={large} />
    if (key === 'minPv') return <NumberField label={`${label} (${engineeringUnitLabel(ao.units)})`} value={ao.minPv} min={-999999} max={ao.maxPv - 0.001} step={0.1} onChange={(minPv) => onChange({ minPv })} wired large={large} />
    if (key === 'maxPv') return <NumberField label={`${label} (${engineeringUnitLabel(ao.units)})`} value={ao.maxPv} min={ao.minPv + 0.001} max={999999} step={0.1} onChange={(maxPv) => onChange({ maxPv })} wired large={large} />
    if (key === 'safeValue') return <NumberField label={`${label} (${aoSafeUnit(ao.mode)})`} value={ao.safeValue} min={0} max={aoSafeMax(ao.mode)} step={0.1} onChange={(safeValue) => onChange({ safeValue })} wired large={large} />
    if (key === 'manualValue') return <NumberField label={label} value={ao.manualValue} min={0} max={100} step={1} integer onChange={(manualValue) => onChange({ manualValue })} wired large={large} />
    return null
  }
  const digital = output
  if (key === 'safeState') return <SelectField label={label} value={digital.safeState} options={[['open', 'open'], ['closed', 'closed']]} onChange={(safeState) => onChange({ safeState: safeState as DoSafeState })} wired large={large} />
  if (key === 'manualValue') return <SelectField label={label} value={digital.manualValue ? '1' : '0'} options={[['0', 'OFF'], ['1', 'ON']]} onChange={(manualValue) => onChange({ manualValue: manualValue === '1' })} wired large={large} />
  return null
}

function NumberField({ label, value, min, max, step = 1, integer, wired, large, onChange }: { label: string; value: number; min: number; max: number; step?: number; integer?: boolean; wired?: boolean; large?: boolean; onChange: (value: number) => void }) {
  return (
    <label className={large ? 'block space-y-2' : 'block'}>
      {large && <FieldHeader label={label} wired={wired} />}
      <input className={controlClass()} type="number" min={min} max={max} step={step} value={clampNumber(value, min, max, integer)} onChange={(event) => onChange(clampNumber(event.currentTarget.valueAsNumber, min, max, integer))} />
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
    </label>
  )
}

function FieldHeader({ label, wired }: { label: string; wired?: boolean }) {
  return (
    <span className="flex items-center gap-2 text-sm font-semibold text-[var(--c-text)]">
      {label}
      {wired && <span className="rounded-[var(--radius)] border border-[var(--c-good)] px-2 py-0.5 text-[10px] uppercase text-[var(--c-good-fg)]">wired</span>}
    </span>
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
      const existing = current[pointId] ?? []
      return { ...current, [pointId]: [...existing, { time, raw: value, [pointId]: value, __raw: point.raw ?? null }].slice(-outputTrendLimit) }
    })
  }, [pointId, point])

  function reset() {
    setBuffers((current) => ({ ...current, [pointId]: [] }))
  }

  return { data: buffers[pointId] ?? [], reset }
}

function findOutputPoint(points: Point[], output: OutputConfig): Point | undefined {
  const ids = new Set([output.id, output.id.replace('-', ''), `${output.kind}${output.channel}`].map((id) => id.toUpperCase()))
  return points.find((point) => point.kind === output.kind && ids.has(point.id.trim().toUpperCase()))
}

function formatStat(value: number, unit?: string): string {
  const fixed = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)
  return `${fixed}${unit ? ` ${unit}` : ''}`
}

function outputTagErrors(outputs: OutputsConfig): Record<string, string> {
  const errors = (kind: 'ao' | 'do', rows: OutputConfig[]) => rows.flatMap((output, index) => {
    const tagError = validatePointTag(output.id)
    const nameError = validatePointName(output.label)
    return [
      ...(tagError ? [[`${kind}[${index}].tag`, tagError]] : []),
      ...(nameError ? [[`${kind}[${index}].name`, nameError]] : [])
    ]
  })
  return Object.fromEntries([...errors('ao', outputs.ao), ...errors('do', outputs.do)])
}

function outputTagPath(outputs: OutputsConfig, output: OutputConfig): string {
  const items = output.kind === 'AO' ? outputs.ao : outputs.do
  return `${output.kind.toLowerCase()}[${items.findIndex((item) => item.id === output.id)}].tag`
}

function normalizeOutputs(outputs: OutputsConfig): OutputsConfig {
  return {
    ao: outputs.ao.map((ao) => ({
      ...ao,
      tag: ao.id,
      label: displayPointName(normalizePointName(ao.label), ao.id),
      minPv: clampNumber(ao.minPv, -999999, ao.maxPv - 0.001),
      maxPv: clampNumber(ao.maxPv, ao.minPv + 0.001, 999999),
      safeValue: clampNumber(ao.safeValue, 0, aoSafeMax(ao.mode)),
      manualValue: clampNumber(ao.manualValue, 0, 100, true)
    })),
    do: outputs.do.map((output) => ({ ...output, tag: output.id, label: displayPointName(normalizePointName(output.label), output.id) }))
  }
}

function outputsEntries(config: OutputsConfig): OutputConfig[] {
  return [...config.ao, ...config.do]
}

function aoSafeUnit(mode: AoSignalMode): string {
  return mode === '4-20mA' ? 'mA' : 'V'
}

function aoSafeMax(mode: AoSignalMode): number {
  return mode === '4-20mA' ? 20 : 10
}

function clampNumber(value: number, min: number, max: number, integer = false): number {
  const finite = Number.isFinite(value) ? value : min
  const clamped = Math.min(max, Math.max(min, finite))
  return integer ? Math.round(clamped) : clamped
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
    mode: 2,
    units: 4,
    minPv: 5,
    maxPv: 6
  }
  return map[String(key)] ?? 0
}

function fieldLabel(kind: OutputKind, key: keyof AoConfig | keyof DoConfig, _t: Translate): string {
  const labels: Record<string, string> = {
    mode: 'Output signal type',
    units: 'Engineering unit',
    minPv: 'Minimum present value',
    maxPv: 'Maximum present value',
    manualValue: kind === 'AO' ? 'Analog output manual value (%)' : 'Digital output manual value',
    safeValue: 'Safe value',
    safeState: 'Safe state'
  }
  return labels[String(key)] ?? String(key)
}

const aoEngineeringUnits: AoEngineeringUnit[] = ['percent', 'volt', 'milliampere', 'degC', 'Pa', 'RPM', 'ppm', 'no_units']

function engineeringUnitLabel(unit: AoEngineeringUnit): string {
  const labels: Record<AoEngineeringUnit, string> = {
    percent: '%',
    volt: 'V',
    milliampere: 'mA',
    degC: 'degC',
    Pa: 'Pa',
    RPM: 'RPM',
    ppm: 'ppm',
    no_units: 'No units'
  }
  return labels[unit]
}

function controlClass(): string {
  return 'h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]'
}
