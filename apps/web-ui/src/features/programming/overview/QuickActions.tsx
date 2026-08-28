import { ClipboardCheck, MonitorPlay, PencilLine, Wrench } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { ComponentType, SVGProps } from 'react'
import { useI18n } from '../../../shared/i18n'
import { Panel } from '../../../shared/components/Panel'
import { roleCan } from '../../../shared/auth/capabilities'
import type { UserRole } from '../../../shared/types'
import type { ProgrammingTargetState } from '../model/types'
import type { PrimaryCtaKind } from './resolvePrimaryCta'
import type { SafeStateFacts } from './SystemHealthHero'
import { programsWorkspacePath } from '../shared/programsRoute'

/**
 * `T60-206` — `QuickActions` của PGM-01 (handoff §1 mục 6, Plan 60 §6 P2).
 *
 * KHÔNG NÚT NÀO Ở ĐÂY LÀ PRIMARY
 * ------------------------------
 * `AC-PGM01-05` đòi **đúng một** CTA chính trên toàn trang, và CTA đó thuộc
 * `T60-201` (`resolvePrimaryCta`), được vẽ ở đầu trang. Khối này là hàng dưới
 * cùng, ưu tiên thị giác THẤP: bốn lối tắt cùng một trọng số, không nút nào
 * mang nền accent. Vì vậy nó cố ý **không** dùng `<Button variant="primary">` —
 * và `QuickActions.test.tsx` khẳng định không nút nào mang lớp nền accent, để
 * một lần "làm nổi bật cho đẹp" trong tương lai sẽ làm đỏ test chứ không lặng
 * lẽ sinh ra CTA chính thứ hai.
 *
 * Khi một lối tắt ở đây TRÙNG với CTA chính đang hiển thị, nó được đánh dấu
 * bằng chữ (*"Đang là hành động chính…"*) chứ không bằng cách tô đậm lên. Người
 * dùng cần biết vì sao cùng một việc xuất hiện hai chỗ; tô đậm thì giải thích
 * được điều đó bằng cách vi phạm đúng luật vừa nêu.
 *
 * "VÔ HIỆU HOÁ KÈM GIẢI THÍCH" — VÀ VÌ SAO KHÔNG DÙNG THUỘC TÍNH `disabled`
 * -------------------------------------------------------------------------
 * Plan 60 §6: *"viewer/operator thấy nhưng bị vô hiệu hoá kèm giải thích"*. Một
 * nút xám không lý do là một ngõ cụt: người dùng không biết mình thiếu quyền,
 * thiếu Project, hay Core đang im.
 *
 * Nút bị chặn ở đây dùng `aria-disabled="true"` chứ **không** dùng thuộc tính
 * `disabled`. `disabled` gỡ nút khỏi thứ tự tab, nên người dùng bàn phím và
 * trình đọc màn hình không bao giờ tới được chính lời giải thích vừa nói —
 * "kèm giải thích" khi đó chỉ đúng với người dùng chuột có mắt. Nút vẫn nhận
 * tiêu điểm, tên truy cập của nó mang luôn lý do, và `onClick` chặn điều hướng
 * nên `AC-PGM01-06` (viewer/operator không mutate được qua UI **lẫn phím tắt**)
 * vẫn giữ nguyên.
 *
 * FE GATE CHỈ LÀ TIỆN ÍCH (README §4)
 * -----------------------------------
 * Server mới là hàng rào. Bốn lối tắt này chỉ **điều hướng**; chúng không tự
 * gọi mutation nào. Chặn ở đây để người dùng khỏi đi vào một trang mà mọi nút
 * đều 403 hoặc fail-closed.
 */

type PickFn = (vi: string, en: string) => string
type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

export type QuickActionKey = 'edit' | 'check' | 'commission' | 'runtime'

