import { useEffect, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth, roleAtLeast } from '../../auth'
import { apiClient } from '../../../shared/api/client'
import type { ModbusProbeResult, ModbusRTUDevice, ModbusRTUDiagnostics, ModbusRTUPoint } from '../../../shared/types'
import { READ_ONLY_HINT, buttonClass, deviceLinkLabel, emptyDevice, inputClass } from '../shared'

type PendingDelete = { id: string; label: string; extra?: number }

/**
 * Tab "Thiết bị" của Modbus RTU — MBR-B301.
 *
 * Trang này đã tồn tại từ trước nhưng KHÔNG được export và KHÔNG có route, nên
 * route `devices` rơi về `ModbusRtuPage` monolith và deep link
 * `?status=OFFLINE` từ KPI card Overview không có tác dụng — FE-MB-04/FE-MB-05
 * trong `docs/07_records/reviews/FE_PAGES_ERROR_REVIEW_2026-08-05.md`.
 *
 * Không render `<h1>` và không tự thêm padding — cả hai thuộc `ModbusRtuLayout`.
 */
export function DevicesPage() {
  const location = useLocation()
  const [devices, setDevices] = useState<ModbusRTUDevice[]>([])
  const [points, setPoints] = useState<ModbusRTUPoint[]>([])
  const [diagnostics, setDiagnostics] = useState<ModbusRTUDiagnostics[]>([])
  const [device, setDevice] = useState<ModbusRTUDevice>(emptyDevice)
  const [editingDevice, setEditingDevice] = useState(false)
  const [status, setStatus] = useState('')
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [deleting, setDeleting] = useState(false)
  /* MBR-B307/B208: kiểm tra kết nối là lệnh CHẠM DÂY thật, không phải một phép
   * suy diễn từ telemetry cũ. Kết quả giữ riêng từng thiết bị để kỹ thuật viên
   * so được "vừa thử xong" với "trạng thái poll định kỳ". */
  const [telemetryError, setTelemetryError] = useState('')
  const [probing, setProbing] = useState<string | null>(null)
  const [probeResults, setProbeResults] = useState<Record<string, ModbusProbeResult>>({})

  async function testConnection(deviceId: string) {
    setProbing(deviceId)
    try {
      const result = await apiClient.testModbusConnection(deviceId)
      setProbeResults((current) => ({ ...current, [deviceId]: result }))
    } catch (error) {
      setProbeResults((current) => ({
        ...current,
        [deviceId]: {
          result: 'fail',
          reason: error instanceof Error ? error.message : 'không gọi được commissioning'
        }
      }))
    } finally {
      setProbing(null)
    }
  }

  const { session } = useAuth()
  const canEdit = roleAtLeast(session?.role, 'admin')
  /* Đ-04: chạm thiết bị hiện trường là quyền Operator trở lên; đổi cấu hình vẫn
   * là Admin. Hai quyền khác nhau vì hai hậu quả khác nhau. */
  const canCommission = roleAtLeast(session?.role, 'operator')
  const readOnlyHint = canEdit ? undefined : READ_ONLY_HINT

  const queryParams = new URLSearchParams(location.search)
  const filterStatus = queryParams.get('status')

  async function reload() {
    const [nextDevices, nextPoints] = await Promise.all([
      apiClient.getModbusDevices(),
      apiClient.getModbusPoints()
    ])
    setDevices(nextDevices)
    setPoints(nextPoints)
    /* D-07: mất telemetry KHÔNG được nuốt im lặng. Bản trước `catch {}` rồi để
     * cột "Liên lạc" hiện "—" mà không nói vì sao — người vận hành không phân
     * biệt được "thiết bị im" với "không đọc được authority". */
    try {
      setDiagnostics(await apiClient.getModbusDiagnostics())
      setTelemetryError('')
    } catch (error) {
      setDiagnostics([])
      setTelemetryError(error instanceof Error ? error.message : 'không đọc được telemetry')
    }
  }

  useEffect(() => {
    reload().catch((error: Error) => setStatus(error.message))
  }, [])

  async function saveDevice(event: FormEvent) {
    event.preventDefault()
    setStatus('Đang áp dụng cấu hình thiết bị…')
    try {
      if (editingDevice) await apiClient.updateModbusDevice(device)
      else await apiClient.createModbusDevice(device)
      setDevice(emptyDevice)
      setEditingDevice(false)
      await reload()
      setStatus('Đã áp dụng Device Manager vào iobus.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Không thể lưu thiết bị')
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await apiClient.deleteModbusDevice(pendingDelete.id)
      setPendingDelete(null)
      await reload()
      setStatus(`Đã xoá ${pendingDelete.label}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Không thể xoá')
    } finally {
      setDeleting(false)
    }
  }

  const diagMap = Object.fromEntries(diagnostics.map((d) => [d.device_id, d]))

  const filteredDevices = filterStatus
    ? devices.filter((d) => {
        const diag = diagMap[d.device_id]
        if (filterStatus === 'OFFLINE') return diag && !diag.online && diag.consecutive_errors > 0
        if (filterStatus === 'ONLINE') return diag && diag.online
        return true
      })
    : devices

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--c-text)]">Modbus RTU · Quản lý Thiết bị (Devices)</h2>
          <p className="mt-1 text-xs text-[var(--c-text-dim)]">
            Quản lý vòng đời thiết bị trường Modbus RTU, thông số bus/serial và chu kỳ poll.
          </p>
        </div>
        {filterStatus && (
          <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
            Đang lọc: {filterStatus}
          </span>
        )}
      </header>

      {status && (
        <div role="status" className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm">
          {status}
        </div>
      )}

      {telemetryError && (
        <div role="note" data-testid="telemetry-warning"
          className="rounded-[var(--radius)] border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-[var(--c-text)]">
          Cột “Liên lạc” hiện “—” vì không đọc được telemetry: {telemetryError}. Đó là
          <strong> chưa biết</strong>, không phải thiết bị đang offline.
        </div>
      )}

      {/* Device Form */}
      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4 shadow-sm space-y-3">
        <h3 className="text-base font-semibold text-[var(--c-text)]">
          {editingDevice ? `Sửa thiết bị: ${device.display_name} (${device.device_id})` : 'Thêm thiết bị mới'}
        </h3>
        <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6" onSubmit={saveDevice}>
          <input
            className={inputClass}
            aria-label="Device ID"
            placeholder="Device ID (tự sinh nếu trống)"
            value={device.device_id}
            disabled={editingDevice}
            onChange={(e) => setDevice({ ...device, device_id: e.target.value })}
          />
          <input
            required
            className={inputClass}
            aria-label="Tên thiết bị"
            placeholder="Tên thiết bị"
            value={device.display_name}
            onChange={(e) => setDevice({ ...device, display_name: e.target.value })}
          />
          <select
            className={inputClass}
            aria-label="RS485 port"
            value={device.rs485_port}
            onChange={(e) => setDevice({ ...device, rs485_port: e.target.value })}
          >
            <option value="/dev/rs485-1">RS485-1 (/dev/rs485-1)</option>
            <option value="/dev/rs485-2">RS485-2 (/dev/rs485-2)</option>
          </select>
          <input
            required
            type="number"
            className={inputClass}
            aria-label="Baud"
            value={device.baud}
            onChange={(e) => setDevice({ ...device, baud: Number(e.target.value) })}
          />
          <select
            className={inputClass}
            aria-label="Parity"
            value={device.parity}
            onChange={(e) => setDevice({ ...device, parity: e.target.value as ModbusRTUDevice['parity'] })}
          >
            <option>N</option>
            <option>E</option>
            <option>O</option>
          </select>
          <select
            className={inputClass}
            aria-label="Stop bit"
            value={device.stop_bit}
            onChange={(e) => setDevice({ ...device, stop_bit: Number(e.target.value) as 1 | 2 })}
          >
            <option value={1}>1 stop bit</option>
            <option value={2}>2 stop bit</option>
          </select>
          <input
            required
            type="number"
            min={1}
            max={247}
            className={inputClass}
            aria-label="Slave ID"
            placeholder="Slave ID (1-247)"
            value={device.slave_id}
            onChange={(e) => setDevice({ ...device, slave_id: Number(e.target.value) })}
          />
          <input
            required
            type="number"
            className={inputClass}
            aria-label="Poll ms"
            placeholder="Poll ms"
            value={device.poll_ms}
            onChange={(e) => setDevice({ ...device, poll_ms: Number(e.target.value) })}
          />
          <input
            required
            type="number"
            className={inputClass}
            aria-label="Timeout ms"
            placeholder="Timeout ms"
            value={device.timeout_ms}
            onChange={(e) => setDevice({ ...device, timeout_ms: Number(e.target.value) })}
          />
          <input
            required
            type="number"
            min={0}
            max={5}
            className={inputClass}
            aria-label="Số lần phát lại"
            title="Số lần phát lại một giao dịch Modbus bị lỗi trước khi tính là lượt đọc thất bại."
            placeholder="Phát lại (0–5)"
            value={device.retry}
            onChange={(e) => setDevice({ ...device, retry: Number(e.target.value) })}
          />
          <input
            required
            type="number"
            min={1}
            max={10}
            className={inputClass}
            aria-label="Lỗi chuyển Offline"
            title="Số lượt lỗi liên tiếp để chuyển thiết bị sang trạng thái Offline (1–10, mặc định 2)."
            placeholder="Offline sau lỗi (1-10)"
            value={device.offline_after_errors ?? 2}
            onChange={(e) => setDevice({ ...device, offline_after_errors: Number(e.target.value) })}
          />
          <input
            required
            type="number"
            min={1000}
            max={60000}
            className={inputClass}
            aria-label="Chu kỳ thử lại Offline ms"
            title="Chu kỳ thăm dò thiết bị khi đang Offline (1000–60000 ms, mặc định 10000 ms)."
            placeholder="Probe Offline ms"
            value={device.offline_probe_ms ?? 10000}
            onChange={(e) => setDevice({ ...device, offline_probe_ms: Number(e.target.value) })}
          />
          <label className="flex h-10 items-center gap-2 text-xs font-semibold text-[var(--c-text)] sm:col-span-2">
            <input
              type="checkbox"
              checked={device.enabled}
              onChange={(e) => setDevice({ ...device, enabled: e.target.checked })}
            />
            Kích hoạt (Enabled)
          </label>
          <div className="flex gap-2 sm:col-span-4 justify-end">
            <button className={buttonClass} type="submit" disabled={!canEdit} title={readOnlyHint}>
              {editingDevice ? 'Cập nhật thiết bị' : 'Thêm thiết bị mới'}
            </button>
            {editingDevice && (
              <button
                className={buttonClass}
                type="button"
                onClick={() => {
                  setDevice(emptyDevice)
                  setEditingDevice(false)
                }}
              >
                Huỷ
              </button>
            )}
          </div>
        </form>
      </section>

      {/* Devices List Table */}
      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--c-border)] text-xs text-[var(--c-text-dim)]">
                <th className="py-2">ID</th>
                <th className="py-2">Tên hiển thị</th>
                <th className="py-2">RS485 Port</th>
                <th className="py-2">Slave</th>
                <th className="py-2">Poll / Timeout / Phát lại</th>
                <th className="py-2">Offline Params</th>
                <th className="py-2">Liên lạc</th>
                <th className="py-2">Thử kết nối</th>
                <th className="py-2">Trạng thái</th>
                <th className="py-2 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filteredDevices.map((row) => {
                const diag = diagMap[row.device_id]
                return (
                  <tr key={row.device_id} className="border-b border-[var(--c-border)] hover:bg-[var(--c-surface-2)]/40">
                    <td className="py-3 font-mono text-xs font-bold text-[var(--c-text)]">{row.device_id}</td>
                    <td className="py-3 font-semibold text-[var(--c-text)]">{row.display_name}</td>
                    <td className="py-3 text-xs text-[var(--c-text-dim)]">
                      {row.rs485_port} · {row.baud} {row.parity}8{row.stop_bit}
                    </td>
                    <td className="py-3 text-xs font-mono">{row.slave_id}</td>
                    <td className="py-3 text-xs font-mono">
                      {row.poll_ms}ms / {row.timeout_ms}ms / {row.retry}x
                    </td>
                    <td className="py-3 text-xs text-[var(--c-text-dim)]">
                      errs: {row.offline_after_errors ?? 2} / probe: {row.offline_probe_ms ?? 10000}ms
                    </td>
                    <td className="py-3 text-xs">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          diag?.online
                            ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${diag?.online ? 'bg-green-500' : 'bg-amber-500'}`}
                        />
                        {deviceLinkLabel(diag)}
                      </span>
                    </td>
                    <td className="py-3 text-xs">
                      <button
                        className={buttonClass + ' text-xs h-8 px-3'}
                        type="button"
                        disabled={!canCommission || probing === row.device_id}
                        title={canCommission ? undefined : 'Cần vai trò Operator hoặc Admin để chạm thiết bị'}
                        onClick={() => void testConnection(row.device_id)}
                      >
                        {probing === row.device_id ? 'Đang thử…' : 'Thử kết nối'}
                      </button>
                      {probeResults[row.device_id] && (
                        <div className="mt-1 text-[11px]" data-testid={`probe-${row.device_id}`}>
                          {probeResults[row.device_id].result === 'ok'
                            ? `Trả lời sau ${probeResults[row.device_id].elapsed_us ?? '—'} µs`
                            : `Không trả lời: ${probeResults[row.device_id].reason ?? '—'}`}
                        </div>
                      )}
                    </td>
                    <td className="py-3 text-xs">
                      {row.enabled ? (
                        <span className="text-green-600 font-medium">Enabled</span>
                      ) : (
                        <span className="text-slate-400 font-medium">Disabled</span>
                      )}
                    </td>
                    <td className="py-3 text-right space-x-2">
                      <button
                        className={buttonClass + ' text-xs h-8 px-3'}
                        disabled={!canEdit}
                        title={readOnlyHint}
                        onClick={() => {
                          setDevice(row)
                          setEditingDevice(true)
                        }}
                      >
                        Sửa
                      </button>
                      <button
                        className={buttonClass + ' text-xs h-8 px-3 text-red-600 dark:text-red-400'}
                        disabled={!canEdit}
                        title={readOnlyHint}
                        onClick={() =>
                          setPendingDelete({
                            id: row.device_id,
                            label: `${row.display_name} (${row.device_id})`,
                            extra: points.filter((p) => p.device_id === row.device_id).length
                          })
                        }
                      >
                        Xoá
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filteredDevices.length === 0 && (
            <p className="mt-4 text-center text-xs text-[var(--c-text-dim)]">Chưa có thiết bị Modbus RTU nào.</p>
          )}
        </div>
      </section>

      {/* Delete confirmation modal */}
      {pendingDelete && (
        <div role="dialog" aria-modal="true" aria-labelledby="mb-dev-del" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-5 shadow-lg space-y-3">
            <h3 id="mb-dev-del" className="text-lg font-semibold text-[var(--c-text)]">
              Xoá thiết bị Modbus RTU?
            </h3>
            <p className="text-sm text-[var(--c-text)]">{pendingDelete.label}</p>
            {(pendingDelete.extra ?? 0) > 0 && (
              <p className="text-xs text-red-600 font-medium">
                Thiết bị này hiện còn {pendingDelete.extra} Modbus Point. Hãy xoá các Point trước.
              </p>
            )}
            <p className="text-xs text-[var(--c-text-dim)]">
              Cấu hình mới sẽ được cập nhật và tái khởi động iobus ngay lập tức.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button className={buttonClass} type="button" onClick={() => setPendingDelete(null)} disabled={deleting}>
                Huỷ
              </button>
              <button className={buttonClass + ' bg-red-600 text-white hover:bg-red-700'} type="button" onClick={confirmDelete} disabled={deleting}>
                {deleting ? 'Đang xoá…' : 'Xoá'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
