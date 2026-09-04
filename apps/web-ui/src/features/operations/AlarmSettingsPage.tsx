import { BellRing, Plus, RefreshCw, Save, SlidersHorizontal, Trash2 } from 'lucide-react'
import { AlarmRuleSimulation } from './AlarmRuleSimulation'
import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiClient } from '../../shared/api/client'
import { Button } from '../../shared/components/Button'
import { DirtyGuardModal } from '../../shared/components/DirtyGuardModal'
import { Panel } from '../../shared/components/Panel'
import { StatusBadge } from '../../shared/components/StatusBadge'
import { StateBlock } from '../../shared/components/StateBlock'
import { useToast } from '../../shared/components/Toast'
import { useDirtyGuard } from '../../shared/hooks/useDirtyGuard'
import { useI18n } from '../../shared/i18n'
import type { ActiveAlarmType, AlarmPriority, AlarmSetting, AlarmSource, AlarmSourceKind, AlarmType, DeferredAlarmType, ModbusMappingRow, SeverityRule, VirtualPoint } from '../../shared/types'
import { cn } from '../../shared/utils'

const maxAlarms = 64
const maxSourcesPerAlarm = 16
const maxBacnetPublished = 8
const activeAlarmTypes: ActiveAlarmType[] = [0, 1, 3]
const deferredAlarmTypes: DeferredAlarmType[] = [2, 4, 5, 6, 7]
type AlarmClearMode = NonNullable<AlarmSetting['clearMode']>

const priorities: AlarmPriority[] = ['low', 'medium', 'high', 'critical', 'flexible']
const clearModes: AlarmClearMode[] = ['auto', 'manual']
const severities: SeverityRule['severity'][] = ['critical', 'high', 'medium', 'low', 'info']
const severityOps: SeverityRule['op'][] = ['>=', '<=']
const sourceKinds: AlarmSourceKind[] = ['UI', 'AO', 'DO', 'VP', 'MB_RTU']

/**
 * Nhãn loại cảnh báo — `T57-2.14`.
 *
 * Trước đây bảng này chỉ có tiếng Anh (`1 - High/Low input`) trong khi nhãn
 * trường xung quanh nó là tiếng Việt. Người vận hành đọc một form nửa Việt nửa
 * Anh phải dịch nhẩm giữa hai ngôn ngữ ngay lúc đang đặt ngưỡng an toàn — đúng
 * chỗ không được phép đoán. Giữ SỐ loại vì đó là mã hợp đồng với backend và là
 * thứ xuất hiện trong log, nhưng phần mô tả đi theo ngôn ngữ đang chọn.
 */
function priorityGloss(priority: AlarmPriority, pick: PickText): string {
  if (priority === 'low') return pick('theo dõi, không cần xử lý ngay', 'monitor only, no immediate action')
  if (priority === 'medium') return pick('xử lý trong ca', 'handle within the shift')
  if (priority === 'high') return pick('xử lý ngay', 'act now')
  if (priority === 'critical') return pick('nguy cấp, dừng việc khác để xử lý', 'critical, drop everything else')
  return pick('mức tuỳ theo luật bên dưới', 'level decided by the rules below')
}

function severityGloss(severity: SeverityRule['severity'], pick: PickText): string {
  if (severity === 'critical') return pick('nguy cấp', 'critical')
  if (severity === 'high') return pick('cao', 'high')
  if (severity === 'medium') return pick('trung bình', 'medium')
  if (severity === 'low') return pick('thấp', 'low')
  return pick('chỉ để biết', 'informational')
}

function alarmTypeLabel(type: AlarmType, pick: PickText): string {
  const names: Record<AlarmType, string> = {
    0: pick('Tắt', 'Disabled'),
    1: pick('Ngưỡng cao/thấp của ngõ vào', 'High/low input'),
    2: pick('Lệch khỏi giá trị đặt', 'Setpoint deviation'),
    3: pick('Số giờ chạy tích luỹ', 'Runtime hours'),
    4: pick('Giám sát trạng thái quạt', 'Fan state supervision'),
    5: pick('Giám sát ngõ ra số', 'Digital output supervision'),
    6: pick('Giám sát ngõ ra analog', 'Analog output supervision'),
    7: pick('Giám sát chuỗi PI', 'PI-sequence supervision')
  }
  return `${type} - ${names[type]}`
}

const inputClass = 'h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)] disabled:cursor-not-allowed disabled:opacity-60'
const checkboxClass = 'h-4 w-4 accent-[var(--c-accent)]'

type PickText = ReturnType<typeof useI18n>['pick']

interface ValidationIssue {
  rowIndex?: number
  message: string
}

