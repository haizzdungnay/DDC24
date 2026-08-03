import { RotateCcw, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import type React from 'react'
import { apiClient } from '../../shared/api/client'
import { Button } from '../../shared/components/Button'
import { Panel } from '../../shared/components/Panel'
import { StateBlock } from '../../shared/components/StateBlock'
import { useToast } from '../../shared/components/Toast'
import { DEVICE_DEFAULTS } from '../../shared/config'
import { useApi } from '../../shared/hooks/useApi'
import { useI18n } from '../../shared/i18n'
import type { ConfigDevice } from '../../shared/types'

/**
 * Trang Thiết bị — WEB-UX-006.
 *
 * Bản trước có một nút "Lưu" chỉ làm đúng một việc:
 * `toast.push('success', 'Đã lưu cấu hình thiết bị (demo)')`. Không request nào
 * được gửi. Người vận hành đổi tên thiết bị và vị trí lắp đặt, thấy thông báo
 * xanh "Đã lưu", rời trang — và không có gì được lưu. Lần sau mở lại thấy giá
 * trị cũ thì kết luận thiết bị tự khôi phục cấu hình; hoặc tệ hơn, không mở lại
 * bao giờ và tin rằng hồ sơ bàn giao khớp với thực tế ngoài hiện trường.
 *
 * `GET/PUT /system/config/device` (RoleAdmin) đã có sẵn ở backend với đầy đủ
 * validate (`validateConfigDevice`) — nay nối vào.
 *
 * Hai thứ bị gỡ:
 * - `Chu kỳ cập nhật UI (ms)` và `Chu kỳ scan core (ms)`: không có field tương
 *   ứng trong `ConfigDevice`, và chu kỳ scan của core không cấu hình qua đường
 *   này. Để chúng trong một form có nút "Lưu" là hứa lưu một thứ không có chỗ
 *   để lưu.
 * - Khối "Mục phụ" (Bảo mật / Backup & Restore / Email / Licenses): 4 thẻ trông
 *   như nút bấm, có hiệu ứng hover, nhưng không gắn `onClick` nào. Nguyên tắc
 *   §3.1.3 của plan 45: thà gỡ còn hơn để lừa người dùng.
 */
export function SettingsPage() {
  const { pick } = useI18n()
  const toast = useToast()
  const state = useApi(apiClient.getConfigDevice, [])
  const [form, setForm] = useState<ConfigDevice | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (state.data) setForm({ ...state.data })
  }, [state.data])

  if (state.loading && !state.data) return <StateBlock state="loading" title={pick('Đang tải cấu hình thiết bị', 'Loading device configuration')} />
  if (state.error && !state.data) {
    return <StateBlock state="error" title={pick('Không tải được cấu hình thiết bị', 'Could not load device configuration')} detail={state.error.message} onRetry={state.refetch} />
  }
  if (!form) return <StateBlock state="loading" title={pick('Đang tải cấu hình thiết bị', 'Loading device configuration')} />

  const saved = state.data
  const dirty = Boolean(saved) && (
    form.deviceId !== saved?.deviceId ||
    form.deviceName !== saved?.deviceName ||
    form.description !== saved?.description ||
    form.location !== saved?.location
  )

  /* Cùng luật với `validateConfigDevice` ở backend. Kiểm ở client không thay
     backend — server vẫn từ chối — nhưng để người dùng thấy lỗi ngay tại ô nhập
     thay vì sau một vòng request hỏng. */
  const deviceNameError = form.deviceName.trim() === ''
    ? pick('Tên thiết bị không được để trống', 'Device name is required')
    : new TextEncoder().encode(form.deviceName).length > 64
      ? pick('Tên thiết bị tối đa 64 byte', 'Device name must be at most 64 bytes')
      : undefined
  const deviceIdError = !Number.isInteger(form.deviceId) || form.deviceId < 1 || form.deviceId > 4194302
    ? pick('Device ID phải là số nguyên trong 1…4194302', 'Device ID must be an integer in 1…4194302')
    : undefined
  const invalid = Boolean(deviceNameError || deviceIdError)

  function update<K extends keyof ConfigDevice>(key: K, value: ConfigDevice[K]) {
    setForm((current) => current ? { ...current, [key]: value } : current)
  }

  async function save() {
    if (!form || invalid) return
    setSaving(true)
    try {
      const result = await apiClient.putConfigDevice(form)
      for (const warning of result.warnings ?? []) toast.push('warn', warning)
      toast.push('success', pick('Đã lưu cấu hình thiết bị', 'Device configuration saved'))
      await state.refetch()
    } catch (err) {
      // Thất bại phải hiện ra như thất bại — đúng điều bản cũ không làm.
      toast.push('error', err instanceof Error ? err.message : pick('Lưu cấu hình thất bại', 'Saving configuration failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{pick('Thiết bị', 'Device')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Định danh thiết bị, lưu trong device.conf', 'Device identity, stored in device.conf')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} disabled={!dirty || saving} onClick={() => saved && setForm({ ...saved })}>
            {pick('Hoàn tác', 'Revert')}
          </Button>
          <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={saving} disabled={!dirty || invalid} onClick={() => { void save() }}>
            {pick('Lưu', 'Save')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_0.72fr]">
        <Panel title={pick('Thông tin thiết bị', 'Device information')}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label={pick('Tên thiết bị', 'Device name')} error={deviceNameError}>
              <input
                className={inputClass(Boolean(deviceNameError))}
                aria-label={pick('Tên thiết bị', 'Device name')}
                aria-invalid={Boolean(deviceNameError)}
                value={form.deviceName}
                onChange={(event) => update('deviceName', event.target.value)}
              />
            </Field>
            <Field label="Device ID (BACnet)" error={deviceIdError}>
              <input
                className={inputClass(Boolean(deviceIdError))}
                aria-label="Device ID (BACnet)"
                aria-invalid={Boolean(deviceIdError)}
                type="number"
                inputMode="numeric"
                min={1}
                max={4194302}
                value={form.deviceId}
                onChange={(event) => update('deviceId', Number(event.target.value))}
              />
            </Field>
            <Field label={pick('Vị trí lắp đặt', 'Installation location')}>
              <input
                className={inputClass(false)}
                aria-label={pick('Vị trí lắp đặt', 'Installation location')}
                value={form.location}
                onChange={(event) => update('location', event.target.value)}
              />
            </Field>
            <Field label={pick('Mô tả', 'Description')}>
              <input
                className={inputClass(false)}
                aria-label={pick('Mô tả', 'Description')}
                value={form.description}
                onChange={(event) => update('description', event.target.value)}
              />
            </Field>
          </div>
        </Panel>

        <Panel title="About">
          {/* Model / Firmware / Serial là hằng số build-time trong `productInfo`,
              không phải trạng thái đo được — hiển thị ở đây là trung thực. Ô "IP
              demo" cũ đã bị gỡ: nó đọc `VITE_DEVICE_IP` với giá trị dự phòng
              `192.168.1.100`, tức là IP của một thiết bị tưởng tượng. IP thật
              hiện ở Dashboard, lấy từ `/system/status`. */}
          <dl className="grid grid-cols-[120px_1fr] gap-y-3 text-sm">
            <dt className="text-[var(--c-text-dim)]">Model</dt><dd className="font-semibold">{DEVICE_DEFAULTS.model}</dd>
            <dt className="text-[var(--c-text-dim)]">Firmware</dt><dd className="mono">{DEVICE_DEFAULTS.firmware}</dd>
            <dt className="text-[var(--c-text-dim)]">Serial</dt><dd className="mono">{DEVICE_DEFAULTS.serial}</dd>
          </dl>
        </Panel>
      </div>
    </div>
  )
}

function inputClass(invalid: boolean): string {
  return `h-10 w-full rounded-[var(--radius)] border bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)] ${invalid ? 'border-[var(--c-fault-fg)]' : 'border-[var(--c-border)]'}`
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-[var(--c-text-dim)]">
      {label}
      <div className="mt-1">{children}</div>
      {error && <p className="mt-1 text-xs text-[var(--c-fault-fg)]">{error}</p>}
    </label>
  )
}
