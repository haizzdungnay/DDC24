import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../shared/i18n'
import { ToastProvider } from '../../shared/components/Toast'
import type { Point, UserRole } from '../../shared/types'
import { CommissioningPage } from './CommissioningPage'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  getPoints: vi.fn(),
  runCommissioningTest: vi.fn(),
  forcePoint: vi.fn(),
  refetch: vi.fn()
}))

vi.mock('../../shared/api/client', () => ({
  apiClient: {
    getPoints: mocks.getPoints,
    runCommissioningTest: mocks.runCommissioningTest,
    forcePoint: mocks.forcePoint
  }
}))

let role: UserRole = 'operator'
vi.mock('../auth', () => ({
  useAuth: () => ({ session: { username: 'op', role, loginAt: '2026-08-01T00:00:00Z' }, logout: vi.fn(), login: vi.fn(), isAuthenticated: true, getAuthHeader: () => ({}) })
}))

const basePoint = {
  tag: '',
  quality: 'good' as const,
  source: 'core',
  updatedAt: '2026-08-01T00:00:00Z'
}

let points: Point[] = []
let apiState: { loading: boolean; error: Error | null } = { loading: false, error: null }

vi.mock('../../shared/hooks/useApi', () => ({
  useApi: () => ({ data: apiState.error ? null : points, loading: apiState.loading, error: apiState.error, refetch: mocks.refetch })
}))

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('mkddc-lang', 'en')
  role = 'operator'
  apiState = { loading: false, error: null }
  points = [
    { ...basePoint, id: 'AO-01', tag: 'AO-01', name: 'Heating valve', kind: 'AO', value: 12, unit: '%', forced: false },
    { ...basePoint, id: 'DO-01', tag: 'DO-01', name: 'Supply fan', kind: 'DO', value: false, forced: true }
  ] as Point[]
  mocks.runCommissioningTest.mockResolvedValue({ result: 'passed', pointId: 'AO-01', message: 'ok' })
  mocks.forcePoint.mockResolvedValue(undefined)
  mocks.runCommissioningTest.mockClear()
  mocks.forcePoint.mockClear()
})
afterEach(cleanup)

function renderPage() {
  return render(<MemoryRouter><I18nProvider><ToastProvider><CommissioningPage /></ToastProvider></I18nProvider></MemoryRouter>)
}

/**
 * WEB-UX-004 — trang này ghi thẳng ra cơ cấu chấp hành đang đấu nối.
 *
 * Bản cũ: một cú click `Test` là `runCommissioningTest(point, 50)` — mở van 50%
 * hoặc đóng contactor, không hỏi lại, không chọn được giá trị. Các test dưới đây
 * chặn đúng việc để một lệnh vật lý đi mà không qua xác nhận.
 */
