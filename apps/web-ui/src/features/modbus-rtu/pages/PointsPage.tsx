import { useEffect, useState, type FormEvent } from 'react'
import { useAuth, roleAtLeast } from '../../auth'
import { apiClient } from '../../../shared/api/client'
import type { ModbusRTUDevice, ModbusRTUPoint, PointQuality } from '../../../shared/types'
import { NO_DATA, READ_ONLY_HINT, buttonClass, emptyPoint, inputClass } from '../shared'

type PendingDelete = { id: string; label: string }
type PendingWrite = { point_id: string; label: string; value: number }

/**
 * Tab "Points" của Modbus RTU — MBR-B301.
 *
 * Tách khỏi `ModbusRtuPage` monolith. Trang cũ vừa quản lý Device vừa quản lý
 * Point vừa hiện diagnostics, và ba route `devices`/`points`/`diagnostics` cùng
 * trỏ về nó nên ba tab hiển thị y hệt nhau — xem
 * `docs/07_records/reviews/FE_PAGES_ERROR_REVIEW_2026-08-05.md` FE-MB-01.
 *
 * Trang này KHÔNG render `<h1>` và KHÔNG tự thêm padding: cả hai đã thuộc
 * `ModbusRtuLayout` (FE-MB-02, FE-MB-03).
 */