export function AlarmSettingsPage() {
  const { t, pick } = useI18n()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [rows, setRows] = useState<AlarmSetting[]>([])
  /* F-UX-12 (`REV-FE-UIUX-UC-2026-08-18`): bản chụp cấu hình cảnh báo mà backend
   * đang giữ. Không có mốc này thì không có cách nào biết bảng đang gõ dở khác
   * bảng đã lưu — và trang mất sạch bản nháp khi bấm một mục menu khác. */
  const [savedRows, setSavedRows] = useState<AlarmSetting[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [virtualPoints, setVirtualPoints] = useState<VirtualPoint[]>([])
  // `ISS-PIO-19` — slot ext của điểm Modbus, để chọn nguồn cảnh báo theo TÊN
  // điểm chứ không theo một con số trần.
  const [modbusSlots, setModbusSlots] = useState<ModbusMappingRow[]>([])
  const deepLinkApplied = useRef(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([apiClient.getAlarmSettings(), apiClient.getVirtualPoints(), loadModbusSlots()])
      .then(([items, virtualItems, slots]) => {
        if (!active) return
        setVirtualPoints(virtualItems)
        setModbusSlots(slots)
        const loaded = items.map((item) => normalizeLoadedAlarm(item, virtualItems))
        setRows(loaded)
        setSavedRows(loaded)
        setLoadError('')
      })
      .catch((error) => {
        if (!active) return
        const message = errorMessage(error)
        setLoadError(message)
        toast.push('error', `${t('error')}: ${message}`)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [t, toast])

  useEffect(() => {
    setSelectedIndex((index) => rows.length === 0 ? 0 : Math.min(index, rows.length - 1))
  }, [rows.length])

  /* Deep-link từ tab "Cảnh báo & Lưu trữ" của trang Inputs (Plan 55 task 1.6):
   * `?newSource=UI:5` tạo một alarm mới với source điền sẵn `{kind:'UI',
   * channel:5}`; `?edit=ALM-014` chỉ chọn sẵn dòng có ID đó. Chỉ áp dụng MỘT
   * lần khi rows đã tải xong (`deepLinkApplied`) — không lặp lại nếu rows đổi
   * do save/reload sau đó, và không đè lên lựa chọn thủ công của người dùng. */
  useEffect(() => {
    if (deepLinkApplied.current || loading) return
    const newSource = searchParams.get('newSource')
    const editId = searchParams.get('edit')
    if (!newSource && !editId) return
    deepLinkApplied.current = true
    if (newSource) {
      const match = /^(UI|AO|DO|VP)[:-](\d+)$/i.exec(newSource)
      if (match && rows.length < maxAlarms) {
        const kind = normalizeSourceKind(match[1])
        const channel = Number(match[2])
        setRows((current) => [...current, createAlarm(current, virtualPoints, makeSource(kind, channel, virtualPoints))])
        setSelectedIndex(rows.length)
      }
    } else if (editId) {
      const index = rows.findIndex((row) => row.id === editId)
      if (index >= 0) setSelectedIndex(index)
    }
    setSearchParams((params) => {
      params.delete('newSource')
      params.delete('edit')
      return params
    }, { replace: true })
  }, [loading, rows, searchParams, setSearchParams, virtualPoints])

  const selected = rows[selectedIndex]
  const issues = useMemo(() => validateAlarms(rows, pick, virtualPoints), [rows, pick, virtualPoints])
  const selectedIssues = issues.filter((issue) => issue.rowIndex === selectedIndex)
  const dirty = useMemo(() => JSON.stringify(rows) !== JSON.stringify(savedRows), [rows, savedRows])
  const dirtyGuard = useDirtyGuard(dirty)
  const enabledCount = rows.filter((row) => row.enabled).length
  const publishedCount = rows.filter((row) => row.enabled && row.publishBacnet).length
  const hasErrors = issues.length > 0

  function updateAlarm(index: number, patch: Partial<AlarmSetting>) {
    setStatusMessage('')
    setRows((current) => current.map((row, itemIndex) => itemIndex === index ? normalizeDraftAlarm({ ...row, ...patch }, virtualPoints) : row))
  }

  function updateParams(index: number, patch: AlarmSetting['params']) {
    const row = rows[index]
    if (!row) return
    updateAlarm(index, { params: { ...row.params, ...patch } })
  }

  function updateSource(alarmIndex: number, sourceIndex: number, patch: Partial<AlarmSource>) {
    const row = rows[alarmIndex]
    if (!row) return
    const sources = row.sources.map((source, itemIndex) => itemIndex === sourceIndex ? normalizeSource({ ...source, ...patch }, virtualPoints) : source)
    updateAlarm(alarmIndex, { sources })
  }

  function addSource(alarmIndex: number) {
    const row = rows[alarmIndex]
    if (!row || row.sources.length >= maxSourcesPerAlarm) return
    updateAlarm(alarmIndex, { sources: [...row.sources, nextSource(row.sources, virtualPoints)] })
  }

  function removeSource(alarmIndex: number, sourceIndex: number) {
    const row = rows[alarmIndex]
    if (!row) return
    updateAlarm(alarmIndex, { sources: row.sources.filter((_, itemIndex) => itemIndex !== sourceIndex) })
  }

  function addAlarm() {
    if (rows.length >= maxAlarms) return
    const next = createAlarm(rows, virtualPoints)
    setRows((current) => [...current, next])
    setSelectedIndex(rows.length)
    setStatusMessage('')
  }

  function removeSelected() {
    if (!selected) return
    setRows((current) => current.filter((_, index) => index !== selectedIndex))
    setSelectedIndex((index) => Math.max(0, index - 1))
    setStatusMessage('')
  }

  async function reloadSettings() {
    setLoading(true)
    try {
      const [items, virtualItems] = await Promise.all([apiClient.getAlarmSettings(), apiClient.getVirtualPoints()])
      setVirtualPoints(virtualItems)
      const loaded = items.map((item) => normalizeLoadedAlarm(item, virtualItems))
      setRows(loaded)
      setSavedRows(loaded)
      setLoadError('')
      setStatusMessage(pick('Đã tải lại từ backend.', 'Reloaded from backend.'))
    } catch (error) {
      const message = errorMessage(error)
      setLoadError(message)
      toast.push('error', `${t('error')}: ${message}`)
    } finally {
      setLoading(false)
    }
  }

  /* Trả `true` chỉ khi backend đã nhận — `DirtyGuardModal` dùng giá trị này để
   * quyết định có rời trang hay không (F-UX-12). */
  async function saveSettings(): Promise<boolean> {
    const saveIssues = validateAlarms(rows, pick, virtualPoints)
    if (saveIssues.length > 0) {
      toast.push('error', saveIssues[0].message)
      return false
    }
    const payload = rows.map((row) => normalizeForSave(row, virtualPoints))
    setSaving(true)
    try {
      const result = await apiClient.putAlarmSettings(payload)
      const [fresh, virtualItems] = await Promise.all([apiClient.getAlarmSettings(), apiClient.getVirtualPoints()])
      setVirtualPoints(virtualItems)
      const loaded = fresh.map((item) => normalizeLoadedAlarm(item, virtualItems))
      setRows(loaded)
      setSavedRows(loaded)
      setStatusMessage(`${t('alarmSettingsSaved')} (${result.reload})`)
      toast.push('success', t('alarmSettingsSaved'))
      return true
    } catch (error) {
      const message = errorMessage(error)
      setStatusMessage(message)
      toast.push('error', `${t('alarmSettingsSaveError')}: ${message}`)
      return false
    } finally {
      setSaving(false)
    }
  }

  /* FE-DATA-02 (review FE 2026-08-05): `loadError` trước đây chỉ hiện thành một
   * badge "LOAD ERROR" nằm dưới đáy panel trạng thái, còn danh sách alarm thì
   * hiện "No data" — người dùng đọc trang từ trên xuống sẽ kết luận thiết bị
   * không có alarm nào, chứ không phải là không đọc được cấu hình alarm. */
  if (loadError && rows.length === 0) {
    return (
      <StateBlock
        state="error"
        title={pick('Không tải được cấu hình cảnh báo', 'Could not load alarm settings')}
        detail={loadError}
        onRetry={() => { void reloadSettings() }}
      />
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--c-text)]">{t('alarmSettingsTitle')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{t('alarmSettingsSubtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={<RefreshCw className="h-4 w-4" />} loading={loading} onClick={() => void reloadSettings()}>
            {pick('Tải lại', 'Reload')}
          </Button>
          <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={saving} disabled={loading || hasErrors} onClick={() => void saveSettings()}>
            {t('save')}
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Panel
          title={t('alarmSettingsList')}
          subtitle={`${rows.length}/${maxAlarms}`}
          action={<Button size="sm" icon={<Plus className="h-4 w-4" />} disabled={rows.length >= maxAlarms} onClick={addAlarm}>{t('add')}</Button>}
        >
          <div className="max-h-[calc(100vh-260px)] space-y-1 overflow-y-auto pr-1">
            {rows.map((row, index) => (
              <button
                key={`${row.id}-${index}`}
                type="button"
                onClick={() => setSelectedIndex(index)}
                className={cn(
                  'flex min-h-14 w-full items-center gap-3 rounded-[var(--radius)] border px-3 py-2 text-left text-sm transition',
                  selectedIndex === index
                    ? 'border-[var(--c-accent)] bg-[var(--c-surface-2)] text-[var(--c-text)]'
                    : 'border-transparent text-[var(--c-text-dim)] hover:border-[var(--c-border)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]'
                )}
              >
                <BellRing className="h-4 w-4 shrink-0 text-[var(--c-accent)]" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{row.id || pick('Chưa có ID', 'Missing ID')}</span>
                  <span className="block truncate text-xs">{row.label || alarmTypeLabel(row.alarmType, pick)}</span>
                </span>
                <StatusBadge state={row.enabled ? 'online' : 'inactive'} label={row.enabled ? 'ON' : 'OFF'} />
              </button>
            ))}
            {loading && <div className="rounded-[var(--radius)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">{t('loading')}</div>}
            {!loading && rows.length === 0 && <div className="rounded-[var(--radius)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">{t('empty')}</div>}
          </div>
        </Panel>

        <Panel
          title={selected ? `${selected.id || 'ALM'} - ${selected.label || alarmTypeLabel(selected.alarmType, pick)}` : t('empty')}
          subtitle={selected ? alarmTypeLabel(selected.alarmType, pick) : undefined}
          action={selected && <Button variant="danger" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={removeSelected}>{pick('Xoá', 'Remove')}</Button>}
        >
          {selected ? (
            <AlarmEditor
              row={selected}
              virtualPoints={virtualPoints}
              modbusSlots={modbusSlots}
              rowIndex={selectedIndex}
              issues={selectedIssues}
              publishedCount={publishedCount}
              onChange={(patch) => updateAlarm(selectedIndex, patch)}
              onTypeChange={(alarmType) => updateAlarm(selectedIndex, { alarmType, enabled: isDeferredType(alarmType) ? false : selected.enabled, params: defaultParamsForType(alarmType, selected.params) })}
              onParamsChange={(patch) => updateParams(selectedIndex, patch)}
              onSourceChange={(sourceIndex, patch) => updateSource(selectedIndex, sourceIndex, patch)}
              onSourceAdd={() => addSource(selectedIndex)}
              onSourceRemove={(sourceIndex) => removeSource(selectedIndex, sourceIndex)}
            />
          ) : (
            <div className="rounded-[var(--radius)] bg-[var(--c-surface-2)] p-4 text-sm text-[var(--c-text-dim)]">{pick('Thêm cảnh báo đầu tiên để cấu hình.', 'Add the first alarm to configure settings.')}</div>
          )}
        </Panel>
      </div>

      <Panel title={pick('Trạng thái cấu hình', 'Configuration status')}>
        <div className="flex flex-wrap gap-3">
          {/* `T57-2.14`: bốn chip này là câu trả lời cho "cấu hình hiện ra sao",
              không phải từ vựng trạng thái dùng chung với HMI — nên chúng nói
              tiếng của người đọc, chỉ giữ nguyên "BACnet" (tên giao thức). */}
          <StatusBadge state={loadError ? 'fault' : 'online'} label={loadError ? pick('LỖI TẢI', 'LOAD ERROR') : pick('ĐÃ TẢI', 'LOADED')} />
          <StatusBadge state={hasErrors ? 'warning' : 'online'} label={hasErrors ? pick(`${issues.length} LỖI CẤU HÌNH`, `${issues.length} INVALID`) : pick('HỢP LỆ', 'VALID')} />
          <StatusBadge state="online" label={pick(`${enabledCount} ĐANG BẬT`, `${enabledCount} ENABLED`)} />
          <StatusBadge state={publishedCount > maxBacnetPublished ? 'critical' : 'online'} label={`${publishedCount}/${maxBacnetPublished} BACnet`} />
        </div>
        {(statusMessage || issues.length > 0) && (
          <div className="mt-3 space-y-1 text-sm text-[var(--c-text-dim)]">
            {statusMessage && <p>{statusMessage}</p>}
            {issues.slice(0, 6).map((issue) => <p key={`${issue.rowIndex ?? 'global'}-${issue.message}`}>{issue.message}</p>)}
          </div>
        )}
      </Panel>
      <DirtyGuardModal
        guard={dirtyGuard}
        saving={saving}
        title={pick('Cấu hình cảnh báo chưa lưu', 'Unsaved alarm settings')}
        message={pick(
          'Bạn có thay đổi cấu hình cảnh báo chưa lưu. Rời trang sẽ mất các thay đổi này trừ khi lưu trước.',
          'You have unsaved alarm setting changes. Leaving this page will discard them unless you save first.'
        )}
        onSave={saveSettings}
        onDiscard={() => setRows(savedRows)}
      />
    </div>
  )
}

function AlarmEditor({
  row,
  virtualPoints,
  rowIndex,
  issues,
  publishedCount,
  onChange,
  onTypeChange,
  onParamsChange,
  onSourceChange,
  onSourceAdd,
  onSourceRemove,
  modbusSlots = []
}: {
  row: AlarmSetting
  virtualPoints: VirtualPoint[]
  modbusSlots?: ModbusMappingRow[]
  rowIndex: number
  issues: ValidationIssue[]
  publishedCount: number
  onChange: (patch: Partial<AlarmSetting>) => void
  onTypeChange: (alarmType: AlarmType) => void
  onParamsChange: (patch: AlarmSetting['params']) => void
  onSourceChange: (sourceIndex: number, patch: Partial<AlarmSource>) => void
  onSourceAdd: () => void
  onSourceRemove: (sourceIndex: number) => void
}) {
  const { pick } = useI18n()
  const deferred = isDeferredType(row.alarmType)
  return (
    <div className="space-y-5">
      {issues.length > 0 && (
        <div className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-sm text-[var(--c-warn-fg)]">
          {issues.map((issue) => <div key={issue.message}>{issue.message}</div>)}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <TextField label="ID" value={row.id} onChange={(id) => onChange({ id })} />
        <TextField label={pick('Nhãn', 'Label')} value={row.label} onChange={(label) => onChange({ label })} />
        <SelectField label={pick('Loại cảnh báo', 'Alarm type')} value={String(row.alarmType)} onChange={(value) => onTypeChange(Number(value) as AlarmType)}>
          {activeAlarmTypes.map((type) => <option key={type} value={type}>{alarmTypeLabel(type, pick)}</option>)}
          <optgroup label={pick('Chưa hỗ trợ — không bật được', 'Not supported yet — cannot be enabled')}>
            {deferredAlarmTypes.map((type) => <option key={type} value={type} disabled>{alarmTypeLabel(type, pick)}</option>)}
          </optgroup>
        </SelectField>
        {/* `T57-2.14`: mã trạng thái viết hoa (`HIGH`, `CRITICAL`) là TỪ VỰNG
            DÙNG CHUNG với nhật ký cảnh báo và với HMI tại tủ — `UX-SYSTEM-001`
            §1.5 buộc ba bề mặt nói cùng một chữ, nên không dịch. Phần giải
            nghĩa đi kèm ngay trong cùng dòng để người vận hành không phải học
            thuộc bảng mã. */}
        <SelectField label={pick('Mức ưu tiên', 'Priority')} value={row.priority} onChange={(priority) => onChange({ priority: priority as AlarmPriority })}>
          {priorities.map((priority) => <option key={priority} value={priority}>{`${priority.toUpperCase()} · ${priorityGloss(priority, pick)}`}</option>)}
        </SelectField>
        <SelectField
          label={pick('Cách xoá cảnh báo', 'Clear mode')}
          value={getClearMode(row)}
          onChange={(clearMode) => onChange({ clearMode: clearMode as AlarmClearMode })}
        >
          {clearModes.map((mode) => (
            <option key={mode} value={mode}>
              {mode === 'auto'
                ? pick('Tự xoá khi điều kiện hết', 'Clears automatically when the condition ends')
                : pick('Người vận hành phải xác nhận', 'An operator must acknowledge it')}
            </option>
          ))}
        </SelectField>
        <NumberField
          label={pick('Trễ kích hoạt (giây)', 'Activation delay (s)')}
          hint={pick('Điều kiện phải giữ liên tục đủ số giây này thì cảnh báo mới bật.', 'The condition must hold this long before the alarm raises.')}
          min={0}
          value={row.delayS}
          onChange={(delayS) => onChange({ delayS })}
        />
        <label className="flex items-end gap-2 pb-3 text-sm font-semibold text-[var(--c-text)]">
          <input className={checkboxClass} type="checkbox" checked={row.enabled} disabled={deferred} onChange={(event) => onChange({ enabled: event.target.checked })} />
          {pick('Bật cảnh báo', 'Enabled')}
        </label>
      </section>

      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[var(--c-text)]">{pick('Nguồn kích hoạt', 'Sources')}</h3>
            <p className="text-xs text-[var(--c-text-dim)]">{pick('Cảnh báo bật khi BẤT KỲ nguồn nào thoả điều kiện. Mã điểm được suy ra từ loại nguồn và số kênh.', 'The alarm raises when ANY source meets the condition. The point ID is derived from the source kind and channel.')}</p>
          </div>
          <Button size="sm" icon={<Plus className="h-4 w-4" />} disabled={row.sources.length >= maxSourcesPerAlarm} onClick={onSourceAdd}>{pick('Thêm nguồn', 'Add source')}</Button>
        </div>
        <div className="space-y-2">
          {row.sources.map((source, sourceIndex) => (
            <SourceRow
              key={`${source.kind}-${source.channel}-${sourceIndex}`}
              source={source}
              virtualPoints={virtualPoints}
              modbusSlots={modbusSlots}
              onChange={(patch) => onSourceChange(sourceIndex, patch)}
              onRemove={() => onSourceRemove(sourceIndex)}
            />
          ))}
          {row.sources.length === 0 && <div className="rounded-[var(--radius)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">{pick('Chưa có nguồn.', 'No sources yet.')}</div>}
        </div>
      </section>

      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
        <div className="mb-3 flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-[var(--c-accent)]" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-[var(--c-text)]">{pick('Tham số', 'Parameters')}</h3>
        </div>
        <AlarmParamsEditor row={row} onChange={onParamsChange} />
      </section>

      {/* `T57-2.13`: bốn tham số ngưỡng tương tác với nhau, và kết quả của một
          tổ hợp chỉ lộ ra khi giá trị thật đi qua ngưỡng — tức là sau khi cấu
          hình đã ở trên thiết bị. Ô thử này rút vòng lặp đó về vài giây. */}
      <AlarmRuleSimulation setting={row} />

      <section className="grid gap-4 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4 md:grid-cols-[minmax(0,1fr)_180px]">
        <label className="flex items-center gap-2 text-sm font-semibold text-[var(--c-text)]">
          <input
            className={checkboxClass}
            type="checkbox"
            checked={Boolean(row.publishBacnet)}
            onChange={(event) => onChange({ publishBacnet: event.target.checked, notificationClass: event.target.checked ? row.notificationClass ?? 1 : undefined })}
          />
          {/* Tên đối tượng BACnet giữ nguyên: nó là tên riêng trong chuẩn, dịch
              ra thì không tra được tài liệu. Chú giải nằm ở dòng dưới. */}
          {pick('Công bố lên BACnet (Event Enrollment)', 'Publish to BACnet (Event Enrollment)')}
          <StatusBadge state={publishedCount > maxBacnetPublished ? 'critical' : 'online'} label={`${publishedCount}/${maxBacnetPublished}`} />
        </label>
        <NumberField
          label="Notification Class"
          hint={pick('Lớp thông báo BACnet (1-4) quyết định thiết bị giám sát nào nhận sự kiện này.', 'The BACnet notification class (1-4) decides which supervisory devices receive this event.')}
          min={1}
          max={4}
          integer
          disabled={!row.publishBacnet}
          value={row.notificationClass ?? 1}
          onChange={(notificationClass) => onChange({ notificationClass })}
        />
      </section>

      {deferred && (
        <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">
          {pick('Loại 2/4/5/6/7 chưa được hỗ trợ. Giao diện khoá ô "Bật cảnh báo" để tránh gửi xuống một cấu hình mà backend sẽ từ chối.', 'Types 2/4/5/6/7 are not supported yet. The UI keeps "Enabled" locked so it will not send a configuration the backend would reject.')}
        </div>
      )}
      <div className="text-xs text-[var(--c-text-dim)]">#{rowIndex + 1}</div>
    </div>
  )
}

/* `ISS-PIO-19` — danh sách slot Modbus là TUỲ CHỌN với trang này.
 *
 * Một tủ không dùng Modbus vẫn phải đặt được cảnh báo cho UI/AO/DO/VP, nên lỗi
 * ở đây trả danh sách rỗng thay vì làm hỏng cả trang cảnh báo. Rỗng đã được
 * `normalizeSource` hiểu là "chưa biết", không phải "không có". */
async function loadModbusSlots(): Promise<ModbusMappingRow[]> {
  try {
    const mapping = await apiClient.getModbusMapping()
    return mapping.rows ?? []
  } catch {
    return []
  }
}

function SourceRow({ source, virtualPoints, modbusSlots = [], onChange, onRemove }: { source: AlarmSource; virtualPoints: VirtualPoint[]; modbusSlots?: ModbusMappingRow[]; onChange: (patch: Partial<AlarmSource>) => void; onRemove: () => void }) {
  const { pick } = useI18n()
  const channels = channelOptions(source.kind, virtualPoints, modbusSlots)
  return (
    <div className="grid gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3 sm:grid-cols-[120px_120px_minmax(0,1fr)_auto]">
      <SelectField label={pick('Loại nguồn', 'Source kind')} value={source.kind} onChange={(kind) => onChange(normalizeSource({ kind: kind as AlarmSourceKind, channel: firstChannel(kind as AlarmSourceKind, virtualPoints, modbusSlots) }, virtualPoints, modbusSlots))}>
        {sourceKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
      </SelectField>
      <SelectField label={pick('Kênh', 'Channel')} value={String(source.channel)} onChange={(channel) => onChange({ channel: Number(channel) })}>
        {channels.map((channel) => {
          const virtual = source.kind === 'VP' ? virtualSourceFor('VP', channel, virtualPoints) : undefined
          const modbus = source.kind === 'MB_RTU' ? modbusSlotLabel(channel, modbusSlots) : undefined
          const label = virtual?.tag ?? modbus
          return <option key={channel} value={channel}>{label ? `${channel} - ${label}` : channel}</option>
        })}
      </SelectField>
      <TextField label={source.kind === 'VP' ? pick('Tên gọi (tag)', 'Tag') : pick('Mã điểm', 'Point ID')} value={source.kind === 'VP' ? virtualSourceFor('VP', source.channel, virtualPoints)?.tag ?? source.pointId : source.pointId} disabled onChange={() => undefined} />
      {source.kind === 'MB_RTU' && channels.length === 0 && (
        /* Nói ra "chưa có điểm Modbus nào" thay vì hiện một ô chọn rỗng: ô rỗng
         * để người dùng tự đoán là mình làm sai ở đâu. */
        <p className="text-xs text-[var(--c-warn-fg)] sm:col-span-4">{pick('Chưa có điểm Modbus nào được cấp slot — bật điểm và thiết bị ở trang Modbus trước.', 'No Modbus point has a slot yet — enable the point and its device on the Modbus page first.')}</p>
      )}
      <div className="flex items-end">
        <Button variant="danger" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={onRemove}>{pick('Xoá', 'Remove')}</Button>
      </div>
    </div>
  )
}

function AlarmParamsEditor({ row, onChange }: { row: AlarmSetting; onChange: (patch: AlarmSetting['params']) => void }) {
  const { pick } = useI18n()
  if (row.alarmType === 1) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-5">
          {/* Bốn chữ viết tắt HH/H/L/LL là quy ước ngưỡng dùng chung với
              firmware và với nhãn hiện trên nhật ký, nên giữ trong ngoặc thay
              vì thay bằng chữ khác — nhưng nhãn chính phải nói ra nghĩa. */}
          <NumberField label={pick('Rất cao (HH)', 'Very high (HH)')} value={row.params.hh ?? 0} onChange={(hh) => onChange({ hh })} />
          <NumberField label={pick('Cao (H)', 'High (H)')} value={row.params.h ?? 0} onChange={(h) => onChange({ h })} />
          <NumberField label={pick('Thấp (L)', 'Low (L)')} value={row.params.l ?? 0} onChange={(l) => onChange({ l })} />
          <NumberField label={pick('Rất thấp (LL)', 'Very low (LL)')} value={row.params.ll ?? 0} onChange={(ll) => onChange({ ll })} />
          <NumberField
            label={pick('Vùng trễ (hysteresis)', 'Hysteresis')}
            hint={pick('Giá trị phải quay lại quá ngưỡng đúng khoảng này thì cảnh báo mới tự xoá — chống rung quanh ngưỡng.', 'The value must come back past the threshold by this margin before the alarm clears — it stops chattering.')}
            min={0}
            value={row.params.hysteresis ?? 0}
            onChange={(hysteresis) => onChange({ hysteresis })}
          />
        </div>
        {isFlexiblePriority(row) && <SeverityRulesEditor rules={getSeverityRules(row.params)} onChange={(severityRules) => onChange({ severityRules })} />}
      </div>
    )
  }
  if (row.alarmType === 3) {
    return (
      <div className="space-y-4">
        <div className="max-w-xs">
          <NumberField
            label={pick('Số giờ chạy tích luỹ', 'Runtime hours')}
            hint={pick('Cảnh báo bật khi thiết bị đã chạy đủ số giờ này — dùng để nhắc bảo trì.', 'The alarm raises once the device has run this many hours — used for maintenance reminders.')}
            min={0.1}
            step={0.1}
            value={row.params.runtimeHours ?? 1}
            onChange={(runtimeHours) => onChange({ runtimeHours })}
          />
        </div>
        {isFlexiblePriority(row) && <SeverityRulesEditor rules={getSeverityRules(row.params)} onChange={(severityRules) => onChange({ severityRules })} />}
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--c-text-dim)]">{pick('Loại cảnh báo này chưa có tham số nào đang hoạt động.', 'This alarm type has no active parameters yet.')}</p>
      {isFlexiblePriority(row) && <SeverityRulesEditor rules={getSeverityRules(row.params)} onChange={(severityRules) => onChange({ severityRules })} />}
    </div>
  )
}

function SeverityRulesEditor({ rules, onChange }: { rules: SeverityRule[]; onChange: (rules: SeverityRule[]) => void }) {
  const { pick } = useI18n()
  const updateRule = (index: number, patch: Partial<SeverityRule>) => onChange(rules.map((rule, ruleIndex) => ruleIndex === index ? normalizeSeverityRule({ ...rule, ...patch }) : rule))
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Luật chọn mức nghiêm trọng', 'Severity rules')}</h4>
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => onChange([...rules, defaultSeverityRule()])}>{pick('Thêm luật', 'Add rule')}</Button>
      </div>
      <div className="space-y-2">
        {rules.map((rule, index) => (
          <div key={`${rule.severity}-${rule.op}-${index}`} className="grid gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3 sm:grid-cols-[minmax(0,1fr)_100px_minmax(120px,1fr)_auto]">
            <SelectField label={pick('Mức nghiêm trọng', 'Severity')} value={rule.severity} onChange={(severity) => updateRule(index, { severity: severity as SeverityRule['severity'] })}>
              {severities.map((severity) => <option key={severity} value={severity}>{`${severity.toUpperCase()} · ${severityGloss(severity, pick)}`}</option>)}
            </SelectField>
            <SelectField label={pick('Phép so sánh', 'Operator')} value={rule.op} onChange={(op) => updateRule(index, { op: op as SeverityRule['op'] })}>
              {severityOps.map((op) => <option key={op} value={op}>{op === '>=' ? pick('≥ (lớn hơn hoặc bằng)', '≥ (at least)') : pick('≤ (nhỏ hơn hoặc bằng)', '≤ (at most)')}</option>)}
            </SelectField>
            <NumberField label={pick('Ngưỡng', 'Threshold')} value={rule.value} onChange={(value) => updateRule(index, { value })} />
            <div className="flex items-end">
              <Button variant="danger" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={() => onChange(rules.filter((_, ruleIndex) => ruleIndex !== index))}>{pick('Xoá', 'Remove')}</Button>
            </div>
          </div>
        ))}
        {rules.length === 0 && <div className="rounded-[var(--radius)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">{pick('Mức ưu tiên FLEXIBLE cần ít nhất một luật.', 'FLEXIBLE priority needs at least one rule.')}</div>}
      </div>
    </div>
  )
}

