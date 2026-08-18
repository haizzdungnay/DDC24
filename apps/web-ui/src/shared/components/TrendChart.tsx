import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import type { TrendSample } from '../types'

export interface TrendSeries {
  key: string
  label: string
  color: string
  unit?: string
  /** `T57-2.5` — gán chuỗi sang trục phụ bên phải.
   *
   *  Vẽ nhiệt độ (°C) chung trục với độ mở van (%) làm cả hai đường dẹt lại:
   *  thang 0-100 nuốt hết biến thiên của thang 18-26. Tối đa hai trục — thêm
   *  nữa thì người đọc không còn biết đường nào thuộc thang nào. */
  axis?: 'left' | 'right'
  kind?: 'UI' | 'AI' | 'DI' | 'AO' | 'DO' | 'VP' | 'modbus_rtu'
  pointId?: string
  generation?: number
  stepped?: boolean
}

interface TrendChartProps {
  data: TrendSample[]
  series: TrendSeries[]
  height?: number
  rawUnit?: string
  timeZone?: 'UTC' | 'local'
  showTable?: boolean
  /** Vẽ dải min–max của mẫu aggregate (PA3-502 / UX-DES §13). */
  showBand?: boolean
  /** Vẽ chấm cho từng mẫu. Cần cho khối xem nhanh trên Landing: ở đó mỗi chuỗi
   *  có nhịp lấy mẫu riêng nên một mẫu đơn lẻ không có hàng xóm để nối thành
   *  đoạn thẳng — với `dot={false}` nó BIẾN MẤT hoàn toàn thay vì hiện ra như
   *  một điểm dữ liệu đứt quãng (N-02). Trang Trends đầy đủ giữ mặc định tắt vì
   *  ở đó mật độ mẫu cao, chấm chỉ làm rối. */
  showDots?: boolean
}

/** Hậu tố khoá của dải min–max trong `TrendSample`. Một chỗ duy nhất định
 *  nghĩa, để nơi dựng dữ liệu và nơi vẽ không trôi khỏi nhau. */
export const TREND_BAND_SUFFIX = '::band'

export function trendBandKey(seriesKey: string): string {
  return `${seriesKey}${TREND_BAND_SUFFIX}`
}

/** Dữ liệu có dải min–max thật hay không.
 *
 *  Ở độ phân giải 1 giây, mỗi mẫu là một điểm đo nên `min === max === value`
 *  và dải chỉ là một đường trùng khít đường chính — vẽ nó ra là thêm mực mà
 *  không thêm thông tin. Chỉ khi backend trả mẫu aggregate (min khác max) thì
 *  dải mới nói lên điều gì: biên độ dao động BÊN TRONG một ô thời gian đã bị
 *  gộp, thứ mà đường trung bình che mất. */
export function hasMinMaxBand(data: TrendSample[], series: TrendSeries[]): boolean {
  return series.some((item) => data.some((row) => {
    const band = row[trendBandKey(item.key)]
    return Array.isArray(band) && band.length === 2 && typeof band[0] === 'number' && typeof band[1] === 'number' && band[0] !== band[1]
  }))
}

function displayValue(value: string | number | number[] | null | undefined, kind?: TrendSeries['kind'], stepped?: boolean): string {
  if (value === null || value === undefined) return 'No value'
  if (Array.isArray(value)) return value.length === 2 ? `${value[0]} … ${value[1]}` : 'No value'
  if (typeof value === 'string') return value
  if (stepped || kind === 'DO' || kind === 'DI') return value ? 'ON' : 'OFF'
  return String(value)
}

export function formatTrendTime(value: number | string | number[] | null, timeZone: 'UTC' | 'local' = 'local'): string {
  if (value === null || Array.isArray(value)) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('vi-VN', timeZone === 'UTC' ? { timeZone: 'UTC', hour12: false } : undefined)
    : String(value)
}

function formatRaw(value: unknown, unit: string): string {
  if (typeof value !== 'number') return '—'
  const fixed = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)
  return `${fixed} ${unit}`
}

function HistoryTooltip({ active, payload, label, series, rawUnit, timeZone }: { active?: boolean; payload?: Array<{ dataKey?: string; value?: string | number | null; payload?: TrendSample }>; label?: string | number; series: TrendSeries[]; rawUnit?: string; timeZone: 'UTC' | 'local' }) {
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
            <span>{item.label}: {missing ? '—' : displayValue(raw as number, item.kind, item.stepped)}{!missing && item.unit ? ` ${item.unit}` : ''}</span>
            {!missing && <div className="text-[var(--c-text-dim)]">Quality {row[`${item.key}:quality`] ?? '—'} · Source {row[`${item.key}:source`] ?? '—'} · Tier {row[`${item.key}:tier`] ?? '—'}</div>}
          </div>
        )
      })}
      {rawUnit && payload[0]?.payload?.['__raw'] != null && <div className="mt-1 text-[var(--c-text-dim)]">Raw: {formatRaw(payload[0].payload['__raw'], rawUnit)}</div>}
    </div>
  )
}

