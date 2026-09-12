import { Clock } from 'lucide-react'
import { formatTechnicalDateTime, type HmiLocale } from '../../../shared/dateTime'
import { useI18n } from '../../../shared/i18n'
import { Panel } from '../../../shared/components/Panel'
import { StatusBadge } from '../../../shared/components/StatusBadge'
import { semanticBadgeProps, semanticStateDescriptor, semanticStateHint, type SemanticState } from '../shared/semanticState'
import type { OverviewViewModel } from './overviewViewModel'
import type { ProgrammingTargetState, ProgrammingTaskState, RemoteState } from '../model/types'

/**
 * `T60-202` — `SystemHealthHero` của PGM-01 (handoff §1 mục 2, §2 *System
 * Health*).
 *
 * BỐN DỮ KIỆN, KHÔNG HƠN
 * ----------------------
 * Handoff §2 liệt kê đúng bốn thứ cho khối này: **kết nối Core**, **trạng thái
 * runtime**, **safe-state khi đọc được**, và **mốc cập nhật authority gần
 * nhất**. Không có CPU/RAM/%-sức-khoẻ ở đây (Plan 60 §3.1 cấm), cũng không có
 * bảng Draft/Active (đó là `T60-203`) và không có danh sách việc cần chú ý (đó
 * là `T60-204`). Khối này trả lời đúng một câu: *hệ đang khoẻ hay không, và
 * số liệu tôi đang nhìn có đáng tin không.*
 *
 * ĐIỂM SỐNG CÒN: `safeStateNoControllerOnly` ≠ SAFE-STATE DO LỖI THẬT
 * -------------------------------------------------------------------
 * `safeStateNoControllerOnly = true` nghĩa là Core vào safe-state **chỉ vì**
 * trigger `no_controller` đứng một mình — chưa Program nào ghi output vật lý ở
 * mức trên Default. Đó là tình huống mà **Commission sẽ giải quyết**, nên nó là
 * cảnh báo NHẸ và **không** khoá Commission/Restore. Safe-state do
 * `iop_fault` / `stale` / `graph_input_bad` / `overrun` là chuyện khác hẳn:
 * nghiêm trọng, và Commission/Restore phải giữ khoá cho tới khi người vận hành
 * kiểm tra Core, I/O và alarm.
 *
 * Gộp hai thứ này làm một là dạy người vận hành sai theo cả hai chiều: hoặc họ
 * hoảng vì một hệ mới lắp chưa có output nào, hoặc họ Commission đè lên một lỗi
 * I/O thật. Phân biệt này đã có ở `OverviewPage` hiện hành
 * (`ProgrammingAttentionList`, mã `PRG-SAFE-ACTIVE`) và được **bê nguyên ngữ
 * nghĩa** sang đây — `SystemHealthHero.test.tsx` khoá lại cả hai nhánh.
 *
 * KHÔNG TỰ CHẾ TRẠNG THÁI
 * -----------------------
 * `systemHealthSummary` chỉ **xếp hạng** các trạng thái mà server đã nói ra; nó
 * không suy ra trạng thái nào mới. Thiếu bất kỳ dữ kiện nào ⇒ kết luận rơi về
 * `unknown`, **không bao giờ** rơi về `good` (README §3: `unknown/stale/offline`
 * phải tường minh; Plan 60 §0.1: server là authority).
 */

type PickFn = (vi: string, en: string) => string
type ResourceStatus = RemoteState<unknown>['status']

/* ------------------------------------------------------------------ *
 * Ba trạng thái thành phần                                            *
 * ------------------------------------------------------------------ */

/**
 * Trạng thái ngữ nghĩa của tác vụ điều khiển.
 *
 * `STOPPED` ra `warning` chứ **không** ra `unknown`: ta biết rõ nó đã dừng —
 * gọi là "chưa rõ" là bỏ mất một sự thật server đã nói. `STARTING` ra
 * `reconciling` vì nó là một pha chuyển tiếp chưa kết luận được, đúng nghĩa của
 * trạng thái ngữ nghĩa mà `T60-104` bổ sung. (Lưu ý: D-07 chỉ loại
 * `STARTING`/`STOPPING` ở mức **Program**; `ProgrammingTaskState` ở mức Task
 * vẫn còn `STARTING` trong hợp đồng.)
 *
 * `null` = `GET /runtime` chưa đọc được ⇒ `unknown`, không mặc định `STOPPED`.
 */
