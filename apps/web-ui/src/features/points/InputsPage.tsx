import { Activity, ChevronLeft, ChevronRight, Copy, LayoutGrid, Pencil, Plus, Save, Search, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient, unitToIo } from '../../shared/api/client'
import { displayPointName, focusPointField, normalizePointName, pointFieldFocusPath, pointFieldLocation, pointNameConflicts, pointTagFieldErrors, validatePointName, validatePointTag } from '../../shared/api/pointTags'
import { Button } from '../../shared/components/Button'
import { DraftDiffTable } from '../../shared/components/DraftDiffTable'
import { Modal } from '../../shared/components/Modal'
import { Panel } from '../../shared/components/Panel'
import { PointNameConflictNotice } from '../../shared/components/PointNameConflictNotice'
import { PointLoggingSection } from '../../shared/components/PointLoggingSection'
import { StateBlock } from '../../shared/components/StateBlock'
import { QualityDot, StatusBadge } from '../../shared/components/StatusBadge'
import { useToast } from '../../shared/components/Toast'
import { TrendChart } from '../../shared/components/TrendChart'
import { IS_DEMO } from '../../shared/config'
import { getDemoPoints } from '../../shared/demo/simulator'
import { useApi } from '../../shared/hooks/useApi'
import { useI18n } from '../../shared/i18n'
import { isDigitalContact, type AiInputConfig, type AiSignalType, type AlarmSetting, type Point, type TrendSample } from '../../shared/types'
import { clamp, cn, formatDataAge, formatTime, formatValue, isVisibleUniversalInput, NO_DATA, pointNumber, uiNode } from '../../shared/utils'
import {
  electricalModeAvailability,
  electricalModes,
  fetchSystemCapabilities,
  universalInputChannelCount,
  type ElectricalMode,
  type SystemCapabilities
} from '../../shared/api/capabilities'
import { aiInputDraftDiff } from './inputsDraftDiff'

type TabKey = 'electrical' | 'scaling' | 'signal' | 'calibration' | 'alarmStorage' | 'diagnostics'
type Translate = ReturnType<typeof useI18n>['t']
type PickText = ReturnType<typeof useI18n>['pick']
type LiveTrendSample = TrendSample & { raw: number }

const tabOrder: TabKey[] = ['electrical', 'scaling', 'signal', 'calibration', 'alarmStorage', 'diagnostics']
const sensorProfiles = ['NTC10k', 'NTC20k'] as const
const rangeMultiplierOptions = [0, 1, 2, 3, 4, 5]
const mathFunctionOptions = [0, 1, 2, 3]

