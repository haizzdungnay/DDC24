import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type Point, type VirtualPoint } from '../../shared/types'
import { ToastProvider } from '../../shared/components/Toast'
import { I18nProvider } from '../../shared/i18n'
import { MemoryRouter } from 'react-router-dom'
import { VirtualPointsPage, normalizeVirtualPoint } from './VirtualIoPage'

const api = vi.hoisted(() => ({
  getPoints: vi.fn(),
  getVirtualPoints: vi.fn(),
  updatePointName: vi.fn(),
  updateVirtualPoint: vi.fn(),
  createVirtualPoint: vi.fn(),
  deleteVirtualPoint: vi.fn(),
  // `T57-3.12`: hộp thoại xoá tra cứu nơi đang dùng điểm trước khi xoá.
  getVirtualPointUsage: vi.fn(),
  forcePoint: vi.fn()
}))
const hookState = vi.hoisted(() => ({ points: [] as Point[] }))

vi.mock('../../shared/api/client', () => ({ apiClient: api }))
vi.mock('../../shared/hooks/useApi', () => ({
  useApi: () => ({ data: hookState.points, loading: false, error: null, refetch: vi.fn() })
}))
vi.mock('../../shared/components/PointLoggingSection', () => ({
  PointLoggingSection: ({ pointId, label }: { pointId: string; label: string }) => <div data-testid="logging-label">{pointId}: {label}</div>
}))
vi.mock('../../shared/components/TrendChart', () => ({ TrendChart: () => <div data-testid="trend-chart" /> }))

function virtualPoint(overrides: Partial<VirtualPoint> = {}): VirtualPoint {
  return {
    id: 'VP1',
    channel: 25,
    tag: 'TECH_VP_1',
    name: 'Room Setpoint',
    label: 'Room Setpoint',
    signalType: 'float',
    enabled: true,
    writable: true,
    logEnabled: false,
    value: 24,
    unit: 'degC',
    generation: 1,
    ...overrides
  }
}

/* Trang này nay dùng `useDirtyGuard` (F-UX-12) nên cần Router — đúng thực tế
 * ứng dụng: `VirtualPointsPage` luôn nằm dưới `<Routes>` của `App.tsx`. */
function renderPage() {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <ToastProvider>
          <VirtualPointsPage />
        </ToastProvider>
      </I18nProvider>
    </MemoryRouter>
  )
}

