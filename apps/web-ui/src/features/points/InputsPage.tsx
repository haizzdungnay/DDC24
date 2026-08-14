import { Activity, ChevronLeft, ChevronRight, LayoutGrid, Pencil, Plus, Save, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient, unitToIo } from '../../shared/api/client'
import { displayPointName, focusPointField, normalizePointName, pointFieldFocusPath, pointFieldLocation, pointNameConflicts, pointTagFieldErrors, validatePointName, validatePointTag } from '../../shared/api/pointTags'
import { Button } from '../../shared/components/Button'
import { Modal } from '../../shared/components/Modal'
import { Panel } from '../../shared/components/Panel'
import { PointNameConflictNotice } from '../../shared/components/PointNameConflictNotice'
import { PointLoggingSection } from '../../shared/components/PointLoggingSection'
import { StateBlock } from '../../shared/components/StateBlock'
import { StatusBadge } from '../../shared/components/StatusBadge'
import { useToast } from '../../shared/components/Toast'
import { TrendChart } from '../../shared/components/TrendChart'
import { IS_DEMO } from '../../shared/config'
import { getDemoPoints } from '../../shared/demo/simulator'
import { useApi } from '../../shared/hooks/useApi'
import { useI18n } from '../../shared/i18n'
import { isDigitalContact, type AiInputConfig, type AiSignalType, type AlarmSetting, type Point, type TrendSample } from '../../shared/types'
import { clamp, cn, formatDataAge, formatTime, formatValue, isVisibleUniversalInput, NO_DATA, pointNumber, uiNode } from '../../shared/utils'

type TabKey = 'electrical' | 'scaling' | 'signal' | 'calibration' | 'alarmStorage' | 'diagnostics'
type ElectricalMode = 'none' | 'volt' | 'voltCurrent' | 'resistance' | 'dry' | 'potentiometer' | 'light' | 'pulse'
type Translate = ReturnType<typeof useI18n>['t']
type PickText = ReturnType<typeof useI18n>['pick']
type LiveTrendSample = TrendSample & { raw: number }

const tabOrder: TabKey[] = ['electrical', 'scaling', 'signal', 'calibration', 'alarmStorage', 'diagnostics']
const electricalModes: ElectricalMode[] = ['none', 'volt', 'voltCurrent', 'resistance', 'dry', 'potentiometer', 'light', 'pulse']
const sensorProfiles = ['NTC10k', 'NTC20k'] as const
const rangeMultiplierOptions = [0, 1, 2, 3, 4, 5]
const mathFunctionOptions = [0, 1, 2, 3]

