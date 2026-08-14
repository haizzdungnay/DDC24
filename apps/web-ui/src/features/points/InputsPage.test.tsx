import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../shared/components/Toast'
import { I18nProvider } from '../../shared/i18n'
import { ApiError, type AiInputConfig, type AlarmSetting, type Point } from '../../shared/types'
import { InputsPage } from './InputsPage'

const api = vi.hoisted(() => ({
  getAiInputs: vi.fn(),
  putAiInputs: vi.fn(),
  updatePointName: vi.fn(),
  getPoints: vi.fn(),
  getVirtualPoints: vi.fn(),
  getAlarmSettings: vi.fn()
}))
const hookState = vi.hoisted(() => ({ points: [] as Point[], virtualPoints: [] as unknown[], alarms: [] as AlarmSetting[] }))
const mode = vi.hoisted(() => ({ isDemo: false }))

vi.mock('../../shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/api/client')>()
  return { ...actual, apiClient: api }
})
vi.mock('../../shared/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/config')>()
  return {
    ...actual,
    get IS_DEMO() { return mode.isDemo }
  }
})
vi.mock('../../shared/hooks/useApi', () => ({
  useApi: (fetcher: unknown) => {
    if (fetcher === api.getAlarmSettings) return { data: hookState.alarms, loading: false, error: null, refetch: vi.fn() }
    if (fetcher === api.getVirtualPoints) return { data: hookState.virtualPoints, loading: false, error: null, refetch: vi.fn() }
    return { data: hookState.points, loading: false, error: null, refetch: vi.fn() }
  }
}))
vi.mock('../../shared/components/PointLoggingSection', () => ({ PointLoggingSection: () => <div /> }))
vi.mock('../../shared/components/TrendChart', () => ({ TrendChart: () => <div /> }))

const baseInput: AiInputConfig = {
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

function AlarmSettingsRouteProbe() {
  const location = useLocation()
  return <div data-testid="alarm-settings-route">{location.pathname}{location.search}</div>
}

function renderPage() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={['/eng/inputs']}>
          <Routes>
            <Route path="/eng/inputs" element={<InputsPage />} />
            <Route path="/eng/alarm-settings" element={<AlarmSettingsRouteProbe />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </I18nProvider>
  )
}

describe('InputsPage point metadata fields', () => {
  beforeEach(() => {
    localStorage.setItem('mkddc-lang', 'en')
    mode.isDemo = false
    api.getAiInputs.mockResolvedValue([{ ...baseInput }])
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
    hookState.alarms = []
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
    hookState.alarms = []
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
    api.getAiInputs.mockResolvedValue([baseInput])
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByText('UI Channels')).toBeInTheDocument()
  })
})

describe('InputsPage — ranh giới dữ liệu live/demo (tab Diagnostics)', () => {
  beforeEach(() => {
    localStorage.setItem('mkddc-lang', 'en')
    mode.isDemo = false
    hookState.points = []
    hookState.alarms = []
    api.getAiInputs.mockResolvedValue([{ ...baseInput }])
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    hookState.points = []
  })

  it('live để trống khi không có điểm thật, không mượn UI-01 demo', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Diagnostics' }))

    expect(await screen.findByText('Live statistics')).toBeInTheDocument()
    expect(screen.getByText('No live data for this channel yet.')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.queryByText('23.7 C')).not.toBeInTheDocument()
  })

  it('demo vẫn hiển thị điểm mô phỏng khi chưa có điểm API', async () => {
    mode.isDemo = true
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('23.7 C')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Diagnostics' }))
    expect(screen.queryByText('No live data for this channel yet.')).not.toBeInTheDocument()
  })
})

describe('InputsPage — tab Điện & Cảm biến (UC-UI-02/03/06)', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    hookState.points = []
  })

  it('kênh Điện trở chỉ chọn được NTC10k/NTC20k, không hiện PT100/PT1000 làm lựa chọn', async () => {
    localStorage.setItem('mkddc-lang', 'en')
    hookState.points = []
    hookState.alarms = []
    api.getAiInputs.mockResolvedValue([{ ...baseInput, signalType: 3, ioType: 'NTC20k' }])
    renderPage()

    expect(await screen.findByRole('radio', { name: 'Resistance', checked: true })).toBeInTheDocument()
    expect(await screen.findByRole('radio', { name: 'NTC20k', checked: true })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'NTC10k' })).not.toBeChecked()
    expect(screen.queryByRole('radio', { name: /PT100/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /PT1000/ })).not.toBeInTheDocument()
  })

  it('kênh tiếp điểm khô hiện đúng NO/NC và cảnh báo không cách ly', async () => {
    localStorage.setItem('mkddc-lang', 'en')
    hookState.points = []
    hookState.alarms = []
    api.getAiInputs.mockResolvedValue([{ ...baseInput, signalType: 5 }])
    renderPage()

    expect(await screen.findByRole('radio', { name: /NC — Normally closed/, checked: true })).toBeInTheDocument()
    expect(screen.getByText(/non-isolated auxiliary mode/)).toBeInTheDocument()
  })
})

