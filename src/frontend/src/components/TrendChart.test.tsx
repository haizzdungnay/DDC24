import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TrendChart, type TrendSeries } from './TrendChart'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver

const series: TrendSeries[] = [{ key: 'UI-01', label: 'UI-01', color: '#2A5C8A', unit: 'degC' }]
const data = [{ time: '15:00:00', 'UI-01': 24 }]

afterEach(cleanup)

describe('TrendChart table visibility', () => {
  it('keeps the historical table visible by default', () => {
    render(<TrendChart data={data} series={series} />)
    expect(screen.getByRole('table', { name: 'Historical trend data' })).toBeInTheDocument()
  })

  it('can render the chart without its data table', () => {
    render(<TrendChart data={data} series={series} showTable={false} />)
    expect(screen.getByLabelText('Historical trend chart')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Historical trend data' })).not.toBeInTheDocument()
  })
})