export function taskSemanticState(taskState: ProgrammingTaskState | null): SemanticState {
  switch (taskState) {
    case 'RUNNING':
      return 'good'
    case 'FAULT':
      return 'fault'
    case 'STOPPED':
      return 'warning'
    case 'STARTING':
      return 'reconciling'
    default:
      return 'unknown'
  }
}

export interface SafeStateFacts {
  /** `null` = chưa đọc được runtime. KHÔNG được hiểu thành `false`. */
  active: boolean | null
  /** Chỉ có nghĩa khi `active === true`. */
  noControllerOnly: boolean
}

/**
 * `warning` cho safe-state chỉ-vì-chưa-có-output, `fault` cho safe-state do lỗi
 * thật. Đây là chỗ duy nhất quyết định mức nghiêm trọng của safe-state trong
 * khối này — sửa ở đây là sửa cả badge, cả câu chữ, cả xếp hạng tổng.
 */
export function safeStateSemanticState({ active, noControllerOnly }: SafeStateFacts): SemanticState {
  if (active === null) return 'unknown'
  if (!active) return 'good'
  return noControllerOnly ? 'warning' : 'fault'
}

/* ------------------------------------------------------------------ *
 * Xếp hạng tổng                                                       *
 * ------------------------------------------------------------------ */

/**
 * Thang nghiêm trọng để chọn kết luận tổng = **xấu nhất trong các thành phần**.
 *
 * `stale` xếp trên `warning` có chủ đích: `warning` là một bất thường ĐÃ BIẾT
 * và đã được mô tả, còn `stale` nghĩa là toàn bộ những gì đang hiện có thể
 * không còn đúng — người vận hành cần biết điều đó trước.
 *
 * `unknown` xếp TRÊN `good` và `disabled`: một dữ kiện chưa đọc được không bao
 * giờ được để một dữ kiện khoẻ mạnh che đi. Đây là điều kiện khiến khối này
 * không bao giờ nói "hệ thống ổn định" khi Core đang im.
 */
export const SYSTEM_HEALTH_SEVERITY: Readonly<Record<SemanticState, number>> = {
  fault: 60,
  stale: 50,
  warning: 40,
  reconciling: 30,
  unknown: 20,
  disabled: 10,
  good: 0
}

/** Kết luận tổng: trạng thái nghiêm trọng nhất trong các thành phần. Danh sách rỗng ⇒ `unknown`. */
export function systemHealthSummary(parts: readonly SemanticState[]): SemanticState {
  let worst: SemanticState = 'unknown'
  let worstRank = -1
  for (const part of parts) {
    const rank = SYSTEM_HEALTH_SEVERITY[part]
    if (rank > worstRank) {
      worst = part
      worstRank = rank
    }
  }
  return worst
}

/** Câu kết luận một dòng. D-06: một ngôn ngữ tại một thời điểm. */
export function systemHealthHeadline(pick: PickFn, state: SemanticState): string {
  switch (state) {
    case 'good':
      return pick('Hệ thống hoạt động ổn định', 'System is healthy')
    case 'warning':
      return pick('Hệ thống đang chạy nhưng có việc cần xem lại', 'System is running but something needs review')
    case 'stale':
      return pick('Số liệu đang xem có thể đã cũ', 'The values on screen may be out of date')
    case 'fault':
      return pick('Hệ thống đang có lỗi cần xử lý', 'System has a fault that needs attention')
    case 'reconciling':
      return pick('Đang chuyển tiếp — chưa kết luận được', 'A transition is in progress — no conclusion yet')
    case 'disabled':
      return pick('Hệ thống đang bị tắt có chủ đích', 'System is intentionally turned off')
    case 'unknown':
      return pick('Chưa đọc đủ trạng thái để kết luận', 'Not enough state was read to conclude')
  }
}