/**
 * `T57-2.14` — `hint` là chỗ giữ THUẬT NGỮ GIAO THỨC mà không làm form nói hai
 * thứ tiếng. Những chữ như "Event Enrollment" hay "Notification Class" là tên
 * riêng trong BACnet: dịch chúng ra tiếng Việt sẽ làm người kỹ thuật không tra
 * được tài liệu chuẩn, còn để trần thì người vận hành không hiểu. Giữ nguyên
 * tên và giải thích ngay dưới nhãn là cách duy nhất đúng cho cả hai phía.
 */
function FieldGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{label}</span>
      {hint && <span className="block text-[11px] font-normal normal-case text-[var(--c-text-dim)]">{hint}</span>}
      {children}
    </label>
  )
}

function TextField({ label, hint, value, disabled, onChange }: { label: string; hint?: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  return (
    <FieldGroup label={label} hint={hint}>
      <input className={inputClass} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </FieldGroup>
  )
}

function NumberField({ label, hint, value, min, max, step = 1, integer, disabled, onChange }: { label: string; hint?: string; value: number; min?: number; max?: number; step?: number; integer?: boolean; disabled?: boolean; onChange: (value: number) => void }) {
  return (
    <FieldGroup label={label} hint={hint}>
      <input
        className={inputClass}
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(normalizeNumber(event.currentTarget.valueAsNumber, min, max, integer))}
      />
    </FieldGroup>
  )
}