export function InputsPage() {
  const { t, pick } = useI18n()
  const toast = useToast()
  const navigate = useNavigate()
  const [configs, setConfigs] = useState<AiInputConfig[]>([])
  const [selectedChannel, setSelectedChannel] = useState(1)
  const [activeTab, setActiveTab] = useState<TabKey>('electrical')
  const [wizardActive, setWizardActive] = useState(false)
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
  const alarmsState = useApi(apiClient.getAlarmSettings, [])
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
  const wizardEligible = Boolean(selected && selected.signalType === 0 && !selected.enabled)

  // SRC-F-04: chỉ rơi về điểm demo khi đang CHẠY demo.
  //
  // Trước đây nhánh này chạy cả ở bản live: kênh nào không có điểm thật —
  // vì core chết, vì kênh chưa cấu hình, vì API lỗi — sẽ mượn một điểm demo
  // và trang hiện giá trị, đơn vị, biểu đồ xu hướng như thể đo được thật.
  // Đó là kiểu hỏng tệ nhất cho màn hình vận hành: nó không báo lỗi, nó bịa
  // ra một hiện thực bình thường. Cùng lớp lỗi FE-DIAG-01 (2026-08-06).
  // Ở live, không có điểm thì `point` để undefined và các ô hiện trạng thái
  // trống — người trực thấy ngay là chưa có dữ liệu.
  const livePoint = selected ? findAiPoint(pointsState.data ?? [], selected.channel) : undefined
  const demoPoint = selected && !livePoint && IS_DEMO ? findAiPoint(getDemoPoints(), selected.channel) : undefined
  const point = livePoint ?? demoPoint

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
        setWizardActive(false)
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

  function goToAddAlarm(channel: number) {
    navigate(`/eng/alarm-settings?newSource=UI:${channel}`)
  }

  function goToEditAlarm(id: string) {
    navigate(`/eng/alarm-settings?edit=${encodeURIComponent(id)}`)
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

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Panel className="min-w-0" title="UI Channels">
          <div className="flex flex-col gap-1 max-h-[calc(100vh-250px)] overflow-y-auto pr-2">
            {configs.map((config) => (
              <button
                key={config.channel}
                type="button"
                onClick={() => {
                  setSelectedChannel(config.channel)
                  setWizardActive(false)
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
          className="min-w-0 [&>div:first-child]:flex-wrap"
          title={selected ? `${aiNode(selected.channel)} - ${selected.label}` : t('empty')}
          action={
            selected && wizardEligible && !wizardActive ? (
              <Button icon={<Wand2 className="h-4 w-4" />} onClick={() => { setWizardActive(true); setActiveTab('electrical') }}>{t('quickSetup')}</Button>
            ) : undefined
          }
        >
          {selected && (
            <div className="space-y-5">
              <ChannelHeader
                config={selected}
                point={point}
                tagError={tagErrors[`ui[${configs.findIndex((config) => config.channel === selected.channel)}].tag`]}
                nameError={tagErrors[`ui[${configs.findIndex((config) => config.channel === selected.channel)}].name`]}
                onChange={(patch) => updateChannel(selected.channel, patch)}
              />
              <PointNameConflictNotice pointId={aiNode(selected.channel)} conflictIds={nameConflicts.get(aiNode(selected.channel))} />

              {wizardActive && (
                <WizardProgress
                  index={tabOrder.indexOf(activeTab)}
                  count={tabOrder.length}
                  onPrevious={() => setActiveTab(tabOrder[Math.max(tabOrder.indexOf(activeTab) - 1, 0)])}
                  onNext={() => setActiveTab(tabOrder[Math.min(tabOrder.indexOf(activeTab) + 1, tabOrder.length - 1)])}
                  onFinish={requestSave}
                  onExit={() => setWizardActive(false)}
                />
              )}

              <TabBar activeTab={activeTab} onSelect={setActiveTab} t={t} />

              {activeTab === 'electrical' && <ElectricalModeTab config={selected} onChange={(patch) => updateChannel(selected.channel, patch)} />}
              {activeTab === 'scaling' && <ScalingTab config={selected} onChange={(patch) => updateChannel(selected.channel, patch)} />}
              {activeTab === 'signal' && <SignalConditioningTab config={selected} configs={configs} onChange={(patch) => updateChannel(selected.channel, patch)} />}
              {activeTab === 'calibration' && <CalibrationTab config={selected} point={point} onChange={(patch) => updateChannel(selected.channel, patch)} />}
              {activeTab === 'alarmStorage' && (
                <AlarmStorageTab
                  config={selected}
                  alarms={alarmsState.data ?? []}
                  loading={alarmsState.loading}
                  error={Boolean(alarmsState.error)}
                  onAddAlarm={() => goToAddAlarm(selected.channel)}
                  onEditAlarm={goToEditAlarm}
                />
              )}
              {activeTab === 'diagnostics' && (
                <DiagnosticsTab
                  config={selected}
                  configs={configs}
                  point={point}
                  onChange={(patch) => updateChannel(selected.channel, patch)}
                  onSave={(nextConfigs) => { void saveConfigs(nextConfigs) }}
                  saving={saving}
                />
              )}

              <RegisterReferenceDetails config={selected} />
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
          setWizardActive(false)
          setActiveTab('electrical')
          setOverviewOpen(false)
        }}
        onClose={() => setOverviewOpen(false)}
      />
    </div>
  )
}

function InputsOverviewModal({ open, configs, livePoints, onEdit, onClose }: { open: boolean; configs: AiInputConfig[]; livePoints: Point[]; onEdit: (channel: number) => void; onClose: () => void }) {
  const { pick } = useI18n()
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
                  <td className="px-3 py-2 text-xs">{electricalSummary(config, pick)}</td>
                  <td className="px-3 py-2">
                    <span className="font-mono font-semibold">{live ? formatValue(live.value, live.unit) : '--'}</span>
                    <span className="ml-2 text-xs text-[var(--c-text-dim)]">{live?.quality ?? '--'}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">{engineeringUnitLabel(config.unit, pick)}</td>
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

function ChannelHeader({ config, point, tagError, nameError, onChange }: { config: AiInputConfig; point?: Point; tagError?: string; nameError?: string; onChange: (patch: Partial<AiInputConfig>) => void }) {
  const { t, pick } = useI18n()
  const booleanInput = isDigitalContact(config.signalType) || typeof point?.value === 'boolean'
  const unit = point?.unit
  const rawCell = !booleanInput && typeof point?.raw === 'number' && point?.rawUnit ? { value: point.raw, unit: point.rawUnit } : undefined
  return (
    <div className="space-y-3 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)_120px]">
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
      </div>
      <div className="flex flex-wrap items-center gap-4 border-t border-[var(--c-border)] pt-3 text-sm">
        {point ? <StatusBadge state={point.quality} /> : <span className="text-xs font-semibold text-[var(--c-text-dim)]">{NO_DATA}</span>}
        <span>
          <span className="text-xs uppercase text-[var(--c-text-dim)]">{pick('Giá trị', 'Value')}: </span>
          <span className="font-mono font-semibold text-[var(--c-text)]">{point ? formatLiveValue(point, unit, booleanInput) : NO_DATA}</span>
        </span>
        {rawCell && (
          <span>
            <span className="text-xs uppercase text-[var(--c-text-dim)]">{t('rawValue')}: </span>
            <span className="font-mono text-[var(--c-text)]">{formatStat(rawCell.value, rawCell.unit)}</span>
          </span>
        )}
        <span className="text-xs text-[var(--c-text-dim)]">{pick('Cập nhật', 'Updated')}: {updatedAgoLabel(point, pick)}</span>
      </div>
    </div>
  )
}

function TabBar({ activeTab, onSelect, t }: { activeTab: TabKey; onSelect: (tab: TabKey) => void; t: Translate }) {
  return (
    <div className="flex flex-wrap gap-1 overflow-x-auto border-b border-[var(--c-border)]">
      {tabOrder.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onSelect(tab)}
          className={cn(
            'whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition',
            activeTab === tab
              ? 'border-[var(--c-accent)] text-[var(--c-text)]'
              : 'border-transparent text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
          )}
        >
          {tabLabel(tab, t)}
        </button>
      ))}
    </div>
  )
}

function WizardProgress({ index, count, onPrevious, onNext, onFinish, onExit }: {
  index: number
  count: number
  onPrevious: () => void
  onNext: () => void
  onFinish: () => void
  onExit: () => void
}) {
  const { t, pick } = useI18n()
  const atEnd = index === count - 1
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-[var(--c-accent)] bg-[var(--c-surface-2)] px-3 py-2">
      <div className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{index + 1} / {count}</div>
      <div className="h-2 min-w-24 flex-1 rounded-full bg-[var(--c-bg)]">
        <div className="h-2 rounded-full bg-[var(--c-accent)]" style={{ width: `${((index + 1) / count) * 100}%` }} />
      </div>
      <Button size="sm" icon={<ChevronLeft className="h-4 w-4" />} onClick={onPrevious} disabled={index === 0}>{t('previous')}</Button>
      <Button size="sm" variant="primary" icon={!atEnd ? <ChevronRight className="h-4 w-4" /> : undefined} onClick={atEnd ? onFinish : onNext}>
        {atEnd ? t('finish') : t('next')}
      </Button>
      <Button size="sm" onClick={onExit}>{pick('Thoát', 'Exit')}</Button>
    </div>
  )
}

function ElectricalModeTab({ config, onChange }: { config: AiInputConfig; onChange: (patch: Partial<AiInputConfig>) => void }) {
  const { pick } = useI18n()
  const mode = electricalModeOf(config.signalType)
  const sensorProfile = sensorProfileOf(config.ioType)

  function selectMode(next: ElectricalMode) {
    const signalType = electricalModeToSignalType(next, config.signalType)
    onChange(signalTypePatch(signalType, config.analogCurrent))
  }

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-[var(--c-text)]">{pick('Electrical Mode', 'Electrical Mode')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {electricalModes.map((item) => (
            <label key={item} className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 py-2 text-sm text-[var(--c-text)]">
              <input
                type="radio"
                className="h-4 w-4 accent-[var(--c-accent)]"
                name={`electrical-mode-${config.channel}`}
                checked={mode === item}
                onChange={() => selectMode(item)}
              />
              {electricalModeLabel(item, pick)}
            </label>
          ))}
        </div>
      </fieldset>

      {mode === 'voltCurrent' && (
        <label className="block max-w-xs space-y-2">
          <span className="text-sm font-semibold text-[var(--c-text)]">{pick('Chế độ tín hiệu', 'Signal mode')}</span>
          <SignalModeSelect value={Boolean(config.analogCurrent)} onChange={(analogCurrent) => onChange({ analogCurrent })} />
        </label>
      )}

      {mode === 'resistance' && (
        <div className="space-y-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-3">
          <span className="text-sm font-semibold text-[var(--c-text)]">{pick('Sensor Profile', 'Sensor Profile')}</span>
          <div className="flex flex-wrap gap-4">
            {sensorProfiles.map((profile) => (
              <label key={profile} className="flex items-center gap-2 text-sm text-[var(--c-text)]">
                <input
                  type="radio"
                  className="h-4 w-4 accent-[var(--c-accent)]"
                  name={`sensor-profile-${config.channel}`}
                  checked={sensorProfile === profile}
                  onChange={() => onChange({ ioType: profile })}
                />
                {profile}
              </label>
            ))}
          </div>
          <p className="text-xs text-[var(--c-text-dim)]">
            {pick('PT100/PT1000 chưa lắp trên Rev A (ADR-010) — không chọn được ở đây.', 'PT100/PT1000 are not fitted on Rev A (ADR-010) — not selectable here.')}
          </p>
          {config.ioType && !sensorProfile && (
            <p className="text-xs text-[var(--c-warn-fg)]">
              {pick(`Giá trị hiện tại trên thiết bị: ${config.ioType} — chưa có control chọn cho biến thể này.`, `Current device value: ${config.ioType} — no control for this variant yet.`)}
            </p>
          )}
        </div>
      )}

      {mode === 'dry' && (
        <div className="space-y-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-3">
          <span className="text-sm font-semibold text-[var(--c-text)]">{pick('Kiểu tiếp điểm', 'Contact kind')}</span>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-[var(--c-text)]">
              <input type="radio" className="h-4 w-4 accent-[var(--c-accent)]" name={`contact-kind-${config.channel}`} checked={config.signalType === 4} onChange={() => onChange({ signalType: 4 })} />
              {pick('NO — Thường hở (Open contact direct)', 'NO — Normally open (Open contact direct)')}
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--c-text)]">
              <input type="radio" className="h-4 w-4 accent-[var(--c-accent)]" name={`contact-kind-${config.channel}`} checked={config.signalType === 5} onChange={() => onChange({ signalType: 5 })} />
              {pick('NC — Thường đóng (Open contact reversed)', 'NC — Normally closed (Open contact reversed)')}
            </label>
          </div>
          <p className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-2 text-xs text-[var(--c-warn-fg)]">
            {pick(
              'Đây là chế độ phụ trợ KHÔNG cách ly của một chân UI, không phải DI công nghiệp an toàn. Không dùng cho tín hiệu an toàn/interlock quan trọng.',
              'This is a non-isolated auxiliary mode of a UI pin, not a safety-rated industrial DI. Do not use for safety/interlock signals.'
            )}
          </p>
        </div>
      )}
    </div>
  )
}

