import { Database, Network, Save, Server, Wifi } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { apiClient } from '../api/client'
import { Button } from '../components/Button'
import { Panel } from '../components/Panel'
import { StateBlock } from '../components/StateBlock'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/Toast'
import { useApi } from '../hooks/useApi'
import { useI18n } from '../i18n'
import type { ModbusSlave, NetworkConfig, PollState } from '../types'

const inputClass = 'mt-2 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm outline-none transition focus:border-[var(--c-accent)]'

const pollStateClass: Record<PollState, string> = {
  online: 'bg-[rgba(47,164,90,0.10)]',
  degraded: 'bg-[rgba(232,181,0,0.14)]',
  offline: 'bg-[rgba(213,32,42,0.12)]'
}

export function NetworkPage() {
  const toast = useToast()
  const { locale, pick } = useI18n()
  const networkState = useApi(apiClient.getNetwork, [], { refreshMs: 1000 })
  const [config, setConfig] = useState<NetworkConfig | null>(null)
  const networkData = networkState.data
  const slaves = networkData?.southbound ?? []
  const onlineSlaves = slaves.filter((slave) => slave.pollState === 'online').length
  const healthyPolls = slaves.length ? Math.round(((slaves.length - slaves.filter((slave) => slave.pollState === 'offline').length) / slaves.length) * 100) : 0

  useEffect(() => {
    if (networkData) setConfig(networkData.northbound)
  }, [networkData])

  function setConfigField<K extends keyof NetworkConfig>(field: K, value: NetworkConfig[K]) {
    setConfig((current) => current ? { ...current, [field]: value } : current)
  }

  async function saveConfig() {
    if (!config) return
    try {
      await apiClient.saveNetwork({ northbound: config, southbound: slaves })
      toast.push('success', pick('Đã lưu cấu hình mạng', 'Network settings saved'))
      await networkState.refetch()
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : 'Save failed')
    }
  }

  if (networkState.loading && !config) return <StateBlock state="loading" title={pick('Đang tải cấu hình mạng', 'Loading network settings')} />
  if (networkState.error && !config) return <StateBlock state="error" title={pick('Không tải được cấu hình mạng', 'Could not load network settings')} detail={networkState.error.message} onRetry={networkState.refetch} />
  if (!config) return <StateBlock state="empty" title={pick('Chưa có cấu hình mạng', 'No network settings')} />

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{pick('Mạng', 'Network')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('BACnet/IP lên BMS · Modbus RTU master xuống thiết bị phụ', 'BACnet/IP up to BMS · Modbus RTU master down to field devices')}</p>
        </div>
        <StatusBadge state={config.bmsLink} label={`BMS ${config.bmsLink.toUpperCase()}`} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Stat icon={<Server className="h-5 w-5" />} label="Device" value={config.deviceName || config.bacnetDeviceName || 'N/A'} />
        <Stat icon={<Network className="h-5 w-5" />} label="BACnet/IP UDP" value={config.bacnetPort ? String(config.bacnetPort) : 'N/A'} />
        <Stat icon={<Database className="h-5 w-5" />} label="Modbus slaves" value={`${onlineSlaves}/${slaves.length} online`} />
        <Stat icon={<Wifi className="h-5 w-5" />} label="Poll health" value={`${healthyPolls}%`} warn={healthyPolls < 100} />
      </div>

      <Panel title="NORTHBOUND - BACnet/IP lên BMS" subtitle={pick('BACnet/IP server trên Ethernet/WiFi, báo dữ liệu lên BMS qua UDP port cấu hình bên dưới.', 'BACnet/IP server on Ethernet/WiFi, reporting data to BMS over the UDP port configured below.')} action={<Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={saveConfig}>{pick('Lưu cấu hình', 'Save settings')}</Button>} className="border-[var(--c-border)]">
        <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="IP Address" value={config.ip} onChange={(value) => setConfigField('ip', value)} mono />
            <Field label="Subnet Mask" value={config.subnet} onChange={(value) => setConfigField('subnet', value)} mono />
            <Field label="Gateway" value={config.gateway} onChange={(value) => setConfigField('gateway', value)} mono />
            <Field label="BACnet Device ID" value={config.bacnetDeviceId} onChange={(value) => setConfigField('bacnetDeviceId', value)} mono />
            <Field label="BACnet Device Name" value={config.bacnetDeviceName} onChange={(value) => setConfigField('bacnetDeviceName', value)} />
            <label className="block text-sm text-[var(--c-text)]">
              BACnet/IP Port
              <input
                type="number"
                min={1}
                max={65535}
                value={config.bacnetPort}
                onChange={(event) => setConfigField('bacnetPort', Number(event.target.value))}
                className={`${inputClass} mono`}
              />
            </label>
          </div>

          <div className="space-y-4 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">BMS Link</div>
                <div className="mono mt-1 text-xs text-[var(--c-text-dim)]">{config.ip} → UDP/{config.bacnetPort}</div>
              </div>
              <StatusBadge state={config.bmsLink} />
            </div>
            <Toggle label="DHCP" checked={config.dhcp} onChange={(value) => setConfigField('dhcp', value)} />
            <Toggle label="WiFi" checked={config.wifiEnabled} onChange={(value) => setConfigField('wifiEnabled', value)} />
            <div className="grid grid-cols-2 gap-3 border-t border-[var(--c-border)] pt-4 text-xs">
              <Info label="Device Name" value={config.deviceName} />
              <Info label="Serial" value="N/A" mono />
              <Info label="Firmware" value="N/A" mono />
              <Info label="Role" value="BACnet/IP server" />
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="SOUTHBOUND - RS-485 Modbus RTU Master" subtitle={pick('DDC-24 chủ động poll slave thiết bị phụ: module mở rộng I/O, remote HMI, meter, VFD.', 'DDC-24 actively polls field-device slaves: I/O expansion modules, remote HMI, meters, VFDs.')} className="border-[var(--c-border)]">
        <div className="overflow-auto rounded-[var(--radius)] border border-[var(--c-border)]">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead className="bg-[var(--c-surface-2)] text-xs text-[var(--c-text-dim)]">
              <tr>
                <Th>Addr</Th>
                <Th>Slave / Profile</Th>
                <Th>Baud rate</Th>
                <Th>Poll state</Th>
                <Th>Error rate</Th>
                <Th>Last poll</Th>
              </tr>
            </thead>
            <tbody>
              {slaves.map((slave) => <SlaveRow key={slave.address} slave={slave} locale={locale} />)}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function Field({ label, value, onChange, mono }: { label: string; value: string; onChange: (value: string) => void; mono?: boolean }) {
  return (
    <label className="block text-sm text-[var(--c-text)]">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} className={`${inputClass} ${mono ? 'mono' : ''}`} />
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 py-2 text-sm transition hover:border-[var(--c-accent)]"
    >
      <span>{label}</span>
      <span className={checked ? 'text-[var(--c-good-fg)]' : 'text-[var(--c-off)]'}>{checked ? 'ON' : 'OFF'}</span>
    </button>
  )
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[var(--c-text-dim)]">{label}</div>
      <div className={mono ? 'mono mt-1 font-semibold' : 'mt-1 font-semibold'}>{value}</div>
    </div>
  )
}

