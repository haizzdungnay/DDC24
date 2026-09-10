import { useCallback, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Info, Loader2, ShieldAlert, WifiOff } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import { StatusBadge } from '../../../shared/components/StatusBadge'
import { semanticBadgeProps, type SemanticState } from '../shared/semanticState'
import { ContextDetailsPopover, type ContextDetailsCloseOptions } from './ContextDetailsPopover'
import { formatObservedAt, type ContextDetailsData } from './contextDetails'
import type {
  ProgrammingProgramRuntimeState,
  ProgrammingProgramsPage,
  ProgrammingRuntime,
  ProgrammingTargetState,
  RemoteState
} from '../model/types'
import type { ActiveRevisionOwnership } from '../shared/activeRevisionOwnership'
import type { ProgrammingEditingContext } from './ProgrammingLayout'

type ResourceStatus = RemoteState<unknown>['status']
type NoticeKind = 'loading' | 'empty' | 'error' | 'permission' | 'stale' | 'offline' | 'unknown'
type Pick = (vi: string, en: string) => string

interface ContextNotice {
  kind: NoticeKind
  title: string
  detail?: string
}

/**
 * Chiều cao hàng Context Strip. README §3 chốt khoảng **36–40 px**; con số nằm
 * ở đây dưới dạng hằng số (không phải một lớp Tailwind chôn trong markup) để
 * test khẳng định được đúng ràng buộc đó trong jsdom, nơi không có CSS.
 */
export const PROGRAMMING_CONTEXT_STRIP_HEIGHT_PX = 38

/**
 * `R60-05` — ở 1280 px không đủ chỗ cho cả năm dữ kiện trên một hàng 38 px.
 * Thứ tự rút gọn đã chốt: **Core → Active → Draft**. Dữ kiện bị cắt KHÔNG biến
 * mất, nó đi vào popover `Details` (`T60-103`).
 *
 * Hai dữ kiện không bao giờ bị cắt: tên Project (người dùng phải luôn biết mình
 * đang ở đâu) và tóm tắt sức khoẻ Program (thứ trả lời "hệ có đang chạy không").
 */
export const CONTEXT_STRIP_TRIM_ORDER = ['core', 'active', 'draft'] as const

export type TrimmableContextField = typeof CONTEXT_STRIP_TRIM_ORDER[number]

/**
 * Ngưỡng ẩn của từng dữ kiện. Cắt trước ⇒ cần màn RỘNG HƠN mới hiện, nên
 * breakpoint giảm dần đúng theo `CONTEXT_STRIP_TRIM_ORDER`. Ở 1280 px (`xl`)
 * còn Project + Draft + Active + sức khoẻ; `Core` đã vào `Details`.
 */
const TRIM_BREAKPOINT_CLASS: Readonly<Record<TrimmableContextField, string>> = {
  core: 'hidden 2xl:flex',
  active: 'hidden xl:flex',
  draft: 'hidden lg:flex'
}

/**
 * `ProgrammingContextStrip` — `T60-102`, thay `ProgrammingContextBar` của
 * `T59-503`.
 *
 * ĐÂY LÀ ĐỔI BỐ CỤC, KHÔNG ĐỔI NGỮ NGHĨA. Toàn bộ luật fail-closed của bản
 * trước được giữ nguyên từng nhánh:
 *
 * - Draft, Active Package, desired intent và runtime read-back vẫn là **bốn**
 *   dữ kiện tách bạch; `desiredEnabled=true` KHÔNG bao giờ được gộp thành
 *   `RUNNING`.
 * - `UNKNOWN` / `stale` / `offline` vẫn nói thành lời, không im lặng rơi về một
 *   giá trị đẹp hơn.
 * - Không có nhánh nào chế ra `0`; thiếu số liệu ra `—`/`Chưa rõ`.
 *
 * Thứ đổi so với `ProgrammingContextBar`:
 *
 * 1. Sáu ô `<dl>` trong panel ~76 px, cuộn theo trang ⇒ **một hàng 38 px,
 *    `position: sticky`** (README §3).
 * 2. **Bỏ mọi UUID khỏi mặt trước** (`AC-PGM01-01`). Bản cũ in thẳng
 *    `draftRevisionId` và `activeRevisionId` ở hai ô — người vận hành phải đọc
 *    36 ký tự hex để trả lời một câu hỏi nhị phân ("có đang chạy không"), và
 *    hai revision cùng tiền tố thì nhìn y hệt nhau. ID thô nay chỉ nằm trong
 *    popover `Details` kèm nút Copy (`T60-103`).
 */
