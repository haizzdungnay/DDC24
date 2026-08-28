import { ArrowLeft, CheckCircle2, Filter, History, RefreshCw, Search, TriangleAlert, X } from 'lucide-react'
import { AlarmMetricsPanel } from './AlarmMetricsPanel'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { apiClient } from '../../shared/api/client'
import { runSequential, summarizeSequential, type SequentialOutcome, type SequentialStatus } from '../../shared/bulk/sequential'
import { Modal } from '../../shared/components/Modal'
import { AlarmDurationDialog, type AlarmDurationAction, type AlarmDurationChoice } from '../../shared/components/AlarmDurationDialog'
import { AlarmRow } from '../../shared/components/AlarmRow'
import { Button } from '../../shared/components/Button'
import { Panel } from '../../shared/components/Panel'
import { StateBlock } from '../../shared/components/StateBlock'
import { StatusBadge } from '../../shared/components/StatusBadge'
import { SeverityBadge } from '../../shared/components/pa3/StateAtoms'
import { useToast } from '../../shared/components/Toast'
import { useApi } from '../../shared/hooks/useApi'
import { useUrlFilters } from '../../shared/hooks/useUrlFilters'
import { useI18n } from '../../shared/i18n'
import { roleAtLeast, useAuth } from '../auth'
import type { Alarm, AlarmHistoryEntry, AlarmHistoryQuery, AlarmSetting } from '../../shared/types'
import { formatDateTime } from '../../shared/utils'

type AlarmFilter = 'all' | Alarm['status']

/** Khoá bộ lọc trên URL. `status` thay vì `filter` để đọc được khi nhìn thanh
 *  địa chỉ: `/alarms?status=unack&q=AHU` tự nói ra nó lọc gì. */
const ALARM_FILTER_DEFAULTS = { status: 'all', q: '' }

const alarmFilters: AlarmFilter[] = ['all', 'active', 'unack', 'acked', 'cleared', 'shelved']
const historyEvents = ['started', 'acked', 'returned', 'ended', 'setting_created', 'setting_changed', 'setting_deleted']
const emptyHistoryFilters = { text: '', alarm: '', name: '', from: '', to: '', event: [] as string[], severity: '', status: '' }
type HistoryFilterState = typeof emptyHistoryFilters
type HistoryMode = 'latest' | 'full'
type HistoryOption = { value: string; label: string }
type AlarmActionDialog = { action: AlarmDurationAction; alarm: Alarm } | null

