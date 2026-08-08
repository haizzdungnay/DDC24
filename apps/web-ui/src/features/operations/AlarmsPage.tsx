import { ArrowLeft, Filter, History, RefreshCw, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../../shared/api/client'
import { AlarmDurationDialog, type AlarmDurationAction, type AlarmDurationChoice } from '../../shared/components/AlarmDurationDialog'
import { AlarmRow } from '../../shared/components/AlarmRow'
import { Button } from '../../shared/components/Button'
import { Panel } from '../../shared/components/Panel'
import { StateBlock } from '../../shared/components/StateBlock'
import { StatusBadge } from '../../shared/components/StatusBadge'
import { useToast } from '../../shared/components/Toast'
import { useApi } from '../../shared/hooks/useApi'
import { useI18n } from '../../shared/i18n'
import { roleAtLeast, useAuth } from '../auth'
import type { Alarm, AlarmHistoryEntry, AlarmHistoryQuery, AlarmSetting } from '../../shared/types'
import { formatDateTime } from '../../shared/utils'

type AlarmFilter = 'all' | Alarm['status']

const alarmFilters: AlarmFilter[] = ['all', 'active', 'unack', 'acked', 'cleared', 'shelved']
const historyEvents = ['started', 'acked', 'returned', 'ended', 'setting_created', 'setting_changed', 'setting_deleted']
const emptyHistoryFilters = { text: '', alarm: '', name: '', from: '', to: '', event: [] as string[], severity: '', status: '' }
type HistoryFilterState = typeof emptyHistoryFilters
type HistoryMode = 'latest' | 'full'
type HistoryOption = { value: string; label: string }
type AlarmActionDialog = { action: AlarmDurationAction; alarm: Alarm } | null

export function AlarmsPage() {
  const state = useApi(apiClient.getAlarms, [], { refreshMs: 2000 })
  const toast = useToast()
  const { pick } = useI18n()
  /* PA3-F10: `viewer` quan sát được cả trang nhưng KHÔNG hành động được.
     Backend đã chặn (`POST /alarms/{id}/ack|suppress|return` là `RoleOperator`);
     đây chỉ là để giao diện nói ra điều đó trước khi người dùng bấm. */
  const { session } = useAuth()
  const canActOnAlarms = roleAtLeast(session?.role, 'operator')
  const [filter, setFilter] = useState<AlarmFilter>('all')
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<AlarmActionDialog>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const alarms = state.data ?? []
  const rows = useMemo(() => alarms.filter((alarm) => alarmMatchesStatus(alarm, filter) && alarmMatchesQuery(alarm, query)), [alarms, filter, query])
  const counts = useMemo(() => ({
    all: alarms.length,
    active: alarms.filter(isConditionActive).length,
    unack: alarms.filter((alarm) => alarm.status === 'unack').length,
    acked: alarms.filter((alarm) => alarm.status === 'acked').length,
    cleared: alarms.filter((alarm) => alarm.status === 'cleared').length,
    shelved: alarms.filter((alarm) => alarm.status === 'shelved').length
  }), [alarms])

  async function confirmAlarmAction(choice: AlarmDurationChoice) {
    if (!dialog) return
    setActionLoading(true)
    try {
      if (dialog.action === 'ack') await apiClient.ackAlarm(dialog.alarm.id, choice)
      else await apiClient.suppressAlarm(dialog.alarm.id, choice)
      await state.refetch()
      window.dispatchEvent(new CustomEvent('mkddc:alarms-updated'))
      toast.push('success', `${dialog.action === 'ack' ? 'Ack' : 'Off'} ${dialog.alarm.id}`)
      setDialog(null)
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : `${dialog.action === 'ack' ? 'Ack' : 'Off'} failed`)
    } finally {
      setActionLoading(false)
    }
  }

  async function returnAlarm(alarm: Alarm) {
    try {
      await apiClient.returnAlarm(alarm.id)
      await state.refetch()
      window.dispatchEvent(new CustomEvent('mkddc:alarms-updated'))
      toast.push('success', `Return ${alarm.id}`)
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : 'Return failed')
    }
  }

  /* Trạng thái tải/lỗi vẫn giữ tiêu đề trang (PA3-603 / WCAG 2.4.6): một
     `StateBlock` trần làm trang mất `<h1>`, nên người dùng trình đọc màn hình
     nghe thấy thông báo lỗi mà không biết mình đang ở trang nào. */
  if (state.loading && !alarms.length) {
    return <div className="space-y-4"><AlarmsHeading /><StateBlock state="loading" title={pick('Dang tai alarm', 'Loading alarms')} /></div>
  }
  if (state.error && !alarms.length) {
    return <div className="space-y-4"><AlarmsHeading /><StateBlock state="error" title={pick('Khong tai duoc alarm', 'Could not load alarms')} detail={state.error.message} onRetry={state.refetch} /></div>
  }

  const filterLabels: Record<AlarmFilter, string> = {
    all: pick('tat ca', 'all'),
    active: 'active',
    unack: pick('chua ack', 'unack'),
    acked: pick('da ack', 'acked'),
    cleared: 'cleared',
    shelved: 'shelved'
  }

  return (
    <div className="space-y-5">
      <AlarmsHeading />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Summary label={pick('Dang active', 'Active')} value={counts.active} accent="fault" />
        <Summary label={pick('Chua acknowledge', 'Unacknowledged')} value={counts.unack} accent="warn" />
        <Summary label="Shelved" value={counts.shelved} accent="info" />
        <Summary label={pick('Dang hien thi', 'Listed')} value={alarms.length} accent="good" />
      </div>
      <Panel>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {alarmFilters.map((item) => (
            <Button key={item} size="sm" variant={filter === item ? 'primary' : 'secondary'} onClick={() => setFilter(item)}>
              {filterLabels[item]} {counts[item]}
            </Button>
          ))}
          <label className="ml-auto flex h-9 min-w-[260px] items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3">
            <Search className="h-4 w-4 text-[var(--c-text-dim)]" /><input className="w-full bg-transparent text-sm outline-none" placeholder={pick('Tim kiem alarm...', 'Search alarms...')} value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <Button size="sm" icon={<Filter className="h-4 w-4" />} onClick={() => { setFilter('all'); setQuery('') }}>{pick('Xoa loc', 'Clear')}</Button>
        </div>
        <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)]">
          {rows.map((alarm) => (
            <AlarmRow
              key={alarm.id}
              alarm={alarm}
              canAct={canActOnAlarms}
              onAck={(item) => setDialog({ action: 'ack', alarm: item })}
              onSuppress={(item) => setDialog({ action: 'off', alarm: item })}
              onReturn={returnAlarm}
            />
          ))}
          {!rows.length && <StateBlock state="empty" title={pick('Khong co alarm phu hop', 'No matching alarms')} />}
        </div>
      </Panel>
      <AlarmHistoryPanel mode="latest" />
      <AlarmDurationDialog
        action={dialog?.action ?? 'ack'}
        alarmLabel={dialog?.alarm.message ?? ''}
        open={Boolean(dialog)}
        loading={actionLoading}
        onCancel={() => setDialog(null)}
        onConfirm={confirmAlarmAction}
      />
    </div>
  )
}

