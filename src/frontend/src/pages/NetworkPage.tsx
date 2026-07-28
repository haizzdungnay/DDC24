import { CheckCircle2, Database, Network, Play, RotateCcw, Save, Server, ShieldCheck, Wifi } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { apiClient } from '../api/client'
import { Button } from '../components/Button'
import { Panel } from '../components/Panel'
import { StateBlock } from '../components/StateBlock'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/Toast'
import { useApi } from '../hooks/useApi'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../i18n'
import type { ModbusSlave, NetcfgCandidate, NetcfgResponse, NetcfgTransactionAction, NetworkConfig, PollState } from '../types'

const inputClass = 'mt-2 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm outline-none transition focus:border-[var(--c-accent)] disabled:cursor-not-allowed disabled:opacity-50'

type NetworkReconcile = {
  action: Exclude<NetcfgTransactionAction, 'validate'>
  baselineRequestId: string | null
  baselineFingerprint: string
  lastObservedRequestId: string | null
  stableUnchangedSamples: number
}

const pollStateClass: Record<PollState, string> = {
  online: 'bg-[rgba(47,164,90,0.10)]',
  degraded: 'bg-[rgba(232,181,0,0.14)]',
  offline: 'bg-[rgba(213,32,42,0.12)]'
}

export function NetworkPage() {
  const toast = useToast()
  const { locale, pick } = useI18n()
  const { session } = useAuth()
  const canManageNetwork = session?.role === 'admin'
  const networkState = useApi(apiClient.getNetwork, [], { refreshMs: 1000 })
  const transactionState = useApi<NetcfgResponse | null>(
    apiClient.getNetworkTransaction,
    [session?.username],
    { refreshMs: session ? 1000 : undefined }
  )
  const [config, setConfig] = useState<NetworkConfig | null>(null)
  const [candidate, setCandidate] = useState<NetcfgCandidate | null>(null)
  const [transaction, setTransaction] = useState<NetcfgResponse | null>(null)
  const [transactionBusy, setTransactionBusy] = useState<NetcfgTransactionAction | null>(null)
  const [reconcileAfter, setReconcileAfter] = useState<NetworkReconcile | null>(null)
  const candidateDirty = useRef(false)
  const previousAuthority = useRef<{ transactionId: string | null; state: NetcfgResponse['state']; draftFingerprint: string } | null>(null)
  const networkData = networkState.data
  const slaves = networkData?.southbound ?? []
  const onlineSlaves = slaves.filter((slave) => slave.pollState === 'online').length
  const healthyPolls = slaves.length ? Math.round(((slaves.length - slaves.filter((slave) => slave.pollState === 'offline').length) / slaves.length) * 100) : 0

  useEffect(() => {
    if (networkData) setConfig((current) => current ?? networkData.northbound)
  }, [networkData])

  useEffect(() => {
    const authoritative = transactionState.data
    if (!authoritative) return
    const previous = previousAuthority.current
    const transactionChanged = previous?.transactionId !== (authoritative.transactionId ?? null)
    const transactionActive = isActiveTransactionState(authoritative.state)
    const transactionCompleted = Boolean(previous && isActiveTransactionState(previous.state) && !transactionActive)
    const draftFingerprint = authorityDraftFingerprint(authoritative)
    const authoritativeDraftChanged = previous?.draftFingerprint !== draftFingerprint
    setTransaction(authoritative)
    setCandidate((current) => {
      if (transactionActive && authoritative.pending) {
        candidateDirty.current = false
        return { ...authoritative.pending }
      }
      if (!current || transactionChanged || transactionCompleted || (!candidateDirty.current && authoritativeDraftChanged)) {
        candidateDirty.current = false
        return candidateFromAuthority(authoritative)
      }
      return current
    })
    previousAuthority.current = {
      transactionId: authoritative.transactionId ?? null,
      state: authoritative.state,
      draftFingerprint
    }
  }, [transactionState.data])

  useEffect(() => {
    if (!reconcileAfter || transactionState.error || !transactionState.data) return
    const authoritative = transactionState.data
    if (authoritative.requestId === reconcileAfter.baselineRequestId || authoritative.requestId === reconcileAfter.lastObservedRequestId) return
    const fingerprint = transactionMutationFingerprint(reconcileAfter.action, authoritative)
    if (fingerprint !== reconcileAfter.baselineFingerprint || reconcileAfter.stableUnchangedSamples >= 1) {
      setReconcileAfter(null)
      return
    }
    setReconcileAfter((current) => current ? {
      ...current,
      lastObservedRequestId: authoritative.requestId,
      stableUnchangedSamples: current.stableUnchangedSamples + 1
    } : current)
  }, [reconcileAfter, transactionState.data, transactionState.error])

  function setConfigField<K extends keyof NetworkConfig>(field: K, value: NetworkConfig[K]) {
    setConfig((current) => current ? { ...current, [field]: value } : current)
  }

  function setCandidateField<K extends keyof NetcfgCandidate>(field: K, value: NetcfgCandidate[K]) {
    candidateDirty.current = true
    setCandidate((current) => current ? { ...current, [field]: value } : current)
  }

  function setCandidateMode(mode: NetcfgCandidate['mode']) {
    candidateDirty.current = true
    setCandidate((current) => current ? {
      ...current,
      mode,
      ...(mode === 'static' && current.dns?.mode === 'auto' ? { dns: undefined } : {}),
      ...(mode === 'dhcp' ? { ipv4: undefined, netmask: undefined, gateway: undefined } : {})
    } : current)
  }

  function setCandidateDnsMode(mode: NonNullable<NetcfgCandidate['dns']>['mode'] | 'preserve') {
    candidateDirty.current = true
    setCandidate((current) => current ? {
      ...current,
      dns: mode === 'preserve' ? undefined : { mode, servers: mode === 'auto' ? [] : (current.dns?.servers ?? []) }
    } : current)
  }

  function setCandidateDnsServers(value: string) {
    candidateDirty.current = true
    setCandidate((current) => current ? {
      ...current,
      dns: { mode: 'manual', servers: value.split(',').map((server) => server.trim()) }
    } : current)
  }

  async function saveServiceConfig() {
    if (!canManageNetwork || !config || !networkData) return
    const originalEthernet = networkData.northbound
    const northbound = {
      ...config,
      ip: originalEthernet.ip,
      dhcp: originalEthernet.dhcp,
      subnet: originalEthernet.subnet,
      gateway: originalEthernet.gateway
    }
    try {
      const result = await apiClient.saveNetwork({ northbound, southbound: slaves })
      if (result.applied) {
        toast.push('success', pick('Đã lưu cấu hình BACnet/WiFi', 'BACnet/WiFi settings saved'))
      } else {
        toast.push('warn', result.warnings?.join('; ') || pick('Đã lưu nhưng chưa áp dụng hết', 'Saved, but not fully applied'))
      }
      setConfig(null)
      await networkState.refetch()
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function runTransaction(action: NetcfgTransactionAction) {
    if (!canManageNetwork || !candidate || reconcileAfter) return
    const needsCandidate = action === 'validate' || action === 'stage'
    const transactionId = transaction?.transactionId
    if (action === 'apply' && (!transaction?.pending || !sameCandidate(candidate, transaction.pending))) {
      toast.push('error', pick('Candidate hiển thị không khớp giao dịch đang chờ; hãy tải lại trạng thái mạng.', 'The visible candidate does not match the pending transaction; refresh network state.'))
      return
    }
    if (!needsCandidate && !transactionId) {
      toast.push('error', pick('Thiếu mã giao dịch mạng', 'Network transaction ID is missing'))
      return
    }
    setTransactionBusy(action)
    try {
      const response = await apiClient.runNetworkTransaction(action, needsCandidate ? { candidate } : { transactionId })
      setTransaction(response)
      if (response.result === 'rejected') {
        toast.push('error', response.message || response.reasonCode)
      } else if (action === 'apply') {
        toast.push('warn', pick('Địa chỉ mạng đã áp dụng tạm thời; hãy xác nhận trước khi hết hạn.', 'Network applied temporarily; confirm before the rollback deadline.'))
      } else {
        toast.push('success', transactionActionMessage(action, pick))
      }
      await transactionState.refetch()
    } catch (err) {
      if (action !== 'validate') {
        const baseline = transactionState.data ?? transaction
        setReconcileAfter({
          action,
          baselineRequestId: baseline?.requestId ?? null,
          baselineFingerprint: transactionMutationFingerprint(action, baseline),
          lastObservedRequestId: null,
          stableUnchangedSamples: 0
        })
        void transactionState.refetch()
      }
      toast.push('error', err instanceof Error ? err.message : 'Network transaction failed')
    } finally {
      setTransactionBusy(null)
    }
  }

  if (networkState.loading && !config) return <StateBlock state="loading" title={pick('Đang tải cấu hình mạng', 'Loading network settings')} />
  if (networkState.error && !config) return <StateBlock state="error" title={pick('Không tải được cấu hình mạng', 'Could not load network settings')} detail={networkState.error.message} onRetry={networkState.refetch} />
  if (!config) return <StateBlock state="empty" title={pick('Chưa có cấu hình mạng', 'No network settings')} />

  const activeNetwork = transaction?.active
  const ethernetState = activeNetwork
    ? activeNetwork.adminUp === false || activeNetwork.carrier === false
      ? 'offline'
      : activeNetwork.adminUp === true && activeNetwork.carrier === true
        ? 'online'
        : activeNetwork.link === 'up' ? 'online' : 'offline'
    : config.bmsLink
  const ethernetLabel = activeNetwork?.carrier === true
    ? 'ETH CARRIER'
    : activeNetwork?.carrier === false
      ? 'ETH NO CARRIER'
      : `ETH ${(activeNetwork?.link ?? ethernetState).toUpperCase()}`
  const transactionLocked = Boolean(transaction && isActiveTransactionState(transaction.state))
  const pendingMatchesCandidate = Boolean(candidate && transaction?.pending && sameCandidate(candidate, transaction.pending))
  const dnsSupported = Boolean(transaction?.capabilities?.includes('dns'))
  const hostnameGuardSupported = Boolean(transaction?.capabilities?.includes('management-hostname'))
  const stableManagementUrl = managementUrl(transaction?.management)
  const stableOriginInUse = managementOriginMatches(transaction?.management)
  const managementPathReady = hostnameGuardSupported && stableOriginInUse
  const ethernetApplyReady = activeNetwork?.adminUp === true && activeNetwork?.carrier === true
  const mutationLocked = transactionBusy !== null || Boolean(reconcileAfter) || Boolean(transactionState.error)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{pick('Mạng', 'Network')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Ethernet an toàn qua netcfg · BACnet/IP lên BMS · Modbus RTU xuống thiết bị phụ', 'Safe Ethernet via netcfg · BACnet/IP up to BMS · Modbus RTU down to field devices')}</p>
        </div>
        <StatusBadge state={ethernetState} label={ethernetLabel} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Stat icon={<Server className="h-5 w-5" />} label="Device" value={config.deviceName || config.bacnetDeviceName || 'N/A'} />
        <Stat icon={<Network className="h-5 w-5" />} label="BACnet/IP UDP" value={config.bacnetPort ? String(config.bacnetPort) : 'N/A'} />
        <Stat icon={<Database className="h-5 w-5" />} label="Modbus slaves" value={`${onlineSlaves}/${slaves.length} online`} />
        <Stat icon={<Wifi className="h-5 w-5" />} label="Poll health" value={`${healthyPolls}%`} warn={healthyPolls < 100} />
      </div>

      <Panel title={pick('ETHERNET - Giao dịch an toàn', 'ETHERNET - Safe transaction')} subtitle={pick('Trạng thái active lấy từ kernel qua mkddc-netcfg; thay đổi phải Stage → Apply → Confirm, nếu không sẽ tự rollback.', 'Active state comes from the kernel via mkddc-netcfg; changes require Stage → Apply → Confirm or they roll back automatically.')} className="border-[var(--c-border)]">
        {transactionState.error && !transaction ? (
          <StateBlock state="error" title={pick('Không kết nối được network authority', 'Network authority unavailable')} detail={transactionState.error.message} onRetry={transactionState.refetch} />
        ) : transactionState.loading && !transaction ? (
          <StateBlock state="loading" title={pick('Đang đọc trạng thái mạng thực', 'Loading authoritative network state')} />
        ) : transaction ? (
          <div className="space-y-5">
            {transactionState.error && <div className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[rgba(232,181,0,0.10)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">{pick('Mất kết nối authority; trạng thái bên dưới có thể đã cũ.', 'Authority disconnected; the state below may be stale.')}</div>}
            {reconcileAfter && <div className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[rgba(232,181,0,0.10)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">{pick('Kết quả request chưa xác định; thao tác mạng đang khóa cho tới khi authority trả trạng thái mới.', 'Request outcome is unknown; network actions stay locked until a fresh authority status is received.')}</div>}
            {!managementPathReady && <div className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[rgba(232,181,0,0.10)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">
              {transaction.management?.stable && stableManagementUrl ? (
                <>{pick('Mở giao diện bằng hostname ổn định trước khi Apply: ', 'Open the UI through the stable hostname before Apply: ')}<a className="mono underline" href={stableManagementUrl}>{stableManagementUrl}</a></>
              ) : pick('Hostname mDNS ổn định chưa sẵn sàng; Apply bị khóa để bảo toàn đường quản trị.', 'Stable mDNS hostname is not ready; Apply is locked to preserve the management path.')}
            </div>}
            {!ethernetApplyReady && <div className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[rgba(232,181,0,0.10)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">
              {pick('Liên kết Ethernet chưa sẵn sàng; hãy cắm cáp Ethernet trước khi Apply.', 'Ethernet link is not ready; connect the Ethernet cable before Apply.')}
            </div>}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <AuthorityCard title="ACTIVE / KERNEL" tone={activeTone(transaction)} lines={activeLines(transaction)} />
              <AuthorityCard title="CONFIGURED PROFILE" tone="neutral" lines={configuredLines(transaction)} />
              <AuthorityCard title="PENDING CANDIDATE" tone={transaction.pending ? 'warn' : 'neutral'} lines={pendingLines(transaction)} />
              <AuthorityCard title="MANAGEMENT HOST" tone={stableOriginInUse ? 'good' : 'warn'} lines={managementLines(transaction)} />
              <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-4">
                <div className="text-xs font-semibold tracking-[0.12em] text-[var(--c-text-dim)]">TRANSACTION</div>
                <div className="mt-3 flex flex-wrap items-center gap-2" aria-live="polite">
                  <TransactionState response={transaction} />
                  {(transaction.state === 'applying' || transaction.state === 'awaiting_confirmation') && <span className="mono text-lg font-bold text-[var(--c-warn-fg)]">{transaction.rollbackRemainingS ?? 0}s</span>}
                </div>
                <div className="mono mt-3 break-all text-xs text-[var(--c-text-dim)]">{transaction.transactionId ?? 'no active transaction'}</div>
                {transaction.result === 'rejected' && <div className="mt-3 text-xs text-[var(--c-fault-fg)]">{transaction.message || transaction.reasonCode}</div>}
              </div>
            </div>

            {candidate ? (
              <>
                <div>
                  <div className="text-xs font-semibold tracking-[0.12em] text-[var(--c-text-dim)]">EDITABLE DRAFT</div>
                  <p className="mt-1 text-xs text-[var(--c-text-dim)]">{pick('Candidate có thể chỉnh sửa; không phải bản sao realtime của ACTIVE / KERNEL.', 'Editable candidate; this is not a realtime mirror of ACTIVE / KERNEL.')}</p>
                </div>
                <div className="grid gap-4 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="Interface" value={candidate.interface} onChange={(value) => setCandidateField('interface', value)} mono disabled={transactionLocked || !canManageNetwork} />
                  <label className="block text-sm text-[var(--c-text)]">
                    Mode
                    <select value={candidate.mode} onChange={(event) => setCandidateMode(event.target.value as NetcfgCandidate['mode'])} className={inputClass} disabled={transactionLocked || !canManageNetwork}>
                      <option value="static">Static IPv4</option>
                      <option value="dhcp">DHCP</option>
                    </select>
                  </label>
                  <Field label="IPv4" value={candidate.ipv4 ?? ''} onChange={(value) => setCandidateField('ipv4', value)} mono disabled={transactionLocked || !canManageNetwork || candidate.mode === 'dhcp'} />
                  <Field label="Subnet Mask" value={candidate.netmask ?? ''} onChange={(value) => setCandidateField('netmask', value)} mono disabled={transactionLocked || !canManageNetwork || candidate.mode === 'dhcp'} />
                  <Field label="Gateway" value={candidate.gateway ?? ''} onChange={(value) => setCandidateField('gateway', value)} mono disabled={transactionLocked || !canManageNetwork || candidate.mode === 'dhcp'} />
                  {dnsSupported && <label className="block text-sm text-[var(--c-text)]">
                    DNS mode
                    <select value={candidate.dns?.mode ?? 'preserve'} onChange={(event) => setCandidateDnsMode(event.target.value as 'preserve' | 'auto' | 'manual')} className={inputClass} disabled={transactionLocked || !canManageNetwork}>
                      <option value="preserve">Preserve profile</option>
                      {candidate.mode === 'dhcp' && <option value="auto">Automatic (DHCP)</option>}
                      <option value="manual">Manual</option>
                    </select>
                  </label>}
                  {dnsSupported && <Field label="DNS servers" value={candidate.dns?.servers.join(', ') ?? ''} onChange={setCandidateDnsServers} mono disabled={transactionLocked || !canManageNetwork || candidate.dns?.mode !== 'manual'} />}
                </div>

                {transactionLocked && <div className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[rgba(232,181,0,0.10)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">{pick('Form đang khóa theo pending candidate của giao dịch authoritative.', 'The form is locked to the authoritative pending candidate.')}</div>}

                <div className="flex flex-wrap gap-2">
                  <Button icon={<ShieldCheck className="h-4 w-4" />} loading={transactionBusy === 'validate'} disabled={!canManageNetwork || mutationLocked || transactionLocked} onClick={() => runTransaction('validate')}>{pick('Kiểm tra', 'Validate')}</Button>
                  <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={transactionBusy === 'stage'} disabled={!canManageNetwork || mutationLocked || transactionLocked} onClick={() => runTransaction('stage')}>Stage</Button>
                  <Button icon={<Play className="h-4 w-4" />} loading={transactionBusy === 'apply'} disabled={!canManageNetwork || mutationLocked || !managementPathReady || !ethernetApplyReady || transaction.state !== 'staged' || !pendingMatchesCandidate} onClick={() => runTransaction('apply')}>Apply</Button>
                  <Button variant="primary" icon={<CheckCircle2 className="h-4 w-4" />} loading={transactionBusy === 'confirm'} disabled={!canManageNetwork || mutationLocked || transaction.state !== 'awaiting_confirmation' || (transaction.rollbackRemainingS ?? 0) <= 0} onClick={() => runTransaction('confirm')}>Confirm</Button>
                  <Button variant="danger" icon={<RotateCcw className="h-4 w-4" />} loading={transactionBusy === 'rollback'} disabled={!canManageNetwork || mutationLocked || !['staged', 'applying', 'awaiting_confirmation'].includes(transaction.state)} onClick={() => runTransaction('rollback')}>Rollback</Button>
                </div>
              </>
            ) : (
              <StateBlock state="empty" title={pick('Authority chưa có candidate chỉnh sửa', 'No editable network candidate')} detail={pick('Cần configured profile hoặc active mode static/DHCP hợp lệ; không suy diễn mode khi authority báo unknown.', 'A configured profile or a valid static/DHCP active mode is required; unknown authority mode is never inferred.')} />
            )}
          </div>
        ) : null}
      </Panel>

      <Panel title="NORTHBOUND - BACnet/IP lên BMS" subtitle={pick('Cấu hình nhận dạng BACnet và WiFi; Ethernet IPv4 được thay đổi ở giao dịch an toàn phía trên.', 'BACnet identity and WiFi settings; change Ethernet IPv4 through the safe transaction above.')} action={<Button variant="primary" icon={<Save className="h-4 w-4" />} disabled={!canManageNetwork} onClick={saveServiceConfig}>{pick('Lưu BACnet/WiFi', 'Save BACnet/WiFi')}</Button>} className="border-[var(--c-border)]">
        <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Device Name" value={config.deviceName} onChange={(value) => setConfigField('deviceName', value)} disabled={!canManageNetwork} />
            <Field label="BACnet Device ID" value={config.bacnetDeviceId} onChange={(value) => setConfigField('bacnetDeviceId', value)} mono disabled={!canManageNetwork} />
            <Field label="BACnet Device Name" value={config.bacnetDeviceName} onChange={(value) => setConfigField('bacnetDeviceName', value)} disabled={!canManageNetwork} />
            <label className="block text-sm text-[var(--c-text)]">
              BACnet/IP Port
              <input type="number" min={1} max={65535} value={config.bacnetPort} disabled={!canManageNetwork} onChange={(event) => setConfigField('bacnetPort', Number(event.target.value))} className={`${inputClass} mono`} />
            </label>
          </div>

          <div className="space-y-4 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">BMS Link</div>
                <div className="mono mt-1 text-xs text-[var(--c-text-dim)]">{transaction?.active?.ipv4 || config.ip} → UDP/{config.bacnetPort}</div>
              </div>
              <StatusBadge state={config.bmsLink} />
            </div>
            <Toggle label="WiFi" checked={config.wifiEnabled} disabled={!canManageNetwork} onChange={(value) => setConfigField('wifiEnabled', value)} />
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
              <tr><Th>Addr</Th><Th>Slave / Profile</Th><Th>Baud rate</Th><Th>Poll state</Th><Th>Error rate</Th><Th>Last poll</Th></tr>
            </thead>
            <tbody>{slaves.map((slave) => <SlaveRow key={slave.address} slave={slave} locale={locale} />)}</tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function candidateFromAuthority(response: NetcfgResponse): NetcfgCandidate | null {
  if (response.pending) return { ...response.pending }
  if (response.configured && hasEditableCandidateMode(response.configured)) return { ...response.configured }
  const active = response.active
  if (!active || (active.mode !== 'static' && active.mode !== 'dhcp')) return null
  return {
    interface: active.interface,
    mode: active.mode,
    ...(active.dnsServers?.length ? { dns: { mode: 'manual' as const, servers: [...active.dnsServers] } } :
      active.mode === 'dhcp' ? { dns: { mode: 'auto' as const, servers: [] } } : {}),
    ...(active.mode === 'dhcp' ? {} : {
      ipv4: active.ipv4,
      netmask: prefixToNetmask(active.prefixLength),
      gateway: active.gateway
    })
  }
}

function hasEditableCandidateMode(candidate: NetcfgCandidate): boolean {
  return candidate.mode === 'static' || candidate.mode === 'dhcp'
}

function authorityDraftFingerprint(response: NetcfgResponse): string {
  const active = response.active
  return JSON.stringify({
    configured: response.configured ?? null,
    active: active ? [active.interface, active.mode, active.ipv4, active.prefixLength, active.gateway, active.dnsServers ?? []] : null
  })
}

function transactionMutationFingerprint(action: Exclude<NetcfgTransactionAction, 'validate'>, response: NetcfgResponse | null): string {
  if (!response) return JSON.stringify({ action, response: null })
  return JSON.stringify({
    action,
    state: response.state,
    transactionId: response.transactionId ?? null,
    pending: response.pending ?? null,
    configured: response.configured ?? null
  })
}

function isActiveTransactionState(state: NetcfgResponse['state']): boolean {
  return state === 'staged' || state === 'applying' || state === 'awaiting_confirmation'
}

function sameCandidate(left: NetcfgCandidate, right: NetcfgCandidate): boolean {
  return left.interface === right.interface && left.mode === right.mode &&
    (left.ipv4 ?? '') === (right.ipv4 ?? '') &&
    (left.netmask ?? '') === (right.netmask ?? '') &&
    (left.gateway ?? '') === (right.gateway ?? '') &&
    (left.dns?.mode ?? '') === (right.dns?.mode ?? '') &&
    JSON.stringify(left.dns?.servers ?? []) === JSON.stringify(right.dns?.servers ?? [])
}

function prefixToNetmask(prefix: number): string | undefined {
  if (!Number.isInteger(prefix) || prefix < 1 || prefix > 32) return undefined
  return Array.from({ length: 4 }, (_, index) => {
    const bits = Math.max(0, Math.min(8, prefix - index * 8))
    return bits === 0 ? 0 : 256 - 2 ** (8 - bits)
  }).join('.')
}

function transactionActionMessage(action: NetcfgTransactionAction, pick: (vi: string, en: string) => string): string {
  const messages: Record<NetcfgTransactionAction, [string, string]> = {
    validate: ['Candidate hợp lệ', 'Candidate is valid'],
    stage: ['Đã tạo giao dịch chờ áp dụng', 'Network transaction staged'],
    apply: ['Đã áp dụng tạm thời', 'Applied temporarily'],
    confirm: ['Đã xác nhận cấu hình mạng', 'Network configuration confirmed'],
    rollback: ['Đã hoàn tác cấu hình mạng', 'Network configuration rolled back']
  }
  return pick(...messages[action])
}

function activeLines(response: NetcfgResponse): Array<[string, string]> {
  const active = response.active
  if (!active) return [['State', 'Unavailable']]
  return [
    ['Interface', active.interface || '—'],
    ['Admin', booleanState(active.adminUp, 'up', 'down')],
    ['Carrier', booleanState(active.carrier, 'present', 'absent')],
    ['Kernel link', active.link],
    ['Address', activeAddress(active.ipv4, active.prefixLength)],
    ['Gateway', active.gateway || '—'],
    ['DNS', active.dnsServers?.join(', ') || '—'],
    ['Mode', active.mode],
    ['Reason', active.reasonCode || 'Unknown']
  ]
}

function activeTone(response: NetcfgResponse): 'good' | 'warn' | 'neutral' {
  const active = response.active
  if (!active) return 'neutral'
  if (active.adminUp === false || active.carrier === false || (active.reasonCode && active.reasonCode !== 'OK')) return 'warn'
  if (active.adminUp === true && active.carrier === true && active.reasonCode === 'OK') return 'good'
  return 'neutral'
}

function configuredLines(response: NetcfgResponse): Array<[string, string]> {
  return response.configured ? candidateLines(response.configured) : [['State', 'No configured profile']]
}

function pendingLines(response: NetcfgResponse): Array<[string, string]> {
  return response.pending ? candidateLines(response.pending) : [['State', 'No pending candidate']]
}

function managementLines(response: NetcfgResponse): Array<[string, string]> {
  const management = response.management
  if (!management) return [['State', 'Authority does not report hostname']]
  return [
    ['Hostname', management.hostname || '—'],
    ['mDNS', management.mdnsName || '—'],
    ['Stable', management.stable ? 'ready' : 'not ready'],
    ['Current origin', window.location.host]
  ]
}

function candidateLines(candidate: NetcfgCandidate): Array<[string, string]> {
  return [
    ['Interface', candidate.interface],
    ['Address', candidate.mode === 'dhcp' ? 'DHCP' : `${candidate.ipv4 || '—'} · ${candidate.netmask || '—'}`],
    ['Gateway', candidate.gateway || '—'],
    ['DNS', candidate.dns ? `${candidate.dns.mode}: ${candidate.dns.servers.join(', ') || '—'}` : 'preserve'],
    ['Mode', candidate.mode]
  ]
}

function managementOriginMatches(management: NetcfgResponse['management']): boolean {
  if (!management?.stable || !management.mdnsName) return false
  return window.location.hostname.toLowerCase().replace(/\.$/, '') === management.mdnsName.toLowerCase().replace(/\.$/, '')
}

function managementUrl(management: NetcfgResponse['management']): string | null {
  if (!management?.stable || !management.mdnsName) return null
  const port = window.location.port ? `:${window.location.port}` : ''
  return `${window.location.protocol}//${management.mdnsName}${port}${window.location.pathname}`
}

function activeAddress(ipv4: string, prefixLength: number): string {
  if (!ipv4) return 'No IPv4'
  return Number.isInteger(prefixLength) && prefixLength > 0 && prefixLength <= 32 ? `${ipv4}/${prefixLength}` : ipv4
}

function booleanState(value: boolean | undefined, whenTrue: string, whenFalse: string): string {
  return value === undefined ? 'Unknown' : value ? whenTrue : whenFalse
}

function AuthorityCard({ title, tone, lines }: { title: string; tone: 'good' | 'warn' | 'neutral'; lines: Array<[string, string]> }) {
  const toneClass = tone === 'good' ? 'border-[rgba(47,164,90,0.38)]' : tone === 'warn' ? 'border-[rgba(232,181,0,0.48)]' : 'border-[var(--c-border)]'
  return (
    <div className={`rounded-[var(--radius)] border bg-[var(--c-surface-2)] p-4 ${toneClass}`}>
      <div className="text-xs font-semibold tracking-[0.12em] text-[var(--c-text-dim)]">{title}</div>
      <div className="mt-3 space-y-2">
        {lines.map(([label, value]) => <div key={label} className="flex items-start justify-between gap-3 text-xs"><span className="text-[var(--c-text-dim)]">{label}</span><span className="mono text-right font-semibold">{value}</span></div>)}
      </div>
    </div>
  )
}

function TransactionState({ response }: { response: NetcfgResponse }) {
  const warning = response.state === 'staged' || response.state === 'applying' || response.state === 'awaiting_confirmation'
  const failed = response.result === 'rejected' || response.state === 'failed'
  const className = failed ? 'border-[var(--c-fault-fg)] text-[var(--c-fault-fg)]' : warning ? 'border-[var(--c-warn-fg)] text-[var(--c-warn-fg)]' : 'border-[var(--c-good-fg)] text-[var(--c-good-fg)]'
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase ${className}`}>{response.state.replace(/_/g, ' ')}</span>
}

function Field({ label, value, onChange, mono, disabled }: { label: string; value: string; onChange: (value: string) => void; mono?: boolean; disabled?: boolean }) {
  return <label className="block text-sm text-[var(--c-text)]">{label}<input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={`${inputClass} ${mono ? 'mono' : ''}`} /></label>
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <button type="button" disabled={disabled} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 py-2 text-sm transition hover:border-[var(--c-accent)] disabled:cursor-not-allowed disabled:opacity-50"><span>{label}</span><span className={checked ? 'text-[var(--c-good-fg)]' : 'text-[var(--c-off)]'}>{checked ? 'ON' : 'OFF'}</span></button>
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div><div className="text-[var(--c-text-dim)]">{label}</div><div className={mono ? 'mono mt-1 font-semibold' : 'mt-1 font-semibold'}>{value}</div></div>
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
      <Td><div className="font-semibold">{slave.name}</div><div className="mt-1 text-xs text-[var(--c-text-dim)]">{slave.profile}</div></Td>
      <Td className="mono">{slave.baudRate.toLocaleString(locale)} bps</Td>
      <Td><StatusBadge state={slave.pollState} /></Td>
      <Td><div className="mono font-semibold">{slave.errorRate.toFixed(slave.errorRate >= 10 ? 0 : 1)}%</div><div className="mt-2 h-1.5 rounded-full bg-[rgba(143,161,189,0.18)]"><div className="h-full rounded-full bg-current text-[var(--c-warn-fg)]" style={{ width: `${Math.min(slave.errorRate, 100)}%` }} /></div></Td>
      <Td className="mono">{slave.pollState === 'offline' ? 'timeout' : `${slave.lastPollMs} ms`}</Td>
    </tr>
  )
}

function Stat({ icon, label, value, warn }: { icon: ReactNode; label: string; value: string; warn?: boolean }) {
  return <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4"><div className={warn ? 'flex items-center gap-3 text-[var(--c-warn-fg)]' : 'flex items-center gap-3 text-[var(--c-good-fg)]'}>{icon}<div className="mono text-xl font-bold">{value}</div></div><div className="mt-2 text-xs text-[var(--c-text-dim)]">{label}</div></div>
}
