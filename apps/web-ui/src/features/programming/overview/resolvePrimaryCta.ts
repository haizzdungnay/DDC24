import type { ProgrammingCheckState, ProgrammingTargetState, RemoteState } from '../model/types'

/**
 * `T60-201` — bộ giải **đúng một** hành động chính của PGM-01, theo bảng năm
 * trạng thái của `PGM-01_OVERVIEW_FE_HANDOFF.md` §3.
 *
 * VÌ SAO LÀ HÀM THUẦN
 * -------------------
 * `AC-PGM01-05` đòi "đúng một CTA chính" ở **cả năm** trạng thái. Một luật đếm
 * được như vậy chỉ kiểm được rẻ khi nó nằm ngoài React: không mount, không
 * mock mạng, không chờ poll. Đó cũng là lý do handoff §9 liệt kê riêng
 * *"Implement CTA resolver as pure tested function"*.
 *
 * "CTA CHỈ SUY TỪ TRẠNG THÁI SERVER TƯỜNG MINH" NGHĨA LÀ GÌ
 * ---------------------------------------------------------
 * Thiếu dữ kiện thì **không đoán**. Hàm này có một nhánh `kind = null` kèm
 * `undecidedReason` cho mọi trường hợp chưa đủ căn cứ (đang tải, đọc hỏng,
 * `dirty` chưa phân giải được, Core im). Nhánh đó KHÔNG phải "trạng thái thứ
 * sáu" của thiết kế — nó là chỗ để không rơi bừa vào một trong năm CTA kia.
 * Rơi bừa là điều nguy hiểm nhất mà màn hình này có thể làm: bốn trong năm CTA
 * dẫn thẳng tới một bề mặt thay đổi thiết bị.
 *
 * THỨ TỰ XÉT — VÀ CHỖ BẢNG §3 KHÔNG TỰ QUYẾT ĐƯỢC
 * ------------------------------------------------
 * Bảng §3 là bảng **có thứ tự**; hai hàng giữa của nó chồng nhau nếu đọc rời:
 * *"Draft checked, Active differs"* và *"Ready to commission"* đều là "Check
 * PASSED, Draft đã niêm phong". Tài liệu không cấp thêm dữ kiện nào để tách hai
 * hàng, nên chỗ này phải chọn một tiêu chí — và tiêu chí đó bắt buộc phải là
 * một sự thật SERVER nói ra, không phải một suy đoán về việc người dùng "đã
 * xem chưa".
 *
 * Tiêu chí chọn: **có Active Revision để so hay không**.
 *
 * - Có Active và nó khác Draft ⇒ có thứ để đối chiếu ⇒ `Review Changes`. Đây
 *   đúng nghĩa đen của hàng "Active differs".
 * - Chưa có Active nào (lần Commission đầu tiên) ⇒ không tồn tại phép so nào
 *   ⇒ `Commission`. Đây là hàng "Ready to commission".
 *
 * Phương án bị loại: lấy "người dùng đã mở Compare" làm mốc. Nó là trạng thái
 * cục bộ của trình duyệt, đúng thứ README §5.4 và Plan 60 §0.1 điều 2 cấm dùng
 * làm căn cứ cho hành động vận hành.
 *
 * `latestCheck === null` (chưa Check bản niêm phong hiện hành) trả về
 * `Continue Editing` — giữ nguyên hành vi đã chốt ở `WP-01`
 * (`REV-PROG-OVERVIEW-DESIGN-GAP-2026-08-15` §5.2), nơi nhánh "chưa từng
 * Check" đã được xếp cùng nhóm với `dirty`.
 */

type ResourceStatus = RemoteState<unknown>['status']

export type PrimaryCtaKind =
  | 'CONTINUE_EDITING'
  | 'FIX_CHECK_ERRORS'
  | 'REVIEW_CHANGES'
  | 'COMMISSION'
  | 'OPEN_RUNTIME'

