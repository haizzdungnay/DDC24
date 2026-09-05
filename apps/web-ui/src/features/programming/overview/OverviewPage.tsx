import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, FolderPlus, PencilRuler, WifiOff } from 'lucide-react'
import { formatTechnicalDateTime, formatTechnicalTime } from '../../../shared/dateTime'
import { useI18n } from '../../../shared/i18n'
import { useAuth } from '../../auth'
import { roleCan } from '../../../shared/auth/capabilities'
import { Panel } from '../../../shared/components/Panel'
import { Button } from '../../../shared/components/Button'
import { StatusBadge } from '../../../shared/components/StatusBadge'
import { semanticBadgeProps, semanticStateDescriptor } from '../shared/semanticState'
import { useProgrammingRuntimeContext } from '../layout/ProgrammingLayout'
import { useProgrammingRevision, useProgrammingRevisionChanges } from '../api/queries'
import { ownedActiveRevisionId } from '../shared/activeRevisionOwnership'
import { useCreateProgrammingProject } from '../api/mutations'
import { activeProgramSet } from './activeProgramSet'
import {
  overviewViewModel,
  programHealthSemanticState,
  programRuntimeSemanticState,
  type OverviewProgramRow,
  type ProgramsSummaryModel
} from './overviewViewModel'
import {
  primaryCtaLabel,
  primaryCtaUndecidedLabel,
  type PrimaryCtaDecision
} from './resolvePrimaryCta'
import { SystemHealthHero } from './SystemHealthHero'
import { DraftActiveCompareCard } from './DraftActiveCompareCard'
import { NeedsAttentionCard } from './NeedsAttentionCard'
import { ProgramsSummaryTable } from './ProgramsSummaryTable'
import {
  QuickActions,
  quickActionBlockedLabel,
  quickActionForPrimaryCta,
  quickActionItems,
  type QuickActionBlockReason
} from './QuickActions'
import type { ProgrammingProgramHealth, ProgrammingProgramRuntimeState, RemoteState } from '../model/types'
import { programsWorkspacePath } from '../shared/programsRoute'

/**
 * `OverviewPage` (PGM-01) — `UJ-PROG-01`, ráp trang theo `T60-207`/`T60-208`.
 *
 * TRANG NÀY KHÔNG CÒN TỰ VẼ GÌ VỀ TRẠNG THÁI
 * ------------------------------------------
 * Trước `T60-207`, `OverviewPage` tự dựng năm panel với luật riêng của mình
 * (`RunningApplicationPanel`, `CoreSafeStatePanel`, `DraftAttentionPanel`,
 * `ProgrammingAttentionList`, `RecentEngineeringTimeline`). Sáu khối của handoff
 * v2.1 đã được `T60-201..206` viết xong và có test riêng, nên vai trò duy nhất
 * còn lại của file này là **tầng ráp**: đọc read-model ở tầng layout, gọi đúng
 * một `overviewViewModel()`, rồi phân phát cho sáu khối. Mọi luật ngữ nghĩa
 * (fail-closed, `—` kèm lý do, phân biệt safe-state nhẹ/nặng, xếp hạng mức
 * khẩn) nằm trong các khối đó — nhân bản lại ở đây là dựng nguồn sự thật thứ
 * hai, đúng thứ `R60-02` cảnh báo.
 *
 * MA TRẬN SÁU TRẠNG THÁI (handoff §6) ĐƯỢC ĐÓNG Ở ĐÂY
 * ---------------------------------------------------
 * 1. `loading` — khung chờ **khớp hình học** thẻ/bảng thật, không phải một
 *    dòng "đang tải". Bố cục nhảy khi dữ liệu về đọc y hệt một trang lỗi.
 * 2. `chưa có Project/Program` — giải thích, và chỉ người đủ quyền mới thấy
 *    lối tạo.
 * 3. `Core offline` — banner **dính** (`sticky`), vẫn cho sửa, **khoá
 *    Commission**. Ba mệnh đề này phải cùng đúng: chặn cả chỉnh sửa là nhốt
 *    người dùng, mở cả Commission là ghi vào một thiết bị không đọc được.
 * 4. `runtime không đọc được` — `Unknown`, KHÔNG `0`, KHÔNG `Stopped`.
 * 5. `Draft == Active` — thẻ so sánh thu gọn.
 * 6. `permission denied` — giữ nguyên toàn bộ phần đọc, chỉ vô hiệu hoá hành
 *    động **kèm giải thích**.
 *
 * ĐÚNG MỘT CTA CHÍNH (`AC-PGM01-05`)
 * ----------------------------------
 * CTA chính là phần tử `data-testid="primary-cta"` ở đầu trang và là chỗ DUY
 * NHẤT dùng `<Button variant="primary">`. Nó lấy quyết định từ
 * `resolvePrimaryCta` (`T60-201`) và lấy **điều kiện chặn** từ chính bảng chặn
 * của `quickActionItems` (`T60-206`) — một bảng RBAC/Core duy nhất cho cả CTA
 * chính lẫn bốn lối tắt, nên không thể có chuyện CTA chính mở trong khi lối tắt
 * cùng đích đang khoá.
 */
