import { BellRing, Plus, RefreshCw, Save, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { apiClient } from '../../shared/api/client'
import { Button } from '../../shared/components/Button'
import { Panel } from '../../shared/components/Panel'
import { StatusBadge } from '../../shared/components/StatusBadge'
import { StateBlock } from '../../shared/components/StateBlock'
import { useToast } from '../../shared/components/Toast'
import { useI18n } from '../../shared/i18n'
import type { ActiveAlarmType, AlarmPriority, AlarmSetting, AlarmSource, AlarmSourceKind, AlarmType, DeferredAlarmType, SeverityRule, VirtualPoint } from '../../shared/types'
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
const sourceKinds: AlarmSourceKind[] = ['UI', 'AO', 'DO', 'VP']

const alarmTypeLabels: Record<AlarmType, string> = {
  0: '0 - Disabled',
  1: '1 - High/Low input',
  2: '2 - Setpoint deviation',
  3: '3 - Runtime hours',
  4: '4 - Fan state supervision',
  5: '5 - Digital output supervision',
  6: '6 - Analog output supervision',
  7: '7 - PI-sequence supervision'
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
  const [rows, setRows] = useState<AlarmSetting[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [virtualPoints, setVirtualPoints] = useState<VirtualPoint[]>([])

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([apiClient.getAlarmSettings(), apiClient.getVirtualPoints()])
      .then(([items, virtualItems]) => {
        if (!active) return
        setVirtualPoints(virtualItems)
        setRows(items.map((item) => normalizeLoadedAlarm(item, virtualItems)))
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

  const selected = rows[selectedIndex]
  const issues = useMemo(() => validateAlarms(rows, pick, virtualPoints), [rows, pick, virtualPoints])
  const selectedIssues = issues.filter((issue) => issue.rowIndex === selectedIndex)
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
      setRows(items.map((item) => normalizeLoadedAlarm(item, virtualItems)))
      setLoadError('')
      setStatusMessage(pick('Da tai lai tu backend.', 'Reloaded from backend.'))
    } catch (error) {
      const message = errorMessage(error)
      setLoadError(message)
      toast.push('error', `${t('error')}: ${message}`)
    } finally {
      setLoading(false)
    }
  }

  async function saveSettings() {
    const saveIssues = validateAlarms(rows, pick, virtualPoints)
    if (saveIssues.length > 0) {
      toast.push('error', saveIssues[0].message)
      return
    }
    const payload = rows.map((row) => normalizeForSave(row, virtualPoints))
    setSaving(true)
    try {
      const result = await apiClient.putAlarmSettings(payload)
      const [fresh, virtualItems] = await Promise.all([apiClient.getAlarmSettings(), apiClient.getVirtualPoints()])
      setVirtualPoints(virtualItems)
      setRows(fresh.map((item) => normalizeLoadedAlarm(item, virtualItems)))
      setStatusMessage(`${t('alarmSettingsSaved')} (${result.reload})`)
      toast.push('success', t('alarmSettingsSaved'))
    } catch (error) {
      const message = errorMessage(error)
      setStatusMessage(message)
      toast.push('error', `${t('alarmSettingsSaveError')}: ${message}`)
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
            {pick('Tai lai', 'Reload')}
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
                  <span className="block truncate font-semibold">{row.id || pick('Chua co ID', 'Missing ID')}</span>
                  <span className="block truncate text-xs">{row.label || alarmTypeLabels[row.alarmType]}</span>
                </span>
                <StatusBadge state={row.enabled ? 'online' : 'inactive'} label={row.enabled ? 'ON' : 'OFF'} />
              </button>
            ))}
            {loading && <div className="rounded-[var(--radius)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">{t('loading')}</div>}
            {!loading && rows.length === 0 && <div className="rounded-[var(--radius)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">{t('empty')}</div>}
          </div>
        </Panel>

        <Panel
          title={selected ? `${selected.id || 'ALM'} - ${selected.label || alarmTypeLabels[selected.alarmType]}` : t('empty')}
          subtitle={selected ? alarmTypeLabels[selected.alarmType] : undefined}
          action={selected && <Button variant="danger" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={removeSelected}>{pick('Xoa', 'Remove')}</Button>}
        >
          {selected ? (
            <AlarmEditor
              row={selected}
              virtualPoints={virtualPoints}
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
            <div className="rounded-[var(--radius)] bg-[var(--c-surface-2)] p-4 text-sm text-[var(--c-text-dim)]">{pick('Them alarm dau tien de cau hinh.', 'Add the first alarm to configure settings.')}</div>
          )}
        </Panel>
      </div>

      <Panel title={pick('Trang thai cau hinh', 'Configuration status')}>
        <div className="flex flex-wrap gap-3">
          <StatusBadge state={loadError ? 'fault' : 'online'} label={loadError ? 'LOAD ERROR' : 'API'} />
          <StatusBadge state={hasErrors ? 'warning' : 'online'} label={hasErrors ? `${issues.length} VALIDATION` : 'VALID'} />
          <StatusBadge state="online" label={`${enabledCount} ENABLED`} />
          <StatusBadge state={publishedCount > maxBacnetPublished ? 'critical' : 'online'} label={`${publishedCount}/${maxBacnetPublished} BACNET`} />
        </div>
        {(statusMessage || issues.length > 0) && (
          <div className="mt-3 space-y-1 text-sm text-[var(--c-text-dim)]">
            {statusMessage && <p>{statusMessage}</p>}
            {issues.slice(0, 6).map((issue) => <p key={`${issue.rowIndex ?? 'global'}-${issue.message}`}>{issue.message}</p>)}
          </div>
        )}
      </Panel>
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
  onSourceRemove
}: {
  row: AlarmSetting
  virtualPoints: VirtualPoint[]
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
        <TextField label={pick('Nhan', 'Label')} value={row.label} onChange={(label) => onChange({ label })} />
        <SelectField label={pick('Loai alarm', 'Alarm type')} value={String(row.alarmType)} onChange={(value) => onTypeChange(Number(value) as AlarmType)}>
          {activeAlarmTypes.map((type) => <option key={type} value={type}>{alarmTypeLabels[type]}</option>)}
          <optgroup label={pick('Deferred - chua ho tro enabled', 'Deferred - not enabled yet')}>
            {deferredAlarmTypes.map((type) => <option key={type} value={type} disabled>{alarmTypeLabels[type]}</option>)}
          </optgroup>
        </SelectField>
        <SelectField label={pick('Muc uu tien', 'Priority')} value={row.priority} onChange={(priority) => onChange({ priority: priority as AlarmPriority })}>
          {priorities.map((priority) => <option key={priority} value={priority}>{priority.toUpperCase()}</option>)}
        </SelectField>
        <SelectField label={pick('Che do clear', 'Clear mode')} value={getClearMode(row)} onChange={(clearMode) => onChange({ clearMode: clearMode as AlarmClearMode })}>
          {clearModes.map((mode) => <option key={mode} value={mode}>{mode === 'auto' ? pick('Auto', 'Auto') : pick('Manual', 'Manual')}</option>)}
        </SelectField>
        <NumberField label="Delay (s)" min={0} value={row.delayS} onChange={(delayS) => onChange({ delayS })} />
        <label className="flex items-end gap-2 pb-3 text-sm font-semibold text-[var(--c-text)]">
          <input className={checkboxClass} type="checkbox" checked={row.enabled} disabled={deferred} onChange={(event) => onChange({ enabled: event.target.checked })} />
          {pick('Bat alarm', 'Enabled')}
        </label>
      </section>

      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[var(--c-text)]">{pick('Nguon kich hoat', 'Sources')}</h3>
            <p className="text-xs text-[var(--c-text-dim)]">{pick('Entity OR qua tat ca source; pointId tu suy tu kind/channel.', 'Entity OR across sources; pointId is derived from kind/channel.')}</p>
          </div>
          <Button size="sm" icon={<Plus className="h-4 w-4" />} disabled={row.sources.length >= maxSourcesPerAlarm} onClick={onSourceAdd}>{pick('Them source', 'Add source')}</Button>
        </div>
        <div className="space-y-2">
          {row.sources.map((source, sourceIndex) => (
            <SourceRow
              key={`${source.kind}-${source.channel}-${sourceIndex}`}
              source={source}
              virtualPoints={virtualPoints}
              onChange={(patch) => onSourceChange(sourceIndex, patch)}
              onRemove={() => onSourceRemove(sourceIndex)}
            />
          ))}
          {row.sources.length === 0 && <div className="rounded-[var(--radius)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">{pick('Chua co source.', 'No sources yet.')}</div>}
        </div>
      </section>

      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
        <div className="mb-3 flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-[var(--c-accent)]" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-[var(--c-text)]">{pick('Tham so', 'Parameters')}</h3>
        </div>
        <AlarmParamsEditor row={row} onChange={onParamsChange} />
      </section>

      <section className="grid gap-4 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4 md:grid-cols-[minmax(0,1fr)_180px]">
        <label className="flex items-center gap-2 text-sm font-semibold text-[var(--c-text)]">
          <input
            className={checkboxClass}
            type="checkbox"
            checked={Boolean(row.publishBacnet)}
            onChange={(event) => onChange({ publishBacnet: event.target.checked, notificationClass: event.target.checked ? row.notificationClass ?? 1 : undefined })}
          />
          {pick('Publish BACnet Event Enrollment', 'Publish BACnet Event Enrollment')}
          <StatusBadge state={publishedCount > maxBacnetPublished ? 'critical' : 'online'} label={`${publishedCount}/${maxBacnetPublished}`} />
        </label>
        <NumberField label={pick('Notification Class', 'Notification Class')} min={1} max={4} integer disabled={!row.publishBacnet} value={row.notificationClass ?? 1} onChange={(notificationClass) => onChange({ notificationClass })} />
      </section>

      {deferred && (
        <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">
          {pick('Type 2/4/5/6/7 dang deferred; UI khong cho bat enabled de backend khong reject.', 'Types 2/4/5/6/7 are deferred; UI keeps them disabled so backend will not reject them.')}
        </div>
      )}
      <div className="text-xs text-[var(--c-text-dim)]">#{rowIndex + 1}</div>
    </div>
  )
}

