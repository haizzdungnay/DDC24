/* Phần vẽ SVG của TrendChart — T63-109 (PERF-FE-02, Plan 63 §4.2).
 *
 * File này là NƠI DUY NHẤT import `recharts`, và chỉ được nạp qua `import()` động
 * trong `TrendChart.tsx`; recharts cùng phụ thuộc của nó nằm trong chunk động
 * `TrendChartPlot-*.js` (~377 KB thô). Import tĩnh file này (hoặc `recharts`) từ
 * bất kỳ module nào trong đồ thị khởi động sẽ kéo lại thư viện biểu đồ vào mọi
 * trang, kể cả trang đăng nhập — cổng `trend-chart-lazy.contract.test.ts` và
 * `scripts/check-login-chunks.mjs` canh điều đó. */
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import type { TrendSample } from '../types'
import type { TrendChartMarker, TrendSeries } from './TrendChart'
import { displayTrendValue, formatTrendTime, trendBandKey } from './trendChartFormat'

export interface TrendChartPlotProps {
  data: TrendSample[]
  series: TrendSeries[]
  rawUnit?: string
  timeZone: 'UTC' | 'local'
  hasTimeAxis: boolean
  bandVisible: boolean
  showDots: boolean
  markers: TrendChartMarker[]
}

export function TrendChartPlot({ data, series, rawUnit, timeZone, hasTimeAxis, bandVisible, showDots, markers }: TrendChartPlotProps) {
  const hasRightAxis = series.some((item) => item.axis === 'right')
  const rightAxisUnit = series.find((item) => item.axis === 'right')?.unit
  const formatAxisTime = (value: number) => new Date(value).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...(timeZone === 'UTC' ? { timeZone: 'UTC' } : {})
  })

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 20, left: -18, bottom: 0 }}>
        <CartesianGrid stroke="rgba(91,96,102,0.34)" vertical={false} />
        <XAxis dataKey={hasTimeAxis ? '__ts' : 'time'} type={hasTimeAxis ? 'number' : 'category'} domain={hasTimeAxis ? ['dataMin', 'dataMax'] : undefined} tickFormatter={hasTimeAxis ? (value) => formatAxisTime(Number(value)) : undefined} stroke="var(--c-text-dim)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis yAxisId="left" stroke="var(--c-text-dim)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        {hasRightAxis && (
          <YAxis yAxisId="right" orientation="right" stroke="var(--c-text-dim)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} label={rightAxisUnit ? { value: rightAxisUnit, position: 'insideTopRight', fontSize: 11, fill: 'var(--c-text-dim)' } : undefined} />
        )}
        <Tooltip content={<HistoryTooltip series={series} rawUnit={rawUnit} timeZone={timeZone} />} />
        {/* Dải min–max vẽ TRƯỚC đường chính để nằm dưới nó. `connectNulls`
            vẫn false: khoảng trống dữ liệu phải đứt cả dải lẫn đường, không
            được tô liền qua gap (UX-REQ UC-06). */}
        {bandVisible && series.map((item) => (
          <Area
            key={`${item.key}-band`}
            type={item.stepped || item.kind === 'DO' || item.kind === 'DI' ? 'stepAfter' : 'linear'}
            yAxisId={item.axis === 'right' ? 'right' : 'left'}
            dataKey={trendBandKey(item.key)}
            name={`${item.key}-band`}
            stroke="none"
            fill={item.color}
            fillOpacity={0.16}
            isAnimationActive={false}
            activeDot={false}
            connectNulls={false}
          />
        ))}
        {/* `T57-2.6` — vạch đứng cho sự kiện, vẽ SAU các đường để nằm trên
            chúng. Chỉ vẽ khi trục X là thời gian thật: trên trục hạng mục
            (`category`) không có toạ độ nào để đặt vạch cho đúng chỗ, và
            đặt sai chỗ thì tệ hơn không vẽ. */}
        {hasTimeAxis && markers.map((marker) => (
          <ReferenceLine
            key={`${marker.kind}-${marker.pointId}-${marker.ts}`}
            yAxisId="left"
            x={marker.ts}
            stroke={marker.kind === 'alarm' ? 'var(--c-fault-fg)' : 'var(--c-force)'}
            strokeDasharray="4 3"
            strokeWidth={1.5}
            label={{
              value: marker.kind === 'alarm' ? '!' : '⌾',
              position: 'top',
              fontSize: 11,
              fill: marker.kind === 'alarm' ? 'var(--c-fault-fg)' : 'var(--c-force)'
            }}
          />
        ))}
        {series.map((item) => <Line key={item.key} yAxisId={item.axis === 'right' ? 'right' : 'left'} type={item.stepped || item.kind === 'DO' || item.kind === 'DI' ? 'stepAfter' : 'linear'} dataKey={item.key} name={item.key} stroke={item.color} strokeWidth={2.5} dot={showDots ? { r: 2 } : false} activeDot={{ r: 4 }} connectNulls={false} />)}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function HistoryTooltip({ active, payload, label, series, rawUnit: _rawUnit, timeZone }: { active?: boolean; payload?: Array<{ dataKey?: string; value?: string | number | null; payload?: TrendSample }>; label?: string | number; series: TrendSeries[]; rawUnit?: string; timeZone: 'UTC' | 'local' }) {
  if (!active || !payload?.length) return null
  /* `T57-2.4` — CON TRỎ ĐỌC GIÁ TRỊ: duyệt theo `series`, không theo `payload`.
   *
   * `payload` của recharts chỉ chứa những chuỗi CÓ giá trị ở đúng hàng đang
   * hover. Với dữ liệu thưa (mỗi điểm một nhịp lấy mẫu riêng), chuỗi thiếu mẫu
   * ở hàng đó biến mất khỏi tooltip — người dùng không phân biệt được "chuỗi
   * này không có dữ liệu tại đây" với "chuỗi này không được chọn".
   *
   * So sánh setpoint với giá trị thực tại đúng thời điểm sự cố là thao tác chẩn
   * đoán cơ bản nhất; nó chỉ làm được khi mọi chuỗi cùng xuất hiện tại một mốc.
   * Chuỗi không có mẫu hiện `—` — đúng luật "thiếu dữ liệu thì nói ra". */
  const row: TrendSample = payload[0]?.payload ?? { time: String(label ?? '') }
  return (
    <div className="rounded border border-[var(--c-border)] bg-[var(--c-surface)] p-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold">{formatTrendTime(label ?? '', timeZone)}</div>
      {series.map((item) => {
        const raw = row[item.key]
        const missing = raw === undefined || raw === null
        return (
          <div key={item.key}>
            <span style={{ color: item.color }}>■</span>{' '}
            <span>{item.label}: {missing ? '—' : displayTrendValue(raw as number, item.kind, item.stepped)}{!missing && item.unit ? ` ${item.unit}` : ''}</span>
          </div>
        )
      })}
    </div>
  )
}
