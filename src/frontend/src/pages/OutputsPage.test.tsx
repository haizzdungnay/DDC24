import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../components/Toast'
import { I18nProvider } from '../i18n'
import type { AoConfig, DoConfig, OutputsConfig, Point, VirtualPoint } from '../types'
import { OutputsPage } from './OutputsPage'

const api = vi.hoisted(() => ({
  getOutputs: vi.fn(),
  getPoints: vi.fn(),
  getVirtualPoints: vi.fn(),
  updatePointName: vi.fn(),
  putOutputs: vi.fn()
}))
const hookState = vi.hoisted(() => ({ points: [] as Point[], virtualPoints: [] as VirtualPoint[] }))

vi.mock('../api/client', () => ({ apiClient: api }))
vi.mock('../hooks/useApi', () => ({
  useApi: (loader: unknown) => loader === api.getVirtualPoints
    ? { data: hookState.virtualPoints, loading: false, error: null, refetch: vi.fn() }
    : { data: hookState.points, loading: false, error: null, refetch: vi.fn() }
}))
vi.mock('../components/PointLoggingSection', () => ({ PointLoggingSection: () => <div /> }))
vi.mock('../components/TrendChart', () => ({ TrendChart: () => <div /> }))

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