function ScalingTab({ config, onChange }: { config: AiInputConfig; onChange: (patch: Partial<AiInputConfig>) => void }) {
  const { pick } = useI18n()
  const [lowLabel, highLabel] = scaleEndpointLabels(config, pick)
  const ioUnitMismatch = Boolean(config.ioUnit) && config.ioUnit !== unitToIo(config.unit)

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-3">
        <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Dải điện/tín hiệu vào', 'Input electrical range')}</span>
        <p className="mt-1 text-sm text-[var(--c-text)]">{rawRangeLabel(config, pick)}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{lowLabel}</span>
          <SmallNumberInput value={config.displayMin} min={-50} max={205} onChange={(displayMin) => onChange({ displayMin })} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{highLabel}</span>
          <SmallNumberInput value={config.displayMax} min={-50} max={205} onChange={(displayMax) => onChange({ displayMax })} />
        </label>
      </div>
      <p className="text-xs text-[var(--c-text-dim)]">
        {pick('Quy đổi tuyến tính từ dải điện/tín hiệu vào sang đơn vị kỹ thuật (raw → engineering).', 'Linear conversion from the input electrical range to engineering units (raw → engineering).')}
      </p>

      <details className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-3">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--c-text)]">{pick('Nâng cao: Hệ số dải (Range Multiplier)', 'Advanced: Range Multiplier')}</summary>
        <div className="mt-3 max-w-xs">
          <RangeMultiplierSelect value={config.rangeMultiplier} onChange={(rangeMultiplier) => onChange({ rangeMultiplier })} />
        </div>
      </details>

      <div className="max-w-xs space-y-2">
        <span className="text-sm font-semibold text-[var(--c-text)]">{pick('Đơn vị kỹ thuật', 'Engineering unit')}</span>
        <EngineeringUnitSelect value={config.unit} onChange={(unit) => onChange({ unit })} />
        {ioUnitMismatch && (
          <p className="text-xs text-[var(--c-warn-fg)]">
            {pick(
              `Thiết bị đang lưu unit gốc "${config.ioUnit}" — chưa có trong danh sách trên. Chọn một giá trị ở trên sẽ THAY chuỗi này; để nguyên nếu không muốn đổi.`,
              `Device currently stores raw unit "${config.ioUnit}" — not in the list above. Picking a value above will REPLACE this string; leave it untouched if you don't want to change it.`
            )}
          </p>
        )}
      </div>
    </div>
  )
}