/* ------------------------------------------------------------------ *
 * Nhãn từng dòng                                                      *
 * ------------------------------------------------------------------ */

function coreLabel(pick: PickFn, producerState: ProgrammingTargetState | null): string {
  switch (producerState) {
    case 'READY':
      return pick('Đang kết nối', 'Connected')
    case 'DEGRADED':
      return pick('Suy giảm', 'Degraded')
    case 'UNAVAILABLE':
      return pick('Không kết nối được', 'Unreachable')
    default:
      return pick('Chưa rõ', 'Unknown')
  }
}

function coreNote(pick: PickFn, producerState: ProgrammingTargetState | null): string | null {
  switch (producerState) {
    case 'READY':
      return null
    case 'DEGRADED':
      // Giữ nguyên hệ quả vận hành đã có ở `OverviewPage` (`PRG-CORE-DEGRADED`).
      return pick('Chỉ chẩn đoán; mọi thay đổi runtime đang bị khoá.', 'Diagnose only; runtime mutations are locked.')
    case 'UNAVAILABLE':
      return pick('Kiểm tra service Core và kết nối IPC.', 'Check the Core service and the IPC connection.')
    default:
      return pick('Chưa đọc được từ Core.', 'Not read from Core.')
  }
}

function taskLabel(pick: PickFn, taskState: ProgrammingTaskState | null): string {
  switch (taskState) {
    case 'RUNNING':
      return pick('Đang chạy', 'Running')
    case 'STOPPED':
      return pick('Đã dừng', 'Stopped')
    case 'STARTING':
      return pick('Đang khởi động', 'Starting')
    case 'FAULT':
      return pick('Lỗi', 'Fault')
    case 'UNKNOWN':
      return pick('Chưa rõ', 'Unknown')
    default:
      return pick('Chưa rõ', 'Unknown')
  }
}

function taskNote(pick: PickFn, taskState: ProgrammingTaskState | null, activePresent: boolean): string | null {
  if (taskState === null) return pick('Chưa đọc được từ Core.', 'Not read from Core.')
  // Vì sao đã dừng — câu trả lời thường gặp nhất của một controller mới lắp.
  if (!activePresent) {
    return pick('Chưa có gói nào được đưa vào vận hành.', 'No package has been commissioned yet.')
  }
  if (taskState === 'FAULT') {
    return pick('Mở Runtime để xem số lần quá giờ và trạng thái tác vụ.', 'Open Runtime to inspect overruns and task state.')
  }
  return null
}

/**
 * Nhãn safe-state. Hai nhánh "đang tác động" mang **câu chữ khác nhau**, không
 * chỉ khác màu — `AC` chung của Plan 60: màu không bao giờ là tín hiệu duy nhất.
 */
function safeStateLabel(pick: PickFn, facts: SafeStateFacts): string {
  if (facts.active === null) return pick('Chưa rõ', 'Unknown')
  if (!facts.active) return pick('Không tác động', 'Not active')
  return facts.noControllerOnly
    ? pick('Đang tác động — chưa có output vật lý', 'Active — no physical output yet')
    : pick('Đang tác động do lỗi', 'Active due to a fault')
}

/**
 * Lời giải thích safe-state. Nội dung bê nguyên ngữ nghĩa từ
 * `OverviewPage.ProgrammingAttentionList` (`PRG-SAFE-ACTIVE`), gồm **cả hệ quả
 * vận hành** — chính hệ quả đó mới là thứ phân biệt hai nhánh trong đầu người
 * đọc: một bên Commission vẫn mở, một bên Commission phải giữ khoá.
 */
