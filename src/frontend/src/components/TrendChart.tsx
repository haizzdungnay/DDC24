import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import type { TrendSample } from '../types'

const lines = [
  { key: 'AI-01', color: 'var(--c-fault)' },
  { key: 'AI-02', color: 'var(--c-accent-2)' },
  { key: 'AI-03', color: 'var(--c-good)' },
  { key: 'AI-04', color: 'var(--c-warn)' }
]

export function TrendChart({ data, height = 260 }: { data: TrendSample[]; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 20, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="rgba(143,161,189,0.14)" vertical={false} />
          <XAxis dataKey="time" stroke="var(--c-text-dim)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis stroke="var(--c-text-dim)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 6 }} labelStyle={{ color: 'var(--c-text)' }} />
          {lines.map((line) => <Line key={line.key} type="monotone" dataKey={line.key} stroke={line.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