export function ProgrammingContextStrip({
  projectStatus,
  runtimeStatus,
  runtime,
  intentStatus,
  intents,
  intentError,
  editing,
  canMutate,
  details,
  onOpenDetails,
  projectOptions = [],
  selectedProjectId = null,
  onSelectProject,
  draftSequence = null,
  activeSequence = null,
  activeOwnership = { kind: 'owned', projectId: '' },
  children
}: {
  projectStatus: ResourceStatus
  runtimeStatus: ResourceStatus
  runtime: ProgrammingRuntime | null
  intentStatus: ResourceStatus
  intents: ProgrammingProgramsPage | null
  intentError: string | null
  editing: ProgrammingEditingContext | null
  canMutate: boolean
  /**
   * `T60-103` — dữ kiện kỹ thuật thô của popover `Chi tiết`. Có `details` thì
   * strip tự quản trạng thái mở/đóng và tự trả tiêu điểm; đây là **lối duy
   * nhất** tới UUID sau khi `AC-PGM01-01` gỡ chúng khỏi mặt trước.
   */
  details?: ContextDetailsData
  /** Seam của `T60-102`: tầng gọi muốn biết người dùng đã mở `Chi tiết`
   *  (đo lường, mở panel riêng…). Không có `details` lẫn handler ⇒ nút hiện
   *  nhưng vô hiệu hoá kèm lý do, thay vì biến mất không dấu vết. */
  onOpenDetails?: () => void
  /**
   * `DEV-PROG-007` — danh sách Project để chuyển nhanh. Rỗng hoặc đúng một mục
   * ⇒ hiện TÊN, không hiện một hộp chọn chỉ có một dòng: một bộ chọn không đổi
   * được gì là một lời mời bấm vào chỗ không có gì xảy ra.
   */
  projectOptions?: readonly { projectId: string; name: string }[]
  selectedProjectId?: string | null
  onSelectProject?: (projectId: string) => void
  /**
   * `DEV-PROG-008` — số thứ tự Revision (`T60-015`). `null` = "đã xét và chưa
   * biết"; nhãn khi đó BỎ phần `r{N}` chứ không in `r0`.
   */
  draftSequence?: number | null
  activeSequence?: number | null
  /**
   * `ISS-PGUI-01` — Revision đang chạy có thuộc Project đang mở không.
   *
   * Mặc định `owned` để mọi chỗ gọi cũ giữ nguyên hành vi; chỗ gọi thật
   * (`ProgrammingLayout`) truyền kết quả của `activeRevisionOwnership`.
   */
  activeOwnership?: ActiveRevisionOwnership
  /** Slot workspace đẩy điều khiển lên hàng strip (mode switcher, nút Lưu…). */
  children?: ReactNode
}) {
  const { pick } = useI18n()
  const notice = contextNotice({
    pick, projectStatus, runtimeStatus, runtime, intentStatus, intents, intentError, editing, canMutate
  })
  const [detailsOpen, setDetailsOpen] = useState(false)
  const detailsButtonRef = useRef<HTMLButtonElement>(null)
  // `useCallback`: `ContextDetailsPopover` đăng ký listener `keydown`/
  // `pointerdown` phụ thuộc hàm này. Một hàm mới mỗi lần render sẽ gỡ và gắn
  // lại listener ở MỌI lần render của strip — và strip render lại theo nhịp
  // poll của read-model runtime.
  const closeDetails = useCallback(({ returnFocus }: ContextDetailsCloseOptions) => {
    setDetailsOpen(false)
    if (returnFocus) detailsButtonRef.current?.focus()
  }, [])

  return (
    <section
      aria-labelledby="programming-context-title"
      /* `top-16`, KHÔNG phải `top-0`: `TopBar` là `sticky top-0 z-40 h-16`, nên
       * một strip dính ở `top-0` sẽ trượt xuống DƯỚI nó và biến mất đúng lúc
       * người dùng cuộn — tức là mất luôn thứ mà "sticky" sinh ra để giữ.
       * `z-20` nằm dưới banner mất kết nối (`z-30`) và dưới `TopBar` (`z-40`),
       * đúng thứ tự ưu tiên: cảnh báo hạ tầng luôn thắng ngữ cảnh workspace. */
      /* `relative` là mỏ neo của popover `Chi tiết` (`T60-103`): panel đó phải
       * nằm NGOÀI hàng 38 px vì hàng đó `overflow-hidden`. */
      className="relative sticky top-16 z-20 border-b border-[var(--c-border)] bg-[var(--c-surface-2)] px-3"
    >
      <h2 id="programming-context-title" className="sr-only">
        {pick('Ngữ cảnh Lập trình hiện tại', 'Current Programming context')}
      </h2>
      <div
        data-testid="programming-context-strip-row"
        style={{ height: PROGRAMMING_CONTEXT_STRIP_HEIGHT_PX }}
        className="flex items-center gap-x-4 overflow-hidden text-xs"
      >
        <ContextField field="project" label={pick('Project', 'Project')}>
          {projectOptions.length > 1 && onSelectProject ? (
            <select
              data-testid="programming-project-select"
              aria-label={pick('Chọn Project', 'Select project')}
              className="min-w-0 max-w-48 truncate rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-1 py-0.5 text-xs text-[var(--c-text)]"
              value={selectedProjectId ?? ''}
              onChange={(event) => { if (event.target.value) onSelectProject(event.target.value) }}
            >
              {/* Chưa phân giải Project nào thì phải có một mục rỗng để `value`
                  khớp — nếu không, `<select>` tự hiện mục ĐẦU TIÊN và giao diện
                  nói rằng người dùng đang ở một Project họ chưa chọn. */}
              {!selectedProjectId && <option value="">{pick('— chưa chọn', '— none selected')}</option>}
              {projectOptions.map((item) => (
                <option key={item.projectId} value={item.projectId}>{item.name}</option>
              ))}
            </select>
          ) : (
            <span className="truncate text-[var(--c-text)]">{projectValue(pick, projectStatus, editing?.projectName)}</span>
          )}
        </ContextField>

        <ContextField field="draft" label={pick('Nháp', 'Draft')}>
          <DraftBadge pick={pick} projectStatus={projectStatus} editing={editing} sequence={draftSequence} />
        </ContextField>

        <ContextField field="active" label={pick('Đang vận hành', 'Active')}>
          <ActiveBadge pick={pick} runtimeStatus={runtimeStatus} runtime={runtime} sequence={activeSequence} ownership={activeOwnership} />
        </ContextField>

        <ContextField field="core" label={pick('Core', 'Core')}>
          <CoreBadge pick={pick} runtimeStatus={runtimeStatus} runtime={runtime} />
        </ContextField>

        <ContextField field="health" label={pick('Chương trình', 'Programs')}>
          <IntentBadge pick={pick} projectStatus={projectStatus} intentStatus={intentStatus} intents={intents} editing={editing} />
          <RuntimeBadge
            pick={pick}
            projectStatus={projectStatus}
            runtimeStatus={runtimeStatus}
            runtime={runtime}
            intentStatus={intentStatus}
            intents={intents}
            editing={editing}
          />
        </ContextField>

        {children}

        <button
          ref={detailsButtonRef}
          type="button"
          className="ml-auto shrink-0 rounded-[var(--radius)] border border-[var(--c-border)] px-2 py-1 text-[11px] font-semibold text-[var(--c-text-dim)] transition hover:text-[var(--c-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)] disabled:opacity-50"
          aria-haspopup="dialog"
          aria-expanded={detailsOpen}
          aria-controls={detailsOpen ? 'programming-context-details' : undefined}
          disabled={!details && !onOpenDetails}
          title={details || onOpenDetails
            ? pick('Định danh thô, contentHash và mốc đọc gần nhất', 'Raw identifiers, contentHash, and the last observed time')
            : pick('Chi tiết kỹ thuật chưa khả dụng ở bản dựng này', 'Technical details are not available in this build')}
          /* Nút thật `<button>`: `Enter`/`Space` đã sinh ra `click` sẵn, nên
           * "mở được bằng bàn phím" không cần thêm handler `keydown` nào — và
           * thêm vào thì phím `Space` sẽ mở rồi đóng ngay trong cùng một lần
           * nhấn. */
          onClick={() => {
            if (details) setDetailsOpen((open) => !open)
            onOpenDetails?.()
          }}
        >
          {pick('Chi tiết', 'Details')}
        </button>
      </div>
      {details && detailsOpen
        ? <ContextDetailsPopover data={details} anchorRef={detailsButtonRef} onClose={closeDetails} />
        : null}
      {notice ? <ContextStateNotice notice={notice} /> : null}
    </section>
  )
}