describe('VirtualPointsPage tag and label layout', () => {
  beforeEach(() => {
  api.getVirtualPointUsage.mockResolvedValue({ pointId: 'VP1', references: [], scanned: ['alarm-settings', 'schedules'], incomplete: false })
    localStorage.setItem('mkddc-lang', 'en')
    api.getVirtualPoints.mockResolvedValue([virtualPoint()])
    api.updatePointName.mockResolvedValue({ id: 'VP1', name: 'Blocked Name' })
    api.updateVirtualPoint.mockImplementation(async (point: VirtualPoint) => point)
    api.createVirtualPoint.mockImplementation(async (point: VirtualPoint) => virtualPoint({ ...point, id: 'VP1', channel: 25, generation: 2 }))
    api.deleteVirtualPoint.mockResolvedValue(undefined)
    api.forcePoint.mockResolvedValue(undefined)
    hookState.points = [{
      id: 'AO-01', tag: 'AO-01', name: 'Room Setpoint', kind: 'AO', value: 0, quality: 'good', source: 'core',
      updatedAt: new Date().toISOString()
    }]
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    hookState.points = []
  })

  it('renders an editable Label independently from the technical tag', async () => {
    renderPage()

    const tag = await screen.findByRole('textbox', { name: 'Tag' })
    const name = screen.getByRole('textbox', { name: 'Label' })
    expect(tag).toHaveValue('TECH_VP_1')
    expect(name).toHaveValue('Room Setpoint')
    expect(screen.getByRole('button', { name: 'TECH_VP_1Room Setpointfloat' })).toBeInTheDocument()
    expect(screen.queryByText(/Channel 25/)).not.toBeInTheDocument()
    expect(screen.getByTestId('logging-label')).toHaveTextContent('VP1: Room Setpoint')
  })

  it('uses label as Display name and saves tag and label to their matching fields', async () => {
    api.getVirtualPoints.mockResolvedValueOnce([virtualPoint({ tag: 'TECH_VP_1', name: 'LEGACY_WRONG_NAME', label: 'Supply Setpoint' })])
    hookState.points = []
    const user = userEvent.setup()
    renderPage()

    const tag = await screen.findByRole('textbox', { name: 'Tag' })
    const label = screen.getByRole('textbox', { name: 'Label' })
    expect(tag).toHaveValue('TECH_VP_1')
    expect(label).toHaveValue('Supply Setpoint')

    await user.clear(tag)
    await user.type(tag, 'SUPPLY_SP')
    await user.clear(label)
    await user.type(label, 'Supply Air Setpoint')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const dialog = screen.getByRole('dialog', { name: 'Save Virtual Point?' })
    expect(within(dialog).getByText('Do you want to save the changes?')).toBeInTheDocument()
    expect(api.updateVirtualPoint).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'OK' }))

    await waitFor(() => expect(api.updateVirtualPoint).toHaveBeenCalledWith(expect.objectContaining({
      tag: 'SUPPLY_SP',
      label: 'Supply Air Setpoint'
    })))
    expect(screen.getByTestId('logging-label')).toHaveTextContent('VP1: Supply Air Setpoint')
    expect(screen.queryByRole('dialog', { name: 'Save Virtual Point?' })).not.toBeInTheDocument()
    expect(screen.getByText('Note')).toBeInTheDocument()
  })

  it('focuses structured label conflicts and preserves the failed rename draft', async () => {
    api.updatePointName.mockRejectedValueOnce(new ApiError('point namespace conflict', 409, [{
      path: 'ao[0].name',
      reason: 'point_name_conflict',
      message: 'display name is already used',
      pointId: 'AO-01',
      conflictPointId: 'VP1',
      conflictPath: 'items[0].label'
    }]))
    const user = userEvent.setup()
    renderPage()
    const name = await screen.findByRole('textbox', { name: 'Label' })
    const tag = screen.getByRole('textbox', { name: 'Tag' })

    await user.clear(tag)
    await user.type(tag, 'UNSAVED_TECH_TAG')
    await user.clear(name)
    await user.type(name, 'Blocked Name')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const dialog = screen.getByRole('dialog', { name: 'Save Virtual Point?' })
    await user.click(within(dialog).getByRole('button', { name: 'OK' }))

    expect(await screen.findByText('display name is already used (conflicts with AO-01)')).toBeInTheDocument()
    expect(name).toHaveValue('Blocked Name')
    expect(tag).toHaveValue('UNSAVED_TECH_TAG')
    await waitFor(() => expect(name).toHaveFocus())
    expect(api.updatePointName).toHaveBeenCalledWith('VP1', 'Blocked Name')
    expect(api.updateVirtualPoint).not.toHaveBeenCalled()
  })

  it('cancels the save confirmation without updating the virtual point', async () => {
    hookState.points = []
    const user = userEvent.setup()
    renderPage()

    await screen.findByRole('textbox', { name: 'Label' })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const dialog = screen.getByRole('dialog', { name: 'Save Virtual Point?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(api.updatePointName).not.toHaveBeenCalled()
    expect(api.updateVirtualPoint).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Save Virtual Point?' })).not.toBeInTheDocument()
  })

  it('removes a deleted display and uses the recreated point display without leaking the old name', async () => {
    const user = userEvent.setup()
    renderPage()
    expect((await screen.findAllByText('Room Setpoint')).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const deleteDialog = screen.getByRole('dialog', { name: 'Delete Virtual Point?' })
    await user.click(within(deleteDialog).getByRole('button', { name: 'OK' }))
    await waitFor(() => expect(api.deleteVirtualPoint).toHaveBeenCalledWith('VP1'))
    expect(screen.queryByText('Room Setpoint')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add VP' }))
    const addDialog = screen.getByRole('dialog', { name: 'Add Virtual Point' })
    const fields = addDialog.querySelectorAll('input[type="text"]')
    await user.type(fields[0] as HTMLInputElement, 'NEW_VP')
    await user.type(fields[1] as HTMLInputElement, 'Recreated Name')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect((await screen.findAllByText('Recreated Name')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Room Setpoint')).not.toBeInTheDocument()
    expect(api.createVirtualPoint).toHaveBeenCalledWith(expect.objectContaining({ label: 'Recreated Name' }))
  })
})

describe('normalizeVirtualPoint', () => {
  it('preserves the legacy label wire value while projecting a canonical name', () => {
    const normalized = normalizeVirtualPoint(virtualPoint({ name: undefined, label: '  Phòng   Áp Suất  ' }))
    expect(normalized.name).toBe('Phòng Áp Suất')
    expect(normalized.label).toBe('Phòng Áp Suất')
    expect(normalized.tag).toBe('TECH_VP_1')
  })

  it('prefers the canonical label when a stale name alias disagrees', () => {
    const normalized = normalizeVirtualPoint(virtualPoint({ tag: 'TECH_VP_1', name: 'TECH_VP_1', label: 'Room Setpoint' }))
    expect(normalized.tag).toBe('TECH_VP_1')
    expect(normalized.label).toBe('Room Setpoint')
    expect(normalized.name).toBe('Room Setpoint')
  })

  it('falls blank legacy labels back to the canonical id', () => {
    const normalized = normalizeVirtualPoint(virtualPoint({ name: undefined, label: '  ' }))
    expect(normalized.name).toBe('VP1')
    expect(normalized.label).toBe('VP1')
  })
})

/* FE-DATA-02 (review FE 2026-08-05): khi `/virtual-points` trả 502, trang này
 * từng hiện "chưa có VP" — trong khi VP có thể đang tồn tại đầy đủ. */
describe('VirtualPointsPage — authority không trả lời', () => {
  beforeEach(() => {
    localStorage.setItem('mkddc-lang', 'en')
    hookState.points = []
    api.getVirtualPoints.mockRejectedValue(new Error('502 Bad Gateway'))
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('báo lỗi kèm Retry thay vì danh sách VP rỗng', async () => {
    renderPage()
    expect(await screen.findByText('Could not load virtual points')).toBeInTheDocument()
    // Toast cũng in nguyên message nên có hai nút hiển thị cùng chuỗi này.
    expect(screen.getAllByText('502 Bad Gateway').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    expect(screen.queryByText('Created VP')).not.toBeInTheDocument()
  })

  it('Retry gọi lại API và trả về trang bình thường khi authority sống lại', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Could not load virtual points')
    api.getVirtualPoints.mockResolvedValue([virtualPoint()])
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByText('Created VP')).toBeInTheDocument()
  })
})