/** Vì sao một lối tắt bị chặn. Mỗi giá trị là một dữ kiện CỤ THỂ, không phải "không đủ điều kiện". */
export type QuickActionBlockReason =
  /** Controller chưa có Project nào ⇒ không tồn tại đích để đi tới. */
  | 'NO_PROJECT'
  /** Vai hiện tại dưới `admin` (README §4: Edit/Check/Commission đều là admin). */
  | 'NEEDS_PERMISSION'
  /** `producerState = UNAVAILABLE`. */
  | 'CORE_UNAVAILABLE'
  /** `producerState = DEGRADED` — mọi thay đổi runtime bị khoá. */
  | 'CORE_DEGRADED'
  /** Chưa đọc được `producerState`. Fail-closed: chưa đọc được thì giữ khoá. */
  | 'CORE_UNREAD'
  /** Safe-state do lỗi THẬT. Xem ghi chú ở `quickActionItems`. */
  | 'SAFE_STATE_FAULT'

export interface QuickActionsInput {
  /** `null` ⇒ ba lối tắt phụ thuộc Project bị chặn với lý do `NO_PROJECT`. */
  projectId: string | null
  /** Vai của phiên hiện tại; `null` khi chưa có phiên. Tầng gọi truyền `session?.role ?? null`. */
  role: UserRole | null
  /** `overviewViewModel().core.producerState`; `null` = chưa đọc được. */
  producerState: ProgrammingTargetState | null
  /** `overviewViewModel().safeState`. */
  safeState: SafeStateFacts
  /** `overviewViewModel().primaryCta.kind` — để đánh dấu lối tắt trùng CTA chính. */
  primaryCtaKind: PrimaryCtaKind | null
}

export interface QuickActionItem {
  key: QuickActionKey
  /** `null` khi không dựng được đích (thiếu `projectId`). */
  route: string | null
  /** `null` ⇒ bấm được. Khác `null` ⇒ vô hiệu hoá và PHẢI hiện lý do này. */
  blockedBy: QuickActionBlockReason | null
  /** `true` khi CTA chính ở đầu trang đang là chính hành động này. */
  isPrimaryElsewhere: boolean
}

/**
 * Lối tắt tương ứng với từng CTA chính. `FIX_CHECK_ERRORS` về `check` và
 * `REVIEW_CHANGES`/`COMMISSION` về `commission` vì cả ba CTA đó đều dẫn tới
 * PGM-05 — trang chủ quản của chẩn đoán Check, bảng thay đổi và nút Đưa vào
 * vận hành (đã giải thích ở `resolvePrimaryCta`).
 */
export function quickActionForPrimaryCta(kind: PrimaryCtaKind | null): QuickActionKey | null {
  switch (kind) {
    case 'CONTINUE_EDITING':
      return 'edit'
    case 'FIX_CHECK_ERRORS':
      return 'check'
    case 'REVIEW_CHANGES':
    case 'COMMISSION':
      return 'commission'
    case 'OPEN_RUNTIME':
      return 'runtime'
    default:
      return null
  }
}

/**
 * Bảng chặn — hàm thuần, có test riêng.
 *
 * THỨ TỰ XÉT LÝ DO đi từ bền vững nhất tới tạm thời nhất: `NO_PROJECT` (chưa có
 * gì để mở) → `NEEDS_PERMISSION` (vai này sẽ không bao giờ làm được) → tình trạng
 * Core (sẽ hết khi Core trở lại). Nói lý do tạm thời trước lý do vĩnh viễn sẽ
 * làm người dùng chờ một thứ không bao giờ đổi.
 *
 * BA LUẬT ĐÁNG GIẢI THÍCH
 * -----------------------
 * 1. **`edit` và `check` KHÔNG bị Core chặn.** README §6: Core offline thì vẫn
 *    được chỉnh sửa, chỉ Commission bị khoá. Check là biên dịch phía máy chủ,
 *    không cần Core.
 * 2. **`runtime` không bao giờ bị chặn.** Xem trạng thái vận hành là quyền của
 *    cả ba vai (README §4) và chính là việc cần làm NHẤT khi Core đang im.
 * 3. **Safe-state chỉ-vì-chưa-có-output KHÔNG chặn Commission.** Đây là cùng
 *    một luật mà `CheckCommissionPage` đang thi hành (`coreReady`: chặn khi
 *    `safeState=true` **và** `safeStateNoControllerOnly=false`). Commission
 *    chính là hành động giải quyết safe-state loại nhẹ đó; chặn nó lại là nhốt
 *    người dùng trong một vòng lặp không lối ra trên mọi controller mới lắp.
 */