function SourceRow({ source, virtualPoints, onChange, onRemove }: { source: AlarmSource; virtualPoints: VirtualPoint[]; onChange: (patch: Partial<AlarmSource>) => void; onRemove: () => void }) {
  const { pick } = useI18n()
  const channels = channelOptions(source.kind, virtualPoints)
  return (
    <div className="grid gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3 sm:grid-cols-[120px_120px_minmax(0,1fr)_auto]">
      <SelectField label="Kind" value={source.kind} onChange={(kind) => onChange(normalizeSource({ kind: kind as AlarmSourceKind, channel: firstChannel(kind as AlarmSourceKind, virtualPoints) }, virtualPoints))}>
        {sourceKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
      </SelectField>
      <SelectField label={pick('Kenh', 'Channel')} value={String(source.channel)} onChange={(channel) => onChange({ channel: Number(channel) })}>
        {channels.map((channel) => {
          const virtual = source.kind === 'VP' ? virtualSourceFor('VP', channel, virtualPoints) : undefined
          return <option key={channel} value={channel}>{virtual ? `${channel} - ${virtual.tag}` : channel}</option>
        })}
      </SelectField>
      <TextField label={source.kind === 'VP' ? 'Tag' : 'Point ID'} value={source.kind === 'VP' ? virtualSourceFor('VP', source.channel, virtualPoints)?.tag ?? source.pointId : source.pointId} disabled onChange={() => undefined} />
      <div className="flex items-end">
        <Button variant="danger" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={onRemove}>{pick('Xoa', 'Remove')}</Button>
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
          <NumberField label="HH" value={row.params.hh ?? 0} onChange={(hh) => onChange({ hh })} />
          <NumberField label="H" value={row.params.h ?? 0} onChange={(h) => onChange({ h })} />
          <NumberField label="L" value={row.params.l ?? 0} onChange={(l) => onChange({ l })} />
          <NumberField label="LL" value={row.params.ll ?? 0} onChange={(ll) => onChange({ ll })} />
          <NumberField label={pick('Hysteresis', 'Hysteresis')} min={0} value={row.params.hysteresis ?? 0} onChange={(hysteresis) => onChange({ hysteresis })} />
        </div>
        {isFlexiblePriority(row) && <SeverityRulesEditor rules={getSeverityRules(row.params)} onChange={(severityRules) => onChange({ severityRules })} />}
      </div>
    )
  }
  if (row.alarmType === 3) {
    return (
      <div className="space-y-4">
        <div className="max-w-xs">
          <NumberField label={pick('Runtime hours', 'Runtime hours')} min={0.1} step={0.1} value={row.params.runtimeHours ?? 1} onChange={(runtimeHours) => onChange({ runtimeHours })} />
        </div>
        {isFlexiblePriority(row) && <SeverityRulesEditor rules={getSeverityRules(row.params)} onChange={(severityRules) => onChange({ severityRules })} />}
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--c-text-dim)]">{pick('Type nay khong co tham so active trong Phase 4.', 'This type has no active parameters in Phase 4.')}</p>
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
        <h4 className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Severity rules', 'Severity rules')}</h4>
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => onChange([...rules, defaultSeverityRule()])}>{pick('Them rule', 'Add rule')}</Button>
      </div>
      <div className="space-y-2">
        {rules.map((rule, index) => (
          <div key={`${rule.severity}-${rule.op}-${index}`} className="grid gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3 sm:grid-cols-[minmax(0,1fr)_100px_minmax(120px,1fr)_auto]">
            <SelectField label={pick('Severity', 'Severity')} value={rule.severity} onChange={(severity) => updateRule(index, { severity: severity as SeverityRule['severity'] })}>
              {severities.map((severity) => <option key={severity} value={severity}>{severity.toUpperCase()}</option>)}
            </SelectField>
            <SelectField label={pick('Operator', 'Operator')} value={rule.op} onChange={(op) => updateRule(index, { op: op as SeverityRule['op'] })}>
              {severityOps.map((op) => <option key={op} value={op}>{op}</option>)}
            </SelectField>
            <NumberField label={pick('Value', 'Value')} value={rule.value} onChange={(value) => updateRule(index, { value })} />
            <div className="flex items-end">
              <Button variant="danger" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={() => onChange(rules.filter((_, ruleIndex) => ruleIndex !== index))}>{pick('Xoa', 'Remove')}</Button>
            </div>
          </div>
        ))}
        {rules.length === 0 && <div className="rounded-[var(--radius)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">{pick('Can it nhat 1 rule cho priority flexible.', 'At least one rule is required for flexible priority.')}</div>}
      </div>
    </div>
  )
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{label}</span>
      {children}
    </label>
  )
}

