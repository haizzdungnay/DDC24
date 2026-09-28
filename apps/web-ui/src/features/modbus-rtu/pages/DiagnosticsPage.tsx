import { useEffect, useState } from 'react'
import { FrameMonitor } from '../components/FrameMonitor'
import { apiClient } from '../../../shared/api/client'
import { useI18n } from '../../../shared/i18n'
import type { ModbusRTUDevice, ModbusRTUDiagnostics } from '../../../shared/types'
import { NO_DATA, buttonClass, deviceLinkLabel } from '../shared'

const REFRESH_MS = 5000

/**
 * Tab "Diagnostics" của Modbus RTU — MBR-B301.
 *
 * Tách khỏi `ModbusRtuPage` monolith; trước đây route `diagnostics` render lại
 * toàn bộ Device Manager + Point Manager nên tab này không khác gì hai tab kia
 * (FE-MB-01 trong `docs/07_records/reviews/FE_PAGES_ERROR_REVIEW_2026-08-05.md`).
 *
 * Không render `<h1>` và không tự thêm padding — cả hai thuộc `ModbusRtuLayout`.
 */
export function DiagnosticsPage() {
  const { lang, pick } = useI18n()
  const [diagnostics, setDiagnostics] = useState<ModbusRTUDiagnostics[]>([])
  const [devices, setDevices] = useState<ModbusRTUDevice[]>([])
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastRefreshedAt, setLastRefreshedAt] = useState('')
  /* D-07: phải phân biệt "chưa có telemetry" với "không đọc được telemetry".
   * Gộp hai trường hợp thành bảng rỗng là cách nhanh nhất để người vận hành
   * tưởng bus đang im lặng trong khi thật ra authority đã chết. */
  const [errorStatus, setErrorStatus] = useState('')

  async function loadData() {
    try {
      const [nextDiagnostics, nextDevices] = await Promise.all([
        apiClient.getModbusDiagnostics(),
        apiClient.getModbusDevices()
      ])
      setDiagnostics(nextDiagnostics)
      setDevices(nextDevices)
      setErrorStatus('')
      setLastRefreshedAt(new Date().toLocaleTimeString())
    } catch (error) {
      setErrorStatus(error instanceof Error ? error.message : pick('Không đọc được diagnostics Modbus RTU', 'Could not read Modbus RTU diagnostics'))
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void loadData()
    }, REFRESH_MS)
    return () => clearInterval(interval)
  }, [autoRefresh])

  const deviceNames = Object.fromEntries(devices.map((row) => [row.device_id, row.display_name]))

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[var(--c-text)]">Modbus RTU · Diagnostics</h2>
          <p className="mt-1 text-xs text-[var(--c-text-dim)]">
            {pick(
              'Bộ đếm CRC / timeout / phát lại theo từng slave, lấy trực tiếp từ telemetry iobus.',
              'CRC / timeout / retry counters per slave, read directly from iobus telemetry.'
            )}
            {lastRefreshedAt && ` (${pick('Cập nhật lúc', 'Updated at')} ${lastRefreshedAt})`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={buttonClass + ' h-9 text-xs'} onClick={() => void loadData()}>{pick('Làm mới', 'Refresh')}</button>
          <button
            type="button"
            className={`h-9 rounded-[var(--radius)] border px-3 text-xs font-medium ${
              autoRefresh
                ? 'border-[var(--c-primary,#2563eb)] bg-[var(--c-primary,#2563eb)]/10 text-[var(--c-primary,#2563eb)]'
                : 'border-[var(--c-border)] bg-[var(--c-surface-2)] text-[var(--c-text-dim)]'
            }`}
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {pick('Tự động', 'Auto')} ⟳ 5s {autoRefresh ? 'ON' : 'OFF'}
          </button>
        </div>
      </header>

      {errorStatus && (
        <div role="alert" className="rounded-[var(--radius)] border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          ⚠️ {pick('Không đọc được diagnostics', 'Could not read diagnostics')}: {errorStatus}
        </div>
      )}

      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4">
        <h3 className="text-base font-semibold text-[var(--c-text)]">CRC / timeout / retry diagnostics</h3>
        <NeverPolledWarning rows={diagnostics} deviceNames={deviceNames} />

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--c-border)] text-xs text-[var(--c-text-dim)]">
                <th className="py-2">{pick('Thiết bị', 'Device')}</th>
                <th className="py-2">Bus / Slave</th>
                <th className="py-2">{pick('Liên lạc', 'Communication')}</th>
                <th className="py-2">{pick('Poll / lỗi', 'Poll / errors')}</th>
                <th className="py-2">Timeout</th>
                <th className="py-2">CRC</th>
                <th className="py-2" title={pick('Số lần PHÁT LẠI thật một giao dịch lỗi — khác hẳn cột Lỗi', 'Actual RETRY count for a failed transaction — distinct from the Errors column')}>{pick('Phát lại', 'Retries')}</th>
                <th className="py-2" title={pick('Lệnh ghi thất bại ở một lần phát (còn có thể thử lại)', 'A write that failed on one transmission (may still be retried)')}>{pick('Ghi lỗi', 'Write errors')}</th>
                <th className="py-2" title={pick('Lệnh ghi bị BỎ HẲN: hết lượt thử, quá hạn, hoặc giá trị không encode được', 'A write that was DROPPED entirely: retries exhausted, timed out, or the value could not be encoded')}>{pick('Ghi bị bỏ', 'Writes dropped')}</th>
                <th className="py-2" title={pick('Mã exception Modbus gần nhất do slave trả về (0x01..0x0B)', 'The most recent Modbus exception code returned by the slave (0x01..0x0B)')}>Exception</th>
                <th className="py-2">{pick('Lỗi liên tiếp', 'Consecutive errors')}</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.map((row) => (
                <tr key={row.slave_id} className="border-t border-[var(--c-border)]">
                  <td className="py-3 text-[var(--c-text)]">{deviceNames[row.device_id] ?? row.device_id ?? NO_DATA}</td>
                  <td className="py-3 font-mono text-xs">{row.bus_id ?? NO_DATA} / {row.slave_id}</td>
                  <td className="py-3 text-xs">{deviceLinkLabel(row, lang)}</td>
                  <td className="py-3 font-mono text-xs">{row.total_polls} / {row.total_errors}</td>
                  <td className="py-3 font-mono text-xs">{row.timeout_errors}</td>
                  <td className="py-3 font-mono text-xs">{row.crc_errors}</td>
                  <td className="py-3 font-mono text-xs">{row.retry_attempts}</td>
                  {/* MBR-B309: trường chưa có trong telemetry hiện "—", KHÔNG
                      hiện 0. "Chưa biết" và "bằng 0" là hai kết luận khác nhau
                      về thiết bị hiện trường. */}
                  <td className="py-3 font-mono text-xs" data-testid={`write-failed-${row.slave_id}`}>
                    {row.write_failed ?? NO_DATA}
                  </td>
                  <td className="py-3 font-mono text-xs" data-testid={`write-dropped-${row.slave_id}`}>
                    {row.write_dropped ?? NO_DATA}
                  </td>
                  <td className="py-3 font-mono text-xs" data-testid={`exception-${row.slave_id}`}>
                    {row.last_exception === undefined
                      ? NO_DATA
                      : row.last_exception === 0
                        ? '—'
                        : `0x${row.last_exception.toString(16).padStart(2, '0')}`}
                  </td>
                  <td className="py-3 font-mono text-xs">{row.consecutive_errors}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {diagnostics.length === 0 && !errorStatus && (
          <p className="mt-3 text-sm text-[var(--c-text-dim)]">{pick('Chưa có telemetry Modbus RTU từ iobus.', 'No Modbus RTU telemetry from iobus yet.')}</p>
        )}
      </section>

      {/* `T57-3.9`: bộ đếm ở trên nói CÓ BAO NHIÊU lỗi; bảng dưới nói lỗi xảy
          ra Ở ĐÂU và LÚC NÀO — hai câu hỏi khác nhau, và câu thứ hai trước nay
          phải trả lời bằng máy phân tích bus cắm song song.

          Từ `af1a7ef0` (2026-08-19) tới bản sửa U-18 (2026-09-27), khối này nằm
          NHẦM bên trong `NeverPolledWarning` — thành phần `return null` khi mọi
          thiết bị đã được poll. Hệ quả: trên một bus khoẻ, tức đúng lúc người ta
          cần soi lệnh ghi, Frame Monitor không hề hiện; nó chỉ lộ ra khi có
          thiết bị chưa từng được poll. Test của trang giờ khoá vị trí này. */}
      <FrameMonitor />
    </div>
  )
}

