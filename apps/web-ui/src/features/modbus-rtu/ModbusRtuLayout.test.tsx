import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserRole } from '../../shared/types'
import { ModbusRtuLayout } from './ModbusRtuLayout'
import { DevicesPage } from './pages/DevicesPage'
import { DiagnosticsPage } from './pages/DiagnosticsPage'
import { OverviewPage } from './pages/OverviewPage'
import { PointsPage } from './pages/PointsPage'

const api = vi.hoisted(() => ({
  getModbusDevices: vi.fn(), getModbusPoints: vi.fn(), getModbusDiagnostics: vi.fn(),
  getModbusOverview: vi.fn(), getModbusBuses: vi.fn(), getModbusEvents: vi.fn(),
  getPoints: vi.fn()
}))

vi.mock('../../shared/api/client', () => ({ apiClient: api }))

const auth = vi.hoisted(() => ({ role: 'admin' as UserRole }))
vi.mock('../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth')>()
  return {
    ...actual,
    useAuth: () => ({
      session: { username: 'u', role: auth.role, loginAt: '2026-08-05T00:00:00Z' },
      login: vi.fn(), logout: vi.fn(), isAuthenticated: true, getAuthHeader: () => ({})
    })
  }
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/eng/modbus-rtu" element={<ModbusRtuLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="devices" element={<DevicesPage />} />
          <Route path="points" element={<PointsPage />} />
          <Route path="diagnostics" element={<DiagnosticsPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

/* Bộ test này bịt đúng khoảng trống đã làm lọt FE-MB-01/02/04 (review FE
 * 2026-08-05): hai test cũ render THẲNG `<ModbusRtuPage />` và `<OverviewPage />`,
 * không đi qua layout + `<Outlet />`, nên H1 lặp và ba tab trùng nội dung đều vô
 * hình với suite dù 306/306 pass. Mọi kiểm tra ở đây phải đi qua router. */
describe('ModbusRtuLayout + outlet', () => {
  beforeEach(() => {
    auth.role = 'admin'
    api.getModbusDevices.mockResolvedValue([])
    api.getModbusPoints.mockResolvedValue([])
    api.getModbusDiagnostics.mockResolvedValue([])
    api.getModbusOverview.mockResolvedValue({ total_devices: 0, online: 0, offline: 0, fault_config: 0, revision: 1, checksum: 'abc' })
    api.getModbusBuses.mockResolvedValue([])
    api.getModbusEvents.mockResolvedValue([])
    api.getPoints.mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  /* FE-MB-02: layout và page con từng cùng render `<h1>`, nên ba tab hiện hai
   * tiêu đề chồng nhau. Page con chỉ được dùng `<h2>` trở xuống. */
  it.each(['/eng/modbus-rtu', '/eng/modbus-rtu/devices', '/eng/modbus-rtu/points', '/eng/modbus-rtu/diagnostics'])(
    'chỉ có đúng một <h1> tại %s',
    async (path) => {
      renderAt(path)
      const headings = await screen.findAllByRole('heading', { level: 1 })
      expect(headings).toHaveLength(1)
      expect(headings[0]).toHaveTextContent('Modbus RTU Management')
    }
  )

  /* FE-MB-01: ba route từng cùng trỏ về `ModbusRtuPage`, nên bấm tab thì giao
   * diện đứng yên. Mỗi tab phải có tiêu đề mục riêng. */
  it.each([
    ['/eng/modbus-rtu', 'Modbus RTU · Tổng quan'],
    ['/eng/modbus-rtu/overview', 'Modbus RTU · Tổng quan'],
    ['/eng/modbus-rtu/devices', 'Modbus RTU · Quản lý Thiết bị (Devices)'],
    ['/eng/modbus-rtu/points', 'Modbus RTU · Quản lý Point'],
    ['/eng/modbus-rtu/diagnostics', 'Modbus RTU · Diagnostics']
  ])('%s render đúng nội dung riêng của tab', async (path, heading) => {
    renderAt(path)
    expect(await screen.findByRole('heading', { level: 2, name: heading })).toBeInTheDocument()
  })

  /* `/eng/modbus-rtu/overview` cùng render OverviewPage nên phải làm sáng tab
   * Tổng quan; bản trước chỉ so bằng đúng `/eng/modbus-rtu` nên không tab nào
   * active khi mở đường `/overview`. */
  it.each([
    ['/eng/modbus-rtu', 'Tổng quan'],
    ['/eng/modbus-rtu/overview', 'Tổng quan'],
    ['/eng/modbus-rtu/devices', 'Thiết bị'],
    ['/eng/modbus-rtu/points', 'Points'],
    ['/eng/modbus-rtu/diagnostics', 'Diagnostics']
  ])('%s đánh dấu đúng một tab đang mở', async (path, label) => {
    renderAt(path)
    const current = await screen.findAllByRole('link', { current: 'page' })
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent(label)
  })

  /* Đ-04: cảnh báo chỉ-đọc đặt một lần ở layout, bốn page con không lặp lại. */
  it('viewer thấy đúng một cảnh báo chế độ chỉ xem', async () => {
    auth.role = 'viewer'
    renderAt('/eng/modbus-rtu/devices')
    const notes = await screen.findAllByRole('note')
    expect(notes).toHaveLength(1)
    expect(notes[0]).toHaveTextContent('Chế độ chỉ xem')
  })
})
