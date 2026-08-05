import { useEffect, useState, type FormEvent } from 'react'
import { useAuth, roleAtLeast } from '../auth'
import { apiClient } from '../../shared/api/client'
import type { ModbusRTUDevice, ModbusRTUDiagnostics, ModbusRTUPoint, PointQuality } from '../../shared/types'

// D-14: KHÔNG đặt sẵn '/dev/ttyS3'. Board production Foxlinx chỉ có ttyS2 (dành
// cho MCU STM32) và ttyS5; ttyS3 không tồn tại, nên giá trị mặc định cũ tạo ra
// cấu hình lưu được nhưng không chạy được, và lỗi chỉ lộ ở tầng iobus.
const emptyDevice: ModbusRTUDevice = {
  device_id: '', display_name: '', enabled: true, rs485_port: '', baud: 19200,
  parity: 'N', stop_bit: 1, slave_id: 1, poll_ms: 1000, timeout_ms: 300, retry: 2
}
const emptyPoint: ModbusRTUPoint = {
  point_id: '', device_id: '', tag_name: '', display_name: '', register_type: 'holding_register',
  address: 0, data_type: 'uint16', byte_order: 'big', word_order: 'high_low', scale: 1,
  offset: 0, unit: '', read_write: 'read', default_value: 0, safe_value: 0, enabled: true
}

const inputClass = 'h-10 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] px-3 text-sm text-[var(--c-text)]'
const buttonClass = 'h-10 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-4 text-sm font-semibold text-[var(--c-text)] hover:border-[var(--c-line-strong)]'

/** Ký hiệu "không có dữ liệu". Dùng thay cho 0/BAD khi authority chưa trả gì. */
const NO_DATA = '—'

type PendingDelete = { kind: 'device' | 'point'; id: string; label: string; extra?: number }

/* D-07: trạng thái giao tiếp của thiết bị phải đến TỪ authority, không được suy
 * diễn ở tầng trình bày.
 *
 * Biểu thức cũ `row.online ? 'GOOD' : row.consecutive_errors ? 'OFFLINE' : 'STALE'`
 * sai hai lần: một thiết bị online nhưng Point đang lỗi decode vẫn hiện GOOD; và
 * thiết bị CHƯA TỪNG được poll (online=false, consecutive_errors=0) hiện STALE
 * — tức "dữ liệu cũ", trong khi sự thật là "chưa có dữ liệu nào".
 *
 * Hàm này KHÔNG còn gọi ra quality của Point (quality thuộc về Point và do
 * authority cấp); nó chỉ mô tả tình trạng liên lạc với thiết bị, đúng những gì
 * diagnostics thật sự nói. Track B thay bằng `connection_status` từ BE (MBR-B210). */
function deviceLinkLabel(row: ModbusRTUDiagnostics): string {
  if (row.online) return 'Đang liên lạc'
  if (row.total_polls === 0) return 'Chưa liên lạc lần nào'
  if (row.consecutive_errors > 0) return 'Mất liên lạc'
  return NO_DATA
}

