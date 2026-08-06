import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import type { NetworkData, Point } from '../types'
import { ControllerDiagram } from './ControllerDiagram'

/* `IS_DEMO` được tính một lần lúc import từ `import.meta.env.VITE_DDC_MODE`, mà
 * mặc định trong test là `demo`. Phải mock cả module để kiểm được nhánh live —
 * chính nhánh đã sinh ra FE-DIAG-01. */
const mode = vi.hoisted(() => ({ isDemo: false }))
vi.mock('../config', () => ({
  get IS_DEMO() { return mode.isDemo },
  get DDC_MODE() { return mode.isDemo ? 'demo' : 'live' },
  LEGACY_GRAPH_DEMO_ENABLED: false,
  isLegacyGraphDemoEnabled: () => false,
  API_ORIGIN: '',
  WS_ORIGIN: '',
  AUTH_MODE: 'mock',
  HISTORIAN_V2_TRENDS_ENABLED: false,
  DEVICE_DEFAULTS: { model: 'DDC24', name: 'MK-DDC-24', ip: '', bacnetDeviceId: '', firmware: '', serial: '' }
}))

const livePoint: Point = {
  id: 'UI-01', tag: 'UI-01', name: 'Room temp', kind: 'UI', value: 23.4, unit: 'degC',
  quality: 'good', source: 'core', updatedAt: '2026-08-06T02:00:00Z'
}

const liveNetwork: NetworkData = {
  northbound: {
    deviceName: 'DDC-24-TANG-1', ip: '192.168.1.110', dhcp: false, wifiEnabled: false,
    subnet: '255.255.255.0', gateway: '192.168.1.1', bacnetDeviceId: '1001',
    bacnetDeviceName: 'DDC-24-TANG-1', bacnetPort: 47808, bmsLink: 'online',
    activeBacnetPort: 47808, firmware: '0.1.0-be-b6c', serial: 'SN-1'
  },
  southbound: []
}

function renderDiagram(props: Partial<Parameters<typeof ControllerDiagram>[0]> = {}) {
  return render(
    <I18nProvider>
      <ControllerDiagram points={[]} {...props} />
    </I18nProvider>
  )
}

/* FE-DIAG-01 (board thật DDC-24-TANG-1, 2026-08-06).
 *
 * `displayPoints = points.length ? points : getDemoPoints()` và
 * `const network = getDemoNetwork()` (không điều kiện) làm Dashboard trên board
 * vẽ "29 I/O | 5 Modbus | 2 WARN", "UI 16 | AO 4 | DO 4" và BACnet 192.168.1.100
 * trong khi `/points` trả rỗng và thiết bị thật ở 192.168.1.110. Cùng lúc trang
 * Giám sát báo 0 point — hai trang nói hai chuyện khác nhau, và trang sai lại là
 * trang trông thuyết phục hơn. */
describe('ControllerDiagram — không được bịa dữ liệu ở chế độ live', () => {
  beforeEach(() => {
    mode.isDemo = false
    localStorage.setItem('mkddc-lang', 'en')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('không mượn point của simulator khi authority trả rỗng', () => {
    renderDiagram({ points: [] })
    expect(screen.getByText(/returned no I\/O points/i)).toBeInTheDocument()
    expect(screen.getByText(/^0 I\/O/)).toBeInTheDocument()
    /* Số đo chất lượng phải là "—": không có point thì không thể khẳng định
     * "0 FAULT" — đó là một tuyên bố về sức khoẻ thiết bị. */
    expect(screen.getByText(/— WARN \| — FAULT/)).toBeInTheDocument()
  })

  it('không mượn danh sách slave Modbus của simulator khi chưa có /network', () => {
    renderDiagram({ points: [livePoint] })
    expect(screen.getByText(/— Modbus/)).toBeInTheDocument()
    expect(screen.getByText(/BACnet — \| ID —/)).toBeInTheDocument()
  })

  it('dùng đúng dữ liệu mạng từ authority khi được truyền vào', () => {
    renderDiagram({ points: [livePoint], network: liveNetwork })
    expect(screen.getByText(/BACnet 192\.168\.1\.110 \| ID 1001/)).toBeInTheDocument()
    expect(screen.getByText(/0 Modbus/)).toBeInTheDocument()
    expect(screen.queryByText(/192\.168\.1\.100/)).not.toBeInTheDocument()
  })

  it('có point thật thì không hiện cảnh báo thiếu dữ liệu', () => {
    renderDiagram({ points: [livePoint], network: liveNetwork })
    expect(screen.queryByText(/returned no I\/O points/i)).not.toBeInTheDocument()
    expect(screen.getByText(/^1 I\/O/)).toBeInTheDocument()
  })

  /* Bản demo vẫn phải dùng được: simulator là nguồn hợp lệ ở đúng build demo. */
  it('bản demo vẫn dựng sơ đồ từ simulator', () => {
    mode.isDemo = true
    renderDiagram({ points: [] })
    expect(screen.queryByText(/returned no I\/O points/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^0 I\/O/)).not.toBeInTheDocument()
  })
})
