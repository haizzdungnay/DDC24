import { Circle, RefreshCw, Save, Search, ShieldAlert, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { apiClient } from '../api/client'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { Panel } from '../components/Panel'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/Toast'
import { useApi } from '../hooks/useApi'
import { useRealtime } from '../realtime'
import type { Point, PointKind, PointQuality } from '../types'
import { cn, formatDateTime, formatTime, formatValue, pointNumber, statusColor } from '../utils'

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
      toast.push('success', `Đã gửi Force cho ${selected.id}`)
      setForceOpen(false)
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : 'Force failed')
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-semibold leading-tight">Monitor I/O</h1>
        <p className="text-xs text-[var(--c-text-dim)]">Giám sát trạng thái điểm I/O</p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <StatCard label="Tổng số điểm" value={stats.total} detail={`DI ${stats.di} | DO ${stats.do} | AI ${stats.ai} | AO ${stats.ao}`} />
        <StatCard label="Điểm ON" value={stats.on} detail={`${Math.round((stats.on / Math.max(1, stats.total)) * 100)}%`} green />
        <StatCard label="Điểm analog bình thường" value={stats.analogGood} detail="100%" cyan />
        <StatCard label="Điểm lỗi / mất tín hiệu" value={stats.abnormal} detail={`${Math.round((stats.abnormal / Math.max(1, stats.total)) * 100)}%`} danger />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[180px_180px_1fr_132px]">
        <select value={kind} onChange={(event) => setKind(event.target.value as PointKind | 'all')} className="h-10 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-sm">
          <option value="all">Nhóm I/O - Tất cả</option><option value="DI">DI</option><option value="DO">DO</option><option value="AI">AI</option><option value="AO">AO</option>
        </select>
        <select value={quality} onChange={(event) => setQuality(event.target.value as PointQuality | 'all')} className="h-10 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-sm">
          <option value="all">Trạng thái - Tất cả</option><option value="good">Good</option><option value="uncertain">Uncertain</option><option value="bad">Bad</option><option value="stale">Stale</option>
        </select>
        <label className="flex h-10 items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3">
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full bg-transparent text-sm outline-none" placeholder="Tìm kiếm điểm..." />
          <Search className="h-4 w-4 text-[var(--c-text-dim)]" />
        </label>
        <Button icon={<RefreshCw className="h-4 w-4" />} onClick={pointsState.refetch}>Làm mới</Button>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_334px]">
        <div className={cn('space-y-3', offline && 'stale')}>
          <DigitalSection title="DI - DIGITAL INPUT" rows={groups.DI} selectedId={selected?.id} onSelect={setSelectedId} onToggle={(point) => { setSelectedId(point.id); setForceOpen(false) }} />
          <DigitalSection title="DO - DIGITAL OUTPUT" rows={groups.DO} selectedId={selected?.id} onSelect={setSelectedId} onToggle={(point) => { setSelectedId(point.id); setForceValue(String(!Boolean(point.value))); setForceOpen(true) }} />
          <AnalogSection title="AI - ANALOG INPUT" rows={groups.AI} selectedId={selected?.id} onSelect={setSelectedId} />
          <AnalogSection title="AO - ANALOG OUTPUT" rows={groups.AO} selectedId={selected?.id} onSelect={setSelectedId} onForce={(point) => { setSelectedId(point.id); setForceValue(String(pointNumber(point))); setForceOpen(true) }} />
        </div>
        {selected && <DetailPanel point={selected} note={note} setNote={setNote} onForce={() => { setForceValue(selected.kind === 'DO' ? String(!Boolean(selected.value)) : String(pointNumber(selected))); setForceOpen(true) }} />}
      </div>

      <Modal open={forceOpen} title={`Force ${selected?.id ?? ''}`} danger confirmLabel="Force 10 phút" onConfirm={confirmForce} onClose={() => setForceOpen(false)}>
        <div className="space-y-4">
          <div className="flex gap-3 rounded-[var(--radius)] border border-[rgba(224,161,6,0.38)] bg-[rgba(224,161,6,0.08)] p-3 text-[var(--c-warn)]">
            <ShieldAlert className="h-5 w-5 shrink-0" />
            Force tự hết hạn sau 10 phút. Chỉ dùng khi commissioning hoặc xử lý sự cố có kiểm soát.
          </div>
          <label className="block text-sm">Giá trị Force<input value={forceValue} onChange={(event) => setForceValue(event.target.value)} className="mono mt-2 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3" /></label>
        </div>
      </Modal>
    </div>
  )
}

function StatCard({ label, value, detail, green, cyan, danger }: { label: string; value: number; detail: string; green?: boolean; cyan?: boolean; danger?: boolean }) {
  const color = danger ? 'var(--c-fault)' : green ? 'var(--c-good)' : cyan ? 'var(--c-accent)' : 'var(--c-info)'
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[rgba(22,34,58,0.72)] p-4">
      <div className="text-[11px] uppercase text-[var(--c-text-dim)]">{label}</div>
      <div className="mono mt-3 text-4xl font-bold" style={{ color }}>{value}</div>
      <div className="mt-2 flex justify-between text-xs text-[var(--c-text-dim)]"><span>{detail}</span></div>
    </div>
  )
}