/**
 * Một dữ kiện trên hàng. `data-context-field` là móc kiểm chứng của `R60-05`:
 * test đọc nó để chứng minh thứ tự rút gọn đúng, thay vì đo pixel trong jsdom
 * (nơi không có CSS nên mọi phép đo bố cục đều là số giả).
 */
function ContextField({ field, label, children }: { field: string; label: string; children: ReactNode }) {
  const trimClass = TRIM_BREAKPOINT_CLASS[field as TrimmableContextField]
  return (
    <div
      data-context-field={field}
      className={`min-w-0 shrink items-center gap-1.5 whitespace-nowrap ${trimClass ?? 'flex'}`}
    >
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">{label}</span>
      {children}
    </div>
  )
}

function DraftBadge({ pick, projectStatus, editing, sequence }: {
  pick: Pick
  projectStatus: ResourceStatus
  editing: ProgrammingEditingContext | null
  sequence: number | null
}) {
  if (projectStatus === 'loading') return <SemanticBadge pick={pick} state="unknown" label={pick('Đang tải…', 'Loading…')} />
  if (projectStatus === 'error') return <SemanticBadge pick={pick} state="unknown" label={pick('Không đọc được', 'Unavailable')} />
  if (!editing) return <SemanticBadge pick={pick} state="disabled" label={pick('Chưa có bản nháp', 'No draft yet')} />

  const parts: string[] = []
  /* `DEV-PROG-008` — số Revision đứng ĐẦU nhãn: nó là thứ người dùng đối chiếu
     với hồ sơ và với bảng So sánh. `null` = chưa đọc được ⇒ bỏ hẳn phần đó,
     không in `r0` (một Revision số 0 không tồn tại, và nó trông như một số
     thật). */
  if (sequence !== null) parts.push(`r${sequence}`)
  if (editing.dirty) parts.push(pick('Chưa lưu', 'Unsaved'))
  const check = checkStateLabel(pick, editing.checkState)
  if (check) parts.push(check)
  if (parts.length === 0 || (parts.length === 1 && sequence !== null)) parts.push(pick('Đã lưu', 'Saved'))
  const label = parts.join(' · ')

  // Thứ tự ưu tiên: lỗi Check thắng "chưa lưu", vì nó là kết luận của server;
  // "chưa lưu" chỉ là trạng thái cục bộ của trình duyệt.
  const state: SemanticState = editing.checkState === 'failed'
    ? 'fault'
    : editing.dirty
      ? 'warning'
      : editing.checkState === 'checking' || editing.checkState === 'unknown'
        ? 'reconciling'
        : 'good'
  return <SemanticBadge pick={pick} state={state} label={label} />
}


