import { PROGRAMMING_LIBRARY_CATEGORY_ORDER } from '../api/generated/library_registry'
import type {
  ProgrammingLibraryEntry,
  ProgrammingLibraryUsage,
} from '../model/types'

/**
 * `T61-203` — mô hình TRÌNH BÀY của một khối Control Library.
 *
 * Tách khỏi React vì ba luật ở đây là luật về DỮ LIỆU, không phải về giao diện,
 * và cả ba đều là chống-nói-dối. Kiểm chúng phải làm được mà không dựng cây
 * component.
 */

/** Nhãn phạm vi. **Không** dùng chữ "Core": sản phẩm đã có `mkddc-core`, và hai
 *  nghĩa cho một từ đúng chỗ người trực ca cần đọc nhanh là một cái bẫy. */
export function scopeLabel(scope: ProgrammingLibraryEntry['scope'], english: boolean): string {
  if (scope === 'SYSTEM') return english ? 'System' : 'Hệ thống'
  return english ? 'Project' : 'Dự án'
}

/**
 * Giá trị hiển thị của một trường metadata.
 *
 * `null` ở đây nghĩa là "chưa ai điền" và bề mặt phải render `—`. Quy nó về
 * chuỗi rỗng sẽ làm ô đó trông như đã điền rồi — người dùng sẽ không đi tìm
 * chỗ để điền.
 */
export function metadataValue(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const trimmed = raw.trim()
  return trimmed.length === 0 ? null : trimmed
}

export type InsertBlockReason =
  | 'REVIEW_REQUIRED'
  | 'NO_TARGET'
  | 'DEPRECATED'
  | null

/**
 * Vì sao Insert bị khoá — hoặc `null` nếu không bị khoá.
 *
 * Thứ tự kiểm là một phần của hợp đồng: `REVIEW_REQUIRED` đứng TRƯỚC
 * `NO_TARGET`. Một khối đang chờ review Controls/Safety thì việc mở đúng POU
 * cũng không làm nó chèn được, nên báo "hãy chọn POU đích" là chỉ người dùng
 * đi một vòng vô ích rồi quay lại đúng chỗ cũ.
 *
 * `D61-04`/`T59-205`: KHÔNG có đường bỏ qua `REVIEW_REQUIRED`. Hàm này không
 * nhận cờ nào để tắt nó.
 */
export function insertBlockReason(
  entry: Pick<ProgrammingLibraryEntry, 'featureState' | 'libraryState'>,
  hasTarget: boolean,
): InsertBlockReason {
  if (entry.featureState === 'REVIEW_REQUIRED') return 'REVIEW_REQUIRED'
  if (entry.libraryState === 'DEPRECATED') return 'DEPRECATED'
  if (!hasTarget) return 'NO_TARGET'
  return null
}

export type UsageDisplay =
  | { kind: 'count'; sealed: number; draft: number | null; truncated: boolean }
  | { kind: 'unavailable' }
  | { kind: 'sealed-only'; sealed: number; truncated: boolean }

/**
 * Chiếu Used-In thành thứ hiển thị được — và đây là hàm quan trọng nhất tệp này.
 *
 * `count: 0` nghĩa là "không chương trình nào đang dùng khối này", một câu mời
 * người ta xoá hoặc deprecate nó. `UNAVAILABLE` nghĩa là "chưa đo được". Hiện
 * số `0` khi server nói `UNAVAILABLE` là cách một khối bị gỡ **trong khi nó
 * đang điều khiển tủ** — nên hàm này không bao giờ trả `count` cho trường hợp
 * đó, kể cả khi payload có sẵn số 0 trong `sealed.count`.
 */
export function usageDisplay(usage: ProgrammingLibraryUsage | null | undefined): UsageDisplay {
  if (!usage || usage.availability === 'UNAVAILABLE') return { kind: 'unavailable' }
  if (usage.availability === 'SEALED_ONLY') {
    return { kind: 'sealed-only', sealed: usage.sealed.count, truncated: usage.sealed.truncated }
  }
  return {
    kind: 'count',
    sealed: usage.sealed.count,
    draft: usage.draft.count,
    truncated: usage.sealed.truncated || usage.draft.truncated,
  }
}

/**
 * Có được phép xoá/ngừng dùng khối này không, xét theo Used-In.
 *
 * Trả `false` khi CHƯA ĐO ĐƯỢC, không chỉ khi đang có người dùng. Đây là chỗ
 * `UNAVAILABLE` phải hành xử khác `0`: không biết thì không cho gỡ.
 */
export function safeToRemove(usage: ProgrammingLibraryUsage | null | undefined): boolean {
  const display = usageDisplay(usage)
  if (display.kind === 'unavailable') return false
  if (display.truncated) return false
  if (display.kind === 'sealed-only') return display.sealed === 0
  return display.sealed === 0 && display.draft === 0
}

/**
 * Nhãn hiển thị của một phân loại, lấy từ registry.
 *
 * Không viết tay bảng ánh xạ ở FE: registry là nơi `category` được định nghĩa,
 * nên nó cũng phải là nơi định nghĩa tên hiển thị. Một nhóm mới thêm vào
 * registry mà FE không biết sẽ hiện ra dưới dạng mã thô — xấu nhưng TRUNG THỰC,
 * và tốt hơn nhiều so với việc rơi vào một nhóm "khác" tự nghĩ ra.
 */
export function categoryLabel(
  category: string,
  pick: (vi: string, en: string) => string,
): string {
  const known = PROGRAMMING_LIBRARY_CATEGORY_ORDER.find((item) => item.id === category)
  return known ? pick(known.labelVi, known.labelEn) : category
}
