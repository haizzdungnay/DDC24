import { useEffect, useState, type FormEvent } from 'react'
import { useAuth, roleAtLeast } from '../../auth'
import { apiClient } from '../../../shared/api/client'
import { useI18n } from '../../../shared/i18n'
import type { ModbusBusConfigInput, ModbusBusInfo, ModbusPortCapability } from '../../../shared/types'
import { NO_DATA, buttonClass, describeApiError, inputClass, readOnlyHint } from '../shared'

/**
 * Tab "Cổng RS-485" — cấu hình TỪNG cổng, áp riêng từng cổng.
 *
 * VÌ SAO TRANG NÀY TỒN TẠI
 *
 * `OD-MBRTU-002` (CLOSED) đặt tham số serial ở Bus và cho Device kế thừa
 * read-only. Nhưng cho tới 2026-08-06 **không có đường nào sửa được Bus**: API
 * chỉ có `GET /modbus/buses`, và giao diện vẫn bắt người dùng nhập
 * baud/parity/stop ở từng Thiết bị — nhập xong mới bị validator từ chối, mà
 * cũng không có chỗ nào sửa cho đúng.
 *
 * Hai cổng được cấu hình **độc lập**: mỗi cổng một form, một nút áp riêng. Đó
 * không phải lựa chọn thẩm mỹ — hai sợi dây là hai miền vật lý tách biệt, và
 * gộp chúng vào một lần áp sẽ buộc người vận hành đụng vào dây đang chạy tốt
 * khi họ chỉ muốn sửa dây kia.
 */

const BAUD_OPTIONS = [9600, 19200, 38400, 57600, 115200]

interface PortForm {
  display_name: string
  baud: number
  parity: 'N' | 'E' | 'O'
  stop_bits: 1 | 2
  offline_probe_ms: number
  enabled: boolean
}

function formFromBus(bus: ModbusBusInfo | undefined, fallbackName: string): PortForm {
  return {
    display_name: bus?.display_name || fallbackName,
    baud: bus?.baud || 19200,
    parity: (bus?.parity as PortForm['parity']) || 'N',
    stop_bits: (bus?.stop_bits as PortForm['stop_bits']) || 1,
    offline_probe_ms: bus?.offline_probe_ms ?? 5000,
    enabled: bus?.enabled ?? true
  }
}