export function AlarmsPage() {
  const state = useApi(apiClient.getAlarms, [], { refreshMs: 2000 })
  const toast = useToast()
  const { pick } = useI18n()
  /* PA3-F10: `viewer` quan sát được cả trang nhưng KHÔNG hành động được.
     Backend đã chặn (`POST /alarms/{id}/ack|suppress|return` là `RoleOperator`);
     đây chỉ là để giao diện nói ra điều đó trước khi người dùng bấm. */
  const { session } = useAuth()
  const canActOnAlarms = roleAtLeast(session?.role, 'operator')
  /* `T57-2.2` — bộ lọc vào URL. Trước đây chúng là `useState`, nên không gửi
     được cho ca sau một đường dẫn tới "các cảnh báo High chưa ack trong 24 h";
     mọi trao đổi phải mô tả bằng lời cách bấm lại bộ lọc. */
  const filters = useUrlFilters(ALARM_FILTER_DEFAULTS)
  const filter = filters.values.status as AlarmFilter
  const query = filters.values.q
  const [dialog, setDialog] = useState<AlarmActionDialog>(null)
  const [actionLoading, setActionLoading] = useState(false)
  /* T57-1.6 — lựa chọn cho xác nhận hàng loạt. Giữ id chứ không giữ đối tượng
     alarm: danh sách được poll lại mỗi 2 giây nên tham chiếu sẽ cũ ngay. */
  const [bulkSelection, setBulkSelection] = useState<Set<string>>(new Set())
  const [bulkAckOpen, setBulkAckOpen] = useState(false)
  /* F-UX-02 — `drilldown.ts` phát ra `/alarms?alarm=<id>` cho MỌI hàng "CẦN XỬ
   * LÝ" trên Landing và cho mọi sự kiện alarm trong nhật ký hoạt động, nhưng
   * trang này chưa từng đọc query string. Kết quả: bấm "Xem chi tiết" ở cảnh
   * báo Critical mở ra danh sách đầy đủ không lọc gì — người trực phải tự dò
   * lại đúng cảnh báo mình vừa bấm, giữa lúc đang có sự cố. Đây đúng là kiểu
   * "hỏng im lặng" mà chú thích trong `drilldown.ts` cảnh báo. */
  const [searchParams, setSearchParams] = useSearchParams()
  const focusedAlarmId = searchParams.get('alarm')?.trim() ?? ''
  function clearFocusedAlarm() {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('alarm')
      return next
    }, { replace: true })
  }
  const alarms = state.data ?? []
  const rows = useMemo(() => alarms.filter((alarm) =>
    (!focusedAlarmId || alarm.id === focusedAlarmId)
    && alarmMatchesStatus(alarm, filter)
    && alarmMatchesQuery(alarm, query)
  ), [alarms, filter, focusedAlarmId, query])
  /* Deep link tới một cảnh báo đã hết (hoặc id sai) phải NÓI RA, không được hiện
     bảng rỗng im lặng — người đọc sẽ không phân biệt được "cảnh báo đã kết thúc"
     với "trang hỏng". */
  const focusedAlarmMissing = Boolean(focusedAlarmId) && state.data !== null && !alarms.some((alarm) => alarm.id === focusedAlarmId)
  const counts = useMemo(() => ({
    all: alarms.length,
    active: alarms.filter(isConditionActive).length,
    unack: alarms.filter((alarm) => alarm.status === 'unack').length,
    acked: alarms.filter((alarm) => alarm.status === 'acked').length,
    cleared: alarms.filter((alarm) => alarm.status === 'cleared').length,
    shelved: alarms.filter((alarm) => alarm.status === 'shelved').length
  }), [alarms])

  /* Giải lại từ danh sách MỚI NHẤT: cảnh báo vừa tự hết trong lúc người dùng
     còn đang chọn sẽ tự rơi ra, thay vì đi vào một lệnh chắc chắn bị từ chối. */
  const bulkAlarms = useMemo(
    () => alarms.filter((alarm) => bulkSelection.has(alarm.id) && alarm.status !== 'acked' && alarm.status !== 'cleared' && alarm.status !== 'shelved'),
    [alarms, bulkSelection]
  )

  function toggleBulkSelection(alarm: Alarm) {
    setBulkSelection((current) => {
      const next = new Set(current)
      if (next.has(alarm.id)) next.delete(alarm.id)
      else next.add(alarm.id)
      return next
    })
  }

  async function confirmAlarmAction(choice: AlarmDurationChoice) {
    if (!dialog) return
    setActionLoading(true)
    try {
      if (dialog.action === 'ack') await apiClient.ackAlarm(dialog.alarm.id, choice)
      else await apiClient.suppressAlarm(dialog.alarm.id, choice)
      await state.refetch()
      window.dispatchEvent(new CustomEvent('mkddc:alarms-updated'))
      toast.push('success', `${dialog.action === 'ack' ? 'Ack' : 'Off'} ${dialog.alarm.id}`)
      setDialog(null)
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : `${dialog.action === 'ack' ? 'Ack' : 'Off'} failed`)
    } finally {
      setActionLoading(false)
    }
  }

  async function returnAlarm(alarm: Alarm) {
    try {
      await apiClient.returnAlarm(alarm.id)
      await state.refetch()
      window.dispatchEvent(new CustomEvent('mkddc:alarms-updated'))
      toast.push('success', `Return ${alarm.id}`)
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : 'Return failed')
    }
  }

  /* Trạng thái tải/lỗi vẫn giữ tiêu đề trang (PA3-603 / WCAG 2.4.6): một
     `StateBlock` trần làm trang mất `<h1>`, nên người dùng trình đọc màn hình
     nghe thấy thông báo lỗi mà không biết mình đang ở trang nào. */
  if (state.loading && !alarms.length) {
    return <div className="space-y-4"><AlarmsHeading /><StateBlock state="loading" title={pick('Đang tải cảnh báo', 'Loading alarms')} /></div>
  }
  if (state.error && !alarms.length) {
    return <div className="space-y-4"><AlarmsHeading /><StateBlock state="error" title={pick('Không tải được cảnh báo', 'Could not load alarms')} detail={state.error.message} onRetry={state.refetch} /></div>
  }

  const filterLabels: Record<AlarmFilter, string> = {
    all: pick('tất cả', 'all'),
    active: 'active',
    unack: pick('chưa xác nhận', 'unack'),
    acked: pick('đã xác nhận', 'acked'),
    cleared: 'cleared',
    shelved: 'shelved'
  }

  return (
    <div className="space-y-5">
      <AlarmsHeading />
      {focusedAlarmId && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--c-accent)] bg-[var(--c-accent-bg)] px-3 py-2 text-sm text-[var(--c-accent)]">
          <span>
            {focusedAlarmMissing
              ? pick(`Không còn cảnh báo nào mang mã ${focusedAlarmId} trong danh sách đang hoạt động.`, `No active alarm with id ${focusedAlarmId} remains in the list.`)
              : pick(`Đang lọc theo một cảnh báo: ${focusedAlarmId}`, `Filtered to a single alarm: ${focusedAlarmId}`)}
          </span>
          <Button size="sm" variant="secondary" icon={<X className="h-4 w-4" />} onClick={clearFocusedAlarm}>
            {pick('Xem tất cả cảnh báo', 'Show all alarms')}
          </Button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Summary label={pick('Đang hoạt động', 'Active')} value={counts.active} accent="fault" />
        <Summary label={pick('Chưa xác nhận', 'Unacknowledged')} value={counts.unack} accent="warn" />
        <Summary label="Shelved" value={counts.shelved} accent="info" />
        <Summary label={pick('Đang hiển thị', 'Listed')} value={alarms.length} accent="good" />
      </div>
      {/* `T57-3.3`: nhịp cảnh báo là chỉ số quyết định hệ còn quản lý được hay
          không. Đặt TRÊN danh sách vì nó trả lời câu hỏi phải hỏi trước khi đọc
          từng cảnh báo: "hệ đang ngập hay không?". */}
      <AlarmMetricsPanel />

      <Panel>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {alarmFilters.map((item) => (
            <Button key={item} size="sm" variant={filter === item ? 'primary' : 'secondary'} onClick={() => filters.set('status', item)}>
              {filterLabels[item]} {counts[item]}
            </Button>
          ))}
          <label className="ml-auto flex h-9 min-w-[260px] items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3">
            <Search className="h-4 w-4 text-[var(--c-text-dim)]" /><input className="w-full bg-transparent text-sm outline-none" placeholder={pick('Tìm cảnh báo...', 'Search alarms...')} value={query} onChange={(event) => filters.set('q', event.target.value)} />
          </label>
          <Button size="sm" icon={<Filter className="h-4 w-4" />} onClick={filters.clear}>{pick('Xoá lọc', 'Clear')}</Button>
        </div>
        {canActOnAlarms && bulkSelection.size > 0 && (
          <div role="region" aria-label={pick('Thao tác hàng loạt', 'Bulk actions')} className="mb-3 flex flex-wrap items-center gap-3 rounded-[var(--radius)] border-2 border-[var(--c-accent)] bg-[var(--c-accent-bg)] px-3 py-2">
            <span className="text-sm font-bold text-[var(--c-accent)]">
              {pick(`Đã chọn ${bulkAlarms.length} cảnh báo chưa xác nhận`, `${bulkAlarms.length} unacknowledged alarms selected`)}
            </span>
            <span className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setBulkSelection(new Set())}>{pick('Bỏ chọn tất cả', 'Clear selection')}</Button>
              <Button size="sm" variant="primary" disabled={bulkAlarms.length === 0} onClick={() => setBulkAckOpen(true)}>
                {pick(`Xác nhận ${bulkAlarms.length} cảnh báo…`, `Acknowledge ${bulkAlarms.length} alarms…`)}
              </Button>
            </span>
          </div>
        )}
        <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)]">
          {rows.map((alarm) => (
            <AlarmRow
              key={alarm.id}
              alarm={alarm}
              canAct={canActOnAlarms}
              bulkSelected={canActOnAlarms ? bulkSelection.has(alarm.id) : undefined}
              onBulkToggle={toggleBulkSelection}
              onAck={(item) => setDialog({ action: 'ack', alarm: item })}
              onSuppress={(item) => setDialog({ action: 'off', alarm: item })}
              onReturn={returnAlarm}
            />
          ))}
          {!rows.length && <StateBlock state="empty" title={pick('Không có cảnh báo phù hợp', 'No matching alarms')} />}
        </div>
      </Panel>
      {bulkAckOpen && (
        <BulkAckDialog
          alarms={bulkAlarms}
          onClose={() => setBulkAckOpen(false)}
          onDone={() => {
            setBulkSelection(new Set())
            void state.refetch()
            window.dispatchEvent(new CustomEvent('mkddc:alarms-updated'))
          }}
          onAck={async (alarm, choice) => { await apiClient.ackAlarm(alarm.id, choice) }}
        />
      )}
      <AlarmHistoryPanel mode="latest" />
      <AlarmDurationDialog
        action={dialog?.action ?? 'ack'}
        alarmLabel={dialog?.alarm.message ?? ''}
        open={Boolean(dialog)}
        loading={actionLoading}
        onCancel={() => setDialog(null)}
        onConfirm={confirmAlarmAction}
      />
    </div>
  )
}