export function quickActionItems(input: QuickActionsInput): QuickActionItem[] {
  /* `WEB-RBAC-001` — hỏi NĂNG LỰC, không so vai.
   *
   * Ba lối tắt này ánh xạ thẳng vào ba quyền của server: mở workspace và
   * Kiểm tra là `program.edit`, Đưa vào vận hành là `program.activate`. So
   * `role >= admin` chặn luôn `engineer` — vai tồn tại đúng để làm việc
   * Programming — trên những thao tác máy chủ sẵn sàng chấp nhận. */
  const canEdit = roleCan(input.role, 'program.edit')
  const canActivate = roleCan(input.role, 'program.activate')
  const projectPath = (suffix: string) =>
    input.projectId ? `/eng/programming/projects/${input.projectId}/${suffix}` : null

  const projectScopedBlock = (): QuickActionBlockReason | null => {
    if (!input.projectId) return 'NO_PROJECT'
    if (!canEdit) return 'NEEDS_PERMISSION'
    return null
  }

  const commissionBlock = (): QuickActionBlockReason | null => {
    const base = projectScopedBlock()
    if (base) return base
    if (!canActivate) return 'NEEDS_PERMISSION'
    if (input.producerState === null) return 'CORE_UNREAD'
    if (input.producerState === 'UNAVAILABLE') return 'CORE_UNAVAILABLE'
    if (input.producerState === 'DEGRADED') return 'CORE_DEGRADED'
    if (input.safeState.active === true && !input.safeState.noControllerOnly) return 'SAFE_STATE_FAULT'
    return null
  }

  const primaryKey = quickActionForPrimaryCta(input.primaryCtaKind)
  const item = (key: QuickActionKey, route: string | null, blockedBy: QuickActionBlockReason | null): QuickActionItem => ({
    key,
    route,
    blockedBy,
    isPrimaryElsewhere: primaryKey === key
  })

  return [
    item('edit', input.projectId ? programsWorkspacePath(input.projectId) : null, projectScopedBlock()),
    item('check', projectPath('commission'), projectScopedBlock()),
    item('commission', projectPath('commission'), commissionBlock()),
    item('runtime', '/eng/programming/runtime', null)
  ]
}

/* ------------------------------------------------------------------ *
 * Câu chữ — D-06, một ngôn ngữ tại một thời điểm                      *
 * ------------------------------------------------------------------ */

export function quickActionLabel(pick: PickFn, key: QuickActionKey): string {
  switch (key) {
    case 'edit':
      return pick('Tiếp tục chỉnh sửa', 'Continue Editing')
    case 'check':
      return pick('Kiểm tra thay đổi', 'Check Changes')
    case 'commission':
      return pick('Đưa vào vận hành', 'Commission')
    case 'runtime':
      return pick('Mở Runtime', 'Open Runtime')
  }
}

function quickActionHint(pick: PickFn, key: QuickActionKey): string {
  switch (key) {
    case 'edit':
      return pick('Mở workspace Thiết kế của bản nháp.', 'Open the design workspace for the draft.')
    case 'check':
      return pick('Niêm phong bản nháp thành Revision rồi biên dịch.', 'Seal the draft into a revision and compile it.')
    case 'commission':
      return pick('Đưa gói đã kiểm tra vào vận hành.', 'Put the checked package into operation.')
    case 'runtime':
      return pick('Xem trạng thái vận hành và chẩn đoán.', 'Inspect the runtime state and diagnostics.')
  }
}

const QUICK_ACTION_ICON: Readonly<Record<QuickActionKey, IconComponent>> = {
  edit: PencilLine,
  check: ClipboardCheck,
  commission: Wrench,
  runtime: MonitorPlay
}

