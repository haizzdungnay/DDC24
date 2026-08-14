import { useEffect, useState } from 'react'
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
    </div>
  )
}