describe('CommissioningPage physical-write safety', () => {
  it('never writes on the first click — a confirmation naming point, value and consequence comes first', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Value to write for AO-01'), '35')
    await user.click(screen.getByRole('button', { name: 'Test AO-01' }))

    expect(mocks.runCommissioningTest).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('AO-01')
    expect(dialog).toHaveTextContent('35%')
    expect(dialog).toHaveTextContent(/valve\/damper\/drive moves/i)

    await user.click(screen.getByRole('button', { name: 'Write value' }))
    /* Đối số thứ ba là thời hạn tự nhả (ISS-PIO-26). Bản trước của phép so này
       chỉ có hai đối số, và vì `toHaveBeenCalledWith` so khớp CHÍNH XÁC cả số
       lượng đối số nên nó đang khoá lại đúng hành vi hỏng: một lệnh ghi ra cơ
       cấu chấp hành không kèm thời hạn nào. Sửa kỳ vọng của test, không nới
       lỏng sản phẩm. */
    await waitFor(() => expect(mocks.runCommissioningTest).toHaveBeenCalledWith('AO-01', 35, 300))
  })

  it('writes nothing when the confirmation is cancelled', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Value to write for AO-01'), '80')
    await user.click(screen.getByRole('button', { name: 'Test AO-01' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(mocks.runCommissioningTest).not.toHaveBeenCalled()
  })

  // Bản cũ gán cứng 50 (AO) / true (DO). Người vận hành phải tự chọn giá trị.
  it('refuses to run without an explicit value instead of falling back to a default', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Test AO-01' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.runCommissioningTest).not.toHaveBeenCalled()
    expect(await screen.findByText(/Enter the value to write/)).toBeInTheDocument()
  })

  it('rejects an AO value outside the 0–100% range', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Value to write for AO-01'), '150')
    await user.click(screen.getByRole('button', { name: 'Test AO-01' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByText(/0–100%/)).toBeInTheDocument()
  })

  /**
   * Nhãn `Release` cũ gọi cùng đường ghi với giá trị 0 — tức là "trả quyền" thực
   * chất đóng van về 0%. Nay phải là `forcePoint(..., release=true)`, và hộp
   * thoại phải nói rõ đây KHÔNG phải ghi 0.
   */
  it('releases the override instead of writing zero', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Return DO-01 to automatic' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/NOT writing zero/i)

    await user.click(within(dialog).getByRole('button', { name: 'To automatic' }))
    await waitFor(() => expect(mocks.forcePoint).toHaveBeenCalledWith('DO-01', false, true))
  })

  it('offers Release All only for points that are actually forced', async () => {
    const user = userEvent.setup()
    renderPage()

    const releaseAll = screen.getByRole('button', { name: /Release all to automatic \(1\)/ })
    await user.click(releaseAll)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('DO-01')
    expect(dialog).not.toHaveTextContent('AO-01')
  })

  it('disables every write control for a viewer', () => {
    role = 'viewer'
    renderPage()

    expect(screen.getByRole('button', { name: 'Test AO-01' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Return DO-01 to automatic' })).toBeDisabled()
    expect(screen.getByText(/Operator or admin role is required/)).toBeInTheDocument()
  })

  // Bản cũ không xử lý `state.error`: API hỏng hiện ra như "không có output nào".
  it('surfaces a load failure instead of rendering an empty output list', () => {
    apiState = { loading: false, error: new Error('core unreachable') }
    renderPage()

    expect(screen.getByText('Could not load outputs')).toBeInTheDocument()
    expect(screen.getByText('core unreachable')).toBeInTheDocument()
  })
})

/**
 * ISS-PIO-26 — mỗi lệnh chạy thử phải mang thời hạn tự nhả.
 *
 * Triệu chứng gốc: `POST /commissioning/points/{id}/test` chỉ nhận `value`, nên
 * mỗi lần chạy thử để lại một output bị ép cho tới khi có người nhớ nhả tay.
 * Chính trang này đã phải dựng điều kiện tiên quyết "Không còn điểm kẹt ép tay
 * từ phiên trước" — hệ thống cảnh báo về hậu quả của chính nó.
 */
describe('CommissioningPage auto-release timeout', () => {
  it('sends the selected timeout with the command', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.selectOptions(screen.getByLabelText('Auto-release timeout for commissioning commands'), '900')
    await user.type(screen.getByLabelText('Value to write for AO-01'), '35')
    await user.click(screen.getByRole('button', { name: 'Test AO-01' }))
    await user.click(screen.getByRole('button', { name: 'Write value' }))

    await waitFor(() => expect(mocks.runCommissioningTest).toHaveBeenCalledWith('AO-01', 35, 900))
  })

  it('names the timeout inside the confirmation, next to the physical consequence', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Value to write for AO-01'), '35')
    await user.click(screen.getByRole('button', { name: 'Test AO-01' }))

    /* Hộp xác nhận nói ĐỦ hậu quả: ghi bao nhiêu VÀ giữ bao lâu. Thiếu vế sau
       thì người vận hành không có đủ thông tin để quyết định có rời khỏi bàn. */
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('5 min')
    expect(dialog).toHaveTextContent(/even if this browser closes/i)
  })

  it('offers no unbounded option — every choice releases by itself', async () => {
    renderPage()
    const select = screen.getByLabelText('Auto-release timeout for commissioning commands') as HTMLSelectElement
    const values = Array.from(select.options).map((option) => Number(option.value))
    expect(values.length).toBeGreaterThan(0)
    for (const seconds of values) {
      expect(seconds).toBeGreaterThan(0)
      expect(seconds).toBeLessThanOrEqual(86400)
    }
  })

  it('says the controller reported no remaining time instead of showing a fake countdown', async () => {
    const user = userEvent.setup()
    // Core nhận lệnh nhưng KHÔNG báo `expiresInS`.
    mocks.runCommissioningTest.mockResolvedValue({ result: 'passed', pointId: 'AO-01', message: 'accepted', ttlS: 300 })
    renderPage()

    await user.type(screen.getByLabelText('Value to write for AO-01'), '35')
    await user.click(screen.getByRole('button', { name: 'Test AO-01' }))
    await user.click(screen.getByRole('button', { name: 'Write value' }))

    await waitFor(() => expect(screen.getByText(/did NOT report a remaining time/i)).toBeInTheDocument())
  })

  it('shows the remaining time the controller actually reported', async () => {
    const user = userEvent.setup()
    mocks.runCommissioningTest.mockResolvedValue({ result: 'passed', pointId: 'AO-01', message: 'accepted', ttlS: 300, expiresInS: 297 })
    renderPage()

    await user.type(screen.getByLabelText('Value to write for AO-01'), '35')
    await user.click(screen.getByRole('button', { name: 'Test AO-01' }))
    await user.click(screen.getByRole('button', { name: 'Write value' }))

    await waitFor(() => expect(screen.getByText(/controller reports 4 min 57s left/i)).toBeInTheDocument())
  })
})
