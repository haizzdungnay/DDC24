import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const realtimeState = vi.hoisted(() => ({ allPoints: [], lastPointEventAt: null }))
const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>())

vi.mock('../../shared/config', () => ({
  API_ORIGIN: 'https://device.test',
  HISTORIAN_V2_TRENDS_ENABLED: true,
  IS_DEMO: false
}))

vi.mock('../../shared/api/history', async () => {
  const actual = await vi.importActual<typeof import('../../shared/api/history')>('../../shared/api/history')
  return {
    ...actual,
    historyClient: actual.createHistoryClient({ baseUrl: 'https://device.test/api/v1', fetchImpl: fetchMock })
  }
})

vi.mock('../../shared/api/client', () => ({
  apiClient: {
    getPoints: vi.fn().mockResolvedValue([{
      id: 'UI-01', tag: 'UI-01', name: 'Supply temperature', kind: 'UI', value: 21, quality: 'good', source: 'core', updatedAt: '2026-07-20T00:00:00Z'
    }, {
      id: 'UI-06', tag: 'UI-06', name: 'Fire alarm contact', kind: 'UI', value: 0, quality: 'good', source: 'core', updatedAt: '2026-07-20T00:00:00Z'
    }, {
      id: 'AO-03', tag: 'AO-03', name: 'Damper position', kind: 'AO', value: 0, quality: 'good', source: 'core', updatedAt: '2026-07-20T00:00:00Z'
    }]),
    getVirtualPoints: vi.fn().mockResolvedValue([])
  }
}))

vi.mock('../../shared/i18n', () => ({
  useI18n: () => ({ pick: (_vi: string, en: string) => en })
}))

vi.mock('../../shared/realtime', () => ({
  useRealtime: () => realtimeState
}))

const historyPayload = {
  from: '2026-07-20T00:00:00Z',
  to: '2026-07-20T00:30:00Z',
  complete: true,
  series: [{ pointId: 'UI-01', generation: 1, effectiveResolution: '15s', samples: [] }],
  gaps: [],
  tiersUsed: ['cache']
}

fetchMock.mockImplementation(async () => new Response(JSON.stringify(historyPayload), {
  status: 200,
  headers: { 'content-type': 'application/json' }
}))

vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
})

import { TrendsPage } from './TrendsPage'

/* BL-008: bộ chọn khoảng thời gian dùng GIỜ ĐỊA PHƯƠNG, nên kỳ vọng phải được
 * tính từ múi giờ của môi trường chạy test thay vì gắn cứng hậu tố 'Z'. Viết
 * cách này thì test đúng ở mọi múi giờ CI, và vẫn bắt được lỗi nếu hai chiều
 * hiển thị/đọc lệch hệ quy chiếu. */
const localIso = (wall: string) => new Date(wall).toISOString()
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'giờ địa phương'
const fromLabel = () => `From (local time ${timeZone()})`
const toLabel = () => `To (local time ${timeZone()})`

function latestHistoryUrl(): URL {
  const calls = fetchMock.mock.calls
  return new URL(calls[calls.length - 1]![0] as string)
}

afterEach(() => {
  cleanup()
  fetchMock.mockClear()
  window.localStorage.clear()
})

describe('Trends history request routing', () => {
  it('renders a preset through the cache query without sending a legacy range', async () => {
    render(<MemoryRouter><TrendsPage /></MemoryRouter>)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const initial = latestHistoryUrl()
    expect(initial.searchParams.get('source')).toBe('cache')
    expect(initial.searchParams.has('range')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '1 hour' }))
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1))
    const preset = latestHistoryUrl()
    expect(preset.searchParams.get('source')).toBe('cache')
    expect(preset.searchParams.has('range')).toBe(false)
    expect(Date.parse(preset.searchParams.get('to')!) - Date.parse(preset.searchParams.get('from')!)).toBe(60 * 60_000)
  })

  it('renders Custom through explicit database bounds without a legacy range', async () => {
    render(<MemoryRouter><TrendsPage /></MemoryRouter>)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const from = screen.getByLabelText(fromLabel())
    const to = screen.getByLabelText(toLabel())
    fireEvent.change(from, { target: { value: '2026-07-22T03:10' } })
    fireEvent.change(to, { target: { value: '2026-07-23T03:40' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply custom' }))

    await waitFor(() => expect(latestHistoryUrl().searchParams.get('source')).toBe('database'))
    const custom = latestHistoryUrl()
    expect(custom.searchParams.get('from')).toBe(localIso('2026-07-22T03:10'))
    expect(custom.searchParams.get('to')).toBe(localIso('2026-07-23T03:40'))
    expect(custom.searchParams.get('source')).toBe('database')
    expect(custom.searchParams.has('range')).toBe(false)
    expect(screen.getByText('Analog trend - Custom (local time)')).toBeInTheDocument()
    expect(screen.getByText(/Custom reads database history only/)).toHaveTextContent('No database series were found for: UI-06')
  })

  it('marks the panel Custom immediately while the database request is pending', async () => {
    let releaseDatabase!: () => void
    const databasePending = new Promise<void>((resolve) => { releaseDatabase = resolve })
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(input as string)
      if (url.searchParams.get('source') === 'database') await databasePending
      return new Response(JSON.stringify(historyPayload), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    })

    render(<MemoryRouter><TrendsPage /></MemoryRouter>)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText(fromLabel()), { target: { value: '2026-07-22T03:10' } })
    fireEvent.change(screen.getByLabelText(toLabel()), { target: { value: '2026-07-23T03:40' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply custom' }))

    expect(screen.getByText('Analog trend - Custom (local time)')).toBeInTheDocument()
    expect(screen.queryByText('Analog trend - 24 hours')).not.toBeInTheDocument()
    releaseDatabase()
  })

  it('migrates a stale AO-19 preference before applying Custom', async () => {
    window.localStorage.setItem('mkddc:trends:v1', JSON.stringify({ selectedIds: ['AO-19'], rangeMinutes: 1440 }))
    render(<MemoryRouter><TrendsPage /></MemoryRouter>)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(latestHistoryUrl().searchParams.get('point')).toBe('AO-03')
    expect(screen.getAllByText('AO-03')).not.toHaveLength(0)
    expect(screen.queryByText('AO-19')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(fromLabel()), { target: { value: '2026-07-22T03:10' } })
    fireEvent.change(screen.getByLabelText(toLabel()), { target: { value: '2026-07-23T03:40' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply custom' }))

    await waitFor(() => expect(latestHistoryUrl().searchParams.get('source')).toBe('database'))
    expect(latestHistoryUrl().searchParams.get('point')).toBe('AO-03')
    expect(screen.getByText('Analog trend - Custom (local time)')).toBeInTheDocument()
  })
})