function SelectField({ label, hint, value, children, onChange }: { label: string; hint?: string; value: string; children: React.ReactNode; onChange: (value: string) => void }) {
  return (
    <FieldGroup label={label} hint={hint}>
      <select className={inputClass} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </FieldGroup>
  )
}

function normalizeLoadedAlarm(row: AlarmSetting, virtualPoints: VirtualPoint[] = []): AlarmSetting {
  return normalizeDraftAlarm({
    ...row,
    publishBacnet: Boolean(row.publishBacnet),
    params: row.params ?? {},
    sources: Array.isArray(row.sources) ? row.sources : []
  }, virtualPoints)
}

function normalizeDraftAlarm(row: AlarmSetting, virtualPoints: VirtualPoint[] = []): AlarmSetting {
  return {
    ...row,
    alarmType: isAlarmType(row.alarmType) ? row.alarmType : 0,
    clearMode: clearModes.includes(getClearMode(row)) ? getClearMode(row) : 'auto',
    priority: priorities.includes(row.priority) ? row.priority : 'medium',
    delayS: Number.isFinite(row.delayS) ? row.delayS : 0,
    sources: row.sources.map((source) => normalizeSource(source, virtualPoints)),
    params: normalizeParams(row.params ?? {})
  }
}

function normalizeForSave(row: AlarmSetting, virtualPoints: VirtualPoint[] = []): AlarmSetting {
  const publishBacnet = Boolean(row.publishBacnet)
  const next: AlarmSetting = {
    id: row.id.trim(),
    label: row.label.trim(),
    enabled: row.enabled,
    alarmType: row.alarmType,
    sources: row.sources.map((source) => normalizeSource(source, virtualPoints)),
    priority: row.priority,
    clearMode: getClearMode(row),
    delayS: row.delayS,
    publishBacnet,
    params: defaultParamsForType(row.alarmType, row.params)
  }
  if (publishBacnet) next.notificationClass = row.notificationClass ?? 1
  return next
}

