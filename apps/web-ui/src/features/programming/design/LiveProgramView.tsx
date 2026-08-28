import { useMemo } from 'react'
import { useI18n } from '../../../shared/i18n'
import { useProgrammingRevision, type ProgrammingRuntimeMonitorState } from '../api/queries'
import { activeProgramSource, type ActiveProgramSource } from '../overview/activeProgramSet'
import { LiveFbdView } from './LiveFbdView'
import type { FbdDocument } from '../fbd/model'
import { StRuntimeValueOverlay } from './editor/StRuntimeValueOverlay'
import { runtimeOverlayByProgramId } from './editor/workspaceAdapters'
import type { ProgrammingProgram } from '../model/types'

/**
 * `T59-811` / `PGM02-V22-WP-06-R2` — cửa sổ LIVE.
 *
 * LIVE **không phải** "editor với nút Lưu bị khoá". Đó là một tài liệu KHÁC:
 * nguồn của gói đang chạy, không phải Draft đang sửa. Hai thứ ấy trông giống
 * hệt nhau trên màn hình — cùng cửa sổ, cùng tên POU, cùng thứ tiếng ST — nên
 * dùng lại đúng component editor rồi tắt sửa là cách chắc chắn nhất để một hôm
 * nào đó Draft rò vào chỗ đáng lẽ phải là Active, mà không có dấu hiệu bên
 * ngoài nào cả.
 *
 * Vì vậy: một component riêng, đọc nguồn qua `activeProgramSource` (chốt chặn
 * `REVISION_MISMATCH` nằm ở đó), **chỉ đọc với mọi vai kể cả admin**, và không
 * có một nhánh nào rơi về Draft.
 */
export function LiveProgramView({
  program,
  objectId,
  activeRevisionId,
  monitor,
  refreshPaused,
  onTogglePauseRefresh,
  onReturnToDraft,
}: {
  /** `T59-821` — thanh LIVE. `undefined` ⇒ nút khoá kèm lý do, không ẩn. */
  refreshPaused?: boolean
  onTogglePauseRefresh?: () => void
  onReturnToDraft?: () => void
  /** POU đang chọn ở cây — dùng để đối chiếu tên, KHÔNG dùng làm nguồn. */
  program: ProgrammingProgram | undefined
  objectId: string | undefined
  /** Revision đang chạy, do trang cha đọc — xem ghi chú `monitor` bên dưới. */
  activeRevisionId: string | null
  /**
   * Snapshot runtime **truyền xuống**, không tự gọi hook.
   *
   * Trang cha đã poll monitor ở nhịp 1 Hz cho lớp giá trị của editor. Gọi lại
   * hook ở đây tạo một bộ poll THỨ HAI trên cùng một endpoint: gấp đôi tải cho
   * Core, hai dãy `capturedMonotonicNs` độc lập, và hai câu trả lời có thể lệch
   * nhau về cùng một thời điểm. Đúng thứ AC "không duplicate concurrent poll"
   * tồn tại để chặn.
   */
  monitor: ProgrammingRuntimeMonitorState
}) {
  const { pick } = useI18n()
  const revision = useProgrammingRevision(activeRevisionId)

  const active = activeProgramSource({
    activeRevisionId,
    status: revision.status,
    revision: revision.data,
    objectId: objectId ?? null,
  })

  const overlays = runtimeOverlayByProgramId(
    program ? [program] : [],
    monitor,
    activeRevisionId,
  )
  /* Parse theo identity của nguồn Active, không theo sample runtime. Nếu không,
   * mỗi tick tạo một object topology mới và buộc toàn bộ canvas FBD render lại. */
  const liveFbdDocument = useMemo(
    () => active.source !== null && active.language === 'FBD' ? parseLiveFbd(active.source) : null,
    [active.language, active.source],
  )

  return (
    <section className="space-y-3" aria-label={pick('Chương trình đang chạy', 'Running program')}>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-2">
        <div className="text-xs text-[var(--c-text)]">
          <span className="font-semibold uppercase">{pick('Đang chạy', 'Running')}</span>
          <span className="text-[var(--c-text-dim)]">
            {' · '}
            {pick('Revision', 'Revision')}{' '}
            <span className="font-mono">{activeRevisionId ?? '—'}</span>
          </span>
        </div>
        {/* Chỉ đọc ở đây KHÔNG phải chuyện quyền: kể cả admin cũng không sửa
            được gói đang chạy. Sửa đi qua Draft rồi Commission. */}
        <div className="flex flex-wrap items-center gap-1">
          {/* `T59-821` / `PGM-02A §3` — thanh LIVE.
            *
            * Bốn nút này KHÔNG bao gồm một nút đổi mode: `SIMULATE`/`LIVE` là
            * mode switch ở `ProgramsModeSwitcher`, và nhân bản chúng thành nút
            * toolbar sẽ tạo hai đường đổi mode — chúng sẽ lệch nhau đúng lúc
            * một trong hai bị quên cập nhật.
            *
            * Nút chưa nối vẫn HIỆN và vẫn khoá kèm lý do đọc được. Ẩn im lặng
            * làm người dùng tưởng tính năng không tồn tại. */}
          <LiveBarButton
            label={pick('Tạm dừng làm mới', 'Pause refresh')}
            enabled={typeof onTogglePauseRefresh === 'function'}
            pressed={refreshPaused}
            disabledReason={pick('Nhịp làm mới do khay Runtime sở hữu; trang này chưa nhận quyền tạm dừng.',
                                 'The refresh cadence is owned by the runtime panel; this view has no pause control yet.')}
            onClick={() => onTogglePauseRefresh?.()}
          />
          <LiveBarButton
            label={pick('Theo dõi', 'Watch')}
            enabled={false}
            disabledReason={pick('Bảng theo dõi biến của LIVE chưa được nối vào trang này.',
                                 'The LIVE variable watch table is not wired into this view yet.')}
            onClick={() => undefined}
          />
          <LiveBarButton
            label={pick('Vết', 'Trace')}
            enabled={false}
            disabledReason={pick('Bề mặt Vết chưa được nối vào giao diện. Dịch vụ đã có, phần hiển thị thì chưa.',
                                 'The trace surface is not wired into the UI yet. The service exists; the view does not.')}
            onClick={() => undefined}
          />
          <LiveBarButton
            label={pick('Về bản nháp', 'Return to draft')}
            enabled={typeof onReturnToDraft === 'function'}
            disabledReason={pick('Trang này chưa nhận đường quay lại Draft.', 'This view has no route back to the draft yet.')}
            onClick={() => onReturnToDraft?.()}
          />
          <span className="rounded-full border border-[var(--c-border)] px-2 py-0.5 text-[11px] text-[var(--c-text-dim)]">
            {pick('Chỉ đọc với mọi vai', 'Read only for every role')}
          </span>
        </div>
      </div>

      {active.source === null ? (
        <p role="status" className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] p-2 text-xs text-[var(--c-warn-fg)]">
          {liveSourceReason(pick, active.reason)}
        </p>
      ) : active.language === 'FBD' ? (
        /* `AC-FBD-009` — sơ đồ đang chạy phải là SƠ ĐỒ, không phải JSON thô.
         * Tài liệu hỏng thì nói ra thay vì vẽ một sơ đồ trống trông như "chương
         * trình không có gì". */
        liveFbdDocument === null ? (
          <p role="status" className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] p-2 text-xs text-[var(--c-warn-fg)]">
            {pick('Sơ đồ FBD của gói đang chạy không đọc được.', 'The running package’s FBD diagram cannot be read.')}
          </p>
        ) : (
          <LiveFbdView document={liveFbdDocument} />
        )
      ) : (
        <div className="space-y-2">
          <label className="block text-xs text-[var(--c-text-dim)]" htmlFor="programming-live-source">
            {pick('Nguồn của gói đang chạy', 'Source of the running package')}
          </label>
          <textarea
            id="programming-live-source"
            readOnly
            value={active.source}
            rows={16}
            aria-label={pick('Mã nguồn đang chạy', 'Running source')}
            className="w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] p-2 font-mono text-xs text-[var(--c-text)]"
          />
        </div>
      )}

      {program && <StRuntimeValueOverlay state={overlays[program.programId] ?? { status: 'unavailable' }} />}
    </section>
  )
}