/**
 * Xác nhận cảnh báo hàng loạt — `T57-1.6`, đề xuất §6.3-P2c.
 *
 * TRIỆU CHỨNG: hôm nay ack từng cái một. Khi alarm flood, người trực sẽ tìm
 * cách bấm nhanh nhất — nên phải thiết kế sẵn một đường đi an toàn cho việc đó
 * thay vì để họ tự chế ra một đường không an toàn.
 *
 * ## Trường "Lý do" — nói thật về nơi nó đi tới
 *
 * ISA-18.2 muốn ack hàng loạt phải kèm lý do. **Backend hiện KHÔNG nhận được
 * trường đó**: `AlarmActionRequest` (`apps/web-api/internal/app/dto.go`) chỉ có
 * `durationS` và `permanent`, còn `decodeAlarmActionRequest` gọi
 * `dec.DisallowUnknownFields()` — nghĩa là gửi thêm `reason` sẽ ăn **400 Bad
 * Request**, không phải bị bỏ qua.
 *
 * Có ba lựa chọn, và hai trong ba là nói dối:
 *
 *  1. Bỏ hẳn trường lý do ⇒ mất nhịp dừng mà ISA-18.2 muốn có.
 *  2. Hiện trường lý do và ngầm cho hiểu là nó được lưu ⇒ **bịa**: người trực
 *     tin rằng lý do của mình nằm trong hồ sơ, và tin điều đó đúng lúc điều tra
 *     sự cố cần nó nhất.
 *  3. Giữ trường lý do làm **nhịp dừng bắt buộc trong phiên**, và NÓI THẲNG
 *     trên giao diện rằng nó chưa vào nhật ký, kèm mã finding để tra.
 *
 * Chọn (3). Ghi nhận thiếu sót là `F-UX-18` và giao cho `T57-3.22` (thêm
 * `reason` vào hợp đồng ack/suppress + ghi vào `alarm_history.jsonl`).
 *
 * Phần KHÔNG bị chặn vẫn làm đủ: một hộp thoại, một lựa chọn thời hạn dùng
 * chung, và **một vết kiểm toán riêng cho mỗi cảnh báo** — vì mỗi cảnh báo là
 * một lời gọi `POST /alarms/{id}/ack` riêng, và backend ghi `audit.AlarmAck`
 * cho từng lời gọi.
 */