export function InputsPage() {
  const { t, pick } = useI18n()
  const toast = useToast()
  const navigate = useNavigate()
  const [configs, setConfigs] = useState<AiInputConfig[]>([])
  /* `ISS-PIO-13`: năng lực phần cứng do backend cấp (`ISS-PIO-12`), gốc là
   * `BOARD_CAP_MAP`. `null` nghĩa là CHƯA ĐỌC ĐƯỢC — không phải "bo không có
   * gì" — nên nơi dùng phải xử lý ba trạng thái chứ không hai. */
  const [capabilities, setCapabilities] = useState<SystemCapabilities | null>(null)
  /* FE-010 (review UI/UX AHU wiring 2026-08-17): bản chụp lần cuối đã lưu/tải
   * từ backend, dùng làm mốc so sánh "có thay đổi chưa lưu" — không suy ra từ
   * `configs` một mình vì `configs` chính là bản đang gõ dở. */
  const [savedConfigs, setSavedConfigs] = useState<AiInputConfig[]>([])
  const [channelFilter, setChannelFilter] = useState('')
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null)
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
  const [copyOpen, setCopyOpen] = useState(false)
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
  const dirty = useMemo(() => JSON.stringify(configs) !== JSON.stringify(savedConfigs), [configs, savedConfigs])
  const uiChannelCeiling = useMemo(() => universalInputCeiling(capabilities, configs), [capabilities, configs])
  /* `T57-2.10` — bảng khác biệt "đang lưu ↔ bản nháp" (khối `BB-8`). Tính ở cấp
     trang chứ không bên trong hộp thoại: hộp thoại chỉ tồn tại khi đang mở, còn
     danh sách khác biệt phải tính được cả lúc đóng để nơi khác dùng lại. */
  const draftDiffRows = useMemo(() => aiInputDraftDiff(savedConfigs, configs, pick), [configs, pick, savedConfigs])
  const filteredConfigs = useMemo(() => {
    const q = channelFilter.trim().toLowerCase()
    if (!q) return configs
    return configs.filter((config) => aiNode(config.channel).toLowerCase().includes(q) || config.label.toLowerCase().includes(q))
  }, [configs, channelFilter])

  useEffect(() => {
    let active = true
    setLoading(true)
    apiClient.getAiInputs()
      .then((items) => {
        if (!active) return
        setConfigs(items)
        setSavedConfigs(items)
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
    let active = true
    fetchSystemCapabilities()
      .then((doc) => {
        if (active) setCapabilities(doc)
      })
      .catch(() => {
        // Không chặn trang vì một lần gọi hỏng: `capabilities` giữ nguyên `null`
        // và mọi mode xuống mức "chưa xác nhận" thay vì biến mất. Đường ghi phía
        // backend vẫn chặn đúng chỗ cần chặn.
        if (active) setCapabilities(null)
      })
    return () => {
      active = false
    }
  }, [reloadToken])

  useEffect(() => {
    const first = errorFocusPath ?? Object.keys(tagErrors)[0]
    if (!first) return
    const location = pointFieldLocation(first)
    if (location?.collection === 'ui' && configs[location.index]) setSelectedChannel(configs[location.index].channel)
    const frame = window.requestAnimationFrame(() => focusPointField(Object.keys(tagErrors)))
    return () => window.cancelAnimationFrame(frame)
  }, [configs, errorFocusPath, tagErrors])

  /* FE-010: cảnh báo khi rời trang (đóng tab/reload hoặc click link nội bộ)
   * lúc còn thay đổi UI config chưa lưu — cùng pattern dirty-guard đã dùng ở
   * `features/programming/design/DesignWorkspacePage.tsx` (D-01). */
  useEffect(() => {
    if (!dirty) return undefined
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    const interceptInternalLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target
      const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null
      if (!anchor || anchor.target || anchor.download) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin || url.href === window.location.href) return
      event.preventDefault()
      event.stopPropagation()
      setPendingNavigation(`${url.pathname}${url.search}${url.hash}`)
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    globalThis.document.addEventListener('click', interceptInternalLink, true)
    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload)
      globalThis.document.removeEventListener('click', interceptInternalLink, true)
    }
  }, [dirty])

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
  const livePoint = selected ? findAiPoint(pointsState.data ?? [], selected.channel, uiChannelCeiling) : undefined
  const demoPoint = selected && !livePoint && IS_DEMO ? findAiPoint(getDemoPoints(), selected.channel, uiChannelCeiling) : undefined
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

  async function persistConfigs(nextConfigs: AiInputConfig[], closeConfirm = false): Promise<boolean> {
    const recoveryIndex = nextConfigs.findIndex((config) => config.channel === selectedChannel)
    const recoveryConfig = recoveryIndex >= 0 ? nextConfigs[recoveryIndex] : undefined
    const recoveryId = recoveryConfig ? aiNode(recoveryConfig.channel) : undefined
    const recoveringName = Boolean(recoveryId && persistedNameConflicts.has(recoveryId))
    if (recoveringName && recoveryConfig) {
      const nameError = validatePointName(recoveryConfig.label)
      const errors = nameError ? { [`ui[${recoveryIndex}].name`]: nameError } : {}
      setTagErrors(errors)
      setErrorFocusPath(Object.keys(errors)[0])
      if (nameError) return false
    } else if (!validateTags(nextConfigs)) return false
    setSaving(true)
    try {
      if (recoveringName && recoveryConfig && recoveryId) {
        const name = normalizePointName(recoveryConfig.label)
        await apiClient.updatePointName(recoveryId, name)
        const updated = nextConfigs.map((config) => config.channel === recoveryConfig.channel ? { ...config, label: name } : config)
        setConfigs(updated)
        setSavedConfigs(updated)
        void pointsState.refetch()
      } else {
        const normalized = nextConfigs.map((config) => ({ ...config, tag: aiNode(config.channel), label: displayPointName(normalizePointName(config.label), aiNode(config.channel)) }))
        await apiClient.putAiInputs(normalized)
        setConfigs(normalized)
        setSavedConfigs(normalized)
      }
      setTagErrors({})
      setErrorFocusPath(undefined)
      toast.push('success', t('saveSuccess'))
      if (closeConfirm) {
        setConfirmOpen(false)
        setWizardActive(false)
      }
      return true
    } catch (error) {
      const errors = pointTagFieldErrors(error)
      setTagErrors(errors)
      setErrorFocusPath(pointFieldFocusPath(error, recoveryId ?? aiNode(selectedChannel), ['ui']) ?? Object.keys(errors)[0])
      toast.push('error', `${t('saveError')}: ${error instanceof Error ? error.message : String(error)}`)
      return false
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
          {/* `T57-2.11` — 16 kênh cùng loại cảm biến phải cấu hình 16 lần là
              nguồn sai sót lớn nhất của trang này. */}
          <Button icon={<Copy className="h-4 w-4" />} disabled={loading || !selected} onClick={() => setCopyOpen(true)}>{pick('Sao chép sang kênh khác', 'Copy to channels')}</Button>
          <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={saving} onClick={requestSave} disabled={loading || configs.length === 0}>
            {t('save')}
          </Button>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Panel className="min-w-0" title="UI Channels">
          <div className="mb-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--c-text-dim)]" aria-hidden="true" />
              <input
                type="search"
                value={channelFilter}
                onChange={(event) => setChannelFilter(event.target.value)}
                placeholder={pick('Tìm kênh…', 'Search channels…')}
                aria-label={pick('Tìm kênh', 'Search channels')}
                className="h-9 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] pl-8 pr-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1 max-h-[calc(100vh-300px)] overflow-y-auto pr-2">
            {filteredConfigs.map((config) => {
              const listPoint = findAiPoint(pointsState.data ?? [], config.channel, uiChannelCeiling)
              return (
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
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{aiNode(config.channel)}</span>
                    <span className="block truncate text-xs">{config.label}</span>
                  </span>
                  <QualityDot state={listPoint?.quality ?? 'unknown'} title={listPoint?.quality ? `${aiNode(config.channel)}: ${listPoint.quality}` : undefined} />
                </button>
              )
            })}
            {loading && <div className="rounded-[var(--radius)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">{t('loading')}</div>}
            {!loading && filteredConfigs.length === 0 && (
              <div className="rounded-[var(--radius)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">{pick('Không tìm thấy kênh phù hợp.', 'No channel matches.')}</div>
            )}
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

              {activeTab === 'electrical' && <ElectricalModeTab config={selected} capabilities={capabilities} onChange={(patch) => updateChannel(selected.channel, patch)} />}
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
        size="lg"
        confirmLabel="OK"
        cancelLabel="Cancel"
        onConfirm={() => { void confirmSave() }}
        onClose={() => setConfirmOpen(false)}
      >
        {/* `T57-2.10`: hỏi "có muốn lưu không?" mà không nói lưu CÁI GÌ thì
            người vận hành chỉ có thể bấm OK theo phản xạ. Cấu hình này đi
            xuống thiết bị, nên hộp thoại phải liệt kê từng trường sắp đổi. */}
        <div className="space-y-3 text-sm">
          <p>{pick('Kiểm lại các thay đổi sau trước khi ghi xuống thiết bị:', 'Review the following changes before writing them to the device:')}</p>
          <DraftDiffTable
            rows={draftDiffRows}
            emptyText={pick('Không có thay đổi nào so với cấu hình đã lưu.', 'No changes compared with the saved configuration.')}
          />
        </div>
      </Modal>
      {selected && (
        <CopyToChannelsModal
          open={copyOpen}
          source={selected}
          configs={configs}
          onClose={() => setCopyOpen(false)}
          onApply={(targets, patch) => {
            setConfigs((current) => current.map((config) =>
              targets.includes(config.channel) ? { ...config, ...patch } : config))
            setCopyOpen(false)
          }}
        />
      )}

      <InputsOverviewModal
        open={overviewOpen}
        configs={configs}
        livePoints={pointsState.data ?? []}
        uiChannelCeiling={uiChannelCeiling}
        onEdit={(channel) => {
          setSelectedChannel(channel)
          setWizardActive(false)
          setActiveTab('electrical')
          setOverviewOpen(false)
        }}
        onClose={() => setOverviewOpen(false)}
      />
      {/* FE-006: bản sao nút Save nổi cố định — tránh phải scroll lên đầu
       * trang sau khi sửa Scaling/Alarms ở cuối trang dài. */}
      {!loading && configs.length > 0 && (
        <Button
          variant="primary"
          icon={<Save className="h-4 w-4" />}
          loading={saving}
          onClick={requestSave}
          className="fixed bottom-6 right-6 z-20 shadow-lg"
        >
          {t('save')}
        </Button>
      )}
      <Modal
        open={pendingNavigation !== null}
        title={pick('Cấu hình ngõ vào chưa lưu', 'Unsaved input configuration')}
        cancelLabel={pick('Ở lại', 'Stay')}
        confirmLabel={pick('Lưu rồi rời đi', 'Save and leave')}
        confirmLoading={saving}
        onClose={() => setPendingNavigation(null)}
        onConfirm={() => {
          const destination = pendingNavigation
          if (!destination) return
          void persistConfigs(configs).then((ok) => {
            if (!ok) return
            setPendingNavigation(null)
            navigate(destination)
          })
        }}
      >
        <p>{pick('Bạn có thay đổi cấu hình ngõ vào chưa lưu. Rời trang sẽ mất các thay đổi này trừ khi lưu trước.', 'You have unsaved input configuration changes. Leaving this page will discard them unless you save first.')}</p>
        <Button
          className="mt-3"
          variant="danger"
          disabled={saving}
          onClick={() => {
            const destination = pendingNavigation
            setConfigs(savedConfigs)
            setTagErrors({})
            setErrorFocusPath(undefined)
            setPendingNavigation(null)
            if (destination) navigate(destination)
          }}
        >
          {pick('Bỏ thay đổi, rời đi', 'Discard changes and leave')}
        </Button>
      </Modal>
    </div>
  )
}

