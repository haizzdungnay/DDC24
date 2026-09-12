import type { ProgrammingProject, RemoteState } from '../model/types'

type ResourceStatus = RemoteState<unknown>['status']

/**
 * `ISS-PGUI-01` — Revision đang vận hành THUỘC VỀ Project nào.
 *
 * ## Lỗi mà mô-đun này tồn tại để chặn
 *
 * `GET /runtime` là read model của **controller**, không của Project: nó trả
 * đúng một `activeRevisionId` cho cả thiết bị. Ba bề mặt của Programming từng
 * ghép thẳng con số ấy vào Project **đang được xem** mà không hỏi nó có thuộc
 * Project đó không.
 *
 * Hậu quả đo được trên production (`PC-001`/`PC-002`/`PM-011`): Overview chọn
 * `AHU-MASTER-SEQUENCE`, còn Active Revision toàn cục thuộc
 * `SOAK-10P-20260824-172521`. Màn hình đồng thời hiện `Active: Yes`, `Running`,
 * và "active revision number is unresolved" — ba câu không thể cùng đúng. FE
 * còn gọi `GET /revisions/{active}/changes/{base}` với hai Revision khác
 * Project; backend từ chối bằng `400 PRG-ERR-REQ-001` **đúng theo invariant**,
 * và nút Thử lại chỉ lặp lại đúng request sai ấy.
 *
 * ## Vì sao phải là một hàm dùng chung
 *
 * Ba bề mặt (Overview, Layout, Context strip) hỏi cùng một câu. Ba bản trả lời
 * riêng đã cho ba câu khác nhau về cùng một thiết bị — đó chính là hình dạng
 * của lỗi này. Một hàm thì chỉ có một câu trả lời.
 *
 * ## Vì sao KHÔNG suy từ "Project đầu tiên"
 *
 * Rev A khoá một Project trên mỗi controller, nên `items[0]` từng là một phép
 * xấp xỉ đúng. Nó thôi đúng ngay khi danh sách có Project thứ hai — và danh
 * sách production đã có. Quan hệ đúng nằm ở dữ liệu: `project.activeRevisionId`
 * là thứ Project tự khai, `runtime.activeRevisionId` là thứ thiết bị đang chạy;
 * hai cái bằng nhau thì mới là cùng một Revision.
 */
export type ActiveRevisionOwnership =
  /** Chưa đọc xong `GET /runtime` hoặc `GET /projects`. */
  | { kind: 'loading' }
  /** Không đọc được runtime — KHÁC "không có Active". */
  | { kind: 'unavailable' }
  /** Thiết bị chưa Commission gói nào. */
  | { kind: 'not-commissioned' }
  /** Revision đang chạy thuộc ĐÚNG Project đang xét. */
  | { kind: 'owned'; projectId: string }
  /** Thuộc một Project KHÁC. `ownerName` là `null` khi biết id mà chưa biết tên. */
  | { kind: 'foreign'; ownerProjectId: string; ownerName: string | null }
  /** Không Project nào trong danh sách khai `activeRevisionId` này. */
  | { kind: 'unresolved' }

type ProjectSummary = Pick<ProgrammingProject, 'projectId' | 'name' | 'activeRevisionId'>

export interface ActiveRevisionOwnershipInput {
  runtimeStatus: ResourceStatus
  projectsStatus: ResourceStatus
  /** `producerState` của runtime; `UNAVAILABLE` là "chưa đọc được", không phải "không có". */
  producerState: string | null | undefined
  runtimeActiveRevisionId: string | null | undefined
  projects: readonly ProjectSummary[] | null | undefined
  /** Project đang xét. `null` = chưa chọn Project nào. */
  subjectProjectId: string | null | undefined
}

export function activeRevisionOwnership(input: ActiveRevisionOwnershipInput): ActiveRevisionOwnership {
  if (input.runtimeStatus === 'loading' || input.projectsStatus === 'loading') return { kind: 'loading' }
  /* `UNAVAILABLE` và lỗi đọc gộp vào MỘT câu "chưa đọc được". Chúng khác nhau ở
     nguyên nhân nhưng giống nhau ở điều quan trọng: không có cơ sở để khẳng
     định gì về Revision đang chạy. */
  if (input.runtimeStatus === 'error' || input.producerState === 'UNAVAILABLE') return { kind: 'unavailable' }
  const active = input.runtimeActiveRevisionId ?? null
  if (active === null) return { kind: 'not-commissioned' }

  const owner = (input.projects ?? []).find((project) => project.activeRevisionId === active) ?? null
  if (!owner) return { kind: 'unresolved' }
  if (input.subjectProjectId && owner.projectId === input.subjectProjectId) {
    return { kind: 'owned', projectId: owner.projectId }
  }
  /* Không có Project đang xét thì cũng KHÔNG kết luận "owned": câu hỏi "Revision
     này có thuộc Project tôi đang xem không" chưa có chủ ngữ. */
  return { kind: 'foreign', ownerProjectId: owner.projectId, ownerName: owner.name || null }
}

/**
 * Project ĐANG CHẠY, phân giải từ chính quan hệ dữ liệu — hoặc `null`.
 *
 * `null` là một câu trả lời hợp lệ và phải được xử lý fail-closed: thiết bị
 * chưa Commission, hoặc Revision đang chạy không thuộc Project nào trong danh
 * sách (bảng đã cắt trang, hoặc dữ liệu lệch). Rơi về `items[0]` ở đây là cách
 * lỗi này đã xảy ra.
 */
export function runningProject<T extends ProjectSummary>(
  projects: readonly T[] | null | undefined,
  runtimeActiveRevisionId: string | null | undefined,
): T | null {
  if (!runtimeActiveRevisionId) return null
  return (projects ?? []).find((project) => project.activeRevisionId === runtimeActiveRevisionId) ?? null
}

/**
 * `activeRevisionId` chỉ được dùng khi nó ĐÃ CHỨNG MINH thuộc Project đang xét.
 *
 * Đây là cổng duy nhất cho hai việc: đọc `GET /revisions/{id}` của gói đang
 * chạy, và so sánh Draft↔Active. Gọi so sánh với một cặp chưa chứng minh cùng
 * Project là phát ra một request mà backend BẮT BUỘC từ chối (`400
 * PRG-ERR-REQ-001`, `retryable=false`) — một lỗi 4xx trên luồng hợp lệ, và một
 * nút Thử lại không bao giờ thành công.
 */
export function ownedActiveRevisionId(ownership: ActiveRevisionOwnership, activeRevisionId: string | null): string | null {
  return ownership.kind === 'owned' ? activeRevisionId : null
}
