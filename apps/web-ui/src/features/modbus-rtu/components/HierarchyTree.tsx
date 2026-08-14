import { ChevronDown, ChevronRight, Cable, Cpu, Radio } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { HealthChip } from '../../../shared/components/pa3/StateAtoms'
import { useI18n } from '../../../shared/i18n'
import { NO_DATA } from '../../../shared/utils'
import type { ModbusBusInfo, ModbusRTUDevice, ModbusRTUDiagnostics, ModbusRTUPoint, OverviewHealthState } from '../../../shared/types'

/**
 * Cây Bus → Device → Point — PA3-505 / UX-DES §14.
 *
 * VÌ SAO CẦN
 *
 * Workspace Modbus có sáu tab phẳng: Cổng, Thiết bị, Point, Ánh xạ, Chẩn đoán.
 * Mỗi tab đúng về nội dung nhưng không tab nào trả lời được câu hỏi cấu trúc mà
 * kỹ thuật viên hỏi khi đứng trước tủ: "sợi dây này đang có những thiết bị nào,
 * và thiết bị kia đọc những thanh ghi nào". Muốn biết phải mở ba tab và tự ghép
 * bằng `bus_id`/`device_id` trong đầu.
 *
 * LUẬT DỮ LIỆU
 *
 * Tham số serial (baud/parity/stop bits) thuộc BUS, không thuộc device — đúng
 * bản chất vật lý: hai thiết bị trên cùng một sợi dây không thể chạy hai baud
 * khác nhau (UX-REQ UC-09). Cây này vì vậy hiển thị chúng ở cấp bus và KHÔNG
 * lặp lại ở cấp device.
 *
 * Trạng thái online của device đến từ telemetry của iobus. Không có telemetry
 * ⇒ `unknown`, không phải `offline`: "chưa đo được" khác "đã mất liên lạc".
 */

interface HierarchyTreeProps {
  buses: ModbusBusInfo[]
  devices: ModbusRTUDevice[]
  points: ModbusRTUPoint[]
  diagnostics: ModbusRTUDiagnostics[]
  telemetryAvailable: boolean
}

function busState(bus: ModbusBusInfo): OverviewHealthState {
  const open = bus.open_state?.toLowerCase()
  if (!open) return 'unknown'
  if (open === 'open' || open === 'ok') {
    if (bus.total_devices > 0 && bus.online_devices === 0) return 'fault'
    if (bus.online_devices < bus.total_devices) return 'degraded'
    return 'good'
  }
  return 'fault'
}

function deviceState(device: ModbusRTUDevice, diag: ModbusRTUDiagnostics | undefined, telemetryAvailable: boolean): OverviewHealthState {
  if (!device.enabled) return 'unknown'
  if (!telemetryAvailable || !diag) return 'unknown'
  if (diag.online) return diag.consecutive_errors > 0 ? 'degraded' : 'good'
  return 'offline'
}

/** Bus của một device: ưu tiên `bus_id` tường minh, sau đó suy từ cổng vật lý.
 *  Không đoán được thì trả `null` và device hiện ở nhóm "chưa gán bus" — thà
 *  nói ra là chưa gán còn hơn treo nó vào một sợi dây tuỳ tiện. */
function busIdOf(device: ModbusRTUDevice, buses: ModbusBusInfo[]): string | null {
  if (device.bus_id) return device.bus_id
  const byPort = buses.find((bus) => bus.port === device.rs485_port || bus.port_alias === device.rs485_port)
  return byPort?.bus_id ?? null
}