/** Vì sao chưa kết luận được. Mỗi giá trị là một dữ kiện CÒN THIẾU, không phải một trạng thái sản phẩm. */
export type PrimaryCtaUndecidedReason =
  /** Danh sách Project còn đang tải. */
  | 'PROJECT_LOADING'
  /** Đọc Project hỏng — không suy ra "chưa có Project nào". */
  | 'PROJECT_UNAVAILABLE'
  /** Đọc được và controller thật sự chưa có Project nào. */
  | 'NO_PROJECT'
  /** Server trả `dirty = null`: đã xét và chưa biết Draft có việc chưa phát hành hay không. */
  | 'DIRTY_UNKNOWN'
  /** Check đang `QUEUED`/`RUNNING` — kết quả chưa tồn tại để mà suy hành động. */
  | 'CHECK_IN_PROGRESS'
  /** `GET /runtime` còn đang tải. */
  | 'RUNTIME_LOADING'
  /** Core im: chưa biết đang chạy gói nào, nên không kết luận được "không có thay đổi". */
  | 'RUNTIME_UNAVAILABLE'

export interface PrimaryCtaInput {
  projectStatus: ResourceStatus
  projectId: string | null
  /** Revision nền hiện hành của Draft (`baseRevisionId`), KHÔNG phải `draftRevisionId`. */
  baseRevisionId: string | null
  /** `GET /projects` — `null` nghĩa là server đã xét và chưa biết (`T60-015`). */
  dirty: boolean | null
  /** State của Check gần nhất cho `baseRevisionId`; `null` = chưa từng Check bản này. */
  latestCheckState: ProgrammingCheckState | null
  runtimeStatus: ResourceStatus
  /** `null` khi `GET /runtime` chưa đọc được — khác hẳn "Core nói không có Active". */
  producerState: ProgrammingTargetState | null
  activeRevisionId: string | null
}

export interface PrimaryCtaDecision {
  kind: PrimaryCtaKind | null
  /** Hàng của bảng handoff §3 đã khớp (1..5); `null` khi chưa kết luận được. */
  row: 1 | 2 | 3 | 4 | 5 | null
  undecidedReason: PrimaryCtaUndecidedReason | null
  /** Đích điều hướng; `null` khi chưa kết luận được. */
  route: string | null
}

function undecided(reason: PrimaryCtaUndecidedReason): PrimaryCtaDecision {
  return { kind: null, row: null, undecidedReason: reason, route: null }
}

function decided(kind: PrimaryCtaKind, row: 1 | 2 | 3 | 4 | 5, route: string): PrimaryCtaDecision {
  return { kind, row, undecidedReason: null, route }
}

export function resolvePrimaryCta(input: PrimaryCtaInput): PrimaryCtaDecision {
  const { projectId, baseRevisionId } = input

  // --- Điều kiện tiên quyết: phải có một Project xác định ---------------------
  if (input.projectStatus === 'loading') return undecided('PROJECT_LOADING')
  if (input.projectStatus === 'error') return undecided('PROJECT_UNAVAILABLE')
  if (!projectId || !baseRevisionId) return undecided('NO_PROJECT')

  const designRoute = `/eng/programming/projects/${projectId}/programs`
  // `Fix Check Errors`, `Review Changes` và `Commission` cùng đích: PGM-05 là
  // trang chủ quản của chẩn đoán Check, bảng thay đổi và nút Đưa vào vận hành.
  // Ba CTA khác nhau ở CÂU CHỮ và ở việc chúng được phép xuất hiện lúc nào —
  // không phải ở đích. `T60-203` có thể thay `Review Changes` bằng drawer so
  // sánh ngay tại Overview; khi đó chỉ tầng gọi đổi, hàm này không đổi.
  const commissionRoute = `/eng/programming/projects/${projectId}/commission`

  // --- Hàng 1: Draft dirty ---------------------------------------------------
  // `dirty === null` phải chặn TRƯỚC hàng 1: coi "chưa biết" là "sạch" sẽ đẩy
  // người dùng thẳng tới Commission trong khi vẫn còn việc chưa phát hành.
  if (input.dirty === null) return undecided('DIRTY_UNKNOWN')
  if (input.dirty) return decided('CONTINUE_EDITING', 1, designRoute)

  // --- Hàng 2: Check failed --------------------------------------------------
  if (input.latestCheckState === 'FAILED' || input.latestCheckState === 'TIMED_OUT') {
    return decided('FIX_CHECK_ERRORS', 2, commissionRoute)
  }
  if (input.latestCheckState === 'QUEUED' || input.latestCheckState === 'RUNNING') {
    return undecided('CHECK_IN_PROGRESS')
  }

  // --- Từ đây trở xuống mọi nhánh đều phải so với Active ----------------------
  // Hai hàng đầu cố ý nằm TRƯỚC cổng này: README §6 cho phép tiếp tục chỉnh sửa
  // và xem lỗi Check khi Core offline; chỉ Commission mới bị khoá.
  if (input.runtimeStatus === 'loading') return undecided('RUNTIME_LOADING')
  if (input.runtimeStatus === 'error' || input.producerState === null || input.producerState === 'UNAVAILABLE') {
    return undecided('RUNTIME_UNAVAILABLE')
  }

  // --- Hàng 5: không có thay đổi chờ vận hành --------------------------------
  if (input.activeRevisionId !== null && input.activeRevisionId === baseRevisionId) {
    return decided('OPEN_RUNTIME', 5, '/eng/programming/runtime')
  }

  // --- Bản niêm phong chưa từng Check: quay lại workspace (WP-01) -------------
  if (input.latestCheckState === null) return decided('CONTINUE_EDITING', 1, designRoute)

  // Còn lại đúng một khả năng: `latestCheckState === 'PASSED'`.
  // --- Hàng 3 / Hàng 4 -------------------------------------------------------
  return input.activeRevisionId === null
    ? decided('COMMISSION', 4, commissionRoute)
    : decided('REVIEW_CHANGES', 3, commissionRoute)
}

