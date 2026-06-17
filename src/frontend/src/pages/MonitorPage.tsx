import { Circle, RefreshCw, Save, Search, ShieldAlert, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { apiClient } from '../api/client'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { Panel } from '../components/Panel'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/Toast'
import { useApi } from '../hooks/useApi'
import { useI18n } from '../i18n'
import { useRealtime } from '../realtime'
import type { Point, PointKind, PointQuality } from '../types'
import { cn, formatDateTime, formatTime, formatValue, pointNumber, statusColor, statusFill } from '../utils'

const kindLabel: Record<PointKind, string> = {
  DI: 'DIGITAL INPUT',
  DO: 'DIGITAL OUTPUT',
  AI: 'ANALOG INPUT',
  AO: 'ANALOG OUTPUT',
  virtual: 'VIRTUAL'
}

export function MonitorPage() {
  const pointsState = useApi(apiClient.getPoints, [])
  const realtime = useRealtime()
  const toast = useToast()
  const { pick } = useI18n()
  const [kind, setKind] = useState<PointKind | 'all'>('all')
  const [quality, setQuality] = useState<PointQuality | 'all'>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [forceOpen, setForceOpen] = useState(false)
  const [forceValue, setForceValue] = useState('1')
  const [note, setNote] = useState('')

  const points = realtime.allPoints.length ? realtime.allPoints : pointsState.data ?? []
  const selected = points.find((point) => point.id === selectedId) ?? points.find((point) => point.id === 'DI-01') ?? points[0]
  const offline = realtime.connectionState !== 'connected'

  const filtered = useMemo(() => points.filter((point) => {
    const matchesKind = kind === 'all' || point.kind === kind
    const matchesQuality = quality === 'all' || point.quality === quality
    const haystack = `${point.id} ${point.name}`.toLowerCase()
    return matchesKind && matchesQuality && haystack.includes(query.toLowerCase())
  }).sort((a, b) => a.id.localeCompare(b.id)), [kind, points, quality, query])

  const groups = useMemo(() => ({
    DI: filtered.filter((point) => point.kind === 'DI'),
    DO: filtered.filter((point) => point.kind === 'DO'),
    AI: filtered.filter((point) => point.kind === 'AI'),
    AO: filtered.filter((point) => point.kind === 'AO')
  }), [filtered])

  const stats = {
    total: points.length,
    di: points.filter((point) => point.kind === 'DI').length,
    do: points.filter((point) => point.kind === 'DO').length,
    ai: points.filter((point) => point.kind === 'AI').length,
    ao: points.filter((point) => point.kind === 'AO').length,
    on: points.filter((point) => Boolean(point.value)).length,
    analogGood: points.filter((point) => (point.kind === 'AI' || point.kind === 'AO') && point.quality === 'good').length,
    abnormal: points.filter((point) => point.quality !== 'good').length
  }

  async function confirmForce() {
    if (!selected) return
    const value = selected.kind === 'DO' ? forceValue === 'true' || forceValue === '1' || forceValue.toUpperCase() === 'ON' : Number(forceValue)
    try {
      await apiClient.forcePoint(selected.id, value)
      toast.push('success', pick(`Đã gửi Force cho ${selected.id}`, `Force sent to ${selected.id}`))
      setForceOpen(false)
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : 'Force failed')
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-semibold leading-tight">Monitor I/O</h1>
        <p className="text-xs text-[var(--c-text-dim)]">{pick('Giám sát trạng thái điểm I/O', 'Monitor I/O point states')}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <StatCard label={pick('Tổng số điểm', 'Total points')} value={stats.total} detail={`DI ${stats.di} | DO ${stats.do} | AI ${stats.ai} | AO ${stats.ao}`} />
        <StatCard label={pick('Điểm ON', 'ON points')} value={stats.on} detail={`${Math.round((stats.on / Math.max(1, stats.total)) * 100)}%`} />
        <StatCard label={pick('Điểm analog bình thường', 'Normal analog points')} value={stats.analogGood} detail="100%" />
        <StatCard label={pick('Điểm lỗi / mất tín hiệu', 'Fault / signal-loss points')} value={stats.abnormal} detail={`${Math.round((stats.abnormal / Math.max(1, stats.total)) * 100)}%`} danger />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[180px_180px_1fr_132px]">
        <select value={kind} onChange={(event) => setKind(event.target.value as PointKind | 'all')} className="h-10 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-sm">
          <option value="all">{pick('Nhóm I/O - Tất cả', 'I/O group - All')}</option><option value="DI">DI</option><option value="DO">DO</option><option value="AI">AI</option><option value="AO">AO</option>
        </select>
        <select value={quality} onChange={(event) => setQuality(event.target.value as PointQuality | 'all')} className="h-10 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-sm">
          <option value="all">{pick('Trạng thái - Tất cả', 'Status - All')}</option><option value="good">Good</option><option value="uncertain">Uncertain</option><option value="bad">Bad</option><option value="stale">Stale</option>
        </select>
        <label className="flex h-10 items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3">
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full bg-transparent text-sm outline-none" placeholder={pick('Tìm kiếm điểm...', 'Search points...')} />
          <Search className="h-4 w-4 text-[var(--c-text-dim)]" />
        </label>
        <Button icon={<RefreshCw className="h-4 w-4" />} onClick={pointsState.refetch}>{pick('Làm mới', 'Refresh')}</Button>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_334px]">
        <div className={cn('space-y-3', offline && 'stale')}>
          <DigitalSection title="DI - DIGITAL INPUT" rows={groups.DI} selectedId={selected?.id} onSelect={setSelectedId} onToggle={(point) => { setSelectedId(point.id); setForceOpen(false) }} />
          <DigitalSection title="DO - DIGITAL OUTPUT" rows={groups.DO} selectedId={selected?.id} onSelect={setSelectedId} onToggle={(point) => { setSelectedId(point.id); setForceValue(String(!point.value)); setForceOpen(true) }} />
          <AnalogSection title="AI - ANALOG INPUT" rows={groups.AI} selectedId={selected?.id} onSelect={setSelectedId} />
          <AnalogSection title="AO - ANALOG OUTPUT" rows={groups.AO} selectedId={selected?.id} onSelect={setSelectedId} onForce={(point) => { setSelectedId(point.id); setForceValue(String(pointNumber(point))); setForceOpen(true) }} />
        </div>
        {selected && <DetailPanel point={selected} note={note} setNote={setNote} onForce={() => { setForceValue(selected.kind === 'DO' ? String(!selected.value) : String(pointNumber(selected))); setForceOpen(true) }} />}
      </div>

      <Modal open={forceOpen} title={`Force ${selected?.id ?? ''}`} danger confirmLabel={pick('Force 10 phút', 'Force 10 minutes')} onConfirm={confirmForce} onClose={() => setForceOpen(false)}>
        <div className="space-y-4">
          <div className="flex gap-3 rounded-[var(--radius)] border border-[rgba(224,161,6,0.38)] bg-[rgba(224,161,6,0.08)] p-3 text-[var(--c-warn-fg)]">
            <ShieldAlert className="h-5 w-5 shrink-0" />
            {pick('Force tự hết hạn sau 10 phút. Chỉ dùng khi commissioning hoặc xử lý sự cố có kiểm soát.', 'Force automatically expires after 10 minutes. Use only for commissioning or controlled troubleshooting.')}
          </div>
          <label className="block text-sm">{pick('Giá trị Force', 'Force value')}<input value={forceValue} onChange={(event) => setForceValue(event.target.value)} className="mono mt-2 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3" /></label>
        </div>
      </Modal>
    </div>
  )
}