function createAlarm(rows: AlarmSetting[], virtualPoints: VirtualPoint[], source?: AlarmSource): AlarmSetting {
  const id = nextAlarmId(rows)
  return {
    id,
    label: `Alarm ${id.replace(/^ALM-/, '')}`,
    enabled: true,
    alarmType: 1,
    sources: [source ?? nextSource([], virtualPoints)],
    priority: 'medium',
    clearMode: 'auto',
    delayS: 0,
    publishBacnet: false,
    params: { hh: 100, h: 90, l: 10, ll: 0, hysteresis: 0 }
  }
}

function nextAlarmId(rows: AlarmSetting[]): string {
  const used = new Set(rows.map((row) => row.id.trim().toUpperCase()))
  for (let index = 1; index <= maxAlarms; index += 1) {
    const id = `ALM-${String(index).padStart(3, '0')}`
    if (!used.has(id)) return id
  }
  return `ALM-${Date.now()}`
}

function nextSource(sources: AlarmSource[], virtualPoints: VirtualPoint[]): AlarmSource {
  const used = new Set(sources.map((source) => `${source.kind}:${source.channel}`))
  for (const kind of sourceKinds) {
    for (const channel of channelOptions(kind, virtualPoints)) {
      if (!used.has(`${kind}:${channel}`)) return makeSource(kind, channel, virtualPoints)
    }
  }
  return makeSource('UI', 1, virtualPoints)
}