/** Câu giải thích BẮT BUỘC đi kèm mỗi lối tắt bị vô hiệu hoá. */
export function quickActionBlockedLabel(pick: PickFn, reason: QuickActionBlockReason): string {
  switch (reason) {
    case 'NO_PROJECT':
      return pick('Controller này chưa có Project nào.', 'This controller has no project yet.')
    case 'NEEDS_PERMISSION':
      return pick('Vai hiện tại không có quyền cho thao tác này.', 'The current role does not have permission for this action.')
    case 'CORE_UNAVAILABLE':
      return pick('Không kết nối được Core — Đưa vào vận hành bị khoá.', 'Core is unreachable — Commission is locked.')
    case 'CORE_DEGRADED':
      return pick('Core đang suy giảm — mọi thay đổi runtime bị khoá.', 'Core is degraded — runtime mutations are locked.')
    case 'CORE_UNREAD':
      return pick(
        'Chưa đọc được trạng thái Core — giữ khoá cho tới khi đọc được.',
        'The Core state could not be read — it stays locked until it can.'
      )
    case 'SAFE_STATE_FAULT':
      return pick(
        'Safe-state đang tác động do lỗi thật — kiểm tra Core, I/O và alarm trước khi đưa vào vận hành.',
        'Safe-state is active due to a real fault — inspect Core, I/O and alarms before commissioning.'
      )
  }
}

/* ------------------------------------------------------------------ *
 * Component                                                           *
 * ------------------------------------------------------------------ */

export type QuickActionsProps = QuickActionsInput

/**
 * Khối full-width, đặt cuối trang. Tầng gọi (`T60-207`) chịu trách nhiệm cho nó
 * chiếm trọn bề ngang của lưới (`lg:col-span-3`); component tự nó luôn `w-full`.
 */
export function QuickActions(props: QuickActionsProps) {
  const { pick } = useI18n()
  const navigate = useNavigate()
  const items = quickActionItems(props)

  return (
    <Panel
      title={pick('Thao tác nhanh', 'Quick Actions')}
      subtitle={pick(
        'Lối tắt tới các bước thường dùng. Hành động được đề xuất nằm ở đầu trang.',
        'Shortcuts to the usual steps. The suggested action stays at the top of the page.'
      )}
      className="w-full"
    >
      <ul data-testid="quick-actions" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <li key={item.key}>
            <QuickActionButton item={item} onNavigate={navigate} />
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function QuickActionButton({ item, onNavigate }: { item: QuickActionItem; onNavigate: (path: string) => void }) {
  const { pick } = useI18n()
  const Icon = QUICK_ACTION_ICON[item.key]
  const label = quickActionLabel(pick, item.key)
  const blocked = item.blockedBy !== null || item.route === null
  const reason = item.blockedBy !== null ? quickActionBlockedLabel(pick, item.blockedBy) : null
  const primaryNote = item.isPrimaryElsewhere
    ? pick('Đang là hành động chính ở đầu trang.', 'This is the primary action at the top of the page.')
    : null
  const descriptionId = `quick-action-${item.key}-description`

  return (
    <button
      type="button"
      data-quick-action={item.key}
      data-blocked-by={item.blockedBy ?? undefined}
      data-primary-elsewhere={item.isPrimaryElsewhere ? 'true' : undefined}
      // `aria-disabled` thay cho `disabled`: giữ nút trong thứ tự tab để người
      // dùng bàn phím nghe được lý do. `onClick` mới là chỗ chặn thật.
      aria-disabled={blocked ? 'true' : undefined}
      aria-describedby={descriptionId}
      onClick={() => {
        if (blocked || item.route === null) return
        onNavigate(item.route)
      }}
      // Không có `bg-[var(--c-accent)]` ở bất kỳ nhánh nào — xem khối chú thích
      // đầu file: CTA chính chỉ có một và nó không nằm trong khối này.
      className={`flex h-full w-full flex-col items-start gap-1 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--c-accent)] ${
        blocked ? 'cursor-not-allowed opacity-60' : 'hover:border-[var(--c-accent)]'
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-medium text-[var(--c-text)]">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {label}
      </span>
      <span id={descriptionId} className="flex flex-col gap-0.5 text-xs leading-snug text-[var(--c-text-dim)]">
        <span>{quickActionHint(pick, item.key)}</span>
        {/* Lý do bị chặn là NỘI DUNG, không phải `title`: `title` không tới được
            người dùng bàn phím và biến mất trên cảm ứng. */}
        {reason && <span className="text-[var(--c-warn-fg)]">{reason}</span>}
        {primaryNote && <span>{primaryNote}</span>}
      </span>
    </button>
  )
}