/**
 * Active KHÔNG in `activeRevisionId` nữa (`AC-PGM01-01`). Nhãn `Active #12` theo
 * `D-05` cần `revisions.sequence`, mà trường đó chỉ lộ ra HTTP ở `T60-015` —
 * chưa có thì nói "đang vận hành / chưa vận hành", tuyệt đối không rút gọn UUID
 * để lấp chỗ trống.
 */
function ActiveBadge({ pick, runtimeStatus, runtime, sequence, ownership }: {
  pick: Pick
  runtimeStatus: ResourceStatus
  runtime: ProgrammingRuntime | null
  sequence: number | null
  ownership: ActiveRevisionOwnership
}) {
  if (runtimeStatus === 'loading') return <SemanticBadge pick={pick} state="unknown" label={pick('Đang tải…', 'Loading…')} />
  if (runtimeStatus === 'error' || !runtime || runtime.producerState === 'UNAVAILABLE') {
    return <SemanticBadge pick={pick} state="unknown" label={pick('Không đọc được', 'Unavailable')} />
  }
  if (!runtime.activeRevisionId) return <SemanticBadge pick={pick} state="disabled" label={pick('Chưa vận hành', 'Not commissioned')} />
  /* `ISS-PGUI-01` — gói đang chạy thuộc Project KHÁC, hoặc không phân giải
     được về Project nào. Cả hai đều KHÔNG phải "Có".
  
     Bản trước kết luận "Có" chỉ từ `runtime.activeRevisionId` toàn cục, nên khi
     người dùng mở một Project không vận hành, dải này vẫn nói thiết bị đang
     chạy gói của họ. Đó là câu sai nguy hiểm nhất trong ba câu sai của lỗi
     này: nó nằm ở chỗ người trực ca liếc qua để biết "có đang điều khiển
     không". */
  if (ownership.kind === 'foreign') {
    return <SemanticBadge pick={pick} state="unknown"
      label={pick(`Gói đang chạy thuộc ${ownership.ownerName ?? 'Project khác'}`,
                  `Running package belongs to ${ownership.ownerName ?? 'another project'}`)} />
  }
  if (ownership.kind === 'unresolved') {
    return <SemanticBadge pick={pick} state="unknown"
      label={pick('Chưa xác định được Project của gói đang chạy', 'Cannot resolve the running package’s project')} />
  }
  /* `DEV-PROG-008` — `activeSequence` chỉ được điền khi Revision đang chạy
     THUỘC ĐÚNG Project này (`T60-015`). Thiếu nó thì nhãn nói "Có" như cũ; ghép
     một số của Project khác vào đây sẽ là một câu khẳng định sai về thiết bị. */
  const revision = sequence === null ? '' : `r${sequence} · `
  if (runtime.producerState === 'DEGRADED') {
    return <SemanticBadge pick={pick} state="stale" label={`${revision}${pick('Có — số liệu cũ', 'Yes — stale data')}`} />
  }
  return <SemanticBadge pick={pick} state="good" label={`${revision}${pick('Có', 'Yes')}`} />
}

