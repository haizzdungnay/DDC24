import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '../../../shared/api/client'
import { useI18n } from '../../../shared/i18n'
import type { ModbusMappingResponse } from '../../../shared/types'
import { NO_DATA, buttonClass } from '../shared'

/**
 * Tab "Mapping" — MBR-B306.
 *
 * Trang này trả lời một câu hỏi mà bốn tab kia không trả lời được: **toàn bộ
 * bảng điểm chiếm những register nào, và có chỗ nào đè lên nhau không.**
 *
 * Vì sao quan trọng: khai báo chồng vùng register KHÔNG gây lỗi lúc lưu và
 * KHÔNG gây lỗi lúc chạy — hai Point cùng trỏ vào một ô nhớ vẫn đọc ra số hợp
 * lệ. Chỉ khi GHI thì chúng đè nhau theo thứ tự không xác định, và triệu chứng
 * xuất hiện ở hiện trường dưới dạng "setpoint tự nhảy". Bảng này cùng danh sách
 * lỗi validate đưa chuyện đó lên màn hình TRƯỚC khi apply.
 */
export function MappingPage() {
  const { pick } = useI18n()
  const [mapping, setMapping] = useState<ModbusMappingResponse | null>(null)
  const [errorStatus, setErrorStatus] = useState('')
  const [busFilter, setBusFilter] = useState('')

  async function loadData() {
    try {
      setMapping(await apiClient.getModbusMapping())
      setErrorStatus('')
    } catch (error) {
      setErrorStatus(error instanceof Error ? error.message : pick('Không đọc được bảng mapping', 'Could not read the mapping table'))
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  /* Mọi trường danh sách đều chắn `?? []`: backend Go tuần tự hoá nil slice
   * thành `null`, và một `.filter`/`.map` trên null làm trắng cả trang. */
  const allRows = useMemo(() => mapping?.rows ?? [], [mapping])

  const rows = useMemo(
    () => (busFilter ? allRows.filter((row) => row.bus_id === busFilter) : allRows),
    [allRows, busFilter]
  )

  const buses = useMemo(
    () => Array.from(new Set(allRows.map((row) => row.bus_id))).sort(),
    [allRows]
  )

  const blockingErrors = mapping?.errors ?? []
  const busLoads = mapping?.load ?? []

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[var(--c-text)]">Modbus RTU · Mapping</h2>
          <p className="mt-1 text-xs text-[var(--c-text-dim)]">
            {pick('Bảng ánh xạ Point → register của', 'The Point → register mapping table for the')}{' '}
            <strong>{pick('bản nháp', 'draft')}</strong>
            {pick(', kèm lỗi chặn apply và ước lượng tải từng bus.', ', including apply-blocking errors and per-bus load estimates.')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-9 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] px-2 text-xs"
            aria-label={pick('Lọc theo bus', 'Filter by bus')}
            value={busFilter}
            onChange={(event) => setBusFilter(event.target.value)}
          >
            <option value="">{pick('Tất cả bus', 'All buses')}</option>
            {buses.map((bus) => <option key={bus} value={bus}>{bus}</option>)}
          </select>
          <button type="button" className={buttonClass + ' h-9 text-xs'} onClick={() => void loadData()}>
            {pick('Làm mới', 'Refresh')}
          </button>
        </div>
      </header>

      {errorStatus && (
        <div role="alert" className="rounded-[var(--radius)] border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          ⚠️ {errorStatus}
        </div>
      )}

      {blockingErrors.length > 0 && (
        <section
          data-testid="mapping-errors"
          role="alert"
          className="rounded-[var(--radius)] border border-[var(--c-danger,#c00)]/40 bg-red-500/5 p-4"
        >
          <h3 className="text-base font-semibold text-[var(--c-danger,#c00)]">
            {pick(`${blockingErrors.length} lỗi chặn việc áp dụng`, `${blockingErrors.length} error(s) blocking apply`)}
          </h3>
          <ul className="mt-2 space-y-1 text-xs">
            {blockingErrors.map((issue, index) => (
              <li key={`${issue.path}-${index}`} className="font-mono">
                <span className="font-semibold">{issue.path}</span>
                {issue.reason ? ` [${issue.reason}]` : ''}: {issue.message}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--c-text-dim)]">
            {pick('Nút "Áp dụng" sẽ bị server từ chối cho tới khi các lỗi trên được sửa.', 'The "Apply" button will be rejected by the server until the errors above are fixed.')}
          </p>
        </section>
      )}

      {busLoads.length > 0 && (
        <section className="grid gap-3 md:grid-cols-2">
          {busLoads.map((load) => {
            const over = load.estimated_percent > load.reject_percent
            const warn = !over && load.estimated_percent > load.warn_percent
            return (
              <div
                key={load.bus_id}
                data-testid={`load-${load.bus_id}`}
                className={`rounded-[var(--radius)] border p-4 text-xs ${
                  over ? 'border-[var(--c-danger,#c00)]/50 bg-red-500/5'
                    : warn ? 'border-amber-500/50 bg-amber-500/5'
                      : 'border-[var(--c-border)] bg-[var(--c-surface)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[var(--c-text)]">{load.bus_id}</span>
                  <span className="font-mono">{load.estimated_percent.toFixed(1)}%</span>
                </div>
                <p className="mt-1 text-[var(--c-text-dim)]">
                  {pick(`${load.device_count} thiết bị · ${load.point_count} Point · ${load.baud} baud`, `${load.device_count} device(s) · ${load.point_count} Point(s) · ${load.baud} baud`)}
                </p>
                <p className="mt-1 text-[var(--c-text-dim)]">
                  {pick(`Ngưỡng cảnh báo ${load.warn_percent}% · từ chối ${load.reject_percent}%`, `Warning threshold ${load.warn_percent}% · reject ${load.reject_percent}%`)}
                </p>
                {over && (
                  <p className="mt-1 font-semibold text-[var(--c-danger,#c00)]">
                    {pick('Vượt ngưỡng — giảm số Point hoặc tăng poll_ms.', 'Over threshold — reduce the Point count or increase poll_ms.')}
                  </p>
                )}
              </div>
            )
          })}
        </section>
      )}

      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4">
        <h3 className="text-base font-semibold text-[var(--c-text)]">{pick('Bảng ánh xạ register', 'Register mapping table')}</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--c-border)] text-xs text-[var(--c-text-dim)]">
                <th className="py-2">Point ID</th>
                <th className="py-2">Tag</th>
                <th className="py-2">Bus / Slave</th>
                <th className="py-2">{pick('Vùng register', 'Register range')}</th>
                <th className="py-2">{pick('Kiểu', 'Type')}</th>
                <th className="py-2">R/W</th>
                <th className="py-2">{pick('Trạng thái', 'Status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.point_id} className="border-t border-[var(--c-border)]">
                  <td className="py-2.5 font-mono text-xs">{row.point_id}</td>
                  <td className="py-2.5 text-xs">{row.tag_name || NO_DATA}</td>
                  <td className="py-2.5 font-mono text-xs">{row.bus_id} / {row.slave_id}</td>
                  <td className="py-2.5 font-mono text-xs">
                    {row.register_type} {row.address}
                    {row.registers > 1 ? `–${row.address + row.registers - 1}` : ''}
                  </td>
                  <td className="py-2.5 font-mono text-xs">{row.data_type}</td>
                  <td className="py-2.5 text-xs">{row.read_write}</td>
                  <td className="py-2.5 text-xs">{row.enabled ? 'Enabled' : 'Disabled'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-[var(--c-text-dim)]">
                    {pick('Chưa có Point nào trong bản nháp.', 'No Points in the draft yet.')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