function SignalConditioningTab({ config, configs, onChange }: { config: AiInputConfig; configs: AiInputConfig[]; onChange: (patch: Partial<AiInputConfig>) => void }) {
  const { pick } = useI18n()
  const siblings = configs.filter((item) => item.channel !== config.channel && config.mathFunction !== 0 && item.mathFunction === config.mathFunction)
  return (
    <div className="space-y-5">
      <div className="max-w-xs space-y-2">
        <span className="text-sm font-semibold text-[var(--c-text)]">{pick('Số mẫu lọc trung bình động', 'Moving-average filter samples')}</span>
        <SmallNumberInput value={config.filterSamples} min={0} max={100} onChange={(filterSamples) => onChange({ filterSamples })} />
        <p className="text-xs text-[var(--c-text-dim)]">
          {pick(
            'Dùng chung cho cả tín hiệu số và tương tự. Chưa có debounce/thời gian tối thiểu ON-OFF riêng cho tiếp điểm.',
            'Shared for both digital and analog signals. No separate debounce/min ON-OFF time for contacts yet.'
          )}
        </p>
      </div>
      <div className="max-w-xs space-y-2">
        <span className="text-sm font-semibold text-[var(--c-text)]">{pick('Hàm toán liên kênh', 'Cross-channel math function')}</span>
        <MathFunctionSelect value={config.mathFunction} onChange={(mathFunction) => onChange({ mathFunction })} />
        {config.mathFunction !== 0 && (
          <p className="text-xs text-[var(--c-text-dim)]">
            {siblings.length > 0
              ? pick(`Các kênh khác đang dùng cùng hàm: ${siblings.map((item) => aiNode(item.channel)).join(', ')}`, `Other channels using the same function: ${siblings.map((item) => aiNode(item.channel)).join(', ')}`)
              : pick('Chưa có kênh nào khác dùng cùng hàm này.', 'No other channel uses this function yet.')}
          </p>
        )}
      </div>
    </div>
  )
}