function StatCard({ label, value, detail, danger }: { label: string; value: number; detail: string; danger?: boolean }) {
  const color = danger ? 'var(--c-fault-fg)' : 'var(--c-good-fg)'
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4">
      <div className="text-[11px] uppercase text-[var(--c-text-dim)]">{label}</div>
      <div className="mono mt-3 text-4xl font-bold" style={{ color }}>{value}</div>
      <div className="mt-2 flex justify-between text-xs text-[var(--c-text-dim)]"><span>{detail}</span></div>
    </div>
  )
}

function DigitalSection({ title, rows, selectedId, onSelect, onToggle }: { title: string; rows: Point[]; selectedId?: string; onSelect: (id: string) => void; onToggle: (point: Point) => void }) {
  const { pick } = useI18n()
  return (
    <SectionFrame title={`${title} (${rows.length})`}>
      <div className="grid grid-cols-[70px_minmax(150px,1fr)_112px_128px_58px] border-b border-[var(--c-border)] px-3 py-2 text-[10px] uppercase text-[var(--c-text-dim)]">
        <span>{pick('Điểm', 'Point')}</span><span>{pick('Tên điểm', 'Point name')}</span><span>{pick('Trạng thái', 'Status')}</span><span>{pick('Thời gian cập nhật', 'Updated at')}</span><span />
      </div>
      {rows.map((point) => <DigitalRow key={point.id} point={point} selected={point.id === selectedId} onSelect={onSelect} onToggle={onToggle} />)}
    </SectionFrame>
  )
}