function TextField({ label, value, disabled, onChange }: { label: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  return (
    <FieldGroup label={label}>
      <input className={inputClass} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </FieldGroup>
  )
}

function NumberField({ label, value, min, max, step = 1, integer, disabled, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; integer?: boolean; disabled?: boolean; onChange: (value: number) => void }) {
  return (
    <FieldGroup label={label}>
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

function SelectField({ label, value, children, onChange }: { label: string; value: string; children: React.ReactNode; onChange: (value: string) => void }) {
  return (
    <FieldGroup label={label}>
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

function createAlarm(rows: AlarmSetting[], virtualPoints: VirtualPoint[]): AlarmSetting {
  const id = nextAlarmId(rows)
  return {
    id,
    label: `Alarm ${id.replace(/^ALM-/, '')}`,
    enabled: true,
    alarmType: 1,
    sources: [nextSource([], virtualPoints)],
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

function normalizeSource(source: Partial<AlarmSource>, virtualPoints: VirtualPoint[] = []): AlarmSource {
  let kind = normalizeSourceKind(source.kind)
  let channels = channelOptions(kind, virtualPoints)
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
  return `${kind}-${String(channel).padStart(2, '0')}`
}

function maxChannel(kind: AlarmSourceKind): number {
  if (kind === 'UI') return 16
  if (kind === 'AO' || kind === 'DO') return 4
  return 464
}

function channelOptions(kind: AlarmSourceKind, virtualPoints: VirtualPoint[]): number[] {
  if (kind !== 'VP') {
    return Array.from({ length: maxChannel(kind) }, (_, index) => index + 1)
  }
  const channels = virtualPoints
    .filter(isAlarmVirtualPoint)
    .map((item) => virtualChannel(item.id))
    .filter((channel): channel is number => channel !== undefined)
  return [...new Set(channels)].sort((a, b) => a - b)
}

function firstChannel(kind: AlarmSourceKind, virtualPoints: VirtualPoint[]): number {
  return channelOptions(kind, virtualPoints)[0] ?? 1
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
  if (rows.length > maxAlarms) issues.push({ message: pick(`Toi da ${maxAlarms} alarm.`, `At most ${maxAlarms} alarms.`) })

  const seenIds = new Map<string, number>()
  rows.forEach((row, rowIndex) => {
    const prefix = row.id || `#${rowIndex + 1}`
    const id = row.id.trim()
    if (!id) addIssue(issues, rowIndex, pick('Alarm can co ID.', 'Alarm ID is required.'))
    else if (!/^ALM-[A-Za-z0-9_-]+$/.test(id)) addIssue(issues, rowIndex, `${prefix}: ${pick('ID phai bat dau bang ALM-.', 'ID must start with ALM-.')}`)
    else {
      const key = id.toUpperCase()
      const first = seenIds.get(key)
      if (first !== undefined) addIssue(issues, rowIndex, `${prefix}: ${pick(`Trung ID voi alarm #${first + 1}.`, `Duplicate ID with alarm #${first + 1}.`)}`)
      seenIds.set(key, rowIndex)
    }

    if (!row.label.trim()) addIssue(issues, rowIndex, `${prefix}: ${pick('Label bat buoc.', 'Label is required.')}`)
    if (!isAlarmType(row.alarmType)) addIssue(issues, rowIndex, `${prefix}: alarmType must be 0..7.`)
    if (row.enabled && isDeferredType(row.alarmType)) addIssue(issues, rowIndex, `${prefix}: ${pick('Deferred type chua duoc bat enabled.', 'Deferred alarm types cannot be enabled yet.')}`)
    if (!priorities.includes(row.priority)) addIssue(issues, rowIndex, `${prefix}: ${pick('Priority khong hop le.', 'Invalid priority.')}`)
    if (!clearModes.includes(getClearMode(row))) addIssue(issues, rowIndex, `${prefix}: clearMode must be auto or manual.`)
    if (!Number.isFinite(row.delayS) || row.delayS < 0) addIssue(issues, rowIndex, `${prefix}: delayS must be >= 0.`)

    if (row.sources.length > maxSourcesPerAlarm) addIssue(issues, rowIndex, `${prefix}: ${pick(`Toi da ${maxSourcesPerAlarm} source.`, `At most ${maxSourcesPerAlarm} sources.`)}`)
    if (row.enabled && row.alarmType !== 0 && row.sources.length === 0) addIssue(issues, rowIndex, `${prefix}: ${pick('Enabled alarm can it nhat 1 source.', 'Enabled alarms need at least one source.')}`)
    const seenSources = new Set<string>()
    row.sources.forEach((source, sourceIndex) => {
      const max = maxChannel(source.kind)
      if (source.channel < 1 || source.channel > max) addIssue(issues, rowIndex, `${prefix}: ${source.kind} channel must be 1..${max}.`)
      if (source.kind === 'VP' && !virtualSourceFor(source.kind, source.channel, virtualPoints)) {
        addIssue(issues, rowIndex, `${prefix}: VP${source.channel} not found in numeric Virtual Points.`)
      }
      const expected = pointIdFor(source.kind, source.channel, virtualPoints, source.pointId)
      if (!expected) addIssue(issues, rowIndex, `${prefix}: source ${sourceIndex + 1} pointId is required.`)
      else if (source.pointId !== expected) addIssue(issues, rowIndex, `${prefix}: source ${sourceIndex + 1} pointId must be ${expected}.`)
      const key = `${source.kind}:${source.channel}`
      if (seenSources.has(key)) addIssue(issues, rowIndex, `${prefix}: ${pick('Source bi trung.', 'Duplicate source.')} ${source.pointId}`)
      seenSources.add(key)
    })

    if (row.publishBacnet && row.notificationClass !== undefined && (row.notificationClass < 1 || row.notificationClass > 4)) {
      addIssue(issues, rowIndex, `${prefix}: notificationClass must be 1..4.`)
    }
    validateParams(row, rowIndex, prefix, issues, pick)
  })

  const published = rows.filter((row) => row.enabled && row.publishBacnet).length
  if (published > maxBacnetPublished) issues.push({ message: pick(`Toi da ${maxBacnetPublished} alarm publish BACnet dang enabled.`, `At most ${maxBacnetPublished} enabled BACnet-published alarms.`) })
  return issues
}

function validateParams(row: AlarmSetting, rowIndex: number, prefix: string, issues: ValidationIssue[], pick: PickText) {
  const params = row.params
  const severityRules = getSeverityRules(params)
  if (isFlexiblePriority(row) && (row.alarmType === 0 || isDeferredType(row.alarmType))) {
    addIssue(issues, rowIndex, `${prefix}: ${pick('Priority flexible chi ap dung cho active alarm type.', 'Flexible priority applies only to active alarm types.')}`)
  } else if (isFlexiblePriority(row) && severityRules.length === 0) {
    addIssue(issues, rowIndex, `${prefix}: ${pick('Priority flexible can it nhat 1 severity rule.', 'Flexible priority needs at least one severity rule.')}`)
  }
  if (row.alarmType === 1) {
    const values = [params.hh, params.h, params.l, params.ll]
    if (values.some((value) => !Number.isFinite(value))) {
      addIssue(issues, rowIndex, `${prefix}: HH/H/L/LL ${pick('phai la so.', 'must be numbers.')}`)
      return
    }
    if (!(params.hh! >= params.h! && params.h! >= params.l! && params.l! >= params.ll!)) {
      addIssue(issues, rowIndex, `${prefix}: HH >= H >= L >= LL`)
    }
    if (params.hysteresis !== undefined && params.hysteresis < 0) addIssue(issues, rowIndex, `${prefix}: hysteresis must be >= 0.`)
  }
  if (row.alarmType === 3 && (!Number.isFinite(params.runtimeHours) || Number(params.runtimeHours) <= 0)) {
    addIssue(issues, rowIndex, `${prefix}: runtimeHours must be > 0.`)
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