export function PointsPage() {
  const [devices, setDevices] = useState<ModbusRTUDevice[]>([])
  const [points, setPoints] = useState<ModbusRTUPoint[]>([])
  const [runtimeQuality, setRuntimeQuality] = useState<Record<string, PointQuality>>({})
  const [point, setPoint] = useState<ModbusRTUPoint>(emptyPoint)
  const [editingPoint, setEditingPoint] = useState(false)
  const [status, setStatus] = useState('')
  /* D-08: xoá phải qua xác nhận. Trước đây nút Xoá gọi thẳng API trong onClick,
   * và vì mỗi mutation đều apply + restart iobus (D-09), một cú nhấp nhầm vừa
   * mất cấu hình vừa gián đoạn I/O. */
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [writingPoint, setWritingPoint] = useState<PendingWrite | null>(null)
  const [testWriting, setTestWriting] = useState(false)

  /* Đ-04: Viewer/Operator xem được, chỉ Admin sửa cấu hình. FE disable control
   * để không mời người dùng vào thao tác chắc chắn bị server từ chối 403; server
   * vẫn là nơi quyết định cuối. */
  const { session } = useAuth()
  const canEdit = roleAtLeast(session?.role, 'admin')
  const canCommission = roleAtLeast(session?.role, 'operator')
  const readOnlyHint = canEdit ? undefined : READ_ONLY_HINT

  async function reload() {
    const [nextDevices, nextPoints] = await Promise.all([apiClient.getModbusDevices(), apiClient.getModbusPoints()])
    setDevices(nextDevices)
    setPoints(nextPoints)
    setPoint((current) => (current.device_id || !nextDevices[0] ? current : { ...current, device_id: nextDevices[0].device_id }))
    /* D-07: thiếu telemetry KHÔNG được hiển thị thành BAD. Lỗi ở đây chỉ có
     * nghĩa "FE chưa lấy được", nên bảng phải hiện — chứ không phải báo động. */
    try {
      const live = await apiClient.getPoints()
      setRuntimeQuality(Object.fromEntries(live.filter((item) => item.kind === 'modbus_rtu').map((item) => [item.id, item.quality])))
    } catch {
      setRuntimeQuality({})
    }
  }

  useEffect(() => {
    reload().catch((error: Error) => setStatus(error.message))
  }, [])

  async function savePoint(event: FormEvent) {
    event.preventDefault()
    setStatus('Đang áp dụng cấu hình Point…')
    try {
      if (editingPoint) await apiClient.updateModbusPoint(point)
      else await apiClient.createModbusPoint(point)
      setPoint({ ...emptyPoint, device_id: devices[0]?.device_id ?? '' })
      setEditingPoint(false)
      await reload()
      setStatus('Đã áp dụng Point Manager vào Core Point Table.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Không thể lưu Point')
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await apiClient.deleteModbusPoint(pendingDelete.id)
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

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-xl font-bold text-[var(--c-text)]">Modbus RTU · Quản lý Point</h2>
        <p className="mt-1 text-xs text-[var(--c-text-dim)]">
          Ánh xạ thanh ghi Modbus RTU sang Point Table của Core. Mỗi lần lưu đều validate, tăng revision và áp cấu hình có rollback.
        </p>
      </header>

      {status && (
        <div role="status" className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm">
          {status}
        </div>
      )}

      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4">
        <h3 className="text-base font-semibold text-[var(--c-text)]">
          {editingPoint ? `Sửa Point: ${point.display_name} (${point.point_id})` : 'Thêm Point mới'}
        </h3>
        <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={savePoint}>
          <input className={inputClass} aria-label="Point ID" placeholder="Point ID (ổn định)" value={point.point_id} disabled={editingPoint} onChange={(e) => setPoint({ ...point, point_id: e.target.value })} />
          <select required className={inputClass} aria-label="Thiết bị" value={point.device_id} onChange={(e) => setPoint({ ...point, device_id: e.target.value })}>
            <option value="">Chọn thiết bị</option>
            {devices.map((row) => <option key={row.device_id} value={row.device_id}>{row.display_name}</option>)}
          </select>
          <input required className={inputClass} aria-label="Tag name" placeholder="Tag name unique" value={point.tag_name} onChange={(e) => setPoint({ ...point, tag_name: e.target.value })} />
          <input required className={inputClass} aria-label="Display name" placeholder="Display name" value={point.display_name} onChange={(e) => setPoint({ ...point, display_name: e.target.value })} />
          <select className={inputClass} aria-label="Register type" value={point.register_type} onChange={(e) => setPoint({ ...point, register_type: e.target.value as ModbusRTUPoint['register_type'] })}>
            <option value="coil">Coil</option>
            <option value="discrete_input">Discrete Input</option>
            <option value="input_register">Input Register</option>
            <option value="holding_register">Holding Register</option>
          </select>
          <input type="number" min={0} max={65535} className={inputClass} aria-label="Address" value={point.address} onChange={(e) => setPoint({ ...point, address: Number(e.target.value) })} />
          <select className={inputClass} aria-label="Data type" value={point.data_type} onChange={(e) => setPoint({ ...point, data_type: e.target.value as ModbusRTUPoint['data_type'] })}>
            {['bool', 'int16', 'uint16', 'int32', 'uint32', 'float32'].map((value) => <option key={value}>{value}</option>)}
          </select>
          <select className={inputClass} aria-label="Byte order" value={point.byte_order} onChange={(e) => setPoint({ ...point, byte_order: e.target.value as ModbusRTUPoint['byte_order'] })}>
            <option value="big">Big-endian byte</option>
            <option value="little">Little-endian byte</option>
          </select>
          <select className={inputClass} aria-label="Word order" value={point.word_order} onChange={(e) => setPoint({ ...point, word_order: e.target.value as ModbusRTUPoint['word_order'] })}>
            <option value="high_low">High word → Low word</option>
            <option value="low_high">Low word → High word</option>
          </select>
          <input type="number" step="any" className={inputClass} aria-label="Scale" placeholder="Scale" value={point.scale} onChange={(e) => setPoint({ ...point, scale: Number(e.target.value) })} />
          <input type="number" step="any" className={inputClass} aria-label="Offset" placeholder="Offset" value={point.offset} onChange={(e) => setPoint({ ...point, offset: Number(e.target.value) })} />
          <input className={inputClass} aria-label="Unit" placeholder="Unit" value={point.unit} onChange={(e) => setPoint({ ...point, unit: e.target.value })} />
          <select className={inputClass} aria-label="Read write" value={point.read_write} onChange={(e) => setPoint({ ...point, read_write: e.target.value as ModbusRTUPoint['read_write'] })}>
            <option value="read">Read</option>
            <option value="read_write">Read/Write</option>
          </select>
          <input type="number" step="any" className={inputClass} aria-label="Default value" placeholder="Default value" value={Number(point.default_value)} onChange={(e) => setPoint({ ...point, default_value: Number(e.target.value) })} />
          <input type="number" step="any" className={inputClass} aria-label="Safe value" placeholder="Safe value" value={Number(point.safe_value)} onChange={(e) => setPoint({ ...point, safe_value: Number(e.target.value) })} />
          <label className="flex h-10 items-center gap-2 text-xs font-semibold text-[var(--c-text)]">
            <input type="checkbox" checked={point.enabled} onChange={(e) => setPoint({ ...point, enabled: e.target.checked })} />
            Kích hoạt (Enabled)
          </label>
          <div className="flex gap-2">
            <button className={buttonClass} type="submit" disabled={!canEdit} title={readOnlyHint}>{editingPoint ? 'Cập nhật' : 'Thêm Point'}</button>
            {editingPoint && (
              <button
                className={buttonClass}
                type="button"
                onClick={() => {
                  setPoint({ ...emptyPoint, device_id: devices[0]?.device_id ?? '' })
                  setEditingPoint(false)
                }}
              >
                Huỷ
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--c-border)] text-xs text-[var(--c-text-dim)]">
                <th className="py-2">Point ID / Tag</th>
                <th className="py-2">Tên</th>
                <th className="py-2">Register</th>
                <th className="py-2">Kiểu / endian</th>
                <th className="py-2">Scale + offset</th>
                <th className="py-2">Quality</th>
                <th className="py-2">R/W</th>
                <th className="py-2 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {points.map((row) => (
                <tr key={row.point_id} className="border-b border-[var(--c-border)] hover:bg-[var(--c-surface-2)]/40">
                  <td className="py-3 font-mono text-xs font-bold text-[var(--c-text)]">
                    {row.point_id}<br /><span className="font-normal text-[var(--c-text-dim)]">{row.tag_name}</span>
                  </td>
                  <td className="py-3 font-semibold text-[var(--c-text)]">{row.display_name}</td>
                  <td className="py-3 text-xs">{row.register_type} @{row.address}</td>
                  <td className="py-3 text-xs">{row.data_type} · {row.byte_order}/{row.word_order}</td>
                  <td className="py-3 text-xs">{row.scale}x + {row.offset} {row.unit}</td>
                  {/* D-07: chưa lấy được telemetry thì hiện "—", KHÔNG suy ra BAD. */}
                  <td className="py-3 text-xs font-semibold">{runtimeQuality[row.point_id]?.toUpperCase() ?? NO_DATA}</td>
                  <td className="py-3 text-xs">{row.read_write}</td>
                  <td className="py-3 text-right space-x-2">
                    <button
                      className={buttonClass + ' text-xs h-8 px-3'}
                      disabled={!canEdit}
                      title={readOnlyHint}
                      onClick={() => {
                        setPoint(row)
                        setEditingPoint(true)
                      }}
                    >
                      Sửa
                    </button>
                    {row.read_write === 'read_write' && (
                      <button
                        className={buttonClass + ' text-xs h-8 px-3'}
                        disabled={!canCommission}
                        title={canCommission ? undefined : 'Cần vai trò Operator hoặc Admin để ghi thử'}
                        onClick={() => setWritingPoint({ point_id: row.point_id, label: `${row.display_name} (${row.point_id})`, value: Number(row.default_value ?? 0) })}
                      >
                        Ghi thử
                      </button>
                    )}
                    <button
                      className={buttonClass + ' text-xs h-8 px-3 text-red-600 dark:text-red-400'}
                      disabled={!canEdit}
                      title={readOnlyHint}
                      onClick={() => setPendingDelete({ id: row.point_id, label: `${row.tag_name} (${row.point_id})` })}
                    >
                      Xoá
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {points.length === 0 && (
            <p className="mt-4 text-center text-xs text-[var(--c-text-dim)]">Chưa có Modbus RTU Point nào.</p>
          )}
        </div>
      </section>

      {pendingDelete && (
        <div role="dialog" aria-modal="true" aria-labelledby="mb-point-del" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-5 space-y-3">
            <h3 id="mb-point-del" className="text-lg font-semibold text-[var(--c-text)]">Xoá Modbus RTU Point?</h3>
            <p className="text-sm text-[var(--c-text)]">{pendingDelete.label}</p>
            <p className="text-xs text-[var(--c-text-dim)]">Thao tác này áp dụng cấu hình mới vào iobus ngay lập tức.</p>
            <div className="flex justify-end gap-2 pt-2">
              <button className={buttonClass} type="button" onClick={() => setPendingDelete(null)} disabled={deleting}>Huỷ</button>
              <button className={buttonClass + ' bg-red-600 text-white hover:bg-red-700'} type="button" onClick={confirmDelete} disabled={deleting}>
                {deleting ? 'Đang xoá…' : 'Xoá'}
              </button>
            </div>
          </div>
        </div>
      )}

      {writingPoint && (
        <div role="dialog" aria-modal="true" aria-labelledby="mb-write-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-5">
            <h3 id="mb-write-title" className="text-lg font-semibold text-[var(--c-text)]">Ghi thử Modbus RTU Point</h3>
            <p className="mt-2 text-sm text-[var(--c-text)]">{writingPoint.label}</p>
            <div className="mt-4 space-y-2">
              <label className="block text-xs font-semibold text-[var(--c-text-dim)]" htmlFor="mb-write-value">Giá trị cần ghi</label>
              <input
                id="mb-write-value"
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