export function AlarmHistoryPage() {
  const { pick } = useI18n()
  const navigate = useNavigate()
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{pick('Lich su alarm', 'Alarm history')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Toan bo ban ghi alarm', 'Full alarm history')}</p>
        </div>
        <Button size="sm" variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/alarms')}>
          {pick('Alarm log', 'Alarm log')}
        </Button>
      </div>
      <AlarmHistoryPanel mode="full" />
    </div>
  )
}

function AlarmHistoryPanel({ mode }: { mode: HistoryMode }) {
  const navigate = useNavigate()
  const { pick } = useI18n()
  const [historyFilters, setHistoryFilters] = useState(emptyHistoryFilters)
  const historyQuery = useMemo(() => makeHistoryQuery(historyFilters, mode === 'full'), [historyFilters, mode])
  const historyDeps = [mode, historyFilters.text, historyFilters.alarm, historyFilters.name, historyFilters.from, historyFilters.to, historyFilters.event.join(','), historyFilters.severity, historyFilters.status]
  const historyState = useApi(() => apiClient.getAlarmHistory(historyQuery), historyDeps)
  const settingsState = useApi(apiClient.getAlarmSettings, [])
  const history = historyState.data ?? []
  const settings = settingsState.data ?? []
  const historyRows = useMemo(() => [...history].reverse(), [history])
  const alarmOptions = useMemo(() => ensureSelectedOption(alarmHistoryOptions(history, settings), historyFilters.alarm), [history, settings, historyFilters.alarm])
  const nameOptions = useMemo(() => ensureSelectedOption(nameHistoryOptions(history, settings), historyFilters.name), [history, settings, historyFilters.name])

  useEffect(() => {
    const refresh = () => { void historyState.refetch() }
    window.addEventListener('mkddc:alarms-updated', refresh)
    return () => window.removeEventListener('mkddc:alarms-updated', refresh)
  }, [historyState.refetch])

  function toggleHistoryEvent(event: string) {
    setHistoryFilters((current) => {
      const enabled = current.event.includes(event)
      return { ...current, event: enabled ? current.event.filter((item) => item !== event) : [...current.event, event] }
    })
  }

  return (
    <Panel
      title={pick('Lich su alarm', 'Alarm history')}
      subtitle={mode === 'full' ? pick('Toan bo ban ghi khop bo loc', 'All matching records') : pick('20 ban ghi moi nhat khop bo loc', 'Latest 20 matching records')}
      action={(
        <div className="flex flex-wrap justify-end gap-2">
          {mode === 'latest' && (
            <Button size="sm" variant="secondary" icon={<History className="h-4 w-4" />} onClick={() => navigate('/alarms/history')}>
              {pick('Mo toan bo', 'Full history')}
            </Button>
          )}
          <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={historyState.refetch}>{pick('Tai lai', 'Refresh')}</Button>
        </div>
      )}
    >
      <div className="mb-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <HistoryInput label="Text" value={historyFilters.text} onChange={(value) => setHistoryFilters((current) => ({ ...current, text: value }))} />
        <HistorySelect label="Alarm" value={historyFilters.alarm} options={alarmOptions} onChange={(value) => setHistoryFilters((current) => ({ ...current, alarm: value }))} />
        <HistorySelect label="Name" value={historyFilters.name} options={nameOptions} onChange={(value) => setHistoryFilters((current) => ({ ...current, name: value }))} />
        <HistoryInput label="From" type="datetime-local" value={historyFilters.from} onChange={(value) => setHistoryFilters((current) => ({ ...current, from: value }))} />
        <HistoryInput label="To" type="datetime-local" value={historyFilters.to} onChange={(value) => setHistoryFilters((current) => ({ ...current, to: value }))} />
        <label className="text-xs font-semibold text-[var(--c-text-dim)]">
          Severity
          <select className="mt-1 h-9 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-2 text-sm text-[var(--c-text)]" value={historyFilters.severity} onChange={(event) => setHistoryFilters((current) => ({ ...current, severity: event.target.value }))}>
            <option value="">all</option><option value="critical">critical</option><option value="high">high</option><option value="medium">medium</option><option value="low">low</option><option value="info">info</option>
          </select>
        </label>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {historyEvents.map((event) => (
          <label key={event} className="inline-flex h-8 items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-xs">
            <input type="checkbox" checked={historyFilters.event.includes(event)} onChange={() => toggleHistoryEvent(event)} />
            {event}
          </label>
        ))}
        <select className="h-8 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-2 text-xs" value={historyFilters.status} onChange={(event) => setHistoryFilters((current) => ({ ...current, status: event.target.value }))}>
          <option value="">status: all</option><option value="active">active</option><option value="acked">acked</option><option value="normal">normal</option><option value="cleared">cleared</option><option value="unack">unack</option>
        </select>
        <Button size="sm" variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => setHistoryFilters(emptyHistoryFilters)}>{pick('Xoa loc', 'Clear')}</Button>
      </div>
      {historyState.loading && !history.length ? (
        <StateBlock state="loading" title={pick('Dang tai lich su alarm', 'Loading alarm history')} />
      ) : historyState.error && !history.length ? (
        <StateBlock state="error" title={pick('Chua co endpoint lich su alarm', 'Alarm history endpoint unavailable')} detail={historyState.error.message} onRetry={historyState.refetch} />
      ) : (
        <div className={mode === 'full' ? 'overflow-auto rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)]' : 'max-h-[560px] overflow-auto rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)]'}>
          {historyRows.map((alarm, index) => <HistoryRow key={alarm.eventId ?? `${alarm.id}-${alarm.event ?? alarm.status}-${index}`} alarm={alarm} />)}
          {!historyRows.length && <StateBlock state="empty" title={pick('Chua co lich su alarm', 'No alarm history')} />}
        </div>
      )}
    </Panel>
  )
}

