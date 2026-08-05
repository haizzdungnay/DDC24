import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../../../shared/api/client'
import type { ModbusBusInfo, ModbusEventItem, ModbusOverview } from '../../../shared/types'

const NO_DATA = '—'

export function OverviewPage() {
  const navigate = useNavigate()
  const [overview, setOverview] = useState<ModbusOverview | null>(null)
  const [buses, setBuses] = useState<ModbusBusInfo[]>([])
  const [events, setEvents] = useState<ModbusEventItem[]>([])
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>('')
  const [errorStatus, setErrorStatus] = useState('')

  async function loadData() {
    try {
      setErrorStatus('')
      const [ovData, busData, evData] = await Promise.all([
        apiClient.getModbusOverview(),
        apiClient.getModbusBuses(),
        apiClient.getModbusEvents()
      ])
      setOverview(ovData)
      setBuses(busData)
      setEvents(evData)
      setLastRefreshedAt(new Date().toLocaleTimeString())
    } catch (err) {
      setErrorStatus(err instanceof Error ? err.message : 'Không thể tải dữ liệu Modbus Overview')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadData()
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [autoRefresh])

  return (
    <div className="space-y-6">
      {/* Header controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[var(--c-text)]">Modbus RTU · Tổng quan</h2>
          <p className="text-xs text-[var(--c-text-dim)]">
            Giám sát thời gian thực trạng thái 02 cổng RS485 và toàn bộ thiết bị trường Modbus RTU.
            {lastRefreshedAt && ` (Cập nhật lúc ${lastRefreshedAt})`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="h-9 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-xs font-medium text-[var(--c-text)] hover:border-[var(--c-line-strong)]"
            onClick={() => loadData()}
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

      {/* 4 KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4 shadow-sm">
          <div className="text-xs font-medium text-[var(--c-text-dim)]">Tổng Device</div>
          <div className="mt-2 text-3xl font-extrabold text-[var(--c-text)]">
            {loading ? NO_DATA : overview ? overview.total_devices : NO_DATA}
          </div>
        </div>

        <div className="rounded-[var(--radius)] border border-green-500/30 bg-green-500/5 p-4 shadow-sm">
          <div className="text-xs font-medium text-green-600 dark:text-green-400">Online</div>
          <div className="mt-2 text-3xl font-extrabold text-green-600 dark:text-green-400">
            {loading ? NO_DATA : overview ? overview.online : NO_DATA}
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
          <div className="mt-2 text-3xl font-extrabold text-amber-600 dark:text-amber-400">
            {loading ? NO_DATA : overview ? overview.offline : NO_DATA}
          </div>
        </button>

        <div className="rounded-[var(--radius)] border border-red-500/30 bg-red-500/5 p-4 shadow-sm">
          <div className="text-xs font-medium text-red-600 dark:text-red-400">Fault / Config Error</div>
          <div className="mt-2 text-3xl font-extrabold text-red-600 dark:text-red-400">
            {loading ? NO_DATA : overview ? overview.fault_config : NO_DATA}
          </div>
        </div>
      </div>

      {/* 2 Bus Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {buses.length > 0 ? (
          buses.map((bus) => (
            <div key={bus.bus_id} className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--c-border)] pb-3">
                <div>
                  <h3 className="text-base font-bold text-[var(--c-text)]">{bus.display_name}</h3>
                  <p className="text-xs text-[var(--c-text-dim)]">{bus.port} ({bus.port_alias})</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-1 text-xs font-semibold text-green-600 dark:text-green-400">
                    <span className="h-2 w-2 rounded-full bg-green-500"></span>
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
                  <span className="font-semibold text-[var(--c-text)]">{bus.total_devices} ({bus.online_devices} online)</span>
                </div>
                <div>
                  <span className="text-[var(--c-text-dim)]">Lỗi Timeout / CRC:</span>{' '}
                  <span className="font-semibold text-[var(--c-text)]">{bus.timeout_errors} / {bus.crc_errors}</span>
                </div>
                <div>
                  <span className="text-[var(--c-text-dim)]">Poll latency p50:</span>{' '}
                  <span className="font-semibold text-[var(--c-text)]">{bus.poll_latency_p50_ms} ms</span>
                </div>
                <div>
                  <span className="text-[var(--c-text-dim)]">Poll latency p95:</span>{' '}
                  <span className="font-semibold text-[var(--c-text)]">{bus.poll_latency_p95_ms} ms</span>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--c-text-dim)]">Bus utilization (ước tính)</span>
                  <span className="font-semibold text-[var(--c-text)]">{bus.bus_utilization_percent}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--c-surface-2)]">
                  <div
                    className="h-full bg-[var(--c-primary,#2563eb)] transition-all duration-300"
                    style={{ width: `${Math.min(100, bus.bus_utilization_percent)}%` }}
                  />
                </div>
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
            Đang tải dữ liệu RS485 bus cards…
          </div>
        )}
      </div>

      {/* Recent Events table */}
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
                  <tr key={idx} className="border-b border-[var(--c-border)] hover:bg-[var(--c-surface-2)]/50">
                    <td className="py-2.5 font-mono text-[var(--c-text-dim)]">{ev.timestamp}</td>
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
                    Chưa có sự kiện giao tiếp mới.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
