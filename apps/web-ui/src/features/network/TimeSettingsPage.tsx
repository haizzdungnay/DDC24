import { AlertTriangle, Clock3, RefreshCw, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { apiClient } from '../../shared/api/client'
import { Button } from '../../shared/components/Button'
import { Modal } from '../../shared/components/Modal'
import { Panel } from '../../shared/components/Panel'
import { StatusBadge } from '../../shared/components/StatusBadge'
import { useToast } from '../../shared/components/Toast'
import { useI18n } from '../../shared/i18n'
import { createUuid } from '../../shared/crypto'
import type { TimeConfig, TimeStatus } from '../../shared/types'

const inputClass = 'mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]'
const rfc3339WithZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const isRfc3339WithZone = (value: string) => rfc3339WithZone.test(value) && Number.isFinite(Date.parse(value))

export function TimeSettingsPage() {
  const { pick } = useI18n()
  const toast = useToast()
  const [config, setConfig] = useState<TimeConfig | null>(null)
  const [savedConfig, setSavedConfig] = useState<TimeConfig | null>(null)
  const [status, setStatus] = useState<TimeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manualError, setManualError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [anchorMs, setAnchorMs] = useState(Date.now())
  const [, tick] = useState(0)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [nextConfig, nextStatus] = await Promise.all([apiClient.getTimeConfig(), apiClient.getTimeStatus()])
      setConfig(nextConfig)
      setSavedConfig(nextConfig)
      setStatus(nextStatus)
      setAnchorMs(Date.now())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])
  useEffect(() => {
    const id = window.setInterval(() => tick((value) => value + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  async function refreshStatus() {
    setRefreshing(true)
    try {
      setStatus(await apiClient.getTimeStatus())
      setAnchorMs(Date.now())
    } catch (refreshError) {
      toast.push('error', refreshError instanceof Error ? refreshError.message : String(refreshError))
    } finally {
      setRefreshing(false)
    }
  }

  function requestSave() {
    if (!config || saving) return
    setManualError(null)
    if (!config.ntpEnabled && !isRfc3339WithZone(config.systemTime)) {
      setManualError(pick('Dùng RFC3339 có Z hoặc offset rõ ràng.', 'Use RFC3339 with Z or an explicit offset.'))
      return
    }
    if (!config.ntpEnabled) setConfirmOpen(true)
    else void save()
  }

  async function save() {
    if (!config || saving) return
    setConfirmOpen(false)
    setSaving(true)
    try {
      const result = await apiClient.putTimeConfig({
        timezone: config.timezone,
        ntpEnabled: config.ntpEnabled,
        ntpServers: config.ntpServers,
        systemTime: config.ntpEnabled ? '' : config.systemTime,
        baseRevision: config.revision,
        operationId: createUuid()
      })
      result.warnings?.forEach((warning) => toast.push('warn', warning))
      toast.push('success', pick('Đã lưu cấu hình thời gian', 'Time settings saved'))
      await load()
    } catch (saveError) {
      toast.push('error', saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSaving(false)
    }
  }

  const displayedUtc = status ? new Date(new Date(status.nowUtc).getTime() + Date.now() - anchorMs).toISOString() : ''
  /* T57-1.8 — độ lệch giữa giờ SẼ ĐẶT và giờ thiết bị ĐANG chạy. Tính từ
     `status.nowUtc` (giờ của bo) chứ không từ `Date.now()` của máy trạm: máy
     trạm có thể lệch, và khi đó cảnh báo sẽ nói sai về hướng dịch chuyển. */
  const clockDelta = computeClockDelta(config?.ntpEnabled ? '' : config?.systemTime, status?.nowUtc)
  const backwardSeconds = clockDelta !== null && clockDelta < 0 ? Math.abs(clockDelta) : null
  const deltaLabel = clockDelta === null ? null : formatClockDelta(clockDelta)
  const dirty = Boolean(config && savedConfig && JSON.stringify(config) !== JSON.stringify(savedConfig))
  const update = (patch: Partial<TimeConfig>) => setConfig((current) => current ? { ...current, ...patch } : current)

  if (loading && !config) return <State title={pick('Đang tải cấu hình thời gian', 'Loading time settings')} />
  if (error && !config) return <State title={pick('Không tải được cấu hình thời gian', 'Could not load time settings')} detail={error} retry={() => void load()} />
  if (!config || !status) return null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{pick('Thời gian/Ngày', 'Time/Date')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Cấu hình và trạng thái thời gian controller', 'Controller time configuration and status')}</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button className="flex-1 sm:flex-none" icon={<RefreshCw className="h-4 w-4" />} loading={refreshing} disabled={saving} onClick={() => void refreshStatus()}>{pick('Làm mới trạng thái', 'Refresh status')}</Button>
          <Button className="flex-1 sm:flex-none" variant="primary" icon={<Save className="h-4 w-4" />} loading={saving} disabled={refreshing || !dirty} onClick={requestSave}>{pick('Lưu', 'Save')}</Button>
        </div>
      </div>

      <Panel title={pick('Giờ thiết bị hiện tại', 'Current device time')}>
        <div className="grid gap-4 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-4 lg:grid-cols-[1fr_auto]">
          <div className="flex min-w-0 items-center gap-3">
            <Clock3 className="h-7 w-7 shrink-0 text-[var(--c-accent)]" />
            <div className="min-w-0">
              <div className="mono break-all text-lg font-semibold sm:text-xl">{displayedUtc}</div>
              <div className="mt-1 text-xs text-[var(--c-text-dim)]">{status.nowLocal} · {status.timezone}</div>
            </div>
          </div>
          <StatusBadge state={status.synchronized ? 'online' : 'unknown'} label={status.mode === 'ntp' ? 'NTP ON' : 'MANUAL'} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <StatusItem label={pick('Nguồn', 'Source')} value={status.source ?? 'n/a'} />
          <StatusItem label={pick('Độ lệch', 'Offset')} value={status.offsetMs === null ? 'n/a' : `${status.offsetMs} ms`} />
          <StatusItem label={pick('Đồng bộ cuối', 'Last sync')} value={status.lastSyncUtc ?? 'n/a'} />
          <StatusItem label="RTC" value={status.rtcPresent ? status.rtcUtc ?? 'present' : 'not present'} />
        </dl>
        {status.warnings.map((warning) => <div key={warning} className="mt-3 flex gap-2 text-sm text-[var(--c-warn-fg)]"><AlertTriangle className="h-4 w-4 shrink-0" />{warning}</div>)}
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="NTP">
          <div className="space-y-4">
            <label className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm font-semibold">
              {pick('Bật NTP', 'Enable NTP')}
              <input type="checkbox" className="h-4 w-4 accent-[var(--c-accent)]" checked={config.ntpEnabled} onChange={(event) => update({ ntpEnabled: event.target.checked })} />
            </label>
            <label className="block text-xs text-[var(--c-text-dim)]">
              {pick('Máy chủ NTP (phân cách bằng dấu phẩy)', 'NTP servers (comma separated)')}
              <input className={inputClass} value={config.ntpServers.join(', ')} onChange={(event) => update({ ntpServers: event.target.value.split(',').map((server) => server.trim()).filter(Boolean) })} disabled={!config.ntpEnabled} />
            </label>
          </div>
        </Panel>

        <Panel title={pick('Timezone & đặt thủ công', 'Timezone & manual set')}>
          <div className="space-y-4">
            <label className="block text-xs text-[var(--c-text-dim)]">
              Timezone
              <select className={inputClass} value={config.timezone} onChange={(event) => update({ timezone: event.target.value })}>
                {['Asia/Ho_Chi_Minh', 'UTC', 'Asia/Bangkok', 'Asia/Singapore'].map((zone) => <option key={zone}>{zone}</option>)}
              </select>
            </label>
            <label className="block text-xs text-[var(--c-text-dim)]">
              {pick('Đặt giờ thủ công', 'Manual time')}
              <input aria-invalid={Boolean(manualError)} className={inputClass} type="text" placeholder="2026-07-18T10:00:00+07:00" value={config.systemTime} onChange={(event) => { update({ systemTime: event.target.value }); setManualError(null) }} disabled={config.ntpEnabled} />
            </label>
            {manualError && <p className="text-xs text-[var(--c-fault-fg)]">{manualError}</p>}
          </div>
        </Panel>
      </div>

      {/* T57-1.8 (§6.17-P1) — cảnh báo hậu quả khi đổi giờ hệ thống.
          Bản trước là MỘT câu chung chung ("có thể ảnh hưởng audit, lịch và
          timestamp"), giống hệt nhau cho việc chỉnh tới 3 giây và cho việc lùi
          đồng hồ 6 tiếng. Lùi đồng hồ trên một thiết bị đang ghi historian tạo
          ra dữ liệu CHỒNG LẤN không thể phân giải: hai mẫu khác nhau mang cùng
          một mốc thời gian, và không truy vấn nào tách được chúng về sau. */}
      <Modal
        open={confirmOpen}
        danger={backwardSeconds !== null}
        title={backwardSeconds !== null
          ? pick('Bạn đang LÙI đồng hồ hệ thống', 'You are moving the system clock BACKWARD')
          : pick('Xác nhận đổi giờ thủ công', 'Confirm manual time change')}
        confirmLabel={backwardSeconds !== null ? pick('Tôi hiểu hậu quả, vẫn lùi đồng hồ', 'I understand, move the clock back') : undefined}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void save()}
      >
        <ClockChangeConsequences backwardSeconds={backwardSeconds} deltaLabel={deltaLabel} />
      </Modal>
    </div>
  )
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-[var(--radius)] bg-[var(--c-surface-2)] p-3"><dt className="text-xs text-[var(--c-text-dim)]">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>
}

function State({ title, detail, retry }: { title: string; detail?: string; retry?: () => void }) {
  const { pick } = useI18n()
  return <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-6 text-sm"><p className="font-semibold">{title}</p>{detail && <p className="mt-2 text-[var(--c-fault-fg)]">{detail}</p>}{retry && <Button className="mt-4" onClick={retry}>{pick('Thử lại', 'Retry')}</Button>}</div>
}

/**
 * Độ lệch giây giữa giờ sắp đặt và giờ thiết bị. Âm = LÙI đồng hồ.
 *
 * `null` khi không tính được — và khi đó giao diện KHÔNG được đoán hướng dịch
 * chuyển; nó quay về câu cảnh báo chung.
 */
export function computeClockDelta(target: string | undefined, deviceNowUtc: string | undefined): number | null {
  if (!target || !deviceNowUtc) return null
  const targetMs = Date.parse(target)
  const deviceMs = Date.parse(deviceNowUtc)
  if (!Number.isFinite(targetMs) || !Number.isFinite(deviceMs)) return null
  return Math.round((targetMs - deviceMs) / 1000)
}

export function formatClockDelta(seconds: number): string {
  const abs = Math.abs(seconds)
  const direction = seconds < 0 ? 'lùi' : 'tiến'
  if (abs < 60) return `${direction} ${abs} giây`
  if (abs < 3600) return `${direction} ${Math.floor(abs / 60)} phút ${abs % 60} giây`
  const hours = Math.floor(abs / 3600)
  const minutes = Math.floor((abs % 3600) / 60)
  return `${direction} ${hours} giờ ${minutes} phút`
}

/**
 * Nội dung hộp thoại xác nhận đổi giờ — `T57-1.8`, đề xuất §6.17-P1.
 *
 * LÙI đồng hồ và TIẾN đồng hồ có hậu quả khác hẳn nhau, nên không dùng chung
 * một câu:
 *
 *  - **Lùi**: historian đang ghi sẽ nhận hai mẫu khác nhau mang **cùng một mốc
 *    thời gian**. Không truy vấn nào tách được chúng về sau — dữ liệu của
 *    khoảng bị chồng lấn hỏng vĩnh viễn, kể cả khi đặt lại giờ đúng ngay sau đó.
 *    Lịch vận hành cũng có thể chạy lại các chuyển trạng thái đã chạy rồi.
 *  - **Tiến**: tạo một khoảng TRỐNG trong historian và có thể làm lịch **bỏ
 *    qua** các chuyển trạng thái nằm trong khoảng nhảy — bơm đáng lẽ bật lúc
 *    06:00 sẽ không bao giờ nhận lệnh nếu đồng hồ nhảy từ 05:59 sang 06:05.
 */
function ClockChangeConsequences({ backwardSeconds, deltaLabel }: { backwardSeconds: number | null; deltaLabel: string | null }) {
  const { pick } = useI18n()
  if (backwardSeconds === null) {
    return (
      <div className="space-y-3 text-sm">
        {deltaLabel && <p className="font-semibold">{pick(`Đồng hồ hệ thống sẽ ${deltaLabel}.`, `The system clock will move ${deltaLabel}.`)}</p>}
        <p>{pick(
          'Đẩy đồng hồ TIẾN tạo một khoảng trống trong dữ liệu lịch sử, và có thể làm lịch vận hành BỎ QUA các chuyển trạng thái nằm trong khoảng nhảy — một bơm đáng lẽ bật lúc 06:00 sẽ không nhận lệnh nếu đồng hồ nhảy từ 05:59 sang 06:05.',
          'Moving the clock FORWARD leaves a gap in historical data and can make schedules SKIP transitions inside the jump — a pump due to start at 06:00 never receives the command if the clock jumps from 05:59 to 06:05.'
        )}</p>
        <p>{pick('Mọi vết kiểm toán ghi sau thời điểm này sẽ mang mốc thời gian mới. Tiếp tục?', 'Every audit record written after this point carries the new timestamp. Continue?')}</p>
      </div>
    )
  }
  return (
    <div className="space-y-3 text-sm">
      <p className="font-semibold text-[var(--c-fault-fg)]">
        {pick(`Đồng hồ hệ thống sẽ ${deltaLabel ?? 'lùi lại'}.`, `The system clock will move ${deltaLabel ?? 'backward'}.`)}
      </p>
      <ul className="list-disc space-y-2 pl-5">
        <li>{pick(
          'Historian: khoảng thời gian bị lặp lại sẽ nhận HAI mẫu khác nhau mang CÙNG một mốc thời gian. Không truy vấn nào tách được chúng về sau — dữ liệu của khoảng đó hỏng vĩnh viễn, kể cả khi bạn đặt lại giờ đúng ngay sau đó.',
          'Historian: the repeated interval receives TWO different samples with the SAME timestamp. No query can separate them afterwards — that range is permanently corrupted, even if you restore the correct time immediately.'
        )}</li>
        <li>{pick(
          'Lịch vận hành: các chuyển trạng thái trong khoảng bị lùi qua sẽ CHẠY LẠI. Thiết bị đã tắt theo lịch có thể bật lại, và ngược lại.',
          'Schedules: transitions inside the repeated interval RUN AGAIN. Equipment already stopped by a schedule may restart, and vice versa.'
        )}</li>
        <li>{pick(
          'Nhật ký kiểm toán: các vết mới sẽ nằm TRƯỚC các vết cũ khi sắp theo thời gian, làm trình tự sự việc đọc sai.',
          'Audit log: new records sort BEFORE existing ones, so the sequence of events reads incorrectly.'
        )}</li>
      </ul>
      <p>{pick('Chỉ tiếp tục nếu bạn thực sự cần đặt lại đồng hồ về quá khứ.', 'Only continue if you genuinely need to set the clock back.')}</p>
    </div>
  )
}