/**
 * Sao chép cấu hình sang nhiều kênh — `T57-2.11`.
 *
 * KHÔNG chép `channel`, `tag`, `label` và `note`: bốn trường đó là danh tính
 * của kênh. Chép chúng sẽ tạo ra 16 kênh trùng tên — đúng lỗi mà
 * `pointNameConflicts` tồn tại để phát hiện, và ta không nên chủ động sinh ra nó.
 *
 * Xem trước danh sách sẽ bị ghi đè TRƯỚC khi áp, và **không tự Save**: người
 * dùng vẫn phải bấm Lưu, nên dirty-guard và hộp thoại xác nhận hiện có vẫn là
 * lớp chặn cuối.
 */
function CopyToChannelsModal({ open, source, configs, onClose, onApply }: {
  open: boolean
  source: AiInputConfig
  configs: AiInputConfig[]
  onClose: () => void
  onApply: (targets: number[], patch: Partial<AiInputConfig>) => void
}) {
  const { pick } = useI18n()
  const [targets, setTargets] = useState<number[]>([])

  useEffect(() => { if (open) setTargets([]) }, [open])

  const candidates = configs.filter((config) => config.channel !== source.channel)
  const patch: Partial<AiInputConfig> = {
    signalType: source.signalType,
    analogCurrent: source.analogCurrent,
    displayMin: source.displayMin,
    displayMax: source.displayMax,
    rangeMultiplier: source.rangeMultiplier,
    unit: source.unit,
    filterSamples: source.filterSamples,
    mathFunction: source.mathFunction,
    ioType: source.ioType,
    ioUnit: source.ioUnit
  }

  return (
    <Modal
      open={open}
      title={pick(`Sao chép cấu hình từ UI-${String(source.channel).padStart(2, '0')}`, `Copy configuration from UI-${String(source.channel).padStart(2, '0')}`)}
      confirmLabel={pick(`Áp cho ${targets.length} kênh`, `Apply to ${targets.length} channels`)}
      onConfirm={() => onApply(targets, patch)}
      onClose={onClose}
      size="lg"
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--c-text-dim)]">
          {pick(
            'Chép loại tín hiệu, dải quy đổi, đơn vị, lọc và hàm toán. KHÔNG chép tag, tên và ghi chú — đó là danh tính riêng của từng kênh.',
            'Copies signal type, scaling, unit, filter and math function. Does NOT copy tag, name or note — those identify each channel.'
          )}
        </p>

        <div className="grid max-h-[40vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
          {candidates.map((config) => {
            const checked = targets.includes(config.channel)
            return (
              <label key={config.channel} className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-2 py-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => setTargets((current) => checked ? current.filter((item) => item !== config.channel) : [...current, config.channel])}
                />
                <span className="mono">UI-{String(config.channel).padStart(2, '0')}</span>
              </label>
            )
          })}
        </div>

        {targets.length > 0 && (
          <div className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-xs text-[var(--c-warn-fg)]">
            {/* Xem trước cái sẽ MẤT, không chỉ cái sẽ được đặt: người dùng cần
                biết mình đang ghi đè lên cấu hình nào. */}
            <div className="font-semibold">{pick('Sẽ ghi đè cấu hình hiện tại của:', 'Will overwrite the current configuration of:')}</div>
            <div className="mono mt-1">
              {targets.slice().sort((a, b) => a - b).map((channel) => `UI-${String(channel).padStart(2, '0')}`).join(', ')}
            </div>
            <div className="mt-2">{pick('Chưa lưu xuống thiết bị — bạn vẫn phải bấm Lưu.', 'Not saved to the device yet — you still need to click Save.')}</div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function InputsOverviewModal({ open, configs, livePoints, uiChannelCeiling, onEdit, onClose }: { open: boolean; configs: AiInputConfig[]; livePoints: Point[]; uiChannelCeiling: number; onEdit: (channel: number) => void; onClose: () => void }) {
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
              const live = findAiPoint(livePoints, config.channel, uiChannelCeiling)
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
      <div className="flex flex-wrap items-end gap-4 border-t border-[var(--c-border)] pt-3">
        {point
          ? <StatusBadge state={point.quality} title={point.quality !== 'good' ? (point.qualityReason ?? undefined) : undefined} />
          : <span className="text-xs font-semibold text-[var(--c-text-dim)]">{NO_DATA}</span>}
        <span>
          <span className="block text-xs uppercase text-[var(--c-text-dim)]">{pick('Giá trị', 'Value')}</span>
          <span className="font-mono text-xl font-semibold leading-none text-[var(--c-text)]">{point ? formatLiveValue(point, unit, booleanInput) : NO_DATA}</span>
        </span>
        {rawCell && (
          <span>
            <span className="block text-xs uppercase text-[var(--c-text-dim)]">{t('rawValue')}</span>
            <span className="font-mono text-xs text-[var(--c-text-dim)]">{formatStat(rawCell.value, rawCell.unit)}</span>
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

function ElectricalModeTab({ config, capabilities, onChange }: { config: AiInputConfig; capabilities: SystemCapabilities | null; onChange: (patch: Partial<AiInputConfig>) => void }) {
  const { pick } = useI18n()
  const mode = electricalModeOf(config.signalType)
  const sensorProfile = sensorProfileOf(config.ioType)

  /* `ISS-PIO-13` — dropdown chỉ hiện mode phần cứng thật sự hỗ trợ.
   *
   * `withheld` bị GIẤU: hoặc bo nói rõ là không có mạch, hoặc mode đòi bằng
   * chứng mà chưa ai hỏi được — cả hai đều không được mời chọn (đề bài §6.1).
   *
   * Ngoại lệ có chủ ý: mode ĐANG được lưu trên kênh này luôn được hiện, kể cả
   * khi bị giữ lại. Giấu nó đi sẽ làm nút radio không khớp cấu hình thật, người
   * vận hành thấy một kênh "không chọn gì" trong khi nó đang chạy một mode cụ
   * thể — và lần lưu sau sẽ âm thầm đổi mất mode đó. Hiện nó ra kèm nhãn cảnh
   * báo mới là cách nói thật. */
  const offeredModes = electricalModes.filter((item) => item === mode || electricalModeAvailability(capabilities, item).availability !== 'withheld')

  function selectMode(next: ElectricalMode) {
    const signalType = electricalModeToSignalType(next, config.signalType)
    onChange(signalTypePatch(signalType, config.analogCurrent))
  }

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-[var(--c-text)]">{pick('Electrical Mode', 'Electrical Mode')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {offeredModes.map((item) => {
            const capability = electricalModeAvailability(capabilities, item)
            const note = capability.reasons.join(' · ')
            const badgeId = `electrical-mode-${config.channel}-${item}-capability`
            return (
              <label key={item} title={note || undefined} className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 py-2 text-sm text-[var(--c-text)]">
                <input
                  type="radio"
                  className="h-4 w-4 accent-[var(--c-accent)]"
                  name={`electrical-mode-${config.channel}`}
                  /* Tên trợ năng phải là TÊN MODE, không kèm nhãn tin cậy: nhãn
                   * đó là *mô tả*, và gộp nó vào tên sẽ làm tên của cùng một nút
                   * đổi theo trạng thái mạng. Cảnh báo vẫn tới được người dùng
                   * trình đọc màn hình qua `aria-describedby`. */
                  aria-label={electricalModeLabel(item, pick)}
                  aria-describedby={capability.availability === 'confirmed' ? undefined : badgeId}
                  checked={mode === item}
                  onChange={() => selectMode(item)}
                />
                <span>{electricalModeLabel(item, pick)}</span>
                {capability.availability !== 'confirmed' && (
                  <span id={badgeId} className="rounded-full border border-[var(--c-warn)] px-2 py-0.5 text-[10px] font-semibold text-[var(--c-warn-fg)]">
                    {capability.availability === 'withheld'
                      ? pick('bo không xác nhận', 'not confirmed by board')
                      : pick('chưa xác nhận', 'unverified')}
                  </span>
                )}
              </label>
            )
          })}
        </div>
        <p className="text-xs text-[var(--c-text-dim)]">
          {pick(
            'Gợi ý theo bảng đấu nối field device: NTC10K/NTC20K → Điện trở · 4-20mA hoặc 2-10V → Điện áp/dòng · 0-10V → Điện áp 0-10V · dry-contact → Tiếp điểm khô.',
            'Wiring-table hint: NTC10K/NTC20K → Resistance · 4-20mA or 2-10V → Voltage/current · 0-10V → Voltage 0-10V · dry-contact → Dry contact.'
          )}
        </p>
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

      <ConversionPreview config={config} />

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

/**
 * Dải thô SỐ của tín hiệu, hoặc `null` nếu không xác định được.
 *
 * Chỉ ba loại có dải thô tuyến tính cố định do phần cứng quy định: 0-10 V,
 * 2-10 V và 4-20 mA. Nhiệt trở đi theo đường cong phi tuyến phụ thuộc Sensor
 * Profile; biến trở, ánh sáng và xung thì phụ thuộc thiết bị đấu vào. Với những
 * loại đó, mọi phép quy đổi tuyến tính ở FE đều là **đoán**, và xem trước một
 * con số đoán còn tệ hơn không xem trước: người dùng sẽ tin nó.
 */
function linearRawRange(config: AiInputConfig): { low: number; high: number; unit: string } | null {
  if (config.signalType === 1) return { low: 0, high: 10, unit: 'V' }
  if (config.signalType === 2) {
    return config.analogCurrent ? { low: 4, high: 20, unit: 'mA' } : { low: 2, high: 10, unit: 'V' }
  }
  return null
}

/**
 * Quy đổi thô → kỹ thuật theo đúng cấu hình ĐANG SOẠN (`T57-2.9`).
 *
 * VÌ SAO CẦN
 *
 * Đặt nhầm `displayMin`/`displayMax` chỉ lộ ra khi cảm biến đã đấu và người ta
 * đọc được một con số vô lý trên màn hình — tức là sau khi thiết bị đã chạy sai
 * một quãng. Xem trước bắt lỗi ngay lúc cấu hình, và bắt bằng chính con số mà
 * người dùng sắp lưu chứ không phải cấu hình đã lưu.
 */
export function previewEngineeringValue(config: AiInputConfig, rawValue: number): number | null {
  const range = linearRawRange(config)
  if (!range) return null
  if (!Number.isFinite(rawValue)) return null
  const span = range.high - range.low
  if (span === 0) return null
  const ratio = (rawValue - range.low) / span
  return config.displayMin + ratio * (config.displayMax - config.displayMin)
}

/**
 * Xem trước quy đổi — `T57-2.9`.
 *
 * Không gọi API, không ghi gì: đây là một máy tính tay dùng đúng công thức mà
 * thiết bị sẽ dùng, chạy trên cấu hình đang soạn. Loại tín hiệu không có dải
 * thô tuyến tính xác định được thì **nói ra là không xem trước được**, thay vì
 * đưa một con số đoán.
 */
function ConversionPreview({ config }: { config: AiInputConfig }) {
  const { pick } = useI18n()
  const range = linearRawRange(config)
  const [rawText, setRawText] = useState('')

  if (!range) {
    if (config.signalType === 0) return null
    return (
      <p className="rounded-[var(--radius)] border border-dashed border-[var(--c-border)] px-3 py-2 text-xs text-[var(--c-text-dim)]">
        {pick(
          'Loại tín hiệu này không có dải thô tuyến tính cố định (đường cong nhiệt trở, biến trở, xung...), nên không xem trước quy đổi được. Một con số đoán ở đây còn tệ hơn không có.',
          'This signal type has no fixed linear raw range (thermistor curve, potentiometer, pulse…), so conversion cannot be previewed. A guessed number here would be worse than none.'
        )}
      </p>
    )
  }

  const raw = Number(rawText)
  const engineering = rawText.trim() === '' ? null : previewEngineeringValue(config, raw)
  const outOfRange = engineering !== null && (raw < range.low || raw > range.high)

  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-3">
      <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Xem trước quy đổi', 'Conversion preview')}</span>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="block space-y-1">
          <span className="text-xs text-[var(--c-text-dim)]">{pick('Giá trị thô', 'Raw value')} ({range.unit})</span>
          <input
            type="number"
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            placeholder={`${range.low} – ${range.high}`}
            className="mono h-9 w-32 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-2 text-sm"
          />
        </label>
        <span className="pb-2 text-[var(--c-text-dim)]">→</span>
        <div className="pb-1">
          <div className="text-xs text-[var(--c-text-dim)]">{pick('Giá trị kỹ thuật', 'Engineering value')}</div>
          <div className="mono text-lg font-bold text-[var(--c-accent)]">
            {engineering === null ? NO_DATA : engineering.toFixed(2)}
          </div>
        </div>
      </div>
      {outOfRange && (
        <p className="mt-2 text-xs text-[var(--c-warn-fg)]">
          {pick(
            `Giá trị thô nằm ngoài dải ${range.low}–${range.high} ${range.unit}; kết quả là ngoại suy, thiết bị thật có thể kẹp về biên.`,
            `Raw value is outside ${range.low}–${range.high} ${range.unit}; the result is extrapolated and the device may clamp instead.`
          )}
        </p>
      )}
      <p className="mt-2 text-xs text-[var(--c-text-dim)]">
        {pick('Tính theo cấu hình ĐANG SOẠN, chưa lưu. Không gửi gì xuống thiết bị.', 'Computed from the draft configuration, not the saved one. Nothing is sent to the device.')}
      </p>
    </div>
  )
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

function findAiPoint(points: Point[], channel: number, maxChannel: number): Point | undefined {
  const ids = new Set(aiPointIds(channel).map((id) => id.toUpperCase()))
  return points.find((point) => isVisibleUniversalInput(point, maxChannel) && ids.has(point.id.trim().toUpperCase()))
}

/**
 * Trần kênh Universal Input, theo thứ tự ưu tiên nguồn sự thật (`ISS-PIO-13`).
 *
 * 1. `/system/capabilities` — bo nói nó có bao nhiêu kênh (gốc `BOARD_CAP_MAP`).
 * 2. Chính danh sách cấu hình backend vừa trả — vẫn là backend nói, chỉ kém
 *    trực tiếp hơn; dùng khi chưa đọc được capability.
 *
 * KHÔNG có bước 3 nào rơi về hằng viết cứng: danh sách rỗng cho trần 0, nghĩa
 * là "chưa biết kênh nào" chứ không phải "mặc định có 16 kênh". Đúng một con số
 * 16 viết cứng là thứ mà `F-PIO-008` đang dẹp.
 */
function universalInputCeiling(capabilities: SystemCapabilities | null, configs: AiInputConfig[]): number {
  const fromBoard = universalInputChannelCount(capabilities)
  if (fromBoard !== null) return fromBoard
  return configs.reduce((max, config) => Math.max(max, config.channel), 0)
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