export function ModbusRtuPage() {
  const [devices, setDevices] = useState<ModbusRTUDevice[]>([])
  const [points, setPoints] = useState<ModbusRTUPoint[]>([])
  const [diagnostics, setDiagnostics] = useState<ModbusRTUDiagnostics[]>([])
  const [runtimeQuality, setRuntimeQuality] = useState<Record<string, PointQuality>>({})
  const [device, setDevice] = useState<ModbusRTUDevice>(emptyDevice)
  const [point, setPoint] = useState<ModbusRTUPoint>(emptyPoint)
  const [editingDevice, setEditingDevice] = useState(false)
  const [editingPoint, setEditingPoint] = useState(false)
  const [status, setStatus] = useState('')
  /* D-08: xoá phải qua xác nhận. Trước đây nút Xoá gọi thẳng API trong onClick,
   * và vì mỗi mutation đều apply + restart iobus (D-09), một cú nhấp nhầm vừa
   * mất cấu hình vừa gián đoạn I/O. */
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [writingPoint, setWritingPoint] = useState<{ point_id: string; label: string; value: number } | null>(null)
  const [testWriting, setTestWriting] = useState(false)
  /* Đ-04: Viewer/Operator xem được, chỉ Admin sửa cấu hình. FE disable control
   * để không mời người dùng vào thao tác chắc chắn bị server từ chối 403; server
   * vẫn là nơi quyết định cuối. */
  const { session } = useAuth()
  const canEdit = roleAtLeast(session?.role, 'admin')
  const readOnlyHint = canEdit ? undefined : 'Chỉ vai trò Admin được thay đổi cấu hình Modbus RTU.'

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      if (pendingDelete.kind === 'device') await apiClient.deleteModbusDevice(pendingDelete.id)
      else await apiClient.deleteModbusPoint(pendingDelete.id)
      setPendingDelete(null)
      await reload()
      setStatus(`Đã xoá ${pendingDelete.label}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Không thể xoá')
    } finally {
      setDeleting(false)
    }
  }

  async function confirmTestWrite() {
    if (!writingPoint) return
    setTestWriting(true)
    try {
      const res = await apiClient.writeModbusTest(writingPoint.point_id, Number(writingPoint.value))
      setWritingPoint(null)
      await reload()
      setStatus(`Ghi thử ${writingPoint.label} thành công (giá trị ghi nhận: ${res.applied_value}).`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Không thể thực hiện ghi thử')
    } finally {
      setTestWriting(false)
    }
  }

  async function reload() {
    const [nextDevices, nextPoints] = await Promise.all([apiClient.getModbusDevices(), apiClient.getModbusPoints()])
    setDevices(nextDevices); setPoints(nextPoints)
    if (!point.device_id && nextDevices[0]) setPoint((current) => ({ ...current, device_id: nextDevices[0].device_id }))
    try { setDiagnostics(await apiClient.getModbusDiagnostics()) } catch { setDiagnostics([]) }
    try {
      const live = await apiClient.getPoints()
      setRuntimeQuality(Object.fromEntries(live.filter((item) => item.kind === 'modbus_rtu').map((item) => [item.id, item.quality])))
    } catch { setRuntimeQuality({}) }
  }

  useEffect(() => { reload().catch((error: Error) => setStatus(error.message)) }, [])

  async function saveDevice(event: FormEvent) {
    event.preventDefault(); setStatus('Đang áp dụng cấu hình thiết bị…')
    try {
      if (editingDevice) await apiClient.updateModbusDevice(device)
      else await apiClient.createModbusDevice(device)
      setDevice(emptyDevice); setEditingDevice(false); await reload(); setStatus('Đã áp dụng Device Manager vào iobus.')
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Không thể lưu thiết bị') }
  }

  async function savePoint(event: FormEvent) {
    event.preventDefault(); setStatus('Đang áp dụng cấu hình Point…')
    try {
      if (editingPoint) await apiClient.updateModbusPoint(point)
      else await apiClient.createModbusPoint(point)
      setPoint({ ...emptyPoint, device_id: devices[0]?.device_id ?? '' }); setEditingPoint(false); await reload(); setStatus('Đã áp dụng Point Manager vào Core Point Table.')
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Không thể lưu Point') }
  }

  return (
    <div className="space-y-5 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-bold text-[var(--c-text)]">Modbus RTU Device & Point Manager</h1>
        <p className="mt-1 text-sm text-[var(--c-text-dim)]">BE/Core là nguồn chuẩn; mọi lần lưu đều validate, tạo profile, tăng revision và restart iobus có rollback.</p>
      </header>
      {!canEdit && <div role="note" className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">Chế độ chỉ xem. {readOnlyHint}</div>}
      {status && <div role="status" className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm">{status}</div>}

      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4">
        <h2 className="text-lg font-semibold">Device Manager</h2>
        <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={saveDevice}>
          <input className={inputClass} aria-label="Device ID" placeholder="Device ID (tự sinh nếu trống)" value={device.device_id} disabled={editingDevice} onChange={(e) => setDevice({ ...device, device_id: e.target.value })} />
          <input required className={inputClass} aria-label="Tên thiết bị" placeholder="Tên thiết bị" value={device.display_name} onChange={(e) => setDevice({ ...device, display_name: e.target.value })} />
          <input required className={inputClass} aria-label="RS485 port" value={device.rs485_port} onChange={(e) => setDevice({ ...device, rs485_port: e.target.value })} />
          <input required type="number" className={inputClass} aria-label="Baud" value={device.baud} onChange={(e) => setDevice({ ...device, baud: Number(e.target.value) })} />
          <select className={inputClass} aria-label="Parity" value={device.parity} onChange={(e) => setDevice({ ...device, parity: e.target.value as ModbusRTUDevice['parity'] })}><option>N</option><option>E</option><option>O</option></select>
          <select className={inputClass} aria-label="Stop bit" value={device.stop_bit} onChange={(e) => setDevice({ ...device, stop_bit: Number(e.target.value) as 1 | 2 })}><option value={1}>1 stop bit</option><option value={2}>2 stop bit</option></select>
          <input required type="number" min={1} max={247} className={inputClass} aria-label="Slave ID" placeholder="Slave ID" value={device.slave_id} onChange={(e) => setDevice({ ...device, slave_id: Number(e.target.value) })} />
          <input required type="number" className={inputClass} aria-label="Poll ms" placeholder="Poll ms" value={device.poll_ms} onChange={(e) => setDevice({ ...device, poll_ms: Number(e.target.value) })} />
          <input required type="number" className={inputClass} aria-label="Timeout ms" placeholder="Timeout ms" value={device.timeout_ms} onChange={(e) => setDevice({ ...device, timeout_ms: Number(e.target.value) })} />
          <input required type="number" min={0} max={3} className={inputClass} aria-label="Số lần phát lại" title="Số lần phát lại một giao dịch Modbus bị lỗi trước khi tính là lượt đọc thất bại. 0 = không phát lại." placeholder="Phát lại (0–3)" value={device.retry} onChange={(e) => setDevice({ ...device, retry: Number(e.target.value) })} />
          <label className="flex h-10 items-center gap-2"><input type="checkbox" checked={device.enabled} onChange={(e) => setDevice({ ...device, enabled: e.target.checked })} /> Enabled</label>
          <div className="flex gap-2"><button className={buttonClass} type="submit" disabled={!canEdit} title={readOnlyHint}>{editingDevice ? 'Cập nhật' : 'Thêm thiết bị'}</button>{editingDevice && <button className={buttonClass} type="button" onClick={() => { setDevice(emptyDevice); setEditingDevice(false) }}>Huỷ</button>}</div>
        </form>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-[var(--c-border)]"><th>ID</th><th>Tên</th><th>RS485</th><th>Slave</th><th>Poll/timeout/retry</th><th>Trạng thái</th><th /></tr></thead><tbody>{devices.map((row) => <tr key={row.device_id} className="border-b border-[var(--c-border)]"><td>{row.device_id}</td><td>{row.display_name}</td><td>{row.rs485_port} · {row.baud}{row.parity}8{row.stop_bit}</td><td>{row.slave_id}</td><td>{row.poll_ms}/{row.timeout_ms}/{row.retry}</td><td>{row.enabled ? 'Enabled' : 'Disabled'}</td><td className="space-x-2 py-2"><button className={buttonClass} disabled={!canEdit} title={readOnlyHint} onClick={() => { setDevice(row); setEditingDevice(true) }}>Sửa</button><button className={buttonClass} disabled={!canEdit} title={readOnlyHint} onClick={() => setPendingDelete({ kind: 'device', id: row.device_id, label: `${row.display_name} (${row.device_id})`, extra: points.filter((p) => p.device_id === row.device_id).length })}>Xoá</button></td></tr>)}</tbody></table></div>
      </section>

      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4">
        <h2 className="text-lg font-semibold">Point Manager</h2>
        <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={savePoint}>
          <input className={inputClass} aria-label="Point ID" placeholder="Point ID (ổn định)" value={point.point_id} disabled={editingPoint} onChange={(e) => setPoint({ ...point, point_id: e.target.value })} />
          <select required className={inputClass} aria-label="Thiết bị" value={point.device_id} onChange={(e) => setPoint({ ...point, device_id: e.target.value })}><option value="">Chọn thiết bị</option>{devices.map((row) => <option key={row.device_id} value={row.device_id}>{row.display_name}</option>)}</select>
          <input required className={inputClass} aria-label="Tag name" placeholder="Tag name unique" value={point.tag_name} onChange={(e) => setPoint({ ...point, tag_name: e.target.value })} />
          <input required className={inputClass} aria-label="Display name" placeholder="Display name" value={point.display_name} onChange={(e) => setPoint({ ...point, display_name: e.target.value })} />
          <select className={inputClass} aria-label="Register type" value={point.register_type} onChange={(e) => setPoint({ ...point, register_type: e.target.value as ModbusRTUPoint['register_type'] })}><option value="coil">Coil</option><option value="discrete_input">Discrete Input</option><option value="input_register">Input Register</option><option value="holding_register">Holding Register</option></select>
          <input type="number" min={0} max={65535} className={inputClass} aria-label="Address" value={point.address} onChange={(e) => setPoint({ ...point, address: Number(e.target.value) })} />
          <select className={inputClass} aria-label="Data type" value={point.data_type} onChange={(e) => setPoint({ ...point, data_type: e.target.value as ModbusRTUPoint['data_type'] })}>{['bool','int16','uint16','int32','uint32','float32'].map((value) => <option key={value}>{value}</option>)}</select>
          <select className={inputClass} aria-label="Byte order" value={point.byte_order} onChange={(e) => setPoint({ ...point, byte_order: e.target.value as ModbusRTUPoint['byte_order'] })}><option value="big">Big-endian byte</option><option value="little">Little-endian byte</option></select>
          <select className={inputClass} aria-label="Word order" value={point.word_order} onChange={(e) => setPoint({ ...point, word_order: e.target.value as ModbusRTUPoint['word_order'] })}><option value="high_low">High word → Low word</option><option value="low_high">Low word → High word</option></select>
          <input type="number" step="any" className={inputClass} aria-label="Scale" placeholder="Scale" value={point.scale} onChange={(e) => setPoint({ ...point, scale: Number(e.target.value) })} />
          <input type="number" step="any" className={inputClass} aria-label="Offset" placeholder="Offset" value={point.offset} onChange={(e) => setPoint({ ...point, offset: Number(e.target.value) })} />
          <input className={inputClass} aria-label="Unit" placeholder="Unit" value={point.unit} onChange={(e) => setPoint({ ...point, unit: e.target.value })} />
          <select className={inputClass} aria-label="Read write" value={point.read_write} onChange={(e) => setPoint({ ...point, read_write: e.target.value as ModbusRTUPoint['read_write'] })}><option value="read">Read</option><option value="read_write">Read/Write</option></select>
          <input type="number" step="any" className={inputClass} aria-label="Default value" placeholder="Default value" value={Number(point.default_value)} onChange={(e) => setPoint({ ...point, default_value: Number(e.target.value) })} />
          <input type="number" step="any" className={inputClass} aria-label="Safe value" placeholder="Safe value" value={Number(point.safe_value)} onChange={(e) => setPoint({ ...point, safe_value: Number(e.target.value) })} />
          <label className="flex h-10 items-center gap-2"><input type="checkbox" checked={point.enabled} onChange={(e) => setPoint({ ...point, enabled: e.target.checked })} /> Enabled</label>
          <div className="flex gap-2"><button className={buttonClass} type="submit" disabled={!canEdit} title={readOnlyHint}>{editingPoint ? 'Cập nhật' : 'Thêm Point'}</button>{editingPoint && <button className={buttonClass} type="button" onClick={() => { setPoint({ ...emptyPoint, device_id: devices[0]?.device_id ?? '' }); setEditingPoint(false) }}>Huỷ</button>}</div>
        </form>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-[var(--c-border)]"><th>Point ID / Tag</th><th>Tên</th><th>Register</th><th>Kiểu / endian</th><th>Scale + offset</th><th>Quality</th><th>R/W</th><th /></tr></thead><tbody>{points.map((row) => <tr key={row.point_id} className="border-b border-[var(--c-border)]"><td>{row.point_id}<br/><span className="text-[var(--c-text-dim)]">{row.tag_name}</span></td><td>{row.display_name}</td><td>{row.register_type} @{row.address}</td><td>{row.data_type} · {row.byte_order}/{row.word_order}</td><td>{row.scale}x + {row.offset} {row.unit}</td><td>{runtimeQuality[row.point_id]?.toUpperCase() ?? NO_DATA}</td><td>{row.read_write}</td><td className="space-x-2 py-2"><button className={buttonClass} disabled={!canEdit} title={readOnlyHint} onClick={() => { setPoint(row); setEditingPoint(true) }}>Sửa</button>{row.read_write === 'read_write' && <button className={buttonClass} disabled={!canEdit} title={readOnlyHint} onClick={() => setWritingPoint({ point_id: row.point_id, label: `${row.display_name} (${row.point_id})`, value: Number(row.default_value ?? 0) })}>Ghi thử</button>}<button className={buttonClass} disabled={!canEdit} title={readOnlyHint} onClick={() => setPendingDelete({ kind: 'point', id: row.point_id, label: `${row.tag_name} (${row.point_id})` })}>Xoá</button></td></tr>)}</tbody></table></div>
      </section>

      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4">
        <h2 className="text-lg font-semibold">CRC / timeout / retry diagnostics</h2>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Thiết bị</th><th>Slave</th><th>Liên lạc</th><th>Poll / lỗi</th><th>Timeout</th><th>CRC</th><th>Phát lại</th><th>Lỗi liên tiếp</th></tr></thead><tbody>{diagnostics.map((row) => <tr key={row.slave_id} className="border-t border-[var(--c-border)]"><td>{row.device_id || NO_DATA}</td><td>{row.slave_id}</td><td>{deviceLinkLabel(row)}</td><td>{row.total_polls} / {row.total_errors}</td><td>{row.timeout_errors}</td><td>{row.crc_errors}</td><td>{row.retry_attempts}</td><td>{row.consecutive_errors}</td></tr>)}</tbody></table></div>
        {diagnostics.length === 0 && <p className="mt-3 text-sm text-[var(--c-text-dim)]">Chưa có telemetry Modbus RTU từ iobus.</p>}
      </section>

      {pendingDelete && (
        <div role="dialog" aria-modal="true" aria-labelledby="mb-del-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-5">
            <h3 id="mb-del-title" className="text-lg font-semibold text-[var(--c-text)]">
              Xoá {pendingDelete.kind === 'device' ? 'thiết bị' : 'Point'}?
            </h3>
            <p className="mt-2 text-sm text-[var(--c-text)]">{pendingDelete.label}</p>
            {pendingDelete.kind === 'device' && (pendingDelete.extra ?? 0) > 0 && (
              <p className="mt-2 text-sm text-[var(--c-danger,#c00)]">
                Thiết bị này còn {pendingDelete.extra} Point. Hãy xoá các Point trước.
              </p>
            )}
            <p className="mt-2 text-sm text-[var(--c-text-dim)]">
              Thao tác này áp dụng cấu hình mới vào iobus ngay lập tức.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button className={buttonClass} type="button" onClick={() => setPendingDelete(null)} disabled={deleting}>Huỷ</button>
              <button className={buttonClass} type="button" onClick={confirmDelete} disabled={deleting}>
                {deleting ? 'Đang xoá…' : 'Xoá'}
              </button>
            </div>
          </div>
        </div>
      )}

      {writingPoint && (
        <div role="dialog" aria-modal="true" aria-labelledby="mb-write-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-5">
            <h3 id="mb-write-title" className="text-lg font-semibold text-[var(--c-text)]">
              Ghi thử Modbus RTU Point
            </h3>
            <p className="mt-2 text-sm text-[var(--c-text)]">{writingPoint.label}</p>
            <div className="mt-4 space-y-2">
              <label className="block text-xs font-semibold text-[var(--c-text-dim)]">Giá trị cần ghi</label>
              <input
                type="number"
                step="any"
                className={inputClass + ' w-full'}
                value={writingPoint.value}
                onChange={(e) => setWritingPoint({ ...writingPoint, value: Number(e.target.value) })}
              />
            </div>
            <p className="mt-3 text-xs text-[var(--c-text-dim)]">
              Lệnh sẽ được gửi xuống Core/iobus và đặt cờ dirty để ghi trực tiếp xuống thiết bị Modbus RTU.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button className={buttonClass} type="button" onClick={() => setWritingPoint(null)} disabled={testWriting}>Huỷ</button>
              <button className={buttonClass} type="button" onClick={confirmTestWrite} disabled={testWriting}>
                {testWriting ? 'Đang ghi…' : 'Xác nhận Ghi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