function CoreBadge({ pick, runtimeStatus, runtime }: {
  pick: Pick
  runtimeStatus: ResourceStatus
  runtime: ProgrammingRuntime | null
}) {
  return <SemanticBadge pick={pick} state={coreConnectionState(runtimeStatus, runtime?.producerState)} label={coreConnectionLabel(pick, runtimeStatus, runtime?.producerState)} />
}

function IntentBadge({ pick, projectStatus, intentStatus, intents, editing }: {
  pick: Pick
  projectStatus: ResourceStatus
  intentStatus: ResourceStatus
  intents: ProgrammingProgramsPage | null
  editing: ProgrammingEditingContext | null
}) {
  if (projectStatus === 'loading' || (editing && intentStatus === 'loading')) {
    return <SemanticBadge pick={pick} state="unknown" label={pick('Đang tải…', 'Loading…')} />
  }
  if (projectStatus === 'error' || intentStatus === 'error') {
    return <SemanticBadge pick={pick} state="fault" label={pick('Không đọc được', 'Unavailable')} />
  }
  if (!editing || !intents || intents.items.length === 0) {
    return <SemanticBadge pick={pick} state="disabled" label={pick('Chưa có chương trình', 'No programs')} />
  }
  const enabled = intents.items.filter((item) => item.desiredEnabled).length
  return (
    <SemanticBadge
      pick={pick}
      state={enabled > 0 ? 'good' : 'disabled'}
      label={pick(`${enabled}/${intents.items.length} muốn bật`, `${enabled}/${intents.items.length} enabled by intent`)}
    />
  )
}

