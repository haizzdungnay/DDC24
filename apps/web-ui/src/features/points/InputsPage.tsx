import { Activity, ChevronLeft, ChevronRight, LayoutGrid, Pencil, Save, SlidersHorizontal, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { apiClient } from '../../shared/api/client'
import { displayPointName, focusPointField, normalizePointName, pointFieldFocusPath, pointFieldLocation, pointNameConflicts, pointTagFieldErrors, validatePointName, validatePointTag } from '../../shared/api/pointTags'
import { Button } from '../../shared/components/Button'
import { Modal } from '../../shared/components/Modal'
import { Panel } from '../../shared/components/Panel'
import { PointNameConflictNotice } from '../../shared/components/PointNameConflictNotice'
import { PointLoggingSection } from '../../shared/components/PointLoggingSection'
import { StateBlock } from '../../shared/components/StateBlock'
import { useToast } from '../../shared/components/Toast'
import { TrendChart } from '../../shared/components/TrendChart'
import { getDemoPoints } from '../../shared/demo/simulator'
import { useApi } from '../../shared/hooks/useApi'
import { useI18n } from '../../shared/i18n'
import { isDigitalContact, type AiInputConfig, type AiSignalType, type Point, type TrendSample } from '../../shared/types'
import { cn, formatValue, isVisibleUniversalInput, pointNumber, uiNode } from '../../shared/utils'

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
  /* FE-DATA-02 (review FE 2026-08-05): trước đây lỗi tải chỉ đi ra toast rồi
   * biến mất, còn trang thì hiện danh sách kênh rỗng — không phân biệt được
   * "chưa cấu hình kênh nào" với "không đọc được cấu hình". */
  const [loadError, setLoadError] = useState<Error | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [overviewOpen, setOverviewOpen] = useState(false)
  const [tagErrors, setTagErrors] = useState<Record<string, string>>({})
  const [errorFocusPath, setErrorFocusPath] = useState<string>()
  const pointsState = useApi(apiClient.getPoints, [], { refreshMs: 2000 })
  const virtualPointsState = useApi(apiClient.getVirtualPoints, [], { refreshMs: 2000 })
  const persistedNameConflicts = useMemo(() => pointNameConflicts([
    ...(pointsState.data ?? []).map((point) => ({ id: point.id, name: point.name, kind: point.kind })),
    ...(virtualPointsState.data ?? []).map((point) => ({ id: point.id, name: point.name ?? point.label, kind: 'virtual' }))
  ]), [pointsState.data, virtualPointsState.data])
  const namespaceEntries = useMemo(() => [
    ...(pointsState.data ?? []).map((point) => ({ id: point.id, name: point.name, kind: point.kind })),
    ...(virtualPointsState.data ?? []).map((point) => ({ id: point.id, name: point.name ?? point.label, kind: 'virtual' })),
    ...configs.map((config) => ({ id: aiNode(config.channel), name: config.label, kind: 'UI' }))
  ], [configs, pointsState.data, virtualPointsState.data])
  const nameConflicts = useMemo(() => pointNameConflicts(namespaceEntries), [namespaceEntries])

  useEffect(() => {
    let active = true
    setLoading(true)
    apiClient.getAiInputs()
      .then((items) => {
        if (!active) return
        setConfigs(items)
        setLoadError(null)
      })
      .catch((error) => {
        if (!active) return
        setLoadError(error instanceof Error ? error : new Error(String(error)))
        toast.push('error', `${t('error')}: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [reloadToken, t, toast])

  useEffect(() => {
    const first = errorFocusPath ?? Object.keys(tagErrors)[0]
    if (!first) return
    const location = pointFieldLocation(first)
    if (location?.collection === 'ui' && configs[location.index]) setSelectedChannel(configs[location.index].channel)
    const frame = window.requestAnimationFrame(() => focusPointField(Object.keys(tagErrors)))
    return () => window.cancelAnimationFrame(frame)
  }, [configs, errorFocusPath, tagErrors])

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
      const tagError = validatePointTag(aiNode(config.channel))
      const nameError = validatePointName(config.label)
      return [
        ...(tagError ? [[`ui[${index}].tag`, tagError]] : []),
        ...(nameError ? [[`ui[${index}].name`, nameError]] : [])
      ]
    }))
    setTagErrors(errors)
    setErrorFocusPath(Object.keys(errors)[0])
    return Object.keys(errors).length === 0
  }

  async function persistConfigs(nextConfigs: AiInputConfig[], closeConfirm = false) {
    const recoveryIndex = nextConfigs.findIndex((config) => config.channel === selectedChannel)
    const recoveryConfig = recoveryIndex >= 0 ? nextConfigs[recoveryIndex] : undefined
    const recoveryId = recoveryConfig ? aiNode(recoveryConfig.channel) : undefined
    const recoveringName = Boolean(recoveryId && persistedNameConflicts.has(recoveryId))
    if (recoveringName && recoveryConfig) {
      const nameError = validatePointName(recoveryConfig.label)
      const errors = nameError ? { [`ui[${recoveryIndex}].name`]: nameError } : {}
      setTagErrors(errors)
      setErrorFocusPath(Object.keys(errors)[0])
      if (nameError) return
    } else if (!validateTags(nextConfigs)) return
    setSaving(true)
    try {
      if (recoveringName && recoveryConfig && recoveryId) {
        const name = normalizePointName(recoveryConfig.label)
        await apiClient.updatePointName(recoveryId, name)
        setConfigs(nextConfigs.map((config) => config.channel === recoveryConfig.channel ? { ...config, label: name } : config))
        void pointsState.refetch()
      } else {
        const normalized = nextConfigs.map((config) => ({ ...config, tag: aiNode(config.channel), label: displayPointName(normalizePointName(config.label), aiNode(config.channel)) }))
        await apiClient.putAiInputs(normalized)
        setConfigs(normalized)
      }
      setTagErrors({})
      setErrorFocusPath(undefined)
      toast.push('success', t('saveSuccess'))
      if (closeConfirm) {
        setConfirmOpen(false)
        setViewMode('advanced')
      }
    } catch (error) {
      const errors = pointTagFieldErrors(error)
      setTagErrors(errors)
      setErrorFocusPath(pointFieldFocusPath(error, recoveryId ?? aiNode(selectedChannel), ['ui']) ?? Object.keys(errors)[0])
      toast.push('error', `${t('saveError')}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  function confirmSave() {
    void persistConfigs(configs, true)
  }

  function saveConfigs(nextConfigs = configs) {
    void persistConfigs(nextConfigs)
  }

  // FE-DATA-02: chỉ chặn khi KHÔNG có gì trong tay; hỏng giữa chừng vẫn giữ bảng.
  if (loadError && configs.length === 0) {
    return (
      <StateBlock
        state="error"
        title={pick('Không tải được cấu hình ngõ vào', 'Could not load input configuration')}
        detail={loadError.message}
        onRetry={() => setReloadToken((token) => token + 1)}
      />
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--c-text)]">{t('aiConfigTitle')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{t('aiConfigSubtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button icon={<LayoutGrid className="h-4 w-4" />} disabled={loading || configs.length === 0} onClick={() => setOverviewOpen(true)}>{pick('Tổng quan', 'Overview')}</Button>
          <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={saving} onClick={requestSave} disabled={loading || configs.length === 0}>
            {t('save')}
          </Button>
        </div>
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
                rawValue={findAiPoint(pointsState.data ?? [], selected.channel)?.raw}
                rawUnit={findAiPoint(pointsState.data ?? [], selected.channel)?.rawUnit}
                tagError={tagErrors[`ui[${configs.findIndex((config) => config.channel === selected.channel)}].tag`]}
                nameError={tagErrors[`ui[${configs.findIndex((config) => config.channel === selected.channel)}].name`]}
                onChange={(patch) => updateChannel(selected.channel, patch)}
              />
              <PointNameConflictNotice pointId={aiNode(selected.channel)} conflictIds={nameConflicts.get(aiNode(selected.channel))} />
              <PointLoggingSection pointId={aiNode(selected.channel)} label={selected.label} kind="UI" />
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
      <InputsOverviewModal
        open={overviewOpen}
        configs={configs}
        livePoints={pointsState.data ?? []}
        onEdit={(channel) => {
          setSelectedChannel(channel)
          setWizardIndex(0)
          setViewMode('advanced')
          setOverviewOpen(false)
        }}
        onClose={() => setOverviewOpen(false)}
      />
    </div>
  )
}

function InputsOverviewModal({ open, configs, livePoints, onEdit, onClose }: { open: boolean; configs: AiInputConfig[]; livePoints: Point[]; onEdit: (channel: number) => void; onClose: () => void }) {
  const { t, pick } = useI18n()
  return (
    <Modal open={open} size="xl" title={pick('Tổng quan UI', 'UI Overview')} onClose={onClose}>
      <div className="max-h-[70vh] overflow-auto rounded-[var(--radius)] border border-[var(--c-border)]">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--c-surface-2)] text-xs uppercase text-[var(--c-text-dim)]">
            <tr>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-left">Ch</th>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-left">Tag / Name</th>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-left">Signal</th>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-left">Value</th>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-left">Unit</th>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-left">Range</th>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-left">Enabled</th>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-right" />
            </tr>
          </thead>
          <tbody>
            {configs.map((config) => {
              const live = findAiPoint(livePoints, config.channel)
              return (
                <tr key={config.channel} className="border-t border-[var(--c-border)] hover:bg-[var(--c-surface-2)]">
                  <td className="px-3 py-2 font-mono text-xs">{String(config.channel).padStart(2, '0')}</td>
                  <td className="px-3 py-2">
                    <span className="block font-semibold text-[var(--c-text)]">{aiNode(config.channel)}</span>
                    <span className="block text-xs text-[var(--c-text-dim)]">{config.label}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">{signalLabel(config.signalType, t)}</td>
                  <td className="px-3 py-2">
                    <span className="font-mono font-semibold">{live ? formatValue(live.value, live.unit) : '--'}</span>
                    <span className="ml-2 text-xs text-[var(--c-text-dim)]">{live?.quality ?? '--'}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">{unitLabel(config.unit, t)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{config.displayMin}–{config.displayMax}</td>
                  <td className="px-3 py-2 text-xs">
                    <span className={config.enabled ? 'text-[var(--c-good-fg)]' : 'text-[var(--c-text-dim)]'}>{config.enabled ? 'EN' : 'OFF'}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => onEdit(config.channel)}>{pick('Sửa', 'Edit')}</Button>
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
  const rawCell = !booleanInput && typeof point?.raw === 'number' && point?.rawUnit
    ? { value: point.raw, unit: point.rawUnit }
    : undefined

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
            {rawCell && <LiveDataItem label={t('rawValue')} value={formatStat(rawCell.value, rawCell.unit)} />}
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
            rawUnit={rawCell?.unit}
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
    // Chưa có số đo thì BỎ QUA mẫu, không ghi 0 vào đuôi biểu đồ (REV-FE-04).
    if (value === null) return
    const time = new Date(point.updatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setBuffers((current) => {
      const existing = current[pointId] ?? []
      const last = existing[existing.length - 1]
      if (last && last.time === time && last.raw === value) return current
      const next = [...existing, { time, raw: value, [pointId]: value, __raw: point.raw ?? null }].slice(-60)
      return { ...current, [pointId]: next }
    })
  }, [pointId, point])

  function reset() {
    const value = point ? pointNumber(point) : null
    if (!point || value === null) {
      setBuffers((current) => ({ ...current, [pointId]: [] }))
      return
    }
    const time = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setBuffers((current) => ({ ...current, [pointId]: [{ time, raw: value, [pointId]: value, __raw: point.raw ?? null }] }))
  }

  return { data: buffers[pointId] ?? [], reset }
}

function formatStat(value: number, unit?: string): string {
  const fixed = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)
  return `${fixed}${unit ? ` ${unit}` : ''}`
}

function formatLiveValue(point: Point, unit: string | undefined, booleanInput: boolean): string {
  if (booleanInput) {
    const value = pointNumber(point)
    return value === null ? formatValue(undefined) : formatValue(value > 0.5, undefined)
  }
  return formatValue(point.value, unit)
}

function ChannelBasics({ config, rawValue, rawUnit, tagError, nameError, onChange }: { config: AiInputConfig; rawValue?: number; rawUnit?: string; tagError?: string; nameError?: string; onChange: (patch: Partial<AiInputConfig>) => void }) {
  const { t } = useI18n()
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)_180px_120px]">
      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">Tag</span>
        <input
          aria-invalid={Boolean(tagError)}
          aria-describedby={tagError ? `ui-${config.channel}-tag-error` : undefined}
          className="h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-sm text-[var(--c-text-dim)]"
          data-point-field={`ui[${config.channel - 1}].tag`}
          value={aiNode(config.channel)}
          readOnly
        />
        {tagError && <span id={`ui-${config.channel}-tag-error`} role="alert" className="block text-xs text-[var(--c-fault-fg)]">{tagError}</span>}
      </label>
      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{t('channelLabel')}</span>
        <input className="h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 font-mono text-sm text-[var(--c-text-dim)]" value={config.channel} readOnly />
      </label>
      <label className="space-y-1">
        <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">Label</span>
        <input
          aria-invalid={Boolean(nameError)}
          aria-describedby={nameError ? `ui-${config.channel}-name-error` : undefined}
          className="h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
          data-point-field={`ui[${config.channel - 1}].name`}
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
      {typeof rawValue === 'number' && rawUnit && (
        <div className="space-y-1">
          <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">Raw</span>
          <div className="flex h-10 items-center rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 font-mono text-sm text-[var(--c-text-dim)]">
            {formatStat(rawValue, rawUnit)}
          </div>
        </div>
      )}
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
    { register: 'u4', name: t('unitsLabel'), wired: true, control: <UnitSelect value={config.unit} signalType={config.signalType} onChange={(unit) => onChange({ unit })} /> },
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

function UnitField({ value, onChange, signalType }: { value: number; onChange: (value: number) => void; signalType?: AiSignalType }) {
  const { t } = useI18n()
  return (
    <div className="space-y-3">
      <FieldHeader label={t('unitsLabel')} wired />
      <UnitSelect value={value} signalType={signalType} onChange={onChange} />
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

function UnitSelect({ value, onChange, signalType }: { value: number; onChange: (value: number) => void; signalType?: AiSignalType }) {
  const { t } = useI18n()
  const availableUnits = signalType === 0 ? [0] : unitOptions
  return (
    <select className={controlClass()} value={value} onChange={(event) => onChange(Number(event.target.value))}>
      {availableUnits.map((option) => <option key={option} value={option}>{unitLabel(option, t)}</option>)}
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
    <span className={cn('rounded-[var(--radius)] border px-2 py-0.5 text-center text-[10px] font-bold uppercase', wired ? 'border-[var(--c-good)] bg-[var(--c-good-bg)] text-[var(--c-good-fg)]' : 'border-[var(--c-border)] bg-[var(--c-surface-2)] text-[var(--c-text-dim)]')}>
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