function safeStateNote(pick: PickFn, facts: SafeStateFacts): string | null {
  if (facts.active === null) return pick('Chưa đọc được từ Core.', 'Not read from Core.')
  if (!facts.active) return null
  return facts.noControllerOnly
    ? pick(
        'Safe-state đang tác động vì chưa Program nào ghi output vật lý ở mức trên Default — bình thường nếu logic chỉ dùng Virtual Point. Không chặn Đưa vào vận hành/Khôi phục.',
        'Safe-state is active because no Program is writing physical output above Default yet — expected if this logic only uses Virtual Points. It does not block Commission/Restore.'
      )
    : pick(
        'Safe-state đang tác động do lỗi thật (I/O, dữ liệu cũ hoặc quá giờ). Giữ Đưa vào vận hành/Khôi phục bị khoá; kiểm tra Core, I/O và alarm trước khi phục hồi.',
        'Safe-state is active due to a real fault (I/O, stale data or overrun). Keep Commission/Restore locked; inspect Core, I/O and alarms before recovery.'
      )
}

/** Mốc authority gần nhất; dữ liệu không phân giải được phải fail-closed thành `—`. */
export function formatAuthorityTimestamp(value: string, locale: HmiLocale = 'vi-VN'): string {
  return formatTechnicalDateTime(value, locale)
}

/* ------------------------------------------------------------------ *
 * Component                                                           *
 * ------------------------------------------------------------------ */

export interface SystemHealthHeroProps {
  /** `overviewViewModel().core` — trạng thái ngữ nghĩa + `producerState` + `observedAt`. */
  core: OverviewViewModel['core']
  /** `overviewViewModel().safeState`. */
  safeState: SafeStateFacts
  /** `overviewViewModel().active` — chỉ dùng `taskState` và `present`; nhãn revision thuộc `T60-203`. */
  active: Pick<OverviewViewModel['active'], 'taskState' | 'present'>
  /** Trạng thái tải của `GET /runtime`; `loading` ⇒ khung chờ đúng hình học thẻ (handoff §6). */
  runtimeStatus: ResourceStatus
}

export function SystemHealthHero({ core, safeState, active, runtimeStatus }: SystemHealthHeroProps) {
  const { pick } = useI18n()
  const title = pick('Trạng thái hệ thống', 'System status')

  if (runtimeStatus === 'loading') {
    return (
      <Panel title={title}>
        <SystemHealthSkeleton />
      </Panel>
    )
  }

  const taskState = taskSemanticState(active.taskState)
  const safe = safeStateSemanticState(safeState)
  const summary = systemHealthSummary([core.semantic, taskState, safe])
  const summaryDescriptor = semanticStateDescriptor(summary)
  const SummaryIcon = summaryDescriptor.icon

  return (
    <Panel title={title}>
      <div data-testid="system-health-hero" data-summary-state={summary} className="space-y-3">
        {/* Kết luận tổng: icon + chữ, không bao giờ chỉ có màu. `role="status"`
            để trình đọc màn hình đọc lại khi kết luận đổi. */}
        <div role="status" className="flex items-start gap-3">
          <SummaryIcon className={`mt-0.5 h-8 w-8 shrink-0 ${summaryToneClass(summary)}`} aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-[var(--c-text)]">{systemHealthHeadline(pick, summary)}</p>
            <p className="mt-0.5 text-xs text-[var(--c-text-dim)]">{semanticStateHint(pick, summary)}</p>
          </div>
        </div>

        <dl className="space-y-2 border-t border-[var(--c-border)] pt-3 text-sm">
          <HealthRow
            id="core"
            term={pick('Kết nối Core', 'Core connection')}
            state={core.semantic}
            label={coreLabel(pick, core.producerState)}
            note={coreNote(pick, core.producerState)}
          />
          <HealthRow
            id="task"
            term={pick('Tác vụ điều khiển', 'Control task')}
            state={taskState}
            label={taskLabel(pick, active.taskState)}
            note={taskNote(pick, active.taskState, active.present)}
          />
          <HealthRow
            id="safe-state"
            term={pick('Trạng thái an toàn', 'Safe state')}
            state={safe}
            label={safeStateLabel(pick, safeState)}
            note={safeStateNote(pick, safeState)}
          />
          <AuthorityTimestampRow observedAt={core.observedAt} runtimeStatus={runtimeStatus} />
        </dl>
      </div>
    </Panel>
  )
}