export function HierarchyTree({ buses, devices, points, diagnostics, telemetryAvailable }: HierarchyTreeProps) {
  const { pick } = useI18n()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const diagByDevice = useMemo(() => new Map(diagnostics.map((item) => [item.device_id, item])), [diagnostics])
  const pointsByDevice = useMemo(() => {
    const map = new Map<string, ModbusRTUPoint[]>()
    for (const point of points) {
      const list = map.get(point.device_id) ?? []
      list.push(point)
      map.set(point.device_id, list)
    }
    return map
  }, [points])

  const grouped = useMemo(() => {
    const map = new Map<string, ModbusRTUDevice[]>()
    const orphans: ModbusRTUDevice[] = []
    for (const device of devices) {
      const busId = busIdOf(device, buses)
      if (!busId) {
        orphans.push(device)
        continue
      }
      const list = map.get(busId) ?? []
      list.push(device)
      map.set(busId, list)
    }
    return { map, orphans }
  }, [buses, devices])

  function toggle(key: string) {
    setExpanded((current) => ({ ...current, [key]: !current[key] }))
  }

  if (buses.length === 0 && devices.length === 0) {
    return (
      <p className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-4 text-sm text-[var(--c-text-dim)]">
        {pick('Chưa cấu hình bus hoặc thiết bị Modbus RTU nào.', 'No Modbus RTU bus or device configured yet.')}
      </p>
    )
  }

  return (
    <div className="space-y-2" role="tree" aria-label={pick('Cây Bus → Thiết bị → Point', 'Bus → Device → Point tree')}>
      {buses.map((bus) => {
        const busDevices = grouped.map.get(bus.bus_id) ?? []
        const busOpen = expanded[`bus:${bus.bus_id}`] ?? true
        const BusChevron = busOpen ? ChevronDown : ChevronRight
        return (
          <div key={bus.bus_id} role="treeitem" aria-expanded={busOpen} className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)]">
            <button
              type="button"
              onClick={() => toggle(`bus:${bus.bus_id}`)}
              className="flex w-full flex-wrap items-center gap-3 bg-[var(--c-surface-2)] px-3 py-2.5 text-left"
            >
              <BusChevron className="h-4 w-4 shrink-0 text-[var(--c-text-dim)]" aria-hidden="true" />
              <Cable className="h-4 w-4 shrink-0 text-[var(--c-accent-2)]" aria-hidden="true" />
              <span className="font-semibold">{bus.display_name || `Bus ${bus.bus_id}`}</span>
              <HealthChip state={busState(bus)} />
              {/* Tham số serial ở cấp BUS — đây là nơi duy nhất chúng xuất hiện
                  trong cây, đúng UC-09. */}
              <span className="mono text-xs text-[var(--c-text-dim)]">
                {bus.port || NO_DATA} · {bus.baud || NO_DATA} {bus.parity || '?'}{bus.data_bits || '?'}{bus.stop_bits || '?'}
              </span>
              <span className="ml-auto text-xs text-[var(--c-text-dim)]">
                {pick(`${bus.online_devices}/${bus.total_devices} thiết bị trực tuyến`, `${bus.online_devices}/${bus.total_devices} devices online`)}
              </span>
              <Link
                to={`/eng/modbus-rtu/ports?bus=${encodeURIComponent(bus.bus_id)}`}
                onClick={(event) => event.stopPropagation()}
                className="shrink-0 text-xs font-semibold text-[var(--c-accent)]"
              >
                {pick('Cấu hình bus →', 'Configure bus →')}
              </Link>
            </button>

            {busOpen && (
              <div className="divide-y divide-[var(--c-border)]">
                {busDevices.length === 0 && (
                  <p className="px-9 py-3 text-xs text-[var(--c-text-dim)]">{pick('Chưa có thiết bị nào trên bus này.', 'No devices on this bus yet.')}</p>
                )}
                {busDevices.map((device) => {
                  const diag = diagByDevice.get(device.device_id)
                  const devicePoints = pointsByDevice.get(device.device_id) ?? []
                  const key = `dev:${device.device_id}`
                  const deviceOpen = expanded[key] ?? false
                  const DeviceChevron = deviceOpen ? ChevronDown : ChevronRight
                  return (
                    <div key={device.device_id} role="treeitem" aria-expanded={deviceOpen}>
                      <button
                        type="button"
                        onClick={() => toggle(key)}
                        className="flex w-full flex-wrap items-center gap-3 px-3 py-2 pl-9 text-left text-sm hover:bg-[var(--c-accent-bg)]"
                      >
                        <DeviceChevron className="h-4 w-4 shrink-0 text-[var(--c-text-dim)]" aria-hidden="true" />
                        <Cpu className="h-4 w-4 shrink-0 text-[var(--c-text-dim)]" aria-hidden="true" />
                        <span className="font-semibold">{device.display_name || device.device_id}</span>
                        <span className="mono text-xs text-[var(--c-text-dim)]">Slave {device.slave_id}</span>
                        <HealthChip state={deviceState(device, diag, telemetryAvailable)} />
                        {!device.enabled && <span className="text-xs text-[var(--c-text-dim)]">{pick('đã tắt', 'disabled')}</span>}
                        <span className="ml-auto text-xs text-[var(--c-text-dim)]">
                          {devicePoints.length} point · poll {device.poll_ms} ms
                          {diag ? pick(` · lỗi ${diag.total_errors}/${diag.total_polls}`, ` · errors ${diag.total_errors}/${diag.total_polls}`) : ''}
                        </span>
                        <Link
                          to={`/eng/modbus-rtu/devices?q=${encodeURIComponent(device.device_id)}`}
                          onClick={(event) => event.stopPropagation()}
                          className="shrink-0 text-xs font-semibold text-[var(--c-accent)]"
                        >
                          {pick('Chi tiết →', 'Details →')}
                        </Link>
                      </button>

                      {deviceOpen && (
                        <ul className="bg-[var(--c-bg)] py-1">
                          {devicePoints.length === 0 && (
                            <li className="px-3 py-2 pl-16 text-xs text-[var(--c-text-dim)]">{pick('Thiết bị chưa khai báo point nào.', 'The device has no declared points yet.')}</li>
                          )}
                          {devicePoints.map((point) => (
                            <li key={point.point_id} className="flex flex-wrap items-center gap-3 px-3 py-1.5 pl-16 text-xs">
                              <Radio className="h-3.5 w-3.5 shrink-0 text-[var(--c-text-dim)]" aria-hidden="true" />
                              <span className="mono font-semibold">{point.point_id}</span>
                              <span className="min-w-0 truncate">{point.display_name || point.tag_name}</span>
                              <span className="mono text-[var(--c-text-dim)]">
                                {point.register_type} @{point.address} · {point.data_type}
                                {point.unit ? ` · ${point.unit}` : ''}
                              </span>
                              {point.read_write === 'read_write' && <span className="text-[var(--c-accent)]">{pick('ghi được', 'writable')}</span>}
                              {!point.enabled && <span className="text-[var(--c-text-dim)]">{pick('đã tắt', 'disabled')}</span>}
                              {/* Point Modbus đi chung không gian giám sát với
                                  point cục bộ — cùng một Monitor, không phải
                                  một bảng riêng (PA3-401). */}
                              <Link to={`/monitor?point=${encodeURIComponent(point.point_id)}`} className="ml-auto shrink-0 font-semibold text-[var(--c-accent)]">
                                {pick('Giám sát →', 'Monitor →')}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {grouped.orphans.length > 0 && (
        <div className="rounded-[var(--radius)] border border-dashed border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-xs text-[var(--c-warn-fg)]">
          <div className="font-semibold">{pick(`${grouped.orphans.length} thiết bị chưa gán được vào bus nào`, `${grouped.orphans.length} device(s) not assigned to any bus`)}</div>
          <div className="mt-1">
            {grouped.orphans.map((device) => pick(`${device.display_name || device.device_id} (cổng ${device.rs485_port || NO_DATA})`, `${device.display_name || device.device_id} (port ${device.rs485_port || NO_DATA})`)).join(', ')}
          </div>
        </div>
      )}
    </div>
  )
}