/**
 * Gán trục Y phụ theo ĐƠN VỊ — `T57-2.5`.
 *
 * VÌ SAO TỰ ĐỘNG, KHÔNG BẮT NGƯỜI DÙNG CHỌN
 *
 * Lý do cần trục thứ hai luôn là "hai chuỗi khác đơn vị", và đơn vị thì đã có
 * sẵn trong dữ liệu. Bắt người dùng tự gán là bắt họ làm lại một phép suy mà
 * máy làm được, ngay giữa lúc đang chẩn đoán.
 *
 * LUẬT: đơn vị PHỔ BIẾN NHẤT giữ trục trái; đơn vị khác nhiều thứ hai sang trục
 * phải. Từ đơn vị thứ ba trở đi vẫn ở trục trái — thêm trục nữa thì người đọc
 * không còn biết đường nào thuộc thang nào, và một biểu đồ không đọc được thì
 * tệ hơn hai đường dẹt.
 */
export function assignSecondAxis(series: Array<{ unit?: string; axis?: 'left' | 'right' }>): void {
  const counts = new Map<string, number>()
  for (const item of series) {
    const unit = item.unit?.trim()
    if (!unit) continue
    counts.set(unit, (counts.get(unit) ?? 0) + 1)
  }
  if (counts.size < 2) return
  const ranked = [...counts.entries()].sort((left, right) =>
    right[1] - left[1] || left[0].localeCompare(right[0]))
  const rightUnit = ranked[1][0]
  for (const item of series) {
    if (item.unit?.trim() === rightUnit) item.axis = 'right'
  }
}

export function TrendChart({ data, series, height = 260, rawUnit, timeZone = 'local', showTable = true, showBand = false, showDots = false }: TrendChartProps) {
  const hasTimeAxis = data.every((sample) => typeof sample.__ts === 'number' && Number.isFinite(sample.__ts))
  const bandVisible = showBand && hasMinMaxBand(data, series)
  const hasRightAxis = series.some((item) => item.axis === 'right')
  const rightAxisUnit = series.find((item) => item.axis === 'right')?.unit
  const formatAxisTime = (value: number) => new Date(value).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...(timeZone === 'UTC' ? { timeZone: 'UTC' } : {})
  })

  return (
    <section aria-label="Historical trend chart" className="space-y-3">
      <div style={{ height }} aria-hidden="true">
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
            {series.map((item) => <Line key={item.key} yAxisId={item.axis === 'right' ? 'right' : 'left'} type={item.stepped || item.kind === 'DO' || item.kind === 'DI' ? 'stepAfter' : 'linear'} dataKey={item.key} name={item.key} stroke={item.color} strokeWidth={2.5} dot={showDots ? { r: 2 } : false} activeDot={{ r: 4 }} connectNulls={false} />)}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="sr-only" aria-hidden="true">
        {series.map((item) => <span key={item.key} data-testid={`trend-line-${item.key}`} data-connect-nulls="false" data-line-type={item.stepped || item.kind === 'DO' || item.kind === 'DI' ? 'stepAfter' : 'linear'} />)}
        {bandVisible && series.map((item) => <span key={`${item.key}-band`} data-testid={`trend-band-${item.key}`} data-connect-nulls="false" />)}
      </div>
      {showTable && <div className="overflow-x-auto rounded border border-[var(--c-border)]">
        <table aria-label="Historical trend data" className="w-full border-collapse text-left text-xs">
          <caption className="sr-only">Historical values with quality, source, and storage tier</caption>
          <thead className="bg-[var(--c-surface-2)]"><tr><th className="px-3 py-2">Time{timeZone === 'UTC' ? ' (UTC)' : ''}</th>{series.map((item) => <th key={item.key} className="px-3 py-2">{item.label}</th>)}{rawUnit && <th className="px-3 py-2">Raw</th>}</tr></thead>
          <tbody>{data.slice(-5).map((row) => <tr key={String(row.__ts ?? row.time)} className="border-t border-[var(--c-border)]"><th className="whitespace-nowrap px-3 py-2 font-normal">{formatTrendTime(row.__ts ?? row.time, timeZone)}</th>{series.map((item) => { const value = row[item.key]; const quality = row[`${item.key}:quality`]; const source = row[`${item.key}:source`]; const tier = row[`${item.key}:tier`]; return <td key={item.key} className="px-3 py-2 align-top"><div>{displayValue(value, item.kind, item.stepped)}{item.unit ? ` ${item.unit}` : ''}</div><div className="text-[var(--c-text-dim)]">{quality ?? '—'} · {source ?? '—'} · {tier ?? '—'}</div></td> })}{rawUnit && <td className="whitespace-nowrap px-3 py-2 align-top"><div>{formatRaw(row.__raw, rawUnit)}</div></td>}</tr>)}</tbody>
        </table>
      </div>}
    </section>
  )
}