function isConditionActive(alarm: Alarm): boolean {
  return alarm.active ?? (alarm.status === 'active' || alarm.status === 'acked')
}

/** Tiêu đề trang, dùng chung cho cả trạng thái bình thường lẫn loading/lỗi. */
function AlarmsHeading() {
  const { pick } = useI18n()
  return (
    <div>
      <h1 className="text-2xl font-semibold">{pick('Canh bao', 'Alarms')}</h1>
      <p className="text-sm text-[var(--c-text-dim)]">{pick('Theo doi, loc va acknowledge canh bao', 'Monitor, filter, and acknowledge alarms')}</p>
    </div>
  )
}

function alarmMatchesStatus(alarm: Alarm, filter: AlarmFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'active') return isConditionActive(alarm)
  return alarm.status === filter
}

function alarmMatchesQuery(alarm: Alarm, query: string): boolean {
  const text = `${alarm.id} ${alarm.message} ${alarm.source} ${alarm.value} ${alarm.detail}`.toLowerCase()
  return text.includes(query.toLowerCase())
}

function makeHistoryQuery(filters: HistoryFilterState, full: boolean): AlarmHistoryQuery {
  return {
    limit: full ? 'all' : 20,
    text: filters.text,
    alarm: filters.alarm,
    name: filters.name,
    from: localDateTimeToIso(filters.from),
    to: localDateTimeToIso(filters.to),
    event: filters.event,
    severity: filters.severity,
    status: filters.status
  }
}

