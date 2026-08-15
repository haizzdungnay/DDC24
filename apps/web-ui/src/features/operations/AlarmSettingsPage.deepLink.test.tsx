import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../shared/components/Toast'
import { I18nProvider } from '../../shared/i18n'
import type { AlarmSetting } from '../../shared/types'
import { AlarmSettingsPage } from './AlarmSettingsPage'

const api = vi.hoisted(() => ({
  getAlarmSettings: vi.fn(),
  getVirtualPoints: vi.fn(),
  putAlarmSettings: vi.fn()
}))

vi.mock('../../shared/api/client', () => ({ apiClient: api }))

function renderAt(search: string) {
  return render(
    <I18nProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/eng/alarm-settings${search}`]}>
          <AlarmSettingsPage />
        </MemoryRouter>
      </ToastProvider>
    </I18nProvider>
  )
}

const existingAlarm: AlarmSetting = {
  id: 'ALM-014',
  label: 'High temp',
  enabled: true,
  alarmType: 1,
  sources: [{ kind: 'UI', channel: 3, pointId: 'UI-03' }],
  priority: 'medium',
  clearMode: 'auto',
  delayS: 0,
  params: { hh: 100, h: 90, l: 10, ll: 0, hysteresis: 0 }
}

/* Plan 55 task 1.6 — deep-link từ trang Inputs (tab "Cảnh báo & Lưu trữ") sang
 * đây qua query param, không phá luồng chọn/tạo alarm thủ công hiện có. */
describe('AlarmSettingsPage — deep link từ Inputs', () => {
  beforeEach(() => {
    localStorage.setItem('mkddc-lang', 'en')
    api.getVirtualPoints.mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('?newSource=UI:5 tạo một alarm mới với source UI kênh 5 điền sẵn', async () => {
    api.getAlarmSettings.mockResolvedValue([])
    renderAt('?newSource=UI:5')

    expect(await screen.findByDisplayValue('UI-05')).toBeInTheDocument()
    expect(screen.getByText('1/64')).toBeInTheDocument()
  })

  it('?edit=ALM-014 chọn sẵn đúng alarm đã có, không tạo thêm alarm mới', async () => {
    api.getAlarmSettings.mockResolvedValue([existingAlarm])
    renderAt('?edit=ALM-014')

    expect(await screen.findByRole('heading', { name: 'ALM-014 - High temp' })).toBeInTheDocument()
    expect(screen.getByText('1/64')).toBeInTheDocument()
  })

  it('không có query param thì hành vi như cũ (chọn dòng đầu tiên)', async () => {
    api.getAlarmSettings.mockResolvedValue([existingAlarm])
    renderAt('')

    expect(await screen.findByRole('heading', { name: 'ALM-014 - High temp' })).toBeInTheDocument()
  })
})