function BulkAckDialog({ alarms, onClose, onDone, onAck }: {
  alarms: Alarm[]
  onClose: () => void
  onDone: () => void
  onAck: (alarm: Alarm, choice: AlarmDurationChoice) => Promise<void>
}) {
  const { pick } = useI18n()
  const [reason, setReason] = useState('')
  const [permanent, setPermanent] = useState(true)
  const [durationMinutes, setDurationMinutes] = useState('60')
  const [phase, setPhase] = useState<'confirm' | 'running' | 'done'>('confirm')
  const [outcomes, setOutcomes] = useState<SequentialOutcome[]>([])
  const [runList, setRunList] = useState<Alarm[]>([])
  const abortRef = useRef(false)

  const parsedMinutes = Number(durationMinutes)
  const durationValid = permanent || (durationMinutes.trim() !== '' && Number.isFinite(parsedMinutes) && parsedMinutes > 0)
  /* Lý do BẮT BUỘC — đây là nhịp dừng cố ý chống "bấm nhanh nhất có thể" khi
     alarm flood. Ngưỡng 8 ký tự chặn được "ok"/"x" mà không biến thành một bài
     tập viết văn giữa lúc có sự cố. */
  const reasonValid = reason.trim().length >= 8
  const canApply = reasonValid && durationValid && alarms.length > 0

  async function apply() {
    abortRef.current = false
    setRunList(alarms)
    setPhase('running')
    setOutcomes([])
    const choice: AlarmDurationChoice = permanent
      ? { permanent: true }
      : { permanent: false, durationS: Math.round(parsedMinutes * 60) }
    const result = await runSequential(
      alarms.map((alarm) => ({ id: alarm.id, label: alarm.message || alarm.id, alarm })),
      (item) => onAck(item.alarm, choice),
      { isAborted: () => abortRef.current, onProgress: (outcome) => setOutcomes((current) => [...current, outcome]) }
    )
    setOutcomes(result)
    setPhase('done')
    onDone()
  }

  const summary = summarizeSequential(outcomes)

  return (
    <Modal
      open
      size="xl"
      title={phase === 'done'
        ? pick(`${summary.sent} cảnh báo đã xác nhận, ${summary.failed} thất bại`, `${summary.sent} acknowledged, ${summary.failed} failed`)
        : pick(`Xác nhận ${alarms.length} cảnh báo cùng lúc`, `Acknowledge ${alarms.length} alarms at once`)}
      cancelLabel={phase === 'done' ? pick('Đóng', 'Close') : pick('Huỷ', 'Cancel')}
      confirmLabel={phase === 'confirm' ? pick(`Xác nhận ${alarms.length} cảnh báo`, `Acknowledge ${alarms.length} alarms`) : undefined}
      confirmDisabled={!canApply}
      confirmLoading={phase === 'running'}
      onConfirm={phase === 'confirm' ? () => { void apply() } : undefined}
      onClose={() => { if (phase === 'running') abortRef.current = true; onClose() }}
    >
      <div className="space-y-4">
        {phase === 'confirm' && (
          <>
            <p className="text-sm text-[var(--c-text-dim)]">
              {pick(
                'Mỗi cảnh báo được gửi bằng một lệnh riêng và sinh một vết kiểm toán riêng — backend không có API xác nhận hàng loạt.',
                'Each alarm is sent as its own command and produces its own audit record — the backend has no bulk acknowledge API.'
              )}
            </p>

            <ul className="max-h-[240px] divide-y divide-[var(--c-border)] overflow-y-auto rounded-[var(--radius)] border border-[var(--c-border)]">
              {alarms.map((alarm) => (
                <li key={alarm.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs">
                  <SeverityBadge severity={alarm.severity} />
                  <span className="mono shrink-0 text-[var(--c-text-dim)]">{alarm.id}</span>
                  <span className="min-w-[160px] flex-1 truncate font-semibold">{alarm.message}</span>
                  <span className="shrink-0 text-[var(--c-text-dim)]">{formatDateTime(alarm.time)}</span>
                </li>
              ))}
            </ul>

            <label className="block text-sm">
              {pick('Lý do xác nhận (bắt buộc)', 'Acknowledgement reason (required)')}
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                aria-invalid={!reasonValid}
                rows={3}
                className="mt-2 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 py-2 text-sm"
                placeholder={pick('Ví dụ: đang xử lý sự cố bơm CH-1, đã cô lập van…', 'For example: handling CH-1 pump fault, valve isolated…')}
              />
              {!reasonValid && (
                <span role="alert" className="mt-1 block text-xs text-[var(--c-fault-fg)]">
                  {pick('Nhập ít nhất 8 ký tự nêu lý do xác nhận.', 'Enter at least 8 characters describing the reason.')}
                </span>
              )}
            </label>

            {/* Nói THẲNG lý do đi đâu. Để người dùng tự suy ra rằng nó được lưu
                là bịa — và bịa đúng vào thứ họ sẽ đi tìm khi điều tra sự cố. */}
            <p className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">
              {pick(
                'Lý do này CHƯA được ghi vào nhật ký cảnh báo: endpoint xác nhận hiện không nhận trường lý do (finding F-UX-18, đã lên lịch ở T57-3.22). Nó đóng vai trò nhịp dừng bắt buộc trong phiên làm việc này. Vết kiểm toán vẫn ghi ai xác nhận, cảnh báo nào và lúc nào.',
                'This reason is NOT yet written to the alarm log: the acknowledge endpoint does not accept a reason field (finding F-UX-18, scheduled as T57-3.22). It acts as a required pause in this session. The audit trail still records who acknowledged which alarm and when.'
              )}
            </p>

            <fieldset className="rounded-[var(--radius)] border border-[var(--c-border)] p-3">
              <legend className="px-1 text-sm font-semibold">{pick('Thời hạn dùng chung', 'Shared duration')}</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="ack-duration" checked={permanent} onChange={() => setPermanent(true)} className="h-4 w-4 accent-[var(--c-accent)]" />
                {pick('Vĩnh viễn', 'Permanent')}
              </label>
              <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <input type="radio" name="ack-duration" checked={!permanent} onChange={() => setPermanent(false)} className="h-4 w-4 accent-[var(--c-accent)]" />
                {pick('Có thời hạn (phút)', 'Timed (minutes)')}
                <input
                  type="number"
                  min="1"
                  value={durationMinutes}
                  disabled={permanent}
                  aria-label={pick('Số phút', 'Minutes')}
                  aria-invalid={!durationValid}
                  onChange={(event) => setDurationMinutes(event.target.value)}
                  className="mono h-9 w-28 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-2 disabled:opacity-50"
                />
              </label>
              {!durationValid && <span role="alert" className="mt-1 block text-xs text-[var(--c-fault-fg)]">{pick('Thời hạn phải lớn hơn 0 phút', 'The duration must be greater than 0 minutes')}</span>}
            </fieldset>
          </>
        )}

        {phase !== 'confirm' && (
          <>
            <p className="text-sm font-semibold">
              {pick(`${outcomes.length} / ${runList.length} cảnh báo đã xử lý`, `${outcomes.length} / ${runList.length} alarms processed`)}
            </p>
            <ul className="divide-y divide-[var(--c-border)] rounded-[var(--radius)] border border-[var(--c-border)]">
              {runList.map((alarm) => {
                const outcome = outcomes.find((item) => item.id === alarm.id)
                return (
                  <li key={alarm.id} role={outcome?.status === 'failed' ? 'alert' : 'status'} className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs">
                    <span className="mono w-[110px] shrink-0 text-[var(--c-text-dim)]">{alarm.id}</span>
                    <span className="min-w-[140px] flex-1 truncate">{alarm.message}</span>
                    <BulkAckBadge status={outcome?.status} />
                    {outcome?.message && <span className="w-full text-[var(--c-fault-fg)] md:w-auto">{outcome.message}</span>}
                  </li>
                )
              })}
            </ul>
            {phase === 'done' && summary.skipped > 0 && (
              <p role="status" className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">
                {pick(
                  `${summary.skipped} cảnh báo bị bỏ qua do huỷ giữa chừng và VẪN chưa được xác nhận.`,
                  `${summary.skipped} alarms were skipped by the cancellation and remain unacknowledged.`
                )}
              </p>
            )}
            {phase === 'running' && (
              <Button size="sm" variant="secondary" onClick={() => { abortRef.current = true }}>
                {pick('Huỷ phần còn lại', 'Cancel the rest')}
              </Button>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

/** Nhãn CHỮ kèm icon hình khác nhau, không chỉ màu (WCAG 2.2 §1.4.1). */
function BulkAckBadge({ status }: { status?: SequentialStatus }) {
  const { pick } = useI18n()
  if (status === 'sent') return <span className="inline-flex items-center gap-1 font-bold text-[var(--c-good-fg)]"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />{pick('ĐÃ XÁC NHẬN', 'ACKNOWLEDGED')}</span>
  if (status === 'failed') return <span className="inline-flex items-center gap-1 font-bold text-[var(--c-fault-fg)]"><TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />{pick('THẤT BẠI', 'FAILED')}</span>
  if (status === 'skipped') return <span className="inline-flex items-center gap-1 font-bold text-[var(--c-text-dim)]"><X className="h-3.5 w-3.5" aria-hidden="true" />{pick('ĐÃ BỎ QUA', 'SKIPPED')}</span>
  return <span className="font-bold text-[var(--c-accent)]">{pick('ĐANG GỬI…', 'SENDING…')}</span>
}

export function AlarmHistoryPage() {
  const { pick } = useI18n()
  const navigate = useNavigate()
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{pick('Lịch sử cảnh báo', 'Alarm history')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Toàn bộ bản ghi cảnh báo', 'Full alarm history')}</p>
        </div>
        <Button size="sm" variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/alarms')}>
          {pick('Alarm log', 'Alarm log')}
        </Button>
      </div>
      <AlarmHistoryPanel mode="full" />
    </div>
  )
}

function AlarmHistoryPanel({ mode }: { mode: HistoryMode }) {
  const navigate = useNavigate()
  const { pick } = useI18n()
  const [historyFilters, setHistoryFilters] = useState(emptyHistoryFilters)
  const historyQuery = useMemo(() => makeHistoryQuery(historyFilters, mode === 'full'), [historyFilters, mode])
  const historyDeps = [mode, historyFilters.text, historyFilters.alarm, historyFilters.name, historyFilters.from, historyFilters.to, historyFilters.event.join(','), historyFilters.severity, historyFilters.status]
  const historyState = useApi(() => apiClient.getAlarmHistory(historyQuery), historyDeps)
  const settingsState = useApi(apiClient.getAlarmSettings, [])
  const history = historyState.data ?? []
  const settings = settingsState.data ?? []
  const historyRows = useMemo(() => [...history].reverse(), [history])
  const alarmOptions = useMemo(() => ensureSelectedOption(alarmHistoryOptions(history, settings), historyFilters.alarm), [history, settings, historyFilters.alarm])
  const nameOptions = useMemo(() => ensureSelectedOption(nameHistoryOptions(history, settings), historyFilters.name), [history, settings, historyFilters.name])

  useEffect(() => {
    const refresh = () => { void historyState.refetch() }
    window.addEventListener('mkddc:alarms-updated', refresh)
    return () => window.removeEventListener('mkddc:alarms-updated', refresh)
  }, [historyState.refetch])

  function toggleHistoryEvent(event: string) {
    setHistoryFilters((current) => {
      const enabled = current.event.includes(event)
      return { ...current, event: enabled ? current.event.filter((item) => item !== event) : [...current.event, event] }
    })
  }

  return (
    <Panel
      title={pick('Lịch sử cảnh báo', 'Alarm history')}
      subtitle={mode === 'full' ? pick('Toàn bộ bản ghi khớp bộ lọc', 'All matching records') : pick('20 bản ghi mới nhất khớp bộ lọc', 'Latest 20 matching records')}
      action={(
        <div className="flex flex-wrap justify-end gap-2">
          {mode === 'latest' && (
            <Button size="sm" variant="secondary" icon={<History className="h-4 w-4" />} onClick={() => navigate('/alarms/history')}>
              {pick('Mở toàn bộ', 'Full history')}
            </Button>
          )}
          <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={historyState.refetch}>{pick('Tải lại', 'Refresh')}</Button>
        </div>
      )}
    >
      <div className="mb-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <HistoryInput label="Text" value={historyFilters.text} onChange={(value) => setHistoryFilters((current) => ({ ...current, text: value }))} />
        <HistorySelect label="Alarm" value={historyFilters.alarm} options={alarmOptions} onChange={(value) => setHistoryFilters((current) => ({ ...current, alarm: value }))} />
        <HistorySelect label="Name" value={historyFilters.name} options={nameOptions} onChange={(value) => setHistoryFilters((current) => ({ ...current, name: value }))} />
        <HistoryInput label="From" type="datetime-local" value={historyFilters.from} onChange={(value) => setHistoryFilters((current) => ({ ...current, from: value }))} />
        <HistoryInput label="To" type="datetime-local" value={historyFilters.to} onChange={(value) => setHistoryFilters((current) => ({ ...current, to: value }))} />
        <label className="text-xs font-semibold text-[var(--c-text-dim)]">
          Severity
          <select className="mt-1 h-9 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-2 text-sm text-[var(--c-text)]" value={historyFilters.severity} onChange={(event) => setHistoryFilters((current) => ({ ...current, severity: event.target.value }))}>
            <option value="">all</option><option value="critical">critical</option><option value="high">high</option><option value="medium">medium</option><option value="low">low</option><option value="info">info</option>
          </select>
        </label>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {historyEvents.map((event) => (
          <label key={event} className="inline-flex h-8 items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-xs">
            <input type="checkbox" checked={historyFilters.event.includes(event)} onChange={() => toggleHistoryEvent(event)} />
            {event}
          </label>
        ))}
        <select className="h-8 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-2 text-xs" value={historyFilters.status} onChange={(event) => setHistoryFilters((current) => ({ ...current, status: event.target.value }))}>
          <option value="">status: all</option><option value="active">active</option><option value="acked">acked</option><option value="normal">normal</option><option value="cleared">cleared</option><option value="unack">unack</option>
        </select>
        <Button size="sm" variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => setHistoryFilters(emptyHistoryFilters)}>{pick('Xoá lọc', 'Clear')}</Button>
      </div>
      {historyState.loading && !history.length ? (
        <StateBlock state="loading" title={pick('Đang tải lịch sử cảnh báo', 'Loading alarm history')} />
      ) : historyState.error && !history.length ? (
        <StateBlock state="error" title={pick('Chưa có endpoint lịch sử cảnh báo', 'Alarm history endpoint unavailable')} detail={historyState.error.message} onRetry={historyState.refetch} />
      ) : (
        <div className={mode === 'full' ? 'overflow-auto rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)]' : 'max-h-[560px] overflow-auto rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)]'}>
          {historyRows.map((alarm, index) => <HistoryRow key={alarm.eventId ?? `${alarm.id}-${alarm.event ?? alarm.status}-${index}`} alarm={alarm} />)}
          {!historyRows.length && <StateBlock state="empty" title={pick('Chưa có lịch sử cảnh báo', 'No alarm history')} />}
        </div>
      )}
    </Panel>
  )
}

function isConditionActive(alarm: Alarm): boolean {
  return alarm.active ?? (alarm.status === 'active' || alarm.status === 'acked')
}

/** Tiêu đề trang, dùng chung cho cả trạng thái bình thường lẫn loading/lỗi. */
function AlarmsHeading() {
  const { pick } = useI18n()
  return (
    <div>
      <h1 className="text-2xl font-semibold">{pick('Cảnh báo', 'Alarms')}</h1>
      <p className="text-sm text-[var(--c-text-dim)]">{pick('Theo dõi, lọc và xác nhận cảnh báo', 'Monitor, filter, and acknowledge alarms')}</p>
    </div>
  )
}

function alarmMatchesStatus(alarm: Alarm, filter: AlarmFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'active') return isConditionActive(alarm)
  return alarm.status === filter
}

function alarmMatchesQuery(alarm: Alarm, query: string): boolean {
  const text = `${alarm.id} ${alarm.message} ${alarm.source} ${alarm.value} ${alarm.detail}`.toLowerCase()
  return text.includes(query.toLowerCase())
}

function makeHistoryQuery(filters: HistoryFilterState, full: boolean): AlarmHistoryQuery {
  return {
    limit: full ? 'all' : 20,
    text: filters.text,
    alarm: filters.alarm,
    name: filters.name,
    from: localDateTimeToIso(filters.from),
    to: localDateTimeToIso(filters.to),
    event: filters.event,
    severity: filters.severity,
    status: filters.status
  }
}

function localDateTimeToIso(value: string): string | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

function HistorySelect({ label, value, options, onChange }: { label: string; value: string; options: HistoryOption[]; onChange: (value: string) => void }) {
  return (
    <label className="text-xs font-semibold text-[var(--c-text-dim)]">
      {label}
      <select className="mt-1 h-9 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-2 text-sm text-[var(--c-text)]" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">all</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

function HistoryInput({ label, value, onChange, type = 'search' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="text-xs font-semibold text-[var(--c-text-dim)]">
      {label}
      <input className="mt-1 h-9 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-2 text-sm text-[var(--c-text)] outline-none" type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function alarmHistoryOptions(history: AlarmHistoryEntry[], settings: AlarmSetting[]): HistoryOption[] {
  return uniqueHistoryOptions([
    ...settings.map((alarm) => ({ value: alarm.id, label: alarm.label && alarm.label !== alarm.id ? `${alarm.id} - ${alarm.label}` : alarm.id })),
    ...history.map((alarm) => ({ value: alarm.id, label: alarm.message && alarm.message !== alarm.id ? `${alarm.id} - ${alarm.message}` : alarm.id }))
  ])
}

function nameHistoryOptions(history: AlarmHistoryEntry[], settings: AlarmSetting[]): HistoryOption[] {
  return uniqueHistoryOptions([
    ...settings.map((alarm) => ({ value: alarm.label, label: alarm.label })),
    ...history.flatMap((alarm) => [alarm.message, alarm.before?.label, alarm.after?.label].filter((value): value is string => Boolean(value?.trim())).map((value) => ({ value, label: value })))
  ])
}

function uniqueHistoryOptions(options: HistoryOption[]): HistoryOption[] {
  const byValue = new Map<string, HistoryOption>()
  for (const option of options) {
    const value = option.value.trim()
    if (!value || byValue.has(value)) continue
    byValue.set(value, { value, label: option.label.trim() || value })
  }
  return [...byValue.values()].sort((left, right) => left.label.localeCompare(right.label))
}

function ensureSelectedOption(options: HistoryOption[], value: string): HistoryOption[] {
  const selected = value.trim()
  if (!selected || options.some((option) => option.value === selected)) return options
  return [{ value: selected, label: selected }, ...options]
}

/* F-UX-13 (`REV-FE-UIUX-UC-2026-08-18` §7.1).
 *
 * TRIỆU CHỨNG: nhật ký cảnh báo gộp 5 mức severity của ISA-18.2 thành 3 trạng
 * thái hình ảnh, và `low`/`info` rơi vào state `ok` — tức là **xanh lá**. Xanh
 * lá trong HMI công nghiệp có đúng một nghĩa: bình thường/an toàn (IEC 60073
 * §4.2). Vẽ một sự kiện cảnh báo bằng màu "an toàn" là nói ngược nội dung của
 * chính dòng đó, và khiến người đọc lướt qua nó.
 *
 * NGUYÊN NHÂN GỐC: ánh xạ severity→visual được viết lại tại chỗ trong
 * `HistoryRow` bằng một biểu thức ba ngôi, trong khi `SeverityBadge` của
 * `pa3/StateAtoms` đã có đủ 5 mức kèm icon riêng và màu đã qua `contrast.test`.
 *
 * CÁCH SỬA: xoá hẳn ánh xạ tại chỗ, dùng `SeverityBadge`. Một nguồn duy nhất
 * cho từ vựng severity ⇒ đổi màu/nhãn ở `StateAtoms` là mọi nơi đổi theo. */
function HistoryRow({ alarm }: { alarm: AlarmHistoryEntry }) {
  const statusState = historyStateFor(alarm)
  const closedAt = alarm.clearedAt ?? alarm.acknowledgedAt
  const detail = alarmHistoryDetail(alarm)
  const actor = alarm.ackedBy ?? alarm.user
  return (
    <div className="grid grid-cols-[140px_112px_96px_1fr_136px] items-center gap-3 border-b border-[var(--c-border)] px-3 py-3 text-xs last:border-0 max-lg:grid-cols-1">
      <span className="mono text-[var(--c-text-dim)]">{formatDateTime(alarm.time)}</span>
      <StatusBadge state={statusState} label={historyLabel(alarm)} />
      <SeverityBadge severity={alarm.severity} />
      <div className="min-w-0">
        <div className="truncate font-semibold">{alarm.message}</div>
        <div className="mt-1 truncate text-[var(--c-text-dim)]">{detail}</div>
      </div>
      <div className="min-w-0 text-right max-lg:text-left">
        <div className="truncate text-[var(--c-text-dim)]">{actor ?? '-'}</div>
        {closedAt && <div className="mono mt-1 truncate text-[var(--c-text-dim)]">{formatDateTime(closedAt)}</div>}
      </div>
    </div>
  )
}

function historyLabel(alarm: AlarmHistoryEntry): string {
  if (alarm.event === 'started') return 'START'
  if (alarm.event === 'ended') return 'END'
  if (alarm.event === 'acked') return 'ACK'
  if (alarm.event === 'returned') return 'RETURN'
  if (alarm.event?.startsWith('setting_')) return 'SETTING'
  return alarm.status.toUpperCase()
}

function historyStateFor(alarm: AlarmHistoryEntry): 'alarm' | 'warn' | 'good' | 'off' {
  if (alarm.event === 'started' || alarm.event === 'returned') return 'alarm'
  if (alarm.event === 'ended') return 'good'
  if (alarm.event === 'acked' || alarm.event?.startsWith('setting_')) return 'off'
  if (alarm.status === 'active') return 'alarm'
  if (alarm.status === 'unack') return 'warn'
  if (alarm.status === 'cleared') return 'good'
  return 'off'
}

function alarmHistoryDetail(alarm: AlarmHistoryEntry): string {
  if (alarm.event === 'setting_changed') return `${alarm.before?.label ?? alarm.id} -> ${alarm.after?.label ?? alarm.message}`
  if (alarm.event === 'setting_deleted') return `deleted ${alarm.before?.label ?? alarm.message}`
  if (alarm.event === 'setting_created') return `created ${alarm.after?.label ?? alarm.message}`
  return [alarm.source, alarm.value || 'n/a', alarm.detail].filter(Boolean).join(' / ')
}

function Summary({ label, value, accent }: { label: string; value: number; accent: 'fault' | 'warn' | 'info' | 'good' }) {
  const color = accent === 'fault' ? 'var(--c-fault-fg)' : accent === 'warn' ? 'var(--c-warn-fg)' : accent === 'info' ? 'var(--c-info)' : 'var(--c-good-fg)'
  return <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4"><div className="mono text-4xl font-bold" style={{ color }}>{value}</div><div className="mt-2 text-xs text-[var(--c-text-dim)]">{label}</div></div>
}
