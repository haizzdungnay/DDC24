import { Suspense, lazy } from 'react'
import type { TrendSample } from '../types'
import { displayTrendValue, formatTrendRaw, formatTrendTime, trendBandKey } from './trendChartFormat'

/* T63-109 (PERF-FE-02, Plan 63 §4.2) — THƯ VIỆN BIỂU ĐỒ TẢI LƯỜI.
 *
 * Trước đây file này import `recharts` tĩnh. Sáu trang import TrendChart tĩnh
 * (Dashboard, Chẩn đoán, Đầu vào, Đầu ra, Điểm ảo, Xu hướng), nên chunk
 * `charts` (407.319 B thô / 105.076 B gzip) nằm trong đồ thị TĨNH của entry, và
 * `index.html` modulepreload nó cho MỌI trang, kể cả trang đăng nhập — nơi không
 * có biểu đồ nào.
 *
 * Nay chỉ phần vẽ SVG (`TrendChartPlot.tsx`, nơi duy nhất import `recharts`) đi
 * qua `import()`. Phần còn lại — bảng dữ liệu, danh sách dấu sự kiện, mốc test —
 * vẫn render đồng bộ, nên bảng đọc được ngay cả khi chunk biểu đồ chưa về. */
let plotModule: Promise<typeof import('./TrendChartPlot')> | null = null

/** Bắt đầu tải chunk biểu đồ (một lần; lỗi mạng thì lần sau thử lại). Shell đã
 *  xác thực gọi hàm này khi mount để chunk về song song với dữ liệu, không nối
 *  đuôi sau nó — trang đăng nhập KHÔNG gọi. */
export function preloadTrendChart(): Promise<typeof import('./TrendChartPlot')> {
  plotModule ??= import('./TrendChartPlot').catch((error: unknown) => {
    plotModule = null
    throw error
  })
  return plotModule
}

const TrendChartPlot = lazy(() => preloadTrendChart().then((module) => ({ default: module.TrendChartPlot })))

export { TREND_BAND_SUFFIX, formatTrendTime, trendBandKey } from './trendChartFormat'

/** Dấu sự kiện vẽ trên trục thời gian — `T57-2.6`. Biểu đồ chỉ VẼ; việc quyết
 *  định sự kiện nào đáng đánh dấu thuộc về `features/operations/trendMarkers`. */
export interface TrendChartMarker {
  ts: number
  kind: 'override' | 'alarm'
  label: string
  pointId: string
  actor?: string
}

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
  /** Dấu sự kiện (`T57-2.6`). Rỗng ⇒ không vẽ gì thêm. */
  markers?: TrendChartMarker[]
  /** Vẽ chấm cho từng mẫu. Cần cho khối xem nhanh trên Landing: ở đó mỗi chuỗi
   *  có nhịp lấy mẫu riêng nên một mẫu đơn lẻ không có hàng xóm để nối thành
   *  đoạn thẳng — với `dot={false}` nó BIẾN MẤT hoàn toàn thay vì hiện ra như
   *  một điểm dữ liệu đứt quãng (N-02). Trang Trends đầy đủ giữ mặc định tắt vì
   *  ở đó mật độ mẫu cao, chấm chỉ làm rối. */
  showDots?: boolean
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

export function TrendChart({ data, series, height = 260, rawUnit, timeZone = 'local', showTable = true, showBand = false, showDots = false, markers = [] }: TrendChartProps) {
  const hasTimeAxis = data.every((sample) => typeof sample.__ts === 'number' && Number.isFinite(sample.__ts))
  const bandVisible = showBand && hasMinMaxBand(data, series)

  return (
    <section aria-label="Historical trend chart" className="space-y-3">
      <div style={{ height }} aria-hidden="true">
        {/* Chỗ giữ đúng chiều cao trong lúc chunk biểu đồ đang về: không nhảy
            layout, và không vẽ trục/đường giả nào khi chưa có thư viện vẽ. */}
        <Suspense fallback={<div data-testid="trend-chart-loading" className="h-full w-full rounded bg-[var(--c-surface-2)] opacity-40" />}>
          <TrendChartPlot data={data} series={series} rawUnit={rawUnit} timeZone={timeZone} hasTimeAxis={hasTimeAxis} bandVisible={bandVisible} showDots={showDots} markers={markers} />
        </Suspense>
      </div>
      {/* Vạch trên biểu đồ nói CÓ sự kiện; bảng này nói sự kiện GÌ và AI làm.
          Nó cũng là đường duy nhất để người dùng bàn phím hoặc trình đọc màn
          hình tiếp cận được thông tin đó — biểu đồ SVG bên trên `aria-hidden`. */}
      {markers.length > 0 && (
        <ul aria-label="Trend event markers" className="flex flex-wrap gap-2 text-[11px] text-[var(--c-text-dim)]">
          {markers.map((marker) => (
            <li
              key={`${marker.kind}-${marker.pointId}-${marker.ts}`}
              className="inline-flex items-center gap-1 rounded-[var(--radius)] border px-2 py-0.5"
              style={{
                borderColor: marker.kind === 'alarm' ? 'var(--c-fault)' : 'var(--c-force)',
                color: marker.kind === 'alarm' ? 'var(--c-fault-fg)' : 'var(--c-force)'
              }}
              title={`${marker.pointId} · ${marker.label}${marker.actor ? ` · ${marker.actor}` : ''}`}
            >
              <span className="mono">{formatTrendTime(marker.ts, timeZone)}</span>
              <span>{marker.pointId} · {marker.label}</span>
              {marker.actor && <span>· {marker.actor}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="sr-only" aria-hidden="true">
        {series.map((item) => <span key={item.key} data-testid={`trend-line-${item.key}`} data-connect-nulls="false" data-line-type={item.stepped || item.kind === 'DO' || item.kind === 'DI' ? 'stepAfter' : 'linear'} />)}
        {bandVisible && series.map((item) => <span key={`${item.key}-band`} data-testid={`trend-band-${item.key}`} data-connect-nulls="false" />)}
      </div>
      {showTable && <div className="overflow-x-auto rounded border border-[var(--c-border)]">
        <table aria-label="Historical trend data" className="w-full border-collapse text-left text-xs">
          <caption className="sr-only">Historical values with quality, source, and storage tier</caption>
          <thead className="bg-[var(--c-surface-2)]"><tr><th className="px-3 py-2">Time{timeZone === 'UTC' ? ' (UTC)' : ''}</th>{series.map((item) => <th key={item.key} className="px-3 py-2">{item.label}</th>)}{rawUnit && <th className="px-3 py-2">Raw</th>}</tr></thead>
          <tbody>{data.slice(-5).map((row) => <tr key={String(row.__ts ?? row.time)} className="border-t border-[var(--c-border)]"><th className="whitespace-nowrap px-3 py-2 font-normal">{formatTrendTime(row.__ts ?? row.time, timeZone)}</th>{series.map((item) => { const value = row[item.key]; const quality = row[`${item.key}:quality`]; const source = row[`${item.key}:source`]; const tier = row[`${item.key}:tier`]; return <td key={item.key} className="px-3 py-2 align-top"><div>{displayTrendValue(value, item.kind, item.stepped)}{item.unit ? ` ${item.unit}` : ''}</div><div className="text-[var(--c-text-dim)]">{quality ?? '—'} · {source ?? '—'} · {tier ?? '—'}</div></td> })}{rawUnit && <td className="whitespace-nowrap px-3 py-2 align-top"><div>{formatTrendRaw(row.__raw, rawUnit)}</div></td>}</tr>)}</tbody>
        </table>
      </div>}
    </section>
  )
}
