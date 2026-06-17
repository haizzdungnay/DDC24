import { Save, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../components/Button'
import { Panel } from '../components/Panel'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/Toast'
import { getAlarmSettings } from '../demo/simulator'
import { useI18n } from '../i18n'
import type { AlarmPriority, AlarmSetting } from '../types'

const priorities: AlarmPriority[] = ['low', 'medium', 'high', 'critical']
const numericKeys = ['hh', 'h', 'l', 'll', 'delayS'] as const

type NumericKey = typeof numericKeys[number]

export function AlarmSettingsPage() {
  const { pick } = useI18n()
  const [rows, setRows] = useState<AlarmSetting[]>(() => getAlarmSettings())
  const toast = useToast()

  function updateNumber(pointId: string, key: NumericKey, value: number) {
    setRows((current) => current.map((row) => row.pointId === pointId ? { ...row, [key]: value } : row))
  }

  function updateRow(pointId: string, patch: Partial<AlarmSetting>) {
    setRows((current) => current.map((row) => row.pointId === pointId ? { ...row, ...patch } : row))
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{pick('Cấu hình cảnh báo', 'Alarm settings')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Ngưỡng HH/H/L/LL, delay và priority cho point demo', 'HH/H/L/LL thresholds, delay, and priority for demo points')}</p>
        </div>
        <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={() => toast.push('success', pick('Đã lưu cấu hình cảnh báo (demo)', 'Alarm settings saved (demo)'))}>{pick('Lưu', 'Save')}</Button>
      </div>

      <Panel title={pick('Bảng cấu hình cảnh báo', 'Alarm configuration table')} subtitle={pick('Inline edit local cho Demo UI Rev A; không đổi REST/WS contract.', 'Local inline edit for Demo UI Rev A; no REST/WS contract changes.')}>
        <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)]">
          <div className="grid min-w-[920px] grid-cols-[110px_1.1fr_repeat(5,92px)_120px_96px] bg-[var(--c-surface-2)] px-3 py-2 text-[10px] font-semibold uppercase text-[var(--c-text-dim)]">
            <span>Point</span><span>Label</span><span>HH</span><span>H</span><span>L</span><span>LL</span><span>Delay</span><span>Priority</span><span>{pick('Bật', 'Enable')}</span>
          </div>
          <div className="overflow-auto">
            {rows.map((row) => (
              <div key={row.pointId} className="grid min-w-[920px] grid-cols-[110px_1.1fr_repeat(5,92px)_120px_96px] items-center gap-2 border-t border-[var(--c-border)] px-3 py-3 text-sm">
                <div className="mono font-semibold">{row.pointId}</div>
                <div className="flex items-center gap-2 font-semibold"><SlidersHorizontal className="h-4 w-4 text-[var(--c-accent)]" />{row.label}</div>
                {numericKeys.map((key) => (
                  <input key={key} className="h-9 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]" type="number" value={row[key]} onChange={(event) => updateNumber(row.pointId, key, Number(event.target.value))} />
                ))}
                <select className="h-9 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]" value={row.priority} onChange={(event) => updateRow(row.pointId, { priority: event.target.value as AlarmPriority })}>
                  {priorities.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                </select>
                <label className="flex items-center gap-2 text-xs font-semibold text-[var(--c-text-dim)]">
                  <input className="h-4 w-4 accent-[var(--c-accent)]" type="checkbox" checked={row.enabled} onChange={(event) => updateRow(row.pointId, { enabled: event.target.checked })} />
                  {row.enabled ? 'ON' : 'OFF'}
                </label>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <Panel title={pick('Trạng thái cấu hình', 'Configuration status')}>
        <div className="flex flex-wrap gap-3">
          <StatusBadge state="online" label={`${rows.filter((row) => row.enabled).length} ENABLED`} />
          <StatusBadge state="critical" label={`${rows.filter((row) => row.priority === 'critical').length} CRITICAL`} />
          <StatusBadge state="uncertain" label="DEMO LOCAL" />
        </div>
      </Panel>
    </div>
  )
}