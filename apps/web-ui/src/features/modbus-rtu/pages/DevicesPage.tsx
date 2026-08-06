import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth, roleAtLeast } from '../../auth'
import { apiClient } from '../../../shared/api/client'
import type { ModbusBusInfo, ModbusProbeResult, ModbusRTUDevice, ModbusRTUDiagnostics, ModbusRTUPoint } from '../../../shared/types'
import { Field } from '../components/Field'
import { NO_DATA, READ_ONLY_HINT, buttonClass, describeApiError, deviceLinkLabel, emptyDevice, inputClass } from '../shared'

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
  /* Bộ lọc sống trong URL chứ không phải state cục bộ: KPI card ở Overview điều
   * hướng kèm `?status=OFFLINE`, và nếu bộ lọc chỉ nằm trong state thì deep link
   * đó không hiện lên control — người dùng thấy danh sách bị lọc mà không thấy
   * cái gì đang lọc, cũng không có cách nào bỏ lọc. */
  const [searchParams, setSearchParams] = useSearchParams()
  const [devices, setDevices] = useState<ModbusRTUDevice[]>([])
  const [points, setPoints] = useState<ModbusRTUPoint[]>([])
  const [diagnostics, setDiagnostics] = useState<ModbusRTUDiagnostics[]>([])
  const [buses, setBuses] = useState<ModbusBusInfo[]>([])
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

  const filterStatus = searchParams.get('status') ?? ''
  const filterPort = searchParams.get('port') ?? ''
  const filterText = searchParams.get('q') ?? ''

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  async function reload() {
    const [nextDevices, nextPoints, nextBuses] = await Promise.all([
      apiClient.getModbusDevices(),
      apiClient.getModbusPoints(),
      apiClient.getModbusBuses()
    ])
    setDevices(nextDevices)
    setPoints(nextPoints)
    setBuses(nextBuses)
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
      setStatus(describeApiError(error, 'Không thể lưu thiết bị'))
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
      setStatus(describeApiError(error, 'Không thể xoá'))
    } finally {
      setDeleting(false)
    }
  }

  const diagMap = Object.fromEntries(diagnostics.map((d) => [d.device_id, d]))
  /* Khung truyền hiển thị trong form là của CỔNG đang chọn, không phải giá trị
   * lưu trên thiết bị: sau khi đổi tham số cổng, giá trị cũ trên thiết bị chỉ là
   * dữ liệu chờ được đồng bộ, không phải thứ đang chạy trên dây. */
  const selectedBus = buses.find((bus) => bus.port === device.rs485_port)

  const needle = filterText.trim().toLowerCase()
  const filteredDevices = devices.filter((d) => {
    if (filterPort && d.rs485_port !== filterPort) return false
    if (needle &&
        !d.device_id.toLowerCase().includes(needle) &&
        !d.display_name.toLowerCase().includes(needle) &&
        String(d.slave_id) !== needle) return false
    if (!filterStatus) return true
    const diag = diagMap[d.device_id]
    if (filterStatus === 'OFFLINE') return Boolean(diag && !diag.online && diag.consecutive_errors > 0)
    if (filterStatus === 'ONLINE') return Boolean(diag && diag.online)
    /* "Chưa liên lạc lần nào" phải tách khỏi OFFLINE: chưa từng poll KHÔNG phải
     * mất liên lạc — gộp hai thứ đó lại là nói thiết bị đã hỏng trong khi ta
     * chưa hỏi nó lần nào (D-07). */
    if (filterStatus === 'NEVER') return Boolean(diag && diag.total_polls === 0) || !diag
    return true
  })
  const hasFilter = Boolean(filterStatus || filterPort || filterText)

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--c-text)]">Modbus RTU · Quản lý Thiết bị (Devices)</h2>
          <p className="mt-1 text-xs text-[var(--c-text-dim)]">
            Quản lý vòng đời thiết bị trường Modbus RTU, thông số bus/serial và chu kỳ poll.
          </p>
        </div>
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
          <Field label="Device ID" hint="Bắt đầu bằng chữ, 1–23 ký tự ASCII. Để trống thì hệ thống tự sinh.">
            <input
              className={inputClass}
              aria-label="Device ID"
              placeholder="tự sinh nếu trống"
              value={device.device_id}
              disabled={editingDevice}
              onChange={(e) => setDevice({ ...device, device_id: e.target.value })}
            />
          </Field>
          <Field label="Tên thiết bị" hint="Tên hiển thị cho người vận hành, tối đa 64 ký tự.">
            <input
              required
              className={inputClass}
              aria-label="Tên thiết bị"
              placeholder="VD: Đồng hồ điện tầng 1"
              value={device.display_name}
              onChange={(e) => setDevice({ ...device, display_name: e.target.value })}
            />
          </Field>
          <Field label="Cổng RS-485" hint="Sợi dây vật lý mà thiết bị đấu vào. Khung truyền kế thừa từ cổng này.">
            <select
              className={inputClass}
              aria-label="RS485 port"
              value={device.rs485_port}
              onChange={(e) => setDevice({ ...device, rs485_port: e.target.value })}
            >
              <option value="/dev/rs485-1">RS485-1 (/dev/rs485-1)</option>
              <option value="/dev/rs485-2">RS485-2 (/dev/rs485-2)</option>
            </select>
          </Field>
          {/* OD-MBRTU-002 (CLOSED): tham số serial thuộc về DÂY, không thuộc
              thiết bị. Bản trước có ô nhập baud/parity/stop ở đây — tức mô hình
              dữ liệu nói một đằng còn giao diện mời người dùng nhập một nẻo, rồi
              từ chối sau khi họ bấm lưu. Nay chỉ hiển thị giá trị kế thừa và chỉ
              đường tới nơi sửa được. */}
          <div
            data-testid="device-serial-inherited"
            className="flex h-10 items-center rounded-[var(--radius)] border border-dashed border-[var(--c-border)] px-3 text-sm text-[var(--c-text-muted)] sm:col-span-3"
          >
            {selectedBus
              ? `Khung truyền kế thừa từ ${selectedBus.display_name || selectedBus.bus_id}: ${selectedBus.baud} ${selectedBus.parity}${selectedBus.data_bits}${selectedBus.stop_bits}`
              : 'Khung truyền kế thừa từ cổng đã chọn'}
            {' · '}
            <Link className="ml-1 underline" to="/eng/modbus-rtu/ports">
              Sửa ở trang Cổng RS-485
            </Link>
          </div>
          <Field label="Slave ID" hint="Địa chỉ Modbus của thiết bị trên dây, 1–247. Chỉ cần duy nhất TRONG CÙNG một cổng.">
            <input
              required
              type="number"
              min={1}
              max={247}
              className={inputClass}
              aria-label="Slave ID"
              value={device.slave_id}
              onChange={(e) => setDevice({ ...device, slave_id: Number(e.target.value) })}
            />
          </Field>
          <Field label="Chu kỳ poll (ms)" hint="Bao lâu đọc thiết bị một lần khi nó đang online.">
            <input
              required
              type="number"
              className={inputClass}
              aria-label="Poll ms"
              value={device.poll_ms}
              onChange={(e) => setDevice({ ...device, poll_ms: Number(e.target.value) })}
            />
          </Field>
          <Field label="Timeout (ms)" hint="Thời gian chờ MỖI LẦN PHÁT, không phải mỗi lượt poll.">
            <input
              required
              type="number"
              className={inputClass}
              aria-label="Timeout ms"
              value={device.timeout_ms}
              onChange={(e) => setDevice({ ...device, timeout_ms: Number(e.target.value) })}
            />
          </Field>
          <Field
            label="Số lần phát lại"
            hint="Phát lại một giao dịch Modbus bị lỗi bao nhiêu lần trong CÙNG một lượt poll (0–5). Đây KHÔNG phải ngưỡng chuyển Offline. 0 là hợp lệ: báo lỗi ngay, không phát lại."
          >
            <input
              required
              type="number"
              min={0}
              max={5}
              className={inputClass}
              aria-label="Số lần phát lại"
              value={device.retry}
              onChange={(e) => setDevice({ ...device, retry: Number(e.target.value) })}
            />
          </Field>
          <Field
            label="Lỗi liên tiếp ⇒ Offline"
            hint="Bao nhiêu LƯỢT POLL hỏng liên tiếp thì coi thiết bị là Offline (1–10, mặc định 2). Mỗi lượt đã bao gồm đủ số lần phát lại ở trên."
          >
            <input
              required
              type="number"
              min={1}
              max={10}
              className={inputClass}
              aria-label="Lỗi chuyển Offline"
              value={device.offline_after_errors ?? 2}
              onChange={(e) => setDevice({ ...device, offline_after_errors: Number(e.target.value) })}
            />
          </Field>
          {/* `offline_probe_ms` KHÔNG còn ở đây. Nó là thuộc tính của BUS (D-04:
              chu kỳ dò lại bảo vệ băng thông của SỢI DÂY, không của một thiết
              bị), và backend chưa bao giờ có trường đó trên Device — ô nhập cũ
              là ô MA: người dùng gõ vào rồi giá trị bị bỏ lặng lẽ, còn bảng bên
              dưới thì luôn hiện "10000ms" vì đó là mặc định viết cứng ở FE, không
              phải số máy chủ trả về. Sửa ở trang Cổng RS-485. */}
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
      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4 shadow-sm space-y-3">
        {/* Bộ lọc. Trước đây chỉ lọc được bằng cách điều hướng kèm `?status=` từ
            KPI card Overview — tức người dùng đứng ở trang này không có cách nào
            lọc, và khi bị lọc rồi cũng không có cách nào bỏ. */}
        <div
          data-testid="device-filters"
          className="flex flex-wrap items-end gap-3 border-b border-[var(--c-border)] pb-3"
        >
          <Field label="Tìm" className="min-w-[200px] flex-1">
            <input
              className={inputClass}
              type="search"
              aria-label="Tìm thiết bị"
              placeholder="ID, tên hoặc slave ID"
              value={filterText}
              onChange={(e) => setFilter('q', e.target.value)}
            />
          </Field>
          <Field label="Cổng">
            <select
              className={inputClass}
              aria-label="Lọc theo cổng"
              value={filterPort}
              onChange={(e) => setFilter('port', e.target.value)}
            >
              <option value="">Tất cả cổng</option>
              <option value="/dev/rs485-1">RS485-1</option>
              <option value="/dev/rs485-2">RS485-2</option>
            </select>
          </Field>
          <Field label="Liên lạc">
            <select
              className={inputClass}
              aria-label="Lọc theo trạng thái"
              value={filterStatus}
              onChange={(e) => setFilter('status', e.target.value)}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="ONLINE">Đang liên lạc</option>
              <option value="OFFLINE">Mất liên lạc</option>
              <option value="NEVER">Chưa liên lạc lần nào</option>
            </select>
          </Field>
          <div className="flex items-center gap-3 pb-0.5">
            <span className="text-xs text-[var(--c-text-dim)]" data-testid="device-count">
              {hasFilter
                ? `${filteredDevices.length}/${devices.length} thiết bị`
                : `${devices.length} thiết bị`}
            </span>
            {hasFilter && (
              <button
                type="button"
                className={buttonClass}
                onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}
              >
                Bỏ lọc
              </button>
            )}
          </div>
        </div>
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
                      {row.rs485_port} · {row.baud} {row.parity}8{row.stop_bits}
                    </td>
                    <td className="py-3 text-xs font-mono">{row.slave_id}</td>
                    <td className="py-3 text-xs font-mono">
                      {row.poll_ms}ms / {row.timeout_ms}ms / {row.retry}x
                    </td>
                    {/* `probe` thuộc về BUS, không phải thiết bị. Bản trước hiện
                        `row.offline_probe_ms ?? 10000` — mà backend không có
                        trường đó trên Device, nên cột này LUÔN hiện 10000ms bất
                        kể cấu hình thật. Nay lấy đúng từ cổng, và hiện "—" khi
                        chưa đọc được cổng thay vì bịa một con số. */}
                    <td className="py-3 text-xs text-[var(--c-text-dim)]">
                      errs: {row.offline_after_errors ?? 2} / probe:{' '}
                      {buses.find((bus) => bus.port === row.rs485_port)?.offline_probe_ms
                        ? `${buses.find((bus) => bus.port === row.rs485_port)?.offline_probe_ms}ms`
                        : NO_DATA}
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
