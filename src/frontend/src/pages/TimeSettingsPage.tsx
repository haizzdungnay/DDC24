import { Clock3, RefreshCw, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../components/Button'
import { Panel } from '../components/Panel'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/Toast'
import { useI18n } from '../i18n'
import { formatDateTime } from '../utils'

export function TimeSettingsPage() {
  const { pick } = useI18n()
  const [now, setNow] = useState(() => new Date())
  const [ntpEnabled, setNtpEnabled] = useState(true)
  const [server, setServer] = useState('pool.ntp.org')
  const [timezone, setTimezone] = useState('Asia/Ho_Chi_Minh')
  const [manualTime, setManualTime] = useState('2026-06-16T09:00')
  const toast = useToast()

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{pick('Thời gian/Ngày', 'Time/Date')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Cấu hình thời gian thiết bị (demo simulator)', 'Device time configuration (demo simulator)')}</p>
        </div>
        <div className="flex gap-2">
          <Button icon={<RefreshCw className="h-4 w-4" />} onClick={() => toast.push('success', pick('Đã đồng bộ thời gian (demo)', 'Time synchronized (demo)'))}>{pick('Đồng bộ', 'Sync')}</Button>
          <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={() => toast.push('success', pick('Đã lưu cấu hình thời gian (demo)', 'Time settings saved (demo)'))}>{pick('Lưu', 'Save')}</Button>
        </div>
      </div>

      <Panel title={pick('Giờ thiết bị hiện tại', 'Current device time')}>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-4">
          <div className="flex items-center gap-3">
            <Clock3 className="h-7 w-7 text-[var(--c-accent)]" />
            <div>
              <div className="mono text-xl font-semibold">{formatDateTime(now.toISOString())}</div>
              <div className="mt-1 text-xs text-[var(--c-text-dim)]">Timezone: {timezone}</div>
            </div>
          </div>
          <StatusBadge state={ntpEnabled ? 'online' : 'unknown'} label={ntpEnabled ? 'NTP ON' : 'MANUAL'} />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="NTP">
          <div className="space-y-4">
            <label className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm font-semibold">
              {pick('Bật NTP', 'Enable NTP')}
              <input type="checkbox" className="h-4 w-4 accent-[var(--c-accent)]" checked={ntpEnabled} onChange={(event) => setNtpEnabled(event.target.checked)} />
            </label>
            <label className="block text-xs text-[var(--c-text-dim)]">
              NTP server
              <input className="mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]" value={server} onChange={(event) => setServer(event.target.value)} disabled={!ntpEnabled} />
            </label>
          </div>
        </Panel>

        <Panel title={pick('Timezone & đặt thủ công', 'Timezone & manual set')}>
          <div className="space-y-4">
            <label className="block text-xs text-[var(--c-text-dim)]">
              Timezone
              <select className="mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                <option value="Asia/Ho_Chi_Minh">Asia/Ho_Chi_Minh</option>
                <option value="UTC">UTC</option>
                <option value="Asia/Bangkok">Asia/Bangkok</option>
                <option value="Asia/Singapore">Asia/Singapore</option>
              </select>
            </label>
            <label className="block text-xs text-[var(--c-text-dim)]">
              {pick('Đặt giờ thủ công', 'Manual time')}
              <input className="mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]" type="datetime-local" value={manualTime} onChange={(event) => setManualTime(event.target.value)} disabled={ntpEnabled} />
            </label>
          </div>
        </Panel>
      </div>
    </div>
  )
}