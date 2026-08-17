import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../shared/components/Toast'
import { I18nProvider } from '../../shared/i18n'
import type { AoConfig, DoConfig, OutputsConfig, Point, VirtualPoint } from '../../shared/types'
import { OutputsPage } from './OutputsPage'

const api = vi.hoisted(() => ({
  getOutputs: vi.fn(),
  getPoints: vi.fn(),
  getVirtualPoints: vi.fn(),
  updatePointName: vi.fn(),
  putOutputs: vi.fn(),
  forceOutput: vi.fn()
}))
const hookState = vi.hoisted(() => ({ points: [] as Point[], virtualPoints: [] as VirtualPoint[] }))

vi.mock('../../shared/api/client', () => ({ apiClient: api }))
vi.mock('../../shared/hooks/useApi', () => ({
  useApi: (loader: unknown) => loader === api.getVirtualPoints
    ? { data: hookState.virtualPoints, loading: false, error: null, refetch: vi.fn() }
    : { data: hookState.points, loading: false, error: null, refetch: vi.fn() }
}))
vi.mock('../../shared/components/PointLoggingSection', () => ({ PointLoggingSection: () => <div /> }))
vi.mock('../../shared/components/TrendChart', () => ({ TrendChart: () => <div /> }))

const ao: AoConfig = {
  id: 'AO-01', channel: 1, kind: 'AO', tag: 'AO-01', label: 'Shared Output', enabled: true, mode: '0-10V', units: 'volt',
  minPv: 0, maxPv: 10, safeValue: 0, source: 0, loopConfig: 0, minHeatOutput: 0, maxHeatOutput: 0,
  minCoolOutput: 0, maxCoolOutput: 0, alarm100: 0, alarm0: 0, input: 0, notUsed10: 0, notUsed11: 0,
  piSeqLowerFan1: 0, fanSpeed2: 0, piSeqUpperFan3: 0, setbackAlarm: 0, notInUse16: 0, manualValue: 0, note: ''
}
const outputConfig: OutputsConfig = {
  ao: [ao],
  do: [{ id: 'DO-01', channel: 1, kind: 'DO', tag: 'DO-01', label: 'Other Output', safeState: 'open', manualValue: false } as DoConfig]
}

function renderPage() {
  return render(<I18nProvider><ToastProvider><OutputsPage /></ToastProvider></I18nProvider>)
}

describe('OutputsPage point metadata recovery', () => {
  beforeEach(() => {
    localStorage.setItem('mkddc-lang', 'en')
    api.getOutputs.mockResolvedValue(outputConfig)
    api.getPoints.mockResolvedValue([])
    api.getVirtualPoints.mockResolvedValue([])
    api.updatePointName.mockResolvedValue({ id: 'AO-01', name: 'Recovered Output' })
    api.putOutputs.mockResolvedValue(undefined)
    hookState.points = [
      { id: 'AO-01', tag: 'AO-01', name: 'Shared Output', kind: 'AO', value: 0, quality: 'good', source: 'core', updatedAt: new Date().toISOString() },
      { id: 'DO-01', tag: 'DO-01', name: 'Other Output', kind: 'DO', value: false, quality: 'good', source: 'core', updatedAt: new Date().toISOString() }
    ]
    hookState.virtualPoints = [{
      id: 'VP1', tag: 'VP_DISABLED', name: ' shared output ', label: ' shared output ', signalType: 'float',
      enabled: false, writable: true, logEnabled: false
    }]
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('recovers a conflicted output name without mutating unrelated draft fields', async () => {
    const user = userEvent.setup()
    renderPage()

    const name = await screen.findByRole('textbox', { name: 'Label' })
    expect(screen.getByRole('alert')).toHaveTextContent('AO-01 also matches VP1')
    await user.clear(name)
    await user.type(name, 'Recovered Output')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const dialog = screen.getByRole('dialog', { name: 'Save Outputs config?' })
    expect(within(dialog).getByText('Do you want to save the changes?')).toBeInTheDocument()
    expect(api.updatePointName).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'OK' }))

    await waitFor(() => expect(api.updatePointName).toHaveBeenCalledWith('AO-01', 'Recovered Output'))
    expect(api.putOutputs).not.toHaveBeenCalled()
    expect(name).toHaveValue('Recovered Output')
    expect(screen.queryByRole('dialog', { name: 'Save Outputs config?' })).not.toBeInTheDocument()
    expect(screen.getByText('Register')).toBeInTheDocument()
  })

  it('cancels the save confirmation without writing changes', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByRole('textbox', { name: 'Label' })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const dialog = screen.getByRole('dialog', { name: 'Save Outputs config?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(api.updatePointName).not.toHaveBeenCalled()
    expect(api.putOutputs).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Save Outputs config?' })).not.toBeInTheDocument()
  })
})

/* FE-DATA-02 (review FE 2026-08-05): khi `/system/config/io-bundle` trả 502,
 * trang này từng render tiêu đề + danh sách kênh rỗng kèm nhãn "No data". */
