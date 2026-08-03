import { CheckCircle2, Database, Network, RotateCcw, Save, Server, ShieldCheck, Wifi } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { apiClient } from '../../shared/api/client'
import { Button } from '../../shared/components/Button'
import { Panel } from '../../shared/components/Panel'
import { StateBlock } from '../../shared/components/StateBlock'
import { StatusBadge } from '../../shared/components/StatusBadge'
import { useToast } from '../../shared/components/Toast'
import { useApi } from '../../shared/hooks/useApi'
import { useAuth } from '../auth'
import { useI18n } from '../../shared/i18n'
import type { ModbusSlave, NetcfgCandidate, NetcfgResponse, NetcfgTransactionAction, NetworkConfig, PollState } from '../../shared/types'

const inputClass = 'mt-2 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm outline-none transition focus:border-[var(--c-accent)] disabled:cursor-not-allowed disabled:opacity-50'

type NetworkReconcile = {
  action: Exclude<NetcfgTransactionAction, 'validate'>
  baselineRequestId: string | null
  baselineFingerprint: string
  lastObservedRequestId: string | null
  stableUnchangedSamples: number
}

const pollStateClass: Record<PollState, string> = {
  online: 'bg-[var(--c-good-bg)]',
  degraded: 'bg-[var(--c-warn-bg)]',
  offline: 'bg-[var(--c-fault-bg)]',
  // 'unknown' cố ý KHÔNG tô màu trạng thái: chưa có số đo thì không được gợi ý
  // khoẻ hay hỏng.
  unknown: ''
}

