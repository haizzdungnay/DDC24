import { useEffect, useState, type FormEvent } from 'react'
import { useAuth, roleAtLeast } from '../../auth'
import { apiClient } from '../../../shared/api/client'
import { useI18n } from '../../../shared/i18n'
import type { ModbusAddressConvention, ModbusImportError, ModbusRTUDevice, ModbusRTUPoint, ModbusTemplate } from '../../../shared/types'
import { NO_DATA, buttonClass, emptyPoint, inputClass, readOnlyHint } from '../shared'
import { Field } from '../components/Field'
import { displayAddress, normalizeConvention, storedAddress, vendorRange, vendorReference } from '../addressConvention'
import { RegisterPreview } from '../components/RegisterPreview'
import { useModbusRuntime } from '../useModbusRuntime'

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
  const { lang, pick } = useI18n()
  const [devices, setDevices] = useState<ModbusRTUDevice[]>([])
  const [points, setPoints] = useState<ModbusRTUPoint[]>([])
  /* MBR-B310: giá trị runtime đến từ WebSocket, không còn poll 5 s một lần.
   * Hook tự lấy ảnh đầy đủ khi kết nối lại — trộn delta lên nền cũ sẽ cho ra
   * bảng nửa mới nửa cũ, sai mà trông vẫn hợp lý. */
  const runtime = useModbusRuntime()
  const [point, setPoint] = useState<ModbusRTUPoint>(emptyPoint)
  /* `T57-3.11`: mẫu thiết bị chỉ ĐIỀN SẴN form, không tự lưu. Người dùng vẫn đi
     qua đúng đường Thêm Point như thường — mẫu là phím tắt gõ, không phải một
     đường ghi cấu hình riêng. */
  const [templates, setTemplates] = useState<ModbusTemplate[]>([])
  const [templateId, setTemplateId] = useState('')
  const [editingPoint, setEditingPoint] = useState(false)
  /* `ISS-PIO-21` — ba giá trị suy ra từ điểm đang soạn, để phần JSX bên dưới
     chỉ còn việc hiển thị. Tách ra vì cả ba đều phải đổi ĐỒNG THỜI khi người
     dùng đổi kiểu thanh ghi: cùng một con số mang nghĩa khác giữa hai vùng. */
  const convention = normalizeConvention(point.address_convention)
  const addressShown = displayAddress(convention, point.register_type, point.address) ?? point.address
  const addressRange = vendorRange(point.register_type)
  const addressCrossReference = (() => {
    const reference = vendorReference(point.register_type, point.address)
    if (reference === undefined) {
      return pick('Không đối chiếu được sang số datasheet cho kiểu thanh ghi này.', 'No datasheet reference for this register type.')
    }
    // Hiện CẢ HAI dạng cạnh nhau — điều kiện đóng thứ hai của issue. Người dùng
    // không phải tin vào phép trừ trong đầu mình nữa.
    return pick(`Offset protocol ${point.address} · datasheet ${reference}`, `Protocol offset ${point.address} · datasheet ${reference}`)
  })()
  const addressHint = addressRange
    ? pick(`Nhập theo quy ước đã chọn. Vùng này nhận ${convention === 'vendor' ? `${addressRange.base}–${addressRange.base + addressRange.maxOffset}` : `0–${addressRange.maxOffset}`}.`,
        `Enter using the selected convention. This area accepts ${convention === 'vendor' ? `${addressRange.base}–${addressRange.base + addressRange.maxOffset}` : `0–${addressRange.maxOffset}`}.`)
    : pick('Chọn kiểu thanh ghi trước.', 'Pick a register type first.')
  const [status, setStatus] = useState('')
  /* D-08: xoá phải qua xác nhận. Trước đây nút Xoá gọi thẳng API trong onClick,
   * và vì mỗi mutation đều apply + restart iobus (D-09), một cú nhấp nhầm vừa
   * mất cấu hình vừa gián đoạn I/O. */
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [writingPoint, setWritingPoint] = useState<PendingWrite | null>(null)
  const [testWriting, setTestWriting] = useState(false)
  const [importErrors, setImportErrors] = useState<ModbusImportError[]>([])

  /* Đ-04: Viewer/Operator xem được, chỉ Admin sửa cấu hình. FE disable control
   * để không mời người dùng vào thao tác chắc chắn bị server từ chối 403; server
   * vẫn là nơi quyết định cuối. */
  const { session } = useAuth()
  const canEdit = roleAtLeast(session?.role, 'admin')
  const canCommission = roleAtLeast(session?.role, 'operator')
  const readOnlyHintText = canEdit ? undefined : readOnlyHint(lang)

  async function reload() {
    const [nextDevices, nextPoints] = await Promise.all([apiClient.getModbusDevices(), apiClient.getModbusPoints()])
    setDevices(nextDevices)
    setPoints(nextPoints)
    setPoint((current) => (current.device_id || !nextDevices[0] ? current : { ...current, device_id: nextDevices[0].device_id }))
  }

  useEffect(() => {
    reload().catch((error: Error) => setStatus(error.message))
  }, [])

  /* `T57-3.11`: tải mẫu một lần. Lỗi tải KHÔNG được làm hỏng trang — mẫu là
     phím tắt, còn form khai điểm phải luôn dùng được. */
  useEffect(() => {
    let alive = true
    /* Bọc `Promise.resolve().then` để một lỗi ĐỒNG BỘ (client cũ chưa có hàm)
       cũng rơi vào nhánh catch thay vì ném ra ngoài và hạ cả trang khai Point. */
    Promise.resolve().then(() => apiClient.getModbusTemplates())
      .then((list) => { if (alive) setTemplates(list) })
      .catch(() => { if (alive) setTemplates([]) })
    return () => { alive = false }
  }, [])

  /** Điền form từ ĐIỂM ĐẦU của mẫu.
   *
   *  Không tự tạo hàng loạt điểm: mẫu nhiều điểm sẽ ghi đè thứ người dùng đang
   *  gõ dở và tạo ra một loạt bản ghi họ chưa từng xem. Điền một điểm, người
   *  dùng bấm Thêm, rồi chọn tiếp — mỗi bản ghi đều đi qua mắt người. */
  function applyTemplate(id: string) {
    setTemplateId(id)
    const template = templates.find((item) => item.id === id)
    const first = template?.points[0]
    if (!first) return
    setPoint((current) => ({
      ...current,
      tag_name: first.name,
      display_name: first.name,
      register_type: first.fc === 1 ? 'coil' : first.fc === 2 ? 'discrete_input' : first.fc === 4 ? 'input_register' : 'holding_register',
      address: first.addr,
      data_type: (['bool', 'int16', 'uint16', 'int32', 'uint32', 'float32'].includes(first.type) ? first.type : 'uint16') as ModbusRTUPoint['data_type'],
      /* `byte_order` của mẫu ("ABCD") mô tả CẢ thứ tự byte lẫn thứ tự word, còn
         hợp đồng Point tách làm hai trường. Chỉ ánh xạ trường hợp chắc chắn;
         dạng lạ thì giữ nguyên mặc định thay vì đoán. */
      byte_order: first.byte_order === 'DCBA' || first.byte_order === 'BADC' ? 'little' : 'big',
      word_order: first.byte_order === 'CDAB' || first.byte_order === 'DCBA' ? 'low_high' : 'high_low',
      scale: first.scale ?? 1,
      offset: first.offset ?? 0,
      unit: first.unit ?? '',
      read_write: first.writable ? 'read_write' : 'read'
    }))
  }

  async function savePoint(event: FormEvent) {
    event.preventDefault()
    setStatus(pick('Đang áp dụng cấu hình Point…', 'Applying Point configuration…'))
    try {
      if (editingPoint) await apiClient.updateModbusPoint(point)
      else await apiClient.createModbusPoint(point)
      setPoint({ ...emptyPoint, device_id: devices[0]?.device_id ?? '' })
      setEditingPoint(false)
      await reload()
      setStatus(pick('Đã áp dụng Point Manager vào Core Point Table.', 'Point Manager applied to the Core Point Table.'))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : pick('Không thể lưu Point', 'Could not save the Point'))
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await apiClient.deleteModbusPoint(pendingDelete.id)
      setPendingDelete(null)
      await reload()
      setStatus(pick(`Đã xoá ${pendingDelete.label}.`, `Deleted ${pendingDelete.label}.`))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : pick('Không thể xoá', 'Could not delete'))
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
      setStatus(pick(
        `Ghi thử ${writingPoint.label} thành công (giá trị ghi nhận: ${res.applied_value}).`,
        `Test write for ${writingPoint.label} succeeded (recorded value: ${res.applied_value}).`
      ))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : pick('Không thể thực hiện ghi thử', 'Could not perform the test write'))
    } finally {
      setTestWriting(false)
    }
  }

  async function downloadExport(format: 'csv' | 'json') {
    try {
      const content = await apiClient.exportModbusConfig(format)
      const blob = new Blob([content], { type: format === 'csv' ? 'text/csv' : 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = format === 'csv' ? 'modbus-points.csv' : 'modbus-config.json'
      anchor.click()
      URL.revokeObjectURL(url)
      setStatus(pick(`Đã xuất ${format.toUpperCase()}.`, `Exported ${format.toUpperCase()}.`))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : pick('Không xuất được cấu hình', 'Could not export the configuration'))
    }
  }

  async function importFile(file: File) {
    setImportErrors([])
    const format: 'csv' | 'json' = file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv'
    try {
      const content = await file.text()
      const result = await apiClient.importModbusConfig(format, content)
      if (result.result !== 'staged') {
        setImportErrors(result.errors ?? [{ message: pick('File bị từ chối', 'File was rejected') }])
        setStatus(pick('File nhập bị từ chối — không dòng nào được nạp.', 'The imported file was rejected — no rows were loaded.'))
        return
      }
      setStatus(pick(
        `Đã nạp ${result.point_count ?? 0} Point vào bản nháp. Bấm "Áp dụng" ở băng trạng thái để phát xuống thiết bị.`,
        `Loaded ${result.point_count ?? 0} Point(s) into the draft. Click "Apply" on the status bar to push them to the device.`
      ))
      await reload()
    } catch (error) {
      setImportErrors([{ message: error instanceof Error ? error.message : pick('Không đọc được file', 'Could not read the file') }])
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-xl font-bold text-[var(--c-text)]">{pick('Modbus RTU · Quản lý Point', 'Modbus RTU · Point Management')}</h2>
        <p className="mt-1 text-xs text-[var(--c-text-dim)]">
          {pick(
            'Ánh xạ thanh ghi Modbus RTU sang Point Table của Core. Mỗi lần lưu đều validate, tăng revision và áp cấu hình có rollback.',
            'Maps Modbus RTU registers to the Core Point Table. Every save validates, bumps the revision, and applies with rollback support.'
          )}
        </p>
      </header>

      {status && (
        <div role="status" className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm">
          {status}
        </div>
      )}

      {/* Số cũ mà không nói là cũ thì tệ hơn không hiện gì: người vận hành sẽ
          quyết định dựa trên một giá trị không còn đúng. */}
      {!runtime.live && runtime.staleReason && (
        <div role="note" data-testid="runtime-stale"
          className="rounded-[var(--radius)] border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-[var(--c-text)]">
          {pick('Cột "Quality" không phải số trực tiếp', 'The "Quality" column is not a live figure')}: {runtime.staleReason}.
        </div>
      )}

      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4">
        <h3 className="text-base font-semibold text-[var(--c-text)]">
          {editingPoint ? pick(`Sửa Point: ${point.display_name} (${point.point_id})`, `Edit Point: ${point.display_name} (${point.point_id})`) : pick('Thêm Point mới', 'Add new Point')}
        </h3>
        <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={savePoint}>
          <Field label="Point ID" hint={pick('Định danh ổn định của Point. Để trống thì hệ thống tự sinh.', 'The stable identifier of the Point. Leave empty to auto-generate.')}>
            <input className={inputClass} aria-label="Point ID" placeholder={pick('Point ID (ổn định)', 'Point ID (stable)')} value={point.point_id} disabled={editingPoint} onChange={(e) => setPoint({ ...point, point_id: e.target.value })} />
          </Field>
          <Field label={pick('Thiết bị', 'Device')} hint={pick('Point này đọc từ thiết bị nào.', 'Which device this Point reads from.')}>
            <select required className={inputClass} aria-label={pick('Thiết bị', 'Device')} value={point.device_id} onChange={(e) => setPoint({ ...point, device_id: e.target.value })}>
            <option value="">{pick('Chọn thiết bị', 'Select a device')}</option>
            {devices.map((row) => <option key={row.device_id} value={row.device_id}>{row.display_name}</option>)}
            </select>
          </Field>
          <Field label="Tag name" hint={pick('Tên duy nhất toàn hệ, dùng để tham chiếu Point trong logic và BACnet.', 'A system-wide unique name, used to reference the Point in logic and BACnet.')}>
            <input required className={inputClass} aria-label="Tag name" placeholder="Tag name unique" value={point.tag_name} onChange={(e) => setPoint({ ...point, tag_name: e.target.value })} />
          </Field>
          <Field label={pick('Tên hiển thị', 'Display name')} hint={pick('Tên cho người vận hành đọc.', 'Name for the operator to read.')}>
            <input required className={inputClass} aria-label="Display name" placeholder="Display name" value={point.display_name} onChange={(e) => setPoint({ ...point, display_name: e.target.value })} />
          </Field>
          <Field label={pick('Loại thanh ghi', 'Register type')} hint="coil / discrete input / holding register / input register.">
            <select className={inputClass} aria-label="Register type" value={point.register_type} onChange={(e) => setPoint({ ...point, register_type: e.target.value as ModbusRTUPoint['register_type'] })}>
            <option value="coil">Coil</option>
            <option value="discrete_input">Discrete Input</option>
            <option value="input_register">Input Register</option>
            <option value="holding_register">Holding Register</option>
            </select>
          </Field>
          {/* `ISS-PIO-21` (đề bài §23) — quy ước địa chỉ.
              Trước bản vá ô nhập ghi thẳng "nhiều tài liệu đánh số từ 1 — trừ đi
              1 khi nhập", tức sản phẩm biết vấn đề tồn tại và giao phép trừ cho
              người dùng làm bằng tay. Sai một đơn vị ở đây không làm gì hỏng ồn
              ào: điểm vẫn đọc, quality vẫn GOOD — chỉ là đọc thanh ghi bên cạnh. */}
          <Field label={pick('Quy ước địa chỉ', 'Address convention')} hint={pick('Chọn cách bạn đang đọc datasheet. Giá trị lưu xuống LUÔN là offset protocol, bất kể chọn gì.', 'Pick how you are reading the datasheet. The stored value is ALWAYS the protocol offset, whichever you pick.')}>
            <select className={inputClass} aria-label="Address convention" value={convention}
              onChange={(e) => setPoint({ ...point, address_convention: e.target.value as ModbusAddressConvention })}>
              <option value="protocol">{pick('Offset protocol (0-based)', 'Protocol offset (0-based)')}</option>
              <option value="vendor">{pick('Tham chiếu datasheet (4xxxx…)', 'Vendor reference (4xxxx…)')}</option>
            </select>
          </Field>
          <Field label={pick('Địa chỉ thanh ghi', 'Register address')} hint={addressHint}>
            <input type="number" className={inputClass} aria-label="Address" value={addressShown}
              onChange={(e) => {
                const typed = Number(e.target.value)
                const stored = storedAddress(convention, point.register_type, typed)
                /* Số không thuộc vùng của kiểu thanh ghi đang chọn thì KHÔNG ghi
                   bừa một offset: gõ `40102` khi đang chọn Input Register là một
                   mâu thuẫn có thật, và nhận nó sẽ cho ra một offset hợp lệ trỏ
                   vào chỗ khác. Giữ nguyên giá trị cũ và để dòng đối chiếu bên
                   dưới nói ra. */
                if (stored === undefined) return
                setPoint({ ...point, address: stored })
              }} />
            <p className="mt-1 text-xs text-[var(--c-text-dim)]" data-testid="address-cross-reference">{addressCrossReference}</p>
          </Field>
          <Field label={pick('Kiểu dữ liệu', 'Data type')} hint={pick('Quyết định Point chiếm 1 hay 2 thanh ghi.', 'Determines whether the Point occupies 1 or 2 registers.')}>
            <select className={inputClass} aria-label="Data type" value={point.data_type} onChange={(e) => setPoint({ ...point, data_type: e.target.value as ModbusRTUPoint['data_type'] })}>
            {['bool', 'int16', 'uint16', 'int32', 'uint32', 'float32'].map((value) => <option key={value}>{value}</option>)}
            </select>
          </Field>
          <Field label={pick('Thứ tự byte', 'Byte order')} hint={pick('Big-endian là mặc định của Modbus. Sai thứ tự cho ra số vô lý mà không có lỗi nào.', 'Big-endian is the Modbus default. A wrong order produces a nonsensical value with no error.')}>
            <select className={inputClass} aria-label="Byte order" value={point.byte_order} onChange={(e) => setPoint({ ...point, byte_order: e.target.value as ModbusRTUPoint['byte_order'] })}>
            <option value="big">Big-endian byte</option>
            <option value="little">Little-endian byte</option>
            </select>
          </Field>
          <Field label={pick('Thứ tự word', 'Word order')} hint={pick('Chỉ có tác dụng với kiểu 32-bit (2 thanh ghi).', 'Only applies to 32-bit types (2 registers).')}>
            <select className={inputClass} aria-label="Word order" value={point.word_order} onChange={(e) => setPoint({ ...point, word_order: e.target.value as ModbusRTUPoint['word_order'] })}>
            <option value="high_low">High word → Low word</option>
            <option value="low_high">Low word → High word</option>
            </select>
          </Field>
          <Field label={pick('Hệ số nhân', 'Scale factor')} hint={pick('Giá trị quy đổi = thô × hệ số + bù. Hệ số 0 bị từ chối.', 'Converted value = raw × scale + offset. A scale of 0 is rejected.')}>
            <input type="number" step="any" className={inputClass} aria-label="Scale" placeholder="Scale" value={point.scale} onChange={(e) => setPoint({ ...point, scale: Number(e.target.value) })} />
          </Field>
          <Field label={pick('Bù (offset)', 'Offset')} hint={pick('Cộng vào sau khi nhân hệ số.', 'Added after multiplying by the scale.')}>
            <input type="number" step="any" className={inputClass} aria-label="Offset" placeholder="Offset" value={point.offset} onChange={(e) => setPoint({ ...point, offset: Number(e.target.value) })} />
          </Field>
          <Field label={pick('Đơn vị', 'Unit')} hint={pick('Đơn vị kỹ thuật hiển thị, ví dụ kWh, degC.', 'The displayed engineering unit, e.g. kWh, degC.')}>
            <input className={inputClass} aria-label="Unit" placeholder="Unit" value={point.unit} onChange={(e) => setPoint({ ...point, unit: e.target.value })} />
          </Field>
          <Field label={pick('Quyền đọc/ghi', 'Read/write access')} hint={pick('Read = chỉ đọc; Read/Write cho phép ghi xuống thiết bị.', 'Read = read-only; Read/Write allows writing to the device.')}>
            <select className={inputClass} aria-label="Read write" value={point.read_write} onChange={(e) => setPoint({ ...point, read_write: e.target.value as ModbusRTUPoint['read_write'] })}>
            <option value="read">Read</option>
            <option value="read_write">Read/Write</option>
            </select>
          </Field>
          <Field label={pick('Giá trị mặc định', 'Default value')} hint={pick('Dùng khi chưa có mẫu nào.', 'Used when no sample has been received yet.')}>
            <input type="number" step="any" className={inputClass} aria-label="Default value" placeholder="Default value" value={Number(point.default_value)} onChange={(e) => setPoint({ ...point, default_value: Number(e.target.value) })} />
          </Field>
          <Field label={pick('Giá trị an toàn', 'Safe value')} hint={pick('Giá trị đưa về khi vào trạng thái an toàn.', 'The value applied when entering the safe state.')}>
            <input type="number" step="any" className={inputClass} aria-label="Safe value" placeholder="Safe value" value={Number(point.safe_value)} onChange={(e) => setPoint({ ...point, safe_value: Number(e.target.value) })} />
          </Field>
          <label className="flex h-10 items-center gap-2 text-xs font-semibold text-[var(--c-text)]">
            <input type="checkbox" checked={point.enabled} onChange={(e) => setPoint({ ...point, enabled: e.target.checked })} />
            {pick('Kích hoạt (Enabled)', 'Enabled')}
          </label>
          {/* `T57-3.11` — chọn mẫu để điền sẵn, kèm NGUỒN của mẫu ngay cạnh:
              người dùng sẽ tin mẫu hơn tin tài liệu, nên mẫu phải tự nói nó
              đến từ đâu. */}
          {templates.length > 0 && (
            <div className="col-span-full">
              <label className="text-xs font-semibold text-[var(--c-text-dim)]">
                {pick('Điền sẵn từ mẫu thiết bị', 'Prefill from a device template')}
                <select
                  className={inputClass}
                  aria-label={pick('Mẫu thiết bị', 'Device template')}
                  value={templateId}
                  onChange={(event) => applyTemplate(event.target.value)}
                >
                  <option value="">{pick('— Không dùng mẫu —', '— No template —')}</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.manufacturer ? `${template.manufacturer} · ` : ''}{template.name}
                    </option>
                  ))}
                </select>
              </label>
              {templateId && (
                <p className="mt-1 text-xs text-[var(--c-text-dim)]">
                  {pick('Nguồn: ', 'Source: ')}
                  {templates.find((template) => template.id === templateId)?.source}
                  {' · '}
                  {templates.find((template) => template.id === templateId)?.origin === 'site'
                    ? pick('mẫu của công trình', 'site template')
                    : pick('mẫu dựng sẵn', 'built-in template')}
                  {' · '}
                  {pick('Mẫu chỉ điền sẵn; bạn vẫn phải kiểm và bấm Thêm Point.', 'The template only prefills; you still review and click Add Point.')}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button className={buttonClass} type="submit" disabled={!canEdit} title={readOnlyHintText}>{editingPoint ? pick('Cập nhật', 'Update') : pick('Thêm Point', 'Add Point')}</button>
            {editingPoint && (
              <button
                className={buttonClass}
                type="button"
                onClick={() => {
                  setPoint({ ...emptyPoint, device_id: devices[0]?.device_id ?? '' })
                  setEditingPoint(false)
                }}
              >
                {pick('Huỷ', 'Cancel')}
              </button>
            )}
          </div>
        </form>

        {/* MBR-B304: khai báo sai kiểu hoặc sai thứ tự word KHÔNG gây lỗi lúc
            lưu — nó chỉ làm số đọc ra sai theo cách trông rất hợp lý. Bản xem
            trước đưa dấu chân register và phép quy đổi lên màn hình TRƯỚC khi apply. */}
        <div className="mt-4">
          <RegisterPreview point={point} siblings={points}
            selfPointId={editingPoint ? point.point_id : undefined} />
        </div>
      </section>

      {/* MBR-B308: import đi vào BẢN NHÁP và là all-or-nothing — một dòng sai là
          cả file bị từ chối, kèm số dòng để sửa đúng chỗ. */}
      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4">
        <h3 className="text-base font-semibold text-[var(--c-text)]">{pick('Nhập / Xuất danh sách Point', 'Import / Export Point list')}</h3>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={buttonClass + ' text-xs h-9'}
            onClick={() => void downloadExport('csv')}>{pick('Xuất CSV', 'Export CSV')}</button>
          <button type="button" className={buttonClass + ' text-xs h-9'}
            onClick={() => void downloadExport('json')}>{pick('Xuất JSON', 'Export JSON')}</button>
          <label className={buttonClass + ' text-xs h-9 inline-flex cursor-pointer items-center'}>
            {pick('Nhập file…', 'Import file…')}
            <input type="file" accept=".csv,.json,text/csv,application/json" className="hidden"
              data-testid="import-input" disabled={!canEdit}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void importFile(file)
                event.target.value = ''
              }} />
          </label>
          <span className="text-xs text-[var(--c-text-dim)]">
            {pick('File nhập vào bản nháp; bấm "Áp dụng" ở băng trạng thái để phát xuống thiết bị.', 'The file loads into the draft; click "Apply" on the status bar to push it to the device.')}
          </span>
        </div>
        {importErrors.length > 0 && (
          <div role="alert" data-testid="import-errors"
            className="mt-3 rounded-[var(--radius)] border border-[var(--c-danger,#c00)]/40 bg-red-500/5 p-3 text-xs">
            <p className="font-semibold text-[var(--c-danger,#c00)]">
              {pick('File bị từ chối TOÀN BỘ — không dòng nào được nạp.', 'The file was rejected ENTIRELY — no rows were loaded.')}
            </p>
            <ul className="mt-2 space-y-1 font-mono">
              {importErrors.map((issue, index) => (
                <li key={index}>
                  {issue.line ? pick(`Dòng ${issue.line}`, `Line ${issue.line}`) : pick('File', 'File')}
                  {issue.column ? pick(` · cột ${issue.column}`, ` · column ${issue.column}`) : ''}: {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--c-border)] text-xs text-[var(--c-text-dim)]">
                <th className="py-2">Point ID / Tag</th>
                <th className="py-2">{pick('Tên', 'Name')}</th>
                <th className="py-2">Register</th>
                <th className="py-2">{pick('Kiểu / endian', 'Type / endian')}</th>
                <th className="py-2">Scale + offset</th>
                <th className="py-2">Quality</th>
                <th className="py-2">R/W</th>
                <th className="py-2 text-right">{pick('Thao tác', 'Actions')}</th>
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
                  <td className="py-3 text-xs font-semibold" data-testid={`quality-${row.point_id}`}>
                    {runtime.points[row.point_id]?.quality ?? NO_DATA}
                  </td>
                  <td className="py-3 text-xs">{row.read_write}</td>
                  <td className="py-3 text-right space-x-2">
                    <button
                      className={buttonClass + ' text-xs h-8 px-3'}
                      disabled={!canEdit}
                      title={readOnlyHintText}
                      onClick={() => {
                        setPoint(row)
                        setEditingPoint(true)
                      }}
                    >
                      {pick('Sửa', 'Edit')}
                    </button>
                    {row.read_write === 'read_write' && (
                      <button
                        className={buttonClass + ' text-xs h-8 px-3'}
                        disabled={!canCommission}
                        title={canCommission ? undefined : pick('Cần vai trò Operator hoặc Admin để ghi thử', 'Requires Operator or Admin role to test-write')}
                        onClick={() => setWritingPoint({ point_id: row.point_id, label: `${row.display_name} (${row.point_id})`, value: Number(row.default_value ?? 0) })}
                      >
                        {pick('Ghi thử', 'Test write')}
                      </button>
                    )}
                    <button
                      className={buttonClass + ' text-xs h-8 px-3 text-red-600 dark:text-red-400'}
                      disabled={!canEdit}
                      title={readOnlyHintText}
                      onClick={() => setPendingDelete({ id: row.point_id, label: `${row.tag_name} (${row.point_id})` })}
                    >
                      {pick('Xoá', 'Delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {points.length === 0 && (
            <p className="mt-4 text-center text-xs text-[var(--c-text-dim)]">{pick('Chưa có Modbus RTU Point nào.', 'No Modbus RTU Points yet.')}</p>
          )}
        </div>
      </section>

      {pendingDelete && (
        <div role="dialog" aria-modal="true" aria-labelledby="mb-point-del" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-5 space-y-3">
            <h3 id="mb-point-del" className="text-lg font-semibold text-[var(--c-text)]">{pick('Xoá Modbus RTU Point?', 'Delete Modbus RTU Point?')}</h3>
            <p className="text-sm text-[var(--c-text)]">{pendingDelete.label}</p>
            <p className="text-xs text-[var(--c-text-dim)]">{pick('Thao tác này áp dụng cấu hình mới vào iobus ngay lập tức.', 'This action applies the new configuration to iobus immediately.')}</p>
            <div className="flex justify-end gap-2 pt-2">
              <button className={buttonClass} type="button" onClick={() => setPendingDelete(null)} disabled={deleting}>{pick('Huỷ', 'Cancel')}</button>
              <button className={buttonClass + ' bg-red-600 text-white hover:bg-red-700'} type="button" onClick={confirmDelete} disabled={deleting}>
                {deleting ? pick('Đang xoá…', 'Deleting…') : pick('Xoá', 'Delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {writingPoint && (
        <div role="dialog" aria-modal="true" aria-labelledby="mb-write-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-5">
            <h3 id="mb-write-title" className="text-lg font-semibold text-[var(--c-text)]">{pick('Ghi thử Modbus RTU Point', 'Test-write Modbus RTU Point')}</h3>
            <p className="mt-2 text-sm text-[var(--c-text)]">{writingPoint.label}</p>
            <div className="mt-4 space-y-2">
              <label className="block text-xs font-semibold text-[var(--c-text-dim)]" htmlFor="mb-write-value">{pick('Giá trị cần ghi', 'Value to write')}</label>
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
              {pick('Lệnh sẽ được gửi xuống Core/iobus và đặt cờ dirty để ghi trực tiếp xuống thiết bị Modbus RTU.', 'The command will be sent to Core/iobus and set the dirty flag to write directly to the Modbus RTU device.')}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button className={buttonClass} type="button" onClick={() => setWritingPoint(null)} disabled={testWriting}>{pick('Huỷ', 'Cancel')}</button>
              <button className={buttonClass} type="button" onClick={confirmTestWrite} disabled={testWriting}>
                {testWriting ? pick('Đang ghi…', 'Writing…') : pick('Xác nhận Ghi', 'Confirm Write')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