function RuntimeBadge({ pick, projectStatus, runtimeStatus, runtime, intentStatus, intents, editing }: {
  pick: Pick
  projectStatus: ResourceStatus
  runtimeStatus: ResourceStatus
  runtime: ProgrammingRuntime | null
  intentStatus: ResourceStatus
  intents: ProgrammingProgramsPage | null
  editing: ProgrammingEditingContext | null
}) {
  if (runtimeStatus === 'error' || runtime?.producerState === 'UNAVAILABLE') {
    return <SemanticBadge pick={pick} state="fault" label={pick('Không kết nối được Core', 'Core unreachable')} />
  }
  if (runtime?.producerState === 'DEGRADED') {
    return <SemanticBadge pick={pick} state="stale" label={pick('Dữ liệu đã cũ', 'Data is stale')} />
  }
  if (projectStatus === 'loading' || runtimeStatus === 'loading' || (editing && intentStatus === 'loading')) {
    return <SemanticBadge pick={pick} state="unknown" label={pick('Đang tải…', 'Loading…')} />
  }
  if (projectStatus === 'error' || intentStatus === 'error') {
    return <SemanticBadge pick={pick} state="fault" label={pick('Không đọc được', 'Unavailable')} />
  }
  if (!runtime || !editing || !intents || intents.items.length === 0) {
    return <SemanticBadge pick={pick} state="disabled" label={pick('Chưa có chương trình', 'No programs')} />
  }

  const counts = countRuntimeStates(intents)
  const state: SemanticState = counts.FAULTED > 0
    ? 'fault'
    : counts.UNKNOWN > 0
      ? 'unknown'
      : counts.WAITING > 0
        ? 'warning'
        : counts.RUNNING > 0
          ? 'good'
          : 'disabled'
  return (
    <SemanticBadge
      pick={pick}
      state={state}
      label={runtimeStateSummary(counts)}
      title={runtimeStateSummaryFull(counts)}
    />
  )
}

/** Mọi badge của strip đi qua đây: `T60-104` bảo đảm icon + chữ, không chỉ màu. */
function SemanticBadge({ pick, state, label, title }: { pick: Pick; state: SemanticState; label: string; title?: string }) {
  return <StatusBadge {...semanticBadgeProps(pick, state, label)} className="shrink-0" title={title} />
}

function countRuntimeStates(intents: ProgrammingProgramsPage): Record<ProgrammingProgramRuntimeState, number> {
  // ĐÚNG năm trạng thái (D-07). Hai giá trị chuyển tiếp đã bị gỡ khỏi hợp
  // đồng: `start()`/`stop()`/`disable()` của Core đổi trạng thái đồng bộ tức
  // thì nên không có pha trung gian nào để đếm. Giữ lại hai ô đó là dựng sẵn
  // chỗ cho một con số không bao giờ khác 0 — và dạy người đọc một mô hình đã
  // lỗi thời.
  const counts: Record<ProgrammingProgramRuntimeState, number> = {
    DISABLED: 0,
    RUNNING: 0,
    WAITING: 0,
    FAULTED: 0,
    UNKNOWN: 0
  }
  for (const item of intents.items) counts[item.runtimeState] += 1
  return counts
}

/**
 * `DEV-PROG-014` — tóm tắt NGẮN cho hàng 38 px, bản đầy đủ đi vào `title`.
 *
 * Bản cũ nối tất cả trạng thái có mặt: một Project mười Program hỏng cho ra
 * `FAULTED 10 · UNKNOWN 2 · RUNNING 1` — dài hơn cả tên Project, và nó đẩy
 * chính tên Project ra khỏi hàng. Trạng thái NẶNG NHẤT là thứ quyết định người
 * vận hành làm gì tiếp; phần còn lại là `+N` và đọc đủ ở tooltip hoặc ở trang
 * Runtime & Bảo trì, nơi sở hữu bảng trạng thái.
 *
 * `RUNNING 1` một mình vẫn hiện nguyên: khi mọi thứ đang chạy, đó không phải
 * một phần bị cắt mà là toàn bộ câu trả lời.
 */
