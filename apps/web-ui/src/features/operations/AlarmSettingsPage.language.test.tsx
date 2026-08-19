import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../shared/components/Toast'
import { I18nProvider } from '../../shared/i18n'
import type { AlarmSetting } from '../../shared/types'
import { AlarmSettingsPage } from './AlarmSettingsPage'

/**
 * `T57-2.14` — form cấu hình cảnh báo **không nói hai thứ tiếng cùng lúc**.
 *
 * VÌ SAO KHOÁ BẰNG TEST
 *
 * Trang này trước đây trộn "Chế độ clear", "Delay (s)", "Severity rules",
 * "Runtime hours" vào giữa các nhãn tiếng Việt. Đây là màn hình đặt **ngưỡng
 * an toàn**: người vận hành đọc nhầm một trường là đặt sai một ngưỡng, và cái
 * giá không nằm ở giao diện mà ở thiết bị. Nhãn nửa Việt nửa Anh còn buộc họ
 * dịch nhẩm đúng lúc không được phép đoán.
 *
 * Sửa một lần thì dễ; giữ được mới khó — mỗi trường thêm sau này đều có thể
 * mang tiếng Anh vào lại. Test này bắt đúng thời điểm đó.
 *
 * NGOẠI LỆ CÓ CHỦ ĐÍCH — kiểm ở test cuối:
 *  · **Tên riêng trong chuẩn giao thức** (`BACnet`, `Notification Class`,
 *    `Event Enrollment`): dịch ra thì không tra được tài liệu ASHRAE.
 *  · **Từ vựng trạng thái viết hoa** (`HIGH`, `CRITICAL`, `HH/H/L/LL`):
 *    `UX-SYSTEM-001` §1.5 buộc Web, nhật ký và HMI tại tủ dùng chung một chữ.
 *  Cả hai đều phải có chú giải tiếng Việt đi kèm — giữ nguyên chữ **và** nói ra
 *  nghĩa, chứ không phải để trần.
 */

const api = vi.hoisted(() => ({
  getAlarmSettings: vi.fn(),
  getVirtualPoints: vi.fn(),
  putAlarmSettings: vi.fn()
}))

vi.mock('../../shared/api/client', () => ({ apiClient: api }))

const analogAlarm: AlarmSetting = {
  id: 'ALM-014',
  label: 'Nhiệt độ gió cấp cao',
  enabled: true,
  alarmType: 1,
  sources: [{ kind: 'UI', channel: 3, pointId: 'UI-03' }],
  priority: 'flexible',
  clearMode: 'auto',
  delayS: 5,
  params: { hh: 100, h: 90, l: 10, ll: 0, hysteresis: 1, severityRules: [{ severity: 'high', op: '>=', value: 95 }] }
}

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

describe('T57-2.14 — ngôn ngữ nhãn trên trang Cấu hình cảnh báo', () => {
  beforeEach(() => {
    localStorage.setItem('mkddc-lang', 'vi')
    api.getVirtualPoints.mockResolvedValue([])
    api.getAlarmSettings.mockResolvedValue([analogAlarm])
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('không còn nhãn tiếng Anh trần nào trong form khi đang chọn tiếng Việt', async () => {
    renderPage()
    await screen.findByRole('heading', { name: /ALM-014/ })

    /* Đúng những chuỗi đã có trên trang trước `T57-2.14`. Test này đỏ nghĩa là
       một nhãn tiếng Anh vừa quay lại, không phải nghĩa là chuỗi bị đổi tên. */
    for (const englishLabel of ['Chế độ clear', 'Delay (s)', 'Severity rules', 'Runtime hours', 'Operator', 'Kind', 'Thêm rule', 'Hysteresis']) {
      expect(screen.queryByText(englishLabel), `"${englishLabel}" là nhãn tiếng Anh trần trong form tiếng Việt`).toBeNull()
    }
  })

  it('mỗi trường đã đổi đều có nhãn tiếng Việt thật, không phải chỉ bị xoá đi', async () => {
    renderPage()
    await screen.findByRole('heading', { name: /ALM-014/ })

    for (const vietnameseLabel of ['Cách xoá cảnh báo', 'Trễ kích hoạt (giây)', 'Luật chọn mức nghiêm trọng', 'Mức nghiêm trọng', 'Phép so sánh', 'Ngưỡng', 'Vùng trễ (hysteresis)', 'Loại nguồn']) {
      expect(screen.getByText(vietnameseLabel)).toBeInTheDocument()
    }
  })

  it('ngưỡng HH/H/L/LL giữ chữ viết tắt dùng chung nhưng nói ra nghĩa', async () => {
    renderPage()
    await screen.findByRole('heading', { name: /ALM-014/ })

    expect(screen.getByText('Rất cao (HH)')).toBeInTheDocument()
    expect(screen.getByText('Cao (H)')).toBeInTheDocument()
    expect(screen.getByText('Thấp (L)')).toBeInTheDocument()
    expect(screen.getByText('Rất thấp (LL)')).toBeInTheDocument()
  })

  it('mã trạng thái viết hoa giữ nguyên để trùng với nhật ký và HMI, kèm chú giải', async () => {
    renderPage()
    await screen.findByRole('heading', { name: /ALM-014/ })

    /* `HIGH` xuất hiện ở CẢ hai ô — mức ưu tiên của cảnh báo và mức nghiêm
       trọng của luật — và cả hai đều phải giữ nguyên chữ, vì cả hai đều xuất
       hiện lại nguyên văn trong nhật ký. */
    const highOptions = screen.getAllByRole('option', { name: /^HIGH/ })
    expect(highOptions.length, 'mức ưu tiên và mức nghiêm trọng đều dùng chữ HIGH').toBeGreaterThanOrEqual(2)
    for (const option of highOptions) {
      expect(option.textContent, 'mã viết hoa phải đi kèm chú giải, không để trần').toMatch(/HIGH · .+/)
    }
    expect(highOptions.some((option) => option.textContent?.includes('cao'))).toBe(true)
  })

  it('thuật ngữ BACnet giữ nguyên nhưng có chú giải tiếng Việt ngay dưới nhãn', async () => {
    renderPage()
    await screen.findByRole('heading', { name: /ALM-014/ })

    expect(screen.getByText('Notification Class')).toBeInTheDocument()
    expect(screen.getByText(/Lớp thông báo BACnet \(1-4\)/)).toBeInTheDocument()
    expect(screen.getByText(/Công bố lên BACnet \(Event Enrollment\)/)).toBeInTheDocument()
  })
})