type Pick = (vi: string, en: string) => string

/** Nhãn nút — D-06: một ngôn ngữ tại một thời điểm, không in song ngữ cứng. */
export function primaryCtaLabel(pick: Pick, kind: PrimaryCtaKind): string {
  switch (kind) {
    case 'CONTINUE_EDITING':
      return pick('Tiếp tục chỉnh sửa', 'Continue Editing')
    case 'FIX_CHECK_ERRORS':
      return pick('Sửa lỗi Kiểm tra', 'Fix Check Errors')
    case 'REVIEW_CHANGES':
      return pick('Xem lại thay đổi', 'Review Changes')
    case 'COMMISSION':
      return pick('Đưa vào vận hành', 'Commission')
    case 'OPEN_RUNTIME':
      return pick('Mở Runtime', 'Open Runtime')
  }
}

/**
 * Câu giải thích khi chưa kết luận được. Người dùng luôn phải biết VÌ SAO màn
 * hình không đề xuất hành động nào — một khoảng trống im lặng đọc y hệt một lỗi
 * hiển thị.
 */
export function primaryCtaUndecidedLabel(pick: Pick, reason: PrimaryCtaUndecidedReason): string {
  switch (reason) {
    case 'PROJECT_LOADING':
      return pick('Đang đọc Project…', 'Reading the project…')
    case 'PROJECT_UNAVAILABLE':
      return pick(
        'Chưa đọc được Project nên chưa đề xuất hành động nào.',
        'The project could not be read, so no action is suggested yet.'
      )
    case 'NO_PROJECT':
      return pick(
        'Controller này chưa có Project nào.',
        'This controller has no project yet.'
      )
    case 'DIRTY_UNKNOWN':
      return pick(
        'Máy chủ chưa xác định được bản nháp còn việc chưa phát hành hay không.',
        'The server could not determine whether the draft has unpublished work.'
      )
    case 'CHECK_IN_PROGRESS':
      return pick(
        'Đang Kiểm tra — chờ kết quả rồi mới đề xuất hành động tiếp theo.',
        'A check is running — the next action waits for its result.'
      )
    case 'RUNTIME_LOADING':
      return pick('Đang đọc trạng thái vận hành…', 'Reading the runtime state…')
    case 'RUNTIME_UNAVAILABLE':
      return pick(
        'Chưa đọc được gói đang vận hành từ Core nên chưa kết luận được bước tiếp theo.',
        'The running package could not be read from Core, so the next step is undetermined.'
      )
  }
}
