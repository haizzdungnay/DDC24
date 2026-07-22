import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import type { TrendSample } from '../types'

export interface TrendSeries {
  key: string
  label: string
  color: string
  unit?: string
  kind?: 'UI' | 'AI' | 'DI' | 'AO' | 'DO' | 'VP'
  pointId?: string
  generation?: number
  stepped?: boolean
}

interface TrendChartProps {
  data: TrendSample[]
  series: TrendSeries[]
  height?: number
  rawUnit?: string
}

function displayValue(value: string | number | null | undefined, kind?: TrendSeries['kind'], stepped?: boolean): string {
  if (value === null || value === undefined) return 'No value'
  if (typeof value === 'string') return value
  if (stepped || kind === 'DO' || kind === 'DI') return value ? 'ON' : 'OFF'
  return String(value)
}

function formatTime(value: number | string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('vi-VN') : String(value)
}

function formatRaw(value: unknown, unit: string): string {
  if (typeof value !== 'number') return '—'
  const fixed = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)
  return `${fixed} ${unit}`
}

function HistoryTooltip({ active, payload, label, series, rawUnit }: { active?: boolean; payload?: Array<{ dataKey?: string; value?: string | number | null; payload?: TrendSample }>; label?: string | number; series: TrendSeries[]; rawUnit?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded border border-[var(--c-border)] bg-[var(--c-surface)] p-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold">{formatTime(label ?? '')}</div>
      {payload.map((entry) => {
        const item = series.find((line) => line.key === entry.dataKey)
        const row: TrendSample = entry.payload ?? { time: String(label ?? '') }
        return <div key={entry.dataKey}><span>{item?.label ?? entry.dataKey}: {displayValue(entry.value, item?.kind, item?.stepped)}{item?.unit ? ` ${item.unit}` : ''}</span><div className="text-[var(--c-text-dim)]">Quality {row[`${entry.dataKey}:quality`] ?? '—'} · Source {row[`${entry.dataKey}:source`] ?? '—'} · Tier {row[`${entry.dataKey}:tier`] ?? '—'}</div></div>
      })}
      {rawUnit && payload[0]?.payload?.['__raw'] != null && <div className="mt-1 text-[var(--c-text-dim)]">Raw: {formatRaw(payload[0].payload['__raw'], rawUnit)}</div>}
    </div>
  )
}

export function TrendChart({ data, series, height = 260, rawUnit }: TrendChartProps) {
  const hasTimeAxis = data.every((sample) => typeof sample.__ts === 'number' && Number.isFinite(sample.__ts))
  const formatAxisTime = (value: number) => new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return (
    <section aria-label="Historical trend chart" className="space-y-3">
      <div style={{ height }} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 20, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="rgba(91,96,102,0.34)" vertical={false} />
            <XAxis dataKey={hasTimeAxis ? '__ts' : 'time'} type={hasTimeAxis ? 'number' : 'category'} domain={hasTimeAxis ? ['dataMin', 'dataMax'] : undefined} tickFormatter={hasTimeAxis ? (value) => formatAxisTime(Number(value)) : undefined} stroke="var(--c-text-dim)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis stroke="var(--c-text-dim)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip content={<HistoryTooltip series={series} rawUnit={rawUnit} />} />
            {series.map((item) => <Line key={item.key} type={item.stepped || item.kind === 'DO' || item.kind === 'DI' ? 'stepAfter' : 'linear'} dataKey={item.key} name={item.key} stroke={item.color} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} connectNulls={false} />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="sr-only" aria-hidden="true">
        {series.map((item) => <span key={item.key} data-testid={`trend-line-${item.key}`} data-connect-nulls="false" data-line-type={item.stepped || item.kind === 'DO' || item.kind === 'DI' ? 'stepAfter' : 'linear'} />)}
      </div>
      <div className="overflow-x-auto rounded border border-[var(--c-border)]">
        <table aria-label="Historical trend data" className="w-full border-collapse text-left text-xs">
          <caption className="sr-only">Historical values with quality, source, and storage tier</caption>
          <thead className="bg-[var(--c-surface-2)]"><tr><th className="px-3 py-2">Time</th>{series.map((item) => <th key={item.key} className="px-3 py-2">{item.label}</th>)}{rawUnit && <th className="px-3 py-2">Raw</th>}</tr></thead>
          <tbody>{data.slice(-5).map((row) => <tr key={String(row.__ts ?? row.time)} className="border-t border-[var(--c-border)]"><th className="whitespace-nowrap px-3 py-2 font-normal">{formatTime(row.__ts ?? row.time)}</th>{series.map((item) => { const value = row[item.key]; const quality = row[`${item.key}:quality`]; const source = row[`${item.key}:source`]; const tier = row[`${item.key}:tier`]; return <td key={item.key} className="px-3 py-2 align-top"><div>{displayValue(value, item.kind, item.stepped)}{item.unit ? ` ${item.unit}` : ''}</div><div className="text-[var(--c-text-dim)]">{quality ?? '—'} · {source ?? '—'} · {tier ?? '—'}</div></td> })}{rawUnit && <td className="whitespace-nowrap px-3 py-2 align-top"><div>{formatRaw(row.__raw, rawUnit)}</div></td>}</tr>)}</tbody>
        </table>
      </div>
    </section>
  )
}