/**
 * Tài liệu FBD của gói đang chạy. `null` = không đọc được — KHÁC HẲN một sơ đồ
 * rỗng, và hai thứ đó phải hiện ra khác nhau.
 */
function parseLiveFbd(source: string): FbdDocument | null {
  try {
    const parsed = JSON.parse(source) as FbdDocument
    return Array.isArray(parsed?.networks) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Mỗi lý do là một hành động khác nhau của người đọc, nên chúng không được gộp
 * thành một câu "không có dữ liệu".
 */
function liveSourceReason(
  pick: (vi: string, en: string) => string,
  reason: ActiveProgramSource['reason'],
): string {
  switch (reason) {
    case 'NO_ACTIVE_REVISION':
      return pick('Thiết bị chưa Commission gói nào — không có gì đang chạy để hiển thị.', 'The device has not commissioned any package — there is nothing running to show.')
    case 'REVISION_LOADING':
      return pick('Đang đọc gói đang chạy…', 'Reading the running package…')
    case 'REVISION_UNAVAILABLE':
      return pick('Không đọc được gói đang chạy. Đây KHÔNG phải "chương trình rỗng".', 'The running package could not be read. This is NOT “an empty program”.')
    case 'REVISION_MISMATCH':
      return pick('Phản hồi thuộc một Revision khác Revision đang chạy — không hiển thị để tránh nhầm Draft thành gói đang chạy.', 'The response belongs to a different revision than the running one — not displayed, to avoid mistaking a draft for the running package.')
    case 'SNAPSHOT_UNREADABLE':
      return pick('Nội dung gói đang chạy không đọc được.', 'The running package content is unreadable.')
    case 'SOURCE_UNREADABLE':
      return pick('POU có trong gói đang chạy nhưng thân của nó không đọc được.', 'The POU exists in the running package but its body is unreadable.')
    case 'POU_NOT_IN_REVISION':
      return pick('POU này chưa có trong gói đang chạy — nhiều khả năng nó mới được tạo ở Draft và chưa Commission.', 'This POU is not in the running package yet — most likely it was created in the draft and not commissioned.')
    case 'NO_PROGRAM_DECLARED':
      return pick('Gói đang chạy không khai Program nào.', 'The running package declares no program.')
    default:
      return pick('Không có nguồn để hiển thị.', 'No source to display.')
  }
}


function LiveBarButton({
  label, enabled, onClick, disabledReason, pressed,
}: {
  label: string
  enabled: boolean
  onClick: () => void
  disabledReason: string
  pressed?: boolean
}) {
  return (
    <button
      type="button"
      disabled={!enabled}
      aria-pressed={pressed}
      onClick={onClick}
      /* Nút khoá phải nêu lý do đọc được — cấm ẩn im lặng. */
      title={!enabled ? disabledReason : undefined}
      className="rounded-[var(--radius)] border border-[var(--c-border)] px-2 py-1 text-[11px] text-[var(--c-text)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  )
}