function CalibrationTab({ config, point, onChange }: { config: AiInputConfig; point?: Point; onChange: (patch: Partial<AiInputConfig>) => void }) {
  const { pick } = useI18n()
  const [standardValue, setStandardValue] = useState('')
  const currentValue = typeof point?.value === 'number' ? point.value : undefined

  function applyOffset() {
    const standard = Number(standardValue)
    if (!Number.isFinite(standard) || currentValue === undefined) return
    onChange({ sensorCal: clamp(config.sensorCal + (standard - currentValue), -12.7, 12.8) })
  }

  return (
    <div className="space-y-4">
      <div className="max-w-xs space-y-2">
        <span className="text-sm font-semibold text-[var(--c-text)]">{pick('Offset hiện tại', 'Current offset')}</span>
        <SmallNumberInput value={config.sensorCal} min={-12.7} max={12.8} step={0.1} onChange={(sensorCal) => onChange({ sensorCal })} />
      </div>

      <div className="max-w-sm space-y-3 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-3">
        <span className="text-sm font-semibold text-[var(--c-text)]">{pick('Trợ giúp tính offset', 'Offset helper')}</span>
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--c-text-dim)]">{pick('Giá trị đang đọc', 'Current reading')}</span>
          <span className="font-mono text-[var(--c-text)]">{currentValue !== undefined ? formatStat(currentValue, point?.unit) : NO_DATA}</span>
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Giá trị chuẩn đo được', 'Measured reference value')}</span>
          <input className={controlClass()} type="number" step={0.1} value={standardValue} onChange={(event) => setStandardValue(event.target.value)} />
        </label>
        <Button size="sm" disabled={currentValue === undefined || standardValue === ''} onClick={applyOffset}>{pick('Tính offset', 'Compute offset')}</Button>
        <p className="text-xs text-[var(--c-text-dim)]">{pick('Chỉ điền lại ô "Offset hiện tại" ở trên — bạn tự bấm Lưu.', 'Only fills the "Current offset" field above — you still need to click Save.')}</p>
      </div>

      <p className="text-xs text-[var(--c-text-dim)]">
        {pick(
          'Chỉ hỗ trợ hiệu chuẩn 1 điểm (offset). Chưa có gain/2-point, chưa lưu ngày/người hiệu chuẩn, chưa có nút khôi phục mặc định.',
          'Only 1-point (offset) calibration is supported. No gain/2-point, no calibration date/user log, no factory-reset button yet.'
        )}
      </p>
    </div>
  )
}