function DigitalSection({ title, rows, selectedId, onSelect, onToggle }: { title: string; rows: Point[]; selectedId?: string; onSelect: (id: string) => void; onToggle: (point: Point) => void }) {
  return (
    <SectionFrame title={`${title} (${rows.length})`}>
      <div className="grid grid-cols-[70px_minmax(150px,1fr)_112px_128px_58px] border-b border-[rgba(36,48,73,0.72)] px-3 py-2 text-[10px] uppercase text-[var(--c-text-dim)]">
        <span>Điểm</span><span>Tên điểm</span><span>Trạng thái</span><span>Thời gian cập nhật</span><span />
      </div>
      {rows.map((point) => <DigitalRow key={point.id} point={point} selected={point.id === selectedId} onSelect={onSelect} onToggle={onToggle} />)}
    </SectionFrame>
  )
}

function DigitalRow({ point, selected, onSelect, onToggle }: { point: Point; selected: boolean; onSelect: (id: string) => void; onToggle: (point: Point) => void }) {
  const active = Boolean(point.value)
  const alarmActive = point.id === 'DI-01' && active
  const stateColor = alarmActive ? 'var(--c-fault)' : active ? 'var(--c-good)' : 'var(--c-text-dim)'
  return (
    <button type="button" onClick={() => onSelect(point.id)} className={cn('grid w-full grid-cols-[70px_minmax(150px,1fr)_112px_128px_58px] items-center border-b border-[rgba(36,48,73,0.42)] px-3 py-2 text-left text-xs transition last:border-0 hover:bg-[rgba(34,211,238,0.06)]', selected && 'bg-[rgba(45,127,249,0.14)]')}>
      <span className="mono font-semibold">{point.id}</span>
      <span className="truncate font-semibold">{point.name}</span>
      <span className="inline-flex items-center gap-2"><Circle className="h-2.5 w-2.5 fill-current" style={{ color: stateColor }} />{active ? 'ON' : 'OFF'}</span>
      <span className="mono text-[var(--c-text-dim)]">{formatTime(point.updatedAt)}</span>
      <span onClick={(event) => { event.stopPropagation(); onToggle(point) }} className={cn('ml-auto flex h-5 w-9 items-center rounded-full border px-0.5 transition', active ? 'justify-end border-[rgba(47,191,113,0.58)] bg-[rgba(47,191,113,0.28)]' : 'justify-start border-[rgba(143,161,189,0.36)] bg-[rgba(143,161,189,0.16)]')} role="switch" aria-checked={active} tabIndex={0}>
        <span className={cn('h-3.5 w-3.5 rounded-full', active ? 'bg-[var(--c-good)]' : 'bg-[var(--c-text-dim)]')} />
      </span>
    </button>
  )
}

function AnalogSection({ title, rows, selectedId, onSelect, onForce }: { title: string; rows: Point[]; selectedId?: string; onSelect: (id: string) => void; onForce?: (point: Point) => void }) {
  return (
    <SectionFrame title={`${title} (${rows.length})`}>
      <div className="grid grid-cols-[70px_minmax(150px,1fr)_70px_60px_120px_90px_84px] border-b border-[rgba(36,48,73,0.72)] px-3 py-2 text-[10px] uppercase text-[var(--c-text-dim)]">
        <span>Điểm</span><span>Tên điểm</span><span>Giá trị</span><span>Đơn vị</span><span>Trạng thái</span><span>Trend</span><span>Cập nhật</span>
      </div>
      {rows.map((point) => <AnalogRow key={point.id} point={point} selected={point.id === selectedId} onSelect={onSelect} onForce={onForce} />)}
    </SectionFrame>
  )
}

function AnalogRow({ point, selected, onSelect, onForce }: { point: Point; selected: boolean; onSelect: (id: string) => void; onForce?: (point: Point) => void }) {
  const statusText = point.quality === 'good' ? 'Bình thường' : point.quality === 'uncertain' ? 'Lỗi - HIGH' : point.quality.toUpperCase()
  return (
    <button type="button" onClick={() => onSelect(point.id)} className={cn('grid w-full grid-cols-[70px_minmax(150px,1fr)_70px_60px_120px_90px_84px] items-center border-b border-[rgba(36,48,73,0.42)] px-3 py-2 text-left text-xs transition last:border-0 hover:bg-[rgba(34,211,238,0.06)]', selected && 'bg-[rgba(45,127,249,0.14)]')}>
      <span className="mono font-semibold">{point.id}</span>
      <span className="truncate font-semibold">{point.name}</span>
      <span className="mono">{typeof point.value === 'number' ? point.value.toFixed(1) : point.value}</span>
      <span className="mono text-[var(--c-text-dim)]">{point.unit ?? '-'}</span>
      <span className="inline-flex items-center gap-2"><Circle className="h-2.5 w-2.5 fill-current" style={{ color: statusColor(point.quality) }} />{statusText}</span>
      <span onClick={(event) => { if (onForce) { event.stopPropagation(); onForce(point) } }}><Sparkline values={point.trend ?? [pointNumber(point)]} color={point.quality === 'good' ? 'var(--c-accent-2)' : 'var(--c-fault)'} /></span>
      <span className="mono text-[var(--c-text-dim)]">{formatTime(point.updatedAt)}</span>
    </button>
  )
}

function SectionFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)] bg-[rgba(17,26,43,0.82)]">
      <div className="border-b border-[var(--c-border)] bg-[rgba(22,34,58,0.62)] px-3 py-2 text-xs font-semibold text-[var(--c-accent)]">{title}</div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  )
}

function DetailPanel({ point, note, setNote, onForce }: { point: Point; note: string; setNote: (value: string) => void; onForce: () => void }) {
  const active = Boolean(point.value)
  const alarmActive = point.id === 'DI-01' && active
  const canForce = point.kind === 'AO' || point.kind === 'DO'
  const groupText = `${point.kind} - ${kindLabel[point.kind]}`
  const history = [0, 1, 2, 3, 4].map((index) => ({ time: new Date(Date.now() - index * 7 * 60_000).toISOString(), value: index % 2 === 0 ? active : !active }))
  return (
    <div className="space-y-3">
      <Panel title="Chi tiết điểm" action={<X className="h-4 w-4 text-[var(--c-accent)]" />}>
        <div className="space-y-4">
          <div><div className="text-2xl font-semibold">{point.id}</div><div className="mt-1 text-sm font-semibold">{point.name}</div></div>
          <div className={cn('rounded-[var(--radius)] border p-4 text-center', alarmActive ? 'border-[rgba(229,72,77,0.62)] bg-[rgba(229,72,77,0.16)]' : 'border-[rgba(34,211,238,0.32)] bg-[rgba(34,211,238,0.08)]')}>
            <div className={cn('mono text-2xl font-bold', alarmActive ? 'text-[var(--c-fault)]' : 'text-[var(--c-accent)]')}>{formatValue(point.value, point.unit)}</div>
            <div className={cn('mt-1 text-xs font-semibold', alarmActive ? 'text-[var(--c-fault)]' : 'text-[var(--c-text-dim)]')}>{active ? 'Kích hoạt' : 'Không kích hoạt'}</div>
          </div>
          <dl className="grid grid-cols-[118px_1fr] gap-y-3 text-xs">
            <dt className="text-[var(--c-text-dim)]">Nhóm I/O</dt><dd>{groupText}</dd>
            <dt className="text-[var(--c-text-dim)]">Kiểu tín hiệu</dt><dd>{point.sensorType ?? 'Dry Contact'}</dd>
            <dt className="text-[var(--c-text-dim)]">Trạng thái hiện tại</dt><dd className={alarmActive ? 'font-semibold text-[var(--c-fault)]' : 'font-semibold'}>{active ? 'ON (Kích hoạt)' : 'OFF'}</dd>
            <dt className="text-[var(--c-text-dim)]">Trạng thái logic</dt><dd>{active ? 1 : 0}</dd>
            <dt className="text-[var(--c-text-dim)]">Thời gian thay đổi</dt><dd className="mono">{formatDateTime(point.updatedAt)}</dd>
            <dt className="text-[var(--c-text-dim)]">Thời gian cập nhật</dt><dd className="mono">{formatDateTime(point.updatedAt)}</dd>
            <dt className="text-[var(--c-text-dim)]">Bộ đếm kích hoạt</dt><dd>15</dd>
            <dt className="text-[var(--c-text-dim)]">Mô tả</dt><dd>{point.id === 'DI-01' ? 'Nút dừng khẩn cấp hệ thống' : point.name}</dd>
          </dl>
          <StatusBadge state={point.forced ? 'force' : point.quality} />
          {canForce && <Button className="w-full" variant="danger" onClick={onForce}>Force output</Button>}
        </div>
      </Panel>

      <Panel title="Lịch sử trạng thái">
        <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)]">
          <div className="grid grid-cols-[1fr_86px] bg-[var(--c-surface-2)] px-3 py-2 text-[10px] uppercase text-[var(--c-text-dim)]"><span>Thời gian</span><span>Trạng thái</span></div>
          {history.map((item) => <div key={item.time} className="grid grid-cols-[1fr_86px] border-t border-[rgba(36,48,73,0.48)] px-3 py-2 text-xs"><span className="mono">{formatDateTime(item.time)}</span><span className={item.value ? 'font-semibold text-[var(--c-fault)]' : 'text-[var(--c-text-dim)]'}>{item.value ? 'ON' : 'OFF'} ●</span></div>)}
        </div>
        <button className="mt-3 text-xs font-semibold text-[var(--c-accent)]">Xem thêm lịch sử →</button>
      </Panel>

      <Panel title="Ghi chú">
        <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Nhập ghi chú..." className="min-h-[84px] w-full resize-none rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-3 text-sm outline-none" />
        <Button className="mt-3 w-full" variant="primary" icon={<Save className="h-4 w-4" />}>Lưu ghi chú</Button>
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