function localDateTimeToIso(value: string): string | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

function HistorySelect({ label, value, options, onChange }: { label: string; value: string; options: HistoryOption[]; onChange: (value: string) => void }) {
  return (
    <label className="text-xs font-semibold text-[var(--c-text-dim)]">
      {label}
      <select className="mt-1 h-9 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-2 text-sm text-[var(--c-text)]" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">all</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

function HistoryInput({ label, value, onChange, type = 'search' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="text-xs font-semibold text-[var(--c-text-dim)]">
      {label}
      <input className="mt-1 h-9 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-2 text-sm text-[var(--c-text)] outline-none" type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function alarmHistoryOptions(history: AlarmHistoryEntry[], settings: AlarmSetting[]): HistoryOption[] {
  return uniqueHistoryOptions([
    ...settings.map((alarm) => ({ value: alarm.id, label: alarm.label && alarm.label !== alarm.id ? `${alarm.id} - ${alarm.label}` : alarm.id })),
    ...history.map((alarm) => ({ value: alarm.id, label: alarm.message && alarm.message !== alarm.id ? `${alarm.id} - ${alarm.message}` : alarm.id }))
  ])
}

function nameHistoryOptions(history: AlarmHistoryEntry[], settings: AlarmSetting[]): HistoryOption[] {
  return uniqueHistoryOptions([
    ...settings.map((alarm) => ({ value: alarm.label, label: alarm.label })),
    ...history.flatMap((alarm) => [alarm.message, alarm.before?.label, alarm.after?.label].filter((value): value is string => Boolean(value?.trim())).map((value) => ({ value, label: value })))
  ])
}

function uniqueHistoryOptions(options: HistoryOption[]): HistoryOption[] {
  const byValue = new Map<string, HistoryOption>()
  for (const option of options) {
    const value = option.value.trim()
    if (!value || byValue.has(value)) continue
    byValue.set(value, { value, label: option.label.trim() || value })
  }
  return [...byValue.values()].sort((left, right) => left.label.localeCompare(right.label))
}

function ensureSelectedOption(options: HistoryOption[], value: string): HistoryOption[] {
  const selected = value.trim()
  if (!selected || options.some((option) => option.value === selected)) return options
  return [{ value: selected, label: selected }, ...options]
}

function HistoryRow({ alarm }: { alarm: AlarmHistoryEntry }) {
  const statusState = historyStateFor(alarm)
  const severityState = alarm.severity === 'critical' || alarm.severity === 'high' ? 'fault' : alarm.severity === 'medium' ? 'uncertain' : 'ok'
  const closedAt = alarm.clearedAt ?? alarm.acknowledgedAt
  const detail = alarmHistoryDetail(alarm)
  const actor = alarm.ackedBy ?? alarm.user
  return (
    <div className="grid grid-cols-[140px_112px_96px_1fr_136px] items-center gap-3 border-b border-[var(--c-border)] px-3 py-3 text-xs last:border-0 max-lg:grid-cols-1">
      <span className="mono text-[var(--c-text-dim)]">{formatDateTime(alarm.time)}</span>
      <StatusBadge state={statusState} label={historyLabel(alarm)} />
      <StatusBadge state={severityState} label={alarm.severity.toUpperCase()} />
      <div className="min-w-0">
        <div className="truncate font-semibold">{alarm.message}</div>
        <div className="mt-1 truncate text-[var(--c-text-dim)]">{detail}</div>
      </div>
      <div className="min-w-0 text-right max-lg:text-left">
        <div className="truncate text-[var(--c-text-dim)]">{actor ?? '-'}</div>
        {closedAt && <div className="mono mt-1 truncate text-[var(--c-text-dim)]">{formatDateTime(closedAt)}</div>}
      </div>
    </div>
  )
}

function historyLabel(alarm: AlarmHistoryEntry): string {
  if (alarm.event === 'started') return 'START'
  if (alarm.event === 'ended') return 'END'
  if (alarm.event === 'acked') return 'ACK'
  if (alarm.event === 'returned') return 'RETURN'
  if (alarm.event?.startsWith('setting_')) return 'SETTING'
  return alarm.status.toUpperCase()
}

function historyStateFor(alarm: AlarmHistoryEntry): 'alarm' | 'warn' | 'good' | 'off' {
  if (alarm.event === 'started' || alarm.event === 'returned') return 'alarm'
  if (alarm.event === 'ended') return 'good'
  if (alarm.event === 'acked' || alarm.event?.startsWith('setting_')) return 'off'
  if (alarm.status === 'active') return 'alarm'
  if (alarm.status === 'unack') return 'warn'
  if (alarm.status === 'cleared') return 'good'
  return 'off'
}

function alarmHistoryDetail(alarm: AlarmHistoryEntry): string {
  if (alarm.event === 'setting_changed') return `${alarm.before?.label ?? alarm.id} -> ${alarm.after?.label ?? alarm.message}`
  if (alarm.event === 'setting_deleted') return `deleted ${alarm.before?.label ?? alarm.message}`
  if (alarm.event === 'setting_created') return `created ${alarm.after?.label ?? alarm.message}`
  return [alarm.source, alarm.value || 'n/a', alarm.detail].filter(Boolean).join(' / ')
}

function Summary({ label, value, accent }: { label: string; value: number; accent: 'fault' | 'warn' | 'info' | 'good' }) {
  const color = accent === 'fault' ? 'var(--c-fault-fg)' : accent === 'warn' ? 'var(--c-warn-fg)' : accent === 'info' ? 'var(--c-info)' : 'var(--c-good-fg)'
  return <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4"><div className="mono text-4xl font-bold" style={{ color }}>{value}</div><div className="mt-2 text-xs text-[var(--c-text-dim)]">{label}</div></div>
}
