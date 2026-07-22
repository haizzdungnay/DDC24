import { AlertTriangle, Clock3, RefreshCw, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { apiClient } from '../api/client'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { Panel } from '../components/Panel'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/Toast'
import { useI18n } from '../i18n'
import type { TimeConfig, TimeStatus } from '../types'

const inputClass = 'mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]'
const rfc3339WithZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const isRfc3339WithZone = (value: string) => rfc3339WithZone.test(value) && Number.isFinite(Date.parse(value))

export function TimeSettingsPage() {
  const { pick } = useI18n()
  const toast = useToast()
  const [config, setConfig] = useState<TimeConfig | null>(null)
  const [savedConfig, setSavedConfig] = useState<TimeConfig | null>(null)
  const [status, setStatus] = useState<TimeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manualError, setManualError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [anchorMs, setAnchorMs] = useState(Date.now())
  const [, tick] = useState(0)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [nextConfig, nextStatus] = await Promise.all([apiClient.getTimeConfig(), apiClient.getTimeStatus()])
      setConfig(nextConfig)
      setSavedConfig(nextConfig)
      setStatus(nextStatus)
      setAnchorMs(Date.now())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])
  useEffect(() => {
    const id = window.setInterval(() => tick((value) => value + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  async function refreshStatus() {
    setRefreshing(true)
    try {
      setStatus(await apiClient.getTimeStatus())
      setAnchorMs(Date.now())
    } catch (refreshError) {
      toast.push('error', refreshError instanceof Error ? refreshError.message : String(refreshError))
    } finally {
      setRefreshing(false)
    }
  }

  function requestSave() {
    if (!config || saving) return
    setManualError(null)
    if (!config.ntpEnabled && !isRfc3339WithZone(config.systemTime)) {
      setManualError(pick('Dùng RFC3339 có Z hoặc offset rõ ràng.', 'Use RFC3339 with Z or an explicit offset.'))
      return
    }
    if (!config.ntpEnabled) setConfirmOpen(true)
    else void save()
  }

  async function save() {
    if (!config || saving) return
    setConfirmOpen(false)
    setSaving(true)
    try {
      const result = await apiClient.putTimeConfig({
        timezone: config.timezone,
        ntpEnabled: config.ntpEnabled,
        ntpServers: config.ntpServers,
        systemTime: config.ntpEnabled ? '' : config.systemTime,
        baseRevision: config.revision,
        operationId: crypto.randomUUID()
      })
      result.warnings?.forEach((warning) => toast.push('warn', warning))
      toast.push('success', pick('Đã lưu cấu hình thời gian', 'Time settings saved'))
      await load()
    } catch (saveError) {
      toast.push('error', saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSaving(false)
    }
  }

  const displayedUtc = status ? new Date(new Date(status.nowUtc).getTime() + Date.now() - anchorMs).toISOString() : ''
  const dirty = Boolean(config && savedConfig && JSON.stringify(config) !== JSON.stringify(savedConfig))
  const update = (patch: Partial<TimeConfig>) => setConfig((current) => current ? { ...current, ...patch } : current)

  if (loading && !config) return <State title={pick('Đang tải cấu hình thời gian', 'Loading time settings')} />
  if (error && !config) return <State title={pick('Không tải được cấu hình thời gian', 'Could not load time settings')} detail={error} retry={() => void load()} />
  if (!config || !status) return null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{pick('Thời gian/Ngày', 'Time/Date')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Cấu hình và trạng thái thời gian controller', 'Controller time configuration and status')}</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button className="flex-1 sm:flex-none" icon={<RefreshCw className="h-4 w-4" />} loading={refreshing} disabled={saving} onClick={() => void refreshStatus()}>{pick('Làm mới trạng thái', 'Refresh status')}</Button>
          <Button className="flex-1 sm:flex-none" variant="primary" icon={<Save className="h-4 w-4" />} loading={saving} disabled={refreshing || !dirty} onClick={requestSave}>{pick('Lưu', 'Save')}</Button>
        </div>
      </div>

      <Panel title={pick('Giờ thiết bị hiện tại', 'Current device time')}>
        <div className="grid gap-4 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-4 lg:grid-cols-[1fr_auto]">
          <div className="flex min-w-0 items-center gap-3">
            <Clock3 className="h-7 w-7 shrink-0 text-[var(--c-accent)]" />
            <div className="min-w-0">
              <div className="mono break-all text-lg font-semibold sm:text-xl">{displayedUtc}</div>
              <div className="mt-1 text-xs text-[var(--c-text-dim)]">{status.nowLocal} · {status.timezone}</div>
            </div>
          </div>
          <StatusBadge state={status.synchronized ? 'online' : 'unknown'} label={status.mode === 'ntp' ? 'NTP ON' : 'MANUAL'} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <StatusItem label={pick('Nguồn', 'Source')} value={status.source ?? 'n/a'} />
          <StatusItem label={pick('Độ lệch', 'Offset')} value={status.offsetMs === null ? 'n/a' : `${status.offsetMs} ms`} />
          <StatusItem label={pick('Đồng bộ cuối', 'Last sync')} value={status.lastSyncUtc ?? 'n/a'} />
          <StatusItem label="RTC" value={status.rtcPresent ? status.rtcUtc ?? 'present' : 'not present'} />
        </dl>
        {status.warnings.map((warning) => <div key={warning} className="mt-3 flex gap-2 text-sm text-[var(--c-warn-fg)]"><AlertTriangle className="h-4 w-4 shrink-0" />{warning}</div>)}
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="NTP">
          <div className="space-y-4">
            <label className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm font-semibold">
              {pick('Bật NTP', 'Enable NTP')}
              <input type="checkbox" className="h-4 w-4 accent-[var(--c-accent)]" checked={config.ntpEnabled} onChange={(event) => update({ ntpEnabled: event.target.checked })} />
            </label>
            <label className="block text-xs text-[var(--c-text-dim)]">
              {pick('Máy chủ NTP (phân cách bằng dấu phẩy)', 'NTP servers (comma separated)')}
              <input className={inputClass} value={config.ntpServers.join(', ')} onChange={(event) => update({ ntpServers: event.target.value.split(',').map((server) => server.trim()).filter(Boolean) })} disabled={!config.ntpEnabled} />
            </label>
          </div>
        </Panel>

        <Panel title={pick('Timezone & đặt thủ công', 'Timezone & manual set')}>
          <div className="space-y-4">
            <label className="block text-xs text-[var(--c-text-dim)]">
              Timezone
              <select className={inputClass} value={config.timezone} onChange={(event) => update({ timezone: event.target.value })}>
                {['Asia/Ho_Chi_Minh', 'UTC', 'Asia/Bangkok', 'Asia/Singapore'].map((zone) => <option key={zone}>{zone}</option>)}
              </select>
            </label>
            <label className="block text-xs text-[var(--c-text-dim)]">
              {pick('Đặt giờ thủ công', 'Manual time')}
              <input aria-invalid={Boolean(manualError)} className={inputClass} type="text" placeholder="2026-07-18T10:00:00+07:00" value={config.systemTime} onChange={(event) => { update({ systemTime: event.target.value }); setManualError(null) }} disabled={config.ntpEnabled} />
            </label>
            {manualError && <p className="text-xs text-[var(--c-fault-fg)]">{manualError}</p>}
          </div>
        </Panel>
      </div>

      <Modal open={confirmOpen} title={pick('Xác nhận đổi giờ thủ công', 'Confirm manual time change')} onClose={() => setConfirmOpen(false)} onConfirm={() => void save()}>
        {pick('Đổi wall clock có thể ảnh hưởng audit, lịch và timestamp lịch sử. Tiếp tục?', 'Changing wall clock can affect audit, schedules, and history timestamps. Continue?')}
      </Modal>
    </div>
  )
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-[var(--radius)] bg-[var(--c-surface-2)] p-3"><dt className="text-xs text-[var(--c-text-dim)]">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>
}

function State({ title, detail, retry }: { title: string; detail?: string; retry?: () => void }) {
  const { pick } = useI18n()
  return <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-6 text-sm"><p className="font-semibold">{title}</p>{detail && <p className="mt-2 text-[var(--c-fault-fg)]">{detail}</p>}{retry && <Button className="mt-4" onClick={retry}>{pick('Thử lại', 'Retry')}</Button>}</div>
}