export function NetworkPage() {
  const toast = useToast()
  const { locale, pick } = useI18n()
  const { session } = useAuth()
  const canManageNetwork = session?.role === 'admin'
  // Hiệu năng: trước đây CẢ HAI endpoint đều poll mỗi giây, liên tục, kể cả khi
  // không có gì xảy ra. Mỗi vòng `getNetwork` đọc 4 file cấu hình + SHM, còn
  // `getNetworkTransaction` mở socket sang mkddc-netcfg — vốn đơn luồng, nên chính
  // việc poll dày cũng tự làm nó chậm thêm.
  //
  // Nay bám nhịp theo việc thật: cấu hình BACnet/WiFi và danh sách slave đổi rất
  // thưa nên 5 s là đủ; trạng thái giao dịch chỉ cần 1 s TRONG LÚC có giao dịch
  // chạy (đếm ngược 120 s), còn lúc rảnh thì 5 s. Giảm ~5 lần tải ở trạng thái nghỉ.
  const [transactionActive, setTransactionActive] = useState(false)
  const networkState = useApi(apiClient.getNetwork, [], { refreshMs: 5000 })
  const transactionState = useApi<NetcfgResponse | null>(
    apiClient.getNetworkTransaction,
    [session?.username],
    { refreshMs: session ? (transactionActive ? 1000 : 5000) : undefined }
  )
  const [config, setConfig] = useState<NetworkConfig | null>(null)
  const [candidate, setCandidate] = useState<NetcfgCandidate | null>(null)
  const [transaction, setTransaction] = useState<NetcfgResponse | null>(null)
  const [transactionBusy, setTransactionBusy] = useState<NetcfgTransactionAction | null>(null)
  const [confirmSave, setConfirmSave] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [savingNetwork, setSavingNetwork] = useState(false)
  const [reconcileAfter, setReconcileAfter] = useState<NetworkReconcile | null>(null)
  const candidateDirty = useRef(false)
  const previousAuthority = useRef<{ transactionId: string | null; state: NetcfgResponse['state']; draftFingerprint: string } | null>(null)
  const networkData = networkState.data
  const slaves = networkData?.southbound ?? []
  const onlineSlaves = slaves.filter((slave) => slave.pollState === 'online').length
  // F-02: công thức cũ chỉ TRỪ ĐI slave 'offline', trong khi backend không bao
  // giờ phát ra 'offline' (chỉ 'online'/'degraded'), nên chỉ số này luôn bằng
  // 100% và ô cảnh báo `warn` không bao giờ sáng — đúng lúc field bus hỏng thì
  // KPI vẫn báo khoẻ. Nay đếm theo tỉ lệ slave thực sự online, và slave chưa có
  // số đo thì không được tính là khoẻ.
  const measuredSlaves = slaves.filter((slave) => slave.pollState !== 'unknown')
  const pollHealth = measuredSlaves.length
    ? Math.round((measuredSlaves.filter((slave) => slave.pollState === 'online').length / measuredSlaves.length) * 100)
    : null

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
    // Chỉ tăng nhịp poll khi thực sự có giao dịch đang chạy.
    setTransactionActive(transactionActive)
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
    setSavingConfig(true)
    try {
      const result = await apiClient.saveNetwork({ northbound, southbound: slaves })
      if (result.applied) {
        toast.push('success', pick('Đã lưu và áp dụng cấu hình BACnet/WiFi', 'BACnet/WiFi settings saved and applied'))
      } else {
        // Backend nay trả cảnh báo bằng ngôn ngữ người vận hành (F-01), không còn
        // chuỗi `pending B7 (systemd/polkit)`.
        toast.push('warn', result.warnings?.join('; ') || pick('Đã lưu nhưng chưa áp dụng hết', 'Saved, but not fully applied'))
      }
      setConfig(null)
      await networkState.refetch()
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingConfig(false)
      setConfirmSave(false)
    }
  }

  /**
   * Một thao tác duy nhất cho người vận hành: stage rồi apply liên tiếp.
   *
   * Người dùng không cần biết giao dịch có hai bước — họ chỉ muốn đổi địa chỉ IP.
   * Bước xác nhận vẫn còn nguyên, nhưng chuyển sang hộp thoại tự bật (F-15).
   */
  async function saveNetworkChange() {
    if (!canManageNetwork || !candidate || reconcileAfter || savingNetwork) return
    setSavingNetwork(true)
    try {
      const staged = await apiClient.runNetworkTransaction('stage', { candidate })
      setTransaction(staged)
      if (staged.result === 'rejected' || !staged.transactionId) {
        toast.push('error', staged.message || staged.reasonCode)
        return
      }
      const applied = await apiClient.runNetworkTransaction('apply', { transactionId: staged.transactionId })
      setTransaction(applied)
      if (applied.result === 'rejected') {
        toast.push('error', applied.message || applied.reasonCode)
        return
      }
      // Không toast ở đây: hộp thoại xác nhận đã nói rõ chuyện gì đang xảy ra.
    } catch (err) {
      // Mất phản hồi giữa chừng có thể do chính địa chỉ vừa đổi. Khoá thao tác và
      // chờ authority trả trạng thái mới thay vì đoán.
      const baseline = transactionState.data ?? transaction
      setReconcileAfter({
        action: 'apply',
        baselineRequestId: baseline?.requestId ?? null,
        baselineFingerprint: transactionMutationFingerprint('apply', baseline),
        lastObservedRequestId: null,
        stableUnchangedSamples: 0
      })
      void transactionState.refetch()
      toast.push('error', err instanceof Error ? err.message : 'Network change failed')
    } finally {
      setSavingNetwork(false)
      await transactionState.refetch()
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
  const dnsSupported = Boolean(transaction?.capabilities?.includes('dns'))
  const hostnameGuardSupported = Boolean(transaction?.capabilities?.includes('management-hostname'))
  const stableManagementUrl = managementUrl(transaction?.management)
  const stableOriginInUse = managementOriginMatches(transaction?.management)
  const managementPathReady = hostnameGuardSupported && stableOriginInUse
  const ethernetApplyReady = activeNetwork?.adminUp === true && activeNetwork?.carrier === true
  const mutationLocked = transactionBusy !== null || Boolean(reconcileAfter) || Boolean(transactionState.error)
  // F-08: chặn ngay trên client thay vì để người dùng bấm rồi chờ authority từ chối.
  const candidateErrors = candidate ? validateCandidateFields(candidate, pick) : {}
  const candidateInvalid = Object.keys(candidateErrors).length > 0
  // Cửa sổ chờ xác nhận: hộp thoại tự bật, không phụ thuộc người dùng có bấm gì.
  const networkChangePending = transaction?.state === 'applying' || transaction?.state === 'awaiting_confirmation'

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
        <Stat icon={<Server className="h-5 w-5" />} label={pick('Thiết bị', 'Device')} value={config.deviceName || config.bacnetDeviceName || '—'} />
        <Stat icon={<Network className="h-5 w-5" />} label="BACnet/IP UDP" value={config.activeBacnetPort ? String(config.activeBacnetPort) : config.bacnetPort ? `${config.bacnetPort} (${pick('chưa áp dụng', 'not applied')})` : '—'} warn={!config.activeBacnetPort} />
        <Stat icon={<Database className="h-5 w-5" />} label={pick('Slave Modbus', 'Modbus slaves')} value={`${onlineSlaves}/${slaves.length} online`} warn={slaves.length > 0 && onlineSlaves < slaves.length} />
        {/* pollHealth === null nghĩa là chưa slave nào có số đo — hiển thị "—"
            chứ không phải 0% hay 100%, cả hai đều là khẳng định sai. */}
        <Stat icon={<Wifi className="h-5 w-5" />} label={pick('Sức khoẻ poll', 'Poll health')} value={pollHealth === null ? '—' : `${pollHealth}%`} warn={pollHealth !== null && pollHealth < 100} />
      </div>

      <Panel title={pick('ETHERNET - Giao dịch an toàn', 'ETHERNET - Safe transaction')} subtitle={pick('Trạng thái active lấy từ kernel qua mkddc-netcfg; thay đổi phải Stage → Apply → Confirm, nếu không sẽ tự rollback.', 'Active state comes from the kernel via mkddc-netcfg; changes require Stage → Apply → Confirm or they roll back automatically.')} className="border-[var(--c-border)]">
        {transactionState.error && !transaction ? (
          <StateBlock state="error" title={pick('Không kết nối được network authority', 'Network authority unavailable')} detail={transactionState.error.message} onRetry={transactionState.refetch} />
        ) : transactionState.loading && !transaction ? (
          <StateBlock state="loading" title={pick('Đang đọc trạng thái mạng thực', 'Loading authoritative network state')} />
        ) : transaction ? (
          <div className="space-y-5">
            {transactionState.error && <div className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">{pick('Mất kết nối authority; trạng thái bên dưới có thể đã cũ.', 'Authority disconnected; the state below may be stale.')}</div>}
            {reconcileAfter && <div className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">{pick('Kết quả request chưa xác định; thao tác mạng đang khóa cho tới khi authority trả trạng thái mới.', 'Request outcome is unknown; network actions stay locked until a fresh authority status is received.')}</div>}
            {!managementPathReady && <div className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">
              {transaction.management?.stable && stableManagementUrl ? (
                <>{pick('Mở giao diện bằng hostname ổn định trước khi Apply: ', 'Open the UI through the stable hostname before Apply: ')}<a className="mono underline" href={stableManagementUrl}>{stableManagementUrl}</a></>
              ) : pick('Hostname mDNS ổn định chưa sẵn sàng; Apply bị khóa để bảo toàn đường quản trị.', 'Stable mDNS hostname is not ready; Apply is locked to preserve the management path.')}
            </div>}
            {!ethernetApplyReady && <div className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">
              {pick('Liên kết Ethernet chưa sẵn sàng; hãy cắm cáp Ethernet trước khi Apply.', 'Ethernet link is not ready; connect the Ethernet cable before Apply.')}
            </div>}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <AuthorityCard title="ACTIVE / KERNEL" tone={activeTone(transaction)} lines={activeLines(transaction)} />
              <AuthorityCard title="CONFIGURED PROFILE" tone="neutral" lines={configuredLines(transaction)} />
              <AuthorityCard title="PENDING CANDIDATE" tone={transaction.pending ? 'warn' : 'neutral'} lines={pendingLines(transaction)} />
              <AuthorityCard title="MANAGEMENT HOST" tone={stableOriginInUse ? 'good' : 'warn'} lines={managementLines(transaction)} />
              <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-4">
                <div className="text-xs font-semibold tracking-[0.12em] text-[var(--c-text-dim)]">{pick('GIAO DỊCH', 'TRANSACTION')}</div>
                <div className="mt-3 flex flex-wrap items-center gap-2" aria-live="polite">
                  <TransactionState response={transaction} pick={pick} />
                  {/* F-12: countdown ở dạng MM:SS như đặc tả panel HMI, không phải
                      số giây thô. Mất mạng là sự cố phải cử người tới hiện trường
                      nên thời gian còn lại phải đọc được ngay. */}
                  {(transaction.state === 'applying' || transaction.state === 'awaiting_confirmation') && <span className="mono text-lg font-bold text-[var(--c-warn-fg)]">{formatCountdown(transaction.rollbackRemainingS ?? 0)}</span>}
                </div>
                <div className="mono mt-3 break-all text-xs text-[var(--c-text-dim)]">{transaction.transactionId ?? pick('không có giao dịch', 'no active transaction')}</div>
                {/* F-12: đối chiếu old→new ngay trong thẻ giao dịch. Trước đây kỹ
                    thuật viên phải tự so hai thẻ ACTIVE và PENDING cách nhau. */}
                {transaction.pending && <div className="mt-3 space-y-1 border-t border-[var(--c-border)] pt-3 text-xs">
                  <div className="flex items-center justify-between gap-3"><span className="text-[var(--c-text-dim)]">{pick('Địa chỉ cũ', 'Old address')}</span><span className="mono font-semibold">{activeAddress(transaction.active?.ipv4 ?? '', transaction.active?.prefixLength ?? 0)}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-[var(--c-text-dim)]">{pick('Địa chỉ mới', 'New address')}</span><span className="mono font-semibold text-[var(--c-warn-fg)]">{candidateAddressLabel(transaction.pending)}</span></div>
                </div>}
                {/* F-05: lý do phải hiện với MỌI kết thúc bất thường. Điều kiện cũ
                    chỉ bắt `result === 'rejected'`, nên một giao dịch kết thúc ở
                    state 'failed' với result 'accepted' (apply xong nhưng health
                    check hỏng rồi rollback lỗi) hiển thị badge đỏ FAILED mà không
                    một chữ giải thích — đúng những gì quan sát được trên board. */}
                {transactionFailureReason(transaction) && <div className="mt-3 text-xs text-[var(--c-fault-fg)]">
                  {transactionFailureReason(transaction)}
                  <div className="mt-1 text-[var(--c-text-dim)]">{pick('Sửa lại candidate rồi Stage giao dịch mới; xem nhật ký thiết bị nếu lặp lại.', 'Adjust the candidate and stage a new transaction; check device logs if this repeats.')}</div>
                </div>}
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
                    {pick('Chế độ', 'Mode')}
                    <select value={candidate.mode} onChange={(event) => setCandidateMode(event.target.value as NetcfgCandidate['mode'])} className={inputClass} disabled={transactionLocked || !canManageNetwork}>
                      <option value="static">{pick('IPv4 tĩnh', 'Static IPv4')}</option>
                      <option value="dhcp">DHCP</option>
                    </select>
                  </label>
                  <Field label="IPv4" value={candidate.ipv4 ?? ''} onChange={(value) => setCandidateField('ipv4', value)} mono error={candidateErrors.ipv4} inputMode="decimal" disabled={transactionLocked || !canManageNetwork || candidate.mode === 'dhcp'} />
                  <Field label={pick('Subnet mask', 'Subnet Mask')} value={candidate.netmask ?? ''} onChange={(value) => setCandidateField('netmask', value)} mono error={candidateErrors.netmask} inputMode="decimal" disabled={transactionLocked || !canManageNetwork || candidate.mode === 'dhcp'} />
                  <Field label="Gateway" value={candidate.gateway ?? ''} onChange={(value) => setCandidateField('gateway', value)} mono error={candidateErrors.gateway} inputMode="decimal" disabled={transactionLocked || !canManageNetwork || candidate.mode === 'dhcp'} />
                  {dnsSupported && <label className="block text-sm text-[var(--c-text)]">
                    {pick('Chế độ DNS', 'DNS mode')}
                    <select value={candidate.dns?.mode ?? 'preserve'} onChange={(event) => setCandidateDnsMode(event.target.value as 'preserve' | 'auto' | 'manual')} className={inputClass} disabled={transactionLocked || !canManageNetwork}>
                      <option value="preserve">{pick('Giữ nguyên profile', 'Preserve profile')}</option>
                      {candidate.mode === 'dhcp' && <option value="auto">{pick('Tự động (DHCP)', 'Automatic (DHCP)')}</option>}
                      <option value="manual">{pick('Thủ công', 'Manual')}</option>
                    </select>
                  </label>}
                  {dnsSupported && <Field label={pick('Máy chủ DNS', 'DNS servers')} value={candidate.dns?.servers.join(', ') ?? ''} onChange={setCandidateDnsServers} mono error={candidateErrors.dns} disabled={transactionLocked || !canManageNetwork || candidate.dns?.mode !== 'manual'} />}
                </div>

                {transactionLocked && <div className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">{pick('Form đang khóa theo pending candidate của giao dịch authoritative.', 'The form is locked to the authoritative pending candidate.')}</div>}

                {/* CHỈ hai nút. `Stage`/`Apply` là tên lệnh giao thức, không phải
                    việc người vận hành cần biết — gộp vào "Lưu thay đổi".
                    `Confirm`/`Rollback` chuyển vào hộp thoại ở cuối trang, chỉ hiện
                    đúng lúc cần. Cơ chế an toàn được GIẤU ĐI, không bị bỏ đi. */}
                <div className="flex flex-wrap gap-2">
                  <Button icon={<ShieldCheck className="h-4 w-4" />} loading={transactionBusy === 'validate'} disabled={!canManageNetwork || mutationLocked || transactionLocked || candidateInvalid} onClick={() => runTransaction('validate')}>{pick('Kiểm tra', 'Check')}</Button>
                  <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={savingNetwork} disabled={!canManageNetwork || mutationLocked || transactionLocked || candidateInvalid || !managementPathReady || !ethernetApplyReady} onClick={saveNetworkChange}>{pick('Lưu thay đổi', 'Save changes')}</Button>
                </div>
              </>
            ) : (
              <StateBlock state="empty" title={pick('Authority chưa có candidate chỉnh sửa', 'No editable network candidate')} detail={pick('Cần configured profile hoặc active mode static/DHCP hợp lệ; không suy diễn mode khi authority báo unknown.', 'A configured profile or a valid static/DHCP active mode is required; unknown authority mode is never inferred.')} />
            )}
          </div>
        ) : null}
      </Panel>

      <Panel title={pick('NORTHBOUND — BACnet/IP lên BMS', 'NORTHBOUND — BACnet/IP up to BMS')} subtitle={pick('Cấu hình nhận dạng BACnet và WiFi; Ethernet IPv4 được thay đổi ở giao dịch an toàn phía trên.', 'BACnet identity and WiFi settings; change Ethernet IPv4 through the safe transaction above.')} action={<Button variant="primary" icon={<Save className="h-4 w-4" />} disabled={!canManageNetwork} onClick={() => setConfirmSave(true)}>{pick('Lưu BACnet/WiFi', 'Save BACnet/WiFi')}</Button>} className="border-[var(--c-border)]">
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
              <Info label={pick('Tên thiết bị', 'Device Name')} value={config.deviceName || '—'} />
              {/* F-10: hai trường này từng gán cứng "N/A". Nay lấy từ backend;
                  serial rỗng nghĩa là thiết bị chưa được nạp serial và giao diện
                  nói đúng như vậy thay vì bịa ra một mã. */}
              <Info label="Serial" value={config.serial || pick('chưa nạp', 'not provisioned')} mono />
              <Info label="Firmware" value={config.firmware || '—'} mono />
              <Info label={pick('Vai trò', 'Role')} value="BACnet/IP server" />
            </div>
          </div>
        </div>
      </Panel>

      <Panel title={pick('SOUTHBOUND — RS-485 Modbus RTU Master', 'SOUTHBOUND — RS-485 Modbus RTU master')} subtitle={pick('DDC-24 chủ động poll slave thiết bị phụ: module mở rộng I/O, remote HMI, meter, VFD.', 'DDC-24 actively polls field-device slaves: I/O expansion modules, remote HMI, meters, VFDs.')} className="border-[var(--c-border)]">
        {slaves.length === 0 ? (
          <StateBlock state="empty" title={pick('Chưa cấu hình slave Modbus', 'No Modbus slaves configured')} detail={pick('Thêm slave trong cấu hình fieldbus để bắt đầu poll.', 'Add slaves to the fieldbus configuration to start polling.')} />
        ) : (
          <div className="overflow-auto rounded-[var(--radius)] border border-[var(--c-border)]">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead className="bg-[var(--c-surface-2)] text-xs text-[var(--c-text-dim)]">
                <tr><Th>{pick('Địa chỉ', 'Addr')}</Th><Th>{pick('Slave / Hồ sơ', 'Slave / Profile')}</Th><Th>{pick('Tốc độ baud', 'Baud rate')}</Th><Th>{pick('Trạng thái poll', 'Poll state')}</Th><Th>{pick('Tỉ lệ lỗi', 'Error rate')}</Th><Th>{pick('Poll gần nhất', 'Last poll')}</Th></tr>
              </thead>
              <tbody>{slaves.map((slave) => <SlaveRow key={slave.address} slave={slave} locale={locale} pick={pick} />)}</tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Hộp thoại xác nhận đổi địa chỉ — TỰ BẬT khi giao dịch vào cửa sổ 120 giây.
          Đây là nơi Confirm/Rollback sống, thay cho hai nút thường trực cũ.
          Điểm quan trọng nhất là dòng "nếu mất kết nối, thiết bị tự quay lại": nó
          nói cho người dùng biết họ an toàn kể cả khi trang đứng hình. */}
      {networkChangePending && transaction && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={pick('Xác nhận đổi địa chỉ mạng', 'Confirm network address change')}>
        <div className="w-full max-w-md rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[var(--c-surface)] p-5 shadow-lg">
          <h2 className="text-base font-semibold">{pick('Đã áp dụng địa chỉ mới', 'New address applied')}</h2>
          <div className="mt-4 space-y-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm">
            <div className="flex items-center justify-between gap-3"><span className="text-[var(--c-text-dim)]">{pick('Cũ', 'Old')}</span><span className="mono font-semibold">{activeAddress(transaction.active?.ipv4 ?? '', transaction.active?.prefixLength ?? 0)}</span></div>
            <div className="flex items-center justify-between gap-3"><span className="text-[var(--c-text-dim)]">{pick('Mới', 'New')}</span><span className="mono font-semibold text-[var(--c-warn-fg)]">{transaction.pending ? candidateAddressLabel(transaction.pending) : '—'}</span></div>
          </div>
          <p className="mt-4 text-sm font-semibold">{pick('Bạn vẫn xem được trang này?', 'Can you still see this page?')}</p>
          <p className="mt-1 text-sm text-[var(--c-text-dim)]" aria-live="polite">
            {pick('Nếu mất kết nối, thiết bị tự quay lại cấu hình cũ sau ', 'If you lose connection, the device rolls back automatically in ')}
            <span className="mono text-lg font-bold text-[var(--c-warn-fg)]">{formatCountdown(transaction.rollbackRemainingS ?? 0)}</span>
          </p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="danger" icon={<RotateCcw className="h-4 w-4" />} loading={transactionBusy === 'rollback'} disabled={!canManageNetwork || mutationLocked} onClick={() => runTransaction('rollback')}>{pick('Hoàn tác ngay', 'Roll back now')}</Button>
            <Button variant="primary" icon={<CheckCircle2 className="h-4 w-4" />} loading={transactionBusy === 'confirm'} disabled={!canManageNetwork || mutationLocked || transaction.state !== 'awaiting_confirmation' || (transaction.rollbackRemainingS ?? 0) <= 0} onClick={() => runTransaction('confirm')}>{pick('Giữ thay đổi', 'Keep changes')}</Button>
          </div>
        </div>
      </div>}

      {/* F-09: lưu BACnet/WiFi khởi động lại mkddc-iobus, làm gián đoạn BACnet và
          Modbus. Trước đây không có xác nhận nào, trong khi TimeSettingsPage đã
          có modal nêu rõ hậu quả — nay theo cùng khuôn mẫu đó. */}
      {confirmSave && <ConfirmDialog
        title={pick('Áp dụng cấu hình BACnet/WiFi?', 'Apply BACnet/WiFi settings?')}
        body={pick('Thao tác này khởi động lại dịch vụ field bus, làm gián đoạn tạm thời BACnet/IP và Modbus RTU. Điều khiển tại chỗ vẫn tiếp tục chạy. Tiếp tục?', 'This restarts the field bus service, briefly interrupting BACnet/IP and Modbus RTU. Local control keeps running. Continue?')}
        confirmLabel={pick('Lưu và áp dụng', 'Save and apply')}
        cancelLabel={pick('Huỷ', 'Cancel')}
        busy={savingConfig}
        onCancel={() => setConfirmSave(false)}
        onConfirm={saveServiceConfig}
      />}
    </div>
  )
}

function ConfirmDialog({ title, body, confirmLabel, cancelLabel, busy, onConfirm, onCancel }: {
  title: string; body: string; confirmLabel: string; cancelLabel: string; busy: boolean
  onConfirm: () => void; onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-5 shadow-lg">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-[var(--c-text-dim)]">{body}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button variant="primary" loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
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

/** F-12: MM:SS thay cho số giây thô, khớp đặc tả panel HMI. */
function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

function candidateAddressLabel(candidate: NetcfgCandidate): string {
  if (candidate.mode === 'dhcp') return 'DHCP'
  return `${candidate.ipv4 || '—'}${candidate.netmask ? ` · ${candidate.netmask}` : ''}`
}

/**
 * F-05: trả về lý do cho mọi kết thúc bất thường, không chỉ `rejected`.
 * `failed` và `rolled_back` cũng phải giải thích được, nếu không người vận hành
 * chỉ thấy một badge đỏ không hành động được.
 */
function transactionFailureReason(response: NetcfgResponse): string | null {
  const abnormal = response.result === 'rejected' || response.state === 'failed' || response.state === 'rolled_back'
  if (!abnormal) return null
  return response.message || response.reasonCode || null
}

function sameCandidate(left: NetcfgCandidate, right: NetcfgCandidate): boolean {
  return left.interface === right.interface && left.mode === right.mode &&
    (left.ipv4 ?? '') === (right.ipv4 ?? '') &&
    (left.netmask ?? '') === (right.netmask ?? '') &&
    (left.gateway ?? '') === (right.gateway ?? '') &&
    (left.dns?.mode ?? '') === (right.dns?.mode ?? '') &&
    JSON.stringify(left.dns?.servers ?? []) === JSON.stringify(right.dns?.servers ?? [])
}

/**
 * F-08: kiểm định dạng NGAY trên client.
 *
 * Trước đây mọi ô là `<input>` text trơn, nên `192.168.1.999` hay `abc` vẫn phải
 * bấm Validate và chờ authority từ chối bằng thông điệp kỹ thuật. Ràng buộc dưới
 * đây cố ý phản chiếu đúng luật của backend (validateNetcfgCandidate) và của
 * mkddc-netcfg, KHÔNG lỏng hơn — client chỉ bắt sớm, authority vẫn là nơi quyết
 * định cuối cùng.
 */
function isCanonicalIPv4(value: string): boolean {
  const parts = value.split('.')
  if (parts.length !== 4) return false
  return parts.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
}

function ipv4ToInt(value: string): number {
  return value.split('.').reduce((acc, part) => acc * 256 + Number(part), 0)
}

function netmaskPrefix(value: string): number | null {
  if (!isCanonicalIPv4(value)) return null
  const int = ipv4ToInt(value)
  // Netmask phải là dãy bit 1 liên tục: ~mask + 1 phải là luỹ thừa của 2.
  const inverted = (~int >>> 0) + 1
  if (int !== 0 && (inverted & (inverted - 1)) !== 0) return null
  let prefix = 0
  for (let bit = 31; bit >= 0 && (int & (1 << bit)) !== 0; bit--) prefix++
  return prefix
}

type CandidateErrors = Partial<Record<'ipv4' | 'netmask' | 'gateway' | 'dns', string>>

function validateCandidateFields(candidate: NetcfgCandidate, pick: (vi: string, en: string) => string): CandidateErrors {
  const errors: CandidateErrors = {}
  if (candidate.dns?.mode === 'manual') {
    const servers = candidate.dns.servers
    if (servers.length === 0 || servers.length > 4) {
      errors.dns = pick('Cần 1 đến 4 địa chỉ IPv4.', 'Enter 1 to 4 IPv4 addresses.')
    } else if (servers.some((server) => !isCanonicalIPv4(server))) {
      errors.dns = pick('Có địa chỉ DNS không hợp lệ.', 'One or more DNS addresses are invalid.')
    } else if (new Set(servers).size !== servers.length) {
      errors.dns = pick('Địa chỉ DNS bị trùng.', 'DNS addresses must be unique.')
    }
  }
  if (candidate.mode !== 'static') return errors

  if (!candidate.ipv4) errors.ipv4 = pick('Bắt buộc với chế độ tĩnh.', 'Required for static mode.')
  else if (!isCanonicalIPv4(candidate.ipv4)) errors.ipv4 = pick('Địa chỉ IPv4 không hợp lệ.', 'Not a valid IPv4 address.')

  const prefix = candidate.netmask ? netmaskPrefix(candidate.netmask) : null
  if (!candidate.netmask) errors.netmask = pick('Bắt buộc với chế độ tĩnh.', 'Required for static mode.')
  else if (prefix === null || prefix < 1 || prefix > 30) errors.netmask = pick('Subnet mask không hợp lệ (prefix 1..30).', 'Invalid subnet mask (prefix 1..30).')

  if (!errors.ipv4 && candidate.ipv4 && prefix !== null && prefix >= 1 && prefix <= 30) {
    const ip = ipv4ToInt(candidate.ipv4)
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
    const host = (ip & ~mask) >>> 0
    const firstOctet = ip >>> 24
    if (firstOctet === 0 || firstOctet === 127 || ip >>> 28 === 0xe) {
      errors.ipv4 = pick('Phải là địa chỉ unicast dùng được.', 'Must be a usable unicast address.')
    } else if (host === 0 || host === (~mask >>> 0)) {
      errors.ipv4 = pick('Không được là địa chỉ mạng hoặc broadcast.', 'Must not be the network or broadcast address.')
    } else if (candidate.gateway) {
      if (!isCanonicalIPv4(candidate.gateway)) {
        errors.gateway = pick('Địa chỉ IPv4 không hợp lệ.', 'Not a valid IPv4 address.')
      } else {
        const gateway = ipv4ToInt(candidate.gateway)
        const gatewayHost = (gateway & ~mask) >>> 0
        if (gateway === ip) errors.gateway = pick('Gateway phải khác địa chỉ thiết bị.', 'Gateway must differ from the device address.')
        else if ((gateway & mask) >>> 0 !== (ip & mask) >>> 0) errors.gateway = pick('Gateway phải cùng subnet.', 'Gateway must be in the same subnet.')
        else if (gatewayHost === 0 || gatewayHost === (~mask >>> 0)) errors.gateway = pick('Gateway không dùng được.', 'Gateway address is not usable.')
      }
    }
  } else if (candidate.gateway && !isCanonicalIPv4(candidate.gateway)) {
    errors.gateway = pick('Địa chỉ IPv4 không hợp lệ.', 'Not a valid IPv4 address.')
  }
  return errors
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
  const toneClass = tone === 'good' ? 'border-[var(--c-good)]' : tone === 'warn' ? 'border-[var(--c-warn)]' : 'border-[var(--c-border)]'
  return (
    <div className={`rounded-[var(--radius)] border bg-[var(--c-surface-2)] p-4 ${toneClass}`}>
      <div className="text-xs font-semibold tracking-[0.12em] text-[var(--c-text-dim)]">{title}</div>
      <div className="mt-3 space-y-2">
        {lines.map(([label, value]) => <div key={label} className="flex items-start justify-between gap-3 text-xs"><span className="text-[var(--c-text-dim)]">{label}</span><span className="mono text-right font-semibold">{value}</span></div>)}
      </div>
    </div>
  )
}

const transactionStateLabels: Record<NetcfgResponse['state'], [string, string]> = {
  idle: ['nhàn rỗi', 'idle'],
  staged: ['đã chuẩn bị', 'staged'],
  applying: ['đang áp dụng', 'applying'],
  awaiting_confirmation: ['chờ xác nhận', 'awaiting confirmation'],
  confirmed: ['đã xác nhận', 'confirmed'],
  rolling_back: ['đang hoàn tác', 'rolling back'],
  rolled_back: ['đã hoàn tác', 'rolled back'],
  failed: ['thất bại', 'failed']
}

function TransactionState({ response, pick }: { response: NetcfgResponse; pick: (vi: string, en: string) => string }) {
  const warning = response.state === 'staged' || response.state === 'applying' || response.state === 'awaiting_confirmation'
  const failed = response.result === 'rejected' || response.state === 'failed'
  const className = failed ? 'border-[var(--c-fault-fg)] text-[var(--c-fault-fg)]' : warning ? 'border-[var(--c-warn-fg)] text-[var(--c-warn-fg)]' : 'border-[var(--c-good-fg)] text-[var(--c-good-fg)]'
  const label = transactionStateLabels[response.state]
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase ${className}`}>{label ? pick(label[0], label[1]) : response.state.replace(/_/g, ' ')}</span>
}

function Field({ label, value, onChange, mono, disabled, error, inputMode }: { label: string; value: string; onChange: (value: string) => void; mono?: boolean; disabled?: boolean; error?: string; inputMode?: 'decimal' | 'numeric' }) {
  // F-08: lỗi hiện ngay dưới ô và nối vào input bằng aria-describedby để trình
  // đọc màn hình đọc được, theo đúng khuôn mẫu đã dùng ở TimeSettingsPage.
  // Lỗi nằm NGOÀI <label> và chỉ nối qua aria-describedby: nếu đặt bên trong,
  // nó bị gộp vào accessible NAME của ô ("IPv4Bắt buộc với chế độ tĩnh") thay vì
  // là mô tả kèm theo — sai ngữ nghĩa và làm hỏng cả cách tra cứu theo nhãn.
  const errorId = error ? `field-error-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined
  return (
    <div>
      <label className="block text-sm text-[var(--c-text)]">{label}
        <input
          value={value}
          disabled={disabled}
          inputMode={inputMode}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          onChange={(event) => onChange(event.target.value)}
          className={`${inputClass} ${mono ? 'mono' : ''} ${error ? 'border-[var(--c-fault-fg)]' : ''}`}
        />
      </label>
      {error && <span id={errorId} className="mt-1 block text-xs text-[var(--c-fault-fg)]">{error}</span>}
    </div>
  )
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  // F-13: role="switch" + aria-checked. Trước đây là <button> trơn nên trình đọc
  // màn hình không truyền đạt được trạng thái bật/tắt (WCAG 2.1 AA §4.1.2).
  return <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 py-2 text-sm transition hover:border-[var(--c-accent)] disabled:cursor-not-allowed disabled:opacity-50"><span>{label}</span><span className={checked ? 'text-[var(--c-good-fg)]' : 'text-[var(--c-off)]'}>{checked ? 'ON' : 'OFF'}</span></button>
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

function SlaveRow({ slave, locale, pick }: { slave: ModbusSlave; locale: string; pick: (vi: string, en: string) => string }) {
  // F-03: mọi ô đều là số đo THẬT của riêng slave này. Khi iobus chưa có số đo,
  // hiển thị "—" chứ không phải 0% — trước đây errorRate bị gán cứng 0 nên thanh
  // lỗi luôn rỗng kể cả khi bus đang hỏng, và mọi dòng dùng chung một trạng thái.
  const hasErrorRate = slave.errorRate !== null
  return (
    <tr className={`border-t border-[var(--c-border)] ${pollStateClass[slave.pollState]}`}>
      <Td className="mono font-semibold">{slave.address}</Td>
      <Td><div className="font-semibold">{slave.name}</div><div className="mt-1 text-xs text-[var(--c-text-dim)]">{slave.profile}</div></Td>
      <Td className="mono">{slave.baudRate ? `${slave.baudRate.toLocaleString(locale)} bps` : '—'}</Td>
      <Td><StatusBadge state={slave.pollState} /></Td>
      <Td>
        {hasErrorRate ? (
          <>
            <div className="mono font-semibold">{slave.errorRate!.toFixed(slave.errorRate! >= 10 ? 0 : 1)}%</div>
            <div className="mt-2 h-1.5 rounded-full bg-[var(--c-surface-3)]"><div className="h-full rounded-full bg-[var(--c-warn-fg)]" style={{ width: `${Math.min(slave.errorRate!, 100)}%` }} /></div>
            {slave.totalPolls !== null && <div className="mt-1 text-xs text-[var(--c-text-dim)]">{slave.totalErrors ?? 0}/{slave.totalPolls}</div>}
          </>
        ) : <span className="mono text-[var(--c-text-dim)]" title={pick('Chưa có số đo từ field bus', 'No field bus measurement yet')}>—</span>}
      </Td>
      <Td className="mono">{slaveLastPollLabel(slave, pick)}</Td>
    </tr>
  )
}

function slaveLastPollLabel(slave: ModbusSlave, pick: (vi: string, en: string) => string): string {
  if (slave.lastPollMs === null) return '—'
  if (slave.pollState === 'offline') return pick('quá hạn', 'timeout')
  return `${slave.lastPollMs} ms`
}

function Stat({ icon, label, value, warn }: { icon: ReactNode; label: string; value: string; warn?: boolean }) {
  return <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4"><div className={warn ? 'flex items-center gap-3 text-[var(--c-warn-fg)]' : 'flex items-center gap-3 text-[var(--c-good-fg)]'}>{icon}<div className="mono text-xl font-bold">{value}</div></div><div className="mt-2 text-xs text-[var(--c-text-dim)]">{label}</div></div>
}