function normalizeSource(source: Partial<AlarmSource>, virtualPoints: VirtualPoint[] = [], modbusSlots: ModbusMappingRow[] = []): AlarmSource {
  let kind = normalizeSourceKind(source.kind)
  let channels = channelOptions(kind, virtualPoints, modbusSlots)
  /* `ISS-PIO-19` — danh sách slot Modbus RỖNG nghĩa là "chưa biết", KHÔNG phải
   * "không có". Viết lại nguồn khi chưa biết sẽ âm thầm đổi một cảnh báo đã lưu
   * sang điểm khác chỉ vì trang chưa tải xong danh sách Modbus. */
  if (kind === 'MB_RTU' && channels.length === 0) {
    const declared = normalizeNumber(source.channel ?? 1, 1, maxExtSlots, true)
    return makeSource(kind, declared, virtualPoints, source.pointId)
  }
  if (kind === 'VP' && channels.length === 0) {
    kind = 'UI'
    channels = channelOptions(kind, virtualPoints)
  }
  const fallbackChannel = channels[0] ?? 1
  const max = Math.max(...channels, fallbackChannel)
  const rawChannel = normalizeNumber(source.channel ?? fallbackChannel, 1, max, true)
  const channel = channels.includes(rawChannel) ? rawChannel : fallbackChannel
  return makeSource(kind, channel, virtualPoints, source.pointId)
}

function makeSource(kind: AlarmSourceKind, channel: number, virtualPoints: VirtualPoint[] = [], fallbackPointId = ''): AlarmSource {
  return { kind, channel, pointId: pointIdFor(kind, channel, virtualPoints, fallbackPointId) }
}

function pointIdFor(kind: AlarmSourceKind, channel: number, virtualPoints: VirtualPoint[] = [], fallbackPointId = ''): string {
  if (kind === 'VP' && !virtualSourceFor(kind, channel, virtualPoints)) return fallbackPointId.trim().toUpperCase()
  if (kind === 'VP') return `VP${channel}`
  /* `ISS-PIO-19` — nguồn Modbus mang danh theo SLOT ext, không theo `kind`:
   * `MB_RTU-03` là một chuỗi Core không phân giải được, và Core từ chối MỘT
   * dòng là bỏ nạp TOÀN BỘ cấu hình cảnh báo. */
  if (kind === 'MB_RTU') return `EXT-${String(channel).padStart(2, '0')}`
  return `${kind}-${String(channel).padStart(2, '0')}`
}