export function PortsPage() {
  const { session } = useAuth()
  const { lang, pick } = useI18n()
  const canEdit = roleAtLeast(session?.role, 'admin')
  const [buses, setBuses] = useState<ModbusBusInfo[]>([])
  const [ports, setPorts] = useState<ModbusPortCapability[]>([])
  const [forms, setForms] = useState<Record<string, PortForm>>({})
  const [status, setStatus] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [loadError, setLoadError] = useState('')

  async function reload() {
    try {
      const [nextBuses, nextPorts] = await Promise.all([
        apiClient.getModbusBuses(),
        apiClient.getModbusPorts()
      ])
      setBuses(nextBuses)
      setPorts(nextPorts)
      setLoadError('')
      const next: Record<string, PortForm> = {}
      for (const capability of nextPorts) {
        const busID = busIDForPort(capability.port)
        next[busID] = formFromBus(
          nextBuses.find((bus) => bus.bus_id === busID),
          capability.description || busID.toUpperCase()
        )
      }
      setForms(next)
    } catch (error) {
      setLoadError(describeApiError(error, pick('không đọc được danh sách cổng', 'could not read the port list'), lang))
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  async function savePort(busID: string, event: FormEvent) {
    event.preventDefault()
    const form = forms[busID]
    if (!form) return
    setSaving(busID)
    setStatus((current) => ({ ...current, [busID]: pick('Đang áp cấu hình xuống cổng…', 'Applying configuration to the port…') }))
    try {
      const payload: ModbusBusConfigInput = {
        display_name: form.display_name,
        baud: Number(form.baud),
        parity: form.parity,
        stop_bits: Number(form.stop_bits) as 1 | 2,
        offline_probe_ms: Number(form.offline_probe_ms),
        enabled: form.enabled
      }
      await apiClient.updateModbusBus(busID, payload)
      await reload()
      setStatus((current) => ({ ...current, [busID]: pick('Đã áp cấu hình xuống cổng.', 'Configuration applied to the port.') }))
    } catch (error) {
      setStatus((current) => ({
        ...current,
        [busID]: describeApiError(error, pick('Không áp được cấu hình cổng', 'Could not apply the port configuration'), lang)
      }))
    } finally {
      setSaving(null)
    }
  }

  function update(busID: string, patch: Partial<PortForm>) {
    setForms((current) => ({ ...current, [busID]: { ...current[busID], ...patch } }))
  }

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-xl font-bold text-[var(--c-text)]">{pick('Modbus RTU · Cổng RS-485', 'Modbus RTU · RS-485 Ports')}</h2>
        <p className="mt-1 text-xs text-[var(--c-text-dim)]">
          {pick(
            'Khung truyền thuộc về sợi dây, không thuộc thiết bị. Mỗi cổng cấu hình và áp riêng; mọi thiết bị trên cổng tự động dùng theo.',
            'The serial framing belongs to the wire, not the device. Each port is configured and applied independently; every device on that port picks it up automatically.'
          )}
        </p>
      </header>

      {!canEdit && (
        <div role="note" className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-xs">
          {readOnlyHint(lang)}
        </div>
      )}

      {loadError && (
        <div role="alert" data-testid="ports-load-error"
          className="rounded-[var(--radius)] border border-red-500/40 bg-red-500/5 p-3 text-sm text-[var(--c-text)]">
          {loadError}
        </div>
      )}

      {ports.length === 0 && !loadError && (
        <p className="text-sm text-[var(--c-text-dim)]">{pick('Board không khai báo cổng RS-485 nào.', 'The board declares no RS-485 ports.')}</p>
      )}

      {ports.map((capability) => {
        const busID = busIDForPort(capability.port)
        const form = forms[busID]
        const bus = buses.find((item) => item.bus_id === busID)
        if (!form) return null
        return (
          <section
            key={busID}
            data-testid={`port-card-${busID}`}
            className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4 shadow-sm space-y-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-base font-semibold text-[var(--c-text)]">
                {capability.description || busID.toUpperCase()}
              </h3>
              <span className="font-mono text-xs text-[var(--c-text-dim)]">
                {capability.port}
                {capability.alias ? ` → ${capability.alias}` : ''}
              </span>
            </div>

            {/* Trạng thái THẬT của cổng, do iobus báo. `—` khi chưa đo được, không
                phải 0 — D-07. */}
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--c-text-dim)]">
              <div>
                <dt className="inline">{pick('Trạng thái cổng', 'Port state')}: </dt>
                <dd className="inline font-semibold" data-testid={`port-state-${busID}`}>
                  {bus?.open_state || NO_DATA}
                </dd>
              </div>
              <div>
                <dt className="inline">{pick('Thiết bị', 'Devices')}: </dt>
                <dd className="inline">{bus ? `${bus.online_devices}/${bus.total_devices} online` : NO_DATA}</dd>
              </div>
              <div>
                <dt className="inline">{pick('Điều hướng', 'Direction control')}: </dt>
                <dd className="inline">{pick('auto (phần cứng không có DE/RE)', 'auto (hardware has no DE/RE)')}</dd>
              </div>
            </dl>

            <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => savePort(busID, e)}>
              <input
                className={inputClass}
                aria-label={pick(`Tên hiển thị ${busID}`, `Display name ${busID}`)}
                placeholder={pick('Tên hiển thị', 'Display name')}
                maxLength={32}
                value={form.display_name}
                disabled={!canEdit}
                onChange={(e) => update(busID, { display_name: e.target.value })}
              />
              <select
                className={inputClass}
                aria-label={`Baud ${busID}`}
                value={form.baud}
                disabled={!canEdit}
                onChange={(e) => update(busID, { baud: Number(e.target.value) })}
              >
                {BAUD_OPTIONS.map((baud) => (
                  <option key={baud} value={baud}>{baud}</option>
                ))}
              </select>
              <select
                className={inputClass}
                aria-label={`Parity ${busID}`}
                value={form.parity}
                disabled={!canEdit}
                onChange={(e) => update(busID, { parity: e.target.value as PortForm['parity'] })}
              >
                <option value="N">{pick('N — không parity', 'N — no parity')}</option>
                <option value="E">{pick('E — chẵn', 'E — even')}</option>
                <option value="O">{pick('O — lẻ', 'O — odd')}</option>
              </select>
              <select
                className={inputClass}
                aria-label={`Stop bits ${busID}`}
                value={form.stop_bits}
                disabled={!canEdit}
                onChange={(e) => update(busID, { stop_bits: Number(e.target.value) as 1 | 2 })}
              >
                <option value={1}>1 stop bit</option>
                <option value={2}>2 stop bit</option>
              </select>
              <input
                type="number"
                min={1000}
                max={60000}
                step={500}
                className={inputClass}
                aria-label={pick(`Chu kỳ dò lại thiết bị offline ${busID}`, `Offline device re-probe interval ${busID}`)}
                value={form.offline_probe_ms}
                disabled={!canEdit}
                onChange={(e) => update(busID, { offline_probe_ms: Number(e.target.value) })}
              />

              <label className="flex items-center gap-2 text-sm text-[var(--c-text)] sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  disabled={!canEdit}
                  onChange={(e) => update(busID, { enabled: e.target.checked })}
                />
                {pick('Kích hoạt cổng', 'Enable port')}
              </label>

              {/* Data bits là 8 cố định: iobus mở cổng bằng modbus_new_rtu(…, 8,
                  stop). Hiện ra để người dùng thấy khung truyền đầy đủ, nhưng
                  không cho sửa — một ô nhập không có tác dụng còn tệ hơn không có. */}
              <p className="flex items-center text-xs text-[var(--c-text-dim)] sm:col-span-2">
                {pick(
                  `Khung truyền: ${form.baud} ${form.parity}8${form.stop_bits} · data bits cố định 8 (Modbus RTU)`,
                  `Framing: ${form.baud} ${form.parity}8${form.stop_bits} · data bits fixed at 8 (Modbus RTU)`
                )}
              </p>

              <button className={buttonClass} type="submit" disabled={!canEdit || saving === busID}>
                {saving === busID ? pick('Đang áp…', 'Applying…') : pick('Áp dụng cho cổng này', 'Apply to this port')}
              </button>
            </form>

            {/* Đổi khung truyền của dây ảnh hưởng MỌI thiết bị trên dây đó. Nói
                trước, không để người vận hành phát hiện bằng cách mất liên lạc. */}
            {bus && bus.total_devices > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400" data-testid={`port-warning-${busID}`}>
                {pick(
                  `Cổng đang có ${bus.total_devices} thiết bị. Đổi khung truyền sẽ áp cho tất cả — thiết bị nào không chạy khung mới sẽ mất liên lạc.`,
                  `This port has ${bus.total_devices} device(s). Changing the framing applies to all of them — any device that does not run the new framing will lose communication.`
                )}
              </p>
            )}

            {status[busID] && (
              <p role="status" data-testid={`port-status-${busID}`} className="text-xs text-[var(--c-text)]">
                {status[busID]}
              </p>
            )}
          </section>
        )
      })}
    </div>
  )
}

/** `/dev/rs485-2` → `rs485-2`. Ánh xạ cổng ↔ bus là sự thật phần cứng, khớp
 *  `PortForBusID()` bên backend. */
function busIDForPort(port: string): string {
  const tail = port.split('/').pop() || ''
  return tail.toLowerCase()
}