export function runtimeStateSummary(counts: Record<ProgrammingProgramRuntimeState, number>): string {
  const order: ProgrammingProgramRuntimeState[] = ['FAULTED', 'UNKNOWN', 'WAITING', 'RUNNING', 'DISABLED']
  const present = order.filter((state) => counts[state] > 0)
  if (present.length === 0) return ''
  const head = `${present[0]} ${counts[present[0]]}`
  return present.length === 1 ? head : `${head} · +${present.length - 1}`
}

/** Bản đầy đủ, dùng cho `title` — không cắt gì. */
export function runtimeStateSummaryFull(counts: Record<ProgrammingProgramRuntimeState, number>): string {
  const order: ProgrammingProgramRuntimeState[] = ['FAULTED', 'UNKNOWN', 'WAITING', 'RUNNING', 'DISABLED']
  return order.filter((state) => counts[state] > 0).map((state) => `${state} ${counts[state]}`).join(' · ')
}

function contextNotice({
  pick,
  projectStatus,
  runtimeStatus,
  runtime,
  intentStatus,
  intents,
  intentError,
  editing,
  canMutate
}: {
  pick: Pick
  projectStatus: ResourceStatus
  runtimeStatus: ResourceStatus
  runtime: ProgrammingRuntime | null
  intentStatus: ResourceStatus
  intents: ProgrammingProgramsPage | null
  intentError: string | null
  editing: ProgrammingEditingContext | null
  canMutate: boolean
}): ContextNotice | null {
  if (runtimeStatus === 'error' || runtime?.producerState === 'UNAVAILABLE') {
    return {
      kind: 'offline',
      title: pick('Không kết nối được Core', 'Core is unreachable'),
      detail: runtime?.observedAt
        ? pick(`Active last-known lúc ${formatObservedAt(runtime.observedAt)}; mọi thao tác thay đổi runtime bị khóa.`, `Active was last known at ${formatObservedAt(runtime.observedAt)}; runtime mutations are locked.`)
        : pick('Không có read-back đủ tin cậy; mọi thao tác thay đổi runtime bị khóa.', 'There is no trustworthy read-back; runtime mutations are locked.')
    }
  }
  if (runtime?.producerState === 'DEGRADED') {
    return {
      kind: 'stale',
      title: pick('Dữ liệu đã cũ', 'Data is stale'),
      detail: pick(`Lần đọc gần nhất: ${formatObservedAt(runtime.observedAt)}. Hãy làm mới trước khi thao tác.`, `Last observed: ${formatObservedAt(runtime.observedAt)}. Refresh before acting.`)
    }
  }
  if (projectStatus === 'error') {
    return { kind: 'error', title: pick('Không tải được Project.', 'Could not load the project.') }
  }
  if (intentStatus === 'error') {
    return {
      kind: 'error',
      title: pick('Không tải được trạng thái chương trình.', 'Could not load program states.'),
      detail: intentError ?? undefined
    }
  }
  if (runtimeStatus === 'ready' && !runtime) {
    return { kind: 'unknown', title: pick('Chưa xác định kết quả — đang đối soát', 'Result unknown — reconciling') }
  }
  if (intents?.items.some((item) => item.runtimeState === 'UNKNOWN')) {
    return {
      kind: 'unknown',
      title: pick('Chưa xác định kết quả — đang đối soát', 'Result unknown — reconciling'),
      detail: pick('Ý định Enable được giữ riêng; không tự suy Program đang chạy.', 'Enable intent is preserved separately; the Program is not assumed to be running.')
    }
  }
  if (projectStatus === 'ready' && !editing) {
    return { kind: 'empty', title: pick('Chưa có chương trình', 'No programs yet') }
  }
  if (intentStatus === 'ready' && intents && intents.items.length === 0) {
    return { kind: 'empty', title: pick('Chưa có chương trình', 'No programs yet') }
  }
  if (projectStatus === 'loading' || runtimeStatus === 'loading' || intentStatus === 'loading') {
    return { kind: 'loading', title: pick('Đang tải dữ liệu Programming…', 'Loading Programming data…') }
  }
  if (!canMutate) {
    return {
      kind: 'permission',
      title: pick('Bạn không có quyền thực hiện thao tác này', 'You do not have permission to perform this action'),
      detail: pick('Ngữ cảnh vẫn hiển thị ở chế độ chỉ đọc; máy chủ tiếp tục là nơi quyết định quyền.', 'Context remains visible in read-only mode; the server remains the permission authority.')
    }
  }
  return null
}