describe('InputsPage — tab Scaling & Đơn vị giữ nguyên unit gốc chưa có control', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    hookState.points = []
  })

  it('hiện chip cảnh báo khi ioUnit không khớp lựa chọn đang chọn', async () => {
    localStorage.setItem('mkddc-lang', 'en')
    hookState.points = []
    hookState.alarms = []
    api.getAiInputs.mockResolvedValue([{ ...baseInput, signalType: 8, unit: 0, ioUnit: 'RPM' }])
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Scaling & Units' }))
    expect(await screen.findByText(/raw unit "RPM"/)).toBeInTheDocument()
  })
})

describe('InputsPage — Thiết lập nhanh (wizard) chỉ hiện cho kênh mặc định trống', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    hookState.points = []
  })

  it('không hiện nút Quick Setup khi kênh đã enabled', async () => {
    localStorage.setItem('mkddc-lang', 'en')
    hookState.points = []
    hookState.alarms = []
    api.getAiInputs.mockResolvedValue([{ ...baseInput, signalType: 0, enabled: true }])
    renderPage()
    await screen.findByText('UI Channels')
    expect(screen.queryByRole('button', { name: 'Quick Setup' })).not.toBeInTheDocument()
  })

  it('hiện Quick Setup cho kênh signalType=0 và chưa enabled; đi hết 6 bước rồi mở modal lưu', async () => {
    localStorage.setItem('mkddc-lang', 'en')
    hookState.points = []
    hookState.alarms = []
    api.getAiInputs.mockResolvedValue([{ ...baseInput, signalType: 0, enabled: false }])
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Quick Setup' }))
    expect(screen.getByText('1 / 6')).toBeInTheDocument()
    for (let step = 1; step < 6; step += 1) {
      await user.click(screen.getByRole('button', { name: 'Next' }))
    }
    expect(screen.getByText('6 / 6')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(screen.getByRole('dialog', { name: 'Save UI config?' })).toBeInTheDocument()
  })
})

describe('InputsPage — tab Cảnh báo & Lưu trữ (deep link sang AlarmSettingsPage, task 1.6)', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    hookState.points = []
  })

  it('liệt kê đúng alarm nguồn UI của kênh và điều hướng "Sửa" kèm query edit', async () => {
    localStorage.setItem('mkddc-lang', 'en')
    hookState.points = []
    hookState.alarms = [{
      id: 'ALM-014',
      label: 'High temp',
      enabled: true,
      alarmType: 1,
      sources: [{ kind: 'UI', channel: 1, pointId: 'UI-01' }],
      priority: 'medium',
      clearMode: 'auto',
      delayS: 0,
      params: {}
    }, {
      id: 'ALM-020',
      label: 'Other channel',
      enabled: true,
      alarmType: 1,
      sources: [{ kind: 'UI', channel: 2, pointId: 'UI-02' }],
      priority: 'medium',
      clearMode: 'auto',
      delayS: 0,
      params: {}
    }]
    api.getAiInputs.mockResolvedValue([{ ...baseInput }])
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Alarms & Storage' }))
    expect(await screen.findByText('ALM-014')).toBeInTheDocument()
    expect(screen.queryByText('ALM-020')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const probe = await screen.findByTestId('alarm-settings-route')
    expect(probe).toHaveTextContent('/eng/alarm-settings')
    expect(probe).toHaveTextContent('edit=ALM-014')
  })

  it('"Add alarm for this channel" điều hướng kèm query newSource=UI:<kênh>', async () => {
    localStorage.setItem('mkddc-lang', 'en')
    hookState.points = []
    hookState.alarms = []
    api.getAiInputs.mockResolvedValue([{ ...baseInput }])
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Alarms & Storage' }))
    await user.click(screen.getByRole('button', { name: 'Add alarm for this channel' }))
    const probe = await screen.findByTestId('alarm-settings-route')
    expect(probe).toHaveTextContent('/eng/alarm-settings')
    expect(probe).toHaveTextContent('newSource=UI:1')
  })
})
