import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../shared/components/Toast'
import { I18nProvider } from '../../shared/i18n'
import { ApiError, type AiInputConfig, type Point } from '../../shared/types'
import { InputsPage } from './InputsPage'

const api = vi.hoisted(() => ({
  getAiInputs: vi.fn(),
  putAiInputs: vi.fn(),
  updatePointName: vi.fn(),
  getPoints: vi.fn()
}))
const hookState = vi.hoisted(() => ({ points: [] as Point[] }))
const mode = vi.hoisted(() => ({ isDemo: false }))

vi.mock('../../shared/api/client', () => ({ apiClient: api }))
vi.mock('../../shared/config', () => ({
  get IS_DEMO() { return mode.isDemo }
}))
vi.mock('../../shared/hooks/useApi', () => ({
  useApi: () => ({ data: hookState.points, loading: false, error: null, refetch: vi.fn() })
}))
vi.mock('../../shared/components/PointLoggingSection', () => ({ PointLoggingSection: () => <div /> }))
vi.mock('../../shared/components/TrendChart', () => ({ TrendChart: () => <div /> }))

const input: AiInputConfig = {
  channel: 1,
  tag: 'LEGACY_ALIAS',
  label: 'Shared Display',
  signalType: 0,
  displayMin: 0,
  displayMax: 100,
  rangeMultiplier: 0,
  unit: 0,
  filterSamples: 3,
  sensorCal: 0,
  mathFunction: 0,
  enabled: true,
  note: ''
}

function renderPage() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <InputsPage />
      </ToastProvider>
    </I18nProvider>
  )
}

describe('InputsPage point metadata fields', () => {
  beforeEach(() => {
    localStorage.setItem('mkddc-lang', 'en')
    mode.isDemo = false
    api.getAiInputs.mockResolvedValue([{ ...input }])
    api.putAiInputs.mockResolvedValue(undefined)
    api.updatePointName.mockResolvedValue({ id: 'UI-01', name: 'Blocked Physical Name' })
    hookState.points = [{
      id: 'UI-01',
      tag: 'UI-01',
      name: 'Shared Display',
      kind: 'UI',
      value: 0,
      quality: 'good',
      source: 'core',
      updatedAt: new Date().toISOString()
    }, {
      id: 'AO-01',
      tag: 'AO-01',
      name: ' shared\t display ',
      kind: 'AO',
      value: 0,
      quality: 'good',
      source: 'core',
      updatedAt: new Date().toISOString()
    }]
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    hookState.points = []
  })

  it('keeps the physical tag canonical/read-only and surfaces a cross-kind display conflict', async () => {
    renderPage()

    const tag = await screen.findByDisplayValue('UI-01')
    const name = screen.getByDisplayValue('Shared Display')
    expect(tag).toHaveAttribute('readonly')
    expect(name).not.toHaveAttribute('readonly')
    expect(screen.getByRole('alert')).toHaveTextContent('UI-01 also matches AO-01')
  })

  it('focuses a structured name conflict and preserves the failed physical rename', async () => {
    api.updatePointName.mockRejectedValueOnce(new ApiError('point namespace conflict', 409, [{
      path: 'ao[0].name',
      reason: 'point_name_conflict',
      message: 'display name is already used',
      pointId: 'AO-01',
      conflictPointId: 'UI-01',
      conflictPath: 'ui[0].name'
    }]))
    const user = userEvent.setup()
    renderPage()
    const name = await screen.findByDisplayValue('Shared Display')
    await user.clear(name)
    await user.type(name, 'Blocked Physical Name')
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0])
    const dialog = screen.getByRole('dialog', { name: 'Save UI config?' })
    await user.click(within(dialog).getByRole('button', { name: 'OK' }))

    expect(await screen.findByText('display name is already used (conflicts with AO-01)')).toBeInTheDocument()
    expect(name).toHaveValue('Blocked Physical Name')
    await waitFor(() => expect(name).toHaveFocus())
    expect(api.updatePointName).toHaveBeenCalledWith('UI-01', 'Blocked Physical Name')
    expect(api.putAiInputs).not.toHaveBeenCalled()
  })
})

/* FE-DATA-02 (review FE 2026-08-05): khi `/system/config/io` trả 502, trang này
 * từng render tiêu đề + danh sách kênh rỗng kèm nhãn "No data", nên không phân
 * biệt được "chưa cấu hình kênh nào" với "không đọc được cấu hình". */
describe('InputsPage — authority không trả lời', () => {
  beforeEach(() => {
    localStorage.setItem('mkddc-lang', 'en')
    mode.isDemo = false
    hookState.points = []
    api.getAiInputs.mockRejectedValue(new Error('502 Bad Gateway'))
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('báo lỗi kèm Retry thay vì danh sách kênh rỗng', async () => {
    renderPage()
    expect(await screen.findByText('Could not load input configuration')).toBeInTheDocument()
    expect(screen.getByText('502 Bad Gateway')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    expect(screen.queryByText('UI Channels')).not.toBeInTheDocument()
  })

  it('Retry gọi lại API và trả về trang bình thường khi authority sống lại', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Could not load input configuration')
    api.getAiInputs.mockResolvedValue([input])
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByText('UI Channels')).toBeInTheDocument()
  })
})

describe('InputsPage — ranh giới dữ liệu live/demo', () => {
  beforeEach(() => {
    localStorage.setItem('mkddc-lang', 'en')
    mode.isDemo = false
    hookState.points = []
    api.getAiInputs.mockResolvedValue([{ ...input }])
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    hookState.points = []
  })

  it('live để trống khi không có điểm thật, không mượn UI-01 demo', async () => {
    renderPage()

    expect(await screen.findByText('Live Data')).toBeInTheDocument()
    expect(screen.getByText('No live data for this channel yet.')).toBeInTheDocument()
    expect(screen.getAllByText('--').length).toBeGreaterThan(0)
    expect(screen.queryByText('23.7 C')).not.toBeInTheDocument()
  })

  it('demo vẫn hiển thị điểm mô phỏng khi chưa có điểm API', async () => {
    mode.isDemo = true
    renderPage()

    expect(await screen.findByText('Live Data')).toBeInTheDocument()
    expect(screen.queryByText('No live data for this channel yet.')).not.toBeInTheDocument()
    expect(screen.getAllByText('23.7 C').length).toBeGreaterThan(0)
  })
})