/**
 * Cảnh báo "đã cấu hình nhưng CHƯA TỪNG được poll" — bẫy số 1 của
 * `HW-FOXLINX-RS485-HANDOVER-001` §5.
 *
 * VÌ SAO CẦN
 *
 * Khi `profile` của một slave không giải được, `bus_worker` ghi
 * `profile_not_found`, **vẫn mở cổng**, worker vẫn chạy, service vẫn `active` —
 * nhưng slave được cấp `ext=[0..0)` và `tx` không bao giờ tăng. Hồ sơ bàn giao
 * gọi đây là bẫy nguy hiểm nhất đúng vì "mọi thứ nhìn từ ngoài đều xanh".
 *
 * Trên trang này, triệu chứng đó hiện ra là một hàng có `total_polls = 0`. Nhưng
 * số 0 trong một bảng đầy số khác thì không ai đọc — nó trông y hệt một thiết bị
 * vừa được thêm và chưa tới lượt.
 *
 * PHÂN BIỆT HAI TRẠNG THÁI
 *
 * `offline` (đã từng poll rồi thôi trả lời) và `chưa từng được poll` là hai kết
 * luận khác hẳn nhau về nguyên nhân: một cái là dây/thiết bị, một cái là **cấu
 * hình**. Trộn chúng vào cùng một chỗ hiển thị là buộc người đi hiện trường đi
 * dò dây cho một lỗi nằm trong file JSON.
 *
 * Ngưỡng dùng `total_polls === 0` chứ không phải `online === false`: một thiết
 * bị chưa từng được poll thì cũng `online === false`, nhưng chiều ngược lại
 * không đúng.
 */
