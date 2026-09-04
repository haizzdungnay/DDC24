import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../shared/components/Toast'
import { I18nProvider } from '../../shared/i18n'
import type { AiInputConfig, Point } from '../../shared/types'
import { aiConditioningDefaults } from '../../shared/types'
import type { CapabilityMode, SystemCapabilities } from '../../shared/api/capabilities'
import { InputsPage } from './InputsPage'

/* `ISS-PIO-13`: dropdown mode và trần kênh phải đến TỪ BO, không từ hằng viết
 * cứng trong FE. Bộ test này lái đúng hai đường đó qua `/system/capabilities`. */

const api = vi.hoisted(() => ({
  getAiInputs: vi.fn(),
  putAiInputs: vi.fn(),
  updatePointName: vi.fn(),
  getPoints: vi.fn(),
  getVirtualPoints: vi.fn(),
  getAlarmSettings: vi.fn()
}))
const hookState = vi.hoisted(() => ({ points: [] as Point[], virtualPoints: [] as unknown[], alarms: [] as unknown[] }))
const capabilityState = vi.hoisted(() => ({ doc: null as unknown, fail: false }))

vi.mock('../../shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/api/client')>()
  return { ...actual, apiClient: api }
})
vi.mock('../../shared/api/capabilities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/api/capabilities')>()
  return {
    ...actual,
    fetchSystemCapabilities: vi.fn(async () => {
      if (capabilityState.fail) throw new Error('iobus offline')
      return capabilityState.doc as SystemCapabilities
    })
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
  ...aiConditioningDefaults(),
  channel: 1,
  tag: 'UI-01',
  label: 'Supply Temp',
  signalType: 1,
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

function capabilityDoc(uiModes: CapabilityMode[]): SystemCapabilities {
  return {
    board_cap_known: true,
    board_cap_map: '0x000D',
    blocks: [
      {
        kind: 'UI',
        presence: 'yes',
        count: 1,
        abi_capacity: 16,
        optional: false,
        channels: [{ id: 'UI-01', index: 1, modes: uiModes }]
      },
      { kind: 'DI', presence: 'no', count: 0, abi_capacity: 8, optional: true, channels: [] },
      { kind: 'AO', presence: 'yes', count: 4, abi_capacity: 4, optional: false, channels: [] },
      { kind: 'DO', presence: 'yes', count: 4, abi_capacity: 4, optional: false, channels: [] }
    ]
  }
}

const modes: CapabilityMode[] = [
  { id: 'none', availability: 'confirmed' },
  { id: '0-10V', availability: 'confirmed' },
  { id: '2-10V', availability: 'confirmed' },
  { id: '4-20mA', availability: 'confirmed' },
  { id: 'PT100', availability: 'withheld', reason: 'bo không gắn mạch nhiệt trở' },
  { id: 'PT1000', availability: 'withheld', reason: 'bo không gắn mạch nhiệt trở' },
  { id: 'NTC10k', availability: 'unverified', reason: 'không có bit năng lực cho mode này' },
  { id: 'NTC20k', availability: 'unverified', reason: 'không có bit năng lực cho mode này' },
  { id: 'dry', availability: 'confirmed' },
  { id: 'potentiometer', availability: 'withheld', reason: 'bo không có mạch biến trở' },
  { id: 'light', availability: 'withheld', reason: 'bo không có mạch cảm biến ánh sáng' },
  { id: 'pulse', availability: 'withheld', reason: 'bo không có mạch đếm xung' }
]

function renderPage() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={['/eng/inputs']}>
          <Routes>
            <Route path="/eng/inputs" element={<InputsPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </I18nProvider>
  )
}

describe('InputsPage dựng dropdown mode từ capability', () => {
  beforeEach(() => {
    localStorage.setItem('mkddc-lang', 'en')
    capabilityState.fail = false
    capabilityState.doc = capabilityDoc(modes)
    api.getAiInputs.mockResolvedValue([{ ...baseInput }])
    api.putAiInputs.mockResolvedValue(undefined)
    hookState.points = []
    hookState.alarms = []
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  // Đề bài §6.1: dropdown chỉ hiện mode phần cứng THẬT SỰ hỗ trợ. Trước
  // `ISS-PIO-13`, cả 8 nhóm luôn hiện cho mọi kênh, kể cả ánh sáng và xung vốn
  // phụ thuộc mạch.
  it('giấu mode bo nói không có và giữ mode bo xác nhận', async () => {
    renderPage()

    expect(await screen.findByRole('radio', { name: 'Voltage 0-10V' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Dry contact' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Light/motion' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Pulse counting' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Potentiometer' })).not.toBeInTheDocument()
  })

  // `resistance` gộp PT100/PT1000 (bị giữ lại) với NTC (chưa xác nhận được).
  // Nhóm vẫn chọn được nhờ NTC, nhưng phải mang nhãn nói rõ là chưa xác nhận —
  // im lặng ở đây là ngầm khẳng định phần cứng hỗ trợ.
  it('mode chưa xác nhận vẫn hiện nhưng mang nhãn cảnh báo', async () => {
    renderPage()

    const resistance = await screen.findByRole('radio', { name: 'Resistance' })
    expect(resistance).toBeInTheDocument()
    expect(resistance).toHaveAccessibleDescription('unverified')
    // Tên trợ năng KHÔNG được đổi theo trạng thái năng lực: nhãn là mô tả.
    expect(screen.getByRole('radio', { name: 'Voltage 0-10V' })).not.toHaveAccessibleDescription()
  })

  // Mất mạng KHÔNG được biến thành "phần cứng không hỗ trợ". Giấu hết mode chỉ
  // vì một lần gọi hỏng sẽ khoá cứng trang cấu hình, trong khi đường ghi phía
  // backend vẫn chặn đúng chỗ cần chặn.
  it('không đọc được capability thì vẫn hiện đủ mode, mọi mode ở mức chưa xác nhận', async () => {
    capabilityState.fail = true
    renderPage()

    expect(await screen.findByRole('radio', { name: 'Light/motion' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Voltage 0-10V' })).toHaveAccessibleDescription('unverified')
  })

  // Ngoại lệ có chủ ý: mode ĐANG lưu trên kênh vẫn phải hiện dù bị giữ lại.
  // Giấu nó đi làm nút radio không khớp cấu hình thật — người vận hành thấy một
  // kênh "không chọn gì" trong khi nó đang chạy một mode cụ thể.
  it('vẫn hiện mode đang được lưu ngay cả khi bo không xác nhận', async () => {
    api.getAiInputs.mockResolvedValue([{ ...baseInput, signalType: 8 }])
    renderPage()

    const pulse = await screen.findByRole('radio', { name: 'Pulse counting' })
    expect(pulse).toBeChecked()
    expect(pulse).toHaveAccessibleDescription('not confirmed by board')
  })
})