function AlarmStorageTab({ config, alarms, loading, error, onAddAlarm, onEditAlarm }: {
  config: AiInputConfig
  alarms: AlarmSetting[]
  loading: boolean
  error: boolean
  onAddAlarm: () => void
  onEditAlarm: (id: string) => void
}) {
  const { t, pick } = useI18n()
  const related = alarms.filter((alarm) => alarm.sources.some((source) => source.kind === 'UI' && source.channel === config.channel))
  return (
    <div className="space-y-5">
      <div className="space-y-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-[var(--c-text)]">{pick('Alarm đang giám sát kênh này', 'Alarms watching this channel')}</span>
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={onAddAlarm}>{pick('Thêm alarm cho kênh này', 'Add alarm for this channel')}</Button>
        </div>
        {error && <p className="text-sm text-[var(--c-fault-fg)]">{pick('Không tải được danh sách alarm liên quan.', 'Could not load related alarms.')}</p>}
        {!error && loading && <p className="text-sm text-[var(--c-text-dim)]">{t('loading')}</p>}
        {!error && !loading && related.length === 0 && <p className="text-sm text-[var(--c-text-dim)]">{pick('Chưa có alarm nào giám sát kênh này.', 'No alarm watches this channel yet.')}</p>}
        {related.map((alarm) => (
          <div key={alarm.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] px-3 py-2 text-sm">
            <div>
              <span className="font-semibold text-[var(--c-text)]">{alarm.id}</span>
              <span className="ml-2 text-[var(--c-text-dim)]">{alarm.label || alarm.id}</span>
              <span className="ml-2 text-xs text-[var(--c-text-dim)]">{alarm.enabled ? pick('Đang bật', 'Enabled') : pick('Đang tắt', 'Disabled')}</span>
            </div>
            <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => onEditAlarm(alarm.id)}>{pick('Sửa', 'Edit')}</Button>
          </div>
        ))}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-[var(--c-text)]">{pick('Lưu trữ (Historian)', 'Storage (Historian)')}</h3>
        <PointLoggingSection pointId={aiNode(config.channel)} label={config.label} kind="UI" />
      </div>
    </div>
  )
}

