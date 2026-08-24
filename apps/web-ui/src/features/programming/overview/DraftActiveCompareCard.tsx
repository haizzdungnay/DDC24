import { useEffect, useRef, useState, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { GitCompare, X } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import { Panel } from '../../../shared/components/Panel'
import { Button } from '../../../shared/components/Button'
import { StatusBadge } from '../../../shared/components/StatusBadge'
import { semanticBadgeProps, type SemanticState } from '../shared/semanticState'
import type {
  ProgrammingCheckState,
  ProgrammingRevisionChange,
  ProgrammingRevisionChanges,
  ProgrammingTaskState,
  RemoteState
} from '../model/types'
import type { OverviewViewModel } from './overviewViewModel'

/**
 * `T60-203` — thẻ so sánh **bản nháp ↔ bản đang vận hành** của PGM-01
 * (handoff §2 mục *Draft vs Active*, §6 nhánh `Draft==Active`).
 *
 * BỐN LUẬT CỦA THẺ NÀY — VÀ VÌ SAO
 * ---------------------------------
 * 1. **Nhãn là `Draft #14` / `Active #12`, KHÔNG BAO GIỜ là UUID** (D-05,
 *    `AC-PGM01-01`). `sequence` chưa phân giải được ⇒ vẽ `—` kèm lý do. Tuyệt
 *    đối không rơi về `#0`: `sequence` bắt đầu từ 1, nên `0` không tồn tại
 *    trong sản phẩm — nhưng nó vẫn là một con số, và một con số luôn được đọc
 *    như một sự thật. Chuỗi UUID rút gọn cũng đã bị D-05 loại.
 *
 * 2. **Số thay đổi CHỈ hiện khi máy chủ trả bảng thay đổi.** FE không diff hai
 *    tài liệu để tự đếm và không suy con số từ `dirty`. Con số duy nhất được
 *    phép hiển thị là số mục trong `changes[]` của
 *    `GET /revisions/{from}/changes/{to}` — bảng do máy chủ tính. Không có
 *    phản hồi đó thì thẻ nói *vì sao chưa có số*, chứ không hiện số nào.
 *
 * 3. **`dirty === null` KHÔNG được đọc thành "sạch".** `null` nghĩa là máy chủ
 *    đã xét và chưa kết luận được (`T60-015`); gộp nó vào `false` sẽ thu gọn
 *    thẻ thành “Không có thay đổi chờ vận hành” trong khi có thể vẫn còn việc
 *    chưa phát hành — đúng một câu nói dối ở đúng chỗ người vận hành tin nhất.
 *
 * 4. **`Draft == Active` mới được thu gọn**, và điều kiện đó phải CHẮC CHẮN:
 *    xem `draftActiveRelation` bên dưới. Mọi trạng thái chưa đủ dữ kiện đi vào
 *    nhánh `UNKNOWN` — thẻ vẫn mở, vẫn hiện cả hai cột, và nói rõ đang thiếu gì.
 *
 * KHÔNG CÓ CTA CHÍNH Ở ĐÂY
 * ------------------------
 * `AC-PGM01-05` cho toàn trang đúng **một** hành động chính, và nó thuộc
 * `T60-201` (`resolvePrimaryCta`). Nút `So sánh` của thẻ này và nút mở PGM-05
 * trong drawer đều là `secondary`.
 *
 * KHÔNG GỌI API
 * -------------
 * Thẻ nhận `changes` từ tầng gọi (`api/queries.ts` là đường HTTP duy nhất).
 * `null` nghĩa là tầng gọi CỐ Ý không hỏi — ví dụ chưa có Active Revision nào
 * để so — khác hẳn “hỏi rồi mà hỏng”.
 */

type Pick = (vi: string, en: string) => string

/* ------------------------------------------------------------------ *
 * Quan hệ Draft ↔ Active                                              *
 * ------------------------------------------------------------------ */

export type DraftActiveRelation =
  /** Chắc chắn cùng một Revision và bản nháp không còn việc chưa phát hành. */
  | 'SAME'
  /** Chắc chắn khác nhau. */
  | 'DIFFERENT'
  /** Core đọc được và nói chưa có gói nào đang vận hành. */
  | 'NO_ACTIVE'
  /** Chưa đủ dữ kiện để kết luận — KHÔNG được thu gọn. */
  | 'UNKNOWN'

export type DraftActiveRelationReason =
  /** `dirty = true`: có việc chưa phát hành, kết luận này không phụ thuộc Core. */
  | 'DRAFT_DIRTY'
  /** Chưa đọc được `GET /runtime` (đang tải, lỗi, hoặc `producerState` không dùng được). */
  | 'RUNTIME_UNAVAILABLE'
  /** Core nói không có Active Revision nào. */
  | 'NO_ACTIVE_REVISION'
  /** `dirty = null`: máy chủ đã xét và chưa biết. */
  | 'DIRTY_UNKNOWN'
  /** Hai `sequence` đọc được và khác nhau. */
  | 'SEQUENCE_DIFFERS'
  /** Thiếu ít nhất một `sequence` nên không so được. */
  | 'SEQUENCE_UNRESOLVED'
  /** Hai `sequence` đọc được và bằng nhau. */
  | 'SAME_REVISION'

export interface DraftActiveComparison {
  relation: DraftActiveRelation
  reason: DraftActiveRelationReason
}

/**
 * Thứ tự xét được chọn để **không bao giờ thu gọn nhầm**.
 *
 * - `dirty = true` đứng đầu vì đó là một sự thật đứng độc lập: bản nháp có
 *   việc chưa phát hành thì luôn khác bản đang chạy, kể cả khi Core im.
 * - Cổng Core đứng ngay sau, cùng lý do với `resolvePrimaryCta`: khi chưa đọc
 *   được gói đang vận hành thì mọi phép so đều là phỏng đoán.
 * - `sequence` là căn cứ so sánh cuối cùng vì `activeSequence` chỉ có giá trị
 *   khi Revision Core đang chạy **thuộc đúng Project này** (`T60-015`); hai số
 *   bằng nhau vì vậy đủ để kết luận cùng một Revision. Thiếu một trong hai số
 *   thì không kết luận gì — không mượn số của Draft cho Active.
 */
export function draftActiveRelation(
  draft: OverviewViewModel['draft'],
  active: OverviewViewModel['active'],
  core: OverviewViewModel['core']
): DraftActiveComparison {
  if (draft.dirty === true) return { relation: 'DIFFERENT', reason: 'DRAFT_DIRTY' }
  if (core.semantic === 'unknown' || core.semantic === 'fault') {
    return { relation: 'UNKNOWN', reason: 'RUNTIME_UNAVAILABLE' }
  }
  if (!active.present) return { relation: 'NO_ACTIVE', reason: 'NO_ACTIVE_REVISION' }
  if (draft.dirty === null) return { relation: 'UNKNOWN', reason: 'DIRTY_UNKNOWN' }
  if (draft.sequence === null || active.sequence === null) {
    return { relation: 'UNKNOWN', reason: 'SEQUENCE_UNRESOLVED' }
  }
  return draft.sequence === active.sequence
    ? { relation: 'SAME', reason: 'SAME_REVISION' }
    : { relation: 'DIFFERENT', reason: 'SEQUENCE_DIFFERS' }
}

/* ------------------------------------------------------------------ *
 * Số thay đổi — CHỈ khi máy chủ trả                                   *
 * ------------------------------------------------------------------ */

export type ChangeCountState =
  /** Máy chủ đã trả bảng thay đổi; `total` là số mục của chính bảng đó. */
  | { kind: 'COUNT'; total: number }
  /** Tầng gọi cố ý không hỏi (chưa có gì để so). */
  | { kind: 'NOT_REQUESTED' }
  | { kind: 'LOADING' }
  /** Đã hỏi và không đọc được — KHÁC HẲN "không có thay đổi nào". */
  | { kind: 'UNAVAILABLE' }

/**
 * `changes[]` vắng mặt hoặc không phải mảng ⇒ `UNAVAILABLE`, không phải `0`.
 * Type sinh tự động chỉ ràng buộc lúc biên dịch; thân phản hồi thật vẫn có thể
 * thiếu khoá, và `0` ở đây đọc y hệt “đã so xong, không có gì khác”.
 */
export function serverChangeCount(changes: RemoteState<ProgrammingRevisionChanges> | null): ChangeCountState {
  if (changes === null) return { kind: 'NOT_REQUESTED' }
  if (changes.status === 'loading') return { kind: 'LOADING' }
  if (changes.status === 'error' || changes.data === null) return { kind: 'UNAVAILABLE' }
  const list = changes.data.changes
  if (!Array.isArray(list)) return { kind: 'UNAVAILABLE' }
  return { kind: 'COUNT', total: list.length }
}

export interface ChangeBreakdown {
  added: number
  modified: number
  removed: number
  /** Giá trị `changeType` ngoài ba loại đã biết. Đếm riêng để tổng ba cột không bao giờ nhỏ hơn tổng thật. */
  other: number
  /** `[kind, số mục]`, sắp theo tên để thứ tự không đổi giữa hai lần đọc. */
  byKind: Array<[string, number]>
}

export function changeBreakdown(list: readonly ProgrammingRevisionChange[]): ChangeBreakdown {
  const result: ChangeBreakdown = { added: 0, modified: 0, removed: 0, other: 0, byKind: [] }
  const kinds = new Map<string, number>()
  for (const change of list) {
    if (change?.changeType === 'ADDED') result.added += 1
    else if (change?.changeType === 'MODIFIED') result.modified += 1
    else if (change?.changeType === 'REMOVED') result.removed += 1
    else result.other += 1
    const kind = typeof change?.kind === 'string' && change.kind.trim() !== '' ? change.kind : null
    if (kind) kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
  }
  result.byKind = [...kinds.entries()].sort((left, right) => left[0].localeCompare(right[0]))
  return result
}

/* ------------------------------------------------------------------ *
 * Nhãn                                                                *
 * ------------------------------------------------------------------ */

/** Trạng thái bản nháp: `dirty` → `checkState`. `null` KHÔNG bao giờ ra "sạch". */
export function draftSemanticState(dirty: boolean | null, checkState: ProgrammingCheckState | null): SemanticState {
  if (dirty === null) return 'unknown'
  if (dirty) return 'warning'
  switch (checkState) {
    case 'PASSED':
      return 'good'
    case 'FAILED':
    case 'TIMED_OUT':
      return 'fault'
    case 'QUEUED':
    case 'RUNNING':
      // Check đang chạy là "chưa kết luận", không phải "đang hỏng" và cũng
      // không phải "đã đạt" — đúng nghĩa `reconciling` của README §3.
      return 'reconciling'
    default:
      return 'unknown'
  }
}

export function draftStateLabel(pick: Pick, dirty: boolean | null, checkState: ProgrammingCheckState | null): string {
  if (dirty === null) return pick('Chưa rõ', 'Unknown')
  if (dirty) return pick('Có thay đổi chưa phát hành', 'Unpublished changes')
  switch (checkState) {
    case 'PASSED':
      return pick('Kiểm tra đạt', 'Check passed')
    case 'FAILED':
      return pick('Kiểm tra không đạt', 'Check failed')
    case 'TIMED_OUT':
      return pick('Kiểm tra hết giờ', 'Check timed out')
    case 'QUEUED':
      return pick('Đang chờ Kiểm tra', 'Check queued')
    case 'RUNNING':
      return pick('Đang Kiểm tra', 'Checking')
    default:
      return pick('Chưa Kiểm tra lần nào', 'Never checked')
  }
}

/** Trạng thái tác vụ điều khiển của gói đang vận hành. `null` ⇒ chưa đọc được, không phải "đã dừng". */
export function activeSemanticState(taskState: ProgrammingTaskState | null): SemanticState {
  switch (taskState) {
    case 'RUNNING':
      return 'good'
    case 'STOPPED':
      return 'disabled'
    case 'STARTING':
      return 'reconciling'
    case 'FAULT':
      return 'fault'
    default:
      return 'unknown'
  }
}

export function activeStateLabel(pick: Pick, taskState: ProgrammingTaskState | null): string {
  switch (taskState) {
    case 'RUNNING':
      return pick('Đang chạy', 'Running')
    case 'STOPPED':
      return pick('Đã dừng', 'Stopped')
    case 'STARTING':
      return pick('Đang khởi động', 'Starting')
    case 'FAULT':
      return pick('Lỗi', 'Fault')
    default:
      return pick('Chưa rõ', 'Unknown')
  }
}

function relationReasonLabel(pick: Pick, reason: DraftActiveRelationReason): string {
  switch (reason) {
    case 'DRAFT_DIRTY':
      return pick(
        'Bản nháp còn thay đổi chưa phát hành, nên chắc chắn khác bản đang vận hành.',
        'The draft still holds unpublished work, so it certainly differs from the running package.'
      )
    case 'RUNTIME_UNAVAILABLE':
      return pick(
        'Chưa đọc được gói đang vận hành từ Core nên chưa so sánh được.',
        'The running package could not be read from Core, so no comparison is possible yet.'
      )
    case 'NO_ACTIVE_REVISION':
      return pick(
        'Controller này chưa đưa gói nào vào vận hành.',
        'This controller has not commissioned any package yet.'
      )
    case 'DIRTY_UNKNOWN':
      return pick(
        'Máy chủ chưa xác định được bản nháp còn việc chưa phát hành hay không.',
        'The server could not determine whether the draft has unpublished work.'
      )
    case 'SEQUENCE_UNRESOLVED':
      return pick(
        'Chưa phân giải được số hiệu của một trong hai bản nên không kết luận được.',
        'One of the two revision numbers is unresolved, so no conclusion is possible.'
      )
    case 'SEQUENCE_DIFFERS':
      return pick('Hai bản mang số hiệu khác nhau.', 'The two revisions carry different numbers.')
    case 'SAME_REVISION':
      return pick('Bản nháp trùng đúng bản đang vận hành.', 'The draft matches the running package exactly.')
  }
}

/* ------------------------------------------------------------------ *
 * Thẻ                                                                 *
 * ------------------------------------------------------------------ */

export interface DraftActiveCompareCardProps {
  draft: OverviewViewModel['draft']
  active: OverviewViewModel['active']
  core: OverviewViewModel['core']
  /**
   * `GET /revisions/{from}/changes/{to}` — nguồn DUY NHẤT của con số thay đổi.
   * `null` = tầng gọi cố ý không hỏi (chưa có Active để so, hoặc chưa phân giải
   * được Revision) ⇒ thẻ không hiện con số nào.
   */
  changes: RemoteState<ProgrammingRevisionChanges> | null
  /** Đích PGM-05 trong drawer; `null` ⇒ nút vô hiệu hoá kèm lý do, không bịa đích. */
  projectId: string | null
}

export function DraftActiveCompareCard({ draft, active, core, changes, projectId }: DraftActiveCompareCardProps) {
  const { pick } = useI18n()
  const comparison = draftActiveRelation(draft, active, core)
  const count = serverChangeCount(changes)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const compareButtonRef = useRef<HTMLButtonElement>(null)

  const title = pick('Bản nháp ↔ Bản đang vận hành', 'Draft ↔ Active')

  if (comparison.relation === 'SAME') {
    return (
      <Panel title={title}>
        <CollapsedNoPendingChange draft={draft} active={active} />
      </Panel>
    )
  }

  return (
    <Panel title={title}>
      <div className="space-y-3 text-sm">
        {/* AC-PGM01-02: khi hai bản khác nhau thì CẢ HAI phải cùng nhìn thấy —
            không có nhánh nào chỉ vẽ một cột. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <RevisionColumn
            testId="draft-active-compare-draft"
            heading={pick('Bản nháp', 'Draft')}
            label={draft.label}
            missingReason={pick('Chưa phân giải được số hiệu bản nháp', 'The draft revision number is unresolved')}
            semantic={draftSemanticState(draft.dirty, draft.checkState)}
            stateLabel={draftStateLabel(pick, draft.dirty, draft.checkState)}
            note={draft.dirty === null
              ? pick('Máy chủ chưa xác định được — chưa được hiểu là “sạch”.', 'The server has not determined this — it must not be read as “clean”.')
              : null}
          />
          <RevisionColumn
            testId="draft-active-compare-active"
            heading={pick('Bản đang vận hành', 'Active')}
            label={active.label}
            missingReason={active.present
              ? pick('Chưa phân giải được số hiệu bản đang vận hành', 'The active revision number is unresolved')
              : pick('Chưa có gói nào được đưa vào vận hành', 'No package has been commissioned yet')}
            semantic={activeSemanticState(active.taskState)}
            stateLabel={activeStateLabel(pick, active.taskState)}
            note={active.taskState === null
              ? pick('Chưa đọc được từ Core.', 'Not read from Core.')
              : null}
          />
        </div>

        <p data-testid="draft-active-compare-relation" className="text-xs text-[var(--c-text-dim)]">
          {relationReasonLabel(pick, comparison.reason)}
        </p>

        <ChangeCountLine count={count} onRetry={changes?.refresh} />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            ref={compareButtonRef}
            size="sm"
            variant="secondary"
            icon={<GitCompare className="h-4 w-4" aria-hidden="true" />}
            aria-expanded={drawerOpen}
            aria-controls="programming-compare-drawer"
            disabled={count.kind === 'NOT_REQUESTED'}
            title={count.kind === 'NOT_REQUESTED'
              ? pick('Chưa có bảng thay đổi nào từ máy chủ để mở.', 'The server provided no change list to open.')
              : undefined}
            onClick={() => setDrawerOpen((open) => !open)}
          >
            {pick('So sánh', 'Compare')}
          </Button>
          {count.kind === 'NOT_REQUESTED' && (
            <span className="text-xs text-[var(--c-text-dim)]">
              {pick('Chưa có bảng thay đổi nào từ máy chủ để mở.', 'The server provided no change list to open.')}
            </span>
          )}
        </div>
      </div>

      {drawerOpen && (
        <CompareDrawer
          draftLabel={draft.label}
          activeLabel={active.label}
          changes={changes}
          count={count}
          projectId={projectId}
          anchorRef={compareButtonRef}
          onClose={(returnFocus) => {
            setDrawerOpen(false)
            if (returnFocus) compareButtonRef.current?.focus()
          }}
        />
      )}
    </Panel>
  )
}

function CollapsedNoPendingChange({ draft, active }: {
  draft: OverviewViewModel['draft']
  active: OverviewViewModel['active']
}) {
  const { pick } = useI18n()
  return (
    <div data-testid="draft-active-compare-collapsed" className="space-y-1 text-sm">
      <StatusBadge
        {...semanticBadgeProps(pick, 'good', pick('Không có thay đổi chờ vận hành', 'No pending commissioned changes'))}
      />
      <p className="text-xs text-[var(--c-text-dim)]">
        {/* Vẫn nêu tên cả hai bản: người vận hành cần biết ĐANG chạy số mấy,
            chứ không chỉ biết "không có gì chờ". */}
        {draft.label && active.label
          ? pick(`${draft.label} trùng đúng ${active.label}.`, `${draft.label} matches ${active.label}.`)
          : pick('Bản nháp trùng đúng bản đang vận hành.', 'The draft matches the running package exactly.')}
      </p>
    </div>
  )
}

function RevisionColumn({ testId, heading, label, missingReason, semantic, stateLabel, note }: {
  testId: string
  heading: string
  label: string | null
  missingReason: string
  semantic: SemanticState
  stateLabel: string
  note: string | null
}) {
  const { pick } = useI18n()
  return (
    <div data-testid={testId} className="rounded-[var(--radius)] border border-[var(--c-border)] p-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">{heading}</p>
      {/* D-05: `Draft #14` / `Active #12`. Không UUID, không `#0`. */}
      {label ? (
        <p className="mt-0.5 text-sm font-semibold text-[var(--c-text)]">{label}</p>
      ) : (
        <p className="mt-0.5 text-sm text-[var(--c-text-dim)]">
          <span aria-hidden="true">— </span>
          <span className="text-xs">{missingReason}</span>
        </p>
      )}
      <div className="mt-1">
        <StatusBadge {...semanticBadgeProps(pick, semantic, stateLabel)} />
      </div>
      {note && <p className="mt-1 text-[11px] leading-tight text-[var(--c-text-dim)]">{note}</p>}
    </div>
  )
}

function ChangeCountLine({ count, onRetry }: { count: ChangeCountState; onRetry?: () => void }) {
  const { pick } = useI18n()
  if (count.kind === 'LOADING') {
    return (
      <p role="status" data-testid="draft-active-compare-count" className="text-xs text-[var(--c-text-dim)]">
        {pick('Đang đọc bảng thay đổi từ máy chủ…', 'Reading the change list from the server…')}
      </p>
    )
  }
  if (count.kind === 'UNAVAILABLE') {
    return (
      <p data-testid="draft-active-compare-count" className="flex flex-wrap items-center gap-2 text-xs text-[var(--c-warn-fg)]">
        {pick('Chưa đọc được bảng thay đổi — không có số thay đổi nào để hiển thị.', 'The change list could not be read — no change count can be shown.')}
        {onRetry && (
          <Button size="sm" variant="ghost" onClick={onRetry}>{pick('Thử lại', 'Retry')}</Button>
        )}
      </p>
    )
  }
  if (count.kind === 'NOT_REQUESTED') {
    return (
      <p data-testid="draft-active-compare-count" className="text-xs text-[var(--c-text-dim)]">
        {pick('Máy chủ chưa cung cấp bảng thay đổi cho cặp bản này.', 'The server provided no change list for this pair of revisions.')}
      </p>
    )
  }
  return (
    <p data-testid="draft-active-compare-count" className="text-xs text-[var(--c-text)]">
      {count.total === 0
        ? pick('Máy chủ không liệt kê thay đổi nào.', 'The server lists no change.')
        : pick(`Máy chủ liệt kê ${count.total} thay đổi.`, `The server lists ${count.total} change(s).`)}
    </p>
  )
}

/* ------------------------------------------------------------------ *
 * Drawer so sánh                                                      *
 * ------------------------------------------------------------------ */

/**
 * KHÔNG PHẢI MODAL, VÀ KHÔNG LIỆT KÊ TỪNG ĐỐI TƯỢNG
 * -------------------------------------------------
 * Hai quyết định của drawer này đáng ghi lại:
 *
 * - **Không dùng `shared/components/Modal`**: đây là một bề mặt chỉ-đọc mở ra
 *   từ nút `So sánh`, không phải một quyết định chặn luồng; `aria-modal` + lớp
 *   phủ tối + cặp nút `Xác nhận`/`Huỷ` đều sai ngữ nghĩa. Đổi lại phải tự lo ba
 *   việc Modal làm sẵn: tiêu điểm lúc mở, `Esc` đóng, trả tiêu điểm về nút.
 *
 * - **Không liệt kê từng `objectId`**: `ProgrammingRevisionChange` chỉ có
 *   `objectId` (UUID), `kind`, `changeType`, `category` — không có tên người
 *   đọc được. In UUID ở đây là phá `AC-PGM01-01`; in UUID rút gọn là phương án
 *   D-05 đã loại. Vì vậy drawer trả lời *bao nhiêu và thuộc loại gì*, còn chi
 *   tiết từng đối tượng (và bảng ảnh hưởng, vốn đi kèm ngữ nghĩa xác nhận) nằm
 *   ở PGM-05 — nơi đã có sẵn, và nhân đôi nhãn của nó sang đây chỉ tạo ra hai
 *   bản trôi xa nhau.
 */
function CompareDrawer({ draftLabel, activeLabel, changes, count, projectId, anchorRef, onClose }: {
  draftLabel: string | null
  activeLabel: string | null
  changes: RemoteState<ProgrammingRevisionChanges> | null
  count: ChangeCountState
  projectId: string | null
  anchorRef: RefObject<HTMLButtonElement | null>
  onClose: (returnFocus: boolean) => void
}) {
  const { pick } = useI18n()
  const navigate = useNavigate()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose(true)
    }
    const handlePointerDown = (event: Event) => {
      const target = event.target
      if (!(target instanceof Node)) return
      // Nút mỏ neo tự đảo trạng thái; đóng ở đây rồi để nút mở lại sẽ thành
      // "bấm mà không đóng được".
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      onClose(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [anchorRef, onClose])

  const list = count.kind === 'COUNT' && changes?.data ? changes.data.changes : null
  const breakdown = list ? changeBreakdown(list) : null
  const commissionPath = projectId ? `/eng/programming/projects/${projectId}/commission` : null

  return (
    <div
      ref={panelRef}
      id="programming-compare-drawer"
      role="dialog"
      aria-labelledby="programming-compare-drawer-title"
      tabIndex={-1}
      data-testid="programming-compare-drawer"
      className="fixed right-0 top-16 z-30 flex h-[calc(100vh-4rem)] w-[min(26rem,100vw)] flex-col gap-3 overflow-y-auto border-l border-[var(--c-border)] bg-[var(--c-surface)] p-4 shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="programming-compare-drawer-title" className="text-sm font-semibold text-[var(--c-text)]">
            {pick('So sánh bản nháp và bản đang vận hành', 'Compare draft with the running package')}
          </h3>
          <p className="mt-0.5 text-[11px] text-[var(--c-text-dim)]">
            {/* Nêu đúng hai nhãn `Active #12 → Draft #14`; thiếu nhãn thì nói
                thiếu, không in UUID thay thế. */}
            {`${activeLabel ?? pick('Bản đang vận hành (chưa rõ số hiệu)', 'Active (number unresolved)')} → ${draftLabel ?? pick('Bản nháp (chưa rõ số hiệu)', 'Draft (number unresolved)')}`}
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-[var(--radius)] p-1 text-[var(--c-text-dim)] transition hover:bg-[var(--c-accent-bg)] hover:text-[var(--c-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
          aria-label={pick('Đóng bảng so sánh', 'Close the comparison')}
          onClick={() => onClose(true)}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {count.kind === 'LOADING' && (
        <p role="status" className="text-xs text-[var(--c-text-dim)]">
          {pick('Đang đọc bảng thay đổi từ máy chủ…', 'Reading the change list from the server…')}
        </p>
      )}
      {count.kind === 'UNAVAILABLE' && (
        <p className="text-xs text-[var(--c-warn-fg)]">
          {pick('Chưa đọc được bảng thay đổi từ máy chủ.', 'The change list could not be read from the server.')}
        </p>
      )}
      {count.kind === 'NOT_REQUESTED' && (
        <p className="text-xs text-[var(--c-text-dim)]">
          {pick('Máy chủ chưa cung cấp bảng thay đổi cho cặp bản này.', 'The server provided no change list for this pair of revisions.')}
        </p>
      )}

      {breakdown && (
        <div className="space-y-2 text-xs">
          <p className="text-[var(--c-text)]">
            {count.kind === 'COUNT' && count.total === 0
              ? pick('Máy chủ không liệt kê thay đổi nào.', 'The server lists no change.')
              : pick(`Máy chủ liệt kê ${count.kind === 'COUNT' ? count.total : 0} thay đổi.`, `The server lists ${count.kind === 'COUNT' ? count.total : 0} change(s).`)}
          </p>
          {count.kind === 'COUNT' && count.total > 0 && (
            <>
              <dl data-testid="programming-compare-drawer-types" className="grid grid-cols-2 gap-1">
                <BreakdownRow label={pick('Thêm mới', 'Added')} value={breakdown.added} />
                <BreakdownRow label={pick('Sửa', 'Modified')} value={breakdown.modified} />
                <BreakdownRow label={pick('Xoá', 'Removed')} value={breakdown.removed} />
                {/* Loại lạ vẫn phải đếm: bỏ qua sẽ khiến tổng ba cột nhỏ hơn
                    tổng máy chủ trả, và người đọc không có cách nào biết. */}
                {breakdown.other > 0 && <BreakdownRow label={pick('Loại khác', 'Other')} value={breakdown.other} />}
              </dl>
              {breakdown.byKind.length > 0 && (
                <ul data-testid="programming-compare-drawer-kinds" className="space-y-0.5 text-[var(--c-text-dim)]">
                  {breakdown.byKind.map(([kind, total]) => (
                    <li key={kind}>
                      <span className="font-mono text-[var(--c-text)]">{kind}</span>
                      {`: ${total}`}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      <p className="text-[11px] leading-tight text-[var(--c-text-dim)]">
        {pick(
          'Chi tiết từng đối tượng và bảng ảnh hưởng nằm ở Kiểm tra & Vận hành — nơi có đủ ngữ cảnh để xác nhận trước khi áp dụng.',
          'Per-object detail and the impact table live in Check & Commission — the surface with enough context to acknowledge before applying.'
        )}
      </p>

      <div className="mt-auto">
        <Button
          size="sm"
          variant="secondary"
          disabled={commissionPath === null}
          title={commissionPath === null
            ? pick('Cần chọn Project trước khi mở Kiểm tra & Vận hành', 'Pick a project before opening Check & Commission')
            : undefined}
          onClick={() => { if (commissionPath) navigate(commissionPath) }}
        >
          {pick('Mở Kiểm tra & Vận hành', 'Open Check & Commission')}
        </Button>
        {commissionPath === null && (
          <p className="mt-1 text-[11px] text-[var(--c-text-dim)]">
            {pick('Cần chọn Project trước khi mở Kiểm tra & Vận hành.', 'Pick a project before opening Check & Commission.')}
          </p>
        )}
      </div>
    </div>
  )
}

function BreakdownRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-[var(--radius)] border border-[var(--c-border)] px-2 py-1">
      <dt className="text-[var(--c-text-dim)]">{label}</dt>
      <dd className="font-semibold text-[var(--c-text)]">{value}</dd>
    </div>
  )
}