function DigitalRow({ point, selected, onSelect, onToggle }: { point: Point; selected: boolean; onSelect: (id: string) => void; onToggle: (point: Point) => void }) {
  const active = Boolean(point.value)
  const state = active ? 'on' : 'off'
  const stateFillColor = statusFill(state)
  const stateTextColor = statusColor(state)
  return (
    <button type="button" onClick={() => onSelect(point.id)} className={cn('grid w-full grid-cols-[70px_minmax(150px,1fr)_112px_128px_58px] items-center border-b border-[var(--c-border)] px-3 py-2 text-left text-xs transition last:border-0 hover:bg-[rgba(42,92,138,0.08)]', selected && 'bg-[rgba(42,92,138,0.12)]')}>
      <span className="mono font-semibold">{point.id}</span>
      <span className="truncate font-semibold">{point.name}</span>
      <span className="inline-flex items-center gap-2 font-semibold" style={{ color: stateTextColor }}><Circle className="h-2.5 w-2.5 fill-current" style={{ color: stateFillColor }} />{active ? 'ON' : 'OFF'}</span>
      <span className="mono text-[var(--c-text-dim)]">{formatTime(point.updatedAt)}</span>
      <span onClick={(event) => { event.stopPropagation(); onToggle(point) }} className={cn('ml-auto flex h-5 w-9 items-center rounded-full border px-0.5 transition', active ? 'justify-end border-[var(--c-good)] bg-[rgba(47,164,90,0.14)]' : 'justify-start border-[var(--c-border)] bg-[var(--c-surface-2)]')} role="switch" aria-checked={active} tabIndex={0}>
        <span className={cn('h-3.5 w-3.5 rounded-full', active ? 'bg-[var(--c-good)]' : 'bg-[var(--c-off)]')} />
      </span>
    </button>
  )
}

function AnalogSection({ title, rows, selectedId, onSelect, onForce }: { title: string; rows: Point[]; selectedId?: string; onSelect: (id: string) => void; onForce?: (point: Point) => void }) {
  const { pick } = useI18n()
  return (
    <SectionFrame title={`${title} (${rows.length})`}>
      <div className="grid grid-cols-[70px_minmax(150px,1fr)_70px_60px_120px_90px_84px] border-b border-[var(--c-border)] px-3 py-2 text-[10px] uppercase text-[var(--c-text-dim)]">
        <span>{pick('Điểm', 'Point')}</span><span>{pick('Tên điểm', 'Point name')}</span><span>{pick('Giá trị', 'Value')}</span><span>{pick('Đơn vị', 'Unit')}</span><span>{pick('Trạng thái', 'Status')}</span><span>Trend</span><span>{pick('Cập nhật', 'Updated')}</span>
      </div>
      {rows.map((point) => <AnalogRow key={point.id} point={point} selected={point.id === selectedId} onSelect={onSelect} onForce={onForce} />)}
    </SectionFrame>
  )
}

function AnalogRow({ point, selected, onSelect, onForce }: { point: Point; selected: boolean; onSelect: (id: string) => void; onForce?: (point: Point) => void }) {
  const { pick } = useI18n()
  const statusText = point.quality === 'good' ? pick('Bình thường', 'Normal') : point.quality === 'uncertain' ? pick('Lỗi - HIGH', 'Fault - HIGH') : point.quality.toUpperCase()
  return (
    <button type="button" onClick={() => onSelect(point.id)} className={cn('grid w-full grid-cols-[70px_minmax(150px,1fr)_70px_60px_120px_90px_84px] items-center border-b border-[var(--c-border)] px-3 py-2 text-left text-xs transition last:border-0 hover:bg-[rgba(42,92,138,0.08)]', selected && 'bg-[rgba(42,92,138,0.12)]')}>
      <span className="mono font-semibold">{point.id}</span>
      <span className="truncate font-semibold">{point.name}</span>
      <span className="mono">{typeof point.value === 'number' ? point.value.toFixed(1) : point.value}</span>
      <span className="mono text-[var(--c-text-dim)]">{point.unit ?? '-'}</span>
      <span className="inline-flex items-center gap-2"><Circle className="h-2.5 w-2.5 fill-current" style={{ color: statusFill(point.quality) }} />{statusText}</span>
      <span onClick={(event) => { if (onForce) { event.stopPropagation(); onForce(point) } }}><Sparkline values={point.trend ?? [pointNumber(point)]} color={point.quality === 'good' ? 'var(--c-accent-2)' : point.quality === 'bad' ? 'var(--c-fault-fg)' : 'var(--c-warn-fg)'} /></span>
      <span className="mono text-[var(--c-text-dim)]">{formatTime(point.updatedAt)}</span>
    </button>
  )
}

function SectionFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)]">
      <div className="border-b border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 py-2 text-xs font-semibold text-[var(--c-accent)]">{title}</div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  )
}