/** `ISS-PIO-19` — số slot `plc_shm.ext[]`, khớp `kxNEXT` phía web-api. */
const maxExtSlots = 256

function maxChannel(kind: AlarmSourceKind): number {
  if (kind === 'UI') return 16
  if (kind === 'AO' || kind === 'DO') return 4
  if (kind === 'MB_RTU') return maxExtSlots
  return 464
}

/** `ISS-PIO-19` — slot ext của các điểm Modbus ĐANG cấu hình, kèm nhãn.
 *
 *  Liệt kê cả 256 slot là bắt người vận hành chọn một con số trần không nói lên
 *  điều gì; chỉ liệt kê slot có điểm thật, và hiện tên điểm cạnh số. */
function modbusSlotOptions(modbusSlots: ModbusMappingRow[]): number[] {
  return [...new Set(modbusSlots
    .filter((row) => row.enabled && (row.ext_index ?? 0) >= 1 && (row.ext_index ?? 0) <= maxExtSlots)
    .map((row) => row.ext_index as number))].sort((a, b) => a - b)
}

function modbusSlotLabel(channel: number, modbusSlots: ModbusMappingRow[]): string | undefined {
  const row = modbusSlots.find((item) => item.ext_index === channel)
  return row ? (row.tag_name || row.point_id) : undefined
}

function channelOptions(kind: AlarmSourceKind, virtualPoints: VirtualPoint[], modbusSlots: ModbusMappingRow[] = []): number[] {
  if (kind === 'MB_RTU') return modbusSlotOptions(modbusSlots)
  if (kind !== 'VP') {
    return Array.from({ length: maxChannel(kind) }, (_, index) => index + 1)
  }
  const channels = virtualPoints
    .filter(isAlarmVirtualPoint)
    .map((item) => virtualChannel(item.id))
    .filter((channel): channel is number => channel !== undefined)
  return [...new Set(channels)].sort((a, b) => a - b)
}

function firstChannel(kind: AlarmSourceKind, virtualPoints: VirtualPoint[], modbusSlots: ModbusMappingRow[] = []): number {
  return channelOptions(kind, virtualPoints, modbusSlots)[0] ?? 1
}

function virtualChannel(id: string): number | undefined {
  const match = id.trim().toUpperCase().match(/^(?:VP|AV)[-_]?0*(\d+)$/)
  if (!match) return undefined
  const channel = Number(match[1])
  return channel >= 1 && channel <= maxChannel('VP') ? channel : undefined
}

function virtualSourceFor(kind: AlarmSourceKind, channel: number, virtualPoints: VirtualPoint[]): VirtualPoint | undefined {
  if (kind !== 'VP') return undefined
  return virtualPoints.find((item) => isAlarmVirtualPoint(item) && virtualChannel(item.id) === channel)
}

function normalizeSourceKind(kind: unknown): AlarmSourceKind {
  const value = String(kind ?? '').toUpperCase()
  if (value === 'AV') return 'VP'
  return sourceKinds.includes(value as AlarmSourceKind) ? value as AlarmSourceKind : 'UI'
}

function isAlarmVirtualPoint(item: VirtualPoint): boolean {
  return item.enabled && (item.signalType === 'integer' || item.signalType === 'float')
}

function defaultParamsForType(alarmType: AlarmType, params: AlarmSetting['params']): AlarmSetting['params'] {
  const severityRules = getSeverityRules(params)
  if (alarmType === 0 || isDeferredType(alarmType)) return {}
  if (alarmType === 1) {
    return {
      hh: finiteOr(params.hh, 100),
      h: finiteOr(params.h, 90),
      l: finiteOr(params.l, 10),
      ll: finiteOr(params.ll, 0),
      hysteresis: finiteOr(params.hysteresis, 0),
      severityRules
    }
  }
  if (alarmType === 3) return { runtimeHours: finiteOr(params.runtimeHours, 1), severityRules }
  return {}
}

function validateAlarms(rows: AlarmSetting[], pick: PickText, virtualPoints: VirtualPoint[] = []): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (rows.length > maxAlarms) issues.push({ message: pick(`Tối đa ${maxAlarms} cảnh báo.`, `At most ${maxAlarms} alarms.`) })

  const seenIds = new Map<string, number>()
  rows.forEach((row, rowIndex) => {
    const prefix = row.id || `#${rowIndex + 1}`
    const id = row.id.trim()
    if (!id) addIssue(issues, rowIndex, pick('Cảnh báo cần có ID.', 'Alarm ID is required.'))
    else if (!/^ALM-[A-Za-z0-9_-]+$/.test(id)) addIssue(issues, rowIndex, `${prefix}: ${pick('ID phải bắt đầu bằng ALM-.', 'ID must start with ALM-.')}`)
    else {
      const key = id.toUpperCase()
      const first = seenIds.get(key)
      if (first !== undefined) addIssue(issues, rowIndex, `${prefix}: ${pick(`Trùng ID với cảnh báo #${first + 1}.`, `Duplicate ID with alarm #${first + 1}.`)}`)
      seenIds.set(key, rowIndex)
    }

    if (!row.label.trim()) addIssue(issues, rowIndex, `${prefix}: ${pick('Nhãn bắt buộc.', 'Label is required.')}`)
    if (!isAlarmType(row.alarmType)) addIssue(issues, rowIndex, `${prefix}: ${pick('Loại cảnh báo phải nằm trong 0..7.', 'Alarm type must be 0..7.')}`)
    if (row.enabled && isDeferredType(row.alarmType)) addIssue(issues, rowIndex, `${prefix}: ${pick('Loại cảnh báo này chưa được hỗ trợ nên không bật được.', 'This alarm type is not supported yet, so it cannot be enabled.')}`)
    if (!priorities.includes(row.priority)) addIssue(issues, rowIndex, `${prefix}: ${pick('Mức ưu tiên không hợp lệ.', 'Invalid priority.')}`)
    if (!clearModes.includes(getClearMode(row))) addIssue(issues, rowIndex, `${prefix}: ${pick('Cách xoá cảnh báo phải là tự động hoặc thủ công.', 'Clear mode must be automatic or manual.')}`)
    if (!Number.isFinite(row.delayS) || row.delayS < 0) addIssue(issues, rowIndex, `${prefix}: ${pick('Trễ kích hoạt không được âm.', 'Activation delay cannot be negative.')}`)

    if (row.sources.length > maxSourcesPerAlarm) addIssue(issues, rowIndex, `${prefix}: ${pick(`Tối đa ${maxSourcesPerAlarm} nguồn.`, `At most ${maxSourcesPerAlarm} sources.`)}`)
    if (row.enabled && row.alarmType !== 0 && row.sources.length === 0) addIssue(issues, rowIndex, `${prefix}: ${pick('Cảnh báo đang bật cần ít nhất 1 nguồn.', 'Enabled alarms need at least one source.')}`)
    const seenSources = new Set<string>()
    row.sources.forEach((source, sourceIndex) => {
      const max = maxChannel(source.kind)
      if (source.channel < 1 || source.channel > max) addIssue(issues, rowIndex, `${prefix}: ${pick(`Kênh ${source.kind} phải nằm trong 1..${max}.`, `${source.kind} channel must be 1..${max}.`)}`)
      if (source.kind === 'VP' && !virtualSourceFor(source.kind, source.channel, virtualPoints)) {
        addIssue(issues, rowIndex, `${prefix}: ${pick(`Không tìm thấy điểm ảo VP${source.channel}.`, `Virtual point VP${source.channel} was not found.`)}`)
      }
      const expected = pointIdFor(source.kind, source.channel, virtualPoints, source.pointId)
      if (!expected) addIssue(issues, rowIndex, `${prefix}: ${pick(`Nguồn ${sourceIndex + 1} thiếu mã điểm.`, `Source ${sourceIndex + 1} is missing its point ID.`)}`)
      else if (source.pointId !== expected) addIssue(issues, rowIndex, `${prefix}: ${pick(`Mã điểm của nguồn ${sourceIndex + 1} phải là ${expected}.`, `Source ${sourceIndex + 1} point ID must be ${expected}.`)}`)
      const key = `${source.kind}:${source.channel}`
      if (seenSources.has(key)) addIssue(issues, rowIndex, `${prefix}: ${pick('Nguồn bị trùng.', 'Duplicate source.')} ${source.pointId}`)
      seenSources.add(key)
    })

    if (row.publishBacnet && row.notificationClass !== undefined && (row.notificationClass < 1 || row.notificationClass > 4)) {
      addIssue(issues, rowIndex, `${prefix}: ${pick('Notification Class phải nằm trong 1..4.', 'Notification Class must be 1..4.')}`)
    }
    validateParams(row, rowIndex, prefix, issues, pick)
  })

  const published = rows.filter((row) => row.enabled && row.publishBacnet).length
  if (published > maxBacnetPublished) issues.push({ message: pick(`Tối đa ${maxBacnetPublished} cảnh báo đang bật được công bố lên BACnet.`, `At most ${maxBacnetPublished} enabled alarms can be published to BACnet.`) })
  return issues
}