export function OverviewPage() {
  const { pick } = useI18n()
  const { session } = useAuth()
  const { runtime, projects, programIntents, subjectProject, activeOwnership } = useProgrammingRuntimeContext()
  /* `WEB-RBAC-001` — lối tắt và thẻ "chưa có Project" nói về việc SỬA chương
     trình, tức `program.edit`, chứ không về vai `admin`. */
  const canEdit = roleCan(session?.role, 'program.edit')

  /* `ISS-PGUI-01` — Project và quyền sở hữu gói đang chạy đến TỪ SHELL, không
     tính lại ở đây.

     `GET /runtime` là read model của CONTROLLER: nó trả đúng một
     `activeRevisionId` cho cả thiết bị. Bản trước ghép con số ấy vào
     `projects.items[0]`, và trên production hai thứ ấy thuộc hai Project khác
     nhau — màn hình đồng thời hiện `Active: Yes`, `Running`, và "active
     revision number is unresolved". Ba câu không thể cùng đúng.

     Tính lại ở trang cũng không sửa được lỗi, chỉ dời nó: `programIntents` mà
     trang này đọc read-back đã được shell gọi theo `subjectProject`. Trang tự
     chọn một Project khác là ghép nửa khai báo của Project này với nửa
     read-back của Project kia — đúng thứ tiêu chí "bảng runtime không được
     hiện Program của Project khác" cấm. Nên chủ ngữ chỉ có MỘT nguồn. */
  const project = subjectProject
  const runtimeActiveRevisionId = runtime.data?.activeRevisionId ?? null
  /* Chỉ dùng `activeRevisionId` khi nó ĐÃ CHỨNG MINH thuộc Project này. Đây là
     cổng duy nhất cho cả phép đọc Revision đang chạy lẫn phép so sánh
     Draft↔Active: gọi compare với cặp chưa chứng minh cùng Project là phát ra
     một request mà backend BẮT BUỘC từ chối (`400 PRG-ERR-REQ-001`,
     `retryable=false`). */
  const activeRevisionId = ownedActiveRevisionId(activeOwnership, runtimeActiveRevisionId)

  // `T60-017`: tập Program KHAI BÁO đọc từ chính Revision đang chạy. Hook luôn
  // được gọi (không đặt trong nhánh) — `useProgrammingRevision` tự từ chối khi
  // `revisionId` rỗng, và `activeProgramSet` phân biệt "chưa có Active" với
  // "đọc hỏng" bằng `activeRevisionId`, không bằng lỗi của hook.
  const revision = useProgrammingRevision(activeRevisionId)

  /* Bảng thay đổi Draft↔Active. `null` = CỐ Ý không hỏi (chưa có Active để so,
     hoặc Draft đang ngồi đúng trên Revision đang chạy) — thẻ phân biệt hẳn với
     "hỏi rồi mà hỏng". Hook vẫn được gọi vô điều kiện để giữ thứ tự hook ổn
     định; truyền `undefined` thì nó không phát request nào. */
  const baseRevisionId = project?.baseRevisionId ?? null
  const compareRequested =
    activeRevisionId !== null && baseRevisionId !== null && activeRevisionId !== baseRevisionId
  const changesResource = useProgrammingRevisionChanges(
    compareRequested ? activeRevisionId : undefined,
    compareRequested ? baseRevisionId : undefined
  )

  /* Trạng thái đọc của bảng Programs ở mức TRANG. Lỗi thắng, rồi mới tới đang
     tải: một trang Programs đọc hỏng không được che bằng "đang tải" chỉ vì
     `GET /runtime` còn chạy. Ngược lại, khi runtime chưa xong thì cũng chưa
     biết đang chạy gói nào — kết luận "không có Program nào" lúc đó là bịa. */
  const programsStatus: RemoteState<unknown>['status'] =
    programIntents.status === 'error'
      ? 'error'
      : runtime.status === 'loading' || programIntents.status === 'loading'
        ? 'loading'
        : 'ready'

  const vm = overviewViewModel({
    projectStatus: projects.status,
    project,
    runtimeStatus: runtime.status,
    runtime: runtime.data,
    programsStatus,
    programs: programIntents.data,
    activeSet: activeProgramSet({
      activeRevisionId,
      status: revision.status,
      revision: revision.data,
      /* `ISS-PGUI-01` — vì sao `activeRevisionId` rỗng. Thiếu nó thì "gói đang
         chạy thuộc Project khác" bị in ra thành "thiết bị chưa vận hành gói
         nào". */
      ownership: activeOwnership.kind
    }),
    activeOwnership: activeOwnership.kind
  })

  /* Lần đọc ĐẦU của hai read-model nền. `useProgrammingResource` chỉ để
     `loading` ở lần đầu (poll sau đó giữ nguyên `ready`), nên cờ này không nhấp
     nháy mỗi 5 giây. */
  const firstRead = runtime.status === 'loading' || projects.status === 'loading'
  const noProject = projects.status === 'ready' && (projects.data?.items.length ?? 0) === 0
  const coreOffline = vm.core.producerState === 'UNAVAILABLE' || runtime.status === 'error'

  const quickActions = {
    projectId: vm.projectId,
    role: session?.role ?? null,
    producerState: vm.core.producerState,
    safeState: vm.safeState,
    primaryCtaKind: vm.primaryCta.kind
  }
  const primaryKey = quickActionForPrimaryCta(vm.primaryCta.kind)
  const primaryBlockedBy =
    quickActionItems(quickActions).find((item) => item.key === primaryKey)?.blockedBy ?? null

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* F-UX-15 (`REV-FE-UIUX-UC-2026-08-18` §7.1): mỗi màn/tab phải có mốc
          tiêu đề riêng trong cây heading. `<h1>` của route Programming nằm ở
          `ProgrammingLayout` (một và chỉ một), nên ở đây là `<h2>`. Ẩn thị giác
          vì rail đã hiện tên — thứ còn thiếu là mốc điều hướng cho trình đọc
          màn hình, không phải thêm chữ lên màn hình. */}
      <h2 className="sr-only">{pick('Tổng quan lập trình', 'Programming overview')}</h2>

      {coreOffline && <CoreOfflineBanner observedAt={vm.core.observedAt} />}

      <div className="min-w-0 lg:col-span-3">
        <PrimaryCtaBar decision={vm.primaryCta} blockedBy={primaryBlockedBy} loading={firstRead} />
      </div>

      {/* Handoff §1: ba thẻ tóm tắt trên MỘT hàng ở desktop; `<768 px` xếp
          chồng nhờ lưới một cột mặc định. `min-w-0` để một chuỗi dài trong thẻ
          không đẩy cả lưới tràn ngang. */}
      <div className="min-w-0">
        <SystemHealthHero
          core={vm.core}
          safeState={vm.safeState}
          active={vm.active}
          runtimeStatus={runtime.status}
        />
      </div>

      <div className="min-w-0">
        {firstRead ? (
          <CardSkeleton title={pick('Bản nháp ↔ Bản đang vận hành', 'Draft ↔ Active')} rows={4} columns={2} />
        ) : noProject ? (
          <NoProjectCard canEdit={canEdit} />
        ) : (
          <DraftActiveCompareCard
            draft={vm.draft}
            active={vm.active}
            core={vm.core}
            changes={compareRequested ? changesResource : null}
            projectId={vm.projectId}
          />
        )}
      </div>

      <div className="min-w-0">
        {firstRead ? (
          <CardSkeleton title={pick('Việc cần chú ý', 'Attention required')} rows={3} columns={1} />
        ) : (
          <NeedsAttentionCard vm={vm} taskId={runtime.data?.task?.taskId ?? null} />
        )}
      </div>

      <ProgramsSection
        model={vm.programs}
        projectId={vm.projectId}
        canEdit={canEdit}
        loading={firstRead || vm.programs.emptyReason === 'LOADING'}
      />

      <div className="min-w-0 lg:col-span-3">
        {firstRead ? (
          <CardSkeleton title={pick('Thao tác nhanh', 'Quick Actions')} rows={1} columns={4} />
        ) : (
          <QuickActions {...quickActions} />
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Core offline — banner DÍNH (handoff §6)                             *
 * ------------------------------------------------------------------ */

/**
 * "Persistent banner" của handoff §6 nghĩa là **không cuộn mất**: người vận
 * hành đọc tới cuối bảng Programs vẫn phải thấy rằng mọi con số phía trên đến
 * từ một Core không trả lời.
 *
 * `top-[6.5rem]`: `TopBar` là `sticky top-0 h-16` (4 rem) và
 * `ProgrammingContextStrip` là `sticky top-16` cao 36–40 px. Đặt `top-0` ở đây
 * sẽ nhét banner xuống dưới hai lớp đó và nó trượt khuất khi cuộn — đúng lỗi đã
 * sửa một lần ở `T60-102`.
 *
 * Banner này KHÔNG chặn gì cả. Việc khoá Commission do bảng chặn của
 * `quickActionItems` thực hiện, và việc cho phép tiếp tục chỉnh sửa do
 * `resolvePrimaryCta` giữ (hai hàng đầu của bảng §3 nằm TRƯỚC cổng Core).
 */
function CoreOfflineBanner({ observedAt }: { observedAt: string | null }) {
  const { pick, locale } = useI18n()
  return (
    <div
      data-testid="core-offline-banner"
      role="alert"
      className="sticky top-[6.5rem] z-10 flex min-w-0 items-start gap-2 rounded-[var(--radius)] border border-[var(--c-fault)] bg-[var(--c-fault-bg)] p-3 text-sm text-[var(--c-fault-fg)] lg:col-span-3"
    >
      <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        <strong className="font-semibold">{pick('Không kết nối được Core.', 'Core is unreachable.')}</strong>{' '}
        {pick(
          'Vẫn chỉnh sửa và Kiểm tra được; Đưa vào vận hành bị khoá cho tới khi đọc lại được Core.',
          'Editing and Check remain available; Commission stays locked until Core can be read again.'
        )}
        <span className="mt-1 block text-xs">
          {observedAt === null
            ? pick(
                'Không có mốc đọc nào gần đây — mọi trạng thái vận hành trên trang này đang là “chưa rõ”.',
                'There is no recent read — every runtime state on this page is “unknown”.'
              )
            : pick(
                `Mốc đọc gần nhất: ${formatTechnicalDateTime(observedAt, locale)}.`,
                `Last read at ${formatTechnicalDateTime(observedAt, locale)}.`
              )}
        </span>
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * CTA chính — đúng MỘT trên toàn trang (`AC-PGM01-05`)                *
 * ------------------------------------------------------------------ */

function PrimaryCtaBar({
  decision,
  blockedBy,
  loading
}: {
  decision: PrimaryCtaDecision
  blockedBy: QuickActionBlockReason | null
  loading: boolean
}) {
  const { pick } = useI18n()
  const navigate = useNavigate()
  const title = pick('Bước tiếp theo', 'Next step')

  if (loading) {
    return (
      <Panel title={title}>
        <div data-testid="primary-cta-skeleton" role="status" className="flex items-center gap-3">
          <span className="sr-only">{pick('Đang xác định bước tiếp theo…', 'Determining the next step…')}</span>
          <div className="h-10 w-44 animate-pulse rounded-[var(--radius)] bg-[var(--c-surface-2)]" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-[var(--c-surface-2)]" />
        </div>
      </Panel>
    )
  }

  // Chưa đủ căn cứ ⇒ KHÔNG có CTA chính nào, và phải nói vì sao. Một khoảng
  // trống im lặng đọc y hệt một lỗi hiển thị.
  if (decision.kind === null || decision.route === null) {
    return (
      <Panel title={title}>
        <p data-testid="primary-cta-undecided" className="text-sm text-[var(--c-text-dim)]">
          {decision.undecidedReason !== null
            ? primaryCtaUndecidedLabel(pick, decision.undecidedReason)
            : pick('Chưa đề xuất được hành động tiếp theo.', 'No next action can be suggested yet.')}
        </p>
      </Panel>
    )
  }

  const blockedLabel = blockedBy !== null ? quickActionBlockedLabel(pick, blockedBy) : null
  const label = primaryCtaLabel(pick, decision.kind)

  return (
    <Panel title={title}>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          data-testid="primary-cta"
          data-cta-kind={decision.kind}
          data-blocked-by={blockedBy ?? undefined}
          variant="primary"
          // `aria-disabled` thay cho `disabled` — cùng lý do đã ghi ở
          // `QuickActions`: nút bị chặn phải còn trong thứ tự tab thì người dùng
          // bàn phím mới nghe được lý do. `onClick` mới là chỗ chặn thật.
          aria-disabled={blockedLabel !== null ? 'true' : undefined}
          aria-describedby={blockedLabel !== null ? 'primary-cta-blocked' : undefined}
          className={blockedLabel !== null ? 'cursor-not-allowed opacity-60' : undefined}
          icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
          onClick={() => {
            if (blockedLabel !== null || decision.route === null) return
            navigate(decision.route)
          }}
        >
          {label}
        </Button>
        {blockedLabel !== null && (
          <p id="primary-cta-blocked" className="text-xs text-[var(--c-warn-fg)]">
            {blockedLabel}
          </p>
        )}
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ *
 * Chưa có Project (handoff §6 nhánh 2)                                *
 * ------------------------------------------------------------------ */

/**
 * Giải thích trước, lối tạo sau — và lối tạo **chỉ hiện với người đủ quyền**.
 * Vai `viewer`/`operator` vẫn đọc được lời giải thích: giấu cả câu chữ đi thì
 * họ chỉ thấy một trang trống và không biết mình đang thiếu quyền hay thiết bị
 * thật sự chưa có gì.
 */
function NoProjectCard({ canEdit }: { canEdit: boolean }) {
  const { pick } = useI18n()
  const navigate = useNavigate()
  const { createProject, creating, error } = useCreateProgrammingProject()
  const [nameDraft, setNameDraft] = useState('')

  return (
    <Panel title={pick('Bắt đầu', 'Get started')}>
      <p data-testid="no-project" className="text-sm text-[var(--c-text-dim)]">
        {pick(
          'Controller này chưa có Project nào — chưa có bản nháp để chỉnh sửa và chưa có gói nào để đưa vào vận hành.',
          'This controller has no project yet — there is no draft to edit and no package to commission.'
        )}
      </p>
      {canEdit ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            void createProject(nameDraft || pick('Ứng dụng điều khiển', 'Control application')).then((created) => {
              if (created) navigate(programsWorkspacePath(created.projectId))
            })
          }}
        >
          <label className="block text-xs font-medium text-[var(--c-text-dim)]" htmlFor="programming-new-project-name">
            {pick('Tên Project', 'Project name')}
          </label>
          <input
            id="programming-new-project-name"
            className="w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 py-2 text-sm text-[var(--c-text)]"
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            placeholder={pick('Ứng dụng điều khiển', 'Control application')}
          />
          <Button type="submit" size="sm" icon={<FolderPlus className="h-4 w-4" aria-hidden="true" />} loading={creating}>
            {pick('Tạo bản nháp', 'Create draft')}
          </Button>
          {error && <p className="text-xs text-[var(--c-fault-fg)]">{error}</p>}
        </form>
      ) : (
        <p className="mt-2 text-xs text-[var(--c-text-dim)]">
          {pick(
            'Vai hiện tại không có quyền tạo Project.',
            'The current role does not have permission to create a project.'
          )}
        </p>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------------ *
 * Bảng Programs — desktop bảng, `<768 px` thẻ gọn (`T60-208`)         *
 * ------------------------------------------------------------------ */

function ProgramsSection({
  model,
  projectId,
  canEdit,
  loading
}: {
  model: ProgramsSummaryModel
  projectId: string | null
  canEdit: boolean
  loading: boolean
}) {
  const { pick } = useI18n()
  const navigate = useNavigate()

  if (loading) {
    return (
      <div className="min-w-0 lg:col-span-3">
        <ProgramsTableSkeleton />
      </div>
    )
  }

  // Rỗng thì bảng và thẻ gọn nói y hệt nhau, nên chỉ vẽ MỘT lần — nhân đôi một
  // khối trạng thái rỗng chỉ tạo thêm một tiêu đề trùng cho trình đọc màn hình.
  if (model.rows.length === 0) {
    const canCreate = canEdit && projectId !== null && model.emptyReason === 'NO_PROGRAM'
    return (
      <div className="min-w-0 space-y-2 lg:col-span-3">
        <ProgramsSummaryTable model={model} projectId={projectId} />
        {canCreate && (
          <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-dashed border-[var(--c-border)] p-3">
            <p className="min-w-0 text-xs text-[var(--c-text-dim)]">
              {pick(
                'Thêm Program đầu tiên trong workspace Thiết kế rồi chạy Kiểm tra trước khi đưa vào vận hành.',
                'Add the first Program in the design workspace, then run a check before commissioning.'
              )}
            </p>
            <Button
              size="sm"
              variant="secondary"
              data-testid="create-program"
              icon={<PencilRuler className="h-4 w-4" aria-hidden="true" />}
              onClick={() => navigate(programsWorkspacePath(projectId))}
            >
              {pick('Tạo chương trình', 'Create Program')}
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {/* Hai hình dạng của CÙNG một dữ liệu (khuôn đã dùng ở `VersionsTab`):
          bảng sáu cột từ `md` trở lên, thẻ gọn ở `<768 px`. Bảng sáu cột nhét
          vào 390 px sẽ đẩy cả trang tràn ngang dù đã có `overflow-x-auto` bên
          trong — handoff §7 cấm chính điều đó. */}
      <div data-testid="programs-desktop" className="hidden min-w-0 md:block lg:col-span-3">
        <ProgramsSummaryTable model={model} projectId={projectId} />
      </div>
      <div data-testid="programs-compact" className="min-w-0 md:hidden lg:col-span-3">
        <ProgramsCompactList model={model} projectId={projectId} />
      </div>
    </>
  )
}

/**
 * Thẻ gọn cho `<768 px`. Không phải một bảng bị thu nhỏ: mỗi Program là một
 * thẻ, các dữ kiện xuống dòng thay vì nằm ngang.
 *
 * BA LUẬT GIỮ NGUYÊN Y HỆT BẢNG — và giữ bằng cách DÙNG CHUNG hàm, không chép:
 * trạng thái/sức khoẻ đi qua `programRuntimeSemanticState`/
 * `programHealthSemanticState` của view model, nên hai hình dạng không thể nói
 * hai điều khác nhau về cùng một dòng. Thiếu số liệu ra `—` kèm lý do
 * (`AC-PGM01-04`), `LAST_KNOWN` mang nhãn "giá trị cũ", và KHÔNG chuỗi UUID nào
 * ra mặt trước (`AC-PGM01-01`, handoff §7 *no horizontal UUID content*).
 */
function ProgramsCompactList({ model, projectId }: { model: ProgramsSummaryModel; projectId: string | null }) {
  const { pick, locale } = useI18n()
  const navigate = useNavigate()
  const title = pick('Chương trình đang vận hành', 'Programs in operation')

  return (
    <Panel title={title}>
      <ul className="space-y-2">
        {model.rows.map((row) => (
          <li
            key={row.key}
            data-program-card={row.origin}
            className="rounded-[var(--radius)] border border-[var(--c-border)] p-2 text-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <ProgramCardName
                row={row}
                onOpen={() => {
                  if (!projectId || !row.objectId) return
                  navigate(programsWorkspacePath(projectId, { pou: row.objectId }))
                }}
              />
              <ProgramStateBadge row={row} />
            </div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-[var(--c-text-dim)]">{pick('Ngôn ngữ', 'Language')}</dt>
              <dd className="min-w-0 break-words text-right">
                {row.language ?? <MissingValue reason={pick('Không có trong gói đang vận hành', 'Not part of the running package')} />}
              </dd>
              <dt className="text-[var(--c-text-dim)]">{pick('Chu kỳ', 'Cycle')}</dt>
              <dd className="min-w-0 break-words text-right">
                {row.cycle === null ? (
                  <MissingValue reason={pick('Chưa đọc được từ Core', 'Not read from Core')} />
                ) : (
                  `${row.cycle.periodMs} ms · ${row.cycle.source === 'CORE_LIVE' ? pick('Core đang chạy', 'Live from Core') : pick('Khai báo trong gói', 'Declared in the package')}`
                )}
              </dd>
              <dt className="text-[var(--c-text-dim)]">{pick('Chạy gần nhất', 'Last Exec')}</dt>
              <dd className="min-w-0 break-words text-right">
                {row.lastRun === null ? (
                  <MissingValue reason={pick('Chưa đọc được từ Core', 'Not read from Core')} />
                ) : row.lastRun.atUtc !== null ? (
                  formatTechnicalTime(row.lastRun.atUtc, locale)
                ) : (
                  pick('Chưa rõ mốc', 'Timestamp unknown')
                )}
              </dd>
              <dt className="text-[var(--c-text-dim)]">{pick('Sức khoẻ', 'Health')}</dt>
              <dd className="flex min-w-0 justify-end">
                {row.health === null ? (
                  <MissingValue reason={pick('Chưa có nhãn từ máy chủ', 'The server assigns no label')} />
                ) : (
                  <StatusBadge
                    {...semanticBadgeProps(pick, programHealthSemanticState(row.health), compactHealthLabel(pick, row.health))}
                  />
                )}
              </dd>
            </dl>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function ProgramCardName({ row, onOpen }: { row: OverviewProgramRow; onOpen: () => void }) {
  const { pick } = useI18n()
  if (row.name === null) {
    // KHÔNG in `programId`/`objectId` thay thế, kể cả rút gọn (D-05 đã loại
    // phương án đó) — `AC-PGM01-01` và handoff §7.
    return (
      <MissingValue
        reason={row.origin === 'LIVE_ONLY'
          ? pick('Không có trong gói đang vận hành', 'Not part of the running package')
          : pick('Gói đang vận hành không khai tên', 'The running package declares no name')}
      />
    )
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="min-w-0 break-words rounded-[var(--radius)] text-left font-medium text-[var(--c-accent)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--c-accent)]"
    >
      {row.name}
    </button>
  )
}

function ProgramStateBadge({ row }: { row: OverviewProgramRow }) {
  const { pick } = useI18n()
  const stale = semanticStateDescriptor('stale')
  const StaleIcon = stale.icon
  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <StatusBadge
        {...semanticBadgeProps(pick, programRuntimeSemanticState(row.runtimeState), compactRuntimeStateLabel(pick, row.runtimeState))}
      />
      {row.runtimeStateSource === 'LAST_KNOWN' && (
        <span className="flex items-center gap-1 text-[10px] leading-tight text-[var(--c-warn-fg)]">
          <StaleIcon className="h-3 w-3" aria-hidden="true" />
          {pick('giá trị cũ', 'stale value')}
        </span>
      )}
      {row.runtimeStateSource === 'UNAVAILABLE' && (
        <span className="text-[10px] leading-tight text-[var(--c-text-dim)]">
          {pick('Chưa đọc được từ Core', 'Not read from Core')}
        </span>
      )}
    </span>
  )
}

/** `—` KÈM LÝ DO. Không bao giờ `0`: một số `0` luôn được đọc như một sự thật. */
function MissingValue({ reason }: { reason: string }) {
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span aria-hidden="true" className="text-[var(--c-text-dim)]">—</span>
      <span className="text-[10px] leading-tight text-[var(--c-text-dim)]">{reason}</span>
    </span>
  )
}

type PickFn = (vi: string, en: string) => string

function compactRuntimeStateLabel(pick: PickFn, state: ProgrammingProgramRuntimeState): string {
  switch (state) {
    case 'RUNNING':
      return pick('Đang chạy', 'Running')
    case 'WAITING':
      return pick('Chờ chạy', 'Waiting')
    case 'DISABLED':
      return pick('Đã tắt', 'Disabled')
    case 'FAULTED':
      return pick('Lỗi', 'Faulted')
    case 'UNKNOWN':
      return pick('Chưa rõ', 'Unknown')
  }
}

function compactHealthLabel(pick: PickFn, health: ProgrammingProgramHealth): string {
  switch (health) {
    case 'HEALTHY':
      return pick('Bình thường', 'Healthy')
    case 'DEGRADED':
      return pick('Suy giảm', 'Degraded')
    case 'FAULT':
      return pick('Lỗi', 'Fault')
    case 'UNKNOWN':
      return pick('Chưa rõ', 'Unknown')
  }
}

/* ------------------------------------------------------------------ *
 * Khung chờ — KHỚP HÌNH HỌC (handoff §6 nhánh 1)                      *
 * ------------------------------------------------------------------ */

/**
 * Khung chờ của một thẻ: đúng tiêu đề thật, đúng số hàng, đúng số cột. Một dòng
 * "Đang tải…" chiếm 20 px rồi nhường chỗ cho một thẻ 260 px làm cả lưới nhảy
 * khi dữ liệu về — người dùng đọc cú nhảy đó thành lỗi hiển thị.
 */
function CardSkeleton({ title, rows, columns }: { title: string; rows: number; columns: 1 | 2 | 4 }) {
  const { pick } = useI18n()
  // Lớp Tailwind phải là chuỗi NGUYÊN VẸN trong mã nguồn: JIT quét văn bản, một
  // lớp ghép chuỗi (`sm:grid-cols-${n}`) sẽ không bao giờ được sinh ra CSS.
  const gridClass = columns === 4
    ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4'
    : columns === 2
      ? 'grid gap-3 sm:grid-cols-2'
      : 'space-y-2'
  return (
    <Panel title={title}>
      <div data-testid="card-skeleton" role="status" className="space-y-2">
        <span className="sr-only">{pick('Đang tải…', 'Loading…')}</span>
        <div className={gridClass}>
          {Array.from({ length: rows * columns }, (_, index) => (
            <div key={index} className="space-y-1.5 rounded-[var(--radius)] border border-[var(--c-border)] p-2">
              <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--c-surface-2)]" />
              <div className="h-5 w-24 animate-pulse rounded-full bg-[var(--c-surface-2)]" />
            </div>
          ))}
        </div>
      </div>
    </Panel>
  )
}

/**
 * Khung chờ của bảng Programs: đúng sáu cột của D-02 và ba hàng thân, bọc trong
 * cùng khung viền mà bảng thật dùng.
 */
function ProgramsTableSkeleton() {
  const { pick } = useI18n()
  return (
    <Panel title={pick('Chương trình đang vận hành', 'Programs in operation')}>
      <div data-testid="programs-table-skeleton" role="status">
        <span className="sr-only">{pick('Đang đọc danh sách chương trình…', 'Reading the program list…')}</span>
        <div className="h-3 w-1/3 animate-pulse rounded bg-[var(--c-surface-2)]" />
        <div className="mt-2 overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)]">
          <div className="grid grid-cols-3 gap-3 border-b border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 py-2 md:grid-cols-6">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="h-3 animate-pulse rounded bg-[var(--c-border)]" />
            ))}
          </div>
          {Array.from({ length: 3 }, (_, rowIndex) => (
            <div key={rowIndex} className="grid grid-cols-3 gap-3 border-b border-[var(--c-border)] px-3 py-3 last:border-0 md:grid-cols-6">
              {Array.from({ length: 6 }, (_, cellIndex) => (
                <div key={cellIndex} className="h-4 animate-pulse rounded bg-[var(--c-surface-2)]" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  )
}