function DetailPanel({ point, note, setNote, onForce }: { point: Point; note: string; setNote: (value: string) => void; onForce: () => void }) {
  const { pick } = useI18n()
  const active = Boolean(point.value)
  const isBinary = point.kind === 'DI' || point.kind === 'DO'
  const binaryState = active ? 'on' : 'off'
  const binaryTextColor = statusColor(binaryState)
  const valuePanelStyle = isBinary
    ? { borderColor: active ? 'rgba(47,164,90,0.48)' : 'var(--c-border)', backgroundColor: active ? 'rgba(47,164,90,0.12)' : 'var(--c-surface-2)' }
    : undefined
  const canForce = point.kind === 'AO' || point.kind === 'DO'
  const groupText = `${point.kind} - ${kindLabel[point.kind]}`
  const history = [0, 1, 2, 3, 4].map((index) => ({ time: new Date(Date.now() - index * 7 * 60_000).toISOString(), value: index % 2 === 0 ? active : !active }))
  return (
    <div className="space-y-3">
      <Panel title={pick('Chi tiết điểm', 'Point details')} action={<X className="h-4 w-4 text-[var(--c-accent)]" />}>
        <div className="space-y-4">
          <div><div className="text-2xl font-semibold">{point.id}</div><div className="mt-1 text-sm font-semibold">{point.name}</div></div>
          <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-4 text-center" style={valuePanelStyle}>
            <div className="mono text-2xl font-bold text-[var(--c-accent)]" style={isBinary ? { color: binaryTextColor } : undefined}>{formatValue(point.value, point.unit)}</div>
            <div className="mt-1 text-xs font-semibold text-[var(--c-text-dim)]" style={isBinary ? { color: binaryTextColor } : undefined}>{active ? pick('Kích hoạt', 'Active') : pick('Không kích hoạt', 'Inactive')}</div>
          </div>
          <dl className="grid grid-cols-[118px_1fr] gap-y-3 text-xs">
            <dt className="text-[var(--c-text-dim)]">{pick('Nhóm I/O', 'I/O group')}</dt><dd>{groupText}</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Kiểu tín hiệu', 'Signal type')}</dt><dd>{point.sensorType ?? 'Dry Contact'}</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Trạng thái hiện tại', 'Current status')}</dt><dd className="font-semibold" style={isBinary ? { color: binaryTextColor } : undefined}>{active ? pick('ON (Kích hoạt)', 'ON (Active)') : 'OFF'}</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Trạng thái logic', 'Logic state')}</dt><dd>{active ? 1 : 0}</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Thời gian thay đổi', 'Changed at')}</dt><dd className="mono">{formatDateTime(point.updatedAt)}</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Thời gian cập nhật', 'Updated at')}</dt><dd className="mono">{formatDateTime(point.updatedAt)}</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Bộ đếm kích hoạt', 'Activation count')}</dt><dd>15</dd>
            <dt className="text-[var(--c-text-dim)]">{pick('Mô tả', 'Description')}</dt><dd>{point.id === 'DI-01' ? pick('Nút dừng khẩn cấp hệ thống', 'System emergency stop button') : point.name}</dd>
          </dl>
          <StatusBadge state={point.forced ? 'force' : point.quality} />
          {canForce && <Button className="w-full" variant="danger" onClick={onForce}>Force output</Button>}
        </div>
      </Panel>

      <Panel title={pick('Lịch sử trạng thái', 'Status history')}>
        <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)]">
          <div className="grid grid-cols-[1fr_86px] bg-[var(--c-surface-2)] px-3 py-2 text-[10px] uppercase text-[var(--c-text-dim)]"><span>{pick('Thời gian', 'Time')}</span><span>{pick('Trạng thái', 'Status')}</span></div>
          {history.map((item) => {
            const itemState = item.value ? 'on' : 'off'
            return <div key={item.time} className="grid grid-cols-[1fr_86px] border-t border-[var(--c-border)] px-3 py-2 text-xs"><span className="mono">{formatDateTime(item.time)}</span><span className="font-semibold" style={{ color: statusColor(itemState) }}>{item.value ? 'ON' : 'OFF'} ●</span></div>
          })}
        </div>
        <button className="mt-3 text-xs font-semibold text-[var(--c-accent)]">{pick('Xem thêm lịch sử', 'View more history')} →</button>
      </Panel>

      <Panel title={pick('Ghi chú', 'Notes')}>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={pick('Nhập ghi chú...', 'Enter notes...')} className="min-h-[84px] w-full resize-none rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-3 text-sm outline-none" />
        <Button className="mt-3 w-full" variant="primary" icon={<Save className="h-4 w-4" />}>{pick('Lưu ghi chú', 'Save note')}</Button>
      </Panel>
    </div>
  )
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const safe = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0]
  const min = Math.min(...safe)
  const max = Math.max(...safe)
  const span = Math.max(1, max - min)
  const points = safe.map((value, index) => `${(index / (safe.length - 1)) * 80},${24 - ((value - min) / span) * 20}`).join(' ')
  return <svg viewBox="0 0 80 28" className="h-7 w-20" aria-hidden="true"><polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}