import { ChevronLeft, ChevronRight, Save, SlidersHorizontal, Wand2, Table2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../components/Button'
import { Panel } from '../components/Panel'
import { StatusBadge } from '../components/StatusBadge'
import { Tabs } from '../components/Tabs'
import { useToast } from '../components/Toast'
import { getAlarmSettings, getDemoPoints } from '../demo/simulator'
import { useI18n } from '../i18n'
import type { AlarmPriority, AlarmSetting, AlarmType } from '../types'

/* ── Alarm type label map (vi/en) ── */
const ALARM_TYPE_LABELS: Record<AlarmType, { vi: string; en: string }> = {
  0: { vi: 'Không kích hoạt', en: 'Not active' },
  1: { vi: 'High/Low input', en: 'High/Low input' },
  2: { vi: 'Setpoint deviation', en: 'Setpoint deviation' },
  3: { vi: 'Runtime alarm', en: 'Runtime alarm' },
  4: { vi: 'Supervise fan state', en: 'Supervise fan state' },
  5: { vi: 'Supervise digital output', en: 'Supervise digital output' },
  6: { vi: 'Supervise analog output', en: 'Supervise analog output' },
  7: { vi: 'Supervise PI-sequence', en: 'Supervise PI-sequence' },
}

const ALARM_TYPE_DESC: Record<AlarmType, { vi: string; en: string }> = {
  0: { vi: 'Alarm không hoạt động, ẩn tất cả ngưỡng.', en: 'Alarm inactive, all thresholds hidden.' },
  1: { vi: 'Cảnh báo dựa trên ngưỡng HH/H/L/LL + delay.', en: 'Alarm based on HH/H/L/LL thresholds + delay.' },
  2: { vi: 'Cảnh báo khi giá trị lệch khỏi setpoint (H/L + delay).', en: 'Alarm when value deviates from setpoint (H/L + delay).' },
  3: { vi: 'Cảnh báo giờ chạy thiết bị (runtime seconds).', en: 'Equipment runtime alarm (runtime seconds).' },
  4: { vi: 'Giám sát trạng thái quạt qua source point.', en: 'Supervise fan state via source point.' },
  5: { vi: 'Giám sát digital output qua source point.', en: 'Supervise digital output via source point.' },
  6: { vi: 'Giám sát analog output qua source point.', en: 'Supervise analog output via source point.' },
  7: { vi: 'Giám sát chuỗi PI qua source point.', en: 'Supervise PI-sequence via source point.' },
}

const ALARM_TYPES: AlarmType[] = [0, 1, 2, 3, 4, 5, 6, 7]
const PRIORITIES: AlarmPriority[] = ['low', 'medium', 'high', 'critical']

/* ── Shared input styles ── */
const INPUT_CLS = 'h-9 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]'
const SELECT_CLS = INPUT_CLS
const CHECKBOX_CLS = 'h-4 w-4 accent-[var(--c-accent)]'

export function AlarmSettingsPage() {
  const { pick } = useI18n()
  const toast = useToast()
  const [rows, setRows] = useState<AlarmSetting[]>(() => getAlarmSettings())
  const [wizardIdx, setWizardIdx] = useState(0)

  const pointIds = getDemoPoints().map((p) => p.id)

  function updateRow(pointId: string, patch: Partial<AlarmSetting>) {
    setRows((cur) => cur.map((r) => (r.pointId === pointId ? { ...r, ...patch } : r)))
  }

  function handleSave() {
    toast.push('success', pick('Đã lưu cấu hình cảnh báo (demo)', 'Alarm settings saved (demo)'))
  }

  const tabs = [
    { key: 'wizard', label: pick('Wizard (Presets)', 'Wizard (Presets)'), icon: <Wand2 className="h-4 w-4" /> },
    { key: 'advanced', label: pick('Advanced (Parameters)', 'Advanced (Parameters)'), icon: <Table2 className="h-4 w-4" /> },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{pick('Cấu hình cảnh báo', 'Alarm settings')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Alarm type, ngưỡng, interlock — EasySet parity Rev A', 'Alarm type, thresholds, interlock — EasySet parity Rev A')}</p>
        </div>
        <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={handleSave}>{pick('Lưu', 'Save')}</Button>
      </div>

      <Panel>
        <Tabs tabs={tabs} defaultTab="wizard">
          {(activeKey) =>
            activeKey === 'wizard'
              ? <WizardTab rows={rows} wizardIdx={wizardIdx} setWizardIdx={setWizardIdx} updateRow={updateRow} pointIds={pointIds} pick={pick} />
              : <AdvancedTab rows={rows} updateRow={updateRow} pointIds={pointIds} pick={pick} />
          }
        </Tabs>
      </Panel>

      <Panel title={pick('Trạng thái cấu hình', 'Configuration status')}>
        <div className="flex flex-wrap gap-3">
          <StatusBadge state="online" label={`${rows.filter((r) => r.enabled).length} ENABLED`} />
          <StatusBadge state="critical" label={`${rows.filter((r) => r.priority === 'critical').length} CRITICAL`} />
          <StatusBadge state="uncertain" label="DEMO LOCAL" />
        </div>
      </Panel>
    </div>
  )
}

/* ══════════════════════════════════════════════════════
   WIZARD TAB
   ══════════════════════════════════════════════════════ */
interface WizardProps {
  rows: AlarmSetting[]
  wizardIdx: number
  setWizardIdx: (i: number) => void
  updateRow: (pointId: string, patch: Partial<AlarmSetting>) => void
  pointIds: string[]
  pick: (vi: string, en: string) => string
}

function WizardTab({ rows, wizardIdx, setWizardIdx, updateRow, pointIds, pick }: WizardProps) {
  const row = rows[wizardIdx]
  if (!row) return null

  const typeLabel = ALARM_TYPE_LABELS[row.alarmType]
  const typeDesc = ALARM_TYPE_DESC[row.alarmType]

  return (
    <div className="space-y-6">
      {/* alarm list strip */}
      <div className="flex flex-wrap gap-2">
        {rows.map((r, i) => (
          <button
            key={r.pointId}
            onClick={() => setWizardIdx(i)}
            className={`rounded-[var(--radius)] border px-3 py-1.5 text-xs font-semibold transition ${wizardIdx === i ? 'border-[var(--c-accent)] bg-[var(--c-surface-2)] text-[var(--c-accent)]' : 'border-[var(--c-border)] text-[var(--c-text-dim)] hover:border-[var(--c-text-dim)]'}`}
          >
            {r.pointId}
          </button>
        ))}
      </div>

      {/* current alarm card */}
      <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-5">
        <div className="mb-4 flex items-center gap-3">
          <SlidersHorizontal className="h-5 w-5 text-[var(--c-accent)]" />
          <div>
            <div className="text-base font-bold text-[var(--c-text)]">{row.pointId} — {row.label}</div>
            <div className="text-xs text-[var(--c-text-dim)]">{pick(typeDesc.vi, typeDesc.en)}</div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Alarm Type */}
          <FieldGroup label={pick('Loại alarm', 'Alarm Type')}>
            <select className={SELECT_CLS} value={row.alarmType} onChange={(e) => updateRow(row.pointId, { alarmType: Number(e.target.value) as AlarmType })}>
              {ALARM_TYPES.map((t) => <option key={t} value={t}>{t} — {pick(ALARM_TYPE_LABELS[t].vi, ALARM_TYPE_LABELS[t].en)}</option>)}
            </select>
          </FieldGroup>

          {/* Priority */}
          <FieldGroup label={pick('Mức ưu tiên', 'Priority')}>
            <select className={SELECT_CLS} value={row.priority} onChange={(e) => updateRow(row.pointId, { priority: e.target.value as AlarmPriority })}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
            </select>
          </FieldGroup>

          {/* Enabled + Interlock */}
          <FieldGroup label={pick('Bật', 'Enabled')}>
            <label className="flex items-center gap-2 text-sm text-[var(--c-text)]">
              <input className={CHECKBOX_CLS} type="checkbox" checked={row.enabled} onChange={(e) => updateRow(row.pointId, { enabled: e.target.checked })} />
              {row.enabled ? 'ON' : 'OFF'}
            </label>
          </FieldGroup>

          <FieldGroup label="Interlock">
            <label className="flex items-center gap-2 text-sm text-[var(--c-text)]">
              <input className={CHECKBOX_CLS} type="checkbox" checked={row.interlock} onChange={(e) => updateRow(row.pointId, { interlock: e.target.checked })} />
              {row.interlock ? 'ON' : 'OFF'}
            </label>
          </FieldGroup>
        </div>

        {/* Conditional fields by alarm type */}
        <div className="mt-5 border-t border-[var(--c-border)] pt-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--c-text-dim)]">
            {pick(typeLabel.vi, typeLabel.en)} — {pick('Tham số', 'Parameters')}
          </div>
          <TypeFields row={row} updateRow={updateRow} pointIds={pointIds} pick={pick} />
        </div>
      </div>

      {/* Prev / Next nav */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" icon={<ChevronLeft className="h-4 w-4" />} disabled={wizardIdx === 0} onClick={() => setWizardIdx(wizardIdx - 1)}>
          {pick('Trước', 'Prev')}
        </Button>
        <span className="text-xs text-[var(--c-text-dim)]">{wizardIdx + 1} / {rows.length}</span>
        <Button variant="ghost" disabled={wizardIdx >= rows.length - 1} onClick={() => setWizardIdx(wizardIdx + 1)}>
          {pick('Kế tiếp', 'Next')}
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

/* ── Conditional fields by alarm type ── */
interface TypeFieldsProps {
  row: AlarmSetting
  updateRow: (pointId: string, patch: Partial<AlarmSetting>) => void
  pointIds: string[]
  pick: (vi: string, en: string) => string
}

function TypeFields({ row, updateRow, pointIds, pick }: TypeFieldsProps) {
  const id = row.pointId
  const t = row.alarmType

  if (t === 0) {
    return <p className="text-sm italic text-[var(--c-text-dim)]">{pick('Alarm không kích hoạt — không có tham số.', 'Alarm not active — no parameters.')}</p>
  }

  if (t === 1) {
    return (
      <div className="grid gap-3 sm:grid-cols-5">
        <NumField label="HH" value={row.hh} onChange={(v) => updateRow(id, { hh: v })} />
        <NumField label="H" value={row.h} onChange={(v) => updateRow(id, { h: v })} />
        <NumField label="L" value={row.l} onChange={(v) => updateRow(id, { l: v })} />
        <NumField label="LL" value={row.ll} onChange={(v) => updateRow(id, { ll: v })} />
        <NumField label={pick('Delay (s)', 'Delay (s)')} value={row.delayS} onChange={(v) => updateRow(id, { delayS: v })} />
      </div>
    )
  }

  if (t === 2) {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <NumField label={pick('Lệch H', 'Deviation H')} value={row.h} onChange={(v) => updateRow(id, { h: v })} />
        <NumField label={pick('Lệch L', 'Deviation L')} value={row.l} onChange={(v) => updateRow(id, { l: v })} />
        <NumField label={pick('Delay (s)', 'Delay (s)')} value={row.delayS} onChange={(v) => updateRow(id, { delayS: v })} />
      </div>
    )
  }

  if (t === 3) {
    return (
      <div className="grid gap-3 sm:grid-cols-1 max-w-xs">
        <NumField label={pick('Runtime (giây)', 'Runtime (seconds)')} value={row.delayS} onChange={(v) => updateRow(id, { delayS: v })} />
      </div>
    )
  }

  // 4, 5, 6, 7 — supervise types
  return (
    <div className="grid gap-3 sm:grid-cols-2 max-w-lg">
      <FieldGroup label={pick('Source Point', 'Source Point')}>
        <select className={SELECT_CLS} value={row.sourcePointId} onChange={(e) => updateRow(id, { sourcePointId: e.target.value })}>
          <option value="">{pick('— Chọn —', '— Select —')}</option>
          {pointIds.map((pid) => <option key={pid} value={pid}>{pid}</option>)}
        </select>
      </FieldGroup>
      <NumField label={pick('Ack Delay (s)', 'Ack Delay (s)')} value={row.ackDelayS} onChange={(v) => updateRow(id, { ackDelayS: v })} />
    </div>
  )
}

/* ══════════════════════════════════════════════════════
   ADVANCED TAB — full table, inline-edit
   ══════════════════════════════════════════════════════ */
interface AdvancedProps {
  rows: AlarmSetting[]
  updateRow: (pointId: string, patch: Partial<AlarmSetting>) => void
  pointIds: string[]
  pick: (vi: string, en: string) => string
}

function AdvancedTab({ rows, updateRow, pointIds, pick }: AdvancedProps) {
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1200px] text-sm">
          <thead>
            <tr className="bg-[var(--c-surface-2)] text-[10px] font-semibold uppercase text-[var(--c-text-dim)]">
              <th className="px-3 py-2 text-left">Point</th>
              <th className="px-3 py-2 text-left">Label</th>
              <th className="px-3 py-2 text-left">{pick('Loại', 'Type')}</th>
              <th className="px-2 py-2">HH</th>
              <th className="px-2 py-2">H</th>
              <th className="px-2 py-2">L</th>
              <th className="px-2 py-2">LL</th>
              <th className="px-2 py-2">Delay</th>
              <th className="px-3 py-2 text-left">Source</th>
              <th className="px-2 py-2">AckDelay</th>
              <th className="px-3 py-2 text-left">Priority</th>
              <th className="px-2 py-2">{pick('Bật', 'En')}</th>
              <th className="px-2 py-2">Intrlk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.pointId} className="border-t border-[var(--c-border)]">
                <td className="whitespace-nowrap px-3 py-2 font-mono font-semibold">{row.pointId}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="flex items-center gap-1.5"><SlidersHorizontal className="h-3.5 w-3.5 text-[var(--c-accent)]" />{row.label}</span>
                </td>
                <td className="px-3 py-2">
                  <select className={`${SELECT_CLS} w-full min-w-[140px]`} value={row.alarmType} onChange={(e) => updateRow(row.pointId, { alarmType: Number(e.target.value) as AlarmType })}>
                    {ALARM_TYPES.map((at) => <option key={at} value={at}>{at} — {pick(ALARM_TYPE_LABELS[at].vi, ALARM_TYPE_LABELS[at].en)}</option>)}
                  </select>
                </td>
                <td className="px-2 py-2"><input className={`${INPUT_CLS} w-[72px]`} type="number" value={row.hh} onChange={(e) => updateRow(row.pointId, { hh: Number(e.target.value) })} /></td>
                <td className="px-2 py-2"><input className={`${INPUT_CLS} w-[72px]`} type="number" value={row.h} onChange={(e) => updateRow(row.pointId, { h: Number(e.target.value) })} /></td>
                <td className="px-2 py-2"><input className={`${INPUT_CLS} w-[72px]`} type="number" value={row.l} onChange={(e) => updateRow(row.pointId, { l: Number(e.target.value) })} /></td>
                <td className="px-2 py-2"><input className={`${INPUT_CLS} w-[72px]`} type="number" value={row.ll} onChange={(e) => updateRow(row.pointId, { ll: Number(e.target.value) })} /></td>
                <td className="px-2 py-2"><input className={`${INPUT_CLS} w-[72px]`} type="number" value={row.delayS} onChange={(e) => updateRow(row.pointId, { delayS: Number(e.target.value) })} /></td>
                <td className="px-3 py-2">
                  <select className={`${SELECT_CLS} w-full min-w-[90px]`} value={row.sourcePointId} onChange={(e) => updateRow(row.pointId, { sourcePointId: e.target.value })}>
                    <option value="">—</option>
                    {pointIds.map((pid) => <option key={pid} value={pid}>{pid}</option>)}
                  </select>
                </td>
                <td className="px-2 py-2"><input className={`${INPUT_CLS} w-[72px]`} type="number" value={row.ackDelayS} onChange={(e) => updateRow(row.pointId, { ackDelayS: Number(e.target.value) })} /></td>
                <td className="px-3 py-2">
                  <select className={`${SELECT_CLS} w-full min-w-[90px]`} value={row.priority} onChange={(e) => updateRow(row.pointId, { priority: e.target.value as AlarmPriority })}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td className="px-2 py-2 text-center">
                  <input className={CHECKBOX_CLS} type="checkbox" checked={row.enabled} onChange={(e) => updateRow(row.pointId, { enabled: e.target.checked })} />
                </td>
                <td className="px-2 py-2 text-center">
                  <input className={CHECKBOX_CLS} type="checkbox" checked={row.interlock} onChange={(e) => updateRow(row.pointId, { interlock: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── Shared small components ── */
function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-[var(--c-text-dim)]">{label}</label>
      {children}
    </div>
  )
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <FieldGroup label={label}>
      <input className={`${INPUT_CLS} w-full`} type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </FieldGroup>
  )
}