/**
 * Màu của icon kết luận. Chỉ là lớp thứ hai: icon và câu chữ đã tự phân biệt
 * được các trạng thái khi không có màu.
 */
function summaryToneClass(state: SemanticState): string {
  switch (state) {
    case 'good':
      return 'text-[var(--c-good-fg)]'
    case 'fault':
      return 'text-[var(--c-fault-fg)]'
    case 'warning':
    case 'stale':
    case 'reconciling':
      return 'text-[var(--c-warn-fg)]'
    default:
      return 'text-[var(--c-text-dim)]'
  }
}

function HealthRow({ id, term, state, label, note }: {
  id: string
  term: string
  state: SemanticState
  label: string
  note: string | null
}) {
  const { pick } = useI18n()
  return (
    <div data-health-row={id} data-health-state={state} className="flex items-start justify-between gap-3">
      <dt className="pt-1 text-[var(--c-text-dim)]">{term}</dt>
      <dd className="flex max-w-[70%] flex-col items-end gap-1 text-right">
        <StatusBadge {...semanticBadgeProps(pick, state, label)} />
        {note && <span className="text-xs leading-snug text-[var(--c-text-dim)]">{note}</span>}
      </dd>
    </div>
  )
}

/**
 * Mốc cập nhật authority gần nhất. Không đọc được ⇒ `—` **kèm lý do**; tuyệt
 * đối không rơi về `0`, về giờ máy trạm, hay về một mốc cũ không nói rõ là cũ.
 */
function AuthorityTimestampRow({ observedAt, runtimeStatus }: { observedAt: string | null; runtimeStatus: ResourceStatus }) {
  const { pick, locale } = useI18n()
  return (
    <div data-health-row="observed-at" className="flex items-start justify-between gap-3">
      <dt className="flex items-center gap-1.5 text-[var(--c-text-dim)]">
        <Clock className="h-4 w-4" aria-hidden="true" />
        {pick('Cập nhật lần cuối', 'Last authoritative update')}
      </dt>
      <dd className="flex max-w-[70%] flex-col items-end gap-0.5 text-right">
        {observedAt === null ? (
          <>
            <span aria-hidden="true" className="text-[var(--c-text-dim)]">—</span>
            <span className="text-xs leading-snug text-[var(--c-text-dim)]">
              {runtimeStatus === 'error'
                ? pick('Không đọc được trạng thái từ Core.', 'The state could not be read from Core.')
                : pick('Core chưa cung cấp mốc thời gian.', 'Core did not provide a timestamp.')}
            </span>
          </>
        ) : (
          <span className="font-mono text-xs text-[var(--c-text)]">{formatAuthorityTimestamp(observedAt, locale)}</span>
        )}
      </dd>
    </div>
  )
}

/**
 * Khung chờ **khớp hình học** với thẻ thật (handoff §6): một hàng kết luận +
 * bốn hàng dữ kiện. Khung chờ lệch hình học làm bố cục nhảy khi dữ liệu về,
 * đúng thứ người dùng đọc thành "trang bị lỗi".
 */
function SystemHealthSkeleton() {
  const { pick } = useI18n()
  return (
    <div data-testid="system-health-hero-skeleton" role="status" className="space-y-3">
      <span className="sr-only">{pick('Đang đọc trạng thái hệ thống…', 'Reading the system status…')}</span>
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-[var(--c-surface-2)]" />
        <div className="w-full space-y-1.5">
          <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--c-surface-2)]" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--c-surface-2)]" />
        </div>
      </div>
      <div className="space-y-2 border-t border-[var(--c-border)] pt-3">
        {['core', 'task', 'safe-state', 'observed-at'].map((row) => (
          <div key={row} className="flex items-center justify-between gap-3">
            <div className="h-3 w-24 animate-pulse rounded bg-[var(--c-surface-2)]" />
            <div className="h-5 w-28 animate-pulse rounded-full bg-[var(--c-surface-2)]" />
          </div>
        ))}
      </div>
    </div>
  )
}