function NeverPolledWarning({ rows, deviceNames }: {
  rows: ModbusRTUDiagnostics[]
  deviceNames: Record<string, string>
}) {
  const { pick } = useI18n()
  const neverPolled = rows.filter((row) => row.total_polls === 0)
  if (neverPolled.length === 0) return null

  return (
    <div role="alert" className="mt-3 rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">
      <div className="font-semibold">
        {pick(
          `${neverPolled.length} thiết bị đã cấu hình nhưng CHƯA TỪNG được poll lần nào`,
          `${neverPolled.length} configured device(s) have never been polled`
        )}
      </div>
      <div className="mono mt-1">
        {neverPolled.map((row) => deviceNames[row.device_id] ?? row.device_id ?? `slave ${row.slave_id}`).join(', ')}
      </div>
      <div className="mt-2">
        {pick(
          'Đây KHÁC với "mất liên lạc": thiết bị mất liên lạc là đã từng trả lời rồi thôi, còn ở đây bus chưa hề phát gói nào cho nó. Nguyên nhân thường gặp là cấu hình chứ không phải dây: profile của thiết bị không giải được (bus vẫn mở, service vẫn chạy, nhưng slave không được cấp ô dữ liệu), hoặc bus của nó đang bật mà cổng vật lý không tồn tại. Kiểm cảnh báo E302 modbus.slave_config_error và log iobus trước khi đi dò dây.',
          'This is NOT the same as "offline": an offline device answered before and then stopped, whereas here the bus has never sent it a single frame. The usual cause is configuration rather than wiring — the device profile could not be resolved (the port still opens and the service still runs, but the slave gets no data window), or its bus is enabled while the physical port does not exist. Check alarm E302 modbus.slave_config_error and the iobus log before chasing cables.'
        )}
      </div>
    </div>
  )
}