function validateParams(row: AlarmSetting, rowIndex: number, prefix: string, issues: ValidationIssue[], pick: PickText) {
  const params = row.params
  const severityRules = getSeverityRules(params)
  if (isFlexiblePriority(row) && (row.alarmType === 0 || isDeferredType(row.alarmType))) {
    addIssue(issues, rowIndex, `${prefix}: ${pick('Mức ưu tiên FLEXIBLE chỉ dùng được với loại cảnh báo đang hoạt động.', 'FLEXIBLE priority applies only to supported alarm types.')}`)
  } else if (isFlexiblePriority(row) && severityRules.length === 0) {
    addIssue(issues, rowIndex, `${prefix}: ${pick('Mức ưu tiên FLEXIBLE cần ít nhất một luật chọn mức nghiêm trọng.', 'FLEXIBLE priority needs at least one severity rule.')}`)
  }
  if (row.alarmType === 1) {
    const values = [params.hh, params.h, params.l, params.ll]
    if (values.some((value) => !Number.isFinite(value))) {
      addIssue(issues, rowIndex, `${prefix}: ${pick('Bốn ngưỡng HH/H/L/LL phải là số.', 'The four thresholds HH/H/L/LL must be numbers.')}`)
      return
    }
    if (!(params.hh! >= params.h! && params.h! >= params.l! && params.l! >= params.ll!)) {
      addIssue(issues, rowIndex, `${prefix}: ${pick('Bốn ngưỡng phải giảm dần: HH ≥ H ≥ L ≥ LL.', 'The four thresholds must decrease: HH ≥ H ≥ L ≥ LL.')}`)
    }
    if (params.hysteresis !== undefined && params.hysteresis < 0) addIssue(issues, rowIndex, `${prefix}: ${pick('Vùng trễ không được âm.', 'Hysteresis cannot be negative.')}`)
  }
  if (row.alarmType === 3 && (!Number.isFinite(params.runtimeHours) || Number(params.runtimeHours) <= 0)) {
    addIssue(issues, rowIndex, `${prefix}: ${pick('Số giờ chạy tích luỹ phải lớn hơn 0.', 'Runtime hours must be greater than 0.')}`)
  }
}

function getClearMode(row: AlarmSetting): AlarmClearMode {
  return row.clearMode === 'manual' ? 'manual' : 'auto'
}

function isFlexiblePriority(row: AlarmSetting): boolean {
  return row.priority === 'flexible'
}

function normalizeParams(params: AlarmSetting['params']): AlarmSetting['params'] {
  return { ...params, severityRules: getSeverityRules(params) }
}

function getSeverityRules(params: AlarmSetting['params']): SeverityRule[] {
  return Array.isArray(params.severityRules) ? params.severityRules.map(normalizeSeverityRule) : []
}

function normalizeSeverityRule(rule: Partial<SeverityRule>): SeverityRule {
  return {
    severity: rule.severity && severities.includes(rule.severity) ? rule.severity : 'critical',
    op: rule.op && severityOps.includes(rule.op) ? rule.op : '>=',
    value: Number.isFinite(rule.value) ? Number(rule.value) : 0
  }
}

function defaultSeverityRule(): SeverityRule {
  return { severity: 'critical', op: '>=', value: 0 }
}

function addIssue(issues: ValidationIssue[], rowIndex: number, message: string) {
  issues.push({ rowIndex, message })
}

function isAlarmType(value: number): value is AlarmType {
  return Number.isInteger(value) && value >= 0 && value <= 7
}

function isDeferredType(value: AlarmType): boolean {
  return deferredAlarmTypes.includes(value as DeferredAlarmType)
}

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback
}

function normalizeNumber(value: number, min?: number, max?: number, integer = false): number {
  const finite = Number.isFinite(value) ? value : min ?? 0
  const low = min === undefined ? finite : Math.max(min, finite)
  const clamped = max === undefined ? low : Math.min(max, low)
  return integer ? Math.round(clamped) : clamped
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/* `ISS-PIO-19` — phơi ba hàm thuần cho test.
 *
 * Chúng quyết định một cảnh báo Modbus trỏ vào slot nào; kiểm qua giao diện
 * thì một lỗi ánh xạ slot sẽ ẩn sau nhiều lớp render, còn ở đây nó lộ ngay. */
export const alarmSourceKindsForTest = sourceKinds
export const pointIdForTest = pointIdFor
export const channelOptionsForTest = channelOptions
export const normalizeSourceForTest = normalizeSource
