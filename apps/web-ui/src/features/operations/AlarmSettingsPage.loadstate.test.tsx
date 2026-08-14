import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../shared/components/Toast'
import { I18nProvider } from '../../shared/i18n'
import { AlarmSettingsPage } from './AlarmSettingsPage'

const api = vi.hoisted(() => ({
  getAlarmSettings: vi.fn(),
  getVirtualPoints: vi.fn(),
  putAlarmSettings: vi.fn()
}))

vi.mock('../../shared/api/client', () => ({ apiClient: api }))

function renderPage() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={['/eng/alarm-settings']}>
          <AlarmSettingsPage />
        </MemoryRouter>
      </ToastProvider>
    </I18nProvider>
  )
}

/* FE-DATA-02 (review FE 2026-08-05): `loadError` đã tồn tại nhưng chỉ hiện thành
 * một badge "LOAD ERROR" nằm dưới đáy panel trạng thái, còn danh sách alarm thì
 * hiện "No data". Người đọc trang từ trên xuống kết luận thiết bị không có alarm
 * nào — kết luận nguy hiểm nhất có thể rút ra từ một trang cấu hình cảnh báo. */
describe('AlarmSettingsPage — authority không trả lời', () => {
  beforeEach(() => {
    localStorage.setItem('mkddc-lang', 'en')
    api.getVirtualPoints.mockResolvedValue([])
    api.getAlarmSettings.mockRejectedValue(new Error('502 Bad Gateway'))
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('báo lỗi kèm Retry thay vì danh sách alarm rỗng', async () => {
    renderPage()
    expect(await screen.findByText('Could not load alarm settings')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    expect(screen.queryByText('Alarm entities')).not.toBeInTheDocument()
  })

  it('Retry gọi lại API và trả về trang bình thường khi authority sống lại', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Could not load alarm settings')
    api.getAlarmSettings.mockResolvedValue([])
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByText('Alarm entities')).toBeInTheDocument()
  })
})
