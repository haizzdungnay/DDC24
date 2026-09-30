import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { HistoryTooltip } from './TrendChartPlot'
import type { TrendSeries } from './TrendChart'
import type { TrendSample } from '../types'

type AxisSeries = { unit?: string; axis?: 'left' | 'right' }
import { assignSecondAxis } from './TrendChart'

/**
 * Khoá hành vi của `BB-6` — `T57-2.4` (con trỏ đọc giá trị) và `T57-2.5` (trục
 * Y thứ hai).
 *
 * Phần tooltip của recharts không render được trong jsdom nếu không có kích
 * thước thật, nên phần crosshair được khoá bằng test hành vi ở tầng dữ liệu:
 * điều quan trọng là tooltip duyệt theo `series` chứ không theo `payload`, và
 * điều đó thể hiện ở chỗ mọi chuỗi đều xuất hiện kể cả khi thiếu mẫu. Phần
 * render đầy đủ thuộc e2e.
 */

describe('T57-2.5 — gán trục Y thứ hai theo đơn vị', () => {
  it('một đơn vị duy nhất thì KHÔNG dựng trục phụ', () => {
    const series: AxisSeries[] = [{ unit: '°C' }, { unit: '°C' }, { unit: '°C' }]
    assignSecondAxis(series)
    expect(series.every((item) => item.axis === undefined)).toBe(true)
  })

  it('đơn vị phổ biến nhất giữ trục trái, đơn vị nhiều thứ hai sang phải', () => {
    const series = [
      { unit: '°C' }, { unit: '°C' }, { unit: '°C' },
      { unit: '%' }, { unit: '%' }
    ] as AxisSeries[]
    assignSecondAxis(series)
    expect(series.filter((item) => item.axis === 'right').map((item) => item.unit)).toEqual(['%', '%'])
    expect(series.filter((item) => item.unit === '°C').every((item) => item.axis === undefined)).toBe(true)
  })

  it('từ đơn vị thứ ba trở đi vẫn ở trục trái — hai trục là trần', () => {
    const series = [
      { unit: '°C' }, { unit: '°C' },
      { unit: '%' },
      { unit: 'kPa' }
    ] as AxisSeries[]
    assignSecondAxis(series)
    const right = series.filter((item) => item.axis === 'right')
    expect(right).toHaveLength(1)
    expect(
      series.find((item) => item.unit === 'kPa')?.axis,
      'ba trục trở lên thì người đọc không còn biết đường nào thuộc thang nào'
    ).toBeUndefined()
  })

  it('chuỗi không có đơn vị không bao giờ bị đẩy sang trục phụ', () => {
    const series = [{ unit: '°C' }, { unit: undefined }, { unit: '%' }] as AxisSeries[]
    assignSecondAxis(series)
    expect(series[1].axis).toBeUndefined()
  })

  it('hoà số lượng thì phá hoà theo TÊN ĐƠN VỊ, không theo thứ tự dữ liệu về', () => {
    /* Bản đầu của test này so hai lần chạy cùng đầu vào — vô nghĩa, vì `Map`
       giữ thứ tự chèn nên cùng đầu vào luôn cho cùng đầu ra kể cả khi bỏ
       tiebreaker. Tự chạy mutant mới lộ ra.
       Điều thật sự cần khoá: khi hai đơn vị hoà số lượng, kết quả phải do TÊN
       quyết định. Không có tiebreaker thì trục phụ chạy theo thứ tự backend trả
       series về — hôm nay `%` bên phải, mai backend đổi thứ tự thì `°C` bên
       phải, mà dữ liệu không đổi gì. */
    const series = [{ unit: 'B' }, { unit: 'A' }] as AxisSeries[]
    assignSecondAxis(series)
    // Sắp theo tên: A trước, B sau ⇒ A giữ trục trái, B sang phải.
    expect(series.find((item) => item.unit === 'B')?.axis).toBe('right')
    expect(series.find((item) => item.unit === 'A')?.axis).toBeUndefined()
  })
})


afterEach(cleanup)

describe('T57-2.4   HistoryTooltip chi hien thi gon gang ten - gia tri - don vi', () => {
  const series: TrendSeries[] = [
    { key: 'UI-01', label: 'UI-01', color: '#2A5C8A', unit: 'V', kind: 'UI' },
    { key: 'UI-02', label: 'UI-02', color: '#F59E0B', unit: 'degC', kind: 'UI' }
  ]
  const sample: TrendSample = {
    time: '2026-09-30T04:43:00.000Z',
    'UI-01': 87.83,
    'UI-01:quality': 'GOOD',
    'UI-01:source': 'io',
    'UI-01:tier': 'cache'
  }

  it('chi hien thi ten, gia tri, don vi va khong chua Quality/Source/Tier/Raw', () => {
    render(
      <HistoryTooltip
        active
        payload={[{ dataKey: 'UI-01', value: 87.83, payload: sample }]}
        label="2026-09-30T04:43:00.000Z"
        series={series}
        timeZone="UTC"
      />
    )

    expect(screen.getByText(/UI-01: 87\.83 V/)).toBeInTheDocument()
    expect(screen.getByText(/UI-02: \u2014/)).toBeInTheDocument()
    expect(screen.queryByText(/Quality/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Source/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Tier/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Raw/i)).not.toBeInTheDocument()
  })
})