function DiagnosticsTab({
  config,
  configs,
  point,
  onChange,
  onSave,
  saving
}: {
  config: AiInputConfig
  configs: AiInputConfig[]
  point?: Point
  onChange: (patch: Partial<AiInputConfig>) => void
  onSave: (nextConfigs: AiInputConfig[]) => void
  saving: boolean
}) {
  const { pick } = useI18n()
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
            <h3 className="text-sm font-semibold text-[var(--c-text)]">{pick('Thống kê tức thời', 'Live statistics')}</h3>
            <Button size="sm" onClick={() => reset()}>{pick('Đặt lại', 'Reset')}</Button>
          </div>
          <dl className="grid gap-3 sm:grid-cols-3">
            <LiveDataItem label={pick('Nhỏ nhất', 'Minimum')} value={stats ? formatStat(stats.min, unit) : NO_DATA} />
            <LiveDataItem label={pick('Lớn nhất', 'Maximum')} value={stats ? formatStat(stats.max, unit) : NO_DATA} />
            <LiveDataItem label={pick('Trung bình', 'Average')} value={stats ? formatStat(stats.avg, unit) : NO_DATA} />
          </dl>
          {point && point.quality !== 'good' && (
            <p className="mt-3 text-xs text-[var(--c-warn-fg)]">qualityReason: {point.qualityReason ?? NO_DATA}</p>
          )}
          <p className="mt-3 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-2 text-xs text-[var(--c-text-dim)]">
            {pick(
              'Bộ điều khiển hiện chỉ báo lỗi mức board (không phân biệt được kênh nào). Chẩn đoán từng kênh (đứt dây/chập dây) cần mở rộng firmware — xem Phase 3 trong plan implement.',
              'The controller currently only reports board-level faults (cannot tell which channel). Per-channel diagnostics (open/short circuit) needs a firmware extension — see Phase 3 in the implementation plan.'
            )}
          </p>
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

function RegisterReferenceDetails({ config }: { config: AiInputConfig }) {
  const { t } = useI18n()
  const rows: Array<[string, string, string]> = [
    ['u0', t('signalTypeLabel'), config.signalType === 2 ? `${signalLabel(config.signalType, t)} / ${config.analogCurrent ? t('signalModeCurrent') : t('signalModeVolt')}` : signalLabel(config.signalType, t)],
    ['u1', t('displayMinLabel'), String(config.displayMin)],
    ['u2', t('displayMaxLabel'), String(config.displayMax)],
    ['u3', t('rangeMultiplierLabel'), rangeLabel(config.rangeMultiplier, t)],
    ['u4', t('unitsLabel'), unitLabel(config.unit, t)],
    ['u5', t('filterSamplesLabel'), String(config.filterSamples)],
    ['u6', t('sensorCalibrationLabel'), String(config.sensorCal)],
    ['u7', t('mathFunctionLabel'), mathFunctionLabel(config.mathFunction, t)]
  ]
  return (
    <details className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)]">
      <summary className="cursor-pointer bg-[var(--c-surface-2)] px-3 py-2 text-sm font-semibold text-[var(--c-text)]">{t('registerReference')}</summary>
      <div>
        {rows.map(([register, name, value]) => (
          <div key={register} className="grid grid-cols-[70px_minmax(0,1fr)_minmax(120px,220px)] items-center gap-3 border-t border-[var(--c-border)] px-3 py-2 text-sm">
            <span className="font-mono text-xs text-[var(--c-text-dim)]">{String(config.channel).padStart(2, '0')} {register}</span>
            <span className="text-[var(--c-text)]">{name}</span>
            <span className="font-mono text-[var(--c-text-dim)]">{value}</span>
          </div>
        ))}
      </div>
    </details>
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
    // PA3-F04: không có mốc thời gian của producer thì KHÔNG đặt mẫu này
    // lên trục thời gian bằng giờ máy trạm — biểu đồ sẽ nói dối về độ tươi.
    if (!point.updatedAt) return
    const time = formatTime(point.updatedAt)
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

function updatedAgoLabel(point: Point | undefined, pick: PickText): string {
  if (!point?.updatedAt) return NO_DATA
  const age = formatDataAge(point.updatedAt)
  if (age === NO_DATA) return NO_DATA
  return pick(`${age} trước`, `${age} ago`)
}

function SignalModeSelect({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  const { t } = useI18n()
  return (
    <select className={controlClass()} value={value ? 'current' : 'volt'} onChange={(event) => onChange(event.target.value === 'current')}>
      <option value="volt">{t('signalModeVolt')}</option>
      <option value="current">{t('signalModeCurrent')}</option>
    </select>
  )
}

function EngineeringUnitSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { pick } = useI18n()
  return (
    <select className={controlClass()} value={value} onChange={(event) => onChange(Number(event.target.value))}>
      {[0, 1, 2, 3, 4].map((option) => <option key={option} value={option}>{engineeringUnitLabel(option, pick)}</option>)}
    </select>
  )
}

function RangeMultiplierSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { pick } = useI18n()
  return (
    <select className={controlClass()} value={value} onChange={(event) => onChange(Number(event.target.value))}>
      {rangeMultiplierOptions.map((option) => <option key={option} value={option}>{rangeMultiplierCleanLabel(option, pick)}</option>)}
    </select>
  )
}

function MathFunctionSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { pick } = useI18n()
  return (
    <select className={controlClass()} value={value} onChange={(event) => onChange(Number(event.target.value))}>
      {mathFunctionOptions.map((option) => <option key={option} value={option}>{mathFunctionCleanLabel(option, pick)}</option>)}
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

function tabLabel(tab: TabKey, t: Translate): string {
  if (tab === 'electrical') return t('tabElectrical')
  if (tab === 'scaling') return t('tabScaling')
  if (tab === 'signal') return t('tabSignal')
  if (tab === 'calibration') return t('tabCalibration')
  if (tab === 'alarmStorage') return t('tabAlarmStorage')
  return t('tabDiagnostics')
}

function electricalModeOf(signalType: AiSignalType): ElectricalMode {
  if (signalType === 1) return 'volt'
  if (signalType === 2) return 'voltCurrent'
  if (signalType === 3) return 'resistance'
  if (signalType === 4 || signalType === 5) return 'dry'
  if (signalType === 6) return 'potentiometer'
  if (signalType === 7) return 'light'
  if (signalType === 8) return 'pulse'
  return 'none'
}

function electricalModeToSignalType(mode: ElectricalMode, currentSignalType: AiSignalType): AiSignalType {
  if (mode === 'volt') return 1
  if (mode === 'voltCurrent') return 2
  if (mode === 'resistance') return 3
  if (mode === 'dry') return currentSignalType === 5 ? 5 : 4
  if (mode === 'potentiometer') return 6
  if (mode === 'light') return 7
  if (mode === 'pulse') return 8
  return 0
}

function electricalModeLabel(mode: ElectricalMode, pick: PickText): string {
  if (mode === 'volt') return pick('Điện áp 0-10V', 'Voltage 0-10V')
  if (mode === 'voltCurrent') return pick('Điện áp/dòng (2-10V hoặc 4-20mA)', 'Voltage/current (2-10V or 4-20mA)')
  if (mode === 'resistance') return pick('Điện trở', 'Resistance')
  if (mode === 'dry') return pick('Tiếp điểm khô', 'Dry contact')
  if (mode === 'potentiometer') return pick('Biến trở', 'Potentiometer')
  if (mode === 'light') return pick('Ánh sáng/chuyển động', 'Light/motion')
  if (mode === 'pulse') return pick('Đếm xung', 'Pulse counting')
  return pick('Không dùng', 'Not used')
}

function sensorProfileOf(ioType?: string): typeof sensorProfiles[number] | undefined {
  return ioType === 'NTC10k' || ioType === 'NTC20k' ? ioType : undefined
}

function rawRangeLabel(config: AiInputConfig, pick: PickText): string {
  if (config.signalType === 0) return pick('Không dùng', 'Not used')
  if (config.signalType === 1) return '0 V – 10 V'
  if (config.signalType === 2) return config.analogCurrent ? '4 mA – 20 mA' : '2 V – 10 V'
  if (config.signalType === 3) return pick('Theo đường cong nhiệt trở (kΩ, phụ thuộc Sensor Profile)', 'Per thermistor curve (kΩ, depends on Sensor Profile)')
  if (isDigitalContact(config.signalType)) return pick('Tiếp điểm khô (0/1)', 'Dry contact (0/1)')
  if (config.signalType === 6) return pick('Biến trở (kΩ, tuỳ thiết bị)', 'Potentiometer (kΩ, device-dependent)')
  if (config.signalType === 7) return pick('Ánh sáng/chuyển động (tuỳ cảm biến)', 'Light/motion (sensor-dependent)')
  return pick('Đếm xung', 'Pulse count')
}

function scaleEndpointLabels(config: AiInputConfig, pick: PickText): [string, string] {
  if (config.signalType === 1) return ['0 V =', '10 V =']
  if (config.signalType === 2) return config.analogCurrent ? ['4 mA =', '20 mA ='] : ['2 V =', '10 V =']
  return [pick('Đầu thấp =', 'Low end ='), pick('Đầu cao =', 'High end =')]
}

function electricalSummary(config: AiInputConfig, pick: PickText): string {
  const mode = electricalModeOf(config.signalType)
  const label = electricalModeLabel(mode, pick)
  if (mode === 'resistance') {
    const profile = sensorProfileOf(config.ioType)
    return profile ? `${label} · ${profile}` : label
  }
  if (mode === 'dry') return `${label} · ${config.signalType === 5 ? 'NC' : 'NO'}`
  if (mode === 'voltCurrent') return `${label} · ${config.analogCurrent ? '4-20mA' : '2-10V'}`
  return label
}

function engineeringUnitLabel(value: number, pick: PickText): string {
  if (value === 1) return '%'
  if (value === 2) return '°C / °F'
  if (value === 3) return 'Pa'
  if (value === 4) return 'ppm'
  return pick('Không hiển thị', 'Not shown')
}

function rangeMultiplierCleanLabel(value: number, pick: PickText): string {
  if (value === 1) return pick('x10 (-500..2050)', 'x10 (-500..2050)')
  if (value === 2) return pick('x100 (-5000..20500)', 'x100 (-5000..20500)')
  if (value === 3) return pick('Căn bậc hai (-50..205)', 'Square root (-50..205)')
  if (value === 4) return pick('Căn bậc hai x10 (-500..2050)', 'Square root x10 (-500..2050)')
  if (value === 5) return pick('Căn bậc hai x100 (-5000..20500)', 'Square root x100 (-5000..20500)')
  return pick('x1 (-50..205)', 'x1 (-50..205)')
}

function mathFunctionCleanLabel(value: number, pick: PickText): string {
  if (value === 1) return pick('Trung bình (Avg)', 'Average (Avg)')
  if (value === 2) return pick('Nhỏ nhất (Min)', 'Minimum (Min)')
  if (value === 3) return pick('Lớn nhất (Max)', 'Maximum (Max)')
  return pick('Không hoạt động', 'Not active')
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
