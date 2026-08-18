import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../shared/components/Toast'
import { I18nProvider } from '../../shared/i18n'
import type { Alarm } from '../../shared/types'
import { AlarmsPage } from './AlarmsPage'

/**
 * Hành vi deep link `?alarm=` — `T57-0.7`, khoá finding `F-UX-02`.
 *
 * `drilldown.contract.test.ts` chỉ chứng minh trang CÓ ĐỌC tham số. Test này
 * chứng minh nó đọc ĐÚNG: lọc về đúng một cảnh báo, và — quan trọng không kém
 * — nói ra khi cảnh báo được trỏ tới đã không còn.
 *
 * Vì sao nhánh "không còn" đáng một test riêng: liên kết này đến từ khối CẦN
 * XỬ LÝ của Landing, nơi dữ liệu có thể cũ vài giây. Người trực bấm vào một
 * cảnh báo vừa tự hết và nhận được một bảng rỗng sẽ không phân biệt được
 * "cảnh báo đã kết thúc" với "trang hỏng" — đúng loại mơ hồ mà cả sản phẩm
 * này cố tránh.
 */

const api = vi.hoisted(() => ({
  getAlarms: vi.fn(),
  getAlarmHistory: vi.fn(),
  getAlarmSettings: vi.fn(),
  ackAlarm: vi.fn(),
  suppressAlarm: vi.fn(),
  returnAlarm: vi.fn()
}))
const state = vi.hoisted(() => ({ alarms: [] as Alarm[] }))

vi.mock('../../shared/api/client', () => ({ apiClient: api }))
vi.mock('../../shared/hooks/useApi', () => ({
  useApi: (loader: unknown) => {
    if (loader === api.getAlarms) return { data: state.alarms, loading: false, error: null, refetch: vi.fn() }
    return { data: [], loading: false, error: null, refetch: vi.fn() }
  }
}))
vi.mock('../auth', async () => {
  const actual = await vi.importActual<typeof import('../auth')>('../auth')
  return {
    ...actual,
    useAuth: () => ({ session: { username: 'admin', role: 'admin', loginAt: '2026-08-01T00:00:00Z' }, login: vi.fn(), logout: vi.fn(), isAuthenticated: true, getAuthHeader: () => ({}) })
  }
})

function alarm(id: string, message: string): Alarm {
  return { id, message, severity: 'high', status: 'unack', active: true, source: 'UI-01', value: '30', detail: '', time: '2026-08-18T03:00:00Z' } as Alarm
}

function renderPage(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <I18nProvider><ToastProvider><AlarmsPage /></ToastProvider></I18nProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  state.alarms = [alarm('ALM-001', 'Nhiệt độ phòng cao'), alarm('ALM-002', 'Mất luồng gió')]
})
afterEach(cleanup)

describe('F-UX-02 — deep link ?alarm= phải lọc thật', () => {
  it('không có tham số thì hiện đủ mọi cảnh báo', () => {
    renderPage('/alarms')
    expect(screen.getByText('Nhiệt độ phòng cao')).toBeInTheDocument()
    expect(screen.getByText('Mất luồng gió')).toBeInTheDocument()
  })

  it('có ?alarm=<id> thì chỉ còn đúng cảnh báo đó', () => {
    renderPage('/alarms?alarm=ALM-002')
    expect(screen.getByText('Mất luồng gió')).toBeInTheDocument()
    expect(
      screen.queryByText('Nhiệt độ phòng cao'),
      'bấm "Xem chi tiết" từ Landing vẫn mở danh sách đầy đủ — đúng triệu chứng F-UX-02'
    ).not.toBeInTheDocument()
  })

  it('nói rõ đang lọc, và cho đường thoát về danh sách đầy đủ', async () => {
    const user = userEvent.setup()
    renderPage('/alarms?alarm=ALM-002')
    expect(screen.getByRole('status')).toHaveTextContent('ALM-002')

    await user.click(screen.getByRole('button', { name: /Xem tất cả cảnh báo|Show all alarms/ }))
    expect(screen.getByText('Nhiệt độ phòng cao')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('cảnh báo được trỏ tới đã hết thì NÓI RA, không để bảng rỗng im lặng', () => {
    renderPage('/alarms?alarm=ALM-404')
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('ALM-404')
    expect(banner.textContent, 'phải phân biệt "cảnh báo đã kết thúc" với "trang hỏng"').toMatch(/Không còn cảnh báo|No active alarm/)
  })
})
