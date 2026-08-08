import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../../../shared/api/client'
import type { ModbusBusInfo, ModbusEventItem, ModbusOverview, ModbusRTUDevice, ModbusRTUDiagnostics, ModbusRTUPoint } from '../../../shared/types'
import { HierarchyTree } from '../components/HierarchyTree'

const NO_DATA = '—'

/**
 * MBR-B305 — Landing page.
 *
 * Nguyên tắc xuyên suốt trang này: **không ô nào hiển thị trạng thái không do
 * server cấp** (D-07). Bản trước lấy p50/p95/utilization từ hằng số viết cứng
 * trong handler Go và hai dòng sự kiện mẫu, nên màn hình trông y hệt nhau dù có
 * hay không có thiết bị nào được đấu. Nay thiếu số liệu là hiện "—".
 */

/** Định dạng số có thể vắng. `null`/`undefined` ⇒ "—", KHÔNG phải 0. */
function orDash(value: number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined) return NO_DATA
  return `${value}${suffix}`
}

function formatLocalTime(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return parsed.toLocaleTimeString()
}

export function OverviewPage() {
  const navigate = useNavigate()
  const [overview, setOverview] = useState<ModbusOverview | null>(null)
  const [buses, setBuses] = useState<ModbusBusInfo[]>([])
  const [events, setEvents] = useState<ModbusEventItem[]>([])
  const [devices, setDevices] = useState<ModbusRTUDevice[]>([])
  const [points, setPoints] = useState<ModbusRTUPoint[]>([])
  const [diagnostics, setDiagnostics] = useState<ModbusRTUDiagnostics[]>([])
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>('')
  const [errorStatus, setErrorStatus] = useState('')

  async function loadData() {
    try {
      setErrorStatus('')
      /* PA3-505: cây Bus→Device→Point cần cả bốn nguồn. Chẩn đoán có thể vắng
         khi iobus chưa publish telemetry — khi đó cây hiện `unknown` cho device
         chứ KHÔNG hiện offline, nên lỗi đọc telemetry không được làm hỏng cả
         trang. */
      const [ovData, busData, evData, deviceData, pointData] = await Promise.all([
        apiClient.getModbusOverview(),
        apiClient.getModbusBuses(),
        apiClient.getModbusEvents(),
        apiClient.getModbusDevices(),
        apiClient.getModbusPoints()
      ])
      setOverview(ovData)
      setBuses(busData)
      setEvents(evData)
      setDevices(deviceData)
      setPoints(pointData)
      try {
        setDiagnostics(await apiClient.getModbusDiagnostics())
      } catch {
        setDiagnostics([])
      }
      setLastRefreshedAt(new Date().toLocaleTimeString())
    } catch (err) {
      setErrorStatus(err instanceof Error ? err.message : 'Không tải được dữ liệu Modbus Overview')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void loadData()
    }, 5000)
    return () => clearInterval(interval)
  }, [autoRefresh])

  const telemetryMissing = overview !== null && !overview.telemetry_available

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[var(--c-text)]">Modbus RTU · Tổng quan</h2>
          <p className="text-xs text-[var(--c-text-dim)]">
            Giám sát trạng thái các cổng RS485 và thiết bị trường Modbus RTU.
            {lastRefreshedAt && ` (Cập nhật lúc ${lastRefreshedAt})`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="h-9 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-xs font-medium text-[var(--c-text)] hover:border-[var(--c-line-strong)]"
            onClick={() => void loadData()}
          >
            Làm mới
          </button>
          <button
            type="button"
            className={`h-9 rounded-[var(--radius)] border px-3 text-xs font-medium ${
              autoRefresh
                ? 'border-[var(--c-primary,#2563eb)] bg-[var(--c-primary,#2563eb)]/10 text-[var(--c-primary,#2563eb)]'
                : 'border-[var(--c-border)] bg-[var(--c-surface-2)] text-[var(--c-text-dim)]'
            }`}
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            Tự động ⟳ 5s {autoRefresh ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {errorStatus && (
        <div role="alert" className="rounded-[var(--radius)] border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          ⚠️ {errorStatus}
        </div>
      )}

      {telemetryMissing && (
        <div role="note" data-testid="telemetry-missing"
          className="rounded-[var(--radius)] border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-[var(--c-text)]">
          iobus chưa publish telemetry lần nào. Các số đo runtime bên dưới hiện “{NO_DATA}” —
          đó là <strong>chưa biết</strong>, không phải bằng 0.
        </div>
      )}

      {/* 4 KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4 shadow-sm">
          <div className="text-xs font-medium text-[var(--c-text-dim)]">Tổng Device</div>
          <div className="mt-2 text-3xl font-extrabold text-[var(--c-text)]" data-testid="kpi-total">
            {loading || !overview ? NO_DATA : overview.total_devices}
          </div>
        </div>

        <div className="rounded-[var(--radius)] border border-green-500/30 bg-green-500/5 p-4 shadow-sm">
          <div className="text-xs font-medium text-green-600 dark:text-green-400">Online</div>
          <div className="mt-2 text-3xl font-extrabold text-green-600 dark:text-green-400" data-testid="kpi-online">
            {loading || !overview || !overview.telemetry_available ? NO_DATA : overview.online}
          </div>
        </div>

        <button
          type="button"
          className="text-left rounded-[var(--radius)] border border-amber-500/30 bg-amber-500/5 p-4 shadow-sm hover:border-amber-500/60 transition-colors"
          onClick={() => navigate('/eng/modbus-rtu/devices?status=OFFLINE')}
        >
          <div className="text-xs font-medium text-amber-600 dark:text-amber-400 flex items-center justify-between">
            <span>Offline</span>
            <span className="text-[10px] underline">Xem danh sách →</span>
          </div>
          <div className="mt-2 text-3xl font-extrabold text-amber-600 dark:text-amber-400" data-testid="kpi-offline">
            {loading || !overview || !overview.telemetry_available ? NO_DATA : overview.offline}
          </div>
          {overview && overview.telemetry_available && (overview.initializing ?? 0) > 0 && (
            <div className="mt-1 text-[10px] text-[var(--c-text-dim)]">
              + {overview.initializing} thiết bị chưa từng liên lạc (chưa khởi tạo)
            </div>
          )}
        </button>

        <div className="rounded-[var(--radius)] border border-red-500/30 bg-red-500/5 p-4 shadow-sm">
          <div className="text-xs font-medium text-red-600 dark:text-red-400">Lỗi cấu hình</div>
          <div className="mt-2 text-3xl font-extrabold text-red-600 dark:text-red-400" data-testid="kpi-fault">
            {loading || !overview ? NO_DATA : overview.fault_config}
          </div>
        </div>
      </div>

      {/* Bus cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {buses.length > 0 ? (
          buses.map((bus) => (
            <div key={bus.bus_id} data-testid={`bus-card-${bus.bus_id}`}
              className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--c-border)] pb-3">
                <div>
                  <h3 className="text-base font-bold text-[var(--c-text)]">{bus.display_name}</h3>
                  <p className="text-xs text-[var(--c-text-dim)]">
                    {bus.port}{bus.port_alias ? ` (${bus.port_alias})` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    data-testid={`bus-state-${bus.bus_id}`}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      bus.open_state === 'RUNNING'
                        ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                        : bus.open_state === 'UNKNOWN'
                          ? 'bg-[var(--c-surface-2)] text-[var(--c-text-dim)]'
                          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {bus.open_state}
                  </span>
                  <span className="text-xs font-mono text-[var(--c-text-dim)]">
                    {bus.baud} {bus.data_bits}{bus.parity}{bus.stop_bits}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-[var(--c-text-dim)]">Số thiết bị:</span>{' '}
                  <span className="font-semibold text-[var(--c-text)]">
                    {bus.total_devices} ({bus.online_devices} online)
                  </span>
                </div>
                <div>
                  <span className="text-[var(--c-text-dim)]">Lỗi Timeout / CRC:</span>{' '}
                  <span className="font-semibold text-[var(--c-text)]">
                    {bus.timeout_errors} / {bus.crc_errors}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--c-text-dim)]">Poll latency p50:</span>{' '}
                  <span className="font-semibold text-[var(--c-text)]" data-testid={`p50-${bus.bus_id}`}>
                    {orDash(bus.poll_latency_p50_ms, ' ms')}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--c-text-dim)]">Poll latency p95:</span>{' '}
                  <span className="font-semibold text-[var(--c-text)]" data-testid={`p95-${bus.bus_id}`}>
                    {orDash(bus.poll_latency_p95_ms, ' ms')}
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--c-text-dim)]">Chiếm dây (đo thật)</span>
                  <span className="font-semibold text-[var(--c-text)]" data-testid={`util-${bus.bus_id}`}>
                    {bus.bus_utilization_percent === null || bus.bus_utilization_percent === undefined
                      ? NO_DATA
                      : `${bus.bus_utilization_percent.toFixed(1)}%`}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--c-surface-2)]">
                  <div
                    className="h-full bg-[var(--c-primary,#2563eb)] transition-all duration-300"
                    style={{ width: `${Math.min(100, bus.bus_utilization_percent ?? 0)}%` }}
                  />
                </div>
                {bus.estimated_load_percent !== undefined && (
                  <div className="text-[10px] text-[var(--c-text-dim)]">
                    Ước lượng theo cấu hình: {bus.estimated_load_percent.toFixed(1)}%
                    {' '}(khác số đo thật ở trên)
                  </div>
                )}
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  className="w-full h-9 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] text-xs font-semibold text-[var(--c-text)] hover:border-[var(--c-line-strong)]"
                  onClick={() => navigate('/eng/modbus-rtu/devices')}
                >
                  Xem thiết bị trên bus này →
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-6 text-center text-xs text-[var(--c-text-dim)]">
            {loading ? 'Đang tải dữ liệu bus RS485…' : 'Chưa có bus RS485 nào được cấu hình.'}
          </div>
        )}
      </div>

      {/* Sự kiện quan sát được */}
      <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4 shadow-sm">
        <div className="flex items-center justify-between border-b border-[var(--c-border)] pb-3">
          <h3 className="text-base font-bold text-[var(--c-text)]">Sự kiện giao tiếp gần đây</h3>
          <button
            type="button"
            className="text-xs text-[var(--c-primary,#2563eb)] hover:underline"
            onClick={() => navigate('/eng/modbus-rtu/diagnostics')}
          >
            Xem tất cả diagnostics →
          </button>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--c-border)] text-[var(--c-text-dim)]">
                <th className="py-2">Thời gian</th>
                <th className="py-2">Bus</th>
                <th className="py-2">Device ID</th>
                <th className="py-2">Sự kiện</th>
              </tr>
            </thead>
            <tbody>
              {events.length > 0 ? (
                events.map((ev, idx) => (
                  <tr key={`${ev.timestamp}-${ev.device_id}-${idx}`} className="border-b border-[var(--c-border)] hover:bg-[var(--c-surface-2)]/50">
                    <td className="py-2.5 font-mono text-[var(--c-text-dim)]">{formatLocalTime(ev.timestamp)}</td>
                    <td className="py-2.5 font-semibold text-[var(--c-text)]">{ev.bus_id}</td>
                    <td className="py-2.5 text-[var(--c-text)]">{ev.device_id}</td>
                    <td className="py-2.5">
                      <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${
                        ev.level === 'warning'
                          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                      }`}>
                        {ev.message}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-[var(--c-text-dim)]">
                    Chưa quan sát được lần chuyển trạng thái nào.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* PA3-505 / UX-DES §14 — cây phân cấp Bus → Device → Point.
          Sáu tab phẳng của workspace đều đúng về nội dung nhưng không tab nào
          trả lời được câu hỏi cấu trúc mà kỹ thuật viên hỏi khi đứng trước tủ:
          sợi dây này có những thiết bị nào, thiết bị kia đọc thanh ghi nào. */}
      <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[var(--c-text)]">Cấu trúc Bus → Thiết bị → Point</h3>
          <span className="text-xs text-[var(--c-text-dim)]">
            Tham số serial (baud/parity/stop bits) thuộc bus, không thuộc thiết bị.
          </span>
        </div>
        <HierarchyTree
          buses={buses}
          devices={devices}
          points={points}
          diagnostics={diagnostics}
          telemetryAvailable={Boolean(overview?.telemetry_available)}
        />
      </div>
    </div>
  )
}