/**
 * Thông báo trạng thái nằm NGOÀI hàng 38 px, ngay dưới nó. Nhét cảnh báo vào
 * trong hàng sẽ buộc phải chọn giữa hai cái sai: cắt cụt câu cảnh báo, hoặc phá
 * ràng buộc chiều cao của README §3.
 */
function ContextStateNotice({ notice }: { notice: ContextNotice }) {
  const Icon = notice.kind === 'loading'
    ? Loader2
    : notice.kind === 'offline'
      ? WifiOff
      : notice.kind === 'permission'
        ? ShieldAlert
        : notice.kind === 'empty'
          ? Info
          : AlertTriangle
  const tone = notice.kind === 'error' || notice.kind === 'offline'
    ? 'border-[var(--c-fault)] bg-[var(--c-fault-bg)] text-[var(--c-fault-fg)]'
    : notice.kind === 'stale' || notice.kind === 'unknown'
      ? 'border-[var(--c-warn)] bg-[var(--c-warn-bg)] text-[var(--c-warn-fg)]'
      : 'border-[var(--c-border)] bg-[var(--c-surface)] text-[var(--c-text-dim)]'
  const role = notice.kind === 'error' || notice.kind === 'offline' || notice.kind === 'unknown' ? 'alert' : 'status'

  return (
    <div
      role={role}
      className={`my-0.5 inline-flex max-w-full items-center gap-1.5 rounded-[var(--radius)] border px-2 py-0.5 text-xs leading-tight ${tone}`}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${notice.kind === 'loading' ? 'animate-spin' : ''}`} aria-hidden="true" />
      <div className="inline-flex flex-wrap items-center gap-x-1.5 truncate">
        <strong>{notice.title}</strong>
        {notice.detail ? <span className="opacity-90">{notice.detail}</span> : null}
      </div>
    </div>
  )
}

function projectValue(pick: Pick, status: ResourceStatus, value: string | undefined): string {
  if (status === 'loading') return pick('Đang tải…', 'Loading…')
  if (status === 'error') return pick('— không đọc được', '— unavailable')
  return value || pick('— chưa có', '— none')
}

function checkStateLabel(pick: Pick, state: ProgrammingEditingContext['checkState']): string {
  if (state === 'checking') return pick('Đang kiểm tra', 'Checking')
  if (state === 'passed') return pick('Kiểm tra đạt', 'Check passed')
  if (state === 'failed') return pick('Kiểm tra lỗi', 'Check failed')
  if (state === 'unknown') return pick('Kết quả chưa xác định', 'Result unknown')
  return ''
}

function coreConnectionState(status: ResourceStatus, producerState?: ProgrammingTargetState): SemanticState {
  if (status === 'loading' || (status === 'ready' && !producerState)) return 'unknown'
  if (status === 'error' || producerState === 'UNAVAILABLE') return 'fault'
  if (producerState === 'DEGRADED') return 'warning'
  return 'good'
}

function coreConnectionLabel(pick: Pick, status: ResourceStatus, producerState?: ProgrammingTargetState): string {
  if (status === 'loading') return pick('Đang tải…', 'Loading…')
  if (status === 'error' || producerState === 'UNAVAILABLE') return pick('Không kết nối được Core', 'Core unreachable')
  if (status === 'ready' && !producerState) return pick('Chưa xác định', 'Unknown')
  if (producerState === 'DEGRADED') return pick('Core suy giảm', 'Core degraded')
  return pick('Core đang chạy', 'Core running')
}
