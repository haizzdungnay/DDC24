import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import type { TrendSample } from '../types'

export interface TrendSeries {
  key: string
  label: string
  color: string
  unit?: string
}

export function TrendChart({ data, series, height = 260 }: { data: TrendSample[]; series: TrendSeries[]; height?: number }) {
  const hasTimeAxis = data.every((sample) => typeof sample.__ts === 'number' && Number.isFinite(sample.__ts))
  const formatAxisTime = (value: number) => new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 20, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="rgba(91,96,102,0.34)" vertical={false} />
          <XAxis
            dataKey={hasTimeAxis ? '__ts' : 'time'}
            type={hasTimeAxis ? 'number' : 'category'}
            domain={hasTimeAxis ? ['dataMin', 'dataMax'] : undefined}
            tickFormatter={hasTimeAxis ? (value) => formatAxisTime(Number(value)) : undefined}
            stroke="var(--c-text-dim)"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis stroke="var(--c-text-dim)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 6, color: 'var(--c-text)' }}
            labelStyle={{ color: 'var(--c-text)' }}
            labelFormatter={hasTimeAxis ? (value) => formatAxisTime(Number(value)) : undefined}
            formatter={(value, name) => {
              const item = series.find((line) => line.key === name)
              return [`${value}${item?.unit ? ` ${item.unit}` : ''}`, item?.label ?? name]
            }}
          />
          {series.map((line) => <Line key={line.key} type="linear" dataKey={line.key} name={line.key} stroke={line.color} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