function Th({ children }: { children: ReactNode }) {
  return <th className="border-r border-[var(--c-border)] px-3 py-3 text-left font-semibold last:border-r-0">{children}</th>
}

function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`border-r border-[var(--c-border)] px-3 py-3 last:border-r-0 ${className}`}>{children}</td>
}

function SlaveRow({ slave, locale }: { slave: ModbusSlave; locale: string }) {
  return (
    <tr className={`border-t border-[var(--c-border)] ${pollStateClass[slave.pollState]}`}>
      <Td className="mono font-semibold">{slave.address}</Td>
      <Td>
        <div className="font-semibold">{slave.name}</div>
        <div className="mt-1 text-xs text-[var(--c-text-dim)]">{slave.profile}</div>
      </Td>
      <Td className="mono">{slave.baudRate.toLocaleString(locale)} bps</Td>
      <Td><StatusBadge state={slave.pollState} /></Td>
      <Td>
        <div className="mono font-semibold">{slave.errorRate.toFixed(slave.errorRate >= 10 ? 0 : 1)}%</div>
        <div className="mt-2 h-1.5 rounded-full bg-[rgba(143,161,189,0.18)]">
          <div className="h-full rounded-full bg-current text-[var(--c-warn-fg)]" style={{ width: `${Math.min(slave.errorRate, 100)}%` }} />
        </div>
      </Td>
      <Td className="mono">{slave.pollState === 'offline' ? 'timeout' : `${slave.lastPollMs} ms`}</Td>
    </tr>
  )
}

function Stat({ icon, label, value, warn }: { icon: ReactNode; label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4">
      <div className={warn ? 'flex items-center gap-3 text-[var(--c-warn-fg)]' : 'flex items-center gap-3 text-[var(--c-good-fg)]'}>
        {icon}
        <div className="mono text-xl font-bold">{value}</div>
      </div>
      <div className="mt-2 text-xs text-[var(--c-text-dim)]">{label}</div>
    </div>
  )
}
