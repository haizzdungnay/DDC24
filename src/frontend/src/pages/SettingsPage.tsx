import { CloudUpload, Info, KeyRound, Mail, Save } from 'lucide-react'
import { useState } from 'react'
import type React from 'react'
import { Button } from '../components/Button'
import { Panel } from '../components/Panel'
import { useToast } from '../components/Toast'
import { DEVICE_DEFAULTS } from '../config'
import { useI18n } from '../i18n'

export function SettingsPage() {
  const { pick } = useI18n()
  const toast = useToast()
  const [form, setForm] = useState({
    deviceName: DEVICE_DEFAULTS.name,
    location: 'Tủ ĐK trung tâm - Tầng 1',
    updateCycleMs: 1000,
    scanCycleMs: 100
  })

  const secondaryItems = [
    { icon: KeyRound, title: pick('Bảo mật', 'Security'), detail: pick('Tài khoản, quyền và khóa API.', 'Accounts, permissions, and API keys.') },
    { icon: CloudUpload, title: 'Backup & Restore', detail: pick('Xuất/nhập cấu hình thiết bị.', 'Export/import device configuration.') },
    { icon: Mail, title: 'Email', detail: pick('SMTP và thông báo hệ thống.', 'SMTP and system notifications.') },
    { icon: Info, title: 'Licenses', detail: pick('Thông tin bản quyền và thư viện.', 'License and library information.') }
  ]

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{pick('Thiết bị', 'Device')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Cấu hình định danh và chu kỳ vận hành thiết bị', 'Device identity and operating cycle configuration')}</p>
        </div>
        <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={() => toast.push('success', pick('Đã lưu cấu hình thiết bị (demo)', 'Device settings saved (demo)'))}>{pick('Lưu', 'Save')}</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_0.72fr]">
        <Panel title={pick('Thông tin thiết bị', 'Device information')}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label={pick('Tên thiết bị', 'Device name')}>
              <input className="h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]" value={form.deviceName} onChange={(event) => update('deviceName', event.target.value)} />
            </Field>
            <Field label={pick('Vị trí', 'Location')}>
              <input className="h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]" value={form.location} onChange={(event) => update('location', event.target.value)} />
            </Field>
            <Field label={pick('Chu kỳ cập nhật UI (ms)', 'UI update cycle (ms)')}>
              <input className="h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]" type="number" min={250} step={250} value={form.updateCycleMs} onChange={(event) => update('updateCycleMs', Number(event.target.value))} />
            </Field>
            <Field label={pick('Chu kỳ scan core (ms)', 'Core scan cycle (ms)')}>
              <input className="h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]" type="number" min={20} step={10} value={form.scanCycleMs} onChange={(event) => update('scanCycleMs', Number(event.target.value))} />
            </Field>
          </div>
        </Panel>

        <Panel title="About">
          <dl className="grid grid-cols-[120px_1fr] gap-y-3 text-sm">
            <dt className="text-[var(--c-text-dim)]">Model</dt><dd className="font-semibold">{DEVICE_DEFAULTS.model}</dd>
            <dt className="text-[var(--c-text-dim)]">Name</dt><dd>{form.deviceName}</dd>
            <dt className="text-[var(--c-text-dim)]">Firmware</dt><dd className="mono">{DEVICE_DEFAULTS.firmware}</dd>
            <dt className="text-[var(--c-text-dim)]">Serial</dt><dd className="mono">{DEVICE_DEFAULTS.serial}</dd>
            <dt className="text-[var(--c-text-dim)]">BACnet ID</dt><dd className="mono">{DEVICE_DEFAULTS.bacnetDeviceId}</dd>
            <dt className="text-[var(--c-text-dim)]">IP demo</dt><dd className="mono">{DEVICE_DEFAULTS.ip}</dd>
          </dl>
        </Panel>
      </div>

      <Panel title={pick('Mục phụ', 'Secondary items')}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {secondaryItems.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.title} type="button" className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4 text-left transition hover:bg-[var(--c-surface-2)]">
                <Icon className="h-5 w-5 text-[var(--c-accent)]" />
                <div className="mt-3 font-semibold">{item.title}</div>
                <div className="mt-1 text-xs text-[var(--c-text-dim)]">{item.detail}</div>
              </button>
            )
          })}
        </div>
      </Panel>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-[var(--c-text-dim)]">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  )
}