describe('OutputsPage — authority không trả lời', () => {
  beforeEach(() => {
    localStorage.setItem('mkddc-lang', 'en')
    hookState.points = []
    hookState.virtualPoints = []
    api.getOutputs.mockRejectedValue(new Error('502 Bad Gateway'))
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('báo lỗi kèm Retry thay vì danh sách output rỗng', async () => {
    renderPage()
    expect(await screen.findByText('Could not load output configuration')).toBeInTheDocument()
    expect(screen.getByText('502 Bad Gateway')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    expect(screen.queryByText('Output Channels')).not.toBeInTheDocument()
  })

  it('Retry gọi lại API và trả về trang bình thường khi authority sống lại', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Could not load output configuration')
    api.getOutputs.mockResolvedValue(outputConfig)
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByText('Output Channels')).toBeInTheDocument()
  })
})

/* F-OUT-001 (2026-08-17): "Manual output (%)" gửi thẳng số 0-100 làm giá trị
 * RAW xuống Core — can_set_ao() chỉ nhận volt/mA thật nên mọi lần Force với
 * % thật sự (>10 cho 0-10V, hoặc bất kỳ giá trị nào cho 4-20mA vì dải bắt
 * đầu từ 4) đều gửi sai đơn vị. Khoá lại đúng công thức Core dùng cho node
 * AO_OUTPUT (graph_runtime.cpp): pct/100*10 cho 0-10V, 4+pct/100*16 cho
 * 4-20mA — không sửa ở tầng apiClient/Go/Core dùng chung vì VirtualIoPage
 * và MonitorPage gọi cùng API này với giá trị RAW (đúng), nên quy đổi phải
 * nằm ở FE, đúng lúc "Manual output (%)" build request. */
describe('OutputsPage manual output (%) — quy đổi sang raw trước khi Force (F-OUT-001)', () => {
  const ao010v: AoConfig = { ...ao, id: 'AO-01', mode: '0-10V', manualValue: 65 }
  const ao420ma: AoConfig = { ...ao, id: 'AO-02', mode: '4-20mA', manualValue: 50 }

  beforeEach(() => {
    localStorage.setItem('mkddc-lang', 'en')
    api.getPoints.mockResolvedValue([])
    api.getVirtualPoints.mockResolvedValue([])
    api.forceOutput.mockResolvedValue(undefined)
    hookState.virtualPoints = []
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('Force với 0-10V: 65% phải thành 6.5V, không phải 65 (F-OUT-001)', async () => {
    const user = userEvent.setup()
    api.getOutputs.mockResolvedValue({ ao: [ao010v], do: [] })
    hookState.points = [{ id: 'AO-01', tag: 'AO-01', name: 'Shared Output', kind: 'AO', value: 6.5, raw: 6.5, unit: 'V', rawUnit: 'V', quality: 'good', source: 'core', updatedAt: new Date().toISOString() }]

    renderPage()
    const manualSection = (await screen.findByText('Manual Output')).closest('section') as HTMLElement
    const input = within(manualSection).getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '65' } })
    await user.click(within(manualSection).getByRole('button', { name: 'Force' }))

    await waitFor(() => expect(api.forceOutput).toHaveBeenCalledWith('AO-01', 6.5, false))
  })

  it('Force với 4-20mA: 50% phải thành 12mA (4 + 50%*16), không phải 50 (F-OUT-001)', async () => {
    const user = userEvent.setup()
    api.getOutputs.mockResolvedValue({ ao: [ao420ma], do: [] })
    hookState.points = [{ id: 'AO-02', tag: 'AO-02', name: 'Shared Output', kind: 'AO', value: 12, raw: 12, unit: 'mA', rawUnit: 'mA', quality: 'good', source: 'core', updatedAt: new Date().toISOString() }]

    renderPage()
    const manualSection = (await screen.findByText('Manual Output')).closest('section') as HTMLElement
    const input = within(manualSection).getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '50' } })
    await user.click(within(manualSection).getByRole('button', { name: 'Force' }))

    await waitFor(() => expect(api.forceOutput).toHaveBeenCalledWith('AO-02', 12, false))
  })

  it('hiện "% open" tính từ raw song song với Volt thô, không thay thế', async () => {
    api.getOutputs.mockResolvedValue({ ao: [ao010v], do: [] })
    hookState.points = [{ id: 'AO-01', tag: 'AO-01', name: 'Shared Output', kind: 'AO', value: 6.5, raw: 6.5, unit: 'V', rawUnit: 'V', quality: 'good', source: 'core', updatedAt: new Date().toISOString() }]

    renderPage()
    await screen.findByText('Manual Output')
    expect(screen.getByText('% open')).toBeInTheDocument()
    expect(screen.getByText('65.0 %')).toBeInTheDocument()
    expect(screen.getByText('Raw output')).toBeInTheDocument()
  })
})
