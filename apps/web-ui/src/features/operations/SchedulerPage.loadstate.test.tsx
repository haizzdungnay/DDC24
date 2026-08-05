import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../shared/components/Toast'
import { I18nProvider } from '../../shared/i18n'
import { SchedulerPage } from './SchedulerPage'

const api = vi.hoisted(() => ({
  getSchedules: vi.fn(),
  getVirtualPoints: vi.fn(),
  putSchedules: vi.fn()
}))

vi.mock('../../shared/api/client', () => ({ apiClient: api }))

function renderPage() {
  return render(<I18nProvider><ToastProvider><SchedulerPage /></ToastProvider></I18nProvider>)
}

/* FE-DATA-02 (review FE 2026-08-05): khi `/schedules` trả 502, trang này từng
 * render tiêu đề + bảng rỗng kèm nhãn "No data", nên không phân biệt được "chưa
 * có lịch nào" với "không đọc được lịch" — trên một DDC, hai điều đó dẫn tới hai
 * hành động vận hành hoàn toàn khác nhau. */
describe('SchedulerPage — authority không trả lời', () => {
  beforeEach(() => {
    localStorage.setItem('mkddc-lang', 'en')
    api.getVirtualPoints.mockResolvedValue([])
    api.getSchedules.mockRejectedValue(new Error('502 Bad Gateway'))
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('báo lỗi kèm Retry thay vì bảng lịch rỗng', async () => {
    renderPage()
    expect(await screen.findByText('Could not load schedules')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    expect(screen.queryByText('Schedules')).not.toBeInTheDocument()
  })

  it('Retry gọi lại API và trả về trang bình thường khi authority sống lại', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Could not load schedules')
    api.getSchedules.mockResolvedValue([])
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByText('Schedules')).toBeInTheDocument()
  })
})